// Needs you, one list (dmalis/shepherdr, "Needs you 5/6: one list"; the design: fork/specs/needs-you.md). Needs you
// means the person has a next action. This is the one rule that says which actions are open, whose each one is and
// where it leads: the space's count, Everything's, the Tasks icon, Tasks › Needs you, the app badge, the glance feed and
// which alerts may reach a device all read what it says, so they always agree. Reading or muting changes none of it:
// they change only what is delivered and kept in the bell.
//
// Each open action has one id that stays while it lasts, one owner and one card:
// - you (red, the only ones that count and notify): a prompt on an agent's own screen (a question card, a permission,
//   trust or sign-in prompt, a secret, a step for your hands), a task Ready for your review, a hand-up (herdr-task
//   alert --task, while it stands), a space's own Shepherdr asking or stopped, and a wait Shepherdr would handle in a
//   space where no Shepherdr is running;
// - Shepherdr (quiet, never counted, never notifies): a wait the space's Shepherdr handles first (a task went quiet
//   waiting for a reply, checks failed, a conflict, review rounds out, an error stop). It shows only on that task.
// A task stopped by the person (Paused), a working one and one waiting for its checks have no action at all.
// The source facts are the snapshot's own: no model, no guess (docs/develop.md Rules).
import type { HandUp, Need, Snapshot, Task, TriageCard } from './types.ts'
import { urgentWaitsFirst } from './urgent.ts'
import { GROUP_OVER } from './card-group.ts'
import { asksYou } from './plain-ask.ts'

export type Alert = NonNullable<Snapshot['alerts']>[number]

/** whose next action it is */
export type Owner = 'you' | 'shepherdr'

/** prompt: a card or wait of an agent's own; question: a question asked from a card while its chat carries on (its
 *  task stays Working); review: Ready for your review; alert: a hand-up; wait: a wait Shepherdr handles first (or, with
 *  no Shepherdr running, yours); chat: a space's own Shepherdr asking with no record of its own; triage: one of
 *  Triage's yes cards (fork #235) */
export type ActionKind = 'prompt' | 'question' | 'review' | 'alert' | 'wait' | 'chat' | 'triage'

export interface Action {
  /** stable while it lasts, and new for a new question: need:<chat>:<prompt id>, review:<task>:<since>,
   *  alert:<alert id>, wait:<wait id> (wait:<task>:<since> from a source that keeps no wait record), chat:<space>. Chats and tasks carry their machine, so the same task ref on
   *  two machines never merges */
  id: string
  owner: Owner
  kind: ActionKind
  /** what it is about, in a few words: the question, the task's reason */
  what: string
  /** since when it waits (ms): the list goes oldest first */
  since: number
  /** the space it counts in (a task's: the one that started it; its other spaces by the task's `also`) */
  place: string
  task?: string
  /** the chat its answer goes to */
  chat?: string
  /** the card a tap opens: its data-card as the app draws it (none: its task or chat) */
  card: string | null
  need?: Need
  alert?: Alert
  /** a wait's generation and when it is the person's if still open (ms), as herdr-task keeps them (fork "Needs you
   *  6a", web/shared/types.ts WaitRecord): a wait from a source that keeps none has neither */
  gen?: number
  deadline?: number
  /** a wait Shepherdr would handle that is yours, and why: no Shepherdr chat runs in its space; Shepherdr handed it up
   *  (herdr-task alert --task); its deadline passed with it still open (Ask me after) (fork "Needs you 6b") */
  up?: 'no-shepherdr' | 'asked' | 'deadline'
  /** fork "Needs you 6b": one question over several tasks: every task it holds (task is the first) */
  tasks?: string[]
  /** fork "Needs you 6b": the hand-up it is, its words and choices for its card */
  handUp?: HandUp
  /** fork #235: the Triage card it is */
  triage?: TriageCard
  /** fork #235: how many held drafts its one grouped card stands for (triageShown), and how many of them one Yes can
   *  post (the batch) */
  drafts?: number
  batch?: number
  /** fork "Shepherdr's asks in Needs you": a chat's ask read off its plain words (web/shared/plain-ask.ts): what is
   *  its question */
  plain?: true
  /** the name of the machine it is on while that machine can't be read: its last known row stays, saying so, and it
   *  sends no new alert until it is read again */
  stale?: string
}

