// Needs you 4/6, exact links (dmalis/shepherdr, "Needs you: one happy path"; the design: fork/specs/needs-you.md). Every
// alert about an open action (a push, the app's own notice, the bell, the phone app's glance feed) carries that action's
// id, and a tap opens its exact card: `./?place=…&task=…&focus=<card>&action=<id>`. A tap after it closed opens the
// same task or chat and says what came of it ("Answered", "Task moved on"). A link without `action` (an older alert, an
// older client) opens what it always did.
import type { Snapshot } from './types.ts'
import { attentionOf, type Action } from './attention.ts'
import { CLOSED_WORDS } from './needs-words.ts'

/** the link's parameter that names the action */
export const ACTION_PARAM = 'action'

type LinkSnap = Pick<Snapshot, 'tasks'>

/** the link that opens an action's card where it waits: its task's space (else its own), its task, its card */
export function actionUrl(snap: LinkSnap, a: Pick<Action, 'id' | 'place' | 'task' | 'card'> & Partial<Pick<Action, 'need'>>): string {
  // a card's task the snapshot doesn't list (yet): the task its need names
  const task = a.task ?? a.need?.task
  const t = task ? snap.tasks?.find((x) => x.id === task) : undefined
  const q = new URLSearchParams({ place: t?.place ?? a.place })
  if (task) q.set('task', task)
  if (a.card) q.set('focus', a.card)
  q.set(ACTION_PARAM, a.id)
  return `./?${q}`
}

/** the action a link names, from its address (none: an older link) */
export function actionOfUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url, 'http://x/').searchParams.get(ACTION_PARAM)
  } catch {
    return null
  }
}

/** how an action closed: the person answered it (anywhere in Shepherdr), or it went on by itself */
export type OutcomeKind = 'answered' | 'moved'

/** an action that closed, as the service keeps it (service/alert-ledger.ts): what it was and how it ended */
export interface Outcome {
  id: string
  outcome: OutcomeKind
  /** when it closed (ms) */
  at: number
  what: string
  task?: string
  place?: string
  chat?: string
  card?: string | null
}

/** the words a late tap shows: "Answered · <what>", "Task moved on · <what>"; a space's own ask that went on by itself
 *  has no task to move on: "No longer waiting" */
export function outcomeWords(o: Pick<Outcome, 'outcome' | 'what' | 'task'>): string {
  const head = o.outcome === 'answered' ? CLOSED_WORDS.answered : o.task ? CLOSED_WORDS.moved : CLOSED_WORDS.over
  return o.what ? `${head} · ${o.what}` : head
}

/** what a link's action is now: still open (its live action, whose card may have moved), or not open */
export function openAction(snap: Parameters<typeof attentionOf>[0], id: string): Action | null {
  return attentionOf(snap).actions.find((a) => a.id === id) ?? null
}

/** may a link's action be judged closed from this snapshot: its task is listed (or it names none), and no machine is
 *  still connecting (a remote task that isn't read yet isn't gone) */
export function settled(snap: Pick<Snapshot, 'tasks' | 'machines'>, task: string | null): boolean {
  if ((snap.machines ?? []).some((m) => m.connecting)) return false
  return !task || (snap.tasks ?? []).some((t) => t.id === task)
}
