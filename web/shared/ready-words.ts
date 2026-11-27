import type { Task } from './types.ts'
import { onBranch } from './view.ts'

/** What a Ready card asks, in plain words, and what its buttons do when pressed (dmalis/shepherdr#29): the decision
 *  first, then why it waits for the person (herdr-task's waits_why: its Merge setting and where that comes from), then
 *  the agent's own summary and proof below as evidence. Each button names its real effect. */
export interface ReadyWords {
  /** the decision, as a question */
  ask: string
  /** the main button: what pressing it does */
  go: string
  /** the main button while it runs */
  busy: string
  /** the other button: it stays here until you answer */
  later: string
}

export const LATER = 'Not now, keep it here'

export function readyWords(t: Task): ReadyWords {
  if (t.nothingToMerge && t.leftFiles?.length) return { ask: "It committed nothing, but left new files it didn't commit. Close it and delete them?", go: 'Close, delete its files', busy: 'Closing…', later: LATER }
  if (t.nothingToMerge) return { ask: "This task changed nothing, so there's nothing to merge. Close it?", go: 'Close, nothing changes', busy: 'Closing…', later: LATER }
  if (onBranch(t)) return { ask: t.base ? `Merge its changes into ${t.base}?` : 'Merge its changes?', go: t.base ? `Merge into ${t.base}` : 'Merge it', busy: 'Merging…', later: LATER }
  if (t.repo === 'folder') return { ask: 'Its changes are already in the folder. Mark it as done?', go: 'Mark as done', busy: 'Marking as done…', later: LATER }
  return { ask: 'It is finished. Mark it as done?', go: 'Mark as done', busy: 'Marking as done…', later: LATER }
}
