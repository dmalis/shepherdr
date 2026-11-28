// Swipe check (fork #185, Tasks: swipe actions on a phone): the Tasks list's slide to the left, played with real touch
// events (CDP Input.dispatchTouchEvent) in a headless Chrome whose pointer is a finger, on the built demo at a phone's
// width. It checks what the unit tests can't: the row opens past half its actions and closes short of it, a tap on an
// open row closes it without opening the task, a second row opening puts the first away, up and down still scrolls the
// list, the left edge's strip and a mouse never slide, a long press opens the row's menu, a full slide archives with
// "Archiving…" shown and Undo offered and moves focus to the next row, a failed one springs back with its error, and
// with Motion › Reduced nothing springs and no haptic fires.
//
//   bun run build && bun web/demo/swipe-check.ts [--shots <dir>]
//
// --shots: also keeps pictures of an open row and a full slide in light, dark and night.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const si = args.indexOf('--shots')
const shots = si >= 0 ? args[si + 1] : null

/** demo tasks: a review with a pull request (Open PR, Archive), two reviews without (Changes, Archive), one asking */
const PR = 'SHOP-12'
const ROW = 'BLOG-10'
const NEXT = 'NOTES-4'
const ASK = 'SHOP-14'

const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
const port = probe.port
probe.stop(true)
const server = Bun.spawn(['bun', join(root, 'web/demo/serve.ts'), String(port)], { stdout: 'ignore', stderr: 'inherit' })
const base = `http://127.0.0.1:${port}`
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(base)).ok) break
  } catch {
    /* not yet */
  }
  await Bun.sleep(100)
}

const results: { what: string; ok: boolean; got?: unknown }[] = []
const check = (what: string, ok: boolean, got?: unknown) => {
  results.push({ what, ok, got })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || got === undefined ? '' : `: ${JSON.stringify(got)}`}`)
}

type Pt = { x: number; y: number }
const touch = (cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', p?: Pt) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] })

/** a finger from `a` to `b` in `steps` moves `ms` apart; `lift`: let go at the end */
async function drag(cdp: CDPSession, a: Pt, b: Pt, o: { steps?: number; ms?: number; lift?: boolean; hold?: number } = {}) {
  const steps = o.steps ?? 16
  await touch(cdp, 'touchStart', a)
  if (o.hold) await Bun.sleep(o.hold)
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps })
    await Bun.sleep(o.ms ?? 24)
  }
  if (o.lift !== false) await touch(cdp, 'touchEnd')
}

async function rowBox(page: Page, id: string) {
  const b = await page.locator(`[data-task-row="${id}"]`).boundingBox()
  if (!b) throw new Error(`no row ${id}`)
  return b
}
/** a finger on a row, from near its right end to the left by `dx` (slowly: no flick) */
async function swipeLeft(page: Page, cdp: CDPSession, id: string, dx: number, o: { ms?: number; steps?: number; lift?: boolean } = {}) {
  const b = await rowBox(page, id)
  const y = b.y + b.height / 2
  const x = b.x + b.width - 50
  await drag(cdp, { x, y }, { x: x - dx, y }, { steps: o.steps ?? 20, ms: o.ms ?? 40, lift: o.lift })
}
/** a finger on an open row's action, on the part of it you see (each tile is the row's width, the next one over it) */
async function tapTile(page: Page, cdp: CDPSession, id: string, name: string) {
  const p = await page.evaluate(([id, name]) => {
    const t = document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(id!)}"] .slt[aria-label^="${name}"]`)!
    const r = t.getBoundingClientRect()
    return { x: r.left + 30, y: r.top + r.height / 2 }
  }, [id, name])
  await touch(cdp, 'touchStart', p)
  await touch(cdp, 'touchEnd')
}
const stateOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const r = document.querySelector(`[data-task-row="${CSS.escape(id)}"]`)
    const tiles = [...(r?.querySelectorAll<HTMLElement>('.sla>.slt') ?? [])]
    return {
      there: !!r,
      tray: !!r?.querySelector('.sla'),
      open: !!r?.querySelector('.sla.on'),
      tiles: tiles.map((t) => t.textContent?.trim()),
      names: tiles.map((t) => t.getAttribute('aria-label')),
      x: r ? new DOMMatrix(getComputedStyle(r.querySelector('.row')!).transform).m41 : null,
    }
  }, id)

/** a fresh load of the page, on the Tasks list */
async function tasks(page: Page, path = '/') {
  await page.goto(base + path, { waitUntil: 'networkidle' })
  await page.locator('[aria-label="Tasks"], .pt:has-text("Tasks")').locator('visible=true').first().click()
  await page.locator(`[data-task-row="${ROW}"]`).waitFor()
}

