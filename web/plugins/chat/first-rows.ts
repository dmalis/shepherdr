// A long chat opens on its newest messages (dmalis/shepherdr#190): the first paint draws the
// last FIRST rows, the ones you see at its end, and the older ones come in right after it, STEP of them a frame, so
// the switch itself never waits on a long history. Find, copy and Select all see the whole chat a moment later. A
// chat of up to 2 × FIRST rows, and one opened at a linked message, is drawn whole at once.
import { useEffect, useRef, useState } from 'react'

export const FIRST = 40
export const STEP = 50

/** after the next frame is drawn: what a step adds never holds up the paint before it */
function afterPaint(f: () => void): () => void {
  let t: ReturnType<typeof setTimeout> | undefined
  const r = requestAnimationFrame(() => {
    t = setTimeout(f, 0)
  })
  return () => {
    cancelAnimationFrame(r)
    clearTimeout(t)
  }
}

/** the first row to draw at first: the oldest of the newest FIRST, or null to draw them all */
export function firstOf(keys: string[]): string | null {
  return keys.length > 2 * FIRST ? keys[keys.length - FIRST]! : null
}

/** the next step's first row: STEP older than `first`, or null once that reaches the oldest */
export function stepFrom(keys: string[], first: string): string | null {
  const at = keys.indexOf(first)
  const next = at - STEP
  return at > 0 && next > 0 ? keys[next]! : null
}

/** where a chat's drawn rows start: 0 for all of them, else the index of the oldest drawn while it fills in.
 *  `keys`: every row's key, oldest first. `whole`: draw it all now (a message to jump to, a link to one).
 *  A render whose start is lower than the last one's puts older rows in above the ones on screen. */
export function useNewestFirst(chat: string, keys: string[], whole: boolean): number {
  // the key of the oldest row drawn, per chat: a key, not an index, so new messages and earlier pages don't move it
  // (decided when its rows first come: a chat opened before its history has loaded fills in the same way)
  const win = useRef<{ chat: string; first: string | null; rows: boolean } | null>(null)
  const now = useRef(keys)
  now.current = keys
  const [, bump] = useState(0)
  if (win.current?.chat !== chat || !win.current.rows) win.current = { chat, first: firstOf(keys), rows: keys.length > 0 }
  if (whole) win.current.first = null
  let start = win.current.first === null ? 0 : keys.indexOf(win.current.first)
  if (start < 0) {
    win.current.first = null
    start = 0
  }
  useEffect(() => {
    if (!start) return
    return afterPaint(() => {
      const w = win.current
      if (!w || w.chat !== chat || w.first === null) return
      w.first = stepFrom(now.current, w.first)
      bump((n) => n + 1)
    })
  }, [chat, start])
  return start
}
