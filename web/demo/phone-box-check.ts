// Phone box check (fork #134): typing on a phone, end to end, in a real browser. The phone's message box broke twice
// in one night (Return couldn't make a new line and the text sat off centre; then send or stop wrapped to a third row)
// with review, proof and CI all green: this check types into it as a person does and measures what they see.
//
// Opens the built demo in a headless Chrome whose only pointer is a finger, at 320 and 390 px (Zoom 100% and 125%), in
// a space's chat (#shop) and a task's thread (SHOP-15), idle (send) and working (stop), voice off (the box's own send)
// and on (the microphone and its round button), and in each:
//   - keyboard down: the box is exactly two rows, the text and one bar: + first, a model line too long for it cut with
//     an ellipsis, send or stop last, nothing wrapped;
//   - the on-screen keyboard up (the page shrinks for it, as Android's does; viewport.ts and typing.ts see it): one
//     row, every part of it level, a line of text centred against + and send;
//   - typing a line, then Return: a new line, nothing sent; a second line, then the send button: both lines sent as
//     one message to that chat, the box empty again;
//   - the keyboard down with the box still focused (a hardware keyboard): Enter sends.
// A scene reports every break it finds, not only the first.
//
//   bun run build && bun web/demo/phone-box-check.ts [--shots <dir>]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()). No sleeps:
// every step waits for what it needs.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, type Browser, type Locator, type Page, type Request } from 'playwright-core'
import { chrome } from './tap-check.ts'

const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : ''
if (shots) mkdirSync(shots, { recursive: true })

/** a phone's height, and how much of it an on-screen keyboard takes (well over viewport.ts's 150px line) */
const TALL = 844
const KEYBOARD = 336
/** a model line too long for any phone's bar, which must cut it, never wrap: a model the catalog doesn't know (it
 *  shows the name its agent reports), the effort and a permission mode that isn't the agent's default */
const LONG = { kind: 'claude', model: 'opus-1m', modelLabel: 'Opus 5.5 with a one-million-token context window', effort: 'xhigh', perm: 'bypass' }
/** the demo's chats the scenes type into: #shop's, and SHOP-15's thread */
const CHAT = { space: 'p:mac-mini:shop', task: 'SHOP-15/worker' }
/** how long a key or a tap has to show its effect (a new line, an emptied box) before the step counts as failed */
const EFFECT = 2000

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

type Scene = { width: number; where: 'space' | 'task'; working: boolean; zoom?: number; voice?: boolean }
type Sent = { chat: string; text: string; cid: string }

/** a send the page asked the service for */
const sendOf = (r: Request): Sent | null => {
  if (!r.url().endsWith('/api/action') || r.method() !== 'POST') return null
  try {
    const a = r.postDataJSON() as { type?: string; chat?: string; text?: string; cid?: string }
    return a?.type === 'send' ? { chat: a.chat ?? '', text: a.text ?? '', cid: a.cid ?? '' } : null
  } catch {
    return null
  }
}

/** the box's parts as they sit now: each visible part's middle, the rows they make, the text's line and the model line */
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
    // the text area's content box (between its paddings and borders) and its line: a line of text sits at its top
    const cs = getComputedStyle(cin)
    const top = r(cin).top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)
    const bottom = r(cin).bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth)
    const line = parseFloat(cs.lineHeight)
    return {
      box: r(el).height,
      rowTop: r(row).top,
      rowBottom: r(row).bottom,
      barTop: Math.min(...parts.map((k) => r(k).top)),
      mids: parts.map(mid),
      partNames: parts.map((k) => k.className || k.tagName),
      plusFirst: parts[0] === plus,
      sendLast: parts[parts.length - 1] === send,
      plusMid: plus ? mid(plus) : NaN,
      sendMid: mid(send),
      sendOut: Math.max(r(send).right - r(el).right, r(send).bottom - r(el).bottom),
      // the first line's middle, and how tall the content box is against one line
      textMid: top + line / 2,
      content: bottom - top,
      line,
      agentShown: !!agent && seen(agent),
      agentOver: agent ? agent.scrollWidth - agent.clientWidth : 0,
      // the model's name: cut (its text wider than its box), with an ellipsis on one line
      modelCut: !!model && model.scrollWidth > model.clientWidth + 1,
      modelEllipsis: !!model && getComputedStyle(model).textOverflow === 'ellipsis' && getComputedStyle(model).whiteSpace === 'nowrap',
      modelWidth: model ? r(model).width : 0,
    }
  })
}

