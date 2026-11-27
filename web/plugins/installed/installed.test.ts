// fork #34: the installed app. Launches (shortcuts, links Chrome opens in the app) reach the window already open; the
// four manifests carry the same shortcuts and title bar; the service worker's "Can't reach Shepherdr" page covers only
// the app's own address; and the upstream seams this leans on are still there.
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { launches, wantsNewTask, withoutNew } from './launch.ts'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

function page(loaded: string) {
  const did: string[] = []
  let t = 1000
  const launch = launches({ loaded, open: (href) => did.push(`open ${href}`), newTask: () => did.push('new task'), now: () => t })
  return { did, launch, later: (ms: number) => void (t += ms) }
}

test("the page's own launch is let go; a later one goes where it points", () => {
  const p = page('https://box.example/shepherdr/?place=sp2')
  p.launch('https://box.example/shepherdr/?place=sp2')
  expect(p.did).toEqual([])
  p.later(60_000)
  p.launch('https://box.example/shepherdr/?place=everything&pane=tasks')
  expect(p.did).toEqual(['open https://box.example/shepherdr/?place=everything&pane=tasks'])
})

test('a launch to another address right after loading still goes there', () => {
  const p = page('https://box.example/shepherdr/')
  p.launch('https://box.example/shepherdr/?task=SHOP-2')
  expect(p.did).toEqual(['open https://box.example/shepherdr/?task=SHOP-2'])
})

test('the same address launched again later (the shortcut used twice) goes there again', () => {
  const p = page('https://box.example/shepherdr/?place=everything')
  p.launch('https://box.example/shepherdr/?place=everything')
  p.later(10_000)
  p.launch('https://box.example/shepherdr/?place=everything')
  expect(p.did).toEqual(['open https://box.example/shepherdr/?place=everything'])
})

test('New task asks for one; a launch without an address does nothing', () => {
  const p = page('https://box.example/shepherdr/')
  p.launch(null)
  p.launch('https://box.example/shepherdr/?new=task')
  expect(p.did).toEqual(['open https://box.example/shepherdr/?new=task', 'new task'])
  expect(wantsNewTask('./?new=task')).toBe(true)
  expect(wantsNewTask('./?new=space')).toBe(false)
  expect(withoutNew('https://box.example/shepherdr/?new=task&place=sp2')).toBe('/shepherdr/?place=sp2')
  expect(withoutNew('https://box.example/shepherdr/')).toBeNull()
})

const MANIFESTS = ['manifest.webmanifest', 'manifest-dark.webmanifest', 'manifest-light.webmanifest', 'manifest-night.webmanifest']

test('every manifest has the shortcuts, the title bar and the launch handler, the same in each', () => {
  const all = MANIFESTS.map((m) => JSON.parse(read(`web/public/${m}`)))
  for (const m of all) {
    expect(m.display).toBe('standalone')
    expect(m.display_override).toEqual(['window-controls-overlay'])
    expect(m.launch_handler.client_mode[0]).toBe('focus-existing')
    expect(m.shortcuts.map((s: { name: string }) => s.name)).toEqual(['Everything', 'Needs you', 'New task'])
    for (const s of m.shortcuts) {
      // relative to the manifest, so they work under any path (/shepherdr/)
      expect(s.url.startsWith('./?')).toBe(true)
      for (const i of s.icons) expect(existsSync(new URL(`web/public/${i.src.split('?')[0]}`, root))).toBe(true)
    }
    expect(m.shortcuts).toEqual(all[0].shortcuts)
  }
})

test('the iPhone Air has its launch screens', () => {
  const html = read('web/index.html')
  for (const t of ['light', 'dark']) {
    expect(html).toContain(`(device-width: 420px) and (device-height: 912px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: ${t})" href="splash/420x912@3-${t}.png"`)
    expect(existsSync(new URL(`web/public/splash/420x912@3-${t}.png`, root))).toBe(true)
  }
})

