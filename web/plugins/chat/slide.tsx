// Slide to reply (SHEP-332): a finger that slides a message to the right and lets go past the mark replies to it; the
// same gesture, mark, tick and spring on a task's row (the Tasks panel, a task's line or card in the chat) replies to
// that task in the space's chat. A press held still can open a menu. Mouse pointers never slide: they have the menu.
// fork #185: a row given actions (`acts`, a task's row in the Tasks list) also slides to the left, as Mail's and
// Things' rows do: its actions show behind it, each tapped to act, and one row is open at a time (another one's touch,
// a scroll from it or Escape puts it away). A full slide does the last action on its own, only one marked `full`
// (Archive, which has Undo): the row stays out showing what it is doing until it leaves the list, springs back if it
// fails, and focus goes on to the next row. Every action is in the row's menu too.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import { getState, setUI } from '@client/kernel.ts'
import { attr } from '@client/attr.ts'
import { calm } from '@client/motion.ts'
import { zoomNow } from '@client/prefs.ts'
import { cx, I } from '@client/ui.tsx'
import type { IconName } from '@client/icons.ts'
import { placeOf } from '@shared/view.ts'
import type { Task } from '@shared/types.ts'
import { Finger, HOLD_MS, leftOf, REPLY_AT } from './press.ts'

/** a light tick, where the device has one (Android; iPhones have no web haptics). Reduced motion, the device's or
 *  Settings › General › Motion, turns it off (fork #185, docs/design.md: Haptics and sounds). */
export const tick = (ms = 8) => {
  if (calm()) return
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not allowed here */
  }
}

/** The click a finger's lift makes after a hold would land on the menu's backdrop the hold just opened, and close it:
 *  the next click (within a moment of the lift) is swallowed. */
export function swallowClick() {
  const eat = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    off()
  }
  const lifted = () => setTimeout(off, 400)
  const off = () => {
    removeEventListener('click', eat, true)
    removeEventListener('pointerup', lifted, true)
    removeEventListener('pointercancel', lifted, true)
  }
  addEventListener('click', eat, true)
  addEventListener('pointerup', lifted, true)
  // fork #185: a hold the browser took (a cancel) makes no click either: the next real tap is not eaten
  addEventListener('pointercancel', lifted, true)
}

/** an action behind a row, shown by a slide to the left (fork #185): one of its menu's own rows */
export interface SlideAct {
  key: string
  /** its word under the icon */
  label: string
  /** its accessible name: the word, then the row's thing ("Archive Switch payment provider") */
  name: string
  icon: IconName
  /** what it does; a full slide's resolves false when it failed (its error is shown by it) */
  run: () => unknown
  /** the last action only: a full slide does it, and the row waits out of the list while it runs */
  full?: boolean
  /** what the row says while a full one runs ("Archiving…") */
  doing?: string
}

/** the actions behind a row now, for <SlideActs> */
export interface Tray {
  acts: SlideAct[]
  slide: number
  open: boolean
  full: boolean
  busy: boolean
  settling: boolean
  tap: (a: SlideAct) => void
}

/** the one row whose actions are out: another one opening puts it away */
let shut: (() => void) | null = null
/** a row a full slide took out comes back after this if it is still in the list (its thing stayed) */
const LEAVE_MS = 2000

/** where focus goes when a row leaves after its full action: the next row of the list (every row given `acts`, even
 *  none now), else the one before, else the last control before it (its group's heading) */
export function nextRow(el: HTMLElement): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>('[data-slide]')]
  const i = all.indexOf(el)
  if (i < 0) return null
  const row = (all[i + 1] ?? all[i - 1])?.querySelector<HTMLElement>('button')
  if (row) return row
  const before = [...document.querySelectorAll<HTMLElement>('button')].filter((b) => !el.contains(b) && !!(b.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))
  return before[before.length - 1] ?? null
}

/** The slide on one thing: bind `on` to the element the finger presses, move `moving` by `style`, show <SlideHint>
 *  (and <SlideActs> for `acts`). `skip` is set when the click that follows was a hold or a slide, not a tap (the
 *  caller's onClick clears it). `hold`: what a press held still opens (the element it was on); `off`: no slide now
 *  (its words are being selected); `acts`: the actions a slide to the left shows (fork #185). */