/** what a task's own row, header and status say: its lead action (its oldest of yours that isn't a queued question,
 *  else Shepherdr's wait) */
export type TaskAction = Pick<Action, 'id' | 'owner' | 'kind' | 'what' | 'since'> & Partial<Pick<Action, 'up' | 'stale'>>

export interface Attention {
  /** when it was worked out (ms) */
  at: number
  /** every open action, oldest first (ties by id), each once; Shepherdr's own waits on urgent tasks ahead of the rest
   *  (inOrder) */
  actions: Action[]
}

/** an agent's own alert is a moment, as in the app (a toast, once): Needs you lists it this long, then lets it go;
 *  longer while its task still waits on you (#1561: a guard's approval code it is stuck on) */
export const ALERT_FRESH_MS = 15 * 60_000
/** a memory guard's alert is over once its machine's memory is back under this (herdr-task tick GUARD_BACK_UNDER) */
export const MEMORY_BACK_UNDER = 75

type AttentionSnap = Pick<Snapshot, 'places' | 'tasks' | 'needs'> & Partial<Pick<Snapshot, 'alerts' | 'machines' | 'attention' | 'everything' | 'host' | 'screens' | 'triage' | 'last'>>

/** the task a chat belongs to (a task's chats are <task id>/<agent>) */
const taskOfChat = (snap: Pick<Snapshot, 'tasks'>, chat?: string) =>
  chat?.includes('/') ? snap.tasks.find((t) => t.id === chat.slice(0, chat.lastIndexOf('/'))) : undefined
/** the task an alert is about: its own (service/push.ts agentAlerts), else its chat's */
const taskOfAlert = (snap: Pick<Snapshot, 'tasks'>, a: Alert) => (a.task ? snap.tasks.find((t) => t.id === a.task) : undefined) ?? taskOfChat(snap, a.chat)

/**
 * Is an agent's alert still something that waits: what reaches the person (notify), from a terminal still running (a
 * finished helper's is over), of a task not done, fresh, and for a memory alert, its machine still short of memory (its
 * last read; none: by age alone).
 */
export function alertStands(a: Alert | undefined | null, snap: Pick<AttentionSnap, 'tasks' | 'machines'>, now: number): boolean {
  if (!a?.notify || a.ended) return false
  // fork "Needs you 6b": a hand-up of waits is said by the waits themselves (their record keeps it), never twice
  if (a.waits?.length) return false
  const at = Number(a.at) || 0
  const task = taskOfAlert(snap, a)
  if (task && (task.archived || task.status === 'done')) return false
  // past its 15 minutes, it stands while its task still waits on you, a wait that began while it was fresh
  const waits = !!task && task.status === 'need' && !(task.needsAt && task.needsAt - at > ALERT_FRESH_MS)
  if (!(now - at < ALERT_FRESH_MS) && !waits) return false
  if (a.memory) {
    const m = (snap.machines ?? []).find((x) => (a.machine ? x.machine === a.machine && !x.here : x.here))
    const mem = (m?.stats?.health as { memory?: unknown } | undefined)?.memory
    if (typeof mem === 'number' && mem <= MEMORY_BACK_UNDER) return false
  }
  return true
}

/** each task's standing alert, its newest (#1561): its words show on its row, in it and in a toast */
export function taskAlerts(snap: Pick<AttentionSnap, 'tasks' | 'alerts' | 'machines'>, now = Date.now()): Map<string, Alert> {
  const out = new Map<string, Alert>()
  for (const a of snap.alerts ?? []) {
    const t = taskOfAlert(snap, a)
    if (!t || !alertStands(a, snap, now)) continue
    const had = out.get(t.id)
    if (!had || (Number(a.at) || 0) > (Number(had.at) || 0)) out.set(t.id, a)
  }
  return out
}

