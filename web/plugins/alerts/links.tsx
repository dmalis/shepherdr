// fork Needs you 4/6, exact links (dmalis/shepherdr; the design: fork/specs/needs-you.md).
// - A tap on an alert names its action (`action=` in its link): once the snapshot is in, the screen goes to that
//   action's live card (its card may have moved on to a newer one of the same action), or, when it closed, stays on its
//   task or chat and says what came of it: "Answered · …", "Task moved on · …".
// - An alert sent while this screen is on screen reaches it here, not as a system notification (the service sends this
//   device no push, and a push that lands anyway is handed over by the service worker): a notice with Open, the same
//   as the push would have said, unless its card is already on screen. Each one once: a reconnect or a reload replays
//   nothing (the service sends each alert once, when it is made).
import { useEffect, useRef, useState } from 'react'
import { getState, notice, openLink, setUI, useSnap, useUI, visibleChats, type UI } from '@client/kernel.ts'
import { actionUrl, openAction, outcomeWords, settled, type Outcome } from '@shared/action-link.ts'
import { DEFAULT_LEVEL, LEVELS, OFF } from '@shared/reach.ts'
import { taskChat, taskOf } from '@shared/view.ts'
import type { AlertEvent, Snapshot } from '@shared/types.ts'
import { wanted } from './device.ts'

/** how long a tap's action may be missing before it is judged closed while its task or machine is still being read */
export const WAIT_MS = 15_000

/** what came of a closed action, as the service kept it (GET /api/outcome): null when it can't say */
export async function fetchOutcome(id: string): Promise<Outcome | null> {
  try {
    const r = await fetch(`api/outcome?${new URLSearchParams({ action: id })}`)
    const o = (await r.json()) as Partial<Outcome>
    return o && (o.outcome === 'answered' || o.outcome === 'moved') ? (o as Outcome) : null
  } catch {
    return null
  }
}

/** where a link's action leads now: open (go to its live card), not judged yet (wait), or perhaps closed (the service
 *  says). Missing from a snapshot read before the tap (a page that was in the background) proves nothing: only one read
 *  since (fresh), with its task listed and no machine still coming back, may say it went; or a long enough wait. */
export function resolveTap(snap: Snapshot, ui: Pick<UI, 'task' | 'max' | 'jump' | 'chatLink'>, id: string, waited: number, fresh = true):
  | { open: { url: string | null; jump: string | null } }
  | { wait: true }
  | { closed: { task: string | null } } {
  const a = openAction(snap, id)
  const task = ui.chatLink?.task ?? ui.task ?? ui.max ?? null
  if (a) {
    // its task is not the one open (an old link's space or task): its own link, else only its card
    const there = !a.task || a.task === ui.task || a.task === ui.max
    return { open: { url: there ? null : actionUrl(snap, a).replace(/&action=[^&]*/, ''), jump: a.card && a.card !== ui.jump ? a.card : null } }
  }
  if (!(fresh && settled(snap, task)) && waited < WAIT_MS) return { wait: true }
  return { closed: { task } }
}

/** the action the page was opened with (a cold start from an alert): every snapshot it has is read after that tap */
let coldAction: string | null = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('action')

/** since when this page is on screen (a page on screen and linked has a live snapshot; one just back has an old one) */
let shownSince = Date.now()
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') shownSince = Date.now()
  })
/** a page on screen this long, linked, reads every change as it comes */
const LIVE_MS = 3000