export function useSlide(reply: () => void, opts: { hold?: (el: HTMLElement) => void; off?: boolean; acts?: SlideAct[] } = {}) {
  const finger = useRef<Finger | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const skip = useRef(false)
  const box = useRef<HTMLElement | null>(null)
  const rowW = useRef(0)
  /** the last slide went left: its actions stay drawn while the row settles back over them */
  const wentLeft = useRef(false)
  /** the row went out by a full slide: focus goes here when it leaves */
  const gone = useRef<HTMLElement | null>(null)
  const alive = useRef(true)
  /** the pointer that started the slide: only it moves, ends or cancels it */
  const pid = useRef<number | null>(null)
  /** the actions as the full slide found them: the row says what it does even as its task changes under it */
  const busyActs = useRef<SlideAct[] | null>(null)
  const [slide, setSlide] = useState(0)
  const [armed, setArmed] = useState(false)
  const [full, setFull] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [settling, setSettling] = useState(false)
  const now = opts.acts?.length ? opts.acts : null
  const acts = busy && busyActs.current ? busyActs.current : now
  const hasFull = !!acts?.[acts.length - 1]?.full
  // with less motion nothing springs: it lands at once
  const settle = () => setSettling(!calm())
  const close = () => {
    // focus on an action goes back to the row as they close, never to the page
    const el = box.current
    const at = document.activeElement
    if (el && at && el.querySelector('.sla')?.contains(at)) el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    settle()
    setSlide(0)
    setArmed(false)
    setFull(false)
    setOpen(false)
  }
  const closer = useRef(close)
  closer.current = close
  const put = useRef(() => closer.current()).current
  useEffect(() => () => clearTimeout(timer.current), [])
  // leaving the list after a full slide: focus goes on to the next row, if it was here or nowhere
  useLayoutEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(leave.current)
      if (shut === put) shut = null
      const to = gone.current
      if (!to?.isConnected) return
      const at = document.activeElement
      if (!at || at === document.body || box.current?.contains(at)) to.focus({ preventScroll: true })
    }
  }, [])
  // one row open: another's touch, anything outside it, or Escape puts it away
  useEffect(() => {
    if (!open) return
    if (shut && shut !== put) shut()
    shut = put
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) put()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && put()
    // the list scrolling any way (a wheel, keys) puts it away too
    const scrolled = (e: Event) => {
      const t = e.target
      if (box.current && t instanceof Node && t !== box.current && t.contains(box.current)) put()
    }
    addEventListener('pointerdown', away, true)
    addEventListener('keydown', esc)
    addEventListener('scroll', scrolled, true)
    return () => {
      removeEventListener('pointerdown', away, true)
      removeEventListener('keydown', esc)
      removeEventListener('scroll', scrolled, true)
      if (shut === put) shut = null
    }
  }, [open])
  // its actions went (the task changed, its machine went away) while it was out: it goes back
  useEffect(() => {
    if (!now && !busy && (open || slide < 0)) close()
  }, [!!now])
  const letGo = (replying: boolean) => {
    skip.current = true
    close()
    if (replying) reply()
  }
  /** the full action: the row goes out and says what it does; back if it failed, else it waits to leave */
  const doFull = () => {
    const a = acts?.[acts.length - 1]
    if (!a?.full) return close()
    const el = box.current
    gone.current = el ? nextRow(el) : null
    busyActs.current = acts
    // focus on the row goes to the action as it works ("Archiving…"), then on to the next row as it leaves
    const had = !!el && el.contains(document.activeElement)
    if (had) requestAnimationFrame(() => el?.querySelector<HTMLElement>('.slt.on')?.focus({ preventScroll: true }))
    wentLeft.current = true
    settle()
    setBusy(true)
    setOpen(false)
    setFull(true)
    setArmed(false)
    setSlide(-(rowW.current || el?.getBoundingClientRect().width || 0))
    const back = () => {
      if (!alive.current) return
      gone.current = null
      busyActs.current = null
      setBusy(false)
      close()
    }
    void Promise.resolve(a.run()).then((ok) => {
      if (ok === false) return back()
      if (!alive.current) return
      leave.current = setTimeout(() => {
        if (!alive.current) return
        gone.current = null
        busyActs.current = null
        setBusy(false)
        setSettling(false)
        setSlide(0)
        setFull(false)
      }, LEAVE_MS)
    }, back)
  }
  const tap = (a: SlideAct) => {
    if (busy) return
    if (a.full) return doFull()
    close()
    a.run()
  }
  const cancel = (e: RPE<HTMLElement>) => {
    const f = finger.current
    if (e.pointerId !== pid.current) return
    finger.current = null
    pid.current = null
    clearTimeout(timer.current)
    const o = f?.cancel()
    // no click follows a cancel: nothing to skip
    if (o === 'back') close()
    else if (o === 'open' && f?.left) {
      settle()
      setSlide(-f.left.w)
      setFull(false)
    }
  }
  const on = {
    // every row given actions, even none now, so focus can go on to it (nextRow)
    'data-slide': opts.acts ? '' : undefined,
    onPointerDown: (e: RPE<HTMLElement>) => {
      if (e.button !== 0 || opts.off || e.pointerType === 'mouse' || !e.isPrimary || busy) return
      const el = e.currentTarget
      box.current = el
      pid.current = e.pointerId
      const w = el.getBoundingClientRect().width
      rowW.current = w
      const f = new Finger(e.clientX, e.clientY, performance.now(), { left: acts ? leftOf(acts.length, hasFull, w, zoomNow() / 100) : null, rowW: w, open })
      finger.current = f
      clearTimeout(timer.current)
      const hold = opts.hold
      if (!hold || open) return
      timer.current = setTimeout(() => {
        if (finger.current !== f || !f.hold(performance.now())) return
        tick(10)
        skip.current = true
        swallowClick()
        hold(el)
      }, HOLD_MS)
    },
    onPointerMove: (e: RPE<HTMLElement>) => {
      const f = finger.current
      if (!f || f.held || e.pointerId !== pid.current) return
      const r = f.move(e.clientX, e.clientY, performance.now())
      if (f.way === 'scroll') {
        finger.current = null
        clearTimeout(timer.current)
        // a scroll from an open row puts its actions away, as a list's do
        if (open) close()
        return
      }
      if (f.way !== 'slide') return
      clearTimeout(timer.current)
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId)
      setSettling(false)
      if (r.slide) wentLeft.current = r.slide < 0
      setSlide(r.slide)
      setArmed(f.armed)
      setFull(f.full)
      if (r.crossed) tick()
    },
    onPointerUp: (e: RPE<HTMLElement>) => {
      const f = finger.current
      if (e.pointerId !== pid.current) return
      finger.current = null
      pid.current = null
      clearTimeout(timer.current)
      const o = f?.up(performance.now())
      if (o === 'reply' || o === 'back') letGo(o === 'reply')
      else if (o === 'open' && f?.left) {
        skip.current = true
        settle()
        setSlide(-f.left.w)
        setFull(false)
        setOpen(true)
      } else if (o === 'full') {
        skip.current = true
        doFull()
      } else if (o === 'tap' && open && !(e.target as Element).closest?.('.sla')) {
        // a tap on an open row puts its actions away; it doesn't open the row
        skip.current = true
        close()
      }
    },
    onPointerCancel: cancel,
    // the row lost the finger it had captured: the same as a cancel (after a lift there is none left to lose). Only
    // its own: a touch starts captured by the button it touched, which loses it to the row as the slide begins.
    onLostPointerCapture: (e: RPE<HTMLElement>) => e.target === e.currentTarget && cancel(e),
  }
  const shown = !!acts && (slide < 0 || busy || (settling && wentLeft.current))
  return {
    on,
    slide,
    armed,
    skip,
    /** a finger is on it now (a right click waits for it) */
    pressing: () => !!finger.current,
    /** for the thing that moves: its class (the spring back) and transform */
    moving: { className: settling ? 'settle' : '', style: slide ? { transform: `translateX(${slide}px)` } : undefined, onTransitionEnd: () => setSettling(false), inert: busy || undefined },
    /** slid to the left now, or settling back from it: the row clips what goes past its edge */
    sliding: shown,
    /** the actions behind the row, for <SlideActs> (fork #185) */
    tray: shown ? ({ acts: acts!, slide, open, full, busy, settling, tap } satisfies Tray) : null,
  }
}

