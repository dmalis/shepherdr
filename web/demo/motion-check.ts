// Motion check (docs/design.md, Motion: "when the device asks for less or Settings › General › Motion is Reduced,
// nothing slides, grows or spins"). About ten of the app's CSS rules followed Motion › Reduced, and list reordering,
// dragging a row, the keyboard's glide, the voice wave and a suggested reply lifting away checked only the device's
// setting (fork/specs/ui-polish.md, slice 5). This opens the built demo in a headless Chrome three times: with neither
// switch, with only the device's (prefers-reduced-motion: reduce) and with only Settings › General › Motion › Reduced,
// and in each does what people do many times a day:
//   - a desktop: opens a row's menu and closes it, folds a machine's spaces, drags a space to another place in the list
//     and taps a suggested reply;
//   - a phone: opens the Add sheet and closes it, and opens the spaces list by its button and closes it (a task opens
//     without a slide, so the list stands for a screen pushed in).
// Every animation and transition that starts is recorded (script's element.animate(), CSS animations and
// transitions, a leaving part's still copy), with what it changes. With either switch alone, none may move anything:
// no transform, translate, scale or rotate, nor a box's size or place; a fade is fine. After each step every element's
// computed transition is read too: one that would move something in more than 0 s fails. With neither switch, each
// step must move something, so the check can't pass by seeing nothing.
//
//   bun run build && bun web/demo/motion-check.ts [--url <a running demo>] [--json]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { chromium, type Browser, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : '')
const json = process.argv.includes('--json')

type Setting = 'neither' | 'device' | 'setting'
const SETTINGS: Setting[] = ['neither', 'device', 'setting']
const SHOP = 'p:mac-mini:shop'

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

