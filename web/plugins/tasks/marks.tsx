// A task row's status marks say what they mean (dmalis/shepherdr#415): a tap or a press held on its status ring or its
// urgent mark opens a small popover at the mark with its words, as iOS's and Linear's mobile apps explain an icon, never
// a hover tooltip (the app has none). A tap anywhere else on the row still opens the task, a press held there still
// opens its menu. In a row the keyboard and a screen reader already get the same words: the ring's aria-label and
// "Urgent, " are part of the row button's name, so there the popover is for a pointer. An open task's header ring is a
// button of its own (HeadRing), for the keyboard too.
import { openMenu } from '@client/overlay.tsx'
import { I } from '@client/ui.tsx'
import type { Task } from '@shared/types.ts'
import { ringOf } from '@shared/view.ts'
import type { MouseEvent, ReactNode } from 'react'
import { StatusIcon } from './icon.tsx'

/** the words of the urgent mark's popover */
export const URGENT_WORDS = { title: 'Urgent', what: 'Marked to do first' }

/** the marks a tap explains inside a task row: its status ring, its urgent mark */
export const MARKS = '.row.tk .tring, .row.tk .urg'
/** the mark a pointer is on inside a task row */
const markAt = (el: EventTarget | null): HTMLElement | null => (el as Element | null)?.closest?.<HTMLElement>(MARKS) ?? null

/** what a mark's popover says: its icon, its words, and a quiet line on what the urgent one means */
export function markWords(mark: HTMLElement, t: Task): { icon: ReactNode; title: string; what?: string } {
  if (mark.classList.contains('urg')) return { icon: <I n="urgent" />, title: URGENT_WORDS.title, what: URGENT_WORDS.what }
  // the ring's own spoken words, so the popover and a screen reader say the same
  return { icon: <StatusIcon t={t} time="none" />, title: mark.getAttribute('aria-label') || '' }
}

function explain(mark: HTMLElement, t: Task) {
  const w = markWords(mark, t)
  if (!w.title) return
  openMenu(
    mark,
    () => (
      <div className="fwhere mexp">
        <span className="mic" aria-hidden="true">{w.icon}</span>
        <span className="n">
          <span className="l1">{w.title}</span>
          {w.what && <span className="l2">{w.what}</span>}
        </span>
      </div>
    ),
    { label: w.title, float: true },
  )
}

/** a row's click: on a mark, its popover opens instead of the task (true); anywhere else, false */
export function explainClick(e: MouseEvent, t: Task): boolean {
  const mark = markAt(e.target)
  if (!mark || !e.currentTarget.contains(mark)) return false
  e.preventDefault()
  explain(mark, t)
  return true
}

/** An open task's header: its ring, a button of its own there (nothing around it opens anything), since the line beside
 *  it may be its agent's report, not its status. A tap, Enter or Space says its words; a screen reader hears them as
 *  its name, and focus comes back to it when the popover closes. */
export function HeadRing({ t }: { t: Task }) {
  const words = ringOf(t).label
  return (
    <button type="button" className="hring" aria-label={words} onClick={(e) => explain(e.currentTarget, t)}>
      <StatusIcon t={t} time="none" />
    </button>
  )
}

/** where the last press began: a press held on a mark explains it instead of opening the row's menu */
let pressed: EventTarget | null = null
if (typeof document !== 'undefined') document.addEventListener('pointerdown', (e) => void (pressed = e.target), true)

/** a press held on a row (`row`, the element useSlide gives): on a mark, its popover opens (true); anywhere else, false */
export function explainHold(row: HTMLElement, t: Task, at: EventTarget | null = pressed): boolean {
  const mark = markAt(at)
  if (!mark || !row.contains(mark)) return false
  explain(mark, t)
  return true
}
