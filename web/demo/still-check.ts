// Still check (docs/design.md, Motion and Performance: "an idle page does no repeating visual work"): an artifact's
// waiting picture pulsed its colour for as long as it showed, about 60 style recalculations a second on a still page,
// off screen too (fork/specs/ui-polish.md, slice 2). This opens the built demo in a headless Chrome and, with nothing
// happening, measures the page's own work while its pictures are:
//   - blocked: the demo answers no picture (`?case=nopics`), so each tile waits, tries again and falls back to its
//     first lines;
//   - hung: a picture is asked for and never comes, so the tile waits for good;
//   - served: each picture on the first screen is held back while the tiles, their words and the messages around them
//     are measured, then let through; it must come in, and nothing measured may move (nor a layout shift come from it).
// In each, after the page has settled: no animation is running (document.getAnimations()), and over IDLE_S seconds the
// style recalculations and layouts stay near zero. Scenes: #shop's chat on a phone (its tile is below the first
// screen, so its picture loads lazily and waits), the Artifacts pane on a phone and a desktop, and a picture opened in
// Files (hung and served). The blocked scenes end before a tile's tries run out (RETRIES in
// web/plugins/artifacts/preview.ts); the first-lines fallback is unit-tested there.
//
//   bun run build && bun web/demo/still-check.ts [--url <a running demo>] [--json]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { chromium, type Browser, type Page, type Route } from 'playwright-core'
import { chrome } from './tap-check.ts'

/** how long a still page is watched, and the most work it may do meanwhile: a tile trying its picture again is one
 *  small redraw, never a running animation */
export const IDLE_S = 10
export const MOST = { styles: 12, layouts: 12 }

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : '')
const json = process.argv.includes('--json')

const SHOP = 'p:mac-mini:shop'
type Mode = 'blocked' | 'hung' | 'served'
type Scene = { name: string; width: number; height: number; phone: boolean; path: string; mode: Mode; files?: boolean }
const SCENES: Scene[] = []
for (const mode of ['blocked', 'hung', 'served'] as Mode[]) {
  SCENES.push({ name: `phone, #shop's chat, pictures ${mode}`, width: 390, height: 844, phone: true, path: `?place=${encodeURIComponent(SHOP)}`, mode })
  SCENES.push({ name: `phone, Artifacts, pictures ${mode}`, width: 390, height: 844, phone: true, path: `?place=${encodeURIComponent(SHOP)}&pane=artifacts`, mode })
  SCENES.push({ name: `desktop, Artifacts, pictures ${mode}`, width: 1440, height: 900, phone: false, path: `?place=${encodeURIComponent(SHOP)}&pane=artifacts`, mode })
}
// a picture opened in Files (the demo has no folder: the check answers for one, with one picture in it)
for (const mode of ['hung', 'served'] as Mode[]) {
  SCENES.push({ name: `phone, a picture in Files, ${mode}`, width: 390, height: 844, phone: true, path: `?place=${encodeURIComponent(SHOP)}&pane=files`, mode, files: true })
  SCENES.push({ name: `desktop, a picture in Files, ${mode}`, width: 1440, height: 900, phone: false, path: `?place=${encodeURIComponent(SHOP)}&pane=files`, mode, files: true })
}
/** an artifact tile's picture, and a file's own bytes in Files */
const THUMB = /\/api\/artifacts\/[^/]+\/thumb/
const FILE = /\/api\/files\?.*what=file/

async function startDemo() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', new URL('./serve.ts', import.meta.url).pathname, String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* still starting */ }
    await Bun.sleep(50)
  }
  server.kill()
  throw new Error('The built demo did not start')
}

const INIT = () => {
  try { for (const k of ['shepherdr.ui', 'shepherdr.at', 'shepherdr.drafts']) localStorage.removeItem(k) } catch { /* private */ }
  const w = window as any
  w.__shift = 0
  w.__shifts = [] as string[]
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as any[]) {
      if (e.hadRecentInput) continue
      w.__shift += e.value
      for (const s of e.sources ?? []) {
        const n = s.node as Element | null
        w.__shifts.push(n?.nodeType === 1 ? `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}` : String(n?.nodeName ?? '?'))
      }
    }
  }).observe({ type: 'layout-shift', buffered: true })
}

