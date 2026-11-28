// The Tasks panel's filter (SHEP-331): every task everywhere by default; narrowed by groups of choices (Machine,
// Space, State, Repo), each a multi-select where nothing picked means all. Two quick
// choices beside them: "This space only" (follows the space you are in) and "Hide done". Kept on this device.
// fork UI 13 (dmalis/shepherdr#151, "Tasks: views for a day of many projects"): a view on top of it, one of All, Needs
// you, Working, Stopped, Done today and Urgent, for the day's questions; Repo is named Project and Space reads where a
// task was asked; a choice's count is for the view and the other groups' picks (a faceted count, as GitHub's and
// Linear's filters count).
import type { Snapshot, Task } from './types.ts'
import { needsChip, needsTask } from './needs-open.ts'
import { attentionOf } from './attention.ts'
import { isEverything, machineLabel, reposOf, spaceLabel, taskGroup, taskInSpace, tstate, workKey } from './view.ts'

/** the states the filter offers, in the order the person reads them */
export const STATES = ['needs', 'working', 'ready', 'next', 'scheduled', 'stopped', 'done', 'archived'] as const
export type FState = (typeof STATES)[number]
export const STATE_WORDS: Record<FState, string> = {
  needs: 'Needs you',
  working: 'Working',
  ready: 'Ready for review',
  next: 'Up next',
  scheduled: 'Scheduled',
  stopped: 'Stopped',
  done: 'Done',
  archived: 'Archived',
}

/** fork UI 13: the views above the list, each a question of the day. All is none picked. */
export const VIEWS = ['needs', 'working', 'stopped', 'today', 'urgent'] as const
export type View = (typeof VIEWS)[number]
export const VIEW_WORDS: Record<View | 'all', string> = { all: 'All', needs: 'Needs you', working: 'Working', stopped: 'Stopped', today: 'Done today', urgent: 'Urgent' }
/** the views the compact picker holds (All and Needs you have a button each) */
export const MORE_VIEWS = ['working', 'stopped', 'today', 'urgent'] as const satisfies readonly View[]

/** a group of choices: its key, its words, a task's value */
export type GroupKey = 'state' | 'machine' | 'space' | 'repo'
export interface TaskFilter {
  state: string[]
  machine: string[]
  space: string[]
  /** SHEP-325's repos and folders, by their key (machine and folder): the sheet's Project */
  repo: string[]
  /** only the space you are in (nothing in Everything) */
  here: boolean
  /** Done and Archived left out */
  hideDone: boolean
  /** only what the red count of these spaces counts (a tap on it, needs-open.ts) */
  needs?: string[]
  /** fork UI 13: the view picked above the list; none: All */
  view?: View
}
export const NO_FILTER: TaskFilter = { state: [], machine: [], space: [], repo: [], here: false, hideDone: false }

/** a filter kept from an older visit, or hand-edited: whatever is not a list or a flag counts as nothing picked */
export function clean(f: Partial<TaskFilter> | null | undefined): TaskFilter {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  // fork UI 13: State's old Needs you pick is the Needs you view now, which lists what the red count counts
  const old = list(f?.state).includes('needs') && !list(f?.needs).length
  const view = VIEWS.includes(f?.view as View) ? { view: f!.view } : old ? { view: 'needs' as const } : {}
  const state = old ? list(f?.state).filter((s) => s !== 'needs') : list(f?.state)
  return { state, machine: list(f?.machine), space: list(f?.space), repo: list(f?.repo), here: f?.here === true, hideDone: f?.hideDone === true, ...(list(f?.needs).length ? { needs: list(f?.needs) } : {}), ...view }
}

/** a task's state as the filter names it: Stopped apart from Needs you, Scheduled apart from Up next */
export function fstate(t: Task): FState {
  const s = tstate(t)
  if (s === 'ask') return t.stopped && t.stopped.by !== 'you' ? 'stopped' : 'needs'
  if (s === 'next') return t.status === 'scheduled' ? 'scheduled' : 'next'
  return s
}

/** the machine a task works on: its space's */
export const taskMachine = (snap: Snapshot, t: Task) => snap.places.find((p) => p.id === t.place)?.machine ?? t.on

/** fork UI 13: the space a task was asked in; the space it lives in for one made before that was kept */
export const askedIn = (t: Task) => t.asked || t.place

export interface Group {
  key: GroupKey
  name: string
  of: (snap: Snapshot, t: Task) => string
}
/** in the sheet's order: Project, then Space, then Machine and State */
export const GROUPS: Group[] = [
  { key: 'repo', name: 'Project', of: (_, t) => workKey(t) },
  { key: 'space', name: 'Space', of: (_, t) => askedIn(t) },
  { key: 'machine', name: 'Machine', of: taskMachine },
  { key: 'state', name: 'State', of: (_, t) => fstate(t) },
]

