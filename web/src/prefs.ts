// What this device looks like (Settings › General), kept on this device only: Theme (System follows the device's light
// or dark), Zoom (the whole app), Chat text size (the messages only), Chat width (the messages and the message box
// alike), Motion and Haptics and sounds. index.html puts the theme on the page before the first paint.
import { useSyncExternalStore } from 'react'
import { TEXTS, ZOOMS, type TextSize, type Zoom } from './zoom-steps.ts'

/** Night: true black for OLED screens (#1505), picked by hand; System still picks Light or Dark */
export const THEMES = ['System', 'Light', 'Dark', 'Night'] as const
export const WIDTHS = ['Narrow', 'Medium', 'Wide'] as const
export const MOTIONS = ['System', 'Reduced'] as const
/** Haptics and sounds (fork #196, feel.ts): haptics where the device has them, and very quiet ticks on your sends */
export const FEELS = ['Off', 'Haptics', 'Haptics and sounds'] as const
export interface Prefs {
  theme: (typeof THEMES)[number]
  width: (typeof WIDTHS)[number]
  motion: (typeof MOTIONS)[number]
  feel: (typeof FEELS)[number]
  /** percent: every px of the app's CSS is times this (web/zoom-css.ts) */
  zoom: Zoom
  text: TextSize
}
/** Narrow is 720 px, Medium 880 px, Wide 1040 px */
export const CHAT_WIDTH: Record<Prefs['width'], number> = { Narrow: 720, Medium: 880, Wide: 1040 }

const KEY = 'shepherdr.prefs'
const START: Prefs = { theme: 'System', width: 'Narrow', motion: 'System', feel: 'Haptics', zoom: 100, text: 'Default' }
/** the bars over the app (the browser's, the phone's status bar): the canvas */
const BAR = { light: '#ffffff', dark: '#121212', night: '#000000' }
/** the app's manifest in each, its background_color and theme_color the canvas (index.html picks it before the paint);
 *  the default one is dark, what an installed app shows if it never sees the swap */
const MANIFEST = { light: 'manifest-light.webmanifest', dark: 'manifest.webmanifest', night: 'manifest-night.webmanifest' }

function load(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      theme: THEMES.includes(v.theme as Prefs['theme']) ? v.theme! : START.theme,
      width: WIDTHS.includes(v.width as Prefs['width']) ? v.width! : START.width,
      motion: MOTIONS.includes(v.motion as Prefs['motion']) ? v.motion! : START.motion,
      feel: FEELS.includes(v.feel as Prefs['feel']) ? v.feel! : START.feel,
      zoom: ZOOMS.includes(v.zoom as Zoom) ? v.zoom! : START.zoom,
      text: TEXTS.includes(v.text as TextSize) ? v.text! : START.text,
    }
  } catch {
    return START
  }
}

let prefs = load()
const listeners = new Set<() => void>()
const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
// any finger at all: a touchscreen laptop with a mouse as well can still be tapped, in the phone's layout too
const finger = typeof matchMedia === 'function' ? matchMedia('(any-pointer:coarse)') : null

/** Zoom's lowest step here: on a touch screen 100%, so nothing a finger taps shrinks under its 44 px */
export const minZoom = (): Zoom => (finger?.matches ? 100 : ZOOMS[0]!)
/** the zoom the page has now: the one picked, never under this device's lowest */
export const zoomNow = (): Zoom => (prefs.zoom < minZoom() ? minZoom() : prefs.zoom)

/** dark or night: the app's dark pictures (artifact thumbnails) and colours */
export const isDark = () => prefs.theme === 'Dark' || prefs.theme === 'Night' || (prefs.theme === 'System' && !!system?.matches)
/** which of the three looks the page has now: the phone's bars and the installed app's manifest follow it */
export const look = (): keyof typeof BAR => (prefs.theme === 'Night' ? 'night' : isDark() ? 'dark' : 'light')

function apply() {
  const root = document.documentElement
  // none: the device's own (ds.css follows prefers-color-scheme)
  if (prefs.theme === 'System') delete root.dataset.theme
  else root.dataset.theme = prefs.theme.toLowerCase()
  // the chat's width grows with the zoom, as the CSS's own px do
  root.style.setProperty('--chat-w', `calc(${CHAT_WIDTH[prefs.width]}px*var(--zoom))`)
  // Zoom: --zoom times every px (web/zoom-css.ts); data-zoom picks its step's container queries (none at 100)
  const z = zoomNow()
  root.style.setProperty('--zoom', String(z / 100))
  if (z === 100) delete root.dataset.zoom
  else root.dataset.zoom = String(z)
  // Chat text size: ds.css's --chat sizes for it; Default: none
  if (prefs.text === 'Default') delete root.dataset.text
  else root.dataset.text = prefs.text.toLowerCase()
  if (prefs.motion === 'Reduced') root.dataset.motion = 'reduced'
  else delete root.dataset.motion
  // both of index.html's (light and dark by media): the theme picked wins over the device's
  for (const bar of document.querySelectorAll<HTMLMetaElement>('meta[name=theme-color]')) bar.content = BAR[look()]
  // the installed app's window and the phone's navigation bar: the manifest's colours, read when the app updates
  const manifest = document.querySelector<HTMLLinkElement>('link[rel=manifest]')
  if (manifest) manifest.setAttribute('href', MANIFEST[look()])
  for (const l of listeners) l()
}

if (typeof document !== 'undefined') {
  apply()
  system?.addEventListener('change', apply)
  finger?.addEventListener('change', apply)
  addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== KEY) return
    prefs = load()
    apply()
  })
}

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs = { ...prefs, [k]: v }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* a private window: until it closes */
  }
  apply()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
export const usePrefs = () => useSyncExternalStore(subscribe, () => prefs)
export const getPrefs = () => prefs

/**
 * A width query that follows Zoom, as a browser's zoom moves the page's breakpoints: (max-width:767px) at 150% is a
 * window up to 1150 px. It answers as a MediaQueryList does (`matches`, 'change'); null with no matchMedia (a test).
 */
export function widthUpTo(px: number): Pick<MediaQueryList, 'matches'> & { addEventListener(type: 'change', f: () => void): void } | null {
  if (typeof matchMedia !== 'function') return null
  const fns = new Set<() => void>()
  // up to 767 px is below 768; zoomed, below 768 × the zoom
  const query = (z = zoomNow()) => matchMedia(z === 100 ? `(max-width:${px}px)` : `(max-width:${Math.round((px + 1) * z - 2) / 100}px)`)
  let mq = query()
  let was = mq.matches
  const check = () => {
    if (mq.matches === was) return
    was = mq.matches
    for (const f of fns) f()
  }
  const watch = () => mq.addEventListener('change', check)
  watch()
  let zoom = zoomNow()
  listeners.add(() => {
    if (zoomNow() === zoom) return
    zoom = zoomNow()
    mq.removeEventListener('change', check)
    mq = query()
    watch()
    check()
  })
  return { get matches() { return mq.matches }, addEventListener: (_type, f) => void fns.add(f) }
}
export const useDark = () => useSyncExternalStore(subscribe, isDark)
