// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"): what a red count stands for,
// item by item, and where a tap on it goes. The items are exactly what needsCount counts (a test holds the two
// together); which things count is not decided here.
import { NO_FILTER, fstate, type TaskFilter } from './task-filter.ts'
import type { Snapshot } from './types.ts'
import { isEverything, taskInSpace, tstate } from './view.ts'
import { taskAlerts } from './needs-you.ts'

/** one thing that needs you: a task (its pane, at its card when it has one) or a chat (a space's own agent asking) */
export type NeedItem = { task: string; place: string; card: string | null } | { task?: undefined; place: string; card: string | null }

/** the card a need shows, to scroll to: its request's id ('attention' has no card) */
const cardOf = (id: string | undefined) => (id && id !== 'attention' ? id : null)

/** what needsCount(snap, placeId) counts, one item each, in the same order: tasks, chats, queued questions */
export function needsItems(snap: Snapshot, placeId?: string): NeedItem[] {
  const all = !placeId || isEverything(snap, placeId)
  const alerting = taskAlerts(snap)
  const needs = snap.needs ?? []
  const card = (task: string) => cardOf(needs.find((n) => n.task === task && cardOf(n.id))?.id)
  const tasks = snap.tasks
    .filter((t) => (all || taskInSpace(t, placeId)) && (['ask', 'ready'].includes(tstate(t)) || (alerting.has(t.id) && tstate(t) !== 'done' && tstate(t) !== 'archived')))
    .map((t): NeedItem => ({ task: t.id, place: t.place, card: card(t.id) }))
  const chats = snap.places
    .filter((p) => p.needs && (all || p.id === placeId))
    .map((p): NeedItem => ({ place: p.id, card: cardOf(needs.find((n) => !n.task && n.place === p.id && cardOf(n.id))?.id) }))
  const queued = needs
    .filter((n) => n.question?.queued && (all || (n.task ? !!snap.tasks.find((t) => t.id === n.task && taskInSpace(t, placeId)) : n.place === placeId)))
    .map((n): NeedItem => (n.task ? { task: n.task, place: snap.tasks.find((t) => t.id === n.task)?.place ?? n.place, card: n.question?.id ?? cardOf(n.id) } : { place: n.place, card: n.question?.id ?? cardOf(n.id) }))
  return [...tasks, ...chats, ...queued]
}

/** the one place a tap opens, when every item is in the same task (or the same chat); none when they are spread out.
 *  The card to scroll to is the first one any of them names. */
export function oneTarget(items: NeedItem[]): NeedItem | null {
  if (!items.length) return null
  const key = (i: NeedItem) => (i.task ? `t:${i.task}` : `p:${i.place}`)
  if (items.some((i) => key(i) !== key(items[0]))) return null
  return { ...items[0], card: items.find((i) => i.card)?.card ?? null }
}

/** the Tasks filter that lists a scope's Needs you: a space's (This space only), a machine's, or everyone's. Ready
 *  for review counts as Needs you, and a task an Assistant stopped is filed under Stopped, so those states come too
 *  when one of the items is one. */
export function needsFilter(snap: Snapshot, items: NeedItem[], scope: { place?: string; machine?: string }): TaskFilter {
  const states = new Set<string>(['needs'])
  for (const i of items) {
    const t = i.task ? snap.tasks.find((x) => x.id === i.task) : undefined
    const s = t && fstate(t)
    if (s === 'ready' || s === 'stopped') states.add(s)
  }
  const here = !!scope.place && !isEverything(snap, scope.place)
  return { ...NO_FILTER, state: [...states], here, machine: scope.machine ? [scope.machine] : [] }
}

/** a red count's words for a screen reader: "1 needs you", "2 need you" */
export const needsWords = (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} you`
