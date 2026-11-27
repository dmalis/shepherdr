// The composer's +: one tap from + to the camera, the photos or the files (ChatGPT's and Claude's apps, WhatsApp's
// attach sheet). A desktop opens files at once. An iPhone or iPad opens Apple's own menu at once (Photo Library, Take
// Photo, Choose File): iOS shows it for every picture or file input, so a sheet of ours before it would be a second
// menu. An Android phone gets a sheet of three big tiles, each straight to its picker: Camera, Photos, Files.
import { useRef } from 'react'
import { openMenu } from '@client/overlay.tsx'
import { I, IB } from '@client/ui.tsx'
import type { IconName } from '@client/icons.ts'
import './attach.css'

/** iOS and iPadOS (an iPad says it is a Mac, with a touch screen) */
export const appleTouch = (ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', touch = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) =>
  /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1)

/** where + goes: files at once (a desktop), Apple's menu at once (iOS), or our sheet first (Android, other touch) */
export type PlusWay = 'files' | 'apple' | 'sheet'
export const plusWay = (finger: boolean, apple = appleTouch()): PlusWay => (!finger ? 'files' : apple ? 'apple' : 'sheet')

/** the sheet's tiles, each its own file input:
 *  - Camera: `capture` opens the camera at once, no chooser (Android's, and iOS's)
 *  - Photos: image-only opens Android's photo picker; one picture, so one tap on it attaches (several need an Add tap)
 *  - Files: the files app, several at once */
export const PICKS: { id: 'camera' | 'photos' | 'files'; icon: IconName; label: string; accept?: string; capture?: 'environment'; multiple?: boolean }[] = [
  { id: 'camera', icon: 'camera', label: 'Camera', accept: 'image/*', capture: 'environment' },
  { id: 'photos', icon: 'image', label: 'Photos', accept: 'image/*' },
  { id: 'files', icon: 'folder', label: 'Files', multiple: true },
]

/** the + button and its hidden file inputs */
export function AddButtons({ finger, onFiles, apple }: { finger: boolean; onFiles: (f: File[]) => void; apple?: boolean }) {
  const way = plusWay(finger, apple)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  const take = (e: { target: HTMLInputElement }) => {
    onFiles([...(e.target.files ?? [])])
    e.target.value = ''
  }
  const open = (id: string) => (way === 'sheet' && id === 'files' && pickFiles(onFiles, () => inputs.current.files?.click())) || inputs.current[id]?.click()
  const plus = (e: { currentTarget: Element }) =>
    way === 'sheet' ? openMenu(e.currentTarget, (close) => <AddSheet close={close} pick={open} />, { label: 'Add' }) : open('files')
  return (
    <>
      <IB icon="plus" label={way === 'sheet' ? 'Add' : way === 'apple' ? 'Add photos or files' : 'Add files'} aria-haspopup={way === 'sheet' ? 'menu' : undefined} onClick={plus} />
      {/* iOS: no accept and one at a time, so its menu offers all three and one tap on a picture attaches it */}
      <input ref={(el) => void (inputs.current.files = el)} type="file" multiple={way !== 'apple'} hidden onChange={take} />
      {way === 'sheet' &&
        PICKS.filter((p) => p.id !== 'files').map((p) => (
          <input key={p.id} ref={(el) => void (inputs.current[p.id] = el)} type="file" accept={p.accept} capture={p.capture} multiple={p.multiple} hidden data-pick={p.id} onChange={take} />
        ))}
    </>
  )
}

type OpenPicker = (o: { multiple: boolean }) => Promise<{ getFile(): Promise<File> }[]>

/** Files on Android: a file input with no accept can ask first whether to use the camera or the files, so the sheet's
 *  Files opens Android's document picker itself (File System Access, Chrome 132 on). False where there is none: the
 *  input does it. A picker that fails (not a cancel) falls back to the input. */
export function pickFiles(onFiles: (f: File[]) => void, fallback: () => void, w = globalThis as { showOpenFilePicker?: OpenPicker; isSecureContext?: boolean }): boolean {
  if (typeof w.showOpenFilePicker !== 'function' || w.isSecureContext === false) return false
  w.showOpenFilePicker({ multiple: true })
    .then((hs) => Promise.all(hs.map((h) => h.getFile())))
    .then(
      (fs) => fs.length && onFiles(fs),
      (err: { name?: string }) => err?.name !== 'AbortError' && fallback(),
    )
  return true
}

/** the three tiles. The sheet they sit in drags down to close, as every sheet does (overlay.tsx's sheetDrag, fork
 *  #109); Escape and the scrim close it too */
export function AddSheet({ close, pick }: { close: () => void; pick: (id: string) => void }) {
  return (
    <div className="addsh">
      {PICKS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          className="addt"
          onClick={() => {
            // the picker opens from this tap (it needs the tap's user activation), then the sheet goes
            pick(p.id)
            close()
          }}
        >
          <I n={p.icon} />
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  )
}
