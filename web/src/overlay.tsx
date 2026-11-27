// Everything that opens over the app: a menu (a popover anchored to its button on a desktop, a sheet rising from the
// bottom on a phone), a dialog (400 px, or 560 px for a picker; a sheet on a phone) and a confirmation. One stack: the
// top one takes Escape and the scrim's tap. Fork #109: every one is drawn by one component (LayerView): sheets slide
// up and drop away and follow a finger down, popovers grow out of their button, dialogs grow in the middle; focus
// starts inside and goes back to what opened it.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useUI, type MenuRow } from './kernel.ts'
import { Btn, cx, I, Row } from './ui.tsx'
import { KeysOf } from './kbd.tsx'
import { useMotion, type Motion } from './motion.ts'
import { sheetDrag } from './sheet-drag.ts'
import { byKey, focusStart, giveBack, layerKey } from './layer-focus.ts'

interface Layer {
  id: number
  kind: 'menu' | 'dialog'
  /** what opened a menu: it anchors there, and the same button pressed again closes it */
  anchor?: Element | null
  wide?: boolean
  /** a dialog without the form's own padding and gaps (search, the picker) */
  bare?: boolean
  /** a picture or file shown on its own, over the whole screen (chat/preview.tsx) */
  view?: boolean
  label?: string
  /** a small menu that floats at its button on a phone too, above it where it fits (a message's emoji strip) */
  float?: boolean
  /** a menu kept inside this box (its panel) and lined up with its button's end, as tall as the room under it allows
   *  (its own body scrolls): the Tasks filter */
  within?: Element | null
  /** a phone's sheet shows this on top (a menu's name: Add, a space's name) */
  title?: string
  /** a menu of rows: as a sheet on iOS it ends with Cancel */
  cancel?: boolean
  /** opened from the keyboard: it comes in without moving, its first item focused */
  byKey?: boolean
  /** what had focus before it opened: focus goes back there */
  opener?: Element | null
  render: (close: () => void) => ReactNode
  onClose?: () => void
}

/** What had focus as a layer opens. Opened from a menu's row (Rename…), it is what opened that menu: the row goes. */
function openerNow(): Element | null {
  if (typeof document === 'undefined') return null
  const now = document.activeElement
  const from = now && [...layers, ...(gone ? [gone] : [])].find((l) => document.querySelector(`[data-layer="${l.id}"]`)?.contains(now))
  return from ? (from.opener ?? null) : now
}
/** the layer closed last, while it may still be on the page: a row that closed its menu and opens a dialog */
let gone: Layer | null = null

let layers: Layer[] = []
/** a menu or dialog is open: the app's single-key shortcuts wait */
export const hasLayer = () => layers.length > 0
let seq = 1
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

function close(id: number) {
  const l = layers.find((x) => x.id === id)
  if (!l) return
  // closed from the keyboard (Esc, Enter on a row): gone at once, no exit motion
  if (byKey() && typeof document !== 'undefined') document.querySelector(`[data-layer="${id}"]`)?.setAttribute('data-gone', '')
  layers = layers.filter((x) => x.id !== id)
  gone = l
  l.anchor?.removeAttribute('aria-expanded')
  l.onClose?.()
  emit()
  // once it is gone, focus goes back to what opened it (unless something else took it, as a dialog a row opened)
  if (typeof document !== 'undefined') setTimeout(() => giveBack(l.opener ?? null, null))
}

/** close whatever is on top; false when nothing was open */
export function closeTop(): boolean {
  const top = layers[layers.length - 1]
  if (!top) return false
  close(top.id)
  return true
}

export function closeAll() {
  for (const l of [...layers]) close(l.id)
}

export const anyOpen = () => layers.length > 0

/** what is open now, bottom first (for tests) */
export const layersNow = (): readonly Layer[] => layers

