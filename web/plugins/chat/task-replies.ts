// Suggested replies in a task's own chat (dmalis/shepherdr#42): bubbles only while the task really waits on the person
// (Needs you: its agent asks, or ended its turn on a question). A hand-in, or a task that works, merges or waits for
// its checks on its own, shows none, whatever its last message ended with. Any other chat keeps them as they are.
import type { Task } from '@shared/types.ts'
import { tstate } from '@shared/view.ts'

/** sg (suggestionOf's answer) for a chat, given the task it belongs to (its live record), if any */
export function taskReplies<T>(sg: T | null, task: Task | undefined): T | null {
  if (!sg || !task) return sg
  return tstate(task) === 'ask' ? sg : null
}
