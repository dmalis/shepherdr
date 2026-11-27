// fork #86: the keyboard's mark on <html> (typing.css reads it).

/** the class on <html> while the on-screen keyboard is up */
export const TYPING = 'kb-up'

/** viewport.ts's line between a keyboard and a browser bar that comes and goes */
const KEYBOARD = 150
/** the visible height still for this long: the keyboard has finished moving */
const QUIET = 150
/** at the latest, the mark goes this long after the keyboard was said to close */
const AT_MOST = 1000

type Root = { classList: { toggle(c: string, on: boolean): unknown } }
type Viewport = { height: number; addEventListener(t: 'resize', f: () => void): void; removeEventListener(t: 'resize', f: () => void): void }
type Timers = { set(f: () => void, ms: number): unknown; clear(t: unknown): void }
const realTimers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (t) => clearTimeout(t as number) }

/** Calls `done` once the keyboard has gone down: the visible height back up by more than a keyboard from the lowest it
 *  was while typing, and still for a moment (a keyboard can report its way down in steps). The keyboard is said to close
 *  as soon as the box loses focus, while it is still sliding away: the bottom tabs coming back then would push the box
 *  up and drop it again. A keyboard that never reports its way down (no resize) lets go after AT_MOST. */
export function afterKeyboard(vv: Viewport, lowest: number, done: () => void, timers: Timers = realTimers): () => void {
  let quiet: unknown = null
  const end = () => {
    stop()
    done()
  }
  const check = () => {
    if (quiet !== null) timers.clear(quiet)
    quiet = vv.height > lowest + KEYBOARD ? timers.set(end, QUIET) : null
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
  let lowest = Infinity
  let leaving: (() => void) | null = null
  const set = (on: boolean) => {
    if (on !== marked) root.classList.toggle(TYPING, (marked = on))
  }
  const low = () => void (lowest = Math.min(lowest, vv?.height ?? Infinity))
  const mark = () => {
    if (up()) {
      leaving?.()
      leaving = null
      if (!marked) lowest = Infinity
      low()
      set(true)
    } else if (marked && !leaving) {
      if (!vv) return set(false)
      leaving = afterKeyboard(vv, lowest, () => {
        leaving = null
        set(false)
      }, timers)
    }
  }
  vv?.addEventListener('resize', () => marked && !leaving && low())
  mark()
  return subscribe(mark)
}
