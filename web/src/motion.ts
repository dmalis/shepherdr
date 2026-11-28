// How the screen moves, the way iOS does: screens push in from the right and pop back, sheets slide up and drop away,
// menus spring out of their button and fade, the drawer follows the finger. Only transform and opacity move (the GPU
// draws them), and with reduced motion everything just fades, quickly. A part that goes away leaves a still copy of
// itself behind for its last moment (its ghost), so it can slide or fade out however it was closed: a button, Esc,
// Back, or a step back in the history.
import { useLayoutEffect, type RefObject } from 'react'

/** iOS's curve for sheets and pushed screens: quick off the mark, a long soft landing */
export const IOS = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** a spring with a little overshoot: a menu growing out of its button */
export const SPRING = 'cubic-bezier(.25, 1.12, .4, 1)'
/** leaving: gone fast */
export const AWAY = 'cubic-bezier(.4, 0, 1, 1)'

/** a pushed screen and a sheet coming up: done many times a day, so near 300 ms (docs/design.md, Motion) */
export const PUSH_MS = 300
export const SHEET_MS = 300

/** the device's own setting alone: only calm() reads it, so Settings › General › Motion is never left out */
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** the device asks for less motion, or Settings › General › Motion is Reduced: things fade, nothing slides */
export const calm = () => still() || (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced')

/** a strong ease-out: what opens answers at once and lands softly (a menu, a dialog) */
export const OUT = 'cubic-bezier(.23, 1, .32, 1)'

let hushed = 0
/** what changes this moment lands without moving: a swipe (the app's or the system's) already moved it */
export function hush(ms = 150) {
  hushed = performance.now() + ms
}
export const hushedNow = () => performance.now() < hushed

/** where a fling comes to rest: where the finger let go, carried on by its speed (px per ms), like iOS projects it */
export const project = (at: number, v: number) => at + v * 200

/** a finger this fast (px per ms) as it lets go flings: it goes its way however short the swipe */
export const FLING = 0.3

/** Does a swipe let go at `at` with speed `v` land past `mark`? A fling goes the way it was going, as iOS's drawers and
 *  swipe back do; a slow let-go lands where it is carried. */
export const lands = (at: number, v: number, mark: number) => (Math.abs(v) > FLING ? v > 0 : project(at, v) > mark)

/** how long the rest of a slide takes once the finger lets go: a fast fling lands quickly, a slow one at the usual pace */
export function settleMs(left: number, v: number, base = PUSH_MS) {
  const speed = Math.abs(v)
  if (speed < 0.05) return base
  return Math.round(Math.min(base, Math.max(200, (Math.abs(left) / speed) * 2.5)))
}

/** Play a move from where an element is now to `to`; it stays there (as its own style) when done. */
export function moveTo(el: HTMLElement, to: Keyframe, ms: number, easing = IOS): Promise<void> {
  const from: Keyframe = {}
  const cs = getComputedStyle(el)
  for (const k of Object.keys(to)) from[k] = cs.getPropertyValue(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
  for (const a of el.getAnimations()) a.cancel()
  Object.assign(el.style, to)
  if (!ms) return Promise.resolve()
  return el
    .animate([from, to], { duration: ms, easing })
    .finished.then(
      () => undefined,
      () => undefined,
    )
}

/* ---------- coming in and going out ---------- */

/** a menu springs out of its button; a sheet slides up (phone); a dialog grows into the middle (wider); a page pushes
 *  in from the right; a fade just fades */
export type Motion = 'menu' | 'sheet' | 'dialog' | 'page' | 'fade'

/** the part of a sheet or dialog that moves; the rest of it is the shade behind */
const panelOf = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > [data-panel]') ?? el
/** the shade behind a panel, its own element (overlay.tsx's scrim): it fades, so nothing is painted again */
const shadeOf = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > .scrim:not(.clear)')

/** How a sheet, menu or dialog comes in (fork #109): a sheet slides up on iOS's curve, a menu grows out of its button
 *  (its transform-origin), a dialog grows a little in the middle; with less motion, a short fade. */
function enter(el: HTMLElement, m: Motion) {
  if (hushedNow()) return
  if (calm()) return void el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
  const p = panelOf(el)
  const shade = shadeOf(el)
  if (m === 'menu') p.animate([{ opacity: 0, scale: '.96' }, { opacity: 1, scale: '1' }], { duration: 180, easing: OUT })
  else if (m === 'page') p.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: PUSH_MS, easing: IOS })
  else if (m === 'fade') p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
  else {
    if (shade) shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: m === 'sheet' ? SHEET_MS : 200, easing: 'ease-out' })
    else if (p !== el) el.animate([{ backgroundColor: 'transparent' }, {}], { duration: m === 'sheet' ? SHEET_MS : 250, easing: 'ease-out' })
    if (m === 'sheet') p.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: SHEET_MS, easing: IOS })
    else p.animate([{ opacity: 0, scale: '.96' }, { opacity: 1, scale: '1' }], { duration: 200, easing: OUT })
  }
}

