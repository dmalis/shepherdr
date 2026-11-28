// Long text, folded. A long paste into the message box becomes a chip (its size and first words) instead of a wall of
// text in the box, as Claude's apps do; it opens to read, goes back into the box to edit, and its x takes it out. It is
// sent as text, exactly as pasted, where it was pasted (fork #186): each paste keeps its place in your words through
// later edits, as Claude Code's "[Pasted text]" does. In the chat a very long message shows its first lines and
// Show more; its words are all there (copy, and the browser's find, see them).
import { useSyncExternalStore } from 'react'
import { draftParts, keepDraft } from '@client/draft.ts'
import { draftEdits, type DraftEdit } from '@client/kernel.ts'
import { isCommand } from './command.ts'

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

/** how much blank space after place `i` in `text` goes when a paste is there: the blank lines next to it, or the
 *  spaces on its own line; never a line's indent */
function gapAfter(text: string, i: number): number {
  const rest = text.slice(i)
  const blank = /^\s*\n/.exec(rest)
  if (blank) return blank[0].length
  return i === 0 || text[i - 1] === '\n' ? 0 : /^[ \t]*/.exec(rest)![0].length
}

/** what goes to the agent: your words with each paste, as it was pasted, where it was pasted (`at`, a place in your
 *  words; none: after them), a blank line around it. Pastes at one place keep their order. Only the blank space
 *  between a paste and your words goes: a line after it keeps its indent */