/** two frames: the layout after the last change has been drawn */
const frames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.where} ${s.width}px${s.zoom ? ` zoom ${s.zoom}%` : ''} ${s.working ? 'working' : 'idle'}${s.voice ? ' voice' : ''}`
  // the app's Zoom (Settings › General) scales the box and its buttons: so do the checks' allowances
  const z = (s.zoom ?? 100) / 100
  const chat = CHAT[s.where]
  const ctx = await browser.newContext({ viewport: { width: s.width, height: TALL }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  try {
    if (s.zoom) await ctx.addInitScript((zoom) => localStorage.setItem('shepherdr.prefs', JSON.stringify({ zoom })), s.zoom)
    // voice off: the box's own send and stop; on (the demo's default): the microphone and its round button
    if (!s.voice) await ctx.route('**/api/me', (r) => r.fulfill({ json: { login: 'sam', off: ['voice'] } }))
    // every chat the page loads gets the long model line, and is working or not as the scene says
    await ctx.routeWebSocket(/\/api\/ws/, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((m) => server.send(m))
      server.onMessage((m) => {
        if (typeof m !== 'string') return ws.send(m)
        const v = JSON.parse(m) as { type?: string; chat?: { agent?: unknown; working?: boolean; finished?: boolean }; snapshot?: { off?: string[] } }
        if (v.type === 'chat' && v.chat) Object.assign(v.chat, { agent: LONG, working: s.working, finished: false })
        // the same plugins off as api/me said, or the page reloads to match
        if (v.type === 'snapshot' && v.snapshot && !s.voice) v.snapshot.off = ['voice']
        ws.send(JSON.stringify(v))
      })
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    // every send the page asks for, once each (a retry of the same message keeps its id), in order
    const sent: Sent[] = []
    page.on('request', (r) => {
      const a = sendOf(r)
      if (a && !sent.some((x) => x.cid === a.cid)) sent.push(a)
    })
    await page.goto(s.where === 'task' ? `${base}?task=SHOP-15` : `${base}?place=${encodeURIComponent(CHAT.space)}`)
    // a finger and nothing else: the box's Return then makes a new line (web/src/enter.ts's touchOnly)
    assert.ok(await page.evaluate(() => !matchMedia('(any-pointer: fine)').matches && matchMedia('(any-pointer: coarse)').matches), `${name}: the browser has a mouse, not only a finger`)
    // the scene's own chat's box, never another one on the page
    const box = page.locator(`.cbox:has(> .crow textarea.cin[data-box="${chat}"]) >> visible=true`)
    const cin = box.locator(':scope > .crow textarea.cin')
    const round = box.locator(':scope > .cbar > .send')
    /** the round button, as it should read now: Send, or Stop while the agent works and the box is empty (voice on:
     *  Send once there is text; empty, it starts a call) */
    const roundAs = (label: 'Send' | 'Stop') => box.locator(`:scope > .cbar > .send[aria-label="${label}"]`)
    await (s.voice ? round : roundAs(s.working ? 'Stop' : 'Send')).waitFor()
    await page.waitForFunction((label) => [...document.querySelectorAll('.cbar .agent .m')].some((m) => m.textContent === label), LONG.modelLabel)
    const shot = async (what: string) => shots && box.screenshot({ path: `${shots}/${`${name} ${what}`.replace(/[^\w]+/g, '-')}.png` })

    // every break the scene finds, not only the first: a failing run says all that is wrong at once
    const fails: string[] = []
    const want = (ok: boolean, what: string) => void (ok || fails.push(what))

    // keyboard down: two rows, the text and one bar
    const twoRows = async (when: string) => {
      await frames(page)
      const m = await measure(box)
      want(m.sendOut <= 0, `${when}: send/stop sticks out of the box by ${m.sendOut}px`)
      const spread = Math.max(...m.mids) - Math.min(...m.mids)
      want(spread <= 3 * z, `${when}: the bar wraps (${m.partNames.join(', ')}: ${spread.toFixed(1)}px apart)`)
      want(m.barTop >= m.rowBottom - 1, `${when}: the bar is not below the text`)
      want(m.plusFirst && m.sendLast, `${when}: the bar is not + first and send/stop last (${m.partNames.join(', ')})`)
      want(m.agentShown, `${when}: the model line is not in the bar`)
      want(m.modelCut && m.modelEllipsis && m.agentOver <= 1, `${when}: the long model line is not cut with an ellipsis (cut ${m.modelCut}, ellipsis ${m.modelEllipsis}, ${m.agentOver}px over)`)
      want(m.modelWidth >= 28 * z, `${when}: the model's name has only ${m.modelWidth.toFixed(1)}px`)
      // exactly two rows: the box is the text's row and one bar (its tallest part, 44px, and its padding), no more
      const bar = m.box - (m.rowBottom - m.rowTop)
      want(bar <= 64 * z, `${when}: the bar takes ${bar.toFixed(1)}px, more than one row`)
    }
    // keyboard up: one row, every part level, one line of text centred against + and send
    const oneRow = async (when: string) => {
      await frames(page)
      const m = await measure(box)
      want(!m.agentShown, `${when}: the model line still shows while typing`)
      want(m.sendOut <= 0, `${when}: send sticks out of the box by ${m.sendOut}px`)
      want(m.plusFirst && m.sendLast, `${when}: the row is not + first and send last (${m.partNames.join(', ')})`)
      const spread = Math.max(...m.mids) - Math.min(...m.mids)
      want(spread <= z, `${when}: the row's buttons are not level (${m.partNames.join(', ')}: ${spread.toFixed(1)}px apart)`)
      want(m.rowTop < m.sendMid && m.rowBottom > m.sendMid, `${when}: the text is not in the row of + and send`)
      want(Math.abs(m.content - m.line) <= z, `${when}: one line of text (${m.line}px) sits in a box ${m.content.toFixed(1)}px tall`)
      want(Math.abs(m.textMid - m.sendMid) <= z && Math.abs(m.textMid - m.plusMid) <= z, `${when}: the text is ${(m.textMid - m.sendMid).toFixed(1)}px off the middle of + and send`)
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
      await page.waitForFunction(([el, v]) => (el as HTMLTextAreaElement).value !== v, [area, before] as const, { timeout: EFFECT })
    }
    /** `act` sends one message: wait for the page to ask the service for it, and for the box to empty */
    const sending = async (act: () => Promise<unknown>) => {
      const asked = page.waitForRequest((r) => !!sendOf(r), { timeout: EFFECT })
      await act()
      await asked
      await page.waitForFunction((el) => !(el as HTMLTextAreaElement).value, area, { timeout: EFFECT })
    }

    try {
      await twoRows('keyboard down')
      await shot('keyboard down')

      // the box tapped: the on-screen keyboard comes up
      await cin.tap()
      await keyboard(true)
      await oneRow('keyboard up, empty')
      await cin.pressSequentially('line one')
      await roundAs('Send').waitFor({ timeout: EFFECT })
      await oneRow('keyboard up, one line')
      await shot('keyboard up')
      // Return on the on-screen keyboard: a new line, nothing sent
      await press('Enter')
      const after = await cin.inputValue()
      want(after === 'line one\n', `Return on the on-screen keyboard ${after ? `left ${JSON.stringify(after)}` : 'sent the message'} instead of making a new line`)
      // (it sent: the steps go on, and the messages' check below lists what went)
      await cin.pressSequentially('line two')
      // the send button: both lines, as one message
      await sending(() => roundAs('Send').tap())
      await (s.voice ? round : roundAs(s.working ? 'Stop' : 'Send')).waitFor({ timeout: EFFECT })

      // the keyboard down, the box still focused: a hardware keyboard, whose Enter sends
      await keyboard(false)
      await twoRows('keyboard down, focused')
      await cin.pressSequentially('from a keyboard')
      await sending(() => cin.press('Enter'))
      await twoRows('keyboard down, after sending')
    } catch (e) {
      // a step that never happened (a button that never came, a key that did nothing): the scene stops there
      fails.push(`stopped: ${(e as Error).message.split('\n')[0]}`)
    }
    // exactly the two messages, in order, each whole and to this chat
    const expected = [{ chat, text: 'line one\nline two' }, { chat, text: 'from a keyboard' }]
    const got = sent.map(({ chat, text }) => ({ chat, text }))
    want(JSON.stringify(got) === JSON.stringify(expected), `sent ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`)
    return { name, fails }
  } finally {
    await ctx.close()
  }
}