type Result = { name: string; fails: string[]; seen: Record<string, unknown> }

/** where the pictures' frames and what is around them sit: each tile, its picture's frame and its words, the chat's
 *  messages, a file's picture frame (in page order; named by element and first class, so a state class coming or
 *  going isn't a move) */
const where = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.tile, .tile > *, .msgs [data-msg], .ftimg')].map((e) => {
  const r = e.getBoundingClientRect()
  return { what: `${e.tagName.toLowerCase()}.${e.classList[0] ?? ''}`, at: [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 2) / 2) }
}))
const same = (a: Awaited<ReturnType<typeof where>>, b: Awaited<ReturnType<typeof where>>) => a.length === b.length && a.every((x, i) => x.what === b[i]!.what && x.at.join() === b[i]!.at.join())

// The demo starts its day over on each page load and sends it to every page open: the scenes run side by side, so each
// waits here until every page has loaded before it measures anything, or another scene's load would move its chat.
let arrived = 0
let allIn: () => void
const everyPageIn = new Promise<void>((r) => { allIn = r })
const arrive = (once: { done: boolean }) => { if (!once.done && (once.done = true) && ++arrived === SCENES.length) allIn() }

async function check(browser: Browser, base: string, s: Scene, picture: Uint8Array): Promise<Result> {
  const fails: string[] = []
  const once = { done: false }
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.phone, isMobile: s.phone, deviceScaleFactor: 2 })
  await ctx.addInitScript(INIT)
  // served: each picture is held until the page around it has been measured, then let through
  const held: Route[] = []
  let letGo = false
  const answer = (r: Route) => (s.files ? r.fulfill({ body: Buffer.from(picture), contentType: 'image/svg+xml' }) : r.continue())
  await ctx.route(s.files ? FILE : THUMB, (r) => (s.mode === 'hung' ? undefined : s.mode === 'served' && !letGo ? void held.push(r) : answer(r)))
  if (s.files) await ctx.route(/\/api\/files\?.*what=ls/, (r) => r.fulfill({ json: { entries: [{ name: 'checkout.png', kind: 'file', size: 48213 }] } }))
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m: { name: string; value: number }) => [m.name, m.value]))
  try {
    // the demo takes its case from the page's own address (and keeps it in a cookie for the pictures)
    await page.goto(`${base}${s.path}&case=${s.mode === 'blocked' ? 'nopics' : 'normal'}`, { waitUntil: 'load' })
    if (s.files) await page.locator('.row.ft', { hasText: 'checkout.png' }).click()
    await page.waitForSelector(s.files ? '.ftimg img' : '.prev', { timeout: 15000, state: 'attached' })
    arrive(once)
    await everyPageIn
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(800)
    // only shifts from here on count: the app's own start is not the pictures'
    await page.evaluate(() => { (window as any).__shift = 0; (window as any).__shifts = [] })
    let moved: string[] | null = null
    if (s.mode === 'served') {
      // a picture on the first screen asks for its picture (one below it loads lazily, once scrolled to, and keeps waiting)
      for (let i = 0; i < 40 && !held.length; i++) await page.waitForTimeout(100)
      if (held.length) {
        // the page still before the pictures come: two measures 300 ms apart that agree (the chat settles at its end)
        let before = await where(page)
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(300)
          const again = await where(page)
          if (same(before, again)) break
          before = again
        }
        letGo = true
        for (const r of held.splice(0)) await answer(r)
        const came = await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.prev img.in, .ftimg img')].some((i) => i.complete && i.naturalWidth > 0), undefined, { timeout: 10000 }).then(() => true, () => false)
        if (!came) fails.push('no picture came in after it was let through')
        await page.waitForTimeout(600)
        const after = await where(page)
        moved = before.flatMap((b, i) => (after[i]?.what === b.what && after[i]!.at.join() === b.at.join() ? [] : [`${b.what} ${b.at.join(',')} → ${after[i] ? after[i]!.at.join(',') : 'gone'}`]))
        if (before.length !== after.length) moved.push(`${before.length} measured before, ${after.length} after`)
      } else if (s.files || !s.name.includes('chat')) fails.push('no picture on the first screen asked for its picture')
    }
    await page.waitForTimeout(1200)
    const tiles = await page.evaluate(() => {
      const shown = (e: Element) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0 }
      const all = [...document.querySelectorAll('.prev')]
      return { tiles: all.length, onScreen: all.filter(shown).length, waiting: all.filter((e) => e.classList.contains('wait')).length, lazy: [...document.querySelectorAll('.prev img')].every((i) => (i as HTMLImageElement).loading === 'lazy') }
    })
    const a = await get()
    const running0 = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').map((x) => (x as CSSAnimation).animationName ?? (x as CSSTransition).transitionProperty ?? 'script'))
    await page.waitForTimeout(IDLE_S * 1000)
    const b = await get()
    const running = await page.evaluate(() => document.getAnimations().filter((x) => x.playState === 'running').map((x) => (x as CSSAnimation).animationName ?? (x as CSSTransition).transitionProperty ?? 'script'))
    const shift = await page.evaluate(() => ({ cls: +(window as any).__shift.toFixed(4), from: [...new Set((window as any).__shifts as string[])] }))
    const styles = b.RecalcStyleCount - a.RecalcStyleCount
    const layouts = b.LayoutCount - a.LayoutCount
    const seen = { ...(s.files ? {} : tiles), styles, layouts, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), running: [...new Set([...running0, ...running])], ...(moved ? { moved: moved.length } : {}) }
    if (!s.files && !tiles.tiles) fails.push('no artifact tile on the page')
    if (!s.files && !tiles.lazy) fails.push('a tile\'s picture is not loaded lazily')
    if (!s.files && s.mode === 'hung' && !tiles.waiting) fails.push('no tile waits for its picture (the hung case did not hold)')
    if (seen.running.length) fails.push(`animations running on a still page: ${seen.running.join(', ')}`)
    if (styles > MOST.styles) fails.push(`${styles} style recalculations in ${IDLE_S}s (at most ${MOST.styles})`)
    if (layouts > MOST.layouts) fails.push(`${layouts} layouts in ${IDLE_S}s (at most ${MOST.layouts})`)
    // a picture coming in takes the room its frame already held: nothing measured moved, and no shift came from it
    if (moved?.length) fails.push(`the page moved as pictures came in: ${moved.slice(0, 4).join('; ')}`)
    const fromPics = shift.from.filter((n) => /\b(prev|psk|tile|atile|plines|l1|l2|ftimg)\b|^img/.test(n))
    if (fromPics.length) fails.push(`a layout shift came from the pictures (${shift.cls}, from ${fromPics.join(', ')})`)
    return { name: s.name, fails, seen }
  } finally {
    arrive(once)
    await ctx.close()
  }
}