/** and goes out: quicker than it came, the same way back */
function leave(el: HTMLElement, m: Motion): Promise<unknown> {
  if (calm()) return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' }).finished
  const p = panelOf(el)
  const shade = shadeOf(el)
  const opt = { fill: 'forwards' as const }
  if (m === 'menu') return p.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.98' }], { ...opt, duration: 120, easing: OUT }).finished
  if (m === 'page') return p.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], { ...opt, duration: 240, easing: IOS }).finished
  if (m === 'fade') return p.animate([{ opacity: 1 }, { opacity: 0 }], { ...opt, duration: 160, easing: 'ease-out' }).finished
  if (shade) shade.animate([{ opacity: 1 }, { opacity: 0 }], { ...opt, duration: m === 'sheet' ? 240 : 150, easing: 'ease-out' })
  else if (p !== el) el.animate([{}, { backgroundColor: 'transparent' }], { ...opt, duration: 260, easing: 'ease-in' })
  if (m === 'sheet') return p.animate([{}, { transform: 'translateY(100%)' }], { ...opt, duration: 240, easing: IOS }).finished
  return p.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.98' }], { ...opt, duration: 150, easing: OUT }).finished
}

/** A still copy of what is on screen: where it is, scrolled as it is, without ids, frames or anything to load again. */
function ghostOf(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const copy = el.cloneNode(true) as HTMLElement
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')]
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')]
  const scrolled: [HTMLElement, number, number][] = []
  from.forEach((n, i) => (n.scrollTop || n.scrollLeft) && scrolled.push([to[i], n.scrollTop, n.scrollLeft]))
  // a copy, not the thing: nothing finds it by its id, name, role or label, nor as a message (data-msg)
  for (const n of to) for (const a of ['id', 'name', 'role', 'aria-label', 'aria-labelledby', 'data-msg', 'data-anchor', 'data-kb']) n.removeAttribute(a)
  // a frame or a video would load again, a canvas comes back blank: an empty box of their size
  for (const f of copy.querySelectorAll<HTMLElement>('iframe, video, canvas')) {
    const box = document.createElement('div')
    box.className = f.className
    box.style.cssText = `width:${f.offsetWidth}px;height:${f.offsetHeight}px`
    f.replaceWith(box)
  }
  Object.assign(copy.style, { position: 'absolute', inset: 'auto', top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', transform: 'none', translate: 'none' })
  return { copy, scrolled }
}

/** the layer ghosts play on: over the app, drawn the way the app is (its device, type and colours) */
function ghostLayer() {
  const app = document.querySelector<HTMLElement>('[data-device]') ?? document.querySelector<HTMLElement>('.app')
  const g = document.createElement('div')
  g.className = app?.className ?? ''
  if (app?.dataset.device) g.dataset.device = app.dataset.device
  g.dataset.ghost = ''
  g.ariaHidden = 'true'
  g.inert = true
  g.style.cssText = 'position:fixed;inset:0;height:auto;display:block;background:transparent;pointer-events:none;z-index:60;overflow:hidden'
  return g
}

/**
 * A part that comes in and goes out with its motion: in as it shows, and out (as its ghost) however it was closed.
 * One a swipe already moved out is marked data-gone and leaves no ghost; `comesIn` false: it is there at once.
 */
export function useMotion(ref: RefObject<HTMLElement | null>, m: Motion, comesIn = true) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (comesIn) enter(el, m)
    return () => {
      if (el.hasAttribute('data-gone') || hushedNow() || !el.isConnected) return
      const { copy, scrolled } = ghostOf(el)
      // React's strict mode takes a part down and up again in development, leaving it on screen: no ghost then
      queueMicrotask(() => {
        if (el.isConnected) return
        const layer = ghostLayer()
        layer.append(copy)
        document.body.append(layer)
        for (const [n, top, left] of scrolled) {
          n.scrollTop = top
          n.scrollLeft = left
        }
        const done = () => layer.remove()
        leave(copy, m).then(done, done)
        setTimeout(done, 600)
      })
    }
  }, [])
}

/* ---------- a tap from the phone ---------- */

/** a light tap from the phone: Android vibrates; iOS 18 and later tick when a switch flips, so one is flipped unseen.
 *  Only from a touch's own handler: a phone taps for the person touching it, not for the app. */
export function buzz() {
  if (navigator.vibrate) return void navigator.vibrate(8)
  const label = document.createElement('label')
  const box = document.createElement('input')
  box.type = 'checkbox'
  box.setAttribute('switch', '')
  label.ariaHidden = 'true'
  label.style.display = 'none'
  label.append(box)
  document.body.append(label)
  label.click()
  label.remove()
}
