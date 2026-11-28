// A long chat on the built demo (dmalis/shepherdr#190): it opens on its newest messages and draws the older ones right
// after, so each check starts at that first paint, before the rest has come in:
// - on a phone, it ends at its newest message once it is all in;
// - the reader's row stays where it was while the older rows come in above it, and when an earlier page comes;
// - a quote of a message far up jumps to it, centred, even before that message was drawn;
// - the browser's find reaches the oldest message, and a selection made at once keeps its words;
// - scrolling up through folded long replies never leaves the list blank and never jumps (upstream's "Scrolling up
//   into a folded long reply makes the chat list go blank", in its window's chat).
// Run by web/demo/scroll-check.ts in Chromium, and in WebKit where one runs (SCROLL_WEBKIT).
import assert from 'node:assert/strict'
import type { Browser, Page } from 'playwright-core'
import { EV } from './data.ts'
import type { Chat, Message } from '../shared/types.ts'

const N = 400
const BLOG = 'p:mac-mini:blog'
const LONG = ['A long reply:', ...Array.from({ length: 40 }, (_, i) => `- line ${i + 1} of the long reply`)].join('\n')
const row = (i: number): Message => ({
  id: `h${i}`,
  who: i % 2 ? 'you' : 'agent',
  text: i === 7 ? 'Needle in the oldest messages' : i % 40 === 25 ? LONG : `History message ${i}`,
})
const history = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => row(from + i))
// the newest: your reply to a message far up
const quote: Message = { id: 'quote', who: 'you', text: 'About that one', reply: { id: 'h30', text: 'History message 30', who: 'agent' } }

/** what a check uses in the page: a row's top from the scroller's top edge, the row at that edge, a wait for the
 *  whole chat to be drawn, and a wait for frames */
type Helpers = { rowAt: (row: Element) => number; topRow: () => Element; whole: () => Promise<void>; frames: (n: number) => Promise<void> }
/** run in the page at the long chat's first paint (its newest message drawn, before any step after it) */
type AtFirst = (sc: HTMLElement, h: Helpers) => unknown
type Place = { id: string; before: number; after: number }

/** installed before the page loads: it runs `check` at the first paint and keeps what it says in window.__out */
function install(ev: string, check: AtFirst, mark: string) {
  const w = window as unknown as { __out: Promise<{ drawn: number; out: unknown }> }
  w.__out = new Promise((done) => {
    const ready = () => {
      const sc = document.querySelector<HTMLElement>(`[data-scroll="${CSS.escape(ev)}"]`)
      if (!sc?.querySelector(mark)) return false
      mo.disconnect()
      const frames = (n: number) => new Promise<void>((res) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : res()); f() })
      const h: Helpers = {
        // a row stays the same element while older ones come in (React keeps it by its key): a moved row has moved
        rowAt: (row) => {
          if (!row.isConnected) throw new Error('the row at the top was drawn again')
          return row.getBoundingClientRect().top - sc.getBoundingClientRect().top
        },
        // a message or a card, the first one reaching into the scroller
        topRow: () => {
          const rows = [...sc.querySelectorAll<HTMLElement>('.msgs > *')]
          const row = rows.find((r) => r.getBoundingClientRect().height > 0 && r.getBoundingClientRect().bottom > sc.getBoundingClientRect().top + 1)
          if (!row) throw new Error(`no row at the top: ${rows.length} rows, scrollTop ${sc.scrollTop} of ${sc.scrollHeight}`)
          return row
        },
        whole: () => new Promise<void>((res) => { const f = () => (sc.querySelector('[data-msg="h0"]') ? frames(2).then(res) : requestAnimationFrame(f)); f() }),
        frames,
      }
      // the first frame with the chat in it: the older rows come in only after it has painted
      requestAnimationFrame(() => {
        const drawn = sc.querySelectorAll('.msgs [data-msg]').length
        Promise.resolve()
          .then(() => check(sc, h))
          .then((out) => done({ drawn, out }), (e) => done({ drawn, out: { error: String(e?.stack ?? e) } }))
      })
      return true
    }
    const mo = new MutationObserver(ready)
    addEventListener('DOMContentLoaded', () => ready() || mo.observe(document.body, { childList: true, subtree: true }))
  })
}

/** the Everything chat holds `rows`; an "earlier" action gets `older` put in front, once. With `under`: that chat
 *  of the demo keeps its own messages, with `rows` before them */