/* the service worker, run with a stand-in for its global scope */
function worker(net: (url: string) => Promise<Response>) {
  const on: Record<string, (e: unknown) => void> = {}
  const self = {
    registration: { scope: 'https://box.example/shepherdr/' },
    addEventListener: (k: string, f: (e: unknown) => void) => void (on[k] = f),
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => undefined,
  }
  new Function('self', 'fetch', read('web/public/sw.js'))(self, (r: { url: string }) => net(r.url))
  return async (url: string, mode = 'navigate', method = 'GET') => {
    const answer: { p: Promise<Response> | null } = { p: null }
    on.fetch!({ request: { url, mode, method }, respondWith: (p: Promise<Response>) => void (answer.p = p) })
    return answer.p ? await answer.p : null
  }
}

test("the app's page with the service down: its own page that tries again, not the browser's error", async () => {
  const go = worker(() => Promise.reject(new TypeError('Failed to fetch')))
  for (const url of ['https://box.example/shepherdr/', 'https://box.example/shepherdr/?place=everything', 'https://box.example/shepherdr/index.html']) {
    const r = (await go(url))!
    expect(r.status).toBe(503)
    const html = await r.text()
    expect(html).toContain("Can't reach Shepherdr")
    expect(html).toContain('Try now')
  }
})

test('a proxy in front saying the service is gone shows it too; any other answer passes as it is', async () => {
  for (const [status, down] of [[502, true], [504, true], [522, true], [503, false], [404, false], [200, false]] as const) {
    const go = worker(() => Promise.resolve(new Response('x', { status })))
    const r = (await go('https://box.example/shepherdr/'))!
    expect(r.status).toBe(down ? 503 : status)
    if (down) expect(await r.text()).toContain("Can't reach Shepherdr")
  }
})

test('nothing else is touched: artifacts, the API, other sites, fetches that are not a page', async () => {
  const go = worker(() => Promise.reject(new TypeError('Failed to fetch')))
  expect(await go('https://box.example/shepherdr/artifacts/a1/index.html')).toBeNull()
  expect(await go('https://box.example/shepherdr/api/files/x')).toBeNull()
  expect(await go('https://box.example/other/')).toBeNull()
  expect(await go('https://box.example/shepherdr/', 'cors')).toBeNull()
  expect(await go('https://box.example/shepherdr/', 'navigate', 'POST')).toBeNull()
})

test("the title bar rules apply only in the window controls overlay; the frame keeps clear of a phone's edges", () => {
  const css = read('web/plugins/installed/installed.css')
  const wco = css.slice(css.indexOf('@media (display-mode: window-controls-overlay)'))
  expect(wco).toContain('env(titlebar-area-x')
  expect(wco).toContain('app-region: drag')
  expect(css.slice(0, css.indexOf('@media (display-mode: window-controls-overlay)'))).not.toContain('app-region')
  for (const side of ['top', 'left', 'right']) expect(css).toMatch(new RegExp(`\\.device \\{[^}]*padding-${side}: env\\(safe-area-inset-${side}\\)`))
})

/* the upstream seams this leans on (fork #34): a sync that breaks one fails here first */
test('pinned: the kernel and the tasks plugin still offer what the launches use', () => {
  const kernel = read('web/src/kernel.ts')
  expect(kernel).toMatch(/export function openLink\(href: string, step = false\)/)
  expect(kernel).toMatch(/export const launchHref = /)
  // an unknown place (the shortcuts' ?place=everything) goes to Everything
  expect(kernel).toMatch(/function stayOnShown\(\)[\s\S]{0,200}const at = here\?\.id \?\? everything\(snap\)\?\.id/)
  // ?pane=tasks opens the Tasks pane (the Needs you shortcut)
  expect(kernel).toMatch(/const paneOfUrl = [^\n]*q\.get\('pane'\)/)
  expect(read('web/plugins/tasks/client.tsx')).toMatch(/id: 'tasks\.new', title: 'New task'/)
  // the shell's columns, which the title bar's rules name
  const app = read('web/src/App.tsx')
  expect(app).toContain(`<nav className="side"`)
  expect(app).toContain(`<section key="chat" className="col chat">`)
  expect(app).toMatch(/registry\.topBars\.map[\s\S]{0,200}className=\{cx\('shell'/)
  expect(read('web/src/list.tsx')).toContain('<div className="brand">')
  expect(read('web/plugins/alerts/worker.ts')).toContain("navigator.serviceWorker.register(new URL('sw.js', base)")
})
