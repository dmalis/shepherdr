/** The chat stays at its newest message while it is there (stuck): when what it shows grows (a picture loaded, a card
 *  came) and when its window gets shorter (the box grew, the suggested replies came above it), its end stays in view.
 *  A ResizeObserver runs after layout and before paint, so the move never shows as a jump. No imports: the layout test
 *  (test/test_reply_row.py) runs this very file in a real Chrome. */
export function keepAtEnd(sc: HTMLElement, box: HTMLElement, stuck: () => boolean, pinned?: () => void, left?: () => boolean): () => void {
  const ro = new ResizeObserver(() => {
    // `left`: the reader has just moved up, and their scroll event will say so (dmalis/shepherdr#190)
    if (!stuck() || left?.()) return
    sc.scrollTo({ top: sc.scrollHeight, behavior: 'instant' })
    pinned?.()
  })
  ro.observe(box)
  ro.observe(sc)
  return () => ro.disconnect()
}

/** The reader has moved up from the foot since the chat was last pinned there (`edge`: its scroll then), though their
 *  scroll event hasn't come yet (dmalis/shepherdr#190): what grew since must not put them back. A taller window
 *  clamps the scroll to its new foot, and that is no move. */
export function movedUp(sc: HTMLElement, edge: number): boolean {
  return sc.scrollTop < Math.min(edge, sc.scrollHeight - sc.clientHeight) - 2
}

/** The suggested replies' row scrolls sideways when its bubbles don't fit: a soft fade at each edge where more
 *  continues (--fl, --fr, read by .sugs's mask), none at an edge it has reached. A new set starts at its first bubble. */
export function rowEdges(row: HTMLElement): () => void {
  row.scrollLeft = 0
  const set = () => {
    const x = Math.abs(row.scrollLeft)
    row.style.setProperty('--fl', x > 1 ? '24px' : '0px')
    row.style.setProperty('--fr', x + row.clientWidth < row.scrollWidth - 1 ? '24px' : '0px')
  }
  set()
  row.addEventListener('scroll', set, { passive: true })
  const ro = new ResizeObserver(set)
  ro.observe(row)
  return () => {
    row.removeEventListener('scroll', set)
    ro.disconnect()
  }
}
