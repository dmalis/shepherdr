// The speed budgets of docs/design.md, measured on the demo: loads (cold and warm, a phone profile and full speed),
// typing and switching (event timing), a long chat's scroll, script per live update, memory after a feed, idle work.
// A fresh demo each run: the long part adds 400 messages to #blog. Run it 3 times and report the middle run.
//   bun run build && bun web/demo/serve.ts 7841 &   then   bun web/demo/perf-check.ts 7841 [load|type|switch|long|live]
import { chromium, type Page, type BrowserContext } from 'playwright-core'
import { chrome } from './tap-check.ts'

const port = Number(process.argv[2] || 7841)
const part = process.argv[3] ?? 'all'
const B = `http://127.0.0.1:${port}/`
const SHOP = 'p:mac-mini:shop', BLOG = 'p:mac-mini:blog', EV = 'p:mac-mini:~'
const out: Record<string, unknown> = {}
const log = (k: string, v: unknown) => { out[k] = v; console.log(k, JSON.stringify(v)) }
const browser = await chromium.launch({ executablePath: chrome(), args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] })

const INIT = () => {
  try { for (const k of ['shepherdr.ui', 'shepherdr.at', 'shepherdr.drafts']) localStorage.removeItem(k) } catch {}
  const w = window as any
  w.__ev = []; w.__lt = []
  new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) w.__ev.push({ name: e.name, d: e.duration, id: e.interactionId, t: e.startTime }) }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as any)
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push({ d: e.duration, t: e.startTime }) }).observe({ type: 'longtask', buffered: true })
  // time spent in socket message handlers, and DOM mutations after each
  w.__ws = { n: 0, ms: 0, max: 0, muts: 0 }
  const Orig = WebSocket
  w.WebSocket = class extends Orig {
    constructor(u: string | URL, p?: string | string[]) {
      super(u, p)
      super.addEventListener('message', () => { w.__wsT = performance.now() }, { capture: true } as any)
    }
    set onmessage(f: any) { super.onmessage = (ev: MessageEvent) => { const t = performance.now(); f.call(this, ev); const d = performance.now() - t; w.__ws.n++; w.__ws.ms += d; w.__ws.max = Math.max(w.__ws.max, d) } }
    get onmessage() { return super.onmessage }
    addEventListener(type: string, f: any, o?: any) {
      if (type !== 'message' || typeof f !== 'function') return super.addEventListener(type, f, o)
      return super.addEventListener(type, (ev: Event) => { const t = performance.now(); f.call(this, ev); const d = performance.now() - t; w.__ws.n++; w.__ws.ms += d; w.__ws.max = Math.max(w.__ws.max, d) }, o)
    }
  }
  addEventListener('DOMContentLoaded', () => new MutationObserver((m) => { w.__ws.muts += m.length }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }))
}

async function phoneCtx(throttle: boolean): Promise<{ ctx: BrowserContext; page: Page; cdp: any }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 })
  await ctx.addInitScript(INIT)
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Performance.enable')
  if (throttle) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    // a phone: 4x slower CPU over Lighthouse's slow 4G (1.6 Mbps down, 750 kbps up, 150 ms)
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 })
  }
  return { ctx, page, cdp }
}

async function load(page: Page, cdp: any, url: string) {
  let bytes = 0, reqs = 0
  const on = (e: any) => { bytes += e.encodedDataLength; reqs++ }
  cdp.on('Network.loadingFinished', on)
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'load', timeout: 120000 })
  const loadMs = Date.now() - t0
  await page.waitForSelector('.msgs .b, .msgs .card, .empty', { timeout: 120000 })
  const readyMs = Date.now() - t0
  await page.waitForTimeout(1500)
  cdp.off('Network.loadingFinished', on)
  const paint = await page.evaluate(() => new Promise<any>((res) => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime
    let lcp = 0
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    setTimeout(() => res({ fcp: Math.round(fcp ?? -1), lcp: Math.round(lcp), longTasks: (window as any).__lt.length, longTaskMs: Math.round((window as any).__lt.reduce((s: number, x: any) => s + x.d, 0)), dom: document.getElementsByTagName('*').length }), 300)
  }))
  return { loadMs, readyMs, kB: Math.round(bytes / 1024), reqs, ...paint }
}

