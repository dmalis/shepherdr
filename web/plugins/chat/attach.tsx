// The composer's +: one tap from + to the camera, the photos or the files (ChatGPT's and Claude's apps, WhatsApp's
// attach sheet). A desktop opens files at once. An iPhone or iPad opens Apple's own menu at once (Photo Library, Take
// Photo, Choose File): iOS shows it for every picture or file input, so a sheet of ours before it would be a second
// menu. An Android phone gets a sheet of three big tiles, each straight to its picker: Camera, Photos, Files.
import { useEffect, useRef } from 'react'
import { openMenu } from '@client/overlay.tsx'
import { I, IB } from '@client/ui.tsx'
import { still } from '@client/motion.ts'
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
  const open = (id: string) => inputs.current[id]?.click()
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

/** a downward drag this far (or a flick) closes the sheet */
const CLOSE_AT = 64
const FLICK = 0.5 // px per ms

/** the three tiles; the sheet drags down to close, as iOS's and Android's sheets do (Escape and the scrim close it too) */
export function AddSheet({ close, pick }: { close: () => void; pick: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sheet = ref.current?.closest<HTMLElement>('.sheet')
    if (!sheet) return
    let from: { id: number; y: number; t: number } | null = null
    let dy = 0
    let dragging = false
    const down = (e: PointerEvent) => {
      if (from || !e.isPrimary) return
      from = { id: e.pointerId, y: e.clientY, t: e.timeStamp }
      dy = 0
      dragging = false
    }
    const move = (e: PointerEvent) => {
      if (!from || e.pointerId !== from.id) return
      const d = e.clientY - from.y
      if (!dragging && Math.abs(d) < 6) return
      if (!dragging) {
        dragging = true
        sheet.setPointerCapture(e.pointerId)
        sheet.style.transition = 'none'
      }
      // down follows the finger; up gives a little, with friction
      dy = d > 0 ? d : -Math.sqrt(-d) * 2
      sheet.style.transform = `translateY(${dy}px)`
    }
    const up = (e: PointerEvent) => {
      if (!from || e.pointerId !== from.id) return
      const speed = dy / Math.max(1, e.timeStamp - from.t)
      from = null
      if (!dragging) return
      // the lifted finger's click would land on a tile: it doesn't count
      addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => removeEventListener('click', swallow, { capture: true }), 0)
      if (e.type === 'pointerup' && (dy > CLOSE_AT || speed > FLICK)) return void close()
      const calm = still() || document.documentElement.dataset.motion === 'reduced'
      sheet.style.transition = calm ? 'none' : 'transform .2s cubic-bezier(.32,.72,0,1)'
      sheet.style.transform = ''
    }
    const swallow = (e: Event) => {
      e.stopPropagation()
      e.preventDefault()
    }
    sheet.addEventListener('pointerdown', down)
    sheet.addEventListener('pointermove', move)
    sheet.addEventListener('pointerup', up)
    sheet.addEventListener('pointercancel', up)
    return () => {
      sheet.removeEventListener('pointerdown', down)
      sheet.removeEventListener('pointermove', move)
      sheet.removeEventListener('pointerup', up)
      sheet.removeEventListener('pointercancel', up)
    }
  }, [close])
  return (
    <div ref={ref} className="att">
      {PICKS.map((p) => (
        <button
          key={p.id}
          type="button"
          role="menuitem"
          className="atile"
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
