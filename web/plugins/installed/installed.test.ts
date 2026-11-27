// fork #34: the installed app. Launches (shortcuts, links Chrome opens in the app) reach the window already open; the
// four manifests carry the same shortcuts and title bar; the service worker's "Can't reach Shepherdr" page covers only
// the app's own address; and the upstream seams this leans on are still there.
import { expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { launchOf, launches, wantsCall, wantsNeeds, wantsNewTask, withoutAsks } from './launch.ts'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const APP = 'https://box.example/shepherdr/'

function page(loaded: string) {
  const did: string[] = []
  let t = 1000
  const launch = launches({
    loaded,
    here: () => loaded,
    open: (href) => did.push(`open ${href}`),
    away: (href) => did.push(`away ${href}`),
    newTask: () => did.push('new task'),
    needs: () => did.push('needs you'),
    call: () => did.push('call'),
    now: () => t,
  })
  return { did, launch, later: (ms: number) => void (t += ms) }
}

test("the page's own launch is let go; a later one goes where it points", () => {
  const p = page(`${APP}?place=sp2`)
  p.launch(`${APP}?place=sp2`)
  expect(p.did).toEqual([])
  p.later(60_000)
  p.launch(`${APP}?place=everything&pane=tasks`)
  expect(p.did).toEqual([`open ${APP}?place=everything&pane=tasks`])
})

test('a launch to another address right after loading still goes there', () => {
  const p = page(APP)
  p.launch(`${APP}?task=SHOP-2`)
  expect(p.did).toEqual([`open ${APP}?task=SHOP-2`])
})

test('a launch right after a reload still goes where it points (Chrome no longer replays the last one)', () => {
  const p = page(`${APP}?place=sp2&task=SHOP-2`)
  p.launch(`${APP}?new=task`)
  expect(p.did).toEqual(['new task'])
})

test('the same address launched again later (the shortcut used twice) goes there again', () => {
  const p = page(`${APP}?place=everything`)
  p.launch(`${APP}?place=everything`)
  p.later(10_000)
  p.launch(`${APP}?place=everything`)
  expect(p.did).toEqual([`open ${APP}?place=everything`])
})

test("the icon (the bare start address) only brings the window forward: the task on screen stays", () => {
  const p = page(`${APP}?task=SHOP-2`)
  p.later(60_000)
  p.launch(APP)
  p.launch(`${APP}index.html`)
  expect(p.did).toEqual([])
  expect(launchOf(APP, `${APP}?task=SHOP-2`)).toEqual({ kind: 'focus' })
})

test('New task asks for one where you are; Needs you opens Tasks on its group; a launch without an address does nothing', () => {
  const p = page(APP)
  p.later(60_000)
  p.launch(null)
  p.launch(`${APP}?new=task`)
  p.launch(`${APP}?place=everything&pane=tasks&show=needs-you`)
  expect(p.did).toEqual(['new task', `open ${APP}?place=everything&pane=tasks`, 'needs you'])
  expect(wantsNewTask('./?new=task')).toBe(true)
  expect(wantsNewTask('./?new=space')).toBe(false)
  expect(wantsNeeds('./?show=needs-you')).toBe(true)
  expect(withoutAsks(`${APP}?new=task&place=sp2`)).toBe('/shepherdr/?place=sp2')
  expect(withoutAsks(`${APP}?place=everything&pane=tasks&show=needs-you`)).toBe('/shepherdr/?place=everything&pane=tasks')
  expect(withoutAsks(APP)).toBeNull()
})

test("a captured call link starts the call; an artifact's page opens in Artifacts; any other address opens on its own", () => {
  const p = page(APP)
  p.later(60_000)
  p.launch(`${APP}?voice=1`)
  p.launch(`${APP}api/artifacts/a1/v/2/k/0123456789abcdef/page/index.html`)
  p.launch(`${APP}api/artifacts/b2/page`)
  const file = `${APP}api/files/x`
  p.launch(file)
  const remote = `${APP}api/artifacts/c3/v/1/on/box2/k/0123456789abcdef/page/`
  p.launch(remote)
  expect(p.did).toEqual(['call', `open ${APP}?artifact=a1`, `open ${APP}?artifact=b2`, `away ${file}`, `away ${remote}`])
  expect(wantsCall('./?voice=1')).toBe(true)
  expect(wantsCall('./?voice=0')).toBe(false)
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

test('a proxy in front saying the service is gone shows it too; any other answer (a certificate or DNS error too) passes as it is', async () => {
  for (const [status, down] of [[502, true], [504, true], [522, true], [503, false], [526, false], [530, false], [404, false], [200, false]] as const) {
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
  // a form sheet keeps its own 16px sides, the safe area added on top
  expect(css).toMatch(/\.app \.sheet\.form \{[^}]*padding-left: calc\(16px \+ env\(safe-area-inset-left\)\)/)
})

test("an iPhone's home screen: the top row is pinned, so iOS draws no blur over it; nothing else moves", () => {
  const css = read('web/plugins/installed/installed.css')
  // no guessed band below the status bar: the clear top is the safe area alone, everywhere
  expect(css).not.toContain('--safe-top')
  expect(css).not.toMatch(/\d+PX/)
  // only installed on an iPhone (standalone, WebKit's touch-callout) and only a phone's one column: a browser tab,
  // Android and a desktop window never take it
  const at = css.indexOf('@media (display-mode: standalone) {\n  @supports (-webkit-touch-callout: none) {')
  expect(at).toBeGreaterThan(-1)
  const block = css.slice(at, css.indexOf('\n}\n', at))
  const hd = '.app.phone .device > .shell:not(.device > :not(.upchip) ~ .shell) > section.col > .hd:first-child'
  const line = '.app.phone .device > .tline:not(.device > :not(.upchip) ~ *)'
  // WebKit hides its soft top edge effect for a fixed or sticky element at the very top, as wide as the screen, more
  // than 10px tall, with a background: the header (or a line above it), on the canvas it already sits on
  // a full-screen layer keeps the colour the status bar already has (WebKit prefers it for a screen-sized layer), so
  // the picture viewer pins its own bar: dark over the viewer, not the header's light
  const lbar = '.app.phone .lbox > .lbar:first-child'
  expect(block).toContain(`${line},\n    ${hd},\n    ${lbar} {\n      position: sticky;\n      top: 0;\n    }`)
  expect(block).toContain(`${hd} {\n      background: var(--canvas);\n    }`)
  // the viewer's bar names its colour (WebKit would otherwise sample, and keep, the light page as the viewer fades in),
  // painted only under its own white text, so the viewer looks as before
  expect(block).toContain(`${lbar} {\n      background-color: #000;\n      -webkit-background-clip: text;\n      background-clip: text;\n    }`)
  expect(read('web/src/ds.css')).toContain('.lname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')
  expect(read('web/src/ds.css')).toMatch(/\.lbox\{position:fixed;inset:0;[^}]*color:#fafafa;/)
  expect(block).not.toMatch(/backdrop-filter|opacity|z-index|padding|margin|height/)
  // nothing else pins or moves the top: the rest of the sheet keeps only the safe area on top
  expect(css.replace(block, '')).not.toMatch(/position: (sticky|fixed)/)
})

/* the upstream seams the pinned top leans on: a sync that changes one fails here first */
test('pinned: the page never scrolls, the header is a plain row on the canvas, a line on top has its own colour', () => {
  const ds = read('web/src/ds.css')
  const up = read('web/src/styles.css')
  // sticky doesn't move it: the page itself doesn't scroll (each column scrolls inside)
  expect(ds).toContain('html,body{height:100%}body{padding:0;overflow:hidden}')
  // the canvas behind the header is the page's own: nothing between them paints a background
  expect(ds).toMatch(/body\{margin:0;background:var\(--canvas\)/)
  expect(ds).toContain('.hd{display:flex;align-items:center;gap:4px;height:var(--hd);padding:0 12px;flex:none;min-width:0}')
  for (const r of [/\.device\{[^}]*\}/g, /\.col\{[^}]*\}/g, /\.shell\{[^}]*\}/g]) for (const m of ds.match(r) ?? []) expect(m).not.toContain('background')
  // a line on top paints its own colour, and the header's buttons keep their own boxes (a sticky header holds them)
  expect(up).toMatch(/\.tline\{[^}]*background:var\(--raised\)/)
  expect(ds).toMatch(/button\{position:relative;/)
  // the phone's column and header are the ones the rule names
  const app = read('web/src/App.tsx')
  // the chat's header is its column's first child, the viewer's bar its first
  expect(app).toMatch(/<section className="col chat"[^>]*>\s*<ChatHeader /)
  expect(read('web/plugins/chat/thumbs.tsx')).toMatch(/openDialog\(\s*\(close\) => \(\s*<>\s*<div className="lbar">/)
  expect(read('web/src/overlay.tsx')).toContain("className={layer.view ? 'lbox in'")
  expect(app).toContain('<section className="col pane"')
  expect(app).toMatch(/<div className="device">\s*\{registry\.topBars\.map/)
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
  // the Needs you shortcut: Tasks on Now, its group by that name, opened through ui.open; a call through voiceWake
  const tasks = read('web/plugins/tasks/client.tsx')
  expect(tasks).toContain("const o = ui.open[g.name] ?? !['Done', 'Archived'].includes(g.name)")
  expect(tasks).toContain("g.name === 'Needs you'")
  expect(kernel).toContain("tab: 'Now' | 'Scheduled'")
  expect(kernel).toMatch(/voiceWake: \(\(\) => void\) \| null/)
  expect(read('web/src/applink.ts')).toMatch(/export function appLink\(href: string, here: string\): URL \| null/)
  // the shell's columns, which the title bar's rules name
  const app = read('web/src/App.tsx')
  expect(app).toContain(`<nav className="side"`)
  expect(app).toContain(`<section key="chat" className="col chat">`)
  expect(app).toMatch(/registry\.topBars\.map[\s\S]{0,200}className=\{cx\('shell'/)
  expect(read('web/src/list.tsx')).toContain('<div className="brand">')
  expect(read('web/plugins/alerts/worker.ts')).toContain("navigator.serviceWorker.register(new URL('sw.js', base)")
})
