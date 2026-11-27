// fork #86: the keyboard's mark on <html> (typing.css reads it).

/** the class on <html> while the on-screen keyboard is up */
export const TYPING = 'kb-up'

/** viewport.ts's line between a keyboard and a browser bar that comes and goes */
const KEYBOARD = 150
/** back within this of the height before typing: the keyboard is down (a browser bar may come back a little shorter) */
const BACK = 100
/** the visible height still for this long, though not quite back: the keyboard has finished moving */
const QUIET = 150
/** at the latest, the mark goes this long after the keyboard was said to close */
const AT_MOST = 1000

type Root = { classList: { toggle(c: string, on: boolean): unknown } }

/** fork #105: `root`, with `after` run each time the mark changes, in the same step. The message box is one row while
 *  typing (typing.css), so its text gets narrower or wider as the mark goes on or off: `after` fits the box's height to
 *  its text again (it grows only as its text changes), so it never keeps two lines' height for one line. */
export function withAfter(root: Root, after: () => void): Root {
  return {
    classList: {
      toggle: (c, on) => {
        const r = root.classList.toggle(c, on)
        after()
        return r
      },
    },
  }
}
type Viewport = { width: number; height: number; addEventListener(t: 'resize', f: () => void): void; removeEventListener(t: 'resize', f: () => void): void }
type Timers = { set(f: () => void, ms: number): unknown; clear(t: unknown): void }
const realTimers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as number) }

/** Calls `done` once the keyboard has gone down. As soon as the visible height is back to what it was before typing
 *  (`tall`, this way up), in that same resize, so the tabs come back in the frame the page gets its height back: never
 *  a frame without them and then a jump. If it never quite comes back (a browser bar that stays), once it is well up
 *  from the lowest it was while typing (`lowest`) and still for a moment. The keyboard is said to close as soon as the
 *  box loses focus, while it is still sliding away: the tabs coming back then would push the box up and drop it again.
 *  A keyboard that never reports its way down (no resize) lets go after AT_MOST. Turned meanwhile: the heights of the
 *  new way up are not known, so only the time limit lets go. */
export function afterKeyboard(vv: Viewport, tall: number, lowest: number, done: () => void, timers: Timers = realTimers): () => void {
  const width = vv.width
  let quiet: unknown = null
  const end = () => {
    stop()
    done()
  }
  const check = () => {
    if (quiet !== null) timers.clear(quiet)
    quiet = null
    if (vv.width !== width) return
    if (vv.height >= tall - BACK) return end()
    if (vv.height > lowest + KEYBOARD) quiet = timers.set(end, QUIET)
  }
  const latest = timers.set(end, AT_MOST)
  const stop = () => {
    vv.removeEventListener('resize', check)
    if (quiet !== null) timers.clear(quiet)
    timers.clear(latest)
  }
  vv.addEventListener('resize', check)
  check()
  return stop
}

/** Keeps `root` marked while `up()` says the keyboard is up: at once as it opens, on every change the store reports,
 *  and until the keyboard has finished going down (afterKeyboard) once it closes. */
export function markTyping(root: Root, up: () => boolean, subscribe: (f: () => void) => () => void, vv: Viewport | null = null, timers: Timers = realTimers) {
  let marked = false
  let leaving: (() => void) | null = null
  // per way up (width): the tallest visible height while not typing, the lowest while typing
  const tall = new Map<number, number>()
  const lowest = new Map<number, number>()
  const set = (on: boolean) => {
    if (on !== marked) root.classList.toggle(TYPING, (marked = on))
  }
  const seen = () => {
    if (!vv) return
    const w = vv.width
    if (!marked) tall.set(w, Math.max(tall.get(w) ?? 0, vv.height))
    else if (!leaving) lowest.set(w, Math.min(lowest.get(w) ?? Infinity, vv.height))
  }
  const mark = () => {
    if (up()) {
      leaving?.()
      leaving = null
      if (!marked) lowest.clear()
      set(true)
      seen()
    } else if (marked && !leaving) {
      if (!vv) return set(false)
      const w = vv.width
      // the height may be back already (a keyboard closed by height, focus kept): then it is done at once
      let down = false
      const stop = afterKeyboard(vv, tall.get(w) ?? Infinity, lowest.get(w) ?? Infinity, () => {
        down = true
        leaving = null
        set(false)
      }, timers)
      if (!down) leaving = stop
    }
  }
  vv?.addEventListener('resize', seen)
  seen()
  mark()
  return subscribe(mark)
}