export function joined(typed: string, pastes: (string | { text: string; at?: number })[]): string {
  const ps = pastes
    .map((p, i) => (typeof p === 'string' ? { text: p, at: typed.length, i } : { text: p.text, at: Math.min(Math.max(p.at ?? typed.length, 0), typed.length), i }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
  // the words between two places: the message's own start trimmed, as always; after a paste, the blank space next to it
  const cut = (from: number, to: number, first: boolean) => {
    const w = typed.slice(from, to)
    return (first ? w.trimStart() : w.slice(gapAfter(typed, from))).trimEnd()
  }
  const parts: string[] = []
  let from = 0
  for (const p of ps) {
    parts.push(cut(from, p.at, !parts.length), p.text)
    from = p.at
  }
  parts.push(cut(from, typed.length, !parts.length))
  return parts.filter((p) => p.trim()).join('\n\n')
}

/** what Send sends: `joined`, except that a paste never makes a message a `!` command (it would run in the agent's
 *  shell, its reply dropped): a paste that would start your message goes after your words, as before fork #186 */
export function outgoing(typed: string, pastes: (string | { text: string; at?: number })[]): string {
  const t = joined(typed, pastes)
  return typed.trim() && isCommand(t) && !isCommand(typed) ? joined(typed, pastes.map((p) => (typeof p === 'string' ? p : p.text))) : t
}

type Range = { from: number; to: number; added: number }

/** the part of `before` an edit replaced to make `after`: `edit`'s when it fits the two, else the part between what
 *  both start and end with */
export function editRange(before: string, after: string, edit?: DraftEdit): Range {
  const d = after.length - before.length
  if (edit && 'from' in edit) {
    const { from, to } = edit
    if (from >= 0 && from <= to && to <= before.length && to - from + d >= 0 && before.slice(0, from) === after.slice(0, from) && before.slice(to) === after.slice(to + d))
      return { from, to, added: to - from + d }
  }
  const most = Math.min(before.length, after.length)
  let p = 0
  while (p < most && before[p] === after[p]) p++
  let s = 0
  while (s < most - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++
  return { from: p, to: before.length - s, added: after.length - s - p }
}

/** what a typed edit replaced: what was selected as it began (`sel`), or, with nothing selected, the letters a
 *  Backspace or Delete took (`caret`: where the caret is after it) */
export function typedEdit(before: string, after: string, sel: { start: number; end: number }, caret: number): DraftEdit {
  if (sel.end > sel.start || after.length >= before.length) return { from: sel.start, to: sel.end }
  const gone = before.length - after.length
  return caret < sel.start ? { from: caret, to: sel.start } : { from: sel.start, to: sel.start + gone }
}

/** A paste's place after an edit `r`. `push`: the edit before this one ended at the place (a Backspace or a word
 *  replaced just before the paste), so letters typed there next go before the paste, as you write on; else letters
 *  typed at its place go after it, as the caret is after a paste once it is pasted. A place inside what the edit
 *  replaced goes to its start. Back: the place, and whether this edit ended there */
export function moved(at: number, push: boolean, r: Range): { at: number; push: boolean } {
  if (at < r.from) return { at, push: false }
  if (r.from === r.to) return at === r.from && !push ? { at, push: false } : { at: at + r.added, push: at === r.from }
  if (at === r.from) return { at, push: false }
  if (at >= r.to) return { at: at + r.from + r.added - r.to, push: at === r.to }
  return { at: r.from, push: false }
}

/** `t` put into `text` at `at` as a paste is sent, a blank line between it and the words either side: only the
 *  blank space next to it goes, a line after it keeps its indent. Back: the new words, the part of `text` it replaced
 *  and where `t` ends */
export function putBack(text: string, at: number, t: string): { text: string; from: number; to: number; end: number } {
  const i = Math.min(Math.max(at, 0), text.length)
  const head = text.slice(0, i).replace(/[ \t]+$/, '')
  const gap = gapAfter(text, i)
  const tail = text.slice(i + gap)
  const lead = !head || head.endsWith('\n\n') ? '' : head.endsWith('\n') ? '\n' : '\n\n'
  const put = head + lead + t
  return { text: tail.trim() ? `${put}\n\n${tail}` : put, from: head.length, to: i + gap, end: put.length }
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
  else {
    delete all[key]
    history.delete(key)
  }
  // a paste added, opened or moved by hand: the words as they are now have it there
  const h = history.get(key)
  if (h?.length && !moving) h[h.length - 1] = { text: h[h.length - 1]!.text, places: placesOf(next) }
  keepDraft(key, 'pastes', next.length ? next : undefined)
  listeners.forEach((l) => l())
}
let n = 0
export const addPaste = (key: string, text: string, at?: number) =>
  setPastes(key, (ps) => [...ps, { id: `${Date.now().toString(36)}-${n++}`, text, ...(at === undefined ? {} : { at }) }])
export const dropPaste = (key: string, id: string) => setPastes(key, (ps) => ps.filter((p) => p.id !== id))

/** each paste's `push` (see moved), and what each box's words and places were after its last edits, so an undo or
 *  redo puts its pastes back where they were with those words. On this page only */
const pushed = new Map<string, boolean>()
let moving = false
const HISTORY = 100
const history = new Map<string, { text: string; places: Record<string, number> }[]>()
const placesOf = (ps: Paste[]) => Object.fromEntries(ps.filter((p) => p.at !== undefined).map((p) => [p.id, p.at!]))
function remember(key: string, text: string, ps: Paste[]) {
  const h = history.get(key) ?? []
  h.push({ text, places: placesOf(ps) })
  if (h.length > HISTORY) h.shift()
  history.set(key, h)
}

// each edit of a box's words moves its pastes' places with it (kernel.ts setDraft). A paste kept from before fork
// #186 has no place: it stays after the words
draftEdits.add((key, before, after, edit) => {
  const ps = getPastes(key)
  if (!ps.some((p) => p.at !== undefined)) return
  if (!history.get(key)?.length) remember(key, before, ps)
  const back = edit && 'undo' in edit ? history.get(key)!.findLast((h) => h.text === after) : undefined
  const r = editRange(before, after, edit)
  const next = ps.map((p) => {
    if (p.at === undefined) return p
    let at: number
    if (back && back.places[p.id] !== undefined) {
      at = Math.min(back.places[p.id]!, after.length)
      pushed.delete(p.id)
    } else {
      const m = moved(p.at, pushed.get(p.id) ?? false, r)
      at = m.at
      if (m.push) pushed.set(p.id, true)
      else pushed.delete(p.id)
    }
    return at === p.at ? p : { ...p, at }
  })
  moving = true
  if (next.some((p, i) => p !== ps[i])) setPastes(key, () => next)
  moving = false
  remember(key, after, next)
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
