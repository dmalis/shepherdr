// fork #163: the page starts without waiting in line (boot.ts), its heavy parts come when first used (later.tsx), and
// the built first screen stays under its budget (web/first-screen.ts).
import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot } from './boot.ts'
import { later, warmLater } from './later.tsx'
import type { ClientPlugin } from './kernel.ts'
import { firstScreen, LIMIT } from '../first-screen.ts'

const plugin = (name: string): ClientPlugin => ({ name, setup: () => undefined }) as ClientPlugin

test('api/me and the link go out before any plugin has loaded; plugins load side by side, install in order', async () => {
  const seen: string[] = []
  const waiting: (() => void)[] = []
  const slow = (name: string) => ({
    name,
    load: () => {
      seen.push(`load ${name}`)
      return new Promise<{ default: ClientPlugin }>((ok) => waiting.push(() => ok({ default: plugin(name) })))
    },
  })
  let installed: string[] = []
  let enabled: string[] = []
  const done = boot({
    plugins: [plugin('chat'), slow('voice'), slow('screens')],
    enabled: ['chat', 'voice', 'screens'],
    user: [],
    me: () => (seen.push('me'), Promise.resolve(new Response(JSON.stringify({ off: ['screens'] })))),
    connect: () => void seen.push('connect'),
    install: (ps, en) => ((installed = ps.map((p) => p.name)), (enabled = en)),
  })
  // nothing has come back yet, and both lazy plugins are already asked for, side by side
  expect(seen).toEqual(['me', 'connect', 'load voice', 'load screens'])
  expect(installed).toEqual([])
  waiting.reverse().forEach((go) => go())
  expect(await done).toEqual(['screens'])
  // the list's order, and a plugin switched off is neither installed nor enabled
  expect(installed).toEqual(['chat', 'voice'])
  expect(enabled).toEqual(['chat', 'voice'])
  expect((globalThis as { shepherdrOff?: string[] }).shepherdrOff).toEqual(['screens'])
})

test('a plugin that fails to load is left out, and the link being down leaves every plugin on', async () => {
  let installed: string[] = []
  const off = await boot({
    plugins: [plugin('chat'), { name: 'broken', load: () => Promise.reject(new Error('gone')) }],
    enabled: ['chat', 'broken'],
    user: [],
    me: () => Promise.reject(new Error('offline')),
    connect: () => undefined,
    install: (ps) => void (installed = ps.map((p) => p.name)),
  })
  expect(off).toEqual([])
  expect(installed).toEqual(['chat'])
})

test('the link’s snapshot, come while the plugins loaded, says which are off; a call asked for meanwhile starts once Voice is in', async () => {
  let installed: string[] = []
  let woke = 0
  const off = await boot({
    plugins: [plugin('chat'), { name: 'voice', setup: (reg: { voiceWake: (() => void) | null }) => void (reg.voiceWake = () => void woke++) } as unknown as ClientPlugin],
    enabled: ['chat', 'voice'],
    user: [],
    // api/me failed, but the first snapshot said Voice is off
    me: () => Promise.reject(new Error('offline')),
    connect: () => undefined,
    live: () => ['voice'],
    install: (ps) => void (installed = ps.map((p) => p.name)),
    woke: () => true,
  })
  expect(off).toEqual(['voice'])
  expect(installed).toEqual(['chat'])
  // with Voice on, the early call reaches it once it is installed (the real install fills the registry)
  const kernel = await import('./kernel.ts')
  kernel.registry.voiceWake = null
  await boot({
    plugins: [plugin('voice')],
    enabled: ['voice'],
    user: [],
    me: () => Promise.resolve(new Response('{}')),
    connect: () => undefined,
    live: () => [],
    install: () => void (kernel.registry.voiceWake = () => void woke++),
    woke: () => true,
  })
  expect(woke).toBe(1)
  kernel.registry.voiceWake = null
})

test('the idle warm-up fetches the app’s parts and those of plugins that are on, never a switched-off plugin’s', async () => {
  const asked: string[] = []
  later(() => (asked.push('app'), Promise.resolve(1)))
  later(() => (asked.push('voice'), Promise.resolve(1)), 'voice')
  later(() => (asked.push('screens'), Promise.resolve(1)), 'screens')
  warmLater(['screens'], 0)
  await new Promise((r) => setTimeout(r, 400))
  expect(asked).toEqual(['app', 'voice'])
})

