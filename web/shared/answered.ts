// dmalis/shepherdr#45: right after a task's prompt or question is answered (on a card, in its terminal pane, anywhere),
// its row and its header confirm it went through: what was chosen, then what the task does now ("Answered: Yes · back
// to work", "Answered: No · waits for your reply"). The service marks it (service/prompts.ts justAnswered); it stays a
// couple of minutes and never waits on the Assistant.
import type { Task } from './types.ts'

/** how long the row says so (the service's ANSWERED_SHOW_MS) */
export const ANSWERED_SHOW_MS = 2 * 60_000

/** A task's row words with its fresh answer in front; line: what the row says otherwise. A done task's line stays. */
export function answeredWords(t: Pick<Task, 'answered' | 'status' | 'archived'>, line: string, now = Date.now()): string {
  const a = t.answered
  if (!a || now - a.at > ANSWERED_SHOW_MS || t.archived || t.status === 'done') return line
  const then = t.status === 'work' ? 'back to work' : line ? line[0].toLowerCase() + line.slice(1) : ''
  return `Answered${a.choice ? `: ${a.choice}` : ''}${then ? ` · ${then}` : ''}`
}