/** Open a menu at its button. Its rows, or anything drawn (`render`); `cap`: a quiet line on top; `top`: above the rows. */
export function openMenu(anchor: Element | null, rows: MenuRow[] | ((close: () => void) => ReactNode), opts: { cap?: string; top?: (close: () => void) => ReactNode; label?: string; float?: boolean; within?: Element | null } = {}) {
  // the same button again closes it
  const was = anchor && layers.find((l) => l.kind === 'menu' && l.anchor === anchor)
  if (was) return close(was.id)
  const opener = openerNow()
  for (const l of layers.filter((x) => x.kind === 'menu')) close(l.id)
  const id = seq++
  // the space's name and the filter show they are open; a row's ⋯ stays as it is
  if (anchor?.matches('.tbtn, .hpath, [data-marks]')) anchor.setAttribute('aria-expanded', 'true')
  // a sheet of rows says what it is for on top (Add, the space's name), unless its caller put something there
  const plain = typeof rows !== 'function'
  const title = plain && !opts.top && !opts.cap ? opts.label : undefined
  layers = [...layers, { id, kind: 'menu', anchor, label: opts.label, float: opts.float, within: opts.within, title, cancel: plain, byKey: byKey(), opener: anchor ?? opener, render: (done) => (typeof rows === 'function' ? rows(done) : <MenuRows rows={rows} close={done} cap={opts.cap} top={opts.top?.(done)} />) }]
  emit()
}

/** Open a dialog: 400 px on a desktop (560 px `wide`), a sheet on a phone. Returns its close. */
export function openDialog(render: (close: () => void) => ReactNode, opts: { wide?: boolean; bare?: boolean; view?: boolean; label?: string; onClose?: () => void } = {}): () => void {
  const opener = openerNow()
  for (const l of layers.filter((x) => x.kind === 'menu')) close(l.id)
  const id = seq++
  layers = [...layers, { id, kind: 'dialog', render, byKey: byKey(), opener, ...opts }]
  emit()
  return () => close(id)
}

/** Open a dialog whose body keeps its own state (fields, a choice): `Form` is one component for the dialog's whole life.
 *  Defined inside a dialog's render, it would be a new component each time the app redraws, and React would put new
 *  fields in place of the old: the field being typed in loses its focus. On a phone the keyboard coming up redraws the
 *  app, so the keyboard closed at once and nothing could be typed (SHEP-308). */
export function openForm(Form: (p: { close: () => void }) => ReactNode, opts: { wide?: boolean; bare?: boolean; label?: string; onClose?: () => void } = {}): () => void {
  return openDialog((close) => <Form close={close} />, opts)
}

/** "Are you sure?", asked only before what can't be undone */
export function confirm(o: { title: string; body: ReactNode; ok: string; danger?: boolean; run: () => void | Promise<unknown> }) {
  openDialog(
    (done) => (
      <>
        <h2>{o.title}</h2>
        <p>{o.body}</p>
        <div className="acts">
          <Btn onClick={done}>Cancel</Btn>
          <Btn
            kind={o.danger ? 'danger' : 'pri'}
            onClick={() => {
              done()
              void o.run()
            }}
          >
            {o.ok}
          </Btn>
        </div>
      </>
    ),
    { label: o.title },
  )
}

/** a menu's rows: a row with `sub` folds open in place (Move to group) */
export function MenuRows({ rows, close: done, cap, top }: { rows: MenuRow[]; close: () => void; cap?: string; top?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      {top}
      {top && rows.length > 0 && <hr />}
      {cap && <div className="cap">{cap}</div>}
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'contents' }}>
          {r.line && <hr />}
          {r.sub ? (
            <>
              <Row icon={r.icon} label={r.label} expanded={open === r.label} end={<I n={open === r.label ? 'down' : 'right'} c="s16" />} role="menuitem" onClick={() => setOpen(open === r.label ? null : r.label)} />
              {open === r.label &&
                r.sub.map((s) => (
                  <Row
                    key={s.label}
                    label={s.label}
                    style={{ paddingLeft: 36 }}
                    role="menuitem"
                    onClick={() => {
                      done()
                      s.run?.()
                    }}
                  />
                ))}
            </>
          ) : (
            <Row
              icon={r.icon}
              label={r.label}
              value={r.value}
              danger={r.danger}
              // a view it opens: a check at its end while that view is open
              end={(r.on || r.cmd) && <>{r.cmd && <KeysOf id={r.cmd} />}{r.on && <I n="check" c="s16" />}</>}
              {...(r.on === undefined ? { role: 'menuitem' } : { role: 'menuitemcheckbox', 'aria-checked': r.on })}
              onClick={() => {
                done()
                r.run?.()
              }}
            />
          )}
        </div>
      ))}
    </>
  )
}

/** a menu kept inside its panel: no wider than the panel less 8 px each side, its end lined up with its button's,
 *  under the button and only as tall as the room left (above it instead when there is much more room there) */