function interactions(evs: { name: string; d: number; id: number }[]) {
  const by = new Map<number, number>()
  for (const e of evs) if (e.id) by.set(e.id, Math.max(by.get(e.id) ?? 0, e.d))
  const ds = [...by.values()].sort((a, b) => a - b)
  const p = (q: number) => ds.length ? Math.round(ds[Math.min(ds.length - 1, Math.floor(ds.length * q))]!) : 0
  return { n: ds.length, p50: p(0.5), p98: p(0.98), max: Math.round(ds.at(-1) ?? 0) }
}

const post = (a: object) => fetch(B + 'api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })

if (part === 'all' || part === 'load') {
  for (const th of [true, false]) {
    const { ctx, page, cdp } = await phoneCtx(th)
    log(`load.cold.${th ? 'phone4x-slow4g' : 'unthrottled'}`, await load(page, cdp, B + '?place=' + encodeURIComponent(SHOP)))
    await page.evaluate(() => { (window as any).__lt.length = 0 })
    log(`load.warm.${th ? 'phone4x-slow4g' : 'unthrottled'}`, await load(page, cdp, B + '?place=' + encodeURIComponent(SHOP)))
    await ctx.close()
  }
}

if (part === 'all' || part === 'type') {
  const { ctx, page, cdp } = await phoneCtx(false)
  await page.goto(B + '?place=' + encodeURIComponent(SHOP), { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const box = page.locator('textarea').first()
  await box.click()
  for (const [label, pre] of [['short', ''], ['long-draft-2k', 'Lorem ipsum dolor sit amet, the checkout button is cut off on small phones. '.repeat(27)]] as const) {
    await box.fill(pre)
    await page.evaluate(() => { (window as any).__ev.length = 0 })
    await page.keyboard.type('The total jumps when the coupon field opens, can you check it on the small iPhone too?', { delay: 60 })
    await page.waitForTimeout(600)
    log(`inp.typing.phone4x.${label}`, interactions(await page.evaluate(() => (window as any).__ev)))
  }
  await box.fill('')
  await ctx.close()
}

if (part === 'all' || part === 'switch') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(INIT)
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page)
  await page.goto(B + '?place=' + encodeURIComponent(EV), { waitUntil: 'networkidle' }); await page.waitForTimeout(800)
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    await page.evaluate(() => { (window as any).__ev.length = 0 })
    const rows = page.locator('.side button.row')
    const n = Math.min(await rows.count(), 12)
    for (let i = 0; i < n; i++) { await rows.nth(i).click(); await page.waitForTimeout(500) }
    // and the Tasks pane open and shut, a task open
    log(`inp.switch-chat.desktop${rate}x`, interactions(await page.evaluate(() => (window as any).__ev)))
  }
  await ctx.close()
}

if (part === 'all' || part === 'long') {
  // a long chat: 400 messages in #blog, some long, some with lists and code
  const texts = ['Done. The page loads in 1.2 s now.', 'Can you check the **RSS** feed too?', 'Here is what changed:\n\n- the feed has full posts\n- dates are ISO\n- `rss.xml` is cached for an hour', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6)]
  for (let i = 0; i < 400; i++) await post({ type: 'send', chat: BLOG, text: `${i} ${texts[i % 4]}`, cid: `perf-${Date.now()}-${i}` })
  const { ctx, page, cdp } = await phoneCtx(false)
  const t0 = Date.now()
  await page.goto(B + '?place=' + encodeURIComponent(BLOG), { waitUntil: 'networkidle' })
  await page.waitForSelector('.msgs .b')
  const open = Date.now() - t0
  await page.waitForTimeout(1500)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const r = await page.evaluate(async () => {
    const w = window as any; w.__lt.length = 0
    const sc = [...document.querySelectorAll<HTMLElement>('.chat .scroll, .scroll')].find((s) => s.scrollHeight > s.clientHeight + 100)!
    const frames: number[] = []; let last = performance.now()
    const total = sc.scrollHeight
    for (let i = 0; i < 120; i++) {
      sc.scrollTop = sc.scrollTop - 120
      await new Promise((r) => requestAnimationFrame(() => r(0)))
      const now = performance.now(); frames.push(now - last); last = now
    }
    frames.sort((a, b) => a - b)
    return { scrollHeight: total, msgs: document.querySelectorAll('.msgs > *').length, dom: document.getElementsByTagName('*').length, frameP50: Math.round(frames[60]!), frameP95: Math.round(frames[114]!), frameMax: Math.round(frames.at(-1)!), over33: frames.filter((f) => f > 33).length, longTasks: w.__lt.length, longTaskMs: Math.round(w.__lt.reduce((s: number, x: any) => s + x.d, 0)) }
  })
  log('long-chat.open-ms', open)
  log('long-chat.scroll.phone4x', r)
  await ctx.close()
}

