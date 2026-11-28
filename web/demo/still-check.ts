// Still check (docs/design.md, Motion and Performance: "an idle page does no repeating visual work"): an artifact's
// waiting picture pulsed its colour for as long as it showed, about 60 style recalculations a second on a still page,
// off screen too (fork/specs/ui-polish.md, slice 2). This opens the built demo in a headless Chrome and, with nothing
// happening, measures the page's own work while its pictures are:
//   - blocked: the demo answers no picture (`?case=nopics`), so each tile waits, tries again and falls back to its
//     first lines;
//   - hung: a picture is asked for and never comes, so the tile waits for good;
//   - served: the pictures load, and nothing on the page moves as they do (no layout shift).
// In each, after the page has settled: no animation is running (document.getAnimations()), and over IDLE_S seconds the
// style recalculations and layouts stay near zero. Scenes: #shop's chat on a phone (its tile is below the first
// screen, so its picture loads lazily and waits), and the Artifacts pane on a phone and a desktop.
//
//   bun run build && bun web/demo/still-check.ts [--url <a running demo>] [--json]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { chromium, type Browser } from 'playwright-core'
import { chrome } from './tap-check.ts'

/** how long a still page is watched, and the most work it may do meanwhile: a tile trying its picture again is one
 *  small redraw, never a running animation */
export const IDLE_S = 10
export const MOST = { styles: 12, layouts: 12 }

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : '')
const json = process.argv.includes('--json')

const SHOP = 'p:mac-mini:shop'
type Mode = 'blocked' | 'hung' | 'served'
type Scene = { name: string; width: number; height: number; phone: boolean; path: string; mode: Mode }
const SCENES: Scene[] = []
for (const mode of ['blocked', 'hung', 'served'] as Mode[]) {
  SCENES.push({ name: `phone, #shop's chat, pictures ${mode}`, width: 390, height: 844, phone: true, path: `?place=${encodeURIComponent(SHOP)}`, mode })
  SCENES.push({ name: `phone, Artifacts, pictures ${mode}`, width: 390, height: 844, phone: true, path: `?place=${encodeURIComponent(SHOP)}&pane=artifacts`, mode })
  SCENES.push({ name: `desktop, Artifacts, pictures ${mode}`, width: 1440, height: 900, phone: false, path: `?place=${encodeURIComponent(SHOP)}&pane=artifacts`, mode })
}

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

async function check(browser: Browser, base: string, s: Scene): Promise<Result> {
  const fails: string[] = []
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: s.phone, isMobile: s.phone, deviceScaleFactor: 2 })
  await ctx.addInitScript(INIT)
  if (s.mode === 'hung') await ctx.route(/\/api\/artifacts\/[^/]+\/thumb/, () => { /* never answered */ })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const get = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m: { name: string; value: number }) => [m.name, m.value]))
  try {
    // the demo takes its case from the page's own address (and keeps it in a cookie for the pictures)
    await page.goto(`${base}${s.path}&case=${s.mode === 'blocked' ? 'nopics' : 'normal'}`, { waitUntil: 'load' })
    await page.waitForSelector('.prev', { timeout: 15000, state: 'attached' })
    // settled: the first screen drawn, the served pictures in, the first fade over
    // (a tile below the first screen keeps waiting: its picture loads lazily, once it is scrolled to)
    if (s.mode === 'served') await page.waitForLoadState('networkidle')
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
    const seen = { ...tiles, styles, layouts, taskMs: Math.round((b.TaskDuration - a.TaskDuration) * 1000), running: [...new Set([...running0, ...running])], shift }
    if (!tiles.tiles) fails.push('no artifact tile on the page')
    if (!tiles.lazy) fails.push('a tile\'s picture is not loaded lazily')
    if (s.mode === 'hung' && !tiles.waiting) fails.push('no tile waits for its picture (the hung case did not hold)')
    if (seen.running.length) fails.push(`animations running on a still page: ${seen.running.join(', ')}`)
    if (styles > MOST.styles) fails.push(`${styles} style recalculations in ${IDLE_S}s (at most ${MOST.styles})`)
    if (layouts > MOST.layouts) fails.push(`${layouts} layouts in ${IDLE_S}s (at most ${MOST.layouts})`)
    // a picture coming in takes the room its frame already held
    const tileShift = shift.from.filter((n) => /\b(prev|tile|atile|plines)\b|^img/.test(n))
    if (tileShift.length) fails.push(`the page moved as pictures came in (layout shift ${shift.cls}, from ${tileShift.join(', ')})`)
    return { name: s.name, fails, seen }
  } finally {
    await ctx.close()
  }
}

const demo = arg('--url') ? null : await startDemo()
const base = arg('--url') || demo!.url
const browser = await chromium.launch({ executablePath: chrome() })
const started = performance.now()
try {
  // every scene at once: each page is watched on its own, and the check takes one idle wait, not nine
  const results = await Promise.all(SCENES.map((s) => check(browser, base, s)))
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
