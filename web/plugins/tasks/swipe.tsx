// fork #185 (Tasks: swipe actions on a phone, a pilot): what a task's row shows when a finger slides it to the left,
// as Mail's and Things' rows do. One or two of its menu's own actions that are safe, each tapped to act: the shortcut
// its state calls for (Reply to its question, Open PR for a review) or its Changes, then Archive at the edge, the only
// one a full slide does, because Archive has Undo. Merging, stopping, allowing and deleting are never on a swipe.
// A slide to the right still replies in the space's chat (slide.tsx). A mouse never slides: it has the menu.
import { notice, registry, setUI, tryAct } from '@client/kernel.ts'
import type { SlideAct } from '@plugins/chat/slide.tsx'
import type { Snapshot, Task } from '@shared/types.ts'
import { taskChat, tstate } from '@shared/view.ts'
import { shortcutOf } from './shortcut.tsx'

/** an Undo toast stays at least this long (docs/design.md, Toasts) */
export const UNDO_MS = 5000

/** the actions a task's row shows on a slide to the left, left to right, the full slide's last; none for a task whose
 *  machine can't be reached (the caller leaves them out) */
export function swipeActs(snap: Snapshot, t: Task): SlideAct[] {
  const out: SlideAct[] = []
  const sc = shortcutOf(snap, t)
  if (sc) out.push({ key: 'shortcut', label: sc.label, name: sc.name, icon: sc.icon, run: sc.run })
  // herdr-task refuses to archive a task while its agent works: no Archive to fail on a working one
  const archive = !t.archived && tstate(t) !== 'working'
  // its Changes (the diff plugin's row), when there is room beside the shortcut and Archive
  const changes = registry.taskMenu.flatMap((m) => m.rows(t, 'row')).find((r) => r.label === 'Changes' && r.run)
  if (changes?.run && out.length < (archive ? 1 : 2)) out.push({ key: 'changes', label: 'Changes', name: `Changes in ${t.name}`, icon: 'branch', run: changes.run })
  if (archive) out.push({ key: 'archive', label: 'Archive', name: `Archive ${t.name}`, icon: 'archive', full: true, doing: 'Archiving…', run: () => archiveTask(t, { quiet: true }) })
  return out
}

/** Archive a task, from its menu or a swipe: out of its list, nothing deleted, with an Undo that brings it back.
 *  `quiet`: the row already shows "Archiving…" (a swipe), so no toast says it too. Resolves whether it archived;
 *  a failure's error is the toast tryAct shows. */
export async function archiveTask(t: Task, o: { quiet?: boolean } = {}): Promise<boolean> {
  const chat = taskChat(t)
  if (!(await tryAct({ type: 'archive', chat, on: true }, undefined, o.quiet ? undefined : 'Archiving…'))) return false
  setUI((ui) => ({ ...(ui.task === t.id ? { task: null } : {}), ...(ui.max === t.id ? { max: null } : {}) }))
  notice(`Archived “${t.name}”`, {
    tone: 'ok',
    ms: UNDO_MS,
    act: { label: 'Undo', run: () => void tryAct({ type: 'archive', chat, on: false }, `“${t.name}” is back in its list`, 'Unarchiving…') },
  })
  return true
}
