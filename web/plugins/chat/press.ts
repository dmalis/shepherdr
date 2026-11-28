// What a finger does on a message (SHEP-332), as the good chat apps read it: a quick tap shows the quick actions beside
// it, a press held still opens the whole menu, and a slide to the right replies. The slide waits until the finger
// clearly goes sideways, so scrolling up and down, selecting words and the screen's own edge swipe keep working.
// fork #185: a row with actions behind it (a task's, in the Tasks list) also slides to the left, as Mail's and Things'
// rows do: let go past half of them and they stay open to tap; a full slide does the last one (Archive) on its own.
import { EDGE } from '@client/edge.ts'
import { lands } from '@client/motion.ts'

/** held this long without moving: the whole menu */
export const HOLD_MS = 450
/** a finger that moves this far was not a tap or a hold */
export const SLOP = 8
/** slid this far (px) to the right, let go: a reply */
export const REPLY_AT = 64
/** the furthest a message slides; past REPLY_AT it moves slower, as if on a rubber band */
export const MAX_SLIDE = 96
/** a finger that starts this near the screen's left edge belongs to the system (Back) or the sidebar (fork #117) */
export const EDGE_PX = EDGE

/** how far the message shows slid for a finger moved `dx` to the right */
export function slid(dx: number): number {
  if (dx <= 0) return 0
  if (dx <= REPLY_AT) return dx
  return Math.min(MAX_SLIDE, REPLY_AT + (dx - REPLY_AT) * 0.35)
}

/* ---------- the actions behind a row, to the left (fork #185) ---------- */

/** each action behind a row is this wide (px): a word under its icon, past a finger's 44 */
export const ACT_W = 76
/** let go with the actions this much out (a share of their width), they stay open; less, the row closes */
export const OPEN_AT = 0.5
/** a full slide, the last action on its own: this far past the actions (px), and past this share of the row */
export const FULL_PAST = 64
export const FULL_SHARE = 0.55
/** a full slide's mark is never further than this share of the row (at a high Zoom the actions fill most of it); with
 *  no room past the actions for it, the row has no full slide, only its actions to tap */
export const FULL_MAX = 0.9
/** a row with no full slide stretches this far past its actions at most, like a rubber band */
const LEFT_STRETCH = 32

/** What a row offers to the left: its actions' width, and how far a full slide goes (0: none) */
export interface Left {
  w: number
  full: number
}

/** a row `rowW` wide with `n` actions behind it, the last a full slide's or not; `zoom` is Settings › General › Zoom
 *  (1 at 100%), which widens each action in CSS (ds.css .sli) as it does every px */
export function leftOf(n: number, full: boolean, rowW: number, zoom = 1): Left | null {
  if (n < 1) return null
  const w = Math.round(n * ACT_W * zoom)
  if (!full) return { w, full: 0 }
  const mark = Math.round(Math.min(Math.max(w + FULL_PAST, rowW * FULL_SHARE), rowW * FULL_MAX))
  return { w, full: mark > w ? mark : 0 }
}

/** how far a row shows slid for a finger `at` px from its rest (to the left is minus): it follows the finger; with no
 *  full slide it slows past its actions, and nothing goes past the row's own width */
export function slidLeft(at: number, l: Left, rowW: number): number {
  if (at >= 0) return 0
  const d = -at
  if (l.full) return -Math.min(d, rowW)
  if (d <= l.w) return at
  return -Math.min(l.w + LEFT_STRETCH, l.w + (d - l.w) * 0.35)
}

export type Way = 'undecided' | 'slide' | 'scroll'

/** Which way a moving finger goes: sideways to the right clearly more than up or down is a slide; up, down or to the
 *  left is the page's (scrolling, the drawer), unless the row has actions to its left (`left`). Undecided until it
 *  has moved past the slop. */
export function wayOf(dx: number, dy: number, left = false): Way {
  if (Math.hypot(dx, dy) < SLOP) return 'undecided'
  return (dx > 0 || left) && Math.abs(dx) > Math.abs(dy) * 1.5 ? 'slide' : 'scroll'
}

/** what a finger did once it lets go: `open` leaves a row's actions out to tap, `full` does its last one */
export type Outcome = 'tap' | 'hold' | 'reply' | 'back' | 'open' | 'full' | 'none'

/** the let-go speed is read over this last stretch (ms), so a pull held still is no flick */
const SPEED_MS = 100

