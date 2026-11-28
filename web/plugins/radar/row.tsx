// Radar's row in the list (the clickable prototype): it comes only where the demo sent a Radar day, so the first
// screen carries none of it. A grey count while items wait and none of them needs you, a red one (the Needs you
// colour) when one does, the name alone at zero; never a bare icon, as Tasks' own counts.
import { getState, setUI, useUI } from '@client/kernel.ts'
import { Row } from '@client/ui.tsx'
import { attentionOf } from '@shared/attention.ts'
import type { Snapshot } from '@shared/types.ts'
import { clock, dayOf, rowCount, setView, useRadar, type Live, type RadarDemo } from './model.ts'

export const PAGE = 'radar'

/** the demo's day, when it sent one */
export const radarOf = (snap: Snapshot | null | undefined) => (snap as (Snapshot & { radar?: RadarDemo }) | null | undefined)?.radar

/** the Triage cards that still ask the person (their data-card), and the answers the demo's service kept */
export function liveOf(snap: Snapshot): Live {
  const cards = new Set(attentionOf(snap).actions.filter((a) => a.kind === 'triage' && a.owner === 'you' && a.card).map((a) => a.card!))
  return { cards, answers: radarOf(snap)?.answers ?? {} }
}

/** open the page: the middle column on a computer, the whole screen on a phone (the Feedback page's way) */
export function openRadar(item?: string) {
  const phone = getState().ui.phone
  if (item !== undefined) setView({ item, tab: 'all' })
  setUI({ page: PAGE, drawer: false, search: false, settings: null, artWide: false, max: null, ...(phone ? { pane: null, task: null, art: null } : {}) })
}

export function RadarRow({ snap }: { snap: Snapshot }) {
  const { view } = useRadar()
  const day = dayOf(radarOf(snap))
  const on = useUI((u) => u.page === PAGE)
  const { n, red } = rowCount(day, liveOf(snap), clock(Date.now(), view))
  const words = !n ? 'Radar' : red ? `Radar, ${n} ${n === 1 ? 'needs' : 'need'} you` : `Radar, ${n} open`
  return <Row icon="pulse" label="Radar" current={on || undefined} aria-label={words} end={n ? <span className={red ? 'cnt needs' : 'cnt'}>{n}</span> : null} onClick={() => openRadar()} />
}
