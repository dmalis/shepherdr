// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"): what a red count stands for,
// item by item, and where a tap on it goes. fork Needs you 5/6: the items are the person's open actions
// (web/shared/attention.ts), exactly what needsCount counts (a test holds the two together); which things count is
// decided there, not here.
import type { Snapshot, Task } from './types.ts'
import type { TaskFilter } from './task-filter.ts'
import { isEverything, spaceLabel, taskInSpace } from './view.ts'
import { attentionOf, holds, yours, type Action, type Alert } from './attention.ts'

/** one thing that needs you: a task (its pane) or a chat (a space's own agent asking), and the card it shows there */
export interface NeedItem {
  task?: string
  place: string
  /** the card to scroll to: its data-card as the app draws it */
  card: string | null
  /** a queued question's title, for its row */
  title?: string
  /** fork #235: its row's second line (a Triage card: what it is about) */
  sub?: string
}

/** an action as a tap opens it: its task's pane (or its chat) at its card */
function itemOf(snap: Snapshot, a: Action): NeedItem {
  const t = a.task ? snap.tasks.find((x) => x.id === a.task) : undefined
  return { ...(a.task ? { task: a.task } : {}), place: t?.place ?? a.place, card: a.card, ...(!a.task && a.kind === 'question' ? { title: a.what } : {}),
    // fork #235: a Triage card's row says its question, then what it is about
    ...(a.kind === 'triage' && a.triage ? { title: a.what, sub: a.triage.title } : {}),
    // fork "Shepherdr's asks in Needs you": a space's Shepherdr asking in plain words: its row says the question
    ...(a.kind === 'chat' && a.plain ? { sub: a.what } : {}),
    // a space's grouped drafts: one row, which opens their one card
    ...(a.kind === 'triage' && a.drafts ? { title: a.what, sub: a.batch ? `One Yes posts ${a.batch === a.drafts ? 'the ones you tick' : `${a.batch} of them`}` : 'Each waits for your yes or no' } : {}) }
}

/** what needsCount(snap, placeId) counts, one item each, oldest first */
export function needsItems(snap: Snapshot, placeId?: string): NeedItem[] {
  return yours(snap, placeId).map((a) => itemOf(snap, a))
}

/** a tap opens one card only when the count is 1; anything more is a list */
export const oneTarget = (items: NeedItem[]): NeedItem | null => (items.length === 1 ? items[0]! : null)

/** the link that opens one item where it waits, at its card (the app's own links, kernel's openLink) */
export function itemLink(i: NeedItem): string {
  const q = new URLSearchParams({ place: i.place, ...(i.task ? { task: i.task } : {}), ...(i.card ? { focus: i.card } : {}) })
  return `./?${q}`
}

const inScope = (snap: Snapshot, t: Task, placeId?: string) => !placeId || isEverything(snap, placeId) || taskInSpace(t, placeId)

/** the Tasks list's "Needs you" filter: a task with an open action of yours (a queued question among them) in any of
 *  these spaces (Everything: everyone's). The last argument is no longer read (the projection holds the alerts). */
export function needsTask(snap: Snapshot, t: Task, scopes: string[], _alerting?: Map<string, Alert>): boolean {
  return attentionOf(snap).actions.some((a) => a.owner === 'you' && holds(a, t.id)) && scopes.some((p) => inScope(snap, t, p))
}

/** what the chats among these spaces ask themselves (no task), each once: they have no row in Tasks, so the list adds
 *  one each. The rest of the filter applies to them as to a task: a space, machine or "only here" picked, a state
 *  other than Needs you, or a repo (a chat has none) leaves them out. */
export function needsChats(snap: Snapshot, scopes: string[], f?: TaskFilter, at = ''): NeedItem[] {
  const machine = (id: string) => snap.places.find((p) => p.id === id)?.machine ?? ''
  const fits = (i: NeedItem) =>
    !f ||
    ((!f.space.length || f.space.includes(i.place)) &&
      (!f.machine.length || f.machine.includes(machine(i.place))) &&
      (!f.here || !at || isEverything(snap, at) || i.place === at) &&
      (!f.state.length || f.state.includes('needs')) &&
      !f.repo.length)
  // one row an action
  const rows = new Map<string, NeedItem>()
  for (const i of scopes.flatMap((p) => needsItems(snap, p))) if (!i.task && fits(i) && !rows.has(`${i.place} ${i.card}`)) rows.set(`${i.place} ${i.card}`, i)
  return [...rows.values()]
}

/** the actions of a task beyond its lead (a second prompt, a question asked from a card): each a row of its own under
 *  Needs you, so the list shows as many as the count says */
export function moreActions(snap: Snapshot, t: Task): Action[] {
  const mine = attentionOf(snap).actions.filter((a) => a.owner === 'you' && a.task === t.id)
  const lead = mine.find((a) => a.kind !== 'question')
  return mine.filter((a) => a !== lead)
}

/** the filter a red count's tap puts on: only the Needs you of these spaces, nothing else picked */
export const needsFilter = (scopes: string[]): TaskFilter => ({ state: [], machine: [], space: [], repo: [], here: false, hideDone: false, needs: scopes })

/** its chip: "Needs you", "Needs you in docs", "Needs you in 3 spaces" */
export function needsChip(snap: Snapshot, scopes: string[]): string {
  if (scopes.some((p) => isEverything(snap, p))) return 'Needs you'
  return scopes.length === 1 ? `Needs you in ${spaceLabel(snap, scopes[0]!).replace(/^#/, '')}` : `Needs you in ${scopes.length} spaces`
}

/** a red count's words for a screen reader: "1 needs you", "2 need you" */
export const needsWords = (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} you`