/** an alert's own words, without the "<task> · " its toast title starts with */
export const alertWhat = (a: Pick<Alert, 'title' | 'what'>) => a.what || a.title

/** the card a need draws: its question's or secret's, or the hands card; 'attention' has none */
export function needCard(n: Need): string | null {
  if (n.hands) return n.task ? `hands:${n.task}` : null
  return n.question?.id ?? n.secret?.id ?? (n.id && n.id !== 'attention' ? n.id : null)
}

/** a need's id as an action: the chat it waits in and its prompt's id (the push alert's key, service/push.ts needKey) */
export const needId = (n: Pick<Need, 'chat' | 'id'>) => `need:${n.chat}:${n.id}`

/** a need's words, short: its question, the secret it asks for, else why it waits */
const needWhat = (n: Need) => n.question?.title || (n.secret ? `Asks for ${n.secret.name}` : '') || n.text || 'Waits for you'

/** a task's wait as words: why it stopped, its own last line, else what it waits for */
function waitWhat(t: Task, n?: Need): string {
  if (t.stopped) return t.stopped.why || (t.stopped.by === 'limit' ? "It hit its plan's limit" : 'Its agent stopped')
  return t.report?.msg || n?.text || 'Waits for a reply'
}

/** the name of a machine that can't be read now (off, or still connecting): not this one */
function staleOf(snap: Pick<AttentionSnap, 'machines'>, machine: string | undefined): string | undefined {
  const m = machine ? (snap.machines ?? []).find((x) => x.machine === machine) : undefined
  return m && !m.here && m.status === 'off' ? m.name : undefined
}

/** no Shepherdr chat runs in this space for sure (stopped, or none started), read fresh from its machine. Not knowing
 *  (its machine out of reach, a space the snapshot doesn't list, one from before spaces said) keeps the wait Shepherdr's,
 *  quiet, as such waits were before this list. */
function noShepherdr(snap: AttentionSnap, place: string): boolean {
  const p = place ? snap.places.find((x) => x.id === place) : undefined
  if (!p || staleOf(snap, p.machine)) return false
  return p.shepherdr === 'stopped' || p.shepherdr === 'none'
}

/** fork Needs you 6b: how long a wait whose record hasn't landed yet stays quiet (a tick writes it within seconds) */
export const PENDING_MAX_MS = 2 * 60_000