/** in the page before the app: Settings' Motion, and a recorder of every animation that starts and what it changes */
const INIT = (reduced: boolean) => {
  try {
    for (const k of ['shepherdr.ui', 'shepherdr.at', 'shepherdr.drafts']) localStorage.removeItem(k)
    localStorage.setItem('shepherdr.prefs', JSON.stringify(reduced ? { motion: 'Reduced' } : {}))
  } catch { /* private */ }
  const w = window as any
  w.__seen = [] as { what: string; on: string; props: string[]; ms: number }[]
  const MOVES = /^(transform|translate|scale|rotate|width|height|minWidth|minHeight|maxWidth|maxHeight|top|left|right|bottom|inset\w*|margin\w*|padding\w*|gridTemplate\w*)$/
  const known = new WeakSet<Animation>()
  const name = (el: Element | null) => {
    if (!el) return '?'
    const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.') : ''
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${(el as HTMLElement).closest?.('[data-ghost]') ? ' (leaving copy)' : ''}`
  }
  const note = (a: Animation) => {
    if (known.has(a)) return
    known.add(a)
    const eff = a.effect as KeyframeEffect | null
    if (!eff) return
    const ms = Number(eff.getComputedTiming().duration) || 0
    if (!ms) return
    const kf = eff.getKeyframes()
    const props = new Set<string>()
    for (const k of kf) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p)
    // a value that stays the same in every keyframe changes nothing
    const moving = [...props].filter((p) => MOVES.test(p) && new Set(kf.map((k) => String((k as any)[p] ?? ''))).size > 1)
    const what = (a as CSSAnimation).animationName ? `animation ${(a as CSSAnimation).animationName}` : (a as CSSTransition).transitionProperty ? `transition ${(a as CSSTransition).transitionProperty}` : 'script'
    w.__seen.push({ what, on: name(eff.target), props: moving, ms: Math.round(ms) })
  }
  const animate = Element.prototype.animate
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
    const a = animate.apply(this, args)
    note(a)
    return a
  }
  const sweep = () => { for (const a of document.getAnimations()) note(a) }
  for (const ev of ['transitionrun', 'animationstart']) addEventListener(ev, sweep, true)
  const frame = () => { sweep(); requestAnimationFrame(frame) }
  requestAnimationFrame(frame)
  // what would move if it changed now: each element's computed transitions of a moving property
  w.__ready = () => {
    const out = new Set<string>()
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (cs.transitionProperty === 'none' || cs.transitionProperty === '') continue
      const props = cs.transitionProperty.split(',').map((s) => s.trim())
      const ds = cs.transitionDuration.split(',').map((s) => parseFloat(s) * (s.trim().endsWith('ms') ? 1 : 1000))
      props.forEach((p, i) => {
        const camel = p.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        if ((p === 'all' || MOVES.test(camel)) && (ds[i % ds.length] ?? 0) > 0) out.add(`${name(el)}: ${p} ${ds[i % ds.length]}ms`)
      })
    }
    return [...out]
  }
}

type Step = { name: string; phone: boolean; path: string; act: (p: Page) => Promise<void> }

const settle = (p: Page, ms = 700) => p.waitForTimeout(ms)
/** click what closes a layer the way a person does: its shade, or outside a menu */
async function closeLayer(p: Page) {
  const shade = p.locator('.layer .scrim, .scrim').last()
  if (await shade.count()) await shade.click({ position: { x: 8, y: 8 }, force: true }).catch(() => p.keyboard.press('Escape'))
  else await p.keyboard.press('Escape')
}

const STEPS: Step[] = [
  {
    name: "desktop, a row's menu opened and closed",
    phone: false,
    path: `?place=${encodeURIComponent(SHOP)}`,
    act: async (p) => {
      await p.locator('button[aria-label="More for blog"]').click()
      await settle(p, 500)
      await closeLayer(p)
    },
  },
  {
    name: "desktop, a machine's spaces folded",
    phone: false,
    path: `?place=${encodeURIComponent(SHOP)}`,
    act: async (p) => {
      // the machine's name folds its spaces; the rows under it glide up
      await p.locator('nav .mh .mn').nth(1).click()
      await settle(p, 500)
      await p.locator('nav .mh .mn').nth(1).click()
    },
  },
  {
    name: 'desktop, a space dragged to another place',
    phone: false,
    path: `?place=${encodeURIComponent(SHOP)}`,
    act: async (p) => {
      // shop below blog, in their group: blog makes room for it, then shop settles into its slot
      const row = p.locator(`nav [data-project="${SHOP}"] .row`).first()
      const r = (await row.boundingBox())!
      await p.mouse.move(r.x + r.width / 3, r.y + r.height / 2)
      await p.mouse.down()
      for (let i = 1; i <= 10; i++) await p.mouse.move(r.x + r.width / 3, r.y + r.height / 2 + i * 6, { steps: 2 })
      await settle(p, 300)
      await p.mouse.up()
    },
  },
  {
    name: 'desktop, a suggested reply tapped',
    phone: false,
    path: '',
    act: async (p) => {
      await p.locator('.sug').first().click()
    },
  },
  {
    name: 'phone, the Add sheet opened and closed',
    phone: true,
    path: `?place=${encodeURIComponent(SHOP)}`,
    act: async (p) => {
      await p.locator('button[aria-label="Add"]').first().tap()
      await settle(p, 600)
      await closeLayer(p)
    },
  },
  {
    name: 'phone, the spaces list opened and closed',
    phone: true,
    path: `?place=${encodeURIComponent(SHOP)}`,
    act: async (p) => {
      await p.locator('button[aria-label="Spaces"]').first().tap()
      await settle(p, 600)
      await p.locator('.edgeshade, .shade').first().tap({ position: { x: 370, y: 400 }, force: true }).catch(() => p.keyboard.press('Escape'))
    },
  },
]

type Seen = { what: string; on: string; props: string[]; ms: number }
type Result = { step: string; setting: Setting; fails: string[]; moved: string[]; ready: string[]; all: number }

async function run(browser: Browser, base: string, s: Step, setting: Setting): Promise<Result> {
  const fails: string[] = []
  const ctx = await browser.newContext({
    viewport: s.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: s.phone, isMobile: s.phone, deviceScaleFactor: 1,
    reducedMotion: setting === 'device' ? 'reduce' : 'no-preference',
  })
  await ctx.addInitScript(INIT, setting === 'setting')
  const page = await ctx.newPage()
  try {
    await page.goto(`${base}${s.path}`, { waitUntil: 'load' })
    await page.waitForSelector('.app', { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    await settle(page, 1200)
    const on = await page.evaluate(() => ({ attr: document.documentElement.dataset.motion ?? null, media: matchMedia('(prefers-reduced-motion: reduce)').matches }))
    if (setting === 'setting' && (on.attr !== 'reduced' || on.media)) fails.push(`Motion › Reduced alone was not what the page had: ${JSON.stringify(on)}`)
    if (setting === 'device' && (on.attr || !on.media)) fails.push(`the device's setting alone was not what the page had: ${JSON.stringify(on)}`)
    if (setting === 'neither' && (on.attr || on.media)) fails.push(`neither switch was meant to be on: ${JSON.stringify(on)}`)
    // from here on: what the step starts (the page's own start, and a working sign already running, count too)
    await page.evaluate(() => { (window as any).__seen = (window as any).__seen.filter((x: Seen) => x.props.length) })
    const ready: string[] = []
    const keep = async () => { for (const r of await page.evaluate(() => (window as any).__ready() as string[])) if (!ready.includes(r)) ready.push(r) }
    await keep()
    await s.act(page)
    await settle(page, 250)
    await keep()
    await settle(page, 700)
    await keep()
    const seen = (await page.evaluate(() => (window as any).__seen)) as Seen[]
    const moved = [...new Set(seen.filter((x) => x.props.length).map((x) => `${x.on}: ${x.what} (${x.props.join(', ')}, ${x.ms} ms)`))]
    if (setting === 'neither') {
      if (!moved.length) fails.push('nothing moved with neither switch on: this step no longer shows what the check is for')
    } else {
      if (moved.length) fails.push(`moved under ${setting === 'device' ? "the device's setting" : 'Motion › Reduced'}: ${moved.slice(0, 6).join('; ')}`)
      if (ready.length) fails.push(`would move under ${setting === 'device' ? "the device's setting" : 'Motion › Reduced'}: ${ready.slice(0, 6).join('; ')}`)
    }
    return { step: s.name, setting, fails, moved, ready, all: seen.length }
  } catch (e) {
    fails.push(`the step failed: ${(e as Error).message.split('\n')[0]}`)
    return { step: s.name, setting, fails, moved: [], ready: [], all: 0 }
  } finally {
    await ctx.close()
  }
}

const demo = arg('--url') ? null : await startDemo()
const base = arg('--url') || demo!.url
const browser = await chromium.launch({ executablePath: chrome() })
const started = performance.now()
try {
  // one step at a time per setting: the demo starts its day over on each page load and sends it to every page open
  const results: Result[] = []
  for (const setting of SETTINGS) for (const s of STEPS) results.push(await run(browser, base, s, setting))
  let failed = 0
  for (const r of results) {
    const head = `${r.setting.padEnd(7)}  ${r.step}`
    if (!r.fails.length) console.log(`ok    ${head}  ${r.setting === 'neither' ? `${r.moved.length} moving` : 'nothing moved'}`)
    else {
      failed++
      console.log(`FAIL  ${head}`)
      for (const f of r.fails) console.log(`        ${f}`)
    }
  }
  if (json) console.log(JSON.stringify(results))
  const took = ((performance.now() - started) / 1000).toFixed(1)
  if (failed) {
    console.log(`motion check: ${failed} of ${results.length} steps failed (${took}s)`)
    process.exitCode = 1
  } else console.log(`motion check: ${STEPS.length} steps under each of ${SETTINGS.length} settings in ${took}s; either switch alone stops every move`)
} finally {
  await browser.close()
  demo?.server.kill()
}
