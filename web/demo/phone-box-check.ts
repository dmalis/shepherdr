// Phone box check (fork #134): typing on a phone, end to end, in a real browser. The phone's message box broke twice
// in one night (Return couldn't make a new line and the text sat off centre; then send or stop wrapped to a third row)
// with review, proof and CI all green: this check types into it as a person does and measures what they see.
//
// Opens the built demo in a headless Chrome whose only pointer is a finger, at 320 and 390 px, in a space's chat and a
// task's thread, idle (send) and working (stop), and in each:
//   - keyboard down: the box is exactly two rows, the text and one bar: + first, the model line cut with an ellipsis,
//     send or stop last, nothing wrapped;
//   - the on-screen keyboard up (the page shrinks for it, as Android's does; viewport.ts and typing.ts see it): one
//     row, + and the text and send level, a line of text centred against + and send;
//   - typing a line, then Return: a new line, nothing sent; a second line, then the send button: both lines sent as
//     one message, the box empty again;
//   - the keyboard down with the box still focused (a hardware keyboard): Enter sends.
//
//   bun run build && bun web/demo/phone-box-check.ts [--shots <dir>]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()). No sleeps:
// every step waits for what it needs.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, type Browser, type Locator, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : ''
if (shots) mkdirSync(shots, { recursive: true })

/** a phone's height, and how much of it an on-screen keyboard takes (well over viewport.ts's 150px line) */
const TALL = 844
const KEYBOARD = 336
/** the long model line the person saw: the effort and a permission mode that isn't the agent's default */
const LONG = { kind: 'claude', model: 'opus', modelLabel: 'Opus 5.5', effort: 'xhigh', perm: 'bypass' }

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

type Scene = { width: number; where: 'space' | 'task'; working: boolean; zoom?: number }

/** the box's parts as they sit now: each visible part's middle, the rows they make, and the model line */
function measure(box: Locator) {
  return box.evaluate((el) => {
    const r = (e: Element) => e.getBoundingClientRect()
    const seen = (e: Element) => r(e).width > 0 && r(e).height > 0 && getComputedStyle(e).display !== 'none'
    const bar = el.querySelector(':scope > .cbar')!
    const row = el.querySelector(':scope > .crow')!
    const cin = row.querySelector('textarea.cin')!
    // the bar's own parts; with the keyboard up the bar is display: contents and its parts join the text's row
    const parts = [...bar.children].filter(seen)
    const mid = (e: Element) => r(e).top + r(e).height / 2
    const plus = parts.find((k) => k.matches('.ib'))
    const send = bar.querySelector(':scope > .send')!
    const agent = bar.querySelector(':scope > .agent')
    const model = agent?.querySelector(':scope > .m')
    // where a line of text sits in the text area: its content box (between its paddings), one line tall
    const cs = getComputedStyle(cin)
    const top = r(cin).top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
    const bottom = r(cin).bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth)
    const line = parseFloat(cs.lineHeight)
    return {
      box: r(el).height,
      rowTop: r(row).top,
      rowBottom: r(row).bottom,
      barTop: Math.min(...parts.map((k) => r(k).top)),
      barMids: parts.map(mid),
      partNames: parts.map((k) => k.className || k.tagName),
      plusFirst: parts[0] === plus,
      sendLast: parts[parts.length - 1] === send,
      plusMid: plus ? mid(plus) : NaN,
      sendMid: mid(send),
      sendOut: Math.max(r(send).right - r(el).right, r(send).bottom - r(el).bottom),
      // the text's middle, and whether one line fills the content box (centred, not top-aligned in a taller row)
      textMid: (top + bottom) / 2,
      textLines: Math.round((bottom - top) / line),
      agentShown: !!agent && seen(agent),
      agentOver: agent ? agent.scrollWidth - agent.clientWidth : 0,
      modelCut: !!model && getComputedStyle(model).textOverflow === 'ellipsis' && getComputedStyle(model).whiteSpace === 'nowrap',
      modelWidth: model ? r(model).width : 0,
    }
  })
}

