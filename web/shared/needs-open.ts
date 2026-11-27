// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"): what a red count stands for,
// item by item, and where a tap on it goes. The items are exactly what needsCount counts (a test holds the two
// together); which things count is not decided here.
import type { Need, Snapshot, Task } from './types.ts'
import type { TaskFilter } from './task-filter.ts'
import { isEverything, spaceLabel, taskInSpace, tstate } from './view.ts'
import { taskAlerts, type Alert } from './needs-you.ts'

/** one thing that needs you: a task (its pane) or a chat (a space's own agent asking), and the card it shows there */
export interface NeedItem {
  task?: string
  place: string
  /** the card to scroll to: its data-card as the app draws it */
  card: string | null
  /** a queued question's title, for its row */
  title?: string
}

type Alerting = Map<string, Alert>
const inScope = (snap: Snapshot, t: Task, placeId?: string) => !placeId || isEverything(snap, placeId) || taskInSpace(t, placeId)

/** needsCount's rule for a task: under Needs you (Ready for review among them), or an alert about it still stands */
const counted = (t: Task, alerting: Alerting) => ['ask', 'ready'].includes(tstate(t)) || (alerting.has(t.id) && tstate(t) !== 'done' && tstate(t) !== 'archived')
/** a question answered from its card while the chat carries on (needsCount counts it on its own) */
const queuedFor = (snap: Snapshot, t: Task) => (snap.needs ?? []).some((n) => n.question?.queued && n.task === t.id)

/** the card a need draws: its question's or secret's, or the hands card; 'attention' has none */
function needCard(n: Need): string | null {
  if (n.hands) return n.task ? `hands:${n.task}` : null
  return n.question?.id ?? n.secret?.id ?? (n.id && n.id !== 'attention' ? n.id : null)
}

/** the card a task that needs you shows in its own chat, as the tasks and screens plugins draw them */
function taskCard(snap: Snapshot, t: Task, alerting: Alerting): string | null {
  const need = (snap.needs ?? []).find((n) => n.task === t.id && needCard(n))
  if (need) return needCard(need)
  const sc = snap.screens?.[`task:${t.id}`]
  if (sc?.hands && !sc.hands.settled) return `hands:${t.id}`
  if (tstate(t) === 'ready') return `review:${t.id}`
  if (tstate(t) === 'ask' && t.stopped && t.stopped.by !== 'you') return `stopped:${t.id}`
  const a = alerting.get(t.id)
  return a ? `alert:${a.id}` : null
}

/** what needsCount(snap, placeId) counts, one item each, in the same order: tasks, chats, queued questions */
export function needsItems(snap: Snapshot, placeId?: string): NeedItem[] {
  const all = !placeId || isEverything(snap, placeId)
  const alerting = taskAlerts(snap)
  const needs = snap.needs ?? []
  const tasks = snap.tasks.filter((t) => inScope(snap, t, placeId) && counted(t, alerting)).map((t): NeedItem => ({ task: t.id, place: t.place, card: taskCard(snap, t, alerting) }))
  const chats = snap.places
    .filter((p) => p.needs && (all || p.id === placeId))
    .map((p): NeedItem => {
      const n = needs.find((x) => !x.task && x.place === p.id && needCard(x))
      return { place: p.id, card: n ? needCard(n) : null }
    })
  const queued = needs
    .filter((n) => n.question?.queued && (all || (n.task ? !!snap.tasks.find((t) => t.id === n.task && taskInSpace(t, placeId!)) : n.place === placeId)))
    .map((n): NeedItem => {
      const t = n.task ? snap.tasks.find((x) => x.id === n.task) : undefined
      return { ...(n.task ? { task: n.task } : {}), place: t?.place ?? n.place, card: needCard(n), ...(n.task ? {} : { title: n.question!.title }) }
    })
  return [...tasks, ...chats, ...queued]
}

/** a tap opens one card only when the count is 1; anything more is a list */
export const oneTarget = (items: NeedItem[]): NeedItem | null => (items.length === 1 ? items[0]! : null)

/** the link that opens one item where it waits, at its card (the app's own links, kernel's openLink) */
export function itemLink(i: NeedItem): string {
  const q = new URLSearchParams({ place: i.place, ...(i.task ? { task: i.task } : {}), ...(i.card ? { focus: i.card } : {}) })
  return `./?${q}`
}

/** the Tasks list's "Needs you" filter: a task the count counts in any of these spaces (Everything: everyone's) */
export function needsTask(snap: Snapshot, t: Task, scopes: string[], alerting: Alerting = taskAlerts(snap)): boolean {
  return (counted(t, alerting) || queuedFor(snap, t)) && scopes.some((p) => inScope(snap, t, p))
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
  // one row a card; the queued question itself, with its title, over the chat's own ask of the same card
  const rows = new Map<string, NeedItem>()
  for (const i of scopes.flatMap((p) => needsItems(snap, p))) if (!i.task && fits(i) && (!rows.has(`${i.place} ${i.card}`) || i.title)) rows.set(`${i.place} ${i.card}`, i)
  return [...rows.values()]
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
