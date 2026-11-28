// Box check (fork #105): on a phone with the keyboard down, the message box is two rows: the text, then one bar with
// + on the left, the model line taking what is left (cut, never wrapped) and send or stop on the right. Opens the
// built demo in a headless Chrome whose pointer is a finger, at 320 and 390 px and Zoom 100% to 200%, in a space's
// chat and a task's thread, with a long model line ("Opus 5.5 Xhigh · bypass"), idle (send) and working (stop), with
// voice off (the box's own send and stop) and on (the microphone and its round button), and with Update <agent>.
// Wherever the box has room for one bar with a readable model line (phone-bar.css: 168px in the app's own px, 48px
// more for each button past + and send), the bar is one line; below that it may wrap, but send never leaves the box.
//
//   bun run build && bun web/demo/box-check.ts [--shots <dir>]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, type Browser } from 'playwright-core'
import { chrome } from './tap-check.ts'

const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : ''
if (shots) mkdirSync(shots, { recursive: true })

async function startDemo() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', new URL('./serve.ts', import.meta.url).pathname, String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* still starting */ }
    await Bun.sleep(100)
  }
  server.kill()
  throw new Error('The built demo did not start')
}

/** the long model line the person saw: the effort and a permission mode that isn't the agent's default */
const LONG = { kind: 'claude', model: 'opus', modelLabel: 'Opus 5.5', effort: 'xhigh', perm: 'bypass' }
/** one bar's room, in the app's own px (phone-bar.css): + and send alone, then each more button */
const ONE_BAR = 168
const PER_BUTTON = 48