export function inside(pop: HTMLElement, t: DOMRect, box: DOMRect): { left: number; top: number } {
  const room = { left: Math.max(8, box.left + 8), right: Math.min(innerWidth - 8, box.right - 8) }
  pop.style.maxWidth = ''
  pop.style.maxHeight = ''
  const css = getComputedStyle(pop)
  const own = { w: parseFloat(css.maxWidth) || Infinity, h: parseFloat(css.maxHeight) || Infinity }
  pop.style.maxWidth = `${Math.max(0, Math.min(own.w, room.right - room.left))}px`
  const w = pop.offsetWidth
  const h = pop.offsetHeight
  const below = innerHeight - 8 - (t.bottom + 4)
  const above = t.top - 4 - 8
  const up = h > below && above > below * 1.5
  const max = Math.min(own.h, Math.max(120, up ? above : below))
  pop.style.maxHeight = `${max}px`
  const left = Math.min(Math.max(room.left, t.right - w), room.right - w)
  return { left, top: up ? t.top - 4 - Math.min(h, max) : t.bottom + 4 }
}

/** Where a popover goes at its button: under it, flipped above when it would leave the screen, kept on screen
 *  sideways; and the point it grows out of (its transform-origin), the button's middle on the popover's near edge. */
export function placeAt(t: DOMRect, w: number, h: number, float = false): { left: number; top: number; origin: string } {
  const left = Math.min(Math.max(8, float ? t.left + t.width / 2 - w / 2 : t.left), innerWidth - w - 8)
  let top = t.bottom + 4
  if (float && t.top - h - 4 >= 8) top = t.top - h - 4
  else if (top + h > innerHeight - 8) top = Math.max(8, t.top - h - 4)
  return { left, top, origin: originOf(t, { left, top, w, h }) }
}

/** the point of a popover nearest its button: where it grows from */
export function originOf(t: DOMRect, p: { left: number; top: number; w: number; h: number }) {
  const x = Math.min(Math.max(t.left + t.width / 2 - p.left, 0), p.w)
  const y = p.top >= t.top + t.height / 2 ? 0 : p.h
  return `${Math.round(x)}px ${Math.round(y)}px`
}

/** iOS: a menu shown as a sheet ends with Cancel, as its action sheets do; elsewhere a tap outside, Esc or Back closes */
const ios = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** the shape a layer takes: a sheet on a phone (a menu or a dialog), a popover at its button, a dialog in the middle,
 *  or a picture over everything */
type Shape = 'sheet' | 'pop' | 'dlg' | 'view'
const shapeOf = (l: Pick<Layer, 'kind' | 'float' | 'view'>, phone: boolean): Shape => (l.view ? 'view' : phone && !l.float ? 'sheet' : l.kind === 'menu' ? 'pop' : 'dlg')
const MOTION: Record<Shape, Motion> = { sheet: 'sheet', pop: 'menu', dlg: 'dialog', view: 'fade' }

/**
 * One layer, whatever its shape (fork #109): the shade behind and the panel, which comes in and goes out with its
 * shape's motion, takes the keyboard (focus starts in it, Tab stays in a dialog, arrows move in a menu), is named for
 * screen readers by its title, and, as a sheet, follows a finger down to close. Search (App.tsx) draws its own through
 * `Overlay`, the same.
 */
