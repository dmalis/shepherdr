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
  later?: { until: number; trigger?: string; returned?: string }
  shipped?: { how: 'live' | 'merged' | 'reverted'; at: number; words: string; after?: string }
  /** a task working on it now */
  task?: string
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

export type Opening = 'since' | 'pain' | 'pulse'
export type Tab = 'overview' | 'next' | 'all' | 'shipped'
export interface View {
  opening: Opening
  /** the prototype's clock: now, or a week later (parked ideas come back) */
  later: boolean
  tab: Tab
  project: string | null
  item: string | null
}

interface Store { day: RadarDemo | null; seed: RadarDemo | null; view: View; v: number }
const fresh = (): View => ({ opening: 'since', later: false, tab: 'overview', project: null, item: null })
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
export function useRadar(): { day: RadarDemo | null; view: View } {
  useSyncExternalStore(sub, () => s.v, () => s.v)
  return { day: s.day, view: s.view }
}
export function setView(p: Partial<View>) { s.view = { ...s.view, ...p }; emit() }
export function reset() { s.day = s.seed ? structuredClone(s.seed) : null; s.view = { ...fresh(), opening: s.view.opening }; emit() }
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
 *  card was answered is approved (a fix being built, waiting for your merge) or not done */
export function at(i: RadarItem, now: number, live?: Live): RadarItem {
  if (i.state === 'later' && i.later && i.later.until <= now) return { ...i, state: 'new', reason: i.later.returned ?? 'Its parked time is up.', later: { ...i.later, returned: i.later.returned ?? 'Its parked time is up.' } }
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

/** the sidebar row: red when something needs the person (the same Needs you item), else the grey count of open
 *  items; with neither, the name alone */
export function rowCount(d: RadarDemo | null, live: Live, now: number): { n: number; red: boolean } {
  if (!d) return { n: 0, red: false }
  const items = itemsAt(d, now, live)
  const red = items.filter((i) => needsYou(i, live)).length
  return red ? { n: red, red: true } : { n: items.filter(open).length, red: false }
}

