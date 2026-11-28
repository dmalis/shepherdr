// Needs you, one rule for every view (SHEP-250): the web app's Tasks panel and its counts and badges, and the glance feed
// (the phone's widgets, lock screen card and watch) all list what this says, in this order. Before, the Tasks panel listed
// only tasks whose status was Needs you while the feed also listed an Assistant's unread message and a working task's
// alert, so one screen said "2 need you" over a panel with no Needs you at all.
//
// fork Needs you 5/6: what waits on you is the person's open actions (web/shared/attention.ts), each once: a card or
// wait of an agent's own, a task Ready for review, a hand-up (an agent's alert about a task, while it stands), a space's
// own Shepherdr asking, and a wait Shepherdr would handle where no Shepherdr is running. A wait Shepherdr handles first
// is none of them. An Assistant's new message (SHEP-253; unreadChats lists those for a Chat badge, the glance feed's
// `unread`), a helper's alert that is no task's, a machine's memory alert, a schedule that failed: none of them are
// rows, counts or badges here. Each leaves at the same moment everywhere: answered (its need goes), its alert over (its
// agent ended, its task done, 15 minutes old while its task does not wait on you, or its machine's memory back).
import { notifyOf } from './alerts.ts'
import { ALERT_FRESH_MS, MEMORY_BACK_UNDER, alertStands, alertWhat, attentionOf, needCard, taskAlerts, yours, type Action, type Alert } from './attention.ts'
import type { Need, Place, Snapshot } from './types.ts'

export { ALERT_FRESH_MS, MEMORY_BACK_UNDER, alertStands, alertWhat, needCard, taskAlerts, type Alert }

export type Waiting = {
  /** stable while it lasts, the glance feed's item key: need:<chat>:<id>, task:<id>, alert:<id> */
  key: string
  type: 'need' | 'task' | 'alert'
  /** since when it waits (ms): the list goes oldest first */
  at: number
  /** the space it belongs to */
  place?: string
  /** the task it is about: that task shows in Needs you, nowhere else; none: a space's own Shepherdr asking */
  task?: string
  need?: Need
  alert?: Alert
  /** the open action it is (web/shared/attention.ts) */
  action: Action
}

export type NeedsSnap = Pick<Snapshot, 'places' | 'tasks' | 'needs'> & Partial<Pick<Snapshot, 'alerts' | 'last' | 'read' | 'settings' | 'machines' | 'config' | 'attention' | 'everything'>>

/**
 * Who a task's wait is for first, by its kind (herdr-task's needs: attention, reply, stopped, asks): only a prompt on
 * its agent's own screen (a question card, a permission, trust or sign-in) is the person's at once; every inferred wait
 * (a question in chat, checks, a conflict, rounds out, an error stop) goes to its space's Assistant first. One rule for
 * the service's needs (assistantFirst, service/compat.ts) and the chat's news rows (dmalis/shepherdr#114).
 */
export const forAssistant = (needs: string | null | undefined) => needs !== 'asks'

/**
 * Does this task wait on the person right now: an open action of theirs holds it (a card or prompt of its own, its
 * review, a hand-up, or a wait with no Shepherdr running). A wait Shepherdr handles is not (dmalis/shepherdr#114).
 */
export function waitsOnPerson(snap: NeedsSnap, task: string, now = Date.now()): boolean {
  return attentionOf(snap, now).actions.some((a) => a.owner === 'you' && a.task === task && a.kind !== 'question')
}

/** has the chat something you haven't read ('*': since when read marks are kept, anything older counts as read) */
export function unread(snap: Pick<Snapshot, 'last' | 'read'>, key: string | undefined): boolean {
  const last = key ? snap.last?.[key] : undefined
  if (!key || !last) return false
  return last > Math.max(snap.read?.[key] ?? 0, snap.read?.['*'] ?? 0)
}

/** an action as the glance feed lists it: its old key (need:, task:, alert:), kept so a native app's items stay put */
function waitingOf(a: Action): Waiting {
  const base = { at: a.since, place: a.place, ...(a.task ? { task: a.task } : {}), action: a }
  if (a.alert) return { ...base, key: `alert:${a.alert.id}`, type: 'alert', alert: a.alert }
  if (a.need) return { ...base, key: `need:${a.need.chat}:${a.need.id}`, type: 'need', need: a.need }
  return { ...base, key: a.task ? `task:${a.task}` : a.id, type: a.task ? 'task' : 'need' }
}

/**
 * What waits on you, oldest first (ties by key), each action once: every open action of yours but a review (the glance
 * feed lists those as Ready). now: the clock alerts age by.
 */
export function needsYou(snap: NeedsSnap, now = Date.now()): Waiting[] {
  return yours(snap, undefined, now).filter((a) => a.kind !== 'review').map(waitingOf)
}

/** the Assistants' chats with a new message you haven't read (their space not muted, no card of their own waiting):
 *  Chat's, never Needs you's (SHEP-253) */
export function unreadChats(snap: NeedsSnap): { chat: string; place: string; at: number }[] {
  const asking = new Set(snap.needs.map((n) => n.chat))
  const out: { chat: string; place: string; at: number }[] = []
  for (const p of snap.places as Place[]) {
    if (!p.chat || !unread(snap, p.chat) || asking.has(p.chat)) continue
    if (snap.settings && notifyOf({ settings: snap.settings, config: snap.config }, p.id) === 'Off') continue
    out.push({ chat: p.chat, place: p.id, at: snap.last![p.chat] })
  }
  return out
}

/** the tasks in Needs you (they show there, in no other group) */
export const waitingTasks = (ws: Waiting[]) => new Set(ws.filter((w) => w.task && w.action.kind !== 'question').map((w) => w.task!))
