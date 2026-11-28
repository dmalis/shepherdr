// Report from a failed action (friction loop, slice 7, #94: fork/specs/friction-loop.md). An action the app asked for
// that failed shows its error in a notice (kernel.ts tryAct); with this plugin on, that notice has Report, as Sentry's
// crash-report dialog follows an error. Report opens the Feedback page's box, prefilled with safe words only: the
// action's own label from the fixed list below and "didn't work", never the error's text (it can hold paths, names or
// a project's words). Nothing is sent until the person presses Send; what they send is kept as a report from that
// action, and goes the way of every other report.
import { getState, notice } from '@client/kernel.ts'
import { closeAll } from '@client/overlay.tsx'
import type { ToastOpts } from '@client/toasts.ts'
import type { Snapshot } from '@shared/types.ts'
import { openFeedback, prefillBox } from './rows.tsx'
import { reportWaiting } from './words.ts'

type Act = { type: string } & Record<string, unknown>

/** what each action the app asks for is called, as its button or menu row says it. An action not on this list keeps
 *  its plain notice: Report only ever names an action by these words */
export const LABELS: Record<string, string> = {
  accept: 'Mark as done',
  'task-start': 'Start',
  send: 'Send',
  'held-now': 'Send now',
  stop: 'Stop',
  'stop-job': 'Stop',
  restart: 'Restart',
  'agent-restart': 'Restart',
  'assistant-close': 'End',
  // the task menu's Mark as done (it asks first, then closes the task)
  close: 'Mark as done',
  'follow-up': 'Start the follow-up',
  'task-urgent': 'Mark as urgent',
  'task-rename': 'Rename',
  'task-move': 'Move',
  rename: 'Rename',
  move: 'Move',
  order: 'Reorder',
  section: 'Change a group',
  archive: 'Archive',
  delete: 'Delete',
  'space-archive': 'Archive the space',
  'space-remove': 'Remove the space',
  answer: 'Answer',
  react: 'React',
  recap: 'Recap',
  screen: 'Screen',
  automation: 'Change a schedule',
  config: 'Save a setting',
  setting: 'Save a setting',
  secret: 'Save a secret',
  analytics: 'Analytics',
  'artifact-say': 'Send',
  'artifact-note': 'Send a note',
  'artifact-rename': 'Rename',
  'artifact-pin': 'Pin',
  'artifact-keep': 'Keep',
  'artifact-restore': 'Restore',
  'artifact-delete': 'Delete',
}

/** the action's label from the fixed list, by its type alone: nothing else the action carries is read */
export const labelOf = (a: Act): string | undefined => (Object.hasOwn(LABELS, a.type) ? LABELS[a.type] : undefined)

/** the box's words for it: the label and "didn't work", and nothing of the error */
export const prefillOf = (label: string) => `${label} didn't work`

/** the space it acted in: its own place (a space's rename or move names it as its id), its chat's, its task's; else the
 *  space on screen */
export function placeOf(a: Act, snap: Snapshot | null, at: string): string {
  const places = snap?.places ?? []
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  const byId = places.find((p) => p.id === str('place')) ?? places.find((p) => p.id === str('id'))
  if (byId) return byId.id
  const chat = str('chat')
  const byChat = chat && places.find((p) => p.chat === chat)
  if (byChat) return byChat.id
  const task = str('task') || (chat.includes('/') ? chat.slice(0, chat.lastIndexOf('/')) : '')
  const t = task && snap?.tasks.find((x) => x.id === task)
  if (t && places.some((p) => p.id === t.place)) return t.place
  return at
}

/** Report on a failed action's notice (kernel.ts registry.failAct): none for an action not on the list. Its space is
 *  the one it acted in as it failed, not wherever the person is when they tap Report */
export function reportAct(a: Act): ToastOpts['act'] | undefined {
  const label = labelOf(a)
  if (!label) return undefined
  const { snap, ui } = getState()
  const place = placeOf(a, snap, ui.at)
  return { label: 'Report', run: () => openReport(label, place) }
}

/** the Feedback page, its box holding the action's words, for the person to add to and send. A dialog still open over
 *  the page (a Start that failed keeps its own) closes first, so the box can take the keys */
export function openReport(label: string, place: string) {
  closeAll()
  const waiting = prefillBox(prefillOf(label), label, place)
  openFeedback()
  if (waiting) notice(reportWaiting(waiting))
}
