// Where a task works, in sight (dmalis/shepherdr#100): an open task's header has a small line over its title with its
// project (its machine too when there are several), as GitHub's "owner/repo" over an issue's title and Linear's
// breadcrumb; a row in the list puts its repo line first (where.css). A row never shows the model: it is in the
// header (fork UI 14).
import { I } from '@client/ui.tsx'
import type { Snapshot, Task } from '@shared/types.ts'
import { isEverything, isTilde, machineLabel, reposOf, spaceLabel, workName } from '@shared/view.ts'
import './where.css'

/** the words over a task's title: its project and its machine when there are several; a task outside a repo or folder
 *  says its machine */
export function whereWords(snap: Snapshot, t: Task): { name: string; machine: string } {
  const name = workName(t)
  const machine = !name || snap.machines.length > 1 ? machineLabel(snap, t.on) : ''
  return { name, machine }
}

const folderKey = (f: string) => f.replace(/(.)\/+$/, '$1')

/** the space a task came from, when it works outside that space's own folder ("#shop"; dmalis/shepherdr#131): a space's
 *  Assistant started it in another folder or on another machine, so "#shop only" lists it though its folder isn't
 *  shop's. As GitHub's "repo · from org" and Linear's team key on another team's issue. Nothing for a task in its
 *  space's folder, one with no folder or space, or one from Everything (its tasks always work somewhere else). A space
 *  made at a symlink is in its folder by either path: herdr-task keeps a task's folder by its real one. */
export function fromSpace(snap: Snapshot, t: Task): string {
  if (!t.work || !t.place || isEverything(snap, t.place)) return ''
  const p = snap.places.find((x) => x.id === t.place)
  if (!p?.folder) return ''
  const own = p.machine === t.on && [p.folder, p.real].some((f) => f && folderKey(f) === folderKey(t.work!.folder))
  return own ? '' : spaceLabel(snap, t.place)
}

/** the line over an open task's title: a tap shows that project's tasks (as its tag did); a machine alone is plain text.
 *  It comes after the title in the page, so a screen reader hears "<title>, in <project>". A task from another folder's
 *  space says it, as its row does: "team-handbook · from #shop". */
export function TaskWhere({ snap, t, onShow }: { snap: Snapshot; t: Task; onShow: () => void }) {
  const { name, machine } = whereWords(snap, t)
  if (!name && !machine) return null
  if (!name) return <span className="t0"><span className="t0m">in {machine}</span></span>
  const from = fromSpace(snap, t)
  const spoken = [name, machine].filter(Boolean).join(' on ') + (from ? `, from ${from}` : '')
  return (
    <button type="button" className="t0" aria-label={`in ${spoken}: show its tasks`} onClick={onShow}>
      <I n="folder" />
      <span className="t0n">{name}</span>
      {from ? <span className="t0s">· from {from}{machine && ` · ${machine}`}</span> : machine && <span className="t0m">· {machine}</span>}
    </button>
  )
}

/** fork UI 14: a row's quiet line of where a task works: its project, its machine only where it tells two apart (a
 *  project of the same name on another machine), and the space it came from when that is another folder's, with that
 *  space's machine when a space of the same name is on another one ("team-handbook · from #shop on vm"). The header
 *  over an open task's title has the room to name its machine whenever there are several (TaskWhere). */
export function rowWhere(snap: Snapshot, t: Task): { name: string; machine: string; from: string } {
  const name = workName(t)
  if (!name) return { name: '', machine: '', from: '' }
  // with one machine there is nothing to tell apart (as workWords)
  const many = snap.machines.length > 1
  const twin = many && reposOf(snap).some((r) => r.name === name && r.machine !== t.on)
  let from = fromSpace(snap, t)
  const p = from ? snap.places.find((x) => x.id === t.place) : undefined
  if (many && p && !isTilde(snap, p) && snap.places.some((x) => x.id !== p.id && !x.archived && x.name === p.name && x.machine !== p.machine)) from += ` on ${machineLabel(snap, p.machine)}`
  return { name, machine: twin ? machineLabel(snap, t.on) : '', from }
}