const doneLike = (t: Task) => ['done', 'archived'].includes(tstate(t))

/** "This space only" applies: it is on and you are in a space, not Everything */
export const hereOn = (snap: Snapshot, f: TaskFilter, at: string) => f.here && !!at && !isEverything(snap, at)

/** local midnight of the day `now` is in: Done today starts there (this device's clock, as Things' and Reminders'
 *  Today do) */
export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** the tasks with an open action of yours: the Needs you group's tasks, and a working one with a question of yours
 *  waiting (its question has a row there), as the red count counts them (web/shared/attention.ts) */
const yourTasks = (snap: Snapshot) => new Set(attentionOf(snap).actions.filter((a) => a.owner === 'you' && a.task).map((a) => a.task!))

/** does a task belong in a view. now: the clock Done today goes by. */
export function inView(t: Task, view: View | undefined, now: number, yours: Set<string>): boolean {
  if (!view) return true
  const s = tstate(t)
  if (view === 'needs') return yours.has(t.id)
  // the Working group's: Paused and a wait the space's Shepherdr handles are there too (taskGroup)
  if (view === 'working') return taskGroup(t) === 'working'
  // what is stuck: every open task whose agent stopped, by an error or by you, whoever acts next
  if (view === 'stopped') return s === 'ask' && !!t.stopped
  if (view === 'today') return s === 'done' && (t.doneAt ?? 0) >= startOfDay(now)
  return !!t.urgent && s !== 'done' && s !== 'archived'
}

/** the tasks the panel lists. skip: a group whose own picks are left out (its choices' counts) */
export function filterTasks(snap: Snapshot, f: TaskFilter, at: string, now = Date.now(), skip?: GroupKey): Task[] {
  const here = hereOn(snap, f, at)
  const yours = f.view === 'needs' ? yourTasks(snap) : new Set<string>()
  return snap.tasks.filter(
    (t) =>
      (!here || taskInSpace(t, at)) &&
      !(f.hideDone && doneLike(t)) &&
      (!f.needs?.length || needsTask(snap, t, f.needs)) &&
      inView(t, f.view, now, yours) &&
      GROUPS.every((g) => g.key === skip || !f[g.key].length || f[g.key].includes(g.of(snap, t))),
  )
}

/** the Tasks button's number: what needs you among the tasks the list shows */
export const filterCount = (snap: Snapshot, f: TaskFilter, at: string) => filterTasks(snap, f, at).filter((t) => ['ask', 'ready'].includes(tstate(t))).length

/** a filter is on: anything picked, or a quick choice that applies here (the view shows in its own row, not here) */
export const filterOn = (snap: Snapshot, f: TaskFilter, at: string) => hereOn(snap, f, at) || f.hideDone || !!f.needs?.length || GROUPS.some((g) => f[g.key].length > 0)

/** a view picked (none: All). A red count's filter takes it off: what a red count counts shows whatever view was
 *  kept. The sheet's picks stay. */
export const pickView = (f: TaskFilter, view: View | undefined): TaskFilter => {
  const { needs: _, view: __, ...rest } = f
  return view ? { ...rest, view } : rest
}

/** each view's count: the tasks it would list with the rest of the filter as it is (Needs you's count is the list's
 *  own, in the panel) */
export function viewCounts(snap: Snapshot, f: TaskFilter, at: string, now = Date.now()): Record<View, number> {
  const base = filterTasks(snap, pickView(f, undefined), at, now)
  const yours = yourTasks(snap)
  return Object.fromEntries(VIEWS.map((v) => [v, base.filter((t) => inView(t, v, now, yours)).length])) as Record<View, number>
}

/** the choices of a group, from the tasks there are (a choice picked before stays, so it can be taken off). Never a
 *  blank one: a task whose space was removed has no space (the service gives it ''), and it made a row with no name.
 *  fork UI 13: each counts the tasks the list would show with it picked and the group's other picks left out, in the
 *  view you're in; a choice with none there is left out, unless it is picked. at, now: where you are and the clock. */