/** The actions behind a row slid to the left (fork #185), from its right edge, the last (a full slide's) there. Each
 *  comes out with the row's edge, as Mail's do; a full slide's grows over the others. They can be reached only while
 *  open: before that they are hidden from screen readers and the keyboard (the row's menu has each of them). */
export function SlideActs({ tray }: { tray: Tray | null }) {
  const full = !!tray?.full
  // the full action taking over the rest (or giving them back) moves there quickly rather than jumping
  const [snap, setSnap] = useState(false)
  const was = useRef(full)
  useEffect(() => {
    if (was.current === full) return
    was.current = full
    if (calm()) return
    setSnap(true)
    const t = setTimeout(() => setSnap(false), 160)
    return () => clearTimeout(t)
  }, [full])
  if (!tray) return null
  const { acts, slide, open, busy, settling, tap } = tray
  const n = acts.length
  const doing = busy ? acts.find((a) => a.full)?.doing : undefined
  return (
    <>
    {/* what a full slide is doing, said to a screen reader as it starts */}
    <span className="vh" role="status">{doing ?? ''}</span>
    <div className={cx('sla', open && 'on')} aria-hidden={open || busy ? undefined : true} inert={!open && !busy}>
      {acts.map((a, j) => {
        const lit = !!a.full && (full || busy)
        const x = lit ? slide : (slide * (n - j)) / n
        const doing = lit && busy
        return (
          <button
            key={a.key}
            type="button"
            className={cx('slt', lit && 'on', settling && 'settle', a.full && snap && 'snap')}
            style={{ transform: `translateX(${x}px)` }}
            aria-label={doing ? a.doing ?? a.name : a.name}
            aria-busy={doing || undefined}
            tabIndex={open ? undefined : -1}
            onClick={(e) => {
              e.stopPropagation()
              tap(a)
            }}
          >
            <span className="sli">
              <I n={doing ? 'working' : a.icon} />
              <span>{doing ? a.doing ?? a.label : a.label}</span>
            </span>
          </button>
        )
      })}
    </div>
    </>
  )
}