type Scene = { width: number; zoom: number; where: 'space' | 'task'; working: boolean; voice: boolean; update?: boolean }

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.where} ${s.width}px zoom ${s.zoom}% ${s.working ? 'working' : 'idle'}${s.voice ? ' voice' : ''}${s.update ? ' update' : ''}`
  const ctx = await browser.newContext({ viewport: { width: s.width, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  try {
    await ctx.addInitScript((zoom) => localStorage.setItem('shepherdr.prefs', JSON.stringify({ zoom })), s.zoom)
    if (!s.voice) await ctx.route('**/api/me', (r) => r.fulfill({ json: { login: 'sam', off: ['voice'] } }))
    // every chat the page loads gets the long model line, and is working or not as the scene says
    await ctx.routeWebSocket(/\/api\/ws/, (ws) => {
      const server = ws.connectToServer()
      ws.onMessage((m) => server.send(m))
      server.onMessage((m) => {
        if (typeof m !== 'string') return ws.send(m)
        const v = JSON.parse(m) as { type?: string; chat?: { agent?: unknown; working?: boolean; finished?: boolean }; snapshot?: { off?: string[] } }
        if (v.type === 'chat' && v.chat) Object.assign(v.chat, { agent: { ...LONG, ...(s.update ? { update: '9.0.0' } : {}) }, working: s.working, finished: false })
        // the same plugins off as api/me said, or the page reloads to match
        if (v.type === 'snapshot' && v.snapshot && !s.voice) v.snapshot.off = ['voice']
        ws.send(JSON.stringify(v))
      })
    })
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(s.where === 'task' ? `${base}?task=SHOP-15` : base)
    const box = page.locator('.cbox:has(> .crow + .cbar) >> visible=true').last()
    await box.waitFor()
    const round = s.voice ? box.locator('.cbar > .send') : box.locator(`.cbar > .send[aria-label="${s.working ? 'Stop' : 'Send'}"]`)
    await round.waitFor()
    if (s.update) await box.locator('.cbar > .agent-upd').waitFor()
    await page.waitForFunction(() => document.querySelector('.cbar .agent .m')?.textContent === 'Opus 5.5')
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const m = await box.evaluate((el) => {
      const r = (e: Element | null) => e!.getBoundingClientRect()
      const bar = el.querySelector(':scope > .cbar')!
      const kids = [...bar.children].filter((k) => r(k).width > 0 && r(k).height > 0)
      const agent = bar.querySelector(':scope > .agent')!
      const model = agent.querySelector(':scope > .m')!
      const send = bar.querySelector(':scope > .send')!
      const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1
      return {
        box: r(el).height,
        text: r(el.querySelector(':scope > .crow')).height,
        rows: new Set(kids.map((k) => Math.round(r(k).top + r(k).height / 2))).size,
        mids: kids.map((k) => r(k).top + r(k).height / 2),
        first: kids[0]!.matches('.ib'),
        last: kids[kids.length - 1]!.matches('.send'),
        lastRight: r(bar).right - r(kids[kids.length - 1]!).right,
        agentOver: agent.scrollWidth - agent.clientWidth,
        // the model's name: on screen, and cut with an ellipsis on one line when it doesn't fit
        modelWidth: r(model).width,
        modelCut: getComputedStyle(model).textOverflow === 'ellipsis' && getComputedStyle(model).whiteSpace === 'nowrap',
        // the round button inside the box, never past its edge
        roundOut: Math.max(r(send).right - r(el).right, r(send).bottom - r(el).bottom),
        // the box's width in the app's own px (the container queries' unit), and the buttons past + and send
        room: el.clientWidth / zoom,
        more: bar.querySelectorAll(':scope > .ib').length - 1,
        zoom,
      }
    })
    if (shots) await box.screenshot({ path: `${shots}/${name.replace(/[^\w]+/g, '-')}.png` })
    assert.ok(m.roundOut <= 0, `${name}: send/stop sticks out of the box by ${m.roundOut}px`)
    // the model line is cut inside its own width, never pushed out of it
    assert.ok(m.agentOver <= 1, `${name}: the model line overflows by ${m.agentOver}px`)
    assert.ok(m.modelCut, `${name}: the model's name is not cut with an ellipsis on one line`)
    // too narrow for one bar with a readable model line: upstream's own rows, nothing cut off
    if (m.room < ONE_BAR + PER_BUTTON * m.more) return `${name} (${Math.round(m.room)}px: its own rows)`
    // one bar: every visible part of it sits on one line, + first, the round button last at the right edge
    const spread = Math.max(...m.mids) - Math.min(...m.mids)
    assert.ok(spread <= 3 * m.zoom, `${name}: the bar's parts are on more than one line (${m.rows} rows, ${spread.toFixed(1)}px apart)`)
    assert.ok(m.first, `${name}: + is not first in the bar`)
    assert.ok(m.last && m.lastRight <= 8 * m.zoom, `${name}: send/stop is not at the bar's right end`)
    // the model's name keeps room to be read ("Opus…")
    assert.ok(m.modelWidth >= 28 * m.zoom, `${name}: the model's name has only ${m.modelWidth.toFixed(1)}px`)
    // two rows: the text row and one bar (the bar's tallest part, its padding)
    assert.ok(m.box - m.text <= 64 * m.zoom, `${name}: the bar is ${m.box - m.text}px tall, more than one row`)
    return name
  } finally {
    await ctx.close()
  }
}

const demo = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
let n = 0
const run = async (s: Scene) => (console.log(`ok  ${await check(browser, demo.url, s)}`), n++)
try {
  for (const width of [320, 390])
    for (const zoom of [100, 125])
      for (const where of ['space', 'task'] as const)
        for (const working of [false, true])
          for (const voice of [false, true]) if (!(voice && working)) await run({ width, zoom, where, working, voice })
  // bigger zooms, and the most crowded bar (the microphone and Update <agent>)
  for (const width of [320, 390])
    for (const zoom of [150, 175, 200]) {
      await run({ width, zoom, where: 'space', working: true, voice: false })
      await run({ width, zoom, where: 'space', working: false, voice: true })
    }
  for (const width of [320, 390])
    for (const zoom of [100, 125]) await run({ width, zoom, where: 'space', working: false, voice: true, update: true })
  console.log(`box check: ${n} scenes; the bar one line wherever it has room, nothing cut off anywhere`)
} finally {
  await browser.close()
  demo.server.kill()
}
