// fork #105: a phone's header shows no folder (src/hpath.css); its space's menu (the name's chevron) has a Folder row
// instead, with the folder's name at its end. A tap shows the whole path and its machine with Copy, the same sheet the
// header's folder opens on a desktop (list.tsx's folderMenu). A desktop's menu has no such row: its header shows it.
import { getState, type MenuRow } from '@client/kernel.ts'
import { folderMenu } from '@client/list.tsx'
import { folderLast } from '@shared/folder-cut.ts'
import { headerWhere, type Space } from '@shared/view.ts'

/** the space's menu's Folder row, on a phone only */
export function folderRows(p: Space, phone = getState().ui.phone): MenuRow[] {
  const snap = getState().snap
  const w = snap && phone ? headerWhere(snap, p) : null
  if (!w) return []
  return [{ icon: 'folder', label: 'Folder', value: folderLast(w.path), run: () => folderMenu(document.querySelector('.col > .hd .tbtn') ?? document.body, p.id) }]
}
