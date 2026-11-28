// Radar, the clickable prototype (dmalis/shepherdr "Radar: one place for work coming in"): what might become work
// before it is a task, per project. Only the demo's `?case=radar` sends its data (`snap.radar`); the real service never
// does, so the plugin draws nothing of its own for real users even when it is switched on. Every click here changes
// this page's copy only (in memory, gone on reload), so the person can try each path; nothing is posted or started.
import { useSyncExternalStore } from 'react'

export type Source = 'agents' | 'github' | 'sentry' | 'upstream' | 'you'
export type Workflow = 'Start' | 'Review' | 'Install' | 'Chat' | 'Phone'

export interface Sighting {
  /** the task (or the person) that hit it */
  who: string
  at: number
  note?: string
}

export interface RadarItem {
  id: string
  project: string
  title: string
  /** a few words for the calm timeline's one line ("Review stall"), the title when there are none */
  short?: string
  /** when it last changed (found, queued, parked, said no to, jotted): the timeline's time when it has no ship */
  changed?: number
  kind: 'problem' | 'idea' | 'error' | 'release'
  sources: Source[]
  /** new: not sorted yet; next: in the queue; held: in the queue but held back; running: a task is on it; later:
   *  parked; shipped: reached the project; declined: Not doing */
  state: 'new' | 'next' | 'held' | 'running' | 'later' | 'shipped' | 'declined'
  /** one line: why it is where it is (why next, why it rose) */
  reason: string
  /** how many distinct tasks hit it, and how many sightings in all */
  tasks?: number
  sightings?: Sighting[]
  /** the workflow it hurts (the pain map's row) and how many tasks hit it on each of the last 14 days, oldest first */
  workflow?: Workflow
  days?: number[]
  trend?: 'rising' | 'steady' | 'falling'
  /** the queue's order inside a project */
  rank?: number
  held?: { why: 'cap' | 'stale' | 'checks'; words: string; mover: string; act: string }
  /** parked: back at `until`, or at `soon` when more report it first (the prototype's later clock stands in for them) */
  later?: { until: number; trigger?: string; returned?: string; soon?: number }
  shipped?: { how: 'live' | 'merged' | 'reverted'; at: number; words: string; after?: string }
  /** a task working on it now */
  task?: string
  /** an issue draft already finished (a Watch and score project's): it posts on the next run, or on Resume when paused */
  draft?: boolean
  /** that draft, posted (on Resume here): the issue it became. Out of the queue: a Watch and score project starts no fix */
  posted?: string
  /** waits for the person: the Triage card that asks (its exact words are there), and what happens after Yes */
  needs?: { card: string; ask: string; after: string }
  /** what a Yes on its card did (this page's copy only) */
  approved?: boolean
  /** an error's numbers, from its source */
  events?: string
}

export interface RadarProject {
  id: string
  name: string
  repo: string | null
  folder: string
  machine: string
  /** none: not set up yet; watch: reads, posts nothing; score: scores too; fix: starts fixes within the cap */
  level: 'none' | 'watch' | 'score' | 'fix'
  paused?: number
  fixes?: { used: number; cap: number }
  next?: string
  sources: { name: string; ok: boolean; words: string }[]
}

export interface RadarDemo {
  /** when this device last opened Radar */
  looked: number
  projects: RadarProject[]
  items: RadarItem[]
  /** what the person answered on an item's card (the card's own Yes or No, kept by the demo's service) */
  answers?: Record<string, 'yes' | 'no'>
}

/** what the live snapshot says about the cards: which still ask, and what was answered */
export interface Live { cards: Set<string>; answers: Record<string, 'yes' | 'no'> }

/* ---------- this page's copy: every click changes it, a reload brings the day back ---------- */

/** the opening screens to compare: the calm timeline (the default), Since you last looked, Pain map, Project pulse */
export type Opening = 'timeline' | 'since' | 'pain' | 'pulse'
export type Tab = 'overview' | 'next' | 'all' | 'shipped'
export interface View {
  opening: Opening
  /** the prototype's clock: now, or a week later (parked ideas come back) */
  later: boolean
  tab: Tab
  project: string | null
  item: string | null
  /** the prototype's fixture: today's day, or a new install (only the project not set up, nothing found yet) */
  fresh: boolean
  /** All items' filter: open, what the row's grey count counts (new and next), parked, or Not doing */
  filter: Filter
  /** the prototype's controls shown: folded until opened, on every width */
  proto: boolean
}
export type Filter = 'open' | 'waiting' | 'later' | 'declined'

interface Store { day: RadarDemo | null; seed: RadarDemo | null; view: View; v: number }
const fresh = (): View => ({ opening: 'timeline', later: false, tab: 'overview', project: null, item: null, fresh: false, filter: 'open', proto: false })
const s: Store = { day: null, seed: null, view: fresh(), v: 0 }
const subs = new Set<() => void>()
const emit = () => { s.v++; subs.forEach((f) => f()) }
const sub = (f: () => void) => (subs.add(f), () => void subs.delete(f))