/** One finger on one message, from down to up. `now` is the clock (ms), so tests can run it without waiting. */
export class Finger {
  readonly x0: number
  readonly y0: number
  readonly t0: number
  way: Way = 'undecided'
  dx = 0
  /** past REPLY_AT now (the haptic tick fires once each time it crosses) */
  armed = false
  held = false
  readonly edge: boolean
  /** what the row has to its left (fork #185), its width, and where it rested when the finger came down (0, or open:
   *  minus its actions' width) */
  readonly left: Left | null
  readonly rowW: number
  readonly from: number
  /** where the row is now from its rest, to the left is minus */
  at = 0
  /** past the full slide's mark now: a let-go does the last action */
  full = false
  /** where the finger was lately, for its speed as it lets go */
  private pts: { t: number; x: number }[] = []

  constructor(x: number, y: number, t: number, o: { left?: Left | null; rowW?: number; open?: boolean } = {}) {
    this.x0 = x
    this.y0 = y
    this.t0 = t
    this.edge = x < EDGE_PX
    this.left = o.left ?? null
    this.rowW = o.rowW ?? 0
    this.from = o.open && this.left ? -this.left.w : 0
    this.at = this.from
    this.pts = [{ t, x }]
  }

  /** the finger moved: what the message shows now (to the left is minus), and whether it just crossed a mark (the
   *  reply's, or a full slide's) */
  move(x: number, y: number, t?: number): { slide: number; crossed: boolean } {
    const dx = x - this.x0
    const dy = y - this.y0
    if (t !== undefined) {
      this.pts.push({ t, x })
      while (this.pts.length > 2 && t - this.pts[1]!.t > SPEED_MS) this.pts.shift()
    }
    if (this.way === 'undecided' && !this.held) this.way = this.edge ? (Math.hypot(dx, dy) < SLOP ? 'undecided' : 'scroll') : wayOf(dx, dy, !!this.left)
    if (this.way !== 'slide') return { slide: 0, crossed: false }
    const at = this.from + dx
    // the actions' side: from an open row only back to its rest, never on to a reply
    if (this.left && (this.from < 0 || at < 0)) {
      this.dx = 0
      this.armed = false
      this.at = Math.min(0, at)
      const was = this.full
      this.full = this.left.full > 0 && -this.at >= this.left.full
      return { slide: slidLeft(this.at, this.left, this.rowW), crossed: this.full && !was }
    }
    this.full = false
    this.at = Math.max(0, dx)
    this.dx = this.at
    const was = this.armed
    this.armed = this.dx >= REPLY_AT
    return { slide: slid(this.dx), crossed: this.armed && !was }
  }

  /** how fast the finger went as it let go, px per ms (to the right is plus), over its last moments; `t`: when it let
   *  go (a finger held still sends no moves, so a pause before the lift is no flick) */
  speed(t?: number): number {
    const a = this.pts[0]!
    const b = this.pts[this.pts.length - 1]!
    if (t !== undefined && t - b.t > SPEED_MS) return 0
    return b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0
  }

  /** the hold timer fired: a hold, if the finger has not moved off */
  hold(t: number): boolean {
    if (this.way !== 'undecided' || t - this.t0 < HOLD_MS) return false
    this.held = true
    return true
  }

  /** the finger let go (at `t`). On the actions' side a flick goes its way, else they stay open past half their width. */
  up(t?: number): Outcome {
    if (this.held) return 'hold'
    if (this.way === 'slide') {
      if (this.left && (this.from < 0 || this.at < 0)) {
        if (this.full) return 'full'
        return lands(-this.at, -this.speed(t), this.left.w * OPEN_AT) ? 'open' : 'back'
      }
      return this.armed ? 'reply' : 'back'
    }
    if (this.way === 'undecided') return 'tap'
    return 'none'
  }

  /** the browser took the finger (a scroll, a system gesture): the row goes back to where it rested */
  cancel(): Outcome {
    if (this.way !== 'slide') return 'none'
    return this.from < 0 ? 'open' : 'back'
  }
}

/** Where the quick bar goes and how much it holds: beside the message on its open side (right of the agent's, left of
 *  yours), every action when there is room, else only the reaction; with no room at all it sits over the message's
 *  edge. `room` is the free width (px) on that side. */
export type QuickFit = { actions: 'all' | 'react'; over: boolean; time: boolean }
export const QUICK_BTN = 40
const PAD = 4
const GAP = 8
const TIME_W = 52
export function quickFit(room: number, wide: boolean): QuickFit {
  const all = 3 * QUICK_BTN + 2 * PAD + GAP
  const one = QUICK_BTN + 2 * PAD + GAP
  if (wide && room >= all) return { actions: 'all', over: false, time: room >= all + TIME_W }
  if (room >= one) return { actions: 'react', over: false, time: room >= one + TIME_W }
  return { actions: wide ? 'all' : 'react', over: true, time: false }
}