async function serve(page: Page, rows: Message[], older: Message[] = [], under?: string) {
  let chat: Chat = { key: EV, messages: rows, cli: 'claude', earlier: older.length > 0, top: !older.length }
  let send: ((s: string) => void) | undefined
  await page.routeWebSocket('**/api/ws', (ws) => {
    const demo = ws.connectToServer()
    send = (s) => ws.send(s)
    demo.onMessage((data) => {
      const msg = JSON.parse(String(data))
      if (under && msg.type === 'chat' && msg.chat?.key === under) return ws.send(JSON.stringify({ ...msg, chat: { ...msg.chat, messages: [...rows, ...msg.chat.messages], earlier: false, top: true } }))
      ws.send(msg.type === 'chat' && msg.chat?.key === EV ? JSON.stringify({ type: 'chat', chat }) : data)
    })
  })
  await page.route('**/api/action', async (route) => {
    const action = route.request().postDataJSON()
    if (action?.type === 'earlier' && action.chat === EV && older.length) {
      chat = { ...chat, messages: [...older, ...chat.messages], earlier: false, top: true }
      older = []
      setTimeout(() => send?.(JSON.stringify({ type: 'chat', chat })), 50)
    }
    // the page may be closed by now (its check is done)
    await route.continue().catch(() => undefined)
  })
}

