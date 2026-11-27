// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"). Red is Needs you: the one red
// count in the app, and a tap on it takes you to what needs you. One thing: its card, ready to answer. Two or more:
// Tasks, filtered to that scope's Needs you. The count is its own button beside the row (44px on a phone), never a
// button inside the row's button, so the row's name still opens the chat (Slack, Linear).
import type { Snapshot } from '@shared/types.ts'
import { needsFilter, needsWords, oneTarget, type NeedItem } from '@shared/needs-open.ts'
import { getState, go, openTask, setUI } from './kernel.ts'

/** open what needs you among these items: the one card, or the scope's Needs you list */
export function openNeeds(snap: Snapshot, items: NeedItem[], scope: { place?: string; machine?: string }) {
  const one = oneTarget(items)
  if (one) return openOne(one)
  listNeeds(snap, items, scope)
}

/** the one thing: a task's pane at its card, or the chat it waits in at its card */
function openOne(i: NeedItem) {
  if (getState().ui.at !== i.place) go(i.place)
  if (i.task) openTask(i.task)
  setUI({ drawer: false, jump: i.card, chatLink: null })
}

/** Tasks, filtered to the scope's Needs you (the filter shows as chips, each one tap to take off) */
export function listNeeds(snap: Snapshot, items: NeedItem[], scope: { place?: string; machine?: string }) {
  if (scope.place && getState().ui.at !== scope.place) go(scope.place)
  setUI({ tf: needsFilter(snap, items, scope), pane: 'tasks', task: null, art: null, artWide: false, tab: 'Now', drawer: false })
}

/** the red count: its own button, beside the row it counts for. Nothing when nothing needs you. */
export function NeedsCount({ n, onOpen, of }: { n: number; onOpen: () => void; of?: string }) {
  if (n <= 0) return null
  return (
    <button type="button" className="ncnt" aria-label={of ? `${of}: ${needsWords(n)}` : needsWords(n)} onClick={onOpen}>
      <span className="cnt needs">{n}</span>
    </button>
  )
}