/** The @, # and / lists (fork, "Writing: the @, # and / lists fit the room"): each opens in the room left between the
 *  box and its pane's header, the on-screen keyboard up on a phone, and with more rows than fit uses that room; 20
 *  presses of Down, then of Up, keep the chosen row inside the list, and only the list scrolls. */
type ListScene = { width: number; height: number; where: 'space' | 'task'; phone: boolean }
async function checkLists(browser: Browser, base: string, s: ListScene) {
  const name = `lists ${s.where} ${s.width}×${s.height}${s.phone ? ' keyboard up' : ' desktop'}`
  const chat = CHAT[s.where]
  const ctx = await browser.newContext(s.phone
    ? { viewport: { width: s.width, height: TALL }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }
    : { viewport: { width: s.width, height: s.height } })
  const fails: string[] = []
  const want = (ok: boolean, what: string) => void (ok || fails.push(what))
  try {
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(s.where === 'task' ? `${base}?task=SHOP-15` : `${base}?place=${encodeURIComponent(CHAT.space)}`)
    const box = page.locator(`.cbox:has(> .crow textarea.cin[data-box="${chat}"]) >> visible=true`)
    const cin = box.locator(':scope > .crow textarea.cin')
    await cin.waitFor()
    if (s.phone) {
      await cin.tap()
      await page.setViewportSize({ width: s.width, height: s.height })
      await page.waitForFunction(() => document.documentElement.classList.contains('kb-up'))
    } else await cin.click()
    const list = box.locator(':scope > .mlist')
    /** the list, the box and the pane's header as they sit now, and the chosen row */
    const where = () => list.evaluate((el) => {
      const r = (e: Element) => e.getBoundingClientRect()
      const head = el.closest('.col')?.querySelector(':scope > .hd')
      const row = el.querySelector('[role="option"][aria-selected="true"]')
      const cs = getComputedStyle(el)
      return {
        top: r(el).top, bottom: r(el).bottom, inner: [r(el).top + parseFloat(cs.borderTopWidth), r(el).bottom - parseFloat(cs.borderBottomWidth)],
        box: r(el.parentElement!).top, head: head ? r(head).bottom : 0, over: el.scrollHeight > el.clientHeight + 1,
        cap: parseFloat(getComputedStyle(document.documentElement).fontSize) * 22, height: el.clientHeight,
        row: row ? [r(row).top, r(row).bottom] : null, index: [...el.querySelectorAll('[role="option"]')].indexOf(row!),
        page: (document.scrollingElement?.scrollTop ?? 0) + (window.visualViewport?.offsetTop ?? 0),
      }
    })
    for (const key of ['@', '#', '/']) {
      await cin.fill('')
      await cin.pressSequentially(key)
      try {
        await list.locator('[role="option"]').first().waitFor()
      } catch {
        fails.push(`${key}: its list never showed a row`)
        continue
      }
      await frames(page)
      const at = await where()
      want(at.top >= at.head - 1, `${key}: the list starts ${(at.head - at.top).toFixed(0)}px over the pane's header`)
      want(at.bottom <= at.box, `${key}: the list covers the box by ${(at.bottom - at.box).toFixed(0)}px`)
      // more rows than fit: the list takes the room up to the header (its 8px of air), or its 22rem cap
      if (at.over) want(at.top - at.head <= 16 || at.height >= at.cap - 2, `${key}: the list leaves ${(at.top - at.head).toFixed(0)}px of its room unused`)
      for (const arrow of ['ArrowDown', 'ArrowUp']) {
        for (let i = 1; i <= 20; i++) {
          await cin.press(arrow)
          await frames(page)
          const now = await where()
          if (!now.row) { fails.push(`${key}: no row chosen after ${arrow} ×${i}`); break }
          if (now.row[0] < now.inner[0] - 0.5 || now.row[1] > now.inner[1] + 0.5) {
            fails.push(`${key}: after ${arrow} ×${i} the chosen row (${now.index + 1}) is out of the list's view`)
            break
          }
          if (now.page) { fails.push(`${key}: ${arrow} ×${i} scrolled the page by ${now.page}px, not only the list`); break }
        }
      }
      if (s.phone && key === '@' && shots) await page.screenshot({ path: `${shots}/${name.replace(/[^\w]+/g, '-')}.png` })
      await cin.press('Escape')
    }
    return { name, fails }
  } catch (e) {
    fails.push(`stopped: ${(e as Error).message.split('\n')[0]}`)
    return { name, fails }
  } finally {
    await ctx.close()
  }
}
const LISTS: ListScene[] = [
  ...[320, 390].flatMap((width) => (['space', 'task'] as const).map((where) => ({ width, height: TALL - KEYBOARD, where, phone: true }))),
  { width: 1280, height: 800, where: 'space', phone: false },
  { width: 1280, height: 800, where: 'task', phone: false },
]

