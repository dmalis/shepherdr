// fork #117: a swipe in from the left edge opens the spaces list, as Slack and Discord open theirs, following the
// finger; a swipe to the left on the open list (or the shade beside it) closes it the same way. On a phone it works
// on the screens at the top (a space's chat, the Tasks and Artifacts tabs); on a pushed screen (a task, an artifact,
// Settings) the edge stays the system's Back, as on iOS. On a tablet it slides the list over the content while the
// list is hidden, the way iPadOS shows a hidden sidebar. A let-go lands by where the list was carried and how fast
// (motion.ts's fling rules); with less motion the list stays put and fades instead. The menu button and Escape still
// open and close it, for VoiceOver, keyboards and mice.
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { getState, registry, setUI, sideHidden, type UI } from './kernel.ts'
import { hasLayer } from './overlay.tsx'
import { IOS, lands, moveTo, settleMs, still } from './motion.ts'

/** the strip at the left edge (px) a swipe opens the list from. Android's own Back takes about its outer 24 px, so
 *  it is a little wider; a message or task row starting here never slides to reply (chat/press.ts). */
export const EDGE = 32
/** how far a finger moves before the gesture decides which way it goes */
const SLOP = 8
/** a finger held this long before it moves is someone else's (a row's drag in the list): not a swipe */
const LATE_MS = 350
/** a touch at the edge let go within this is a tap (a message's hold menu opens at 450 ms, chat/press.ts HOLD_MS) */
const TAP_MS = 400
/** the list sliding in by its button, and back out after a tap on the shade */
const OPEN_MS = 320
const SHUT_MS = 260

/** the device asks for less motion, or Settings › General › Motion is Reduced: nothing slides, things fade */
const calm = () => still() || (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced')

/** Does a swipe in from the edge open the list now? On a phone only on a screen at the top (a space's chat or a
 *  bar tab), never over Settings, Search or a pushed screen; on a wider screen only while the list is hidden. */
export function edgeOpens(ui: UI, bar: readonly string[] = registry.bar.map((b) => b.pane)): boolean {
  if (ui.drawer || ui.settings || ui.search) return false
  if (ui.phone) return !ui.task && !ui.art && (!ui.pane || bar.includes(ui.pane))
  return sideHidden(ui)
}

/** what keeps a touch at the edge its own: a field, a slider, a terminal, anything marked data-nodrag, an overlay */
const OWN = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"], [data-nodrag], .xterm, .layer, .toasts, [data-ghost]'
/** a control at the edge (a button, a link, a row of the Tasks list): a swipe from it still opens the list, but the
 *  touch is not held back, so a tap on it is its own */
const CONTROL = 'button, a[href], label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"]'

/** something under the finger scrolls sideways (a code block, a table, a terminal): its swipe, not the list's */
function sideways(t: Element | null): boolean {
  for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement)
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  return false
}

/** Does a touch starting at `x` on `target` belong to the edge swipe? `hold`: held back from the page at once (the
 *  system's Back and the page's scroll don't get it); `swipe`: on a control, only once it goes sideways; or no. */
export function claims(x: number, target: Element | null, ui: UI = getState().ui): 'hold' | 'swipe' | null {
  if (x >= EDGE || !edgeOpens(ui) || hasLayer() || target?.closest(OWN) || sideways(target)) return null
  return target?.closest(CONTROL) ? 'swipe' : 'hold'
}

/** Which way a finger went, once past the slop: `open` (right, more than up or down), `shut` (left), or `off` */
export function wayOf(dx: number, dy: number, dir: 1 | -1): 'wait' | 'go' | 'off' {
  if (Math.hypot(dx, dy) < SLOP) return 'wait'
  return dx * dir > 0 && Math.abs(dx) > Math.abs(dy) ? 'go' : 'off'
}

/** how fast the finger went as it let go (px per ms, to the right is +), over its last 100 ms */
export function speed(samples: { t: number; x: number }[], end: { t: number; x: number }, window = 100) {
  const first = samples.find((s) => end.t - s.t <= window)
  if (!first || end.t <= first.t) return 0
  return (end.x - first.x) / (end.t - first.t)
}

/** Does a let-go with the list `open` px out of `w`, at `v`, leave it open? A flick goes its way; else past half. */
export const staysOpen = (open: number, v: number, w: number) => lands(open, v, w / 2)

/* ---------- the list itself ---------- */

type Parts = { nav: HTMLElement; shade: HTMLElement }
/** the list on screen now (SideDrawer puts it here) */
let parts: Parts | null = null
/** a swipe is bringing the list in: it shows where the finger is, not with its own motion */
let swiping = false
/** a swipe just ended: the click its lift makes is not a tap on the shade */
let swipedAt = 0