async function phone(o: { motion?: 'Reduced'; zoom?: number; theme?: string; scheme?: 'light' | 'dark'; fail?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; cdp: CDPSession }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: o.scheme ?? 'light' })
  await ctx.addInitScript((p) => {
    try {
      localStorage.clear()
      localStorage.setItem('shepherdr.prefs', JSON.stringify(p))
    } catch {
      /* none */
    }
    // the haptic ticks the page asks for
    ;(window as unknown as { buzzes: number[] }).buzzes = []
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms: number) => ((window as unknown as { buzzes: number[] }).buzzes.push(ms), true) })
  }, { theme: o.theme ?? 'System', motion: o.motion ?? 'System', zoom: o.zoom ?? 100 })
  const page = await ctx.newPage()
  await tasks(page, o.fail ? '/?case=fail' : '/')
  const cdp = await ctx.newCDPSession(page)
  return { ctx, page, cdp }
}

const browser = await chromium.launch({ executablePath: chrome(), args: ['--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2'] })
try {
  {
    const { ctx, page, cdp } = await phone()
    const W = (await rowBox(page, PR)).width

    // short of half its actions: back
    await swipeLeft(page, cdp, PR, 40, { ms: 60 })
    await page.waitForTimeout(450)
    let s = await stateOf(page, PR)
    check('a slide short of half the actions springs back', !s.tray && s.x === 0, s)

    // past half, slowly: it stays open, its actions there and named with the task
    await swipeLeft(page, cdp, PR, 130)
    await page.waitForTimeout(450)
    s = await stateOf(page, PR)
    check('past half, let go: it stays open with Open PR and Archive', s.open && JSON.stringify(s.tiles) === JSON.stringify(['Open PR', 'Archive']), s)
    check('each action is named with its task', s.names.every((n) => !!n && n.includes('Faster product search')), s.names)
    check('it rests at its actions’ width (2 × 76 px)', s.x === -152, s.x)
    if (shots) await page.screenshot({ path: join(shots, 'open--phone--light.png'), clip: { x: 0, y: (await rowBox(page, PR)).y - 60, width: 390, height: 220 } })

    // a tap on the open row closes it, and doesn't open the task
    const b = await rowBox(page, PR)
    await touch(cdp, 'touchStart', { x: 120, y: b.y + b.height / 2 })
    await touch(cdp, 'touchEnd')
    await page.waitForTimeout(450)
    s = await stateOf(page, PR)
    const opened = await page.evaluate(() => !!document.querySelector('.pane .thread, .tthread, [data-thread]') || location.search.includes('task='))
    check('a tap on an open row closes it without opening the task', !s.tray && s.x === 0 && (await page.locator(`[data-task-row="${PR}"]`).isVisible()), { s, opened })

    // one row open: opening a second puts the first away
    await swipeLeft(page, cdp, PR, 130)
    await page.waitForTimeout(400)
    await swipeLeft(page, cdp, ROW, 130)
    await page.waitForTimeout(450)
    const a1 = await stateOf(page, PR)
    const a2 = await stateOf(page, ROW)
    check('a second row opening puts the first away', !a1.tray && a2.open, { first: a1.open, second: a2.open })
    check('a review without a pull request shows Changes and Archive', JSON.stringify(a2.tiles) === JSON.stringify(['Changes', 'Archive']), a2.tiles)

    // Escape puts it away too
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)
    check('Escape puts an open row away', !(await stateOf(page, ROW)).tray)

    // a finger that starts on the row's ⋯ button slides it too (the browser would take it as its own pan)
    const db = await page.locator(`[data-task-row="${ROW}"] > .ib`).boundingBox()
    await drag(cdp, { x: db!.x + db!.width / 2, y: db!.y + db!.height / 2 }, { x: db!.x + db!.width / 2 - 130, y: db!.y + db!.height / 2 }, { steps: 20, ms: 40 })
    await page.waitForTimeout(450)
    check('a slide that starts on the ⋯ button opens the row too', (await stateOf(page, ROW)).open)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(450)

    // a tap on an action acts, and the row closes: Changes opens the task's changes
    await swipeLeft(page, cdp, ROW, 130)
    await page.waitForTimeout(450)
    await tapTile(page, cdp, ROW, 'Changes')
    await page.waitForTimeout(500)
    const diffOpen = await page.evaluate(() => /changes/i.test(document.querySelector('.pane .hd, .pane h1, .pane h2')?.textContent ?? '') || !!document.querySelector('.diff, .dfile, [data-diff]'))
    check('a tap on Changes opens the task’s changes', diffOpen)
    await tasks(page)

    // up and down from a row scrolls the list, and never slides it
    const sc = await page.evaluate((id) => {
      let el = document.querySelector(`[data-task-row="${id}"]`) as HTMLElement | null
      while (el && !(el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
      el?.setAttribute('data-sc', '')
      return el ? el.scrollTop : -1
    }, NEXT)
    const nb = await rowBox(page, NEXT)
    await drag(cdp, { x: nb.x + nb.width - 60, y: nb.y + nb.height / 2 }, { x: nb.x + nb.width - 80, y: nb.y + nb.height / 2 - 220 }, { steps: 12, ms: 16 })
    await page.waitForTimeout(500)
    const sc2 = await page.evaluate(() => document.querySelector<HTMLElement>('[data-sc]')?.scrollTop ?? -1)
    check('up and down from a row scrolls the list, no slide', sc2 > sc && !(await stateOf(page, NEXT)).tray, { before: sc, after: sc2 })
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-sc]')?.scrollTo(0, 0))
    await page.waitForTimeout(200)

    // the left edge's strip belongs to the spaces list: a finger from it going right never slides a row into a reply
    const rb = await rowBox(page, ROW)
    await page.evaluate((id) => {
      const w = window as unknown as { slid: boolean }
      w.slid = false
      const r = document.querySelector(`[data-task-row="${CSS.escape(id)}"]`)!
      new MutationObserver(() => {
        if (r.classList.contains('sl') || r.querySelector('.sla')) w.slid = true
      }).observe(r, { subtree: true, attributes: true, childList: true })
    }, ROW)
    await drag(cdp, { x: 12, y: rb.y + rb.height / 2 }, { x: 200, y: rb.y + rb.height / 2 }, { steps: 16 })
    await page.waitForTimeout(400)
    check("a finger from the left edge's strip never slides a row", !(await page.evaluate(() => (window as unknown as { slid: boolean }).slid)))
    await tasks(page)

    // a task that asks you: its Reply first (a working one, not in a phone's Needs you view, is swipe.test.tsx's)
    await page.locator(`[data-task-row="${ASK}"]`).scrollIntoViewIfNeeded()
    await swipeLeft(page, cdp, ASK, 130)
    await page.waitForTimeout(450)
    s = await stateOf(page, ASK)
    check('a task that asks you shows Reply, then Archive', s.open && JSON.stringify(s.tiles) === JSON.stringify(['Reply', 'Archive']), s)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // a long press opens the row's menu
    const pb = await rowBox(page, PR)
    await touch(cdp, 'touchStart', { x: 150, y: pb.y + pb.height / 2 })
    await page.waitForTimeout(700)
    await touch(cdp, 'touchEnd')
    await page.waitForTimeout(400)
    const menu = await page.evaluate(() => [...document.querySelectorAll('.layer [role="menuitem"]')].map((m) => m.textContent?.trim()))
    check('a long press opens the row’s menu, with Archive in it', menu.some((m) => m?.startsWith('Archive')), menu)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // a full slide archives: Archiving… shown, the row leaves, focus goes on, Undo brings it back
    await page.evaluate((id) => {
      const w = window as unknown as { busySeen: boolean }
      w.busySeen = false
      const r = document.querySelector(`[data-task-row="${CSS.escape(id)}"]`)!
      new MutationObserver(() => {
        if (r.querySelector('.slt[aria-busy="true"]')?.textContent?.includes('Archiving…')) w.busySeen = true
      }).observe(r, { subtree: true, childList: true, attributes: true, characterData: true })
    }, ROW)
    const buzzBefore = await page.evaluate(() => (window as unknown as { buzzes: number[] }).buzzes.length)
    if (shots) {
      await swipeLeft(page, cdp, ROW, W * 0.75, { lift: false })
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(shots, 'full--phone--light.png'), clip: { x: 0, y: (await rowBox(page, ROW)).y - 60, width: 390, height: 220 } })
      await touch(cdp, 'touchEnd')
    } else await swipeLeft(page, cdp, ROW, W * 0.75)
    await page.waitForTimeout(900)
    const buzzed = (await page.evaluate(() => (window as unknown as { buzzes: number[] }).buzzes.length)) - buzzBefore
    const after = await page.evaluate((id) => ({
      there: !!document.querySelector(`[data-task-row="${CSS.escape(id)}"]`),
      busySeen: (window as unknown as { busySeen: boolean }).busySeen,
      toast: [...document.querySelectorAll('.toast')].map((t) => t.textContent?.trim()),
      focus: document.activeElement?.closest('[data-task-row]')?.getAttribute('data-task-row') ?? document.activeElement?.tagName,
    }), ROW)
    check('a full slide shows “Archiving…” while it waits', after.busySeen)
    check('a full slide archives: the row leaves the list', !after.there || !(await page.locator(`[data-task-row="${ROW}"]`).isVisible()), after)
    check('one haptic tick as it crosses the full mark', buzzed === 1, buzzed)
    check('a toast says Archived, with Undo', after.toast.some((t) => t?.includes('Archived “Fix typo on the About page”') && t.includes('Undo')), after.toast)
    check('focus goes on to the next row', !!after.focus && after.focus !== 'BODY' && after.focus !== ROW, after.focus)
    await page.locator('.toast .ta', { hasText: 'Undo' }).first().tap()
    await page.waitForTimeout(800)
    check('Undo brings it back', await page.locator(`[data-task-row="${ROW}"]`).isVisible())

    // a mouse never slides: it has the menu
    const mb = await rowBox(page, ROW)
    await page.mouse.move(mb.x + mb.width - 50, mb.y + mb.height / 2)
    await page.mouse.down()
    await page.mouse.move(mb.x + mb.width - 250, mb.y + mb.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    check('a mouse never slides a row', !(await stateOf(page, ROW)).tray)
    await ctx.close()
  }

  {
    // a failed full slide springs back, saying why
    const { ctx, page, cdp } = await phone({ fail: true })
    const W = (await rowBox(page, ROW)).width
    await swipeLeft(page, cdp, ROW, W * 0.75)
    await page.waitForTimeout(1200)
    const s = await stateOf(page, ROW)
    const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent?.trim()))
    check('a failed full slide springs back, its error in a toast and no Undo', s.there && !s.tray && s.x === 0 && toast.length > 0 && !toast.some((t) => t?.includes('Undo')), { s, toast })
    await ctx.close()
  }

  {
    // Motion › Reduced: nothing springs, no haptic
    const { ctx, page, cdp } = await phone({ motion: 'Reduced' })
    await swipeLeft(page, cdp, PR, 130)
    await page.waitForTimeout(30)
    const t = await page.evaluate((id) => {
      const r = document.querySelector(`[data-task-row="${CSS.escape(id)}"]`)!
      return [r.querySelector('.row'), ...r.querySelectorAll('.slt')].map((e) => getComputedStyle(e!).transitionDuration)
    }, PR)
    check('Motion › Reduced: the row and its actions land at once', t.every((d) => d.split(',').every((x) => parseFloat(x) === 0)), t)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    const W = (await rowBox(page, ROW)).width
    await swipeLeft(page, cdp, ROW, W * 0.75)
    await page.waitForTimeout(600)
    const buzzes = await page.evaluate(() => (window as unknown as { buzzes: number[] }).buzzes.length)
    check('Motion › Reduced: no haptic as a full slide crosses its mark', buzzes === 0, buzzes)
    await ctx.close()
  }

  {
    // Zoom 150%: each action widens as every px of the CSS does, and the row rests exactly at their edge
    const { ctx, page, cdp } = await phone({ zoom: 150 })
    await swipeLeft(page, cdp, PR, 200)
    await page.waitForTimeout(450)
    const s = await stateOf(page, PR)
    const label = await page.evaluate((id) => document.querySelector(`[data-task-row="${CSS.escape(id)}"] .slt .sli`)?.getBoundingClientRect().width ?? 0, PR)
    check('Zoom 150%: the row rests at its actions’ zoomed width, each 114 px', s.open && s.x === -228 && Math.abs(label - 114) < 1, { x: s.x, label })
    await ctx.close()
  }

  if (shots) {
    for (const [theme, scheme] of [['Dark', 'dark'], ['Night', 'dark']] as const) {
      const { ctx, page, cdp } = await phone({ theme, scheme })
      const W = (await rowBox(page, PR)).width
      await swipeLeft(page, cdp, PR, 130)
      await page.waitForTimeout(450)
      await page.screenshot({ path: join(shots, `open--phone--${theme.toLowerCase()}.png`), clip: { x: 0, y: (await rowBox(page, PR)).y - 60, width: 390, height: 220 } })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      await swipeLeft(page, cdp, ROW, W * 0.75, { lift: false })
      await page.waitForTimeout(250)
      await page.screenshot({ path: join(shots, `full--phone--${theme.toLowerCase()}.png`), clip: { x: 0, y: (await rowBox(page, ROW)).y - 60, width: 390, height: 220 } })
      await touch(cdp, 'touchCancel')
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  server.kill()
}
const bad = results.filter((r) => !r.ok)
console.log(`\n${results.length - bad.length} of ${results.length} passed`)
process.exit(bad.length ? 1 : 0)
