// fork #109: the keyboard in a menu, sheet or dialog, as WAI-ARIA's menu and modal dialog patterns (and Radix,
// Linear, GitHub) do it. A dialog keeps Tab inside itself; a menu moves with ↑ ↓ Home End and closes on Tab, the way
// a native menu does (a modal one, of fields or checkboxes, keeps Tab inside). When one closes, focus goes back to what opened it, unless it already went somewhere else.

/** what can take focus inside a layer, in order (a video's own controls too: the browser moves within them) */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), video[controls], audio[controls], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** a field to type or choose in */
const FIELDS = 'input:not([type=hidden]), textarea, select'

/** Is this layer modal, a dialog to screen readers and to Tab? A dialog is; so is a menu of anything but menu rows
 *  (Alerts, the reactions, the Tasks filter's checkboxes) or with a field in it. Only a plain menu of rows is not. */
export const modalOf = (box: HTMLElement, kind: 'menu' | 'dialog') => kind === 'dialog' || !box.querySelector('[role^="menuitem"]') || !!box.querySelector(FIELDS)

/** Tab and Shift+Tab go round what can take focus in `box`, from wherever focus is (outside it too) */
export function tabRound(e: KeyboardEvent, box: HTMLElement) {
  e.preventDefault()
  const all = focusables(box)
  if (!all.length) return box.focus({ preventScroll: true })
  const i = all.indexOf(document.activeElement as HTMLElement)
  const to = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i < 0 || i === all.length - 1 ? 0 : i + 1
  all[to]!.focus()
}

const shows = (el: HTMLElement) => !el.closest('[hidden], [inert]') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0)

export const focusables = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shows)

/** a menu's items: its menu rows, else (a menu drawn by its caller) every button in it */
export function itemsOf(box: HTMLElement) {
  const rows = [...box.querySelectorAll<HTMLElement>(':is([role^="menuitem"], [role="checkbox"]):not([disabled]):not([aria-disabled="true"])')].filter(shows)
  return rows.length ? rows : focusables(box).filter((el) => el.matches('button, a[href]'))
}

/** The item a key moves to from `at` among `n` items: ↑ ↓ wrap around, Home and End go to the ends; -1: not a move. */
export function step(key: string, at: number, n: number): number {
  if (!n) return -1
  if (key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % n
  if (key === 'ArrowUp') return at < 0 ? n - 1 : (at - 1 + n) % n
  if (key === 'Home' || key === 'PageUp') return 0
  if (key === 'End' || key === 'PageDown') return n - 1
  return -1
}

/** Where focus starts as a layer opens. A dialog: its first field (or what says data-autofocus), else itself. A menu:
 *  its first item when opened from the keyboard, else the menu itself, so a tap shows no ring. */
export function focusStart(box: HTMLElement, kind: 'menu' | 'dialog', byKey: boolean) {
  const first =
    kind === 'dialog'
      ? [...box.querySelectorAll<HTMLElement>('[data-autofocus], input:not([type=hidden]):not([disabled]), textarea:not([disabled])')].find(shows)
      : byKey
        ? itemsOf(box)[0]
        : null
  ;(first ?? box).focus({ preventScroll: true })
}

/** The keys a layer takes for itself; true when it took one. `close`: closes the layer (Tab out of a menu). */
export function layerKey(e: KeyboardEvent, box: HTMLElement, kind: 'menu' | 'dialog', close: () => void): boolean {
  if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return false
  const here = document.activeElement as HTMLElement | null
  if (e.key === 'Tab') {
    // out of a plain menu of rows: it closes, and Tab goes on from its button. A modal one keeps Tab inside
    if (!modalOf(box, kind)) {
      close()
      return false
    }
    tabRound(e, box)
    return true
  }
  if (kind !== 'menu') return false
  // typing in a menu's own search field: its arrows are the field's, save ↑ ↓ to step into the rows
  const typing = !!here?.matches('input, textarea, [contenteditable="true"]')
  if (typing && !['ArrowDown', 'ArrowUp'].includes(e.key)) return false
  const items = itemsOf(box)
  const to = step(e.key, here ? items.indexOf(here) : -1, items.length)
  if (to < 0) return false
  e.preventDefault()
  items[to]!.focus()
  return true
}

/** A finger on a phone: putting focus back in a text field would bring its keyboard up again; a button is fine. */
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/** Focus goes back to `to` (what had it before the layer opened) once the layer is gone, if focus is lost in nothing
 *  now (the body, or the gone layer), and `to` is still on the page. */
export function giveBack(to: Element | null, gone: HTMLElement | null) {
  // a page with a document but no DOM classes (a test's stand-in) has nothing to focus
  if (typeof HTMLElement === 'undefined' || !(to instanceof HTMLElement) || !to.isConnected) return
  const now = document.activeElement
  if (now && now !== document.body && !(gone && gone.contains(now)) && now.isConnected) return
  if (coarse() && to.matches('input, textarea, [contenteditable="true"]')) return
  to.focus({ preventScroll: true })
}

/** the last thing a person used: a key, or a pointer (mouse, finger, pen). What a key opens or closes doesn't move. */
let lastByKey = false
if (typeof addEventListener === 'function') {
  addEventListener('keydown', (e: KeyboardEvent) => void (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) && (lastByKey = true)), true)
  addEventListener('pointerdown', () => (lastByKey = false), true)
}
export const byKey = () => lastByKey