test('a later part is fetched once, kept, and fetched again after a failure', async () => {
  let asked = 0
  let fail = true
  const part = later(() => (asked++, fail ? Promise.reject(new Error('offline')) : Promise.resolve({ n: 1 })))
  expect(part()).toBeUndefined()
  await expect(part.load()).rejects.toThrow('offline')
  expect(part()).toBeUndefined()
  fail = false
  const [a, b] = await Promise.all([part.load(), part.load()])
  expect(a).toEqual({ n: 1 })
  expect(b).toBe(a)
  expect(part()).toBe(a)
  expect(asked).toBe(2)
})

// the seams: start() goes through boot, and each heavy view is reached only through import()
test('pinned: the heavy views are fetched by import(), never imported where the first screen starts', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  expect(read('./main.tsx')).toContain("await boot({ plugins, enabled, user, me: () => fetch('api/me'), connect })")
  expect(read('./App.tsx')).toContain("laterView(() => import('./settings.tsx').then((m) => m.SettingsWindow)")
  expect(read('./App.tsx')).not.toMatch(/from '\.\/settings\.tsx'/)
  expect(read('./picker.tsx')).toContain("later(() => import('./picker-sheet.tsx'))")
  // a failed Settings closes, so no empty scrim is left over the app
  expect(read('./App.tsx')).toContain("m.SettingsWindow), () => setUI({ settings: null }))")
  // what must run inside a tap stays in the first script: the microphone's and the call's audio
  expect(read('./dictate.tsx')).toMatch(/^import \{[^}]*\bdictate\b[^}]*\} from '\.\/dictation\.ts'/m)
  const voice = read('../plugins/voice/client.tsx')
  expect(voice).toMatch(/^import \{[^}]*\bstartCall\b[^}]*\} from '\.\/call\.ts'/m)
  expect(voice).toContain("later(() => import('./screen.ts'), 'voice')")
  expect(voice).not.toMatch(/^import \{[^}]*\} from '\.\/screen\.ts'/m)
  const screens = read('../plugins/screens/client.tsx')
  expect(screens).toContain("later(() => import('./pane.tsx'), 'screens')")
  // Take over waits for the Screen view, so Hand back is there once you drive
  expect(screens).toContain("onClick={() => void pane.load().then(() => { openScreen(k, true); void act(k, 'take'")
  // the kernel keeps a call asked for before the plugins were in
  expect(read('./kernel.ts')).toContain('if (!(window as { shepherdrOff?: string[] }).shepherdrOff) wokeEarly = true')
  // xterm's stylesheet comes with the terminal
  expect(read('./styles.css')).not.toContain('xterm.css')
  expect(read('../plugins/terminal/xterm.ts')).toContain("import '@xterm/xterm/css/xterm.css'")
  // no other part of the app takes Settings' rows from the window itself
  for (const f of ['../plugins/search/client.tsx', '../plugins/alerts/space.tsx', '../plugins/shortcuts/client.tsx', '../plugins/voice/settings.tsx', '../plugins/analytics/client.tsx'])
    expect(read(f)).not.toMatch(/from '@client\/settings\.tsx'/)
})

test('the size check counts the page’s module script and what it imports, sent compressed, not what comes later', () => {
  const dist = mkdtempSync(join(tmpdir(), 'first-screen-'))
  mkdirSync(join(dist, 'assets'))
  const put = (f: string, body: string, br?: number) => {
    writeFileSync(join(dist, f), body)
    if (br) writeFileSync(join(dist, f + '.br'), 'x'.repeat(br))
  }
  put('index.html', '<script type="module" crossorigin src="./assets/index-a.js"></script><link rel="modulepreload" crossorigin href="./assets/pre-b.js">')
  put('assets/index-a.js', 'import{a as b}from"./shared-c.js";import"./pre-b.js";const s=()=>import("./later-d.js");', 100)
  put('assets/pre-b.js', 'export const x=1', 10)
  put('assets/shared-c.js', 'export{y as a}from"./deep-e.js"', 20)
  put('assets/deep-e.js', 'export const y=2')
  put('assets/later-d.js', 'x'.repeat(999), 999)
  const r = firstScreen(dist)
  expect(r.chunks.map((c) => c.file).sort()).toEqual(['assets/deep-e.js', 'assets/index-a.js', 'assets/pre-b.js', 'assets/shared-c.js'])
  // a file without a brotli copy counts as it is
  expect(r.br).toBe(100 + 10 + 20 + 'export const y=2'.length)
  expect(LIMIT).toBeLessThan(250 * 1024)
})