function LayerView({ layer, phone, close: done, className, children }: { layer: Layer; phone: boolean; close: () => void; className?: string; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const shape = shapeOf(layer, phone)
  const kind = layer.kind
  const [at, setAt] = useState<{ left: number; top: number; origin: string } | null>(null)
  // a popover at its button (or kept inside its panel), placed before it shows, and again as the window or it changes
  useLayoutEffect(() => {
    if (shape !== 'pop') return
    const place = () => {
      const pop = panel.current
      if (!pop) return
      const t = layer.anchor?.getBoundingClientRect()
      if (!t) return setAt({ left: 16, top: 16, origin: 'top left' })
      if (layer.within) {
        const p = inside(pop, t, layer.within.getBoundingClientRect())
        return setAt({ ...p, origin: originOf(t, { ...p, w: pop.offsetWidth, h: pop.offsetHeight }) })
      }
      setAt(placeAt(t, pop.offsetWidth, pop.offsetHeight, layer.float))
    }
    place()
    addEventListener('resize', place)
    // a menu in a panel follows its own size too (a search narrowing its rows)
    const ro = layer.within && panel.current && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null
    if (ro && panel.current) ro.observe(panel.current.firstElementChild ?? panel.current)
    return () => {
      removeEventListener('resize', place)
      ro?.disconnect()
    }
  }, [layer, shape])
  // comes in with its shape's motion, unless a key opened it; goes out the same way (a key closing it: at once)
  useMotion(wrap, MOTION[shape], !layer.byKey)
  // its name and role, then where focus starts: once it shows (a popover is hidden until it is placed)
  const shows = shape !== 'pop' || !!at
  const started = useRef(false)
  useLayoutEffect(() => {
    const box = panel.current
    if (!box || !shows || started.current) return
    started.current = true
    if (kind === 'menu') box.setAttribute('role', box.querySelector('[role^="menuitem"]') ? 'menu' : 'dialog')
    const title = kind === 'dialog' ? box.querySelector<HTMLElement>('h1, h2') : null
    if (title) {
      title.id ||= `layer-${layer.id}-title`
      box.setAttribute('aria-labelledby', title.id)
      box.removeAttribute('aria-label')
    }
    // a menu has no field: the keyboard starts in it; a dialog starts in its first field
    focusStart(box, kind, !!layer.byKey)
  }, [shows])
  // a sheet: dragged down, it closes; its field stays in sight as the keyboard comes up
  useEffect(() => {
    const box = panel.current
    if (shape !== 'sheet' || !box) return
    const off = sheetDrag(box, wrap.current?.querySelector<HTMLElement>(':scope > .scrim') ?? null, () => {
      wrap.current?.setAttribute('data-gone', '')
      done()
    })
    const show = () => {
      const f = document.activeElement
      if (f instanceof HTMLElement && box.contains(f)) f.scrollIntoView({ block: 'nearest' })
    }
    addEventListener('app-resized', show)
    return () => {
      off()
      removeEventListener('app-resized', show)
    }
  }, [shape])
  const cls =
    shape === 'view'
      ? 'lbox'
      : shape === 'sheet'
        ? cx('pop sheet', kind === 'dialog' && !layer.bare && 'form', layer.title && 'titled')
        : shape === 'pop'
          ? 'pop'
          : cx('dlg', layer.wide && 'wide')
  return (
    <div ref={wrap} className="ovl" data-layer={layer.id}>
      <div className={cx('scrim', shape === 'pop' && 'clear')} onClick={done} />
      <div
        ref={panel}
        data-panel=""
        tabIndex={-1}
        className={cx(cls, className)}
        role={kind === 'menu' ? 'menu' : 'dialog'}
        aria-modal={kind === 'dialog' || undefined}
        aria-label={layer.label}
        style={shape === 'pop' ? (at ? { left: at.left, top: at.top, transformOrigin: at.origin } : { visibility: 'hidden' }) : undefined}
        onKeyDown={(e) => layerKey(e.nativeEvent, e.currentTarget, kind, done) && e.stopPropagation()}
      >
        {shape === 'sheet' && layer.title && <div className="shd">{layer.title}</div>}
        {children}
        {shape === 'sheet' && kind === 'menu' && layer.cancel && ios() && (
          <button type="button" className="row scancel" onClick={done}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

/** Something the app draws open on its own state (Search), as a layer: the same shapes, motion, keys and drag. */
export function Overlay({ kind = 'dialog', wide, bare, label, className, onClose, children }: { kind?: 'menu' | 'dialog'; wide?: boolean; bare?: boolean; label?: string; className?: string; onClose: () => void; children: ReactNode }) {
  const phone = useUI((u) => u.phone)
  const [layer] = useState<Layer>(() => ({ id: seq++, kind, wide, bare, label, byKey: byKey(), opener: document.activeElement, render: () => null }))
  useEffect(() => () => void setTimeout(() => giveBack(layer.opener ?? null, null)), [])
  return (
    <LayerView layer={layer} phone={phone} close={onClose} className={className}>
      {children}
    </LayerView>
  )
}

/** Escape's first takers, before the top layer closes: a dictation recording in a box (SHEP-314: Escape cancels it,
 *  not the Feedback dialog it's in). Each returns true when it took the key. */
export const escapeFirst = new Set<() => boolean>()

/** the stack, drawn once by the shell */
export function Layers() {
  const all = useSyncExternalStore(subscribe, () => layers)
  const phone = useUI((u) => u.phone)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      if ([...escapeFirst].some((f) => f()) || closeTop()) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [])
  return (
    <>
      {all.map((l) => {
        const done = () => close(l.id)
        return (
          <LayerView key={l.id} layer={l} phone={phone} close={done}>
            {l.render(done)}
          </LayerView>
        )
      })}
    </>
  )
}