/** show the list `open` px out of `w` */
function paint({ nav, shade }: Parts, open: number, w: number, quiet: boolean) {
  const f = w > 0 ? Math.min(1, Math.max(0, open / w)) : 0
  if (quiet) nav.style.opacity = String(f)
  else nav.style.transform = `translateX(${Math.min(0, open - w)}px)`
  shade.style.opacity = String(f)
}

/** let the list land open or shut from where it is, at the finger's speed; shut, it closes */
function settle({ nav, shade }: Parts, open: boolean, at: number, v: number, w: number, quiet: boolean) {
  const ms = quiet ? 120 : settleMs(open ? w - at : at, v, open ? OPEN_MS : SHUT_MS)
  void moveTo(shade, { opacity: open ? '1' : '0' }, ms, 'ease-out')
  const to = quiet ? { opacity: open ? '1' : '0' } : { transform: open ? 'translateX(0px)' : 'translateX(-100%)' }
  return moveTo(nav, to, ms, quiet ? 'ease-out' : IOS).then(() => {
    if (open) {
      for (const el of [nav, shade]) for (const a of el.getAnimations()) a.cancel()
      nav.style.transform = nav.style.opacity = shade.style.opacity = ''
    } else setUI({ drawer: false })
  })
}

/** The list as it floats over the screen: the shade, then the list. It slides in from the left as it opens (unless
 *  a swipe brings it), and a swipe to the left on either closes it. */
export function SideDrawer({ children }: { children: ReactNode }) {
  const nav = useRef<HTMLElement>(null)
  const shade = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const p = { nav: nav.current!, shade: shade.current! }
    parts = p
    if (swiping) paint(p, 0, p.nav.offsetWidth, calm())
    else if (calm()) for (const el of [p.nav, p.shade]) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
    else {
      p.shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'ease-out' })
      p.nav.animate([{ transform: 'translateX(-100%)' }, { transform: 'none' }], { duration: OPEN_MS, easing: IOS })
    }
    const off = shutDrag(p)
    return () => {
      off()
      if (parts === p) parts = null
      // gone while still open: a tablet's list showing beside the chat again (its pane closed), so it isn't left
      // open unseen, to come back over the screen when the list is hidden next
      queueMicrotask(() => {
        const ui = getState().ui
        if (ui.drawer && !sideHidden(ui)) setUI({ drawer: false })
      })
    }
  }, [])
  // a tap on the shade: the list slides back out, then closes
  const tap = () => {
    if (performance.now() - swipedAt < 400) return
    const p = parts
    if (!p) return setUI({ drawer: false })
    void settle(p, false, p.nav.offsetWidth, 0, p.nav.offsetWidth, calm())
  }
  return (
    <>
      <div className="scrim" ref={shade} onClick={tap} style={{ touchAction: 'none' }} />
      <nav className="drawer" ref={nav} aria-label="Spaces" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
        {children}
      </nav>
    </>
  )
}

/* ---------- the fingers ---------- */

type Track = { id: number; x0: number; y0: number; t0: number; mode: 'wait' | 'go' | 'off'; samples: { t: number; x: number }[]; w: number; quiet: boolean; at: number }

const start = (t: Touch, at = 0): Track => ({ id: t.identifier, x0: t.clientX, y0: t.clientY, t0: performance.now(), mode: 'wait', samples: [{ t: performance.now(), x: t.clientX }], w: 0, quiet: false, at })
const mine = (e: TouchEvent, k: Track | null) => (k ? [...e.changedTouches].find((t) => t.identifier === k.id) : undefined)
const sample = (k: Track, t: Touch) => {
  k.samples.push({ t: performance.now(), x: t.clientX })
  if (k.samples.length > 12) k.samples.shift()
}

/** decide the way once past the slop: `dir` 1 opens (right), -1 shuts (left); a finger that waited first is not ours */
function decide(k: Track, t: Touch, dir: 1 | -1): Track['mode'] {
  if (k.mode !== 'wait') return k.mode
  const w = wayOf(t.clientX - k.x0, t.clientY - k.y0, dir)
  if (w === 'wait') return 'wait'
  return (k.mode = w === 'go' && performance.now() - k.t0 < LATE_MS ? 'go' : 'off')
}

