// A merged task's commits after its merge (dmalis/shepherdr#48): the words its row, header and pane card say. Its
// change merged, so it stays Done; what its agent committed since is offered as a follow-up task, said once ("1 change
// after the merge"), the way GitHub offers a branch's recent pushes ("had recent pushes · Compare & pull request").
// Main already holding the same change: "Already on main", and nothing offered.
import type { AfterMerge, Task } from './types.ts'

export const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`

/** what its row and header add after "Done and merged": the count while it's offered, the follow-up once started,
 *  nothing when main already has it (nothing to do there) */
export function afterMergeNote(a: AfterMerge | undefined): string {
  if (!a || a.onMain) return ''
  return a.followUp ? 'follow-up started' : `${changes(a.count)} after the merge`
}

/** the pane card's headline and the line under it */
export function afterMergeCard(a: AfterMerge): { head: string; line: string } {
  if (a.followUp) return { head: 'Follow-up started', line: `"${a.followUp.title}" carries ${a.count === 1 ? 'the change' : `the ${changes(a.count)}`} made after the merge.` }
  if (a.onMain) return { head: 'Already on main', line: `Main has the same ${a.count === 1 ? 'change' : 'changes'} made after the merge, so there's nothing to carry over.` }
  return {
    head: `${changes(a.count)} after the merge`,
    line: `${a.count === 1 ? "This commit isn't" : "These commits aren't"} on main. A follow-up task starts from main with ${a.count === 1 ? 'it' : 'them'} on top.`,
  }
}

/** the commit subjects the card lists, and how many more there are */
export function afterMergeList(a: AfterMerge, most = 5): { shown: string[]; more: number } {
  const shown = a.commits.slice(-most)
  return { shown, more: Math.max(0, a.count - shown.length) }
}

/** a card shows for a Done task with something after its merge */
export const offersAfterMerge = (t: Task) => t.status === 'done' && !!t.afterMerge && t.afterMerge.count > 0
