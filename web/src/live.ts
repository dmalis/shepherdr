/* What changes on its own, said to screen readers through one polite live region (docs/design.md, Touch, gestures and
   keys): a toast, a failed send, the link to Shepherdr going and coming back, a filter's new count. Drawn by ui.tsx's
   LiveRegion, mounted once by the app. Each `say()` adds its own line, so it is spoken once, and the same words said
   again later are spoken again; a line leaves after a while, quietly, so nothing is read twice on a later visit. */

export type Said = { id: number; text: string }

/** how long a line stays in the region once said (long enough for a screen reader to reach it) */
export const KEEP_MS = 7000
/** the most lines kept at once: an older one gives its place */
const MOST = 3

let lines: Said[] = []
let next = 1
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/** say this once to screen readers, politely (after what they are reading now) */
export function say(text: string): void {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return
  const line = { id: next++, text: t }
  lines = [...lines, line].slice(-MOST)
  changed()
  setTimeout(() => {
    if (!lines.includes(line)) return
    lines = lines.filter((x) => x !== line)
    changed()
  }, KEEP_MS)
}

export const saidLines = (): Said[] => lines
export function onSaid(f: () => void): () => void {
  listeners.add(f)
  return () => void listeners.delete(f)
}

/** for tests: nothing said */
export function resetSaid(): void {
  lines = []
  changed()
}
