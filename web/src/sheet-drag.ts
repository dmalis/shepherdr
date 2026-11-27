// fork #109: a sheet follows the finger down and closes, as iOS's sheets and Vaul's drawer do. A drag starts anywhere
// on the sheet where nothing under the finger scrolls up first (a list scrolled down scrolls back to its top before
// the sheet moves, and a drag up scrolls a tall list), and never in a text field or a slider. Let go past about
// a third of its height, or flicked down however short, it closes; else it settles back. Dragged up past its
// top, it gives a little and pulls back (a rubber band). The shade behind thins as it goes.
import { calm, IOS, lands, moveTo, settleMs } from './motion.ts'

/** how far a finger moves before the sheet decides whether this is its drag */
const SLOP = 6

/** past its top the sheet moves less the further it is pulled: this many px at most, like a band */
export function rubber(dy: number, room = 24) {
  if (dy >= 0) return dy
  const pull = -dy
  return -room * (1 - 1 / (pull / room + 1))
}

/** where the drag is in the sheet's own terms: down by this much (rubber-banded above its top) */
export const shown = (dy: number) => rubber(dy)

/** Does a let-go `dy` px down at `v` px/ms, on a sheet `h` px tall, close it? A flick down closes, a flick up keeps
 *  it; a slow let-go closes once it is carried past a third of the sheet. */
export const closes = (dy: number, v: number, h: number) => dy > 0 && lands(dy, v, h / 3)

/** How fast the finger was going as it let go (px per ms, down is +): over the moves of its last 100 ms, up to the
 *  let-go itself, so a pull held still before letting go is no flick. */
export function speed(samples: { t: number; y: number }[], end: { t: number; y: number }, window = 100) {
  const recent = samples.filter((s) => end.t - s.t <= window)
  const first = recent[0]
  if (!first || end.t <= first.t) return 0
  return (end.y - first.y) / (end.t - first.t)
}

/** the scroller under the finger, inside the sheet (the sheet itself when it scrolls) */
function scrollerIn(target: Element | null, sheet: HTMLElement): HTMLElement | null {
  for (let el = target as HTMLElement | null; el && sheet.contains(el); el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el
    if (el === sheet) break
  }
  return null
}

/** nothing to drag from here: typing, a slider, a row that scrolls sideways, or anything marked data-nodrag */
const own = (t: Element | null) => !!t?.closest('input, textarea, select, [contenteditable], [data-nodrag]')

/**
 * Lets `sheet` be dragged down to close. `shade`: what behind it thins as it goes; `close`: closes it without its own
 * exit motion (the drag played it). Returns what takes the listeners off.
 */
export function sheetDrag(sheet: HTMLElement, shade: HTMLElement | null, close: () => void): () => void {
  let id: number | null = null
  let y0 = 0
  let x0 = 0
  let mode: 'wait' | 'drag' | 'off' = 'off'
  let scroller: HTMLElement | null = null
  let dy = 0
  let samples: { t: number; y: number }[] = []
  let h = 0

  const at = (e: TouchEvent) => [...e.changedTouches].find((t) => t.identifier === id)
  // with less motion (Motion: Reduced, or the device's) the sheet stays put and fades as it is pulled
  let still = false
  const paint = () => {
    const gone = Math.max(0, dy) / h
    if (still) sheet.style.opacity = String(Math.max(0.2, 1 - gone))
    else sheet.style.transform = `translateY(${shown(dy)}px)`
    if (shade) shade.style.opacity = String(Math.max(0, 1 - gone))
  }

  const start = (e: TouchEvent) => {
    // one finger only: a second one joining in is ignored until the first lets go
    if (id !== null || e.touches.length > 1) return
    const t = e.changedTouches[0]
    if (!t || own(e.target as Element)) return
    id = t.identifier
    y0 = t.clientY
    x0 = t.clientX
    dy = 0
    mode = 'wait'
    scroller = scrollerIn(e.target as Element, sheet)
    samples = [{ t: e.timeStamp, y: t.clientY }]
  }

  const move = (e: TouchEvent) => {
    const t = at(e)
    if (!t || mode === 'off') return
    const d = t.clientY - y0
    if (mode === 'wait') {
      if (Math.abs(d) < SLOP && Math.abs(t.clientX - x0) < SLOP) return
      // sideways, or a list that scrolls this way first: the page's own scroll, not the sheet's drag
      const sideways = Math.abs(t.clientX - x0) > Math.abs(d)
      const scrolls = scroller && (d < 0 ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 : scroller.scrollTop > 0)
      if (sideways || scrolls) return void (mode = 'off')
      mode = 'drag'
      h = sheet.offsetHeight || 1
      still = calm()
      for (const a of sheet.getAnimations()) a.cancel()
      sheet.style.transition = 'none'
    }
    e.preventDefault()
    dy = t.clientY - y0
    samples.push({ t: e.timeStamp, y: t.clientY })
    if (samples.length > 12) samples.shift()
    paint()
  }

  const end = (e: TouchEvent) => {
    const t = at(e)
    if (!t) return
    id = null
    const was = mode
    mode = 'off'
    if (was !== 'drag') return
    const v = e.type === 'touchcancel' ? 0 : speed(samples, { t: e.timeStamp, y: t.clientY })
    if (e.type !== 'touchcancel' && closes(dy, v, h)) {
      const ms = still ? 120 : settleMs(h - dy, v, 300)
      if (shade) void moveTo(shade, { opacity: '0' }, ms, 'ease-out')
      void moveTo(sheet, still ? { opacity: '0' } : { transform: 'translateY(100%)' }, ms, still ? 'ease-out' : IOS).then(close)
    } else {
      if (shade) void moveTo(shade, { opacity: '1' }, still ? 120 : 300, 'ease-out')
      void moveTo(sheet, still ? { opacity: '1' } : { transform: 'translateY(0px)' }, still ? 120 : 300, still ? 'ease-out' : IOS).then(() => {
        sheet.style.transform = ''
        sheet.style.opacity = ''
        if (shade) shade.style.opacity = ''
      })
    }
  }

  sheet.addEventListener('touchstart', start, { passive: true })
  sheet.addEventListener('touchmove', move, { passive: false })
  sheet.addEventListener('touchend', end)
  sheet.addEventListener('touchcancel', end)
  return () => {
    sheet.removeEventListener('touchstart', start)
    sheet.removeEventListener('touchmove', move)
    sheet.removeEventListener('touchend', end)
    sheet.removeEventListener('touchcancel', end)
  }
}
