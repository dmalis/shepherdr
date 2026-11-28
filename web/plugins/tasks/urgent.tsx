// Urgent tasks in the app (dmalis/shepherdr#119, fork/specs/urgent-tasks.md slice 2): the person marks a task urgent,
// "this one first". Its mark is Linear's urgent shape, an exclamation mark in a filled square, in the text's own colour
// (never Needs you's red nor Working's amber: the shape and its word carry it). dmalis/shepherdr#415: the mark always
// carries its word, "Urgent", first in a row's second line as in an open task's header ("Urgent · Working"), so the
// title keeps its room; a screen reader hears "Urgent, <title>". A tap on it says what it means (marks.tsx). Its menu
// has Mark as urgent / Mark as not urgent (Gmail's "Mark as important" wording) on an open task, none on a Done or
// archived one; the palette lists the same row. The mark is set only once the task's machine confirms: the next
// snapshot moves its row. Nothing animates.
import { tryAct, type MenuRow } from '@client/kernel.ts'
import { I } from '@client/ui.tsx'
import type { Task } from '@shared/types.ts'
import { taskChat, tstate } from '@shared/view.ts'
import './urgent.css'

/** a row's title starts with "Urgent, " for a screen reader only (the app's .vh, web/src/dictate.css) */
export function UrgentMark({ t }: { t: Task }) {
  if (!t.urgent) return null
  return <span className="vh">Urgent, </span>
}

/** a row's second line starts with the icon and its word, "Urgent ·" before what follows (`more`); the screen reader
 *  already heard it before the title */
export function UrgentTag({ t, more }: { t: Task; more: boolean }) {
  if (!t.urgent) return null
  return <span className="urg" aria-hidden="true"><I n="urgent" />Urgent{more && <span className="usep">·</span>}</span>
}

/** an open task's header: "Urgent" first in its facts line, with the same icon */
export function UrgentWord({ t }: { t: Task }) {
  if (!t.urgent) return null
  return <span className="hurg"><I n="urgent" />Urgent<span className="hsep" aria-hidden="true">·</span></span>
}

/** the menu's row: Mark as urgent on an open task that isn't, Mark as not urgent on one that is, none once it's done */
export function urgentRows(t: Task): MenuRow[] {
  const s = tstate(t)
  if (s === 'done' || s === 'archived' || t.archived) return []
  const on = !t.urgent
  return [{ icon: 'urgent', label: on ? 'Mark as urgent' : 'Mark as not urgent', run: () => void tryAct({ type: 'task-urgent', chat: taskChat(t), on }, undefined, on ? 'Marking as urgent…' : 'Marking as not urgent…') }]
}