/** the swipe in from the edge, over the whole page. Returns what takes it off. */
export function edgeSwipe(doc: Document = document): () => void {
  let k: Track | null = null
  /** where the touch began, for the tap it stands in for */
  let tapOn: { el: Element; x: number; y: number } | null = null

  const down = (e: TouchEvent) => {
    if (k || e.touches.length > 1) return
    const t = e.changedTouches[0]
    const how = t && claims(t.clientX, e.target as Element)
    if (!t || !how) return
    k = start(t)
    if (how === 'swipe') return
    // The edge is the list's here: the system's Back and the page's scroll don't take this touch (iOS starts its
    // Back from a touch that goes on; best effort, it can't be turned off for sure). A tap still reaches what it was on.
    e.preventDefault()
    tapOn = { el: e.target as Element, x: t.clientX, y: t.clientY }
  }

  const move = (e: TouchEvent) => {
    const t = mine(e, k)
    if (!t || !k || k.mode === 'off') return
    if (k.mode === 'wait') {
      if (decide(k, t, 1) !== 'go') return
      // on a control the page may have taken the touch already (its scroll): then it stays the page's
      if (!e.cancelable) return void (k.mode = 'off')
      tapOn = null
      // the keyboard goes down, as it does for the menu button's tap
      const f = doc.activeElement as HTMLElement | null
      if (f?.matches?.('input, textarea, [contenteditable]')) f.blur()
      swiping = true
      try {
        flushSync(() => setUI({ drawer: true }))
      } finally {
        swiping = false
      }
      if (!parts) {
        k.mode = 'off'
        return setUI({ drawer: false })
      }
      k.w = parts.nav.offsetWidth
      k.quiet = calm()
    }
    e.preventDefault()
    sample(k, t)
    k.at = Math.min(k.w, Math.max(0, t.clientX - k.x0))
    if (parts) paint(parts, k.at, k.w, k.quiet)
  }

  const up = (e: TouchEvent) => {
    const t = mine(e, k)
    if (!t || !k) return
    const was = k
    k = null
    if (was.mode === 'go') {
      swipedAt = performance.now()
      const v = e.type === 'touchcancel' ? 0 : speed(was.samples, { t: performance.now(), x: t.clientX })
      if (parts) void settle(parts, e.type !== 'touchcancel' && staysOpen(was.at, v, was.w), was.at, v, was.w, was.quiet)
      return
    }
    // a tap at the edge: the touch was held back from the page, so its click is sent here
    const on = tapOn
    tapOn = null
    // (a press held long is no tap: it opened its own menu)
    if (on && was.mode === 'wait' && e.type === 'touchend' && performance.now() - was.t0 < TAP_MS) {
      e.preventDefault()
      on.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView, clientX: on.x, clientY: on.y }))
    }
  }

  const opt = { passive: false, capture: true }
  doc.addEventListener('touchstart', down, opt)
  doc.addEventListener('touchmove', move, opt)
  doc.addEventListener('touchend', up, opt)
  doc.addEventListener('touchcancel', up, opt)
  return () => {
    doc.removeEventListener('touchstart', down, opt)
    doc.removeEventListener('touchmove', move, opt)
    doc.removeEventListener('touchend', up, opt)
    doc.removeEventListener('touchcancel', up, opt)
  }
}

/** a swipe to the left on the open list, or on the shade beside it, closes it, following the finger */
function shutDrag(p: Parts): () => void {
  let k: Track | null = null
  const down = (e: TouchEvent) => {
    if (k || e.touches.length > 1) return
    const t = e.changedTouches[0]
    const target = e.target as Element
    // typing, a slider, something that scrolls sideways or is marked data-nodrag keeps its own swipe
    if (!t || target.closest?.('input, textarea, select, [contenteditable], [role="slider"], [data-nodrag]') || (p.nav.contains(target) && sideways(target))) return
    k = start(t, p.nav.offsetWidth)
  }
  const move = (e: TouchEvent) => {
    const t = mine(e, k)
    if (!t || !k || k.mode === 'off') return
    if (k.mode === 'wait') {
      if (decide(k, t, -1) !== 'go') return
      k.w = p.nav.offsetWidth
      k.quiet = calm()
      k.x0 = t.clientX
      for (const el of [p.nav, p.shade]) for (const a of el.getAnimations()) a.cancel()
    }
    e.preventDefault()
    sample(k, t)
    k.at = Math.min(k.w, Math.max(0, k.w + t.clientX - k.x0))
    paint(p, k.at, k.w, k.quiet)
  }
  const up = (e: TouchEvent) => {
    const t = mine(e, k)
    if (!t || !k) return
    const was = k
    k = null
    if (was.mode !== 'go') return
    swipedAt = performance.now()
    const v = e.type === 'touchcancel' ? 0 : speed(was.samples, { t: performance.now(), x: t.clientX })
    void settle(p, e.type === 'touchcancel' || staysOpen(was.at, v, was.w), was.at, v, was.w, was.quiet)
  }
  const els = [p.nav, p.shade]
  for (const el of els) {
    el.addEventListener('touchstart', down, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', up)
    el.addEventListener('touchcancel', up)
  }
  return () => {
    for (const el of els) {
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', up)
      el.removeEventListener('touchcancel', up)
    }
  }
}
