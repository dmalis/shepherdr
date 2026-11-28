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
import { IOS, calm } from '@client/motion.ts'
import { READING, START, allowed, step, type Box, type Reading } from './reading.ts'

/** a move a scroll starts many times a day: near 300 ms (docs/design.md, Motion), on iOS's curve */
const MS = 300

const COARSE = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null
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
    ask: !![...sc.querySelectorAll('[data-msg], [data-card]')].at(-1)?.matches(':is(.card, [data-ask]), :has(:is(.card, [data-ask]))'),
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
      const from = foot && !calm() ? foot.getBoundingClientRect().top : null
      root.classList.toggle(READING, on)
      refit()
      if (!foot || from == null) return
      const dy = from - foot.getBoundingClientRect().top
      if (Math.abs(dy) >= 1) foot.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: MS, easing: IOS })
    }
    const back = () => {
      s = { ...s, on: false, run: 0 }
      set(false)
    }

    // Decided once a frame, before it is drawn and after every scroll listener: the chat's own (Messages) must first
    // see it has left its end, or the room changing under it would pull it back there (stick.ts).
    let pending: HTMLElement | null = null
    const onScroll = (e: Event) => {
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.matches('.scroll')) return
      if (!pending) requestAnimationFrame(decide)
      pending = el
    }
    const decide = () => {
      const el = pending
      pending = null
      if (!el?.isConnected) return
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
    // ...but not under a press. A mouse or trackpad focuses on the way down: the box would slide up while the button
    // is held, and the release would miss it (a click on ↓ that does nothing). They come back on the release instead,
    // as its click (above) or, with no click (a drag out of the box), once it is let go. A finger focuses only after
    // it lifts, so a tap is as before.
    let pressing = false
    const onFocus = (e: FocusEvent) => {
      const t = e.target
      if (!pressing && root.classList.contains(READING) && t instanceof Element && t.closest('.app :is(.foot, .bar)')) back()
    }
    const onDown = () => {
      pressing = true
    }
    const onUp = () => {
      if (!pressing) return
      pressing = false
      // after this release's click, if any
      setTimeout(() => {
        const at = document.activeElement
        if (root.classList.contains(READING) && at instanceof Element && at.closest('.app :is(.foot, .bar)')) back()
      })
    }
    const onShow = () => document.visibilityState === 'visible' && back()

    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    document.addEventListener('click', onClick, true)
    document.addEventListener('focusin', onFocus, true)
    addEventListener('pointerdown', onDown, true)
    addEventListener('pointerup', onUp, true)
    addEventListener('pointercancel', onUp, true)
    addEventListener('blur', onUp)
    document.addEventListener('visibilitychange', onShow)
    addEventListener('resize', back)
    COARSE?.addEventListener('change', back)

    // what came meanwhile (a question, a review, a chip, dictation): checked once drawn, all back if it forbids
    let checking = false
    const recheck = () => {
      checking = false
      const foot = sc?.isConnected ? footOf(sc) : null
      if (root.classList.contains(READING) && (!foot || !allowed(boxOf(sc!, foot)))) back()
    }

    // the keyboard opening, another chat, pane, task or window: all back at once
    let was = getState().ui
    subscribe(() => {
      if (root.classList.contains(READING) && !checking) {
        checking = true
        requestAnimationFrame(recheck)
      }
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
