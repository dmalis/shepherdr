// Reading check (fork #144): reading back through a chat on a phone, end to end, in a real browser. Opens the built
// demo in a headless Chrome whose only pointer is a finger, at 390 px, in a space's chat (#shop) and a task's thread
// (SHOP-15), and in each:
//   - scrolling back toward older messages: the bottom tabs go, the box folds to one row and the chat gets the room,
//     with the chat's view not moved by it (the same scroll position, the same top) and no long task while scrolling;
//   - a small scroll toward the newest message, a tap on the chat, focus in the box: all back;
//   - with text in the box: nothing steps aside;
//   - one big jump back from the newest message: the chat stays where it went (not pulled back to its end);
//   - Motion Reduced: the switch is instant (no animation runs);
// and at a desktop's width with a mouse: nothing changes. A scene reports every break it finds.
//
//   bun run build && bun web/demo/reading-check.ts [--shots <dir>] [--video <dir>]
//
// --shots keeps a picture of each state, light and dark; --video records the 390 px scroll up, down and a tap.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : '')
const shots = arg('--shots')
const video = arg('--video')
for (const d of [shots, video]) if (d) mkdirSync(d, { recursive: true })

const TALL = 844

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

const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))

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

/** scrolls the chat by `dy` in small steps, as a finger's drag does */
async function drag(page: Page, dy: number) {
  const step = dy < 0 ? -20 : 20
  await page.evaluate(() => ((window as unknown as { __log: string[] }).__log.length = 0))
  for (let moved = 0; Math.abs(moved) < Math.abs(dy); moved += step) {
    await page.evaluate((s) => {
      const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length && e.parentElement!.querySelector(':scope > .foot > .cbox'))!
      sc.scrollTop += s
    }, step)
    await frames(page)
  }
  await page.waitForTimeout(400)
}

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.where} ${s.width}px${s.phone ? '' : ' mouse'}${s.dark ? ' dark' : ''}${s.reduced ? ' reduced' : ''}`
  const fails: string[] = []
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
      // what moves the box or the tabs: the box's slide (an animation) and the tabs' (a transition that lasts)
      const moving = () =>
        document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.target?.closest?.('.foot, .bar')).length +
        [...document.querySelectorAll('.app .bar')].filter((b) => parseFloat(getComputedStyle(b).transitionDuration) > 0).length
      addEventListener('DOMContentLoaded', () =>
        new MutationObserver(() => log.push(`${document.documentElement.classList.contains('reading') ? 'on' : 'off'} ${where()} ${moving()}`)).observe(document.documentElement, { attributeFilter: ['class'] }),
      )
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(s.where === 'task' ? `${base}?task=SHOP-15` : `${base}?place=${encodeURIComponent('p:mac-mini:shop')}`)
    await page.locator('.cbox textarea.cin >> visible=true').first().waitFor()
    // the analytics note on top is the demo's own: out of the way
    await page.evaluate(() => document.querySelector<HTMLElement>('.anote button[aria-label="Dismiss"], .anote .x')?.click())
    await page.waitForTimeout(300)
    const shot = async (what: string) => shots && page.screenshot({ path: `${shots}/${`${name} ${what}`.replace(/[^\w]+/g, '-')}.png` })
    // long tasks while scrolling (none may come from the mark)
    await page.evaluate(() => {
      const w = window as unknown as { __long: number[] }
      w.__long = []
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(Math.round(e.duration)))).observe({ type: 'longtask' })
    })

    const at = await state(page)
    expect(!at.reading && (at.tabs || !s.phone), `${name}: at the newest message, the tabs are there (${JSON.stringify(at)})`)
    await shot('1 newest')

    await drag(page, -700)
    const up = await state(page)
    if (!s.phone) {
      expect(!up.reading, `${name}: a mouse window never steps aside`)
      return { name, fails }
    }
    expect(up.reading, `${name}: scrolled back 700px, it reads (${JSON.stringify(up)})`)
    expect(!up.tabs, `${name}: the tabs stepped aside`)
    expect(up.box < at.box, `${name}: the box folded to one row (${at.box} -> ${up.box})`)
    expect(up.chat - at.chat >= 100, `${name}: the chat got at least 100px more (${at.chat} -> ${up.chat})`)
    // still past the jump-to-newest button's line: its ↓ stays
    expect(up.end > 240 && (await page.locator('.toend >> visible=true').count()) === 1, `${name}: the jump-to-newest button stays (${up.end}px from the end)`)
    // the mark changed nothing of the chat's view: the same position and top as the scroll just before it
    const i = up.log.findIndex((l) => l.startsWith('on '))
    expect(i > 0 && up.log[i]!.split(' ')[1] === up.log[i - 1]!.split(' ')[1], `${name}: the chat's view did not move as it stepped aside (${up.log.join(' | ')})`)
    if (s.reduced) expect(i >= 0 && up.log[i]!.endsWith(' 0'), `${name}: Motion Reduced, nothing animates (${up.log[i]})`)
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

    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long)
    expect(!long.length, `${name}: no long task while scrolling (${long.join(', ')} ms)`)
    return { name, fails }
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
  for (const scene of SCENES) {
    const { name, fails } = await check(browser, demo.url, scene)
    if (!fails.length) console.log(`ok    ${name}`)
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
