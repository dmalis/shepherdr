// Reading check (fork #144): reading back through a chat on a phone, end to end, in a real browser. Opens the built
// demo in a headless Chrome whose only pointer is a finger, at 390 px, in a space's chat (#shop) and a task's thread
// (SHOP-15), and in each:
//   - scrolling back toward older messages: the bottom tabs go, the box folds to one row and the chat gets the room,
//     with the chat's view not moved by it (the same scroll position, the same top);
//   - a small scroll toward the newest message, a tap on the chat, focus in the box: all back;
//   - what it costs, counted by Chrome rather than timed, so a slow runner can't fail it: the drag back with its
//     switch and slide a few layouts and long tasks, not one a scroll frame; the switch a few layouts, the slide none;
//   - with text in the box: nothing steps aside;
//   - one big jump back from the newest message: the chat stays where it went (not pulled back to its end);
//   - Motion Reduced: the switch is instant (no animation runs);
// and at a desktop's width with a mouse: nothing changes. A scene reports every break it finds.
//
//   bun run build && bun web/demo/reading-check.ts [--shots <dir>] [--video <dir>] [--cpu <n>]
//
// --shots keeps a picture of each state, light and dark; --video records the 390 px scroll up, down and a tap;
// --cpu runs every page n times slower (Chrome's CPU throttling), to see that the counts don't change with speed.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, type Browser, type CDPSession, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : '')
const shots = arg('--shots')
const video = arg('--video')
const cpu = Number(arg('--cpu')) || 1
for (const d of [shots, video]) if (d) mkdirSync(d, { recursive: true })

const TALL = 844
/** the most layouts a switch's step may take, and its slide after it (see the end of check()) */
const SWITCH = 6
const SLIDING = 2
/** the most layouts, and long tasks, the first 700 px drag back may take, its switch and slide included */
const DRAG = 15
const LONG = 6

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

type Scene = { where: 'space' | 'task'; width: number; phone: boolean; dark?: boolean; reduced?: boolean; record?: boolean }

/** what the page shows now: is it reading, the tabs, the box's height, the chat's height and place */
const state = (page: Page) =>
  page.evaluate(() => {
    const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length && e.parentElement!.querySelector(':scope > .foot > .cbox'))!
    const bar = document.querySelector<HTMLElement>('.app .bar')
    const cbox = sc.parentElement!.querySelector<HTMLElement>(':scope > .foot > .cbox')!
    const seen = (e: HTMLElement | null) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().top < innerHeight - 1
    return {
      reading: document.documentElement.classList.contains('reading'),
      tabs: seen(bar),
      box: Math.round(cbox.getBoundingClientRect().height),
      chat: sc.clientHeight,
      top: sc.scrollTop,
      end: sc.scrollHeight - sc.clientHeight - sc.scrollTop,
      sctop: Math.round(sc.getBoundingClientRect().top),
      /** every scroll and every change of the mark, in order, with where the chat's view was (the page logs them) */
      log: (window as unknown as { __log: string[] }).__log.slice(),
    }
  })

/** scrolls the chat by `dy` in small steps, as a finger's drag does: two frames a step, all inside the page (one
 *  round trip a drag keeps the CI job inside its time) */
async function drag(page: Page, dy: number) {
  await page.evaluate(async (dy) => {
    ;(window as unknown as { __log: string[] }).__log.length = 0
    const step = dy < 0 ? -20 : 20
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    for (let moved = 0; Math.abs(moved) < Math.abs(dy); moved += step) {
      const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length && e.parentElement!.querySelector(':scope > .foot > .cbox'))!
      sc.scrollTop += step
      await frame()
    }
  }, dy)
  await page.waitForTimeout(400)
}

/** the layouts the page has done so far (Chrome's own count: the same on a fast machine and a slow one) */
async function layouts(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const n = metrics.find((m) => m.name === 'LayoutCount')?.value
  if (n == null) throw new Error("Chrome gave no LayoutCount (Performance.enable first): the layout counts can't be read")
  return n
}

