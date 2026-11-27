// fork #105: a phone's header shows no folder (src/hpath.css); its space's menu (the name's chevron) has a Folder row
// instead, with the folder's name at its end. A tap shows the whole path and its machine with Copy, the same sheet the
// header's folder opens on a desktop (list.tsx's folderMenu). It's there whenever the header hides the folder: a phone, or
// while the keyboard is up (fork #86 hides it then on a tablet or a turned phone too). Otherwise the header shows it.
// A long folder name gives way in its middle, so the row's Folder label always shows.
import { getState, type MenuRow } from '@client/kernel.ts'
import { folderMenu } from '@client/list.tsx'
import { cutMiddle, folderLast } from '@shared/folder-cut.ts'
import { headerWhere, type Space } from '@shared/view.ts'

/** the header hides the folder: a phone's, or any while the keyboard is up (typing.css) */
const hidden = () => getState().ui.phone || document.documentElement.classList.contains('kb-up')

/** the space's menu's Folder row, while the header hides the folder */
export function folderRows(p: Space, off = hidden()): MenuRow[] {
  const snap = getState().snap
  const w = snap && off ? headerWhere(snap, p) : null
  if (!w) return []
  return [{ icon: 'folder', label: 'Folder', value: cutMiddle(folderLast(w.path)), run: () => folderMenu(document.querySelector('.col > .hd .tbtn') ?? document.body, p.id) }]
}
