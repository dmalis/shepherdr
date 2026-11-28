// fork #144: while you read back through a chat on a phone, the chat gets the room. Scroll back toward older messages
// and the bottom tabs slide away, the message box folds to its one-row form (+, the text, send: typing.css's) and
// slides down into their place; a little scroll toward the newest message, the newest message itself, a tap, focus in
// the box or the tabs, or the keyboard brings both back (reading.ts has the rules). As Safari's bottom bar and iOS 26's
// tab bar ("minimize on scroll down") do; the box never goes, as in iMessage, WhatsApp, Telegram and ChatGPT's app.
// <html> gets the class once per change (one layout); the box's move is drawn with a transform (FLIP), never per
// scroll. With Motion Reduced or the system's reduce-motion it switches at once.
import './reading.css'
import { definePlugin, getState, subscribe } from '@client/kernel.ts'
import { fitBox } from '@client/grow.ts'
import { READING, START, allowed, step, type Box, type Reading } from './reading.ts'

/** iOS's sheet curve, the one its bars move on */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const MS = 320

const COARSE = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null
const REDUCE = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
const still = () => document.documentElement.dataset.motion === 'reduced' || !!REDUCE?.matches
/** a phone, with a finger as the pointer: only there are there bottom tabs to step aside (a mouse window never) */
const active = () => getState().ui.phone && !!COARSE?.matches

/** a chat's or a task thread's scroller, with a message box at its foot */
const footOf = (sc: Element) => (sc.matches('.scroll') && sc.parentElement?.matches(':is(.chat, .pane)') ? sc.parentElement.querySelector<HTMLElement>(':scope > .foot:has(> .cbox)') : null)

function boxOf(sc: HTMLElement, foot: HTMLElement): Box {
  const cbox = foot.querySelector<HTMLElement>(':scope > .cbox')
  const at = document.activeElement
  return {
    text: !!cbox?.querySelector<HTMLTextAreaElement>(':scope > .crow > .cin')?.value,
    extras: !!cbox && [...cbox.children].some((c) => !c.matches('.crow, .cbar')),
    voice: !!cbox?.querySelector(':scope > .cbar > :is(.dsurf, .vin)'),
    ask: !![...sc.querySelectorAll('[data-msg], [data-card]')].at(-1)?.matches('[data-ask], :has([data-ask])'),
    keyboard: getState().ui.keyboard,
    focus: !!at && at !== document.body && (foot.contains(at) || !!at.closest('.app .bar')),
  }
}

/** how much taller the chat gets while reading: the tabs, the box's second row and the suggested replies go (read
 *  between scrolls, when the layout is clean: no extra layout) */
function roomOf(foot: HTMLElement) {
  const h = (e: Element | null | undefined) => (e as HTMLElement | null | undefined)?.offsetHeight ?? 0
  const cbar = foot.querySelector(':scope > .cbox > .cbar')
  return h(document.querySelector('.app .bar')) + h(cbar) + [...foot.querySelectorAll(':scope > :is(.sugs, .sugfor)')].reduce((n, e) => n + h(e), 0)
}

/** the box's text fitted to its new width, as typing.ts does when its own mark changes */
const refit = () => document.querySelectorAll<HTMLTextAreaElement>('.cbox > .crow > textarea.cin').forEach((t) => t.getClientRects().length > 0 && fitBox(t))

export default definePlugin({
  name: 'reading',
  setup() {
    const root = document.documentElement
    let s: Reading = START
    let sc: HTMLElement | null = null

    /** marks <html> and draws the box's move from where it was (FLIP): one layout, then a transform */
    const set = (on: boolean) => {
      if (root.classList.contains(READING) === on) return
      const foot = sc?.isConnected ? footOf(sc) : null
      const from = foot && !still() ? foot.getBoundingClientRect().top : null
      root.classList.toggle(READING, on)
      refit()
      if (!foot || from == null) return
      const dy = from - foot.getBoundingClientRect().top
      if (Math.abs(dy) >= 1) foot.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: MS, easing: EASE })
    }
    const back = () => {
      s = { ...s, on: false, run: 0 }
      set(false)
    }

    const onScroll = (e: Event) => {
      const el = e.target
      if (!(el instanceof HTMLElement)) return
      const foot = footOf(el)
      if (!foot) return
      if (!active()) return back()
      const max = el.scrollHeight - el.clientHeight
      // the bounce past either end is no move of yours
      const y = Math.min(Math.max(el.scrollTop, 0), max)
      if (el !== sc) {
        sc = el
        s = { ...START, y, h: el.scrollHeight }
        set(false)
      }
      const next = step(s, y, el.scrollHeight, max - y, allowed(boxOf(el, foot)), s.on ? 0 : roomOf(foot))
      s = next
      set(next.on)
    }
    // a tap anywhere brings all back, as a tap at the foot does in Safari (a tap that only stops a scroll is no click)
    const onClick = () => root.classList.contains(READING) && back()
    // focus in the box or the tabs (VoiceOver, a keyboard, a tap on the box): they are back before it lands
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (root.classList.contains(READING) && t instanceof Element && t.closest('.app :is(.foot, .bar)')) back()
    }
    const onShow = () => document.visibilityState === 'visible' && back()

    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', onFocus, true)
    document.addEventListener('visibilitychange', onShow)
    addEventListener('resize', back)
    COARSE?.addEventListener('change', back)

    // the keyboard opening, another chat, pane, task or window: all back at once
    let was = getState().ui
    subscribe(() => {
      const u = getState().ui
      if (u === was) return
      const moved = u.keyboard || u.at !== was.at || u.pane !== was.pane || u.task !== was.task || u.drawer !== was.drawer || u.settings !== was.settings || u.phone !== was.phone
      was = u
      if (moved && root.classList.contains(READING)) {
        sc = null
        back()
      }
    })
  },
})