export async function longChat(browser: Browser, base: string, name: string) {
  async function open<T>(rows: Message[], check: AtFirst, older?: Message[], phone = false, under?: string) {
    const key = under ?? EV
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 844 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1, serviceWorkers: 'block' })
    const page = await ctx.newPage()
    page.setDefaultTimeout(15000)
    await serve(page, rows, older, under)
    await page.addInitScript({ content: `(${install})(${JSON.stringify(key)}, ${check}, ${JSON.stringify(under ? '[data-msg]' : '[data-msg="quote"]')})` })
    await page.goto(base + '?place=' + encodeURIComponent(key), { waitUntil: 'commit' })
    const got = (await page.evaluate(() => (window as unknown as { __out: Promise<unknown> }).__out)) as { drawn: number; out: T }
    const error = (got.out as { error?: string } | null)?.error
    if (error) throw new Error(`${name}: the check failed in the page: ${error}`)
    return { ...got, page, close: () => ctx.close() }
  }
  const all = [...history(0, N), quote]
  const held = (what: string, o: Place) =>
    assert.ok(Math.abs(o.after - o.before) <= 1, `${name}: ${o.id} stays in place as ${what} (moved ${o.after - o.before}px)`)

  // the reader moves up into the history right after the first paint, before the first step and before their scroll
  // event (past the demo's cards at the foot, whose own evidence may still be coming in); the older rows come in
  // above without moving their row; find then reaches the oldest message
  {
    const { drawn, out, page, close } = await open<Place>(all, async (sc, h) => {
      await new Promise((res) => setTimeout(res))
      // the reader's wheel, then the scroll it makes (its scroll event comes a frame later)
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
      // h370: N - 30 (the check runs in the page, which has no N)
      sc.querySelector('[data-msg="h370"]')!.scrollIntoView({ block: 'start' })
      sc.scrollTop += 17
      const row = h.topRow(), before = h.rowAt(row)
      await h.whole()
      return { id: row.querySelector('[data-msg]')?.getAttribute('data-msg') ?? row.className, before, after: h.rowAt(row) }
    })
    assert.ok(drawn < N / 2, `${name}: the first paint draws the newest messages, not all ${N} (drew ${drawn})`)
    held('older messages come in', out)
    const found = await page.evaluate(() =>
      (window as unknown as { find: (s: string, c: boolean, b: boolean, wrap: boolean) => boolean }).find('Needle in the oldest messages', false, false, true) &&
      !!getSelection()?.anchorNode?.parentElement?.closest('[data-msg="h7"]'))
    assert.ok(found, `${name}: find in page reaches the oldest message`)
    await close()
  }

  // on a phone, untouched, a long chat ends at its newest message once it is all in (the demo's #blog, with its cards
  // and folds at the end): what gets shorter and longer again after its first layout isn't the reader moving up
  {
    const { out, close } = await open<number>(all, async (sc, h) => {
      await new Promise<void>((res) => { const f = () => (sc.querySelector('[data-msg="h0"]') ? res() : requestAnimationFrame(f)); f() })
      await h.frames(10)
      return sc.scrollHeight - sc.clientHeight - sc.scrollTop
    }, undefined, true, BLOG)
    assert.ok(Math.abs(out) <= 2, `${name}: on a phone the long chat ends at its newest message (${out}px above it)`)
    await close()
  }

  // an earlier page comes while the reader is at the very top (where a wheel or a fling ends): their row stays put
  {
    const { out, close } = await open<Place>(history(200, N).concat(quote), async (sc, h) => {
      await new Promise<void>((res) => { const f = () => (sc.querySelector('[data-msg="h200"]') ? res() : requestAnimationFrame(f)); f() })
      await h.frames(2)
      sc.scrollTop = 0
      await h.frames(1)
      const row = h.topRow(), before = h.rowAt(row)
      await h.whole()
      return { id: row.querySelector('[data-msg]')?.getAttribute('data-msg') ?? row.className, before, after: h.rowAt(row) }
    }, history(0, 200))
    held('an earlier page comes in', out)
    await close()
  }

  // a quote of a message far up, tapped before it is drawn: it jumps there, centred. A longer chat, so the tap can wait
  // for the foot to settle (the demo's bar of things that need a look comes in a moment after the chat) and still
  // come before the older rows are in
  {
    const { out, close } = await open<{ drawn: boolean; off: number }>([...history(0, 5 * N), quote], async (sc, h) => {
      for (let tall = 0, same = 0; same < 5; await h.frames(1)) same = sc.clientHeight === tall ? same + 1 : ((tall = sc.clientHeight), 0)
      const drawn = !!sc.querySelector('[data-msg="h30"]')
      sc.querySelector<HTMLElement>('[data-msg="quote"] .quote')!.click()
      await new Promise<void>((res) => { const f = () => (sc.querySelector('[data-msg="h30"]') ? res() : requestAnimationFrame(f)); f() })
      await h.frames(2)
      const r = sc.querySelector('[data-msg="h30"]')!.getBoundingClientRect(), v = sc.getBoundingClientRect()
      return { drawn, off: (r.top + r.bottom) / 2 - (v.top + v.bottom) / 2 }
    })
    assert.ok(!out.drawn, `${name}: the quoted message wasn't drawn yet when its quote was tapped`)
    assert.ok(Math.abs(out.off) < 2, `${name}: the quoted message is centred (off by ${out.off}px)`)
    await close()
  }

  // a selection made at the first paint keeps its words while the rest comes in; scrolling up through the folded
  // long replies never leaves the list blank, and never jumps
  {
    const { out, page, close } = await open<{ before: string; after: string }>(all, async (sc, h) => {
      const r = document.createRange()
      r.setStartBefore(sc.querySelector('[data-msg="h390"] .md')!)
      r.setEndAfter(sc.querySelector('[data-msg="h395"] .md')!)
      getSelection()!.removeAllRanges()
      getSelection()!.addRange(r)
      const before = getSelection()!.toString()
      await h.whole()
      return { before, after: getSelection()!.toString() }
    })
    assert.match(out.before, /History message 390[\s\S]*History message 395/, `${name}: the selection holds the messages it spans`)
    assert.equal(out.after, out.before, `${name}: the selection keeps its words as older messages come in`)
    const { blank, jumps } = await page.evaluate((ev) => new Promise<{ blank: number[]; jumps: number[][] }>((done) => {
      const sc = document.querySelector<HTMLElement>(`[data-scroll="${CSS.escape(ev)}"]`)!
      const blank: number[] = []
      const jumps: number[][] = []
      let want = sc.scrollTop
      const step = () => {
        const v = sc.getBoundingClientRect()
        const shown = [...sc.querySelectorAll('.msgs > *')].some((el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.bottom > v.top && r.top < v.bottom })
        if (!shown) blank.push(sc.scrollTop)
        if (Math.abs(sc.scrollTop - want) > 1) jumps.push([want, sc.scrollTop])
        if (sc.scrollTop <= 0) return done({ blank, jumps })
        want = Math.max(0, sc.scrollTop - 400)
        sc.scrollTop = want
        requestAnimationFrame(() => requestAnimationFrame(step))
      }
      step()
    }), EV)
    assert.deepEqual(blank, [], `${name}: the list is never blank scrolling up through folded replies`)
    assert.deepEqual(jumps, [], `${name}: scrolling up through folded replies never jumps`)
    const folds = await page.locator(`[data-scroll="${EV}"] .mfold.clip`).count()
    assert.ok(folds >= 5, `${name}: the long replies are folded (${folds})`)
    await close()
  }
  console.log(`${name}: a long chat opens on its newest messages; place, quotes, find, selection and folds hold`)
}