if (part === 'all' || part === 'live') {
  const { ctx, page, cdp } = await phoneCtx(false)
  await page.goto(B + '?place=' + encodeURIComponent(SHOP), { waitUntil: 'networkidle' }); await page.waitForTimeout(1500)
  await cdp.send('HeapProfiler.collectGarbage')
  const m0 = (await cdp.send('Performance.getMetrics')).metrics
  const get = (ms: any[], n: string) => ms.find((x) => x.name === n)?.value ?? 0
  await page.evaluate(() => { const w = window as any; w.__ws = { n: 0, ms: 0, max: 0, muts: 0 }; w.__lt.length = 0 })
  // an hour's feed, sped up: 300 updates from other chats (each pushes a snapshot to this page)
  for (let i = 0; i < 300; i++) { await post({ type: 'send', chat: i % 2 ? 'p:mac-mini:notes' : 'p:mac-mini:docs', text: `update ${i}`, cid: `live-${Date.now()}-${i}` }); if (i % 20 === 0) await page.waitForTimeout(50) }
  await page.waitForTimeout(2500)
  await cdp.send('HeapProfiler.collectGarbage')
  const m1 = (await cdp.send('Performance.getMetrics')).metrics
  const ws = await page.evaluate(() => { const w = window as any; return { ...w.__ws, longTasks: w.__lt.length } })
  log('live.per-update', { updates: ws.n, msTotal: Math.round(ws.ms), msPerUpdate: +(ws.ms / Math.max(1, ws.n)).toFixed(2), msMax: Math.round(ws.max), mutationsPerUpdate: Math.round(ws.muts / Math.max(1, ws.n)), longTasks: ws.longTasks, scriptMs: Math.round((get(m1, 'ScriptDuration') - get(m0, 'ScriptDuration')) * 1000), layoutMs: Math.round((get(m1, 'LayoutDuration') - get(m0, 'LayoutDuration')) * 1000), styleMs: Math.round((get(m1, 'RecalcStyleDuration') - get(m0, 'RecalcStyleDuration')) * 1000) })
  log('memory.heapMB', { before: +(get(m0, 'JSHeapUsedSize') / 1e6).toFixed(1), after300Updates: +(get(m1, 'JSHeapUsedSize') / 1e6).toFixed(1), nodesBefore: get(m0, 'Nodes'), nodesAfter: get(m1, 'Nodes'), listenersBefore: get(m0, 'JSEventListeners'), listenersAfter: get(m1, 'JSEventListeners') })

  // idle: 20 s with nothing happening, visible, then hidden (another tab in front)
  const idle = async () => { const a = (await cdp.send('Performance.getMetrics')).metrics; await page.waitForTimeout(20000); const b = (await cdp.send('Performance.getMetrics')).metrics; return { taskMs: Math.round((get(b, 'TaskDuration') - get(a, 'TaskDuration')) * 1000), scriptMs: Math.round((get(b, 'ScriptDuration') - get(a, 'ScriptDuration')) * 1000), layouts: get(b, 'LayoutCount') - get(a, 'LayoutCount'), styles: get(b, 'RecalcStyleCount') - get(a, 'RecalcStyleCount') } }
  log('idle.visible-20s', await idle())
  const other = await ctx.newPage(); await other.goto('about:blank'); await other.bringToFront()
  log('idle.hidden-state', await page.evaluate(() => document.visibilityState))
  log('idle.hidden-20s', await idle())
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify(out))