/** two frames: the layout after the last change has been drawn */
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.where} ${s.width}px${s.zoom ? ` zoom ${s.zoom}%` : ''} ${s.working ? 'working' : 'idle'}`
  // the app's Zoom (Settings › General) scales the box and its buttons: so do the checks' allowances
  const z = (s.zoom ?? 100) / 100
  const ctx = await browser.newContext({ viewport: { width: s.width, height: TALL }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  try {
    if (s.zoom) await ctx.addInitScript((zoom) => localStorage.setItem('shepherdr.prefs', JSON.stringify({ zoom })), s.zoom)
    // voice off: the box's own send and stop (box-check.ts covers the microphone's)
    await ctx.route('**/api/me', (r) => r.fulfill({ json: { login: 'sam', off: ['voice'] } }))
    // what the page sends, in order (the demo answers as the service does)
    const sent: string[] = []
    await ctx.route('**/api/action', (r) => {
      const a = r.request().postDataJSON() as { type?: string; text?: string }
      if (a?.type === 'send') sent.push(a.text ?? '')
      return r.continue()
    })
    // every chat the page loads gets the long model line, and is working or not as the scene says
    await ctx.routeWebSocket(/\/api\/ws/, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((m) => server.send(m))
      server.onMessage((m) => {
        if (typeof m !== 'string') return ws.send(m)
        const v = JSON.parse(m) as { type?: string; chat?: { agent?: unknown; working?: boolean; finished?: boolean }; snapshot?: { off?: string[] } }
        if (v.type === 'chat' && v.chat) Object.assign(v.chat, { agent: LONG, working: s.working, finished: false })
        if (v.type === 'snapshot' && v.snapshot) v.snapshot.off = ['voice']
        ws.send(JSON.stringify(v))
      })
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(s.where === 'task' ? `${base}?task=SHOP-15` : base)
    // a finger and nothing else: the box's Return then makes a new line (web/src/enter.ts's touchOnly)
    assert.ok(await page.evaluate(() => !matchMedia('(any-pointer: fine)').matches && matchMedia('(any-pointer: coarse)').matches), `${name}: the browser has a mouse, not only a finger`)
    const box = page.locator('.cbox:has(> .crow + .cbar) >> visible=true').last()
    const cin = box.locator(':scope > .crow textarea.cin')
    const round = (label: string) => box.locator(`.cbar > .send[aria-label="${label}"]`)
    await round(s.working ? 'Stop' : 'Send').waitFor()
    await page.waitForFunction((label) => document.querySelector('.cbar .agent .m')?.textContent === label, LONG.modelLabel)
    const shot = async (what: string) => shots && box.screenshot({ path: `${shots}/${`${name} ${what}`.replace(/[^\w]+/g, '-')}.png` })

    // every break the scene finds, not only the first: a failing run says all that is wrong at once
    const fails: string[] = []
    const want = (ok: boolean, what: string) => void (ok || fails.push(what))

    // keyboard down: two rows, the text and one bar
    const twoRows = async (when: string) => {
      await frames(page)
      const m = await measure(box)
      want(m.sendOut <= 0, `${when}: send/stop sticks out of the box by ${m.sendOut}px`)
      const spread = Math.max(...m.barMids) - Math.min(...m.barMids)
      want(spread <= 3 * z, `${when}: the bar wraps (${m.partNames.join(', ')}: ${spread.toFixed(1)}px apart)`)
      want(m.barTop >= m.rowBottom - 1, `${when}: the bar is not below the text`)
      want(m.plusFirst && m.sendLast, `${when}: the bar is not + first and send/stop last (${m.partNames.join(', ')})`)
      want(m.agentShown, `${when}: the model line is not in the bar`)
      want(m.modelCut && m.agentOver <= 1, `${when}: the model line is not cut with an ellipsis (${m.agentOver}px over)`)
      want(m.modelWidth >= 28 * z, `${when}: the model's name has only ${m.modelWidth.toFixed(1)}px`)
      // exactly two rows: the box is the text's row and one bar (its tallest part, 44px, and its padding), no more
      const bar = m.box - (m.rowBottom - m.rowTop)
      want(bar <= 64 * z, `${when}: the bar takes ${bar.toFixed(1)}px, more than one row`)
    }
    // keyboard up: one row, + and the text and send level, one line of text centred against them
    const oneRow = async (when: string) => {
      await frames(page)
      const m = await measure(box)
      want(!m.agentShown, `${when}: the model line still shows while typing`)
      want(m.sendOut <= 0, `${when}: send sticks out of the box by ${m.sendOut}px`)
      want(m.plusFirst && m.sendLast, `${when}: the row is not + first and send last (${m.partNames.join(', ')})`)
      want(Math.abs(m.plusMid - m.sendMid) <= z, `${when}: + and send are not level (${(m.plusMid - m.sendMid).toFixed(1)}px)`)
      want(m.rowTop < m.sendMid && m.rowBottom > m.sendMid, `${when}: the text is not in the row of + and send`)
      want(m.textLines === 1, `${when}: one line of text sits in a box ${m.textLines} lines tall`)
      want(Math.abs(m.textMid - m.sendMid) <= z, `${when}: the text is ${(m.textMid - m.sendMid).toFixed(1)}px off the middle of + and send`)
    }
    const keyboard = async (up: boolean) => {
      await page.setViewportSize({ width: s.width, height: up ? TALL - KEYBOARD : TALL })
      await page.waitForFunction((up) => document.documentElement.classList.contains('kb-up') === up, up)
    }
    const area = await cin.elementHandle()
    /** a key pressed in the box, then wait until it did something to the text (a new line, or sent and emptied) */
    const press = async (key: string) => {
      const before = await cin.inputValue()
      await cin.press(key)
      await page.waitForFunction(([el, v]) => (el as HTMLTextAreaElement).value !== v, [area, before] as const)
    }

    try {
      await twoRows('keyboard down')
      await shot('keyboard down')

      // the box tapped: the on-screen keyboard comes up
      await cin.tap()
      await keyboard(true)
      await oneRow('keyboard up, empty')
      await cin.pressSequentially('line one')
      await round('Send').waitFor()
      await oneRow('keyboard up, one line')
      await shot('keyboard up')
      // Return on the on-screen keyboard: a new line, nothing sent
      await press('Enter')
      want(!sent.length, `Return on the on-screen keyboard sent ${JSON.stringify(sent[0])} instead of making a new line`)
      want((await cin.inputValue()) === 'line one\n' || !!sent.length, `Return on the on-screen keyboard left ${JSON.stringify(await cin.inputValue())}`)
      // (it sent: the first line back, so the send button's check below still runs)
      if (sent.length) (sent.length = 0), await cin.fill('line one\n')
      await cin.pressSequentially('line two')
      // the send button: both lines, as one message, and the box empty again
      await round('Send').tap()
      await page.waitForFunction((el) => !(el as HTMLTextAreaElement).value, area)
      want(sent.length === 1 && sent[0] === 'line one\nline two', `the send button sent ${JSON.stringify(sent)}, not both lines as one message`)
      await round(s.working ? 'Stop' : 'Send').waitFor()

      // the keyboard down, the box still focused: a hardware keyboard, whose Enter sends
      await keyboard(false)
      await twoRows('keyboard down, focused')
      sent.length = 0
      await cin.pressSequentially('from a keyboard')
      await press('Enter')
      want(sent.length === 1 && sent[0] === 'from a keyboard' && !(await cin.inputValue()), `Enter on a hardware keyboard sent ${JSON.stringify(sent)} and left ${JSON.stringify(await cin.inputValue())}`)
      await twoRows('keyboard down, after sending')
    } catch (e) {
      // a step that never happened (a button that never came, a key that did nothing): the scene stops there
      fails.push(`stopped: ${(e as Error).message.split('\n')[0]}`)
    }
    return { name, fails }
  } finally {
    await ctx.close()
  }
}

const demo = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
const started = performance.now()
let n = 0
let failed = 0
/** every width, place and state at Zoom 100%; then Zoom 125% (where the bar wrapped on the person's iPhone) */
const SCENES: Scene[] = []
for (const width of [320, 390])
  for (const where of ['space', 'task'] as const)
    for (const working of [false, true]) SCENES.push({ width, where, working })
for (const width of [320, 390]) SCENES.push({ width, where: 'space', working: true, zoom: 125 }, { width, where: 'task', working: false, zoom: 125 })
try {
  for (const scene of SCENES) {
    const { name, fails } = await check(browser, demo.url, scene)
    n++
    if (!fails.length) console.log(`ok    ${name}`)
    else {
      failed++
      console.log(`FAIL  ${name}`)
      for (const f of fails) console.log(`        ${f}`)
    }
  }
  const took = ((performance.now() - started) / 1000).toFixed(1)
  if (failed) {
    console.log(`phone box check: ${failed} of ${n} scenes broken (${took}s)`)
    process.exitCode = 1
  } else console.log(`phone box check: ${n} scenes in ${took}s; two rows down, one row up, Return a new line, send and Enter send`)
} finally {
  await browser.close()
  demo.server.kill()
}