/** what shows behind a sliding thing: Reply, strong once a let-go replies */
export function SlideHint({ slide, armed }: { slide: number; armed: boolean }) {
  if (slide <= 0) return null
  return (
    <span className={armed ? 'rpl on' : 'rpl'} aria-hidden="true" style={{ width: Math.max(0, slide - 8), opacity: Math.min(1, slide / REPLY_AT) }}>
      <I n="reply" />
      <span>Reply</span>
    </span>
  )
}

/** The space chat the person is in: where a reply to a task goes (whatever space or machine the task is on). */
export function mainChat(): string | null {
  const { snap, ui } = getState()
  return (snap && placeOf(snap, ui.at)?.chat) || null
}

/** Reply to a task in the space's chat, as to a message: its title goes in the box's reply chip, the space's chat
 *  shows (a task open in the middle, or a phone's panel, steps aside) and its box takes the keyboard. What is sent then
 *  carries the task's tag line, so "status?" is about that task (service/actions.ts quoteOf). */
export function replyToTask(t: Pick<Task, 'id' | 'name'>) {
  const key = mainChat()
  if (!key) return
  const { ui } = getState()
  setUI((u) => ({
    reply: { ...u.reply, [key]: { id: `task:${t.id}`, task: t.id, text: t.name.slice(0, 200) } },
    ...(ui.max ? { max: null } : {}),
    ...(ui.phone && ui.pane ? { pane: null, task: null } : {}),
  }))
  // the box may only show once the chat is back in front
  const focus = () => globalThis.document?.querySelector?.<HTMLTextAreaElement>(`textarea[data-box="${attr(key)}"]`)?.focus?.()
  if (ui.max || (ui.phone && ui.pane)) setTimeout(focus, 60)
  else focus()
}
