// Where a task works, in sight (dmalis/shepherdr#100): an open task's header has a small line over its title with its
// project (its machine too when there are several), as GitHub's "owner/repo" over an issue's title and Linear's
// breadcrumb; a row in the list puts its repo line first (where.css). A row's model line shows only when the task runs
// on something else than its setting, so the usual case says nothing and the exception stands out.
import { I } from '@client/ui.tsx'
import { samePick, type Pick } from '@client/picker.tsx'
import type { Catalog, Snapshot, Task } from '@shared/types.ts'
import { machineLabel, workName } from '@shared/view.ts'
import './where.css'

/** the words over a task's title: its project and its machine when there are several; a task outside a repo or folder
 *  says its machine */
export function whereWords(snap: Snapshot, t: Task): { name: string; machine: string } {
  const name = workName(t)
  const machine = !name || snap.machines.length > 1 ? machineLabel(snap, t.on) : ''
  return { name, machine }
}

/** the line over an open task's title: a tap shows that project's tasks (as its tag did); a machine alone is plain text.
 *  It comes after the title in the page, so a screen reader hears "<title>, in <project>". */
export function TaskWhere({ snap, t, onShow }: { snap: Snapshot; t: Task; onShow: () => void }) {
  const { name, machine } = whereWords(snap, t)
  if (!name && !machine) return null
  if (!name) return <span className="t0"><span className="t0m">in {machine}</span></span>
  const spoken = [name, machine].filter(Boolean).join(' on ')
  return (
    <button type="button" className="t0" aria-label={`in ${spoken}: show its tasks`} onClick={onShow}>
      <I n="folder" />
      <span className="t0n">{name}</span>
      {machine && <span className="t0m">· {machine}</span>}
    </button>
  )
}

/** the Tasks setting a task starts with: its working folder's on its machine (a local repo has no machine), else
 *  Everywhere's, as the service picks it (service/next.ts defaultsForTask); never the space that asked for it */
export function taskSetting(snap: Snapshot, t: Task): Pick {
  const c = snap.config
  const repo = t.work && c?.repos?.find((r) => r.folder === t.work!.folder && (r.machine ?? snap.host) === t.on)
  return repo?.agents.Tasks ?? c?.all.agents.Tasks ?? { agent: 'claude' }
}

/** whether a row says its agent: only when it isn't what the task's setting picks. Before the machine's catalog is
 *  read, aliases can't be matched, so it says it, as before. */
export function showsAgent(snap: Snapshot, t: Task, pick: Pick, cat?: Catalog): boolean {
  if (!cat) return true
  return !samePick(pick, taskSetting(snap, t), cat)
}
