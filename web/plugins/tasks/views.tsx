// fork UI 13 (dmalis/shepherdr#151, "Tasks: views for a day of many projects"): one row above Tasks › Now for the day's
// questions. All, Needs you (the very items of the Needs you group and its red count) and a compact picker for Working,
// Stopped, Done today and Urgent. A segmented control, as iOS's and Linear's view switchers are: one is always picked,
// one tap goes back to All. The picker is the third segment: "More" until one of its views is picked, then that view's
// name and count; a tap opens a menu of them (a popover with a mouse, a sheet on a phone). The view is kept on this
// device with the rest of the filter (ui.tf); a red count's tap takes it off (needs-count.tsx), so what it counts shows.
import type { Snapshot } from '@shared/types.ts'
import { clean, filterTasks, MORE_VIEWS, pickView, VIEW_WORDS, viewCounts, type TaskFilter, type View } from '@shared/task-filter.ts'
import { moreActions } from '@shared/needs-open.ts'
import { nowGroups } from '@shared/view.ts'
import { taskAlerts } from '@shared/needs-you.ts'
import { needsAsks } from '@client/needs-count.tsx'
import { setUI, useUI } from '@client/kernel.ts'
import { openMenu } from '@client/overlay.tsx'
import { cx, I } from '@client/ui.tsx'
import './views.css'

/** how many things the Needs you view lists with the rest of the filter: the group's tasks, a working task's question
 *  of yours, and a space's own chat asking (each a row there), as the red count counts them */
export function needsRows(snap: Snapshot, f: TaskFilter, at: string): number {
  const fv = f.needs?.length ? f : pickView(f, 'needs')
  const tasks = filterTasks(snap, fv, at)
  const group = nowGroups(tasks, taskAlerts(snap))[0]!.tasks.length
  const queued = tasks.filter((t) => !t.archived).reduce((n, t) => n + moreActions(snap, t).length, 0)
  return group + queued + needsAsks(snap, fv, at).length
}

const setView = (v: View | undefined) => setUI((ui) => ({ tf: pickView(clean(ui.tf), v) }))

/** the picker's menu: its views, each with its count, the picked one ticked */
function ViewMenu({ close, counts, view }: { close: () => void; counts: Record<View, number>; view?: View }) {
  return (
    <div className="vmenu" role="group" aria-label="More views">
      <div className="cap">Show</div>
      {MORE_VIEWS.map((v) => (
        <button
          type="button"
          key={v}
          className="row"
          role="menuitemradio"
          aria-checked={view === v}
          onClick={() => {
            close()
            setView(v)
          }}
        >
          <span className="n">{VIEW_WORDS[v]}</span>
          <span className="v">{counts[v] || ''}</span>
          <span className="vck">{view === v && <I n="check" c="s16" />}</span>
        </button>
      ))}
    </div>
  )
}

export function Views({ snap }: { snap: Snapshot }) {
  const f = useUI((u) => u.tf)
  const at = useUI((u) => u.at)
  const view = f.view
  // the red count's filter is a Needs you view of its spaces (its chip says which)
  const needsOn = view === 'needs' || !!f.needs?.length
  const all = !view && !needsOn
  const more = view && view !== 'needs' ? view : undefined
  const counts = viewCounts(snap, f, at)
  const needs = needsRows(snap, f, at)
  return (
    <div className="vrow" role="group" aria-label="Views">
      <button type="button" aria-pressed={all} onClick={() => setView(undefined)}>All</button>
      <button type="button" aria-pressed={needsOn} onClick={() => setView('needs')}>
        Needs you{needs > 0 && <span className="cnt needs">{needs}</span>}
      </button>
      <button
        type="button"
        className={cx('vmore', more && 'on')}
        aria-haspopup="menu"
        data-marks=""
        onClick={(e) => openMenu(e.currentTarget, (close) => <ViewMenu close={close} counts={counts} view={more} />, { label: 'Views', within: e.currentTarget.closest('.pane') })}
      >
        {more ? (
          <>
            {VIEW_WORDS[more]}
            <span className="vh">, view picked;</span>
            {counts[more] > 0 && <span className="cnt">{counts[more]}</span>}
          </>
        ) : (
          <>
            More<span className="vh"> views</span>
          </>
        )}
        <I n="down" c="s16" />
      </button>
    </div>
  )
}
