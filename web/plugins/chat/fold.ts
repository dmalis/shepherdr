// Long text, folded. A long paste into the message box becomes a chip (its size and first words) instead of a wall of
// text in the box, as Claude's apps do; it opens to read, goes back into the box to edit, and its x takes it out. It is
// sent as text, exactly as pasted, where it was pasted (fork #186): each paste keeps its place in your words through
// later edits, as Claude Code's "[Pasted text]" does. In the chat a very long message shows its first lines and
// Show more; its words are all there (copy, and the browser's find, see them).
import { useSyncExternalStore } from 'react'
import { draftParts, keepDraft } from '@client/draft.ts'
import { draftEdits } from '@client/kernel.ts'

/** a paste this long becomes a chip: many lines (a log, a JSON) or many characters (one long line of JSON) */
export const PASTE_LINES = 25
export const PASTE_CHARS = 2500
/** a message this long shows folded in the chat */
export const FOLD_LINES = 30
export const FOLD_CHARS = 3000

export const linesOf = (t: string) => t.replace(/\n$/, '').split('\n').length

export const isLongPaste = (t: string) => !!t.trim() && (linesOf(t) >= PASTE_LINES || t.length >= PASTE_CHARS)
export const isLongMessage = (t: string) => linesOf(t) > FOLD_LINES || t.length > FOLD_CHARS

/** its size in words: lines when it has many, else characters */
export function sizeOf(t: string): string {
  const n = linesOf(t)
  if (n > 1) return `${n.toLocaleString('en-US')} lines`
  const c = t.length
  return c >= 1000 ? `${(c / 1000).toFixed(1).replace(/\.0$/, '')}k characters` : `${c} characters`
}

/** its first words, on one line */
export function peekOf(t: string, max = 80): string {
  const s = t.trim().replace(/\s+/g, ' ')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** what goes to the agent: your words with each paste, as it was pasted, where it was pasted (`at`, a place in your
 *  words; none: after them), a blank line around it. Pastes at one place keep their order */
export function joined(typed: string, pastes: (string | { text: string; at?: number })[]): string {
  const ps = pastes
    .map((p, i) => (typeof p === 'string' ? { text: p, at: typed.length, i } : { text: p.text, at: Math.min(Math.max(p.at ?? typed.length, 0), typed.length), i }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
  const parts: string[] = []
  let from = 0
  for (const p of ps) {
    parts.push(typed.slice(from, p.at).trim(), p.text)
    from = p.at
  }
  parts.push(typed.slice(from).trim())
  return parts.filter((p) => p.trim()).join('\n\n')
}

/** where a place in the words is after an edit from `before` to `after`. The edit is the part between what both
 *  start and end with; `end`, where the caret is after it, says where that part ends when repeated letters leave it
 *  unclear. A place before the edit stays, one after it moves with it, one inside a replaced part goes to its start;
 *  letters typed at a paste's place go after the paste, as the caret is there once it is pasted */
export function shifted(at: number, before: string, after: string, end?: number): number {
  if (before === after) return at
  const most = Math.min(before.length, after.length)
  let p = 0
  while (p < most && before[p] === after[p]) p++
  let s = 0
  while (s < most - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++
  if (end !== undefined && end >= 0 && end <= after.length) {
    const tail = after.length - end
    if (tail <= before.length && before.endsWith(after.slice(end))) {
      s = tail
      p = Math.min(p, end, before.length - tail)
    }
  }
  if (at <= p) return at
  if (at >= before.length - s) return at + after.length - before.length
  return p
}

/* ---------- a box's pastes, kept with its draft across reloads ---------- */

/** `at`: where in the box's words it was pasted (none, from before fork #186: after them) */
export type Paste = { id: string; text: string; at?: number }
// kept with the rest of its box's draft (draft.ts, fork #149)
let all: Record<string, Paste[]> = draftParts('pastes')
const listeners = new Set<() => void>()
const none: Paste[] = []

export const getPastes = (key: string): Paste[] => all[key] ?? none
export function setPastes(key: string, fn: (ps: Paste[]) => Paste[]) {
  const next = fn(getPastes(key))
  all = { ...all }
  if (next.length) all[key] = next
  else delete all[key]
  keepDraft(key, 'pastes', next.length ? next : undefined)
  listeners.forEach((l) => l())
}
let n = 0
export const addPaste = (key: string, text: string, at?: number) =>
  setPastes(key, (ps) => [...ps, { id: `${Date.now().toString(36)}-${n++}`, text, ...(at === undefined ? {} : { at }) }])
export const dropPaste = (key: string, id: string) => setPastes(key, (ps) => ps.filter((p) => p.id !== id))

// each edit of a box's words moves its pastes' places with it (kernel.ts setDraft)
draftEdits.add((key, before, after, end) => {
  const ps = getPastes(key)
  if (!ps.length) return
  const moved = ps.map((p) => {
    const at = shifted(p.at ?? before.length, before, after, end)
    return at === p.at ? p : { ...p, at }
  })
  if (moved.some((p, i) => p !== ps[i])) setPastes(key, () => moved)
})

export function usePastes(key: string): Paste[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => getPastes(key),
    () => getPastes(key),
  )
}