const demo = arg('--url') ? null : await startDemo()
const base = arg('--url') || demo!.url
const browser = await chromium.launch({ executablePath: chrome() })
const started = performance.now()
try {
  // every scene at once: each page is watched on its own, and the check takes one idle wait, not nine
  // the picture Files is answered with: one of the demo's own artifact pictures
  const picture = new Uint8Array(await (await fetch(`${base}api/artifacts/a-mock/thumb?v=2`)).arrayBuffer())
  const results = await Promise.all(SCENES.map((s) => check(browser, base, s, picture)))
  let failed = 0
  for (const r of results) {
    if (!r.fails.length) console.log(`ok    ${r.name}  ${JSON.stringify(r.seen)}`)
    else {
      failed++
      console.log(`FAIL  ${r.name}  ${JSON.stringify(r.seen)}`)
      for (const f of r.fails) console.log(`        ${f}`)
    }
  }
  if (json) console.log(JSON.stringify(results))
  const took = ((performance.now() - started) / 1000).toFixed(1)
  if (failed) {
    console.log(`still check: ${failed} of ${SCENES.length} scenes do work on a still page (${took}s)`)
    process.exitCode = 1
  } else console.log(`still check: ${SCENES.length} scenes in ${took}s; nothing animates on a still page, nothing moves as pictures load`)
} finally {
  await browser.close()
  demo?.server.kill()
}