/** the day as this page has it: the snapshot's the first time, then this page's own copy */
export function dayOf(seed: RadarDemo | undefined): RadarDemo | null {
  if (!seed) return null
  if (s.seed !== seed && !s.day) { s.seed = seed; s.day = structuredClone(seed) }
  return s.day
}
/** the new install's projects: the ones not set up in the day as it came, fixed, so setting one up keeps it there */
export const freshIds = (d: RadarDemo) => new Set((s.seed ?? d).projects.filter((p) => p.level === 'none').map((p) => p.id))
/** the day the prototype shows: the whole day, or the new install's (the projects not set up, and what they found) */
export function shownDay(d: RadarDemo | null, v: Pick<View, 'fresh'>): RadarDemo | null {
  if (!d || !v.fresh) return d
  const none = freshIds(d)
  return { ...d, projects: d.projects.filter((p) => none.has(p.id)), items: d.items.filter((i) => none.has(i.project)) }
}
export function useRadar(): { day: RadarDemo | null; view: View } {
  useSyncExternalStore(sub, () => s.v, () => s.v)
  return { day: s.day, view: s.view }
}
export function setView(p: Partial<View>) { s.view = { ...s.view, ...p }; emit() }
/** the view as it is now, outside React (a form's button) */
export const getView = () => s.view
/** the shared cards this day's items ask on (Start over forgets their presses: the same card comes back) */
export const askCards = () => (s.seed?.items ?? []).flatMap((i) => (i.needs ? [i.needs.card] : []))
/** Resume: a paused project's finished drafts post (this page's copy): each leaves the queue as the issue it became */
export function resume(id: string): string[] {
  if (!s.day) return []
  const p = s.day.projects.find((x) => x.id === id)
  if (!p) return []
  const posted: string[] = []
  let n = 57
  s.day = {
    ...s.day,
    projects: s.day.projects.map((x) => (x.id === id ? { ...x, paused: undefined } : x)),
    items: s.day.items.map((i) => {
      if (i.project !== id || !i.draft || i.state !== 'next') return i
      const issue = `${p.repo}#${++n}`
      posted.push(issue)
      return { ...i, draft: undefined, posted: issue, reason: `Its finished draft posted as ${issue} when you resumed ${p.name}. Watch and score starts no fixes, so it stays an open issue.` }
    }),
  }
  emit()
  return posted
}
/** Start over: this page's copy back to the day as it came (the shared card comes back from the demo's service) */
export function reset() { s.day = s.seed ? structuredClone(s.seed) : null; s.view = { ...fresh(), opening: s.view.opening, fresh: s.view.fresh, proto: s.view.proto }; emit() }
/** change one item (or a project) in this page's copy */
export function edit(id: string, patch: Partial<RadarItem>) {
  if (!s.day) return
  s.day = { ...s.day, items: s.day.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }
  emit()
}
export function editProject(id: string, patch: Partial<RadarProject>) {
  if (!s.day) return
  s.day = { ...s.day, projects: s.day.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
  emit()
}
export function addItem(i: RadarItem) {
  if (!s.day) return
  s.day = { ...s.day, items: [i, ...s.day.items] }
  emit()
}

/* ---------- what each screen shows, by plain rules ---------- */

const DAY = 86400_000
/** the clock the prototype is at */
export const clock = (now: number, v: Pick<View, 'later'>) => now + (v.later ? 7 * DAY : 0)

/** an item as it is at this clock: a parked one whose date passed (or whose trigger came) is back, with why; one whose
 *  card was answered is approved (posted, a fix being built that you review and merge) or not done */
export function at(i: RadarItem, now: number, live?: Live): RadarItem {
  if (i.state === 'later' && i.later && (i.later.until <= now || (i.later.soon ?? Infinity) <= now)) return { ...i, state: 'new', reason: i.later.returned ?? 'Its parked time is up.', later: { ...i.later, returned: i.later.returned ?? 'Its parked time is up.' } }
  const a = i.needs && live && !live.cards.has(i.needs.card) ? live.answers[i.needs.card] : undefined
  if (a === 'yes') return { ...i, approved: true, state: 'running', task: i.task ?? 'Fix: ' + i.title }
  if (a === 'no') return { ...i, needs: undefined, state: 'declined', reason: 'You said no on its card.' }
  return i
}
export const itemsAt = (d: RadarDemo, now: number, live?: Live) => d.items.map((i) => at(i, now, live))

/** waits for the person now: its card still asks */
export const needsYou = (i: RadarItem, live: Live) => !!i.needs && !i.approved && live.cards.has(i.needs.card)

/** open items: what waits for work or for a decision. Parked, running, shipped and declined ones are out */
export const open = (i: RadarItem) => i.state === 'new' || i.state === 'next' || i.state === 'held'
/** what the grey count counts, and All items' "New or next up" shows: new and next, what could become work now. Held
 *  ones wait on something else, and a paused project's wait for Resume, so neither counts */
export const waiting = (i: RadarItem, d: RadarDemo) => (i.state === 'new' || i.state === 'next') && !i.posted && !d.projects.find((p) => p.id === i.project)?.paused
/** the count's own words: what it counts, named (the row's label, the filter's) */
export const waitingWords = (n: number) => `${n} new or next up`

/** the sidebar row: red when something needs the person (the same Needs you item), else the grey count of what waits
 *  (new and next); with neither, the name alone */
export function rowCount(d: RadarDemo | null, live: Live, now: number): { n: number; red: boolean } {
  if (!d) return { n: 0, red: false }
  const items = itemsAt(d, now, live)
  const red = items.filter((i) => needsYou(i, live)).length
  return red ? { n: red, red: true } : { n: items.filter((i) => waiting(i, d)).length, red: false }
}