export function choices(snap: Snapshot, key: GroupKey, f: TaskFilter, at = '', now = Date.now()): Choice[] {
  return allChoices(snap, key, f, at, now).filter((c) => c.id.trim() && c.label.trim())
}
export interface Choice {
  id: string
  label: string
  n: number
  /** the machine, when it tells this choice from another of the same name (a Project), or when there are several (a
   *  Space) */
  machine?: string
}
function allChoices(snap: Snapshot, key: GroupKey, f: TaskFilter, at: string, now: number): Choice[] {
  const g = GROUPS.find((x) => x.key === key)!
  const pool = filterTasks(snap, f, at, now, key)
  const count = new Map<string, number>()
  for (const t of pool) {
    const v = g.of(snap, t)
    count.set(v, (count.get(v) ?? 0) + 1)
  }
  const n = (id: string) => count.get(id) ?? 0
  const kept = (c: Choice) => c.n > 0 || f[key].includes(c.id)
  // fork UI 13: no Needs you here: the views row has it, the very items of the group and its red count (a waiting
  // task's state alone missed a review and a hand-up)
  if (key === 'state') return STATES.filter((s) => s !== 'needs' || f.state.includes(s)).map((s) => ({ id: s, label: STATE_WORDS[s], n: n(s) })).filter(kept)
  if (key === 'machine') {
    const ids = [...new Set([...snap.machines.map((m) => m.machine), ...snap.tasks.map((t) => taskMachine(snap, t)), ...f.machine])]
    return ids.map((id) => ({ id, label: machineLabel(snap, id), n: n(id) })).filter(kept)
  }
  if (key === 'repo') {
    const all = reposOf(snap)
    const names = new Map<string, number>()
    for (const r of all) names.set(r.name, (names.get(r.name) ?? 0) + 1)
    const repos = all.map((r) => ({ id: r.key, label: r.name, n: n(r.key), ...((names.get(r.name) ?? 0) > 1 ? { machine: machineLabel(snap, r.machine) } : {}) }))
    return [...repos, ...f.repo.filter((id) => !repos.some((r) => r.id === id)).map((id) => ({ id, label: id.replace(/^.*?:/, '').replace(/^.*\//, '') || id, n: 0 }))]
      .filter(kept)
  }
  // spaces: Everything first, then as the list orders them, each with its machine (two spaces may share a name)
  const ids = [...new Set([...snap.places.map((p) => p.id), ...snap.tasks.map(askedIn), ...f.space])]
  return ids
    .map((id) => ({ id, label: spaceLabel(snap, id) || id, n: n(id), machine: machineLabel(snap, snap.places.find((p) => p.id === id)?.machine ?? '') }))
    .filter(kept)
    .sort((a, b) => Number(isEverything(snap, b.id)) - Number(isEverything(snap, a.id)))
}

/** one choice turned on or off */
export function toggle(f: TaskFilter, key: GroupKey, id: string): TaskFilter {
  const on = f[key].includes(id)
  const next = { ...f, [key]: on ? f[key].filter((x) => x !== id) : [...f[key], id] }
  // picking Done or Archived shows them again
  if (!on && key === 'state' && (id === 'done' || id === 'archived')) next.hideDone = false
  return next
}

/** the chips under the header: each one a choice that is on, taken off by its ✕ */
export interface Chip {
  key: string
  label: string
  icon: 'hash' | 'folder' | 'layers' | 'server' | 'check' | 'ask' | 'working' | 'ready' | 'next' | 'clock' | 'archive'
  off: (f: TaskFilter) => TaskFilter
}
/** a state's chip carries its status mark */
const STATE_ICON: Record<FState, Chip['icon']> = { needs: 'ask', working: 'working', ready: 'ready', next: 'next', scheduled: 'clock', stopped: 'ask', done: 'check', archived: 'archive' }

/** a project's name, with its machine when another project has the same name */
function projectLabel(snap: Snapshot, id: string): string {
  const all = reposOf(snap)
  const r = all.find((x) => x.key === id)
  if (!r) return id.replace(/^.*\//, '') || id
  return all.filter((x) => x.name === r.name).length > 1 ? `${r.name} · ${machineLabel(snap, r.machine)}` : r.name
}

export function chipsOf(snap: Snapshot, f: TaskFilter, at: string): Chip[] {
  const out: Chip[] = []
  if (hereOn(snap, f, at)) out.push({ key: 'here', label: `${spaceLabel(snap, at)} only`, icon: 'hash', off: (x) => ({ ...x, here: false }) })
  if (f.needs?.length) out.push({ key: 'needs', label: needsChip(snap, f.needs), icon: 'ask', off: ({ needs: _, ...x }) => x })
  if (f.hideDone) out.push({ key: 'hideDone', label: 'Done hidden', icon: 'check', off: (x) => ({ ...x, hideDone: false }) })
  for (const id of f.repo) out.push({ key: `repo:${id}`, label: projectLabel(snap, id), icon: 'folder', off: (x) => toggle(x, 'repo', id) })
  for (const id of f.space.filter((x) => x.trim())) out.push({ key: `space:${id}`, label: (spaceLabel(snap, id) || id).replace(/^#/, ''), icon: isEverything(snap, id) ? 'layers' : 'hash', off: (x) => toggle(x, 'space', id) })
  for (const id of f.machine) out.push({ key: `machine:${id}`, label: machineLabel(snap, id), icon: 'server', off: (x) => toggle(x, 'machine', id) })
  for (const id of f.state) out.push({ key: `state:${id}`, label: STATE_WORDS[id as FState] ?? id, icon: STATE_ICON[id as FState] ?? 'check', off: (x) => toggle(x, 'state', id) })
  return out
}