/** the link's action, once the snapshot can say where it is */
export function LinkResolver() {
  const snap = useSnap()
  const id = useUI((u) => u.action ?? null)
  // the tap: its action, when, the snapshot the page had then (none: a cold start), and whether the service is being asked
  const since = useRef<{ id: string; at: number; snap: Snapshot | null; asking: boolean } | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!id) return
    if (since.current?.id !== id) {
      // a cold start, or a tap on a page that was on screen and linked all along (a notice's Open): what it has is now
      const live = document.visibilityState === 'visible' && Date.now() - shownSince > LIVE_MS && !getState().ui.offline
      since.current = { id, at: Date.now(), snap: id === coldAction || live ? null : snap, asking: false }
      coldAction = null
    }
    const tap = since.current
    if (!snap || tap.asking) return
    const ui = getState().ui
    const waited = Date.now() - tap.at
    const r = resolveTap(snap, ui, id, waited, snap !== tap.snap)
    const again = () => {
      const t = setTimeout(() => tick((n) => n + 1), 1000)
      return () => clearTimeout(t)
    }
    if ('wait' in r) return again()
    if ('open' in r) {
      setUI({ action: null })
      if (r.open.url) openLink(r.open.url)
      else if (r.open.jump) {
        const task = ui.task ?? ui.max ?? null
        setUI({ jump: r.open.jump, chatLink: { place: ui.at, task, focus: r.open.jump } })
      }
      return
    }
    // the service says how it ended; it doesn't know yet (still open there, a snapshot behind): ask again a while
    tap.asking = true
    void fetchOutcome(id).then((o) => {
      tap.asking = false
      if (getState().ui.action !== id) return
      if (!o && Date.now() - tap.at < WAIT_MS) return tick((n) => n + 1)
      setUI({ action: null })
      // never heard of (a link older than a week): its task or chat is open, nothing to add
      if (o) notice(outcomeWords(o))
    })
  })
  return null
}

/** the topics this device hears about (Settings › Notifications): Off, none */
export function heard(level: string | null = wanted()): readonly string[] {
  if (level === OFF) return []
  return (LEVELS.find((l) => l.id === level) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL)!).topics
}

/** the task an alert's link names (none: a space's chat) */
const taskOfUrl = (url?: string) => {
  try {
    return url ? new URL(url, 'http://x/').searchParams.get('task') : null
  } catch {
    return null
  }
}

/** is an alert's card on screen now: its task's chat open, or its space's chat for one with no task; not one shown as
 *  its agent's terminal (View as terminal: no cards there) */
export function cardOnScreen(snap: Snapshot, ui: UI, e: Pick<AlertEvent, 'task' | 'place' | 'url'>): boolean {
  const shown = (chat: string) => visibleChats(ui, snap).includes(chat) && !ui.aterm?.[chat]
  const task = e.task ?? taskOfUrl(e.url)
  if (task) {
    const t = taskOf(snap, task)
    return !!t && shown(taskChat(t))
  }
  const p = e.place ? snap.places.find((x) => x.id === e.place) : undefined
  return !!p && ui.at === p.id && shown(p.chat)
}

/** each alert once on this screen (the service sends it once, the service worker hands over a push that lands anyway):
 *  when each was said, so the same one again within the service's 10 minutes is not new */
const said = new Map<string, number>()
const SAID_MS = 10 * 60_000

/** say one alert on this screen, unless this device hears nothing of its kind or its card is on screen */
export function sayAlert(e: AlertEvent) {
  const { snap, ui } = getState()
  const key = `${e.key}@${e.action ?? ''}`
  const now = Date.now()
  if (now - (said.get(key) ?? -Infinity) < SAID_MS) return
  said.set(key, now)
  if (!snap || document.visibilityState !== 'visible' || !heard().includes(e.topic)) return
  if (cardOnScreen(snap, ui, e)) return
  notice(e.title, { sub: e.body || undefined, ...(e.sticky ? { sticky: true } : { ms: 8000 }), ...(e.url ? { act: { label: 'Open', run: () => openLink(e.url!, true) } } : {}) })
}

/** listens for the alerts sent while this screen is on screen: from the service (kernel's 'shepherdr:alert') and from
 *  the service worker (a push that landed while on screen) */
export function listenAlerts(): () => void {
  const fromServer = (ev: Event) => {
    const e = (ev as CustomEvent<AlertEvent>).detail
    if (e && typeof e.key === 'string' && typeof e.title === 'string') sayAlert(e)
  }
  const fromWorker = (ev: MessageEvent) => {
    if (ev.data?.type === 'alert' && ev.data.alert && typeof ev.data.alert.title === 'string') sayAlert(ev.data.alert as AlertEvent)
  }
  addEventListener('shepherdr:alert', fromServer)
  navigator.serviceWorker?.addEventListener('message', fromWorker)
  return () => {
    removeEventListener('shepherdr:alert', fromServer)
    navigator.serviceWorker?.removeEventListener('message', fromWorker)
  }
}