/** drag(), counting what it cost: its layouts, and its long tasks (the page logs them from its start). A switch is
 *  one style and layout of the page, a long task of its own on a slow runner; what repeats on the scroll frames, a
 *  layout or a script, counts once a frame. */
async function dragCost(page: Page, cdp: CDPSession, dy: number) {
  const before = await layouts(cdp)
  const t0 = await page.evaluate(() => performance.now())
  await drag(page, dy)
  const n = (await layouts(cdp)) - before
  const long = await page.evaluate((t0) => (window as unknown as { __long: [number, number][] }).__long.filter(([at, d]) => at + d > t0).map(([, d]) => Math.round(d)), t0)
  return { layouts: n, long }
}

/** What a switch costs, by count: drag steps (as drag()'s) only until the mark flips, then still while the box and
 *  the tabs slide. `step`: the layouts of the step that flipped it (the switch's own, the box's text refitted, its
 *  first frame); `slide`: those in the half second after, while they move. A drag's scroll steps lay out nothing
 *  here, so holding still counts the slide as a drag would. */
async function slide(page: Page, cdp: CDPSession, dy: number) {
  let before = await layouts(cdp)
  for (let moved = 0; Math.abs(moved) < Math.abs(dy); moved += 20) {
    const flipped = await page.evaluate(async (step) => {
      const root = document.documentElement
      const was = root.classList.contains('reading')
      const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length && e.parentElement!.querySelector(':scope > .foot > .cbox'))!
      sc.scrollTop += step
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
      return root.classList.contains('reading') !== was
    }, dy < 0 ? -20 : 20)
    const after = await layouts(cdp)
    if (flipped) {
      await page.waitForTimeout(500)
      return { step: after - before, slide: (await layouts(cdp)) - after }
    }
    before = after
  }
  return null
}

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.where} ${s.width}px${s.phone ? '' : ' mouse'}${s.dark ? ' dark' : ''}${s.reduced ? ' reduced' : ''}`
  const fails: string[] = []
  const counts: string[] = []
  const expect = (ok: boolean, what: string) => ok || fails.push(what)
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.phone ? TALL : 800 },
    hasTouch: s.phone,
    isMobile: s.phone,
    deviceScaleFactor: 2,
    colorScheme: s.dark ? 'dark' : 'light',
    reducedMotion: 'no-preference',
    ...(s.record && video ? { recordVideo: { dir: video, size: { width: s.width, height: TALL } } } : {}),
  })
  try {
    if (s.reduced) await ctx.addInitScript(() => localStorage.setItem('shepherdr.prefs', JSON.stringify({ motion: 'Reduced' })))
    // the chat's view at every scroll and at every change of the mark, to see the mark never moves it
    await ctx.addInitScript(() => {
      const log: string[] = ((window as unknown as { __log: string[] }).__log = [])
      const where = () => {
        const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length)
        return sc ? `${sc.scrollTop}@${Math.round(sc.getBoundingClientRect().top)}` : ''
      }
      document.addEventListener('scroll', () => log.push(`scroll ${where()}`), true)
      // what moves the box or the tabs: the box's slide (an animation on the foot) and the tabs' (a transition that lasts);
      // not what fades in inside the foot (upstream's ↓ button)
      const moving = () =>
        document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.matches?.('.foot, .bar')).length +
        [...document.querySelectorAll('.app .bar')].filter((b) => parseFloat(getComputedStyle(b).transitionDuration) > 0).length
      addEventListener('DOMContentLoaded', () =>
        new MutationObserver(() => log.push(`${document.documentElement.classList.contains('reading') ? 'on' : 'off'} ${where()} ${moving()}`)).observe(document.documentElement, { attributeFilter: ['class'] }),
      )
    })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Performance.enable')
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
    page.setDefaultTimeout(8000)
    await page.goto(s.where === 'task' ? `${base}?task=SHOP-15` : `${base}?place=${encodeURIComponent('p:mac-mini:shop')}`)
    await page.locator('.cbox textarea.cin >> visible=true').first().waitFor()
    // the analytics note on top is the demo's own: out of the way
    await page.evaluate(() => document.querySelector<HTMLElement>('.anote button[aria-label="Dismiss"], .anote .x')?.click())
    await page.waitForTimeout(300)
    const shot = async (what: string) => shots && page.screenshot({ path: `${shots}/${`${name} ${what}`.replace(/[^\w]+/g, '-')}.png` })
    // every long task from here, with when it started (dragCost() takes a drag's)
    await page.evaluate(() => {
      const w = window as unknown as { __long: [number, number][] }
      w.__long = []
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push([e.startTime, e.duration]))).observe({ type: 'longtask' })
    })
    const at = await state(page)
    expect(!at.reading && (at.tabs || !s.phone), `${name}: at the newest message, the tabs are there (${JSON.stringify(at)})`)
    await shot('1 newest')

    const cost = await dragCost(page, cdp, -700)
    const up = await state(page)
    if (!s.phone) {
      expect(!up.reading, `${name}: a mouse window never steps aside`)
      return { name, fails, counts }
    }
    expect(up.reading, `${name}: scrolled back 700px, it reads (${JSON.stringify(up)})`)
    // the whole drag back, its switch and the slide while it goes on scrolling: a few layouts and at most the
    // switch's own long tasks and a few of the chat's, not one a scroll frame (35 steps, 70 frames)
    counts.push(`700px drag ${cost.layouts}${cost.long.length ? `, long tasks ${cost.long.join(' ')} ms` : ''}`)
    expect(cost.layouts <= DRAG && cost.long.length <= LONG, `${name}: the drag back is at most ${DRAG} layouts and ${LONG} long tasks (${cost.layouts}; ${cost.long.join(', ') || 'none'})`)
    expect(!up.tabs, `${name}: the tabs stepped aside`)
    expect(up.box < at.box, `${name}: the box folded to one row (${at.box} -> ${up.box})`)
    expect(up.chat - at.chat >= 100, `${name}: the chat got at least 100px more (${at.chat} -> ${up.chat})`)
    // still past the jump-to-newest button's line: its ↓ stays
    expect(up.end > 240 && (await page.locator('.toend >> visible=true').count()) === 1, `${name}: the jump-to-newest button stays (${up.end}px from the end)`)
    // the mark changed nothing of the chat's view: the same position and top as the scroll just before it
    const i = up.log.findIndex((l) => l.startsWith('on '))
    expect(i > 0 && up.log[i]!.split(' ')[1] === up.log[i - 1]!.split(' ')[1], `${name}: the chat's view did not move as it stepped aside (${up.log.join(' | ')})`)
    if (s.reduced) expect(i >= 0 && up.log[i]!.endsWith(' 0'), `${name}: Motion Reduced, nothing animates (${up.log[i]})`)
    else expect(i >= 0 && !up.log[i]!.endsWith(' 0'), `${name}: the box and the tabs slide (${up.log[i]})`)
    await shot('2 reading')

    await drag(page, 40)
    const down = await state(page)
    expect(!down.reading && down.tabs, `${name}: a small scroll toward the newest message brings them back (${JSON.stringify(down)})`)
    const j = down.log.findIndex((l) => l.startsWith('off '))
    expect(j > 0 && down.log[j]!.split(' ')[1] === down.log[j - 1]!.split(' ')[1], `${name}: the chat's view did not move as they came back (${down.log.join(' | ')})`)
    await shot('3 back')

    await drag(page, -200)
    expect((await state(page)).reading, `${name}: reading again`)
    // a tap on the chat (a time line: no menu of its own)
    await page.locator(':is(.chat, .pane) > .scroll .time >> visible=true').first().tap()
    await page.waitForTimeout(400)
    expect(!(await state(page)).reading, `${name}: a tap brings them back`)

    await drag(page, 300)
    await drag(page, -300)
    expect((await state(page)).reading, `${name}: reading once more`)
    await page.locator('.cbox textarea.cin >> visible=true').first().evaluate((t) => (t as HTMLTextAreaElement).focus())
    await page.waitForTimeout(400)
    expect(!(await state(page)).reading, `${name}: focus in the box brings them back`)

    // text in the box: nothing steps aside
    await page.locator('.cbox textarea.cin >> visible=true').first().fill('a draft')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await drag(page, -300)
    expect(!(await state(page)).reading, `${name}: with text in the box nothing steps aside`)

    // one big jump back from the newest message (a fling's first step, Page Up): it stays where it went, the chat no
    // longer pinned to its end, and reads
    await page.locator('.cbox textarea.cin >> visible=true').first().fill('')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.evaluate(() => {
      const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length && e.parentElement!.querySelector(':scope > .foot > .cbox'))!
      sc.scrollTop = sc.scrollHeight
    })
    await page.waitForTimeout(400)
    const jumped = await page.evaluate(() => {
      const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length && e.parentElement!.querySelector(':scope > .foot > .cbox'))!
      sc.scrollTop -= 900
      return sc.scrollTop
    })
    await page.waitForTimeout(400)
    const after = await state(page)
    expect(after.reading && after.top === jumped, `${name}: one big jump back stays where it went and reads (${jumped} -> ${JSON.stringify(after)})`)

    // What a switch costs the main thread, both ways, as counts: its step (today 3 or 4 layouts) and nothing per frame
    // while the box and the tabs slide (today 1 as the slide ends, 0 with Motion Reduced). A slide drawn with layout
    // (a margin, height or top that moves, or a script that sizes and measures each frame) lays out every frame,
    // 13 to 24 times here at normal speed and 10x slower: well past the bar on any runner. Not timed: a long task's
    // length is the runner's speed (the old "no long task while scrolling" failed at 54 ms on GitHub's shared runners
    // while the same commit passed, and 6 runs in 10 here at 10x slower).
    for (const dy of [40, -700]) {
      const c = await slide(page, cdp, dy)
      if (c) counts.push(`${dy < 0 ? 'to reading' : 'back'} ${c.step} + slide ${c.slide}`)
      expect(!!c && c.step <= SWITCH && c.slide <= SLIDING, `${name}: the switch ${dy < 0 ? 'to reading' : 'back'} is at most ${SWITCH} layouts and its slide at most ${SLIDING} (${c ? `${c.step} and ${c.slide}` : 'it never switched'})`)
    }
    return { name, fails, counts }
  } finally {
    await ctx.close()
  }
}

const SCENES: Scene[] = [
  { where: 'space', width: 390, phone: true, record: true },
  { where: 'space', width: 390, phone: true, dark: true },
  { where: 'task', width: 390, phone: true },
  { where: 'space', width: 390, phone: true, reduced: true },
  { where: 'space', width: 1280, phone: false },
]

const demo = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
let failed = 0
try {
  // the scenes side by side, each in its own context and page process: the CI job has one time limit for all its steps
  for (const { name, fails, counts } of await Promise.all(SCENES.map((scene) => check(browser, demo.url, scene)))) {
    if (!fails.length) console.log(`ok    ${name}${counts.length ? ` (layouts: ${counts.join(', ')})` : ''}`)
    else {
      failed++
      console.log(`FAIL  ${name}`)
      for (const f of fails) console.log(`        ${f}`)
    }
  }
  assert.equal(failed, 0, `reading check: ${failed} of ${SCENES.length} scenes broken`)
  console.log(`reading check: ${SCENES.length} scenes; the tabs go and the box folds while reading back, all back on a scroll down, a tap or focus`)
} finally {
  await browser.close()
  demo.server.kill()
}
