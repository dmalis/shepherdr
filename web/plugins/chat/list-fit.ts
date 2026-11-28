// The @, # and / lists over the message box (mentions.tsx, slash.tsx) fit the room left above the box and keep the
// chosen row in view (fork, "Writing: the @, # and / lists fit the room"; fork/specs/ui-polish.md slice 9).
// - Room: from the box's top up to its pane's header (the .col it sits in, under its .hd), measured on the page, as
//   the box and the visible height change. A fixed 40dvh didn't: iOS keeps dvh while the keyboard is up, so the list
//   ran off the top of what shows. The page is measured, not written in px, so Zoom needs nothing (docs/design.md).
// - The chosen row: moved by the arrow keys (or a new filter), the list scrolls just enough to show it, as VS Code's
//   and Slack's suggestion lists do. Only the list scrolls, never the page; a row the mouse is over never scrolls it.
// - An input method: a key that ends a word being composed (Safari gives it keyCode 229) is the input method's, never
//   the list's, as enter.ts already keeps it from sending.
import { useCallback, useLayoutEffect, useRef, type KeyboardEvent } from 'react'

/** the gap between the list and the box (mentions.css) */
const GAP = 6
/** air between the list and the pane's header */
const AIR = 8
/** about a row and its label: where there's no more room under the header (a phone on its side, the keyboard up), the
 *  list goes over the header to show that much rather than nothing, but never past the top of the page */
export const FLOOR = 96

/** a key that belongs to an input method composing a word, not to the list */
export const composingKey = (e: KeyboardEvent<HTMLElement>) => e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229

/** the room for a list whose box's top is `boxTop`, with the pane's header ending at `top` (px from the page's top):
 *  up to the header, else up to FLOOR over it, never above the page's top */
export function roomAbove(boxTop: number, top: number): number {
  const page = Math.max(0, Math.floor(boxTop - GAP - AIR))
  return Math.max(Math.min(FLOOR, page), Math.floor(boxTop - GAP - AIR - Math.max(0, top)))
}

/** how far a list scrolled to `scroll` must scroll so its row from `rowTop` to `rowBottom` (in the list's content,
 *  from its top) shows inside its `height`, `pad` in from each end: the least move, none when it already shows */
export function scrollToShow(scroll: number, height: number, rowTop: number, rowBottom: number, pad = 4): number {
  if (rowTop - pad < scroll) return Math.max(0, rowTop - pad)
  if (rowBottom + pad > scroll + height) return rowBottom + pad - height
  return scroll
}

/** where a list over this box may start: the bottom of its pane's header, else the pane's top, else the page's */
function topOf(box: Element): number {
  const col = box.closest('.col')
  const head = col?.querySelector(':scope > .hd')
  const top = head ? head.getBoundingClientRect().bottom : col ? col.getBoundingClientRect().top : 0
  return Math.max(top, window.visualViewport?.offsetTop ?? 0)
}

/** A list over the message box: its ref, and onHover to call as the mouse chooses a row. `sel` is the chosen row's
 *  index, `shows` changes with what the list shows (its filter); the rows are its [role="option"] children, in order. */
export function useListFit(open: boolean, sel: number, shows: string) {
  const ref = useRef<HTMLDivElement | null>(null)
  const hovered = useRef(false)
  const chosen = useRef(sel)
  chosen.current = sel

  /** scroll the list just enough to show the chosen row (the first one with the list's label above it) */
  const show = useCallback(() => {
    const list = ref.current
    const row = list?.querySelectorAll<HTMLElement>('[role="option"]')[chosen.current]
    if (!list || !row) return
    if (chosen.current === 0) return void (list.scrollTop = 0)
    const l = list.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    const top = r.top - l.top - list.clientTop + list.scrollTop
    list.scrollTop = scrollToShow(list.scrollTop, list.clientHeight, top, top + r.height)
  }, [])

  // the room above the box, kept as --room while the list is open; a list made shorter still shows its chosen row
  useLayoutEffect(() => {
    const list = ref.current
    const box = list?.parentElement
    if (!open || !list || !box) return
    const fit = () => {
      const room = `${roomAbove(box.getBoundingClientRect().top, topOf(box))}px`
      if (list.style.getPropertyValue('--room') === room) return
      list.style.setProperty('--room', room)
      show()
    }
    fit()
    // the box grows with the draft; the keyboard and the window change what shows (viewport.ts says app-resized)
    const seen = new ResizeObserver(fit)
    seen.observe(box)
    const vv = window.visualViewport
    addEventListener('resize', fit)
    addEventListener('app-resized', fit)
    vv?.addEventListener('resize', fit)
    return () => {
      seen.disconnect()
      removeEventListener('resize', fit)
      removeEventListener('app-resized', fit)
      vv?.removeEventListener('resize', fit)
    }
  }, [open, show])

  // the chosen row in view, unless the mouse chose it
  useLayoutEffect(() => {
    if (!open) return
    if (hovered.current) return void (hovered.current = false)
    show()
  }, [open, sel, shows, show])

  const onHover = useCallback(() => void (hovered.current = true), [])
  return { ref, onHover }
}