/** every width, place and state at Zoom 100%; Zoom 125% (where the bar wrapped on the person's iPhone); voice on */
const SCENES: Scene[] = []
for (const width of [320, 390])
  for (const where of ['space', 'task'] as const)
    for (const working of [false, true]) SCENES.push({ width, where, working })
for (const width of [320, 390]) SCENES.push({ width, where: 'space', working: true, zoom: 125 }, { width, where: 'task', working: false, zoom: 125 })
for (const width of [320, 390]) SCENES.push({ width, where: 'space', working: false, voice: true }, { width, where: 'task', working: false, voice: true })

const demo = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
const started = performance.now()
let failed = 0
try {
  const runs = [...SCENES.map((s) => () => check(browser, demo.url, s)), ...LISTS.map((s) => () => checkLists(browser, demo.url, s))]
  for (const run of runs) {
    const { name, fails } = await run()
    if (!fails.length) console.log(`ok    ${name}`)
    else {
      failed++
      console.log(`FAIL  ${name}`)
      for (const f of fails) console.log(`        ${f}`)
    }
  }
  const took = ((performance.now() - started) / 1000).toFixed(1)
  if (failed) {
    console.log(`phone box check: ${failed} of ${runs.length} scenes broken (${took}s)`)
    process.exitCode = 1
  } else console.log(`phone box check: ${runs.length} scenes in ${took}s; two rows down, one row up, Return a new line, send and Enter send; the @, # and / lists fit and keep their row in view`)
} finally {
  await browser.close()
  demo.server.kill()
}
