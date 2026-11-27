// Where a chat is, in its header beside its name (SHEP-360): plain dim text, no pill, border or fill, the size of the
// header's secondary words. The folder as it is (~ and / too; a long path gives way in its middle, so its last part
// shows whole: fork #105) and its machine when that adds something. Everything says it too. A tap shows the whole path
// with Copy. Not on a phone (fork #105): there the space's menu has it (plugins/chat/folder-row.tsx).
import type { Snapshot } from '@shared/types.ts'
import { folderParts } from '@shared/folder-cut.ts'
import { headerWhere, type Space } from '@shared/view.ts'
import { folderMenu } from './list.tsx'
import { cx } from './ui.tsx'
import './hpath.css'

export function HeaderPath({ snap, place }: { snap: Snapshot; place: Space }) {
  const w = headerWhere(snap, place)
  if (!w) return null
  return (
    <button type="button" className="hpath" aria-haspopup="menu" aria-label={`Folder: ${w.full}${w.machine ? ` on ${w.machine}` : ''}`} onClick={(e) => folderMenu(e.currentTarget, place.id)}>
      <span className={cx('hp', w.cut && 'cut')}>{w.cut ? <FolderCut path={w.path} /> : <bdi>{w.path}</bdi>}</span>
      {w.machine && <span className="hm">{w.machine}</span>}
    </button>
  )
}

/** fork #105: a path cut in its middle when short of room (hpath.css): what leads to it gives way, its last part stays */
export function FolderCut({ path }: { path: string }) {
  const { lead, last } = folderParts(path)
  return (
    <>
      {lead && <span className="hpl">{lead}</span>}
      <span className="hpn">{last}</span>
    </>
  )
}
