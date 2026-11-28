// Screens: an agent's browser and desktop, to watch and to take over. Every chat (its name's menu) and every open task
// (its ⋯ menu) has a Screen row beside Terminal, whether or not the agent is using them. The view opens in
// the pane (full screen on a phone): Browser and Desktop tabs, an address bar with reload on the Browser tab, the live
// picture, the machine under the title. Where the agent is not using it, it is yours and there is no bar at the
// bottom; where it is, one pinned line says who is driving with one button: Take over, then Hand back. A task whose
// agent has one open shows a small live picture in its thread; one stuck on a step only a person can do shows a
// "Needs your hands" card with Skip and Take over.
import { useEffect, useState } from 'react'
import { definePlugin, getState, openTask, setUI, tryAct, useSnap, type Thread } from '@client/kernel.ts'
import { later, laterFailed, laterView } from '@client/later.tsx'
import { Btn } from '@client/ui.tsx'
import { DoneRow } from '@plugins/chat/cards.tsx'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import { KindName } from '@plugins/chat/kind.tsx'
import { shortUrl } from '@shared/browser.ts'
import type { Chat, ScreenInfo, Snapshot, Task } from '@shared/types.ts'
import { machineLabel, taskOf, statusWord, tasksIn, tstate } from '@shared/view.ts'
import { screenKey, screenRow } from './menu.ts'

/** the Screen view itself comes when the pane first opens (fork #163, pane.tsx) */
/** fork #163: the Screen view comes when first opened; taking over waits for it, so Hand back is there once you drive */
const pane = later(() => import('./pane.tsx'), 'screens')
const ScreenPane = laterView(() => pane.load().then((m) => m.ScreenPane), undefined, 'screens')

/** whose screen: a chat's, a task's or a machine's desktop */
export function partsOf(snap: Snapshot, key: string) {
  const [kind, ...rest] = key.split(':')
  const id = rest.join(':')
  const task = kind === 'task' ? taskOf(snap, id) : undefined
  const place = kind === 'chat' ? id : task?.place
  const machine = kind === 'machine' ? id : (snap.places.find((p) => p.id === place)?.machine ?? snap.host)
  return { kind: kind as 'chat' | 'task' | 'machine', id, task, place, machine }
}

/** every chat and task has a screen: where the agent isn't using one it is idle, and yours to use */
export function infoOf(snap: Snapshot, key: string): ScreenInfo {
  const known = snap.screens?.[key]
  const { kind, machine } = partsOf(snap, key)
  if (kind === 'machine') return known ?? { d: { of: machine, own: false } }
  return { b: known?.b ?? { url: '' }, d: known?.d ?? { of: machine, own: !snap.config?.desktops?.includes(machine) }, ...known }
}

export const act = (key: string, op: string, more: Record<string, unknown> = {}) => tryAct({ type: 'screen', key, op, ...more })

const openScreen = (key: string, drive = false) => {
  const snap = getState().snap
  const sc = snap ? infoOf(snap, key) : {}
  setUI({ scr: { key, src: sc.b ? 'b' : 'd', drive }, pane: 'screen', settings: null, drawer: false, art: null, task: key.startsWith('task:') ? key.slice(5) : null })
}

/* ---------- in a thread: the small live picture, and Needs your hands ---------- */

const shotUrl = (key: string, src: 'b' | 'd') => `api/screen/shot?key=${encodeURIComponent(key)}&src=${src}`

/** the picture now, read again every few seconds while it shows */
function Thumb({ k, src }: { k: string; src: 'b' | 'd' }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setN((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  return (
    <button type="button" className="thumb" aria-label="Open the live view" onClick={() => openScreen(k)}>
      <img src={`${shotUrl(k, src)}&n=${n}`} alt="" loading="lazy" />
    </button>
  )
}

function HandsCard({ k, sc, t, ref_ }: { k: string; sc: ScreenInfo; t: Task; ref_: boolean }) {
  if (sc.hands!.settled) return ref_ ? null : <DoneRow>{sc.hands!.settled === 'skip' ? 'You skipped this' : 'You did this step'}</DoneRow>
  return (
    <>
      {ref_ && <button type="button" className="ref" onClick={() => openTask(t.id)}><StatusIcon t={t} time="side" /><KindName t={t} name={t.name} state={statusWord(t).word} /></button>}
      <div className="card" data-card={`hands:${t.id}`}>
        <span className="t">Needs your hands</span>
        <span className="s">{sc.hands!.what}{sc.b?.url ? ` · ${shortUrl(sc.b.url)}` : ''}</span>
        {(sc.b || sc.d) && <Thumb k={k} src={sc.b ? 'b' : 'd'} />}
        <div className="acts">
          {/* Skip tells the agent to find another way */}
          <Btn onClick={() => void act(k, 'skip')}>Skip</Btn>
          <Btn kind="pri" onClick={() => void pane.load().then(() => { openScreen(k, true); void act(k, 'take', { src: sc.b ? 'b' : 'd' }) }, laterFailed)}>Take over</Btn>
        </div>
      </div>
    </>
  )
}

/** the small live picture while its task works: an aside under the newest message, as the working sign */
function InThread({ thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  if (!snap || !thread.task) return null
  const t = thread.task
  const k = `task:${t.id}`
  const sc = snap.screens?.[k]
  if (!sc || sc.hands || tstate(t) !== 'working' || !sc.active) return null
  const src = sc.b ? 'b' : 'd'
  return (
    <div className="card live">
      <Thumb k={k} src={src} />
      <span className="s"><i className="dot" />{src === 'b' ? `Browser · ${shortUrl(sc.b!.url)}` : `Desktop · ${machineLabel(snap, sc.d!.of)}`}</span>
    </div>
  )
}

/** Needs your hands: a card where it was asked among the messages, never held at the end (SHEP-419) */
export function handsCards(snap: Snapshot, thread: Thread) {
  const list = thread.task ? [thread.task] : tasksIn(snap, thread.place).filter((t) => !t.archived)
  return list.flatMap((t) => {
    const k = `task:${t.id}`
    const sc = snap.screens?.[k]
    if (!sc?.hands || (!thread.task && sc.hands.settled)) return []
    return [{ key: `hands:${t.id}`, at: t.needsAt ?? t.needsAtWas, node: <HandsCard k={k} sc={sc} t={t} ref_={!thread.task} /> }]
  })
}

export default definePlugin({
  name: 'screens',
  setup(reg) {
    reg.spaceMenu.push({ order: 6, rows: (p, head) => (head ? [screenRow(getState().ui, screenKey(p.id), openScreen)] : []) })
    reg.taskMenu.push({ order: 6, rows: (t, where) => (where === 'thread' ? [screenRow(getState().ui, screenKey(t.place, t.id), openScreen)] : []) })
    reg.panes.push({ id: 'screen', View: ScreenPane })
    reg.chatTail.push({ order: 30, View: InThread })
    reg.chatCards.push({ order: 30, cards: handsCards })
    reg.taskMenu.push({ order: 20, rows: (t, where) => (where === 'row' ? [{ icon: 'screen', label: 'Show screen', run: () => openScreen(`task:${t.id}`) }] : []) })
  },
})
