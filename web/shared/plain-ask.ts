// Shepherdr's plain asks and idle spaces (dmalis/shepherdr, "Shepherdr's asks in Needs you"). A space's Shepherdr that
// ends its turn waiting on the person in plain chat words, not with its question card, still waits on them: this says
// when it does, from Shepherdr's own chat (its newest words and their reply bubbles), and when a space has stopped with
// work still to start. web/shared/attention.ts makes the ask one of the person's actions (red, counted in Needs you,
// never pushed: it is read off words, and the message itself already reached the bell); the space's row shows the idle
// one quietly (web/src/list.tsx).
//
// Precise on purpose (fork/specs/needs-you.md: too many alerts was the person's first complaint). Reply bubbles end
// almost every reply, so bubbles alone are never an ask. It is one when Shepherdr's turn ended, its newest words are its
// own (nothing the person wrote since), and either
// - they close on a direct question with its answers offered (two or more bubbles, as the suggested-replies rule gives
//   one per option and both answers to a yes or no; or no bubbles at all, with that setting off), or
// - they offer two or more choices while nothing else runs in its space: work there has stopped on the person's word.
// Slack and Linear mark what waits on you (a mention, a review asked of you), not every message; GitHub keeps a review
// request until you act on it. So it lasts until the person answers (or Shepherdr moves on), not until it is read.
import type { Place, Task } from './types.ts'

/** Shepherdr's newest words with what they offer, as the service read them off its chat for that turn */
export interface PlainAsk {
  /** the words a row shows: its question, else its closing line, cut short */
  what: string
  /** its closing words ask a direct question */
  question: boolean
  /** how many reply bubbles it offers */
  choices: number
  /** the chat's turn it was read at (snapshot `last`): words from another turn never count */
  turn: number
}

/** a chat's newest message with words, the person's or its agent's (service/main.ts lastWords) */
export interface LastWords { who: 'you' | 'agent'; text: string; suggests?: string[] }

const MAX = 120
const cut = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s)
// markdown a line closes with (bold, code, a bracket, a quote) before its question mark is read
const plain = (s: string) => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
const asks = (s: string) => /\?$/.test(s.replace(/[\s*_`)"'”’\]]+$/, ''))
const isList = (para: string) => para.split('\n').every((l) => /^\s*([-*•]|\d+[.)])\s/.test(l) || !l.trim())

/** the ask in Shepherdr's newest words, or null: none when the person wrote last */
export function plainAskOf(m: LastWords | null | undefined, turn: number): PlainAsk | null {
  if (!m || m.who !== 'agent' || !m.text) return null
  // its own tags (reply bubbles, reactions, a reply's quote) and a no-reply never show as words
  const text = m.text.replace(/<hc\b[^>]*\/>/g, '').replace(/<hc\b[^>]*>[\s\S]*?<\/hc>/g, '').replace(/<no-reply\s*\/?>/g, '').trim()
  if (!text) return null
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  // its closing words: the last paragraph, and the one that leads into it when that is a list of options
  const last = paras.length - 1
  const closing = isList(paras[last]!) && last > 0 ? [paras[last - 1]!, paras[last]!] : [paras[last]!]
  const sentences = closing.flatMap((p) => p.split('\n')).flatMap((l) => plain(l).split(/(?<=[.?!])\s+/)).filter(Boolean)
  const q = sentences.findLast(asks)
  const choices = (m.suggests ?? []).filter((s) => s.trim()).length
  return { what: cut(q ?? sentences[0] ?? plain(paras[last]!)), question: !!q, choices, turn }
}

const RUNNING: ReadonlyArray<Task['status']> = ['work', 'merging', 'queued']
const inSpace = (t: Task, place: string) => t.place === place || !!t.also?.includes(place)
const open = (t: Task) => !t.archived && t.status !== 'done'

/** a task of the space's is at work, on its way in, or about to start by itself */
export const spaceRunning = (tasks: Task[], place: string) => tasks.some((t) => open(t) && inSpace(t, place) && RUNNING.includes(t.status))

/** Shepherdr's turn ended and its chat runs (it answers when the person writes) */
const idleShepherdr = (p: Place) => p.shepherdr !== 'stopped' && p.shepherdr !== 'none' && p.status !== 'work' && p.status !== 'need'

/** does the space's Shepherdr wait on the person in plain words now: its ask, else null */
export function asksYou(p: Place, tasks: Task[], last?: Record<string, number>): PlainAsk | null {
  const a = p.asks
  if (!a || p.archived || !idleShepherdr(p)) return null
  // words of another turn than the chat's newest say nothing of now
  if (last && p.chat && last[p.chat] !== undefined && Number(last[p.chat]) !== a.turn) return null
  if (a.question && (a.choices === 0 || a.choices >= 2)) return a
  if (a.choices >= 2 && !spaceRunning(tasks, p.id)) return a
  return null
}

/** a space with nothing running and work waiting to start (tasks To do of its own): how many, else null. Quiet: the
 *  person sees that work there stopped, without a count of theirs */
export function spaceIdle(p: Place, tasks: Task[]): { todo: number } | null {
  if (p.archived || p.status === 'work' || spaceRunning(tasks, p.id)) return null
  const todo = tasks.filter((t) => open(t) && t.place === p.id && t.status === 'todo').length
  return todo ? { todo } : null
}

/** its words on the space's row */
export const idleWords = (n: number) => `Idle · ${n} up next`
