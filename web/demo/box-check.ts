// Box check (fork #105): on a phone with the keyboard down, the message box is two rows from 320 px: the text, then
// one bar with + on the left, the model line taking what is left (cut, never wrapped) and send or stop on the right.
// Opens the built demo in a headless Chrome whose pointer is a finger, at 320 and 390 px, Zoom 100% and 125%, in a
// space's chat and a task's thread, with a long model line ("Opus 5.5 Xhigh · bypass"), idle (send) and working
// (stop), with voice off (the box's own send and stop) and on (the microphone and its round button). At Zoom 200% on
// a 320 px phone one bar can't fit: the bar may wrap there, but send never leaves the box.
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

type Scene = { width: number; zoom: number; where: 'space' | 'task'; working: boolean; voice: boolean }

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.where} ${s.width}px zoom ${s.zoom}% ${s.working ? 'working' : 'idle'}${s.voice ? ' voice' : ''}`
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
        if (v.type === 'chat' && v.chat) Object.assign(v.chat, { agent: LONG, working: s.working, finished: false })
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
    await page.waitForFunction(() => document.querySelector('.cbar .agent .m')?.textContent === 'Opus 5.5')
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    const m = await box.evaluate((el) => {
      const r = (e: Element | null) => e!.getBoundingClientRect()
      const bar = el.querySelector(':scope > .cbar')!
      const kids = [...bar.children].filter((k) => r(k).width > 0 && r(k).height > 0)
      const agent = bar.querySelector(':scope > .agent')!
      return {
        box: r(el).height,
        text: r(el.querySelector(':scope > .crow')).height,
        rows: new Set(kids.map((k) => Math.round(r(k).top + r(k).height / 2))).size,
        mids: kids.map((k) => r(k).top + r(k).height / 2),
        first: kids[0]!.matches('.ib'),
        last: kids[kids.length - 1]!.matches('.send'),
        lastRight: r(bar).right - r(kids[kids.length - 1]!).right,
        agentOver: agent.scrollWidth - agent.clientWidth,
        bar: r(bar).width,
        // the round button inside the box, never past its edge
        roundOut: Math.max(r(bar.querySelector(':scope > .send')).right - r(el).right, r(bar.querySelector(':scope > .send')).bottom - r(el).bottom),
        zoom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom')) || 1,
      }
    })
    if (shots) await box.screenshot({ path: `${shots}/${name.replace(/[^\w]+/g, '-')}.png` })
    assert.ok(m.roundOut <= 0, `${name}: send/stop sticks out of the box by ${m.roundOut}px`)
    // the model line is cut inside its own width, never pushed out of it
    assert.ok(m.agentOver <= 1, `${name}: the model line overflows by ${m.agentOver}px`)
    // too narrow for one bar (a 320px phone at Zoom 150% and up): upstream's own rows, nothing cut off
    if (s.zoom > 125) return name
    // one bar: every visible part of it sits on one line, + first, the round button last at the right edge
    const spread = Math.max(...m.mids) - Math.min(...m.mids)
    assert.ok(spread <= 3 * m.zoom, `${name}: the bar's parts are on more than one line (${m.rows} rows, ${spread.toFixed(1)}px apart)`)
    assert.ok(m.first, `${name}: + is not first in the bar`)
    assert.ok(m.last && m.lastRight <= 8 * m.zoom, `${name}: send/stop is not at the bar's right end`)
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
try {
  for (const width of [320, 390])
    for (const zoom of [100, 125])
      for (const where of ['space', 'task'] as const)
        for (const working of [false, true])
          for (const voice of [false, true]) {
            if (voice && working) continue
            console.log(`ok  ${await check(browser, demo.url, { width, zoom, where, working, voice })}`)
            n++
          }
  // the biggest zoom on the narrowest phone, the microphone on: the bar may wrap, but nothing leaves the box
  for (const where of ['space', 'task'] as const) {
    console.log(`ok  ${await check(browser, demo.url, { width: 320, zoom: 200, where, working: false, voice: true })}`)
    n++
  }
  console.log(`box check: ${n} scenes, the bar one line in each up to Zoom 125%, nothing cut off at 200%`)
} finally {
  await browser.close()
  demo.server.kill()
}
