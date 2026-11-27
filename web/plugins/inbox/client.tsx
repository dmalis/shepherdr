// The alerts list (fork #37): a bell in the list's top row with the unread count, opening every push alert of the last
// 7 days, newest first, by day. The pattern of Slack's Activity, Linear's Inbox and GitHub's notifications: unread
// until opened or marked read (one tap on the row, or Mark all read), and read on every device at once (the service
// keeps the list, service/inbox.ts). An alert also counts as read once its task or space is open on a screen you use.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { definePlugin, notice, openLink, openSettings, useSnap, useUI, type UI } from '@client/kernel.ts'
import { openMenu } from '@client/overlay.tsx'
import { Btn, Cnt, cx, Empty, I, IB, Seg } from '@client/ui.tsx'
import type { IconName } from '@client/icons.ts'
import type { InboxItem, Snapshot } from '@shared/types.ts'
import { agoShort, spaceLabel } from '@shared/view.ts'
import { byDay, stateOf } from './words.ts'
import './inbox.css'

/* read marks sent but not yet back in the snapshot: shown at once, dropped once the snapshot has them, undone if the
 * service said no (the bell must never say read on one device and unread on the others) */
const sent = new Set<string>()
let all = 0
const ls = new Set<() => void>()
const tell = () => ls.forEach((l) => l())
let ver = 0
const useSent = () => useSyncExternalStore((l) => (ls.add(l), () => void ls.delete(l)), () => ver)

const isRead = (x: InboxItem) => !!x.read || sent.has(x.id) || x.at <= all

export async function markRead(ids: string[] | 'all', items: InboxItem[] = []) {
  const was = all
  const added = ids === 'all' ? [] : ids.filter((id) => !sent.has(id))
  if (ids === 'all') all = Math.max(all, ...items.map((x) => x.at), 0)
  else added.forEach((id) => sent.add(id))
  ver++
  tell()
  const ok = await fetch('api/inbox/read', { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify(ids === 'all' ? { all: true } : { ids }) })
    .then((r) => r.ok)
    .catch(() => false)
  if (ok) return true
  if (ids !== 'all') for (const id of ids) failed.set(id, Date.now())
  if (ids === 'all') all = was
  else added.forEach((id) => sent.delete(id))
  ver++
  tell()
  return false
}

/** marks the snapshot now has (or whose alert is gone) are no longer held here */
export function settle(items: InboxItem[]) {
  const byId = new Map(items.map((x) => [x.id, x]))
  let changed = false
  for (const id of sent) {
    const x = byId.get(id)
    if (!x || x.read) { sent.delete(id); changed = true }
  }
  if (all && items.every((x) => x.at > all || x.read)) { all = 0; changed = true }
  if (changed) { ver++; tell() }
}

/** reads the service refused, by when: not asked again on their own for 30 s (a page left open never loops) */
const failed = new Map<string, number>()
const RETRY_MS = 30_000

/** The unread alerts the screen shows now. Nothing while Settings or Search is open, or on a phone while the list of
 *  spaces is out. A task's alerts once that task shows (beside the chat, maximized, or a phone's Tasks pane on it); a
 *  space's own once its chat shows, which on a phone a pane covers (web/src/read-marks.ts seenChats' rule). */
export function seenIds(ui: Pick<UI, 'phone' | 'drawer' | 'pane' | 'settings' | 'search' | 'task' | 'max' | 'at'>, items: InboxItem[], now = Date.now()): string[] {
  if (ui.settings || ui.search || (ui.phone && ui.drawer)) return []
  const task = ui.phone ? (ui.pane === 'tasks' ? ui.task : null) : ui.task
  const shown = new Set([task, ui.max].filter(Boolean) as string[])
  const chat = !ui.task && !ui.max && !(ui.phone && ui.pane)
  return items
    .filter((x) => !isRead(x) && now - (failed.get(x.id) ?? 0) >= RETRY_MS)
    .filter((x) => (x.task ? shown.has(x.task) : chat && !!x.place && x.place === ui.at))
    .map((x) => x.id)
}

export const unreadOf = (items: InboxItem[] | undefined) => (items ?? []).filter((x) => !isRead(x)).length

/** what kind of alert, by its icon: still waiting (amber), ready (green), resolved, done, an Assistant's message */
function iconOf(x: InboxItem): [IconName, string] {
  const st = stateOf(x)
  if (st === 'Resolved') return ['check', 'c-mute']
  if (x.topic === 'ready') return ['ready', 'c-ready']
  if (x.topic === 'done') return ['check', 'c-ready']
  if (x.topic === 'assistant') return ['chat', 'c-mute']
  const key = x.key ?? x.id
  if (key.startsWith('alert:') || key.startsWith('provider:')) return ['bell', 'c-ask']
  return ['ask', 'c-ask']
}

