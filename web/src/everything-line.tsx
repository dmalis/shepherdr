// What Everything is, in one plain line under its name in its chat's header (dmalis/shepherdr#49). Everything's agent
// is the home space's: it starts tasks in any repo or space and checks on the tasks in the spaces and machines it
// reaches, and passes on what changes another space's tasks to that space's own chat (templates/assistant.md, "Home
// space"). Its model follows while the header has room; a narrow header keeps the line alone while the message box
// below names the model, and the model alone when there is no box (View as terminal), never a cut line (ds.css).
import type { ComponentProps } from 'react'
import { PickSummary } from './picker.tsx'
import { cx } from './ui.tsx'

/** the line itself: what you can do from Everything, in everyday words, short enough to show uncut on a small phone */
export const EVERYTHING_LINE = 'Start or check work in any space'

/** Everything's second header line: the line, then its model. `box`: the message box shows (it names the model too) */
export function EverythingLine({ box, ...pick }: ComponentProps<typeof PickSummary> & { box: boolean }) {
  return (
    <>
      <span className="ev-line">{EVERYTHING_LINE}</span>
      <span className={cx('ev-pick', box && 'boxed')}>
        <PickSummary {...pick} />
      </span>
    </>
  )
}