export const byAge = (a: Action, b: Action) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** the one list's order: oldest first (ties by id), with Shepherdr's own waits on urgent tasks ahead of every other
 *  action, so Shepherdr takes those first (dmalis/shepherdr#119, fork/specs/urgent-tasks.md slice 3). Ids, owners and
 *  deadlines are as they were, and the person's actions keep their order among themselves: their counts, cards, badge
 *  and phone feed read only theirs (yours), so nothing they see moves. */
export const inOrder = (actions: Action[], tasks: Pick<Task, 'id' | 'urgent'>[]) => urgentWaitsFirst([...actions].sort(byAge), tasks)

/**
 * Every open action, from the snapshot's facts, at `now` (alerts age by it). Pure: the service works it out once per
 * snapshot (service/attention.ts) and ships it as `snapshot.attention`; anything holding a snapshot without it (the
 * demo, a test) gets the same answer here.
 */
export function projectAttention(snap: AttentionSnap, now = Date.now()): Attention {
  // a snapshot read by another tool can lack a list: none there
  snap = { ...snap, places: snap.places ?? [], tasks: snap.tasks ?? [] }
  const tasks = new Map<string, Task>(snap.tasks.map((t) => [t.id, t]))
  const open = (t: Task | undefined): t is Task => !!t && !t.archived && t.status !== 'done'
  const out = new Map<string, Action>()
  const add = (a: Action) => { if (!out.has(a.id)) out.set(a.id, a) }
  const theirs = new Set<string>() // tasks with an action of the person's that holds them (not a queued question)
  const needs = [...(snap.needs ?? [])].sort((a, b) => a.at - b.at)
  const inferred = new Map<string, Need>()
  // a step only the person's hands can do, on a task's screen (its browser or desktop): its card is that step's
  const hands = new Map<string, string>()
  for (const t of snap.tasks) { const h = snap.screens?.[`task:${t.id}`]?.hands; if (h && !h.settled && open(t)) hands.set(t.id, h.what) }
  // the need the service makes of that step (service/next.ts enrich), else its agent's plain wait: the same one action,
  // its alert kept
  const handsNeed = new Map<string, Need>()
  for (const n of needs) if (n.hands && n.task && hands.has(n.task) && !handsNeed.has(n.task)) handsNeed.set(n.task, n)
  for (const n of needs) if (n.id === 'attention' && !n.assistantFirst && n.task && hands.has(n.task) && !handsNeed.has(n.task)) handsNeed.set(n.task, n)
  for (const [id, what] of hands) {
    const t = tasks.get(id)!
    const stale = staleOf(snap, t.on)
    const n = handsNeed.get(id)
    add({ id: `hands:${id}`, owner: 'you', kind: 'prompt', what, since: t.needsAt ?? t.at ?? 0, place: t.place, task: id, chat: t.agent?.chat ?? `${id}/worker`, card: `hands:${id}`, ...(n ? { need: n } : {}), ...(stale ? { stale } : {}) })
    theirs.add(id)
  }

  // a prompt on an agent's own screen, a secret, a step for your hands, a question asked from a card: the person's
  for (const n of needs) {
    const t = n.task ? tasks.get(n.task) : undefined
    // its task done or archived: over (one the snapshot doesn't list still waits, as its source says)
    if (t && !open(t)) continue
    if (n.assistantFirst) { if (t && !inferred.has(t.id)) inferred.set(t.id, n); continue }
    // its agent waiting with no card of its own, or the need made of the step, while its screen asks for the person's
    // hands: that one wait, once
    if ((n.id === 'attention' || n.hands) && t && hands.has(t.id)) continue
    const queued = !!n.question?.queued
    const place = t?.place ?? n.place
    add({ id: needId(n), owner: 'you', kind: queued ? 'question' : 'prompt', what: needWhat(n), since: n.at, place, ...(t ? { task: t.id } : {}), chat: n.chat,
      card: needCard(n), need: n, ...((s) => (s ? { stale: s } : {}))(staleOf(snap, t?.on ?? snap.places.find((p) => p.id === place)?.machine)) })
    if (t && !queued) theirs.add(t.id)
  }
  // a space's own Shepherdr asking, with no record of its own (its card read off its screen)
  const asking = new Set(needs.filter((n) => !n.task && !n.question?.queued).map((n) => n.chat))
  for (const p of snap.places) {
    if (asking.has(p.chat)) continue
    // fork "Shepherdr's asks in Needs you": or it ended its turn asking in plain words, its question unanswered
    const plain = p.needs ? null : asksYou(p, snap.last)
    if (p.needs || plain)
      add({ id: `chat:${p.id}`, owner: 'you', kind: 'chat', what: plain?.what ?? 'Waits for you', since: 0, place: p.id, chat: p.chat, card: null, ...(plain ? { plain: true } : {}), ...((s) => (s ? { stale: s } : {}))(staleOf(snap, p.machine)) })
  }
  for (const t of snap.tasks) {
    if (!open(t)) continue
    const stale = staleOf(snap, t.on)
    // Ready for your review: its merge waits on your yes (one its Merge setting merges by itself shows Working)
    if (t.status === 'ready' && !t.accepting) {
      add({ id: `review:${t.id}:${t.needsAt ?? 0}`, owner: 'you', kind: 'review', what: 'Ready for review', since: t.needsAt ?? t.at ?? 0, place: t.place, task: t.id, chat: t.agent?.chat ?? `${t.id}/worker`, card: `review:${t.id}`, ...(stale ? { stale } : {}) })
      theirs.add(t.id)
    }
  }
  // a hand-up: an agent's own alert about a task, while it stands
  for (const [id, a] of taskAlerts(snap, now)) {
    const t = tasks.get(id)
    if (!open(t)) continue
    const stale = staleOf(snap, t.on)
    add({ id: `alert:${a.id}`, owner: 'you', kind: 'alert', what: alertWhat(a), since: Number(a.at) || 0, place: t.place, task: t.id, ...(a.chat ? { chat: a.chat } : {}), card: `alert:${a.id}`, alert: a, ...(stale ? { stale } : {}) })
    theirs.add(t.id)
  }
  // a task under Needs you by its status with nothing of the person's holding it. Paused (stopped by the person) is no
  // one's. A wait Shepherdr handles first (herdr-task says so: needs kinds attention, reply, stopped; or its agent
  // stopped on an error or a limit) is Shepherdr's; with no Shepherdr running in its space, it is the person's at once.
  // One that says nothing of whose it is stays the person's, as before this list: nothing that may need them is hidden.
  for (const t of snap.tasks) {
    if (!open(t) || t.status !== 'need' || theirs.has(t.id) || t.stopped?.by === 'you') continue
    const n = inferred.get(t.id)
    // fork "Needs you 6a": the wait as herdr-task keeps it where it happens (its id, first seen and deadline: a new
    // question is a new one, a restart keeps them); a source that keeps none yet, keyed by the task's own facts
    const rec = t.wait
    const since = rec?.first ?? t.needsAt ?? n?.at ?? t.at ?? 0
    const stale = staleOf(snap, t.on)
    const shepherds = !!n || !!t.stopped
    // fork "Needs you 6b": it is the person's at once when Shepherdr handed it up (its record keeps the hand-up, until
    // taken back), when no Shepherdr chat runs in its space, or once its deadline passed with it still open (Ask me
    // after: fixed when it was first confirmed; a reply, a held send or a busy Shepherdr never moves it). Its source
    // keeps records and this one's hasn't landed yet (at most a tick): quiet until it has, so the person is told once,
    // under the id that lasts. A machine that can't be read hands up nothing (its last read stands: service/attention.ts)
    const ask = rec?.up && !rec.up.settled ? rec.up : undefined
    const due = !!rec && !rec.up?.settled && now >= rec.deadline
    // a record that never lands (its scheduler stopped) holds it quiet a moment only: then it is the person's, as one
    // whose deadline passed (the service wakes for that moment too)
    // counted from when the service first saw it so (service/attention.ts stamps it), never from the task's own older
    // times: a wait seen a moment before its record lands is always quiet, then told once under the id that lasts
    const late = !rec && t.waitPending ? (typeof t.waitPending === 'number' ? t.waitPending : now) + PENDING_MAX_MS : undefined
    const pending = late !== undefined && now < late
    const up: Action['up'] = !shepherds || stale || pending ? undefined
      : ask ? 'asked' : noShepherdr(snap, t.place) ? 'no-shepherdr' : due || late !== undefined ? 'deadline' : undefined
    // one question over several tasks is one action (its lead wait's id), holding each of them
    const id = ask ? `wait:${ask.lead}` : rec ? `wait:${rec.id}` : `wait:${t.id}:${since}`
    const had = out.get(id)
    if (had) { had.tasks = [...(had.tasks ?? [had.task!]), t.id]; continue }
    add({ id, owner: !shepherds || up ? 'you' : 'shepherdr', kind: 'wait', what: ask?.what || waitWhat(t, n), since, place: t.place, task: t.id, chat: t.agent?.chat ?? `${t.id}/worker`,
      card: ask ? `handup:${ask.lead}` : t.stopped ? `stopped:${t.id}` : null, ...(n ? { need: n } : {}),
      ...(rec ? { gen: rec.gen, ...(rec.up?.settled ? {} : { deadline: rec.deadline }) } : late !== undefined ? { deadline: late } : {}), ...(up ? { up } : {}), ...(ask ? { handUp: ask } : {}), ...(stale ? { stale } : {}) })
  }
  // fork #235: Triage's yes cards (a held draft to post, an outside issue to start), each the person's, in its repo's
  // space's chat (Everything's when that space isn't here); its hash in the id, so a changed text is a new question.
  // More drafts than TRIAGE_GROUP_OVER in one space are one action, as their one card (triageShown)
  const byPlace = new Map<string, TriageCard[]>()
  for (const c of snap.triage?.cards ?? []) {
    const place = triagePlace(snap, c)
    if (place && snap.places.some((x) => x.id === place)) byPlace.set(place, [...(byPlace.get(place) ?? []), c])
  }
  for (const [place, cards] of byPlace) {
    const p = snap.places.find((x) => x.id === place)!
    const { drafts, single } = triageShown(cards)
    const n = triageCount(drafts), batch = triageCount(drafts.filter((c) => c.kind === 'batch'))
    if (n)
      add({ id: `${TRIAGE_DRAFTS}:${p.id}`, owner: 'you', kind: 'triage', what: triageDraftsWords(n), since: Math.min(...drafts.map((c) => c.at)), place: p.id, chat: p.chat, card: TRIAGE_DRAFTS, drafts: n, ...(batch ? { batch } : {}) })
    for (const c of single) add({ id: `triage:${c.id}:${c.hash.slice(0, 12)}`, owner: 'you', kind: 'triage', what: triageAsk(c), since: c.at, place: p.id, chat: p.chat, card: `triage:${c.id}`, triage: c })
  }
  return { at: now, actions: inOrder([...out.values()], snap.tasks) }
}

/** more held drafts than this in one space show as one card that opens their list, as GitHub and Slack group a run of
 *  notifications into one; start cards (an outside issue to fix) always stay single */
export const TRIAGE_GROUP_OVER = GROUP_OVER
/** the one card of a space's grouped drafts: its data-card (and its action's id, with the space after it) */
export const TRIAGE_DRAFTS = 'triage:drafts'
/** one space's Triage cards as they show: its drafts grouped (none: each single), the rest single, oldest first. The
 *  batch (the drafts one Yes can post) has no card of its own: it is always in the group, with the held drafts */
export function triageShown<C extends Pick<TriageCard, 'kind'>>(cards: C[]): { drafts: C[]; single: C[] } {
  const drafts = cards.filter((c) => c.kind === 'draft' || c.kind === 'batch')
  const group = drafts.some((c) => c.kind === 'batch') || drafts.length > TRIAGE_GROUP_OVER
  return group ? { drafts, single: cards.filter((c) => c.kind !== 'draft' && c.kind !== 'batch') } : { drafts: [], single: cards }
}
/** how many findings grouped cards stand for: a batch counts each draft it holds */
export const triageCount = (cards: Pick<TriageCard, 'kind' | 'items'>[]) => cards.reduce((n, c) => n + (c.kind === 'batch' ? c.items?.length ?? 0 : 1), 0)
export const triageDraftsWords = (n: number) => (n === 1 ? '1 finding waits to be posted to GitHub' : `${n} findings wait to be posted to GitHub`)

/** a Triage card's question, in a few words */
export const triageAsk = (c: TriageCard) => (c.kind === 'start' ? 'Start a fix for this?' : 'Post this to GitHub?')

/** the space a Triage card shows in: its repo's (where its schedule runs), else Everything */
export function triagePlace(snap: AttentionSnap, c: Pick<TriageCard, 'repo'>): string | undefined {
  const r = Object.values(snap.triage?.repos ?? {}).find((x) => x.repo && x.repo.toLowerCase() === c.repo.toLowerCase() && x.schedule?.space)
  const sp = r?.schedule?.space
  return (sp && snap.places.some((p) => p.id === sp) ? sp : undefined) ?? everythingId(snap)
}

/** Everything's id, as web/shared/view.ts everything() finds it: the root space, else the serving machine's home */
const everythingId = (snap: AttentionSnap) => (snap.places.find((p) => p.id === snap.everything) ?? snap.places.find((p) => p.home && p.machine === snap.host))?.id

/** the snapshot's own projection (the service's), else worked out here from the same facts */
export function attentionOf(snap: AttentionSnap, now?: number): Attention {
  return snap.attention ?? projectAttention(snap, now)
}

/** the open actions in a space (a task's by its space and the other spaces whose Tasks hold it; a chat's by its
 *  space), or everywhere (none, or Everything) */
export function inScope(snap: AttentionSnap, a: Action, placeId?: string): boolean {
  if (!placeId || everythingId(snap) === placeId) return true
  if (a.task) {
    // fork "Needs you 6b": one question over several tasks is in each of their spaces (and counts once in each)
    return (a.tasks ?? [a.task]).some((id) => { const t = snap.tasks.find((x) => x.id === id); return !!t && (t.place === placeId || !!t.also?.includes(placeId)) })
  }
  return a.place === placeId
}

/** the actions that are yours in a space (none: everywhere): what every red count counts, each once, oldest first.
 *  One question over several tasks (fork Needs you 6b) is one entry a task it holds (each its own row under Needs you,
 *  so the list is what the count says), still one action and one alert (service/push.ts reads the actions). */
export function yours(snap: AttentionSnap, placeId?: string, now?: number): Action[] {
  const out: Action[] = []
  for (const a of attentionOf(snap, now).actions) {
    if (a.owner !== 'you') continue
    // each held task's own entry: its own row, key and link; the need (its push and Glance key) stays the lead's alone
    for (const one of a.tasks?.length ? a.tasks.map((t): Action => (t === a.task ? a : { ...a, task: t, need: undefined })) : [a])
      if (inScope(snap, { ...one, tasks: undefined }, placeId)) out.push(one)
  }
  return out
}

/** does this action hold this task: its own, or one question over several tasks that includes it (fork Needs you 6b) */
export const holds = (a: Pick<Action, 'task' | 'tasks'>, task: string) => a.task === task || !!a.tasks?.includes(task)

/** a task's lead action (what its row and header say): its oldest of yours that holds it, else Shepherdr's wait */
export function leadOf(att: Attention, task: string): Action | undefined {
  const mine = att.actions.filter((a) => holds(a, task) && a.kind !== 'question')
  return mine.find((a) => a.owner === 'you') ?? mine[0]
}

/** the snapshot with its projection, and each task with its lead action (`task.action`): the service's snapshot as it
 *  is sent, and the demo's */
export function withAttention<S extends AttentionSnap>(snap: S, now = Date.now()): S & { attention: Attention } {
  return withActions(snap, projectAttention({ ...snap, attention: undefined }, now))
}

/** the snapshot with these actions, each task with its lead one (the service adds a machine's kept ones first) */
export function withActions<S extends AttentionSnap>(snap: S, attention: Attention): S & { attention: Attention } {
  const tasks = snap.tasks.map((t) => {
    const a = leadOf(attention, t.id)
    const { action: _old, ...rest } = t
    if (!a) return rest as Task
    const action: TaskAction = { id: a.id, owner: a.owner, kind: a.kind, what: a.what, since: a.since, ...(a.up ? { up: a.up } : {}), ...(a.stale ? { stale: a.stale } : {}) }
    return { ...rest, action } as Task
  })
  return { ...snap, tasks, attention }
}