/** where an alert opens: its own link, else its task or space */
const hrefOf = (x: InboxItem) => x.url ?? (x.place ? `./?${new URLSearchParams({ place: x.place, ...(x.task ? { task: x.task } : {}) })}` : null)

function Item({ x, snap, close }: { x: InboxItem; snap: Snapshot; close: () => void }) {
  const read = isRead(x)
  const st = stateOf(x)
  const [icon, tone] = iconOf(x)
  const where = x.place ? spaceLabel(snap, x.place) : ''
  const href = hrefOf(x)
  return (
    <button
      type="button"
      className={cx('inbx-it', !read && 'new')}
      aria-label={`${read ? '' : 'Unread: '}${x.title}`}
      onClick={() => {
        if (!read) void markRead([x.id]).then((ok) => ok || notice("Couldn't mark it read. Try again.", { tone: 'error' }))
        close()
        if (href) openLink(href, true)
      }}
    >
      <I n={icon} c={tone} />
      <span className="n">
        <span className="inbx-t">{x.title}</span>
        {x.body && <span className="inbx-b">{x.body}</span>}
        <span className="inbx-m">
          {[where, agoShort(x.at) === 'now' ? 'now' : `${agoShort(x.at)} ago`].filter(Boolean).join(' · ')}
          {st && <span className={cx('inbx-st', st === 'Waiting' && 'wait')}>{st === 'Waiting' ? 'Waiting on you' : 'Resolved'}</span>}
        </span>
      </span>
      {!read && <span className="inbx-dot" aria-hidden="true" />}
    </button>
  )
}

const SHOW = ['All', 'Unread'] as const

function Panel({ close }: { close: () => void }) {
  const snap = useSnap()
  useSent()
  const [show, setShow] = useState<(typeof SHOW)[number]>('All')
  if (!snap) return null
  const items = snap.inbox ?? []
  const unread = unreadOf(items)
  const shown = show === 'Unread' ? items.filter((x) => !isRead(x)) : items
  return (
    <div className="inbx">
      <div className="inbx-hd">
        <b>Alerts</b>
        <Seg label="Show" values={SHOW} value={show} onChange={setShow} />
        <IB
          icon="gear"
          label="Notification settings"
          onClick={() => {
            close()
            openSettings('all', 'General')
          }}
        />
      </div>
      {unread > 0 && (
        <div className="inbx-bar">
          <span>{unread === 1 ? '1 unread' : `${unread} unread`}</span>
          <Btn small onClick={() => void markRead('all', items).then((ok) => ok || notice("Couldn't mark them read. Try again.", { tone: 'error' }))}>Mark all read</Btn>
        </div>
      )}
      <div className="inbx-list">
        {byDay(shown).map((g) => (
          <section key={g.name} aria-label={g.name}>
            <div className="cap">{g.name}</div>
            {g.items.map((x) => <Item key={x.id} x={x} snap={snap} close={close} />)}
          </section>
        ))}
        {!shown.length && (
          <Empty title={show === 'Unread' && items.length ? 'All read' : 'No alerts yet'}>
            {show === 'Unread' && items.length ? 'Every alert of the last 7 days is read.' : 'What needs you, a task ready for review and agents’ alerts show here for 7 days.'}
          </Empty>
        )}
      </div>
    </div>
  )
}

function Bell() {
  const snap = useSnap()
  useSent()
  const n = unreadOf(snap?.inbox)
  return (
    <IB icon="bell" label={n ? `Alerts, ${n} unread` : 'Alerts'} onClick={(e) => openMenu(e.currentTarget, (close) => <Panel close={close} />, { label: 'Alerts' })}>
      <Cnt n={Math.min(n, 99)} />
    </IB>
  )
}

/** what is open on a screen in use counts as read: a task's alerts once its task shows, a space's own once it shows */
function SeenOnScreen() {
  const snap = useSnap()
  const ui = useUI()
  useSent()
  const [looking, setLooking] = useState(() => document.visibilityState === 'visible' && document.hasFocus())
  useEffect(() => {
    const on = () => setLooking(document.visibilityState === 'visible' && document.hasFocus())
    document.addEventListener('visibilitychange', on)
    addEventListener('focus', on)
    addEventListener('blur', on)
    return () => {
      document.removeEventListener('visibilitychange', on)
      removeEventListener('focus', on)
      removeEventListener('blur', on)
    }
  }, [])
  useEffect(() => settle(snap?.inbox ?? []), [snap?.inbox])
  const ids = looking && snap ? seenIds(ui, snap.inbox ?? []) : []
  const key = ids.join('\n')
  useEffect(() => {
    if (key) void markRead(key.split('\n'))
  }, [key])
  return null
}

export default definePlugin({
  name: 'inbox',
  setup(reg) {
    reg.sideHead.push(Bell)
    reg.overlays.push(SeenOnScreen)
  },
})
