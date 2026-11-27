// What the Feedback page says (friction loop, slice 2, #94: fork/specs/friction-loop.md), as plain functions the tests
// read. Never "Assistant", "worker" or a key: the person reads these, and an agent's name for itself is not theirs.
import type { FeedbackList, FeedbackRow } from '@shared/types.ts'

export const W = {
  title: 'Feedback',
  sub: 'Problems in Shepherdr itself',
  box: 'What should be better?',
  boxLabel: 'What should be better in Shepherdr',
  send: 'Send',
  saving: 'Saving…',
  saved: 'Kept under Found',
  boxOff: "Feedback offers are off in this space, so nothing was kept. Turn them on in Settings › Agents, or write from another space.",
  empty: 'Nothing found',
  emptySub: "When something in Shepherdr doesn't work as it should, your agents note it here.",
  offAll: 'Feedback offers are off for every space: agents note nothing new.',
  offAllLink: 'Open Settings',
  stale: "Couldn't read the newest list just now: showing the last one.",
  found: 'Found',
  filed: 'Filed',
  later: 'Not now',
  declined: 'Said no',
  writeUp: 'Write it up',
  notNow: 'Not now',
  never: 'Never',
  restore: 'Restore',
  undo: 'Undo',
  open: 'Open',
  onGitHub: 'On GitHub',
  noFix: 'No fix proposed yet',
} as const

/** Not now's menu, in the order Linear's Snooze and iOS Mail's Remind me list theirs */
export const LATER: { when: 'tomorrow' | 'week' | 'again'; label: string }[] = [
  { when: 'tomorrow', label: 'Tomorrow' },
  { when: 'week', label: 'Next week' },
  { when: 'again', label: 'When it happens again' },
]

/** the person's message that asks the origin's chat to shape it (spec: "Write it up") */
export const writeUpText = (line: string) => `Write up the feedback about “${line}”`

/** a row's sections, each newest first (the service sorts) */
export function sectionsOf(list: FeedbackList | undefined) {
  const rows = list?.rows ?? []
  const of = (s: FeedbackRow['section']) => rows.filter((r) => r.section === s)
  return { found: of('found'), filed: of('filed'), later: of('later'), declined: of('declined') }
}

/** a herdr space id ("sp3", "vm/sp3") and its chat's key ("p:sp3", "p:vm:sp3"), both ways (service/compat.ts placeKey).
 *  A place is found by its chat: the service names places by their space id, the demo by their chat key, and both agree
 *  on the chat. */
export const chatOfSpace = (space: string) => `p:${space.replace('/', ':')}`
export const spaceOfChat = (chat: string) => chat.replace(/^p:/, '').replace(':', '/')

/** how long ago, as the rest of the app says it: "now", "5 min ago", "2 h ago", "yesterday", "3 days ago" */
export function agoWords(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60_000))
  if (m < 1) return 'now'
  if (m < 60) return `${m}\u00a0min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}\u00a0h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d}\u00a0days ago`
}

/** who noticed it first, as people say it */
export function fromWords(r: Pick<FeedbackRow, 'from'>): string {
  const f = r.from
  if (f?.person) return 'You wrote it'
  if (f?.task) return `From the task “${f.task}”`
  if (f?.chat) return 'Noted in chat'
  if (f?.action) return `From “${f.action}”`
  return 'Noted by an agent'
}

/** the row's quiet line: who, where, when, how often */
export function metaOf(r: FeedbackRow, where: string, now = Date.now()): string {
  const bits = [fromWords(r), ...(where && !r.from?.task ? [`in ${where}`] : []), agoWords(r.at, now)]
  if (r.count > 1) bits.push(`${r.count}\u00a0reports`)
  return bits.join(' · ')
}

/** a Not now row: when it comes back under Found */
export function backWords(until: number | null | undefined, now = Date.now()): string {
  if (until == null) return 'Comes back when it happens again'
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const days = Math.floor((until - start.getTime()) / 86_400_000)
  if (days <= 0) return 'Comes back later today'
  if (days === 1) return 'Comes back tomorrow'
  return `Comes back in ${days} days`
}

/** a filed row's state, only from what herdr-task knows */
export const filedWords = (r: Pick<FeedbackRow, 'state' | 'url'>) => (r.state === 'filing' ? 'Posting' : 'Filed')

/** what a call did, for its toast */
export function doneWords(what: 'later' | 'no' | 'undo', when?: string): string {
  if (what === 'no') return 'Said no: it stays out of the way'
  if (what === 'undo') return 'Back as it was'
  return when === 'again' ? 'Not now: back when it happens again' : when === 'week' ? 'Not now: back next week' : 'Not now: back tomorrow'
}

/** where Write it up goes, when it isn't the origin: why, for the row */
export function elsewhereWords(where: string, why: 'gone' | 'away'): string {
  return why === 'gone' ? 'Its space is gone: Write it up goes to Everything' : `${where} can't be reached: Write it up goes to Everything`
}

export const offWords = (where: string) => `Feedback offers are off in ${where || 'its space'}: nothing more happens to it`

/** the box: which space it comes from */
export const fromBox = (where: string) => `From ${where}`
