// A task's status marks say what they mean (dmalis/shepherdr#415): a tap or a press held on a row's status ring or its
// urgent mark opens a small popover at the mark with its words, as iOS's and Linear's mobile apps explain an icon, never
// a hover tooltip (the app has none). A tap anywhere else on the row still opens the task, a press held there still
// opens its menu. In a row the keyboard and a screen reader already get the same words: the ring's aria-label and
// "Urgent, " are part of the row button's name, so there the popover is for a pointer. An open task's header ring is a
// button of its own (HeadRing), for the keyboard too. The popover is a menu's quiet top line alone (overlay.tsx's cap):
// no code of its own in the first screen's script, which is at its budget (docs/design.md, Performance).
import { openMenu } from '@client/overlay.tsx'
import type { Task } from '@shared/types.ts'
import { ringOf } from '@shared/view.ts'
import { StatusIcon } from './icon.tsx'

/** the marks a tap explains inside a task row: its status ring, its urgent mark */
export const MARKS = '.row.tk .tring, .row.tk .urg'
/** what the urgent mark says */
export const URGENT_SAYS = 'Urgent: marked to do first'

/** its words in a small popover at it, the ring's its spoken name (the same mark again closes it) */
function explain(mark: HTMLElement) {
  const words = mark.matches('.urg') ? URGENT_SAYS : mark.getAttribute('aria-label')
  if (words) openMenu(mark, [], { cap: words, label: words, float: true })
}

/** a row's tap (`at`: where it landed) or press held (`at`: where it began): on one of its marks, that mark's popover
 *  opens (true); anywhere else, false */
export function explainAt(at: EventTarget | null, row: Element): boolean {
  const mark = (at as Element | null)?.closest?.<HTMLElement>(MARKS)
  if (!mark || !row.contains(mark)) return false
  explain(mark)
  return true
}

/** where the last press began: a press held on a mark explains it instead of opening the row's menu */
let pressed: EventTarget | null = null
if (typeof document !== 'undefined') document.addEventListener('pointerdown', (e) => void (pressed = e.target), true)
export const explainHeld = (row: Element) => explainAt(pressed, row)

/** An open task's header: its ring, a button of its own there (nothing around it opens anything), since the line beside
 *  it may be its agent's report, not its status. A tap, Enter or Space says its words; a screen reader hears them as
 *  its name, and focus comes back to it when the popover closes. */
export function HeadRing({ t }: { t: Task }) {
  return (
    <button type="button" className="hring" aria-label={ringOf(t).label} onClick={(e) => explain(e.currentTarget)}>
      <StatusIcon t={t} time="none" />
    </button>
  )
}
