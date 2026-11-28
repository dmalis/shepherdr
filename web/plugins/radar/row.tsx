// Radar's row in the list (the clickable prototype): it comes only where the demo sent a Radar day, so the first
// screen carries none of it. Each count opens what it counts. Red (the Needs you colour) when an item's card asks: its
// own button beside the row, as every red count in the list, and a tap opens that card, as Needs you does (one card:
// the card; more: the Needs you list). Grey while items are new or next up and none needs you: the row opens All
// items filtered to exactly those. The name alone at zero; never a bare icon, as Tasks' own counts.
import { getState, setUI, useUI } from '@client/kernel.ts'
import { Cnt, Row } from '@client/ui.tsx'
import { NeedsCount, openNeeds } from '@client/needs-count.tsx'
import { attentionOf } from '@shared/attention.ts'
import { needsItems } from '@shared/needs-open.ts'
import type { Snapshot } from '@shared/types.ts'
import { clock, dayOf, rowCount, setView, shownDay, useRadar, waitingWords, type Live, type RadarDemo, type View } from './model.ts'

export const PAGE = 'radar'

/** the demo's day, when it sent one */
export const radarOf = (snap: Snapshot | null | undefined) => (snap as (Snapshot & { radar?: RadarDemo }) | null | undefined)?.radar

/** the Triage cards that still ask the person (their data-card), and the answers the demo's service kept */
export function liveOf(snap: Snapshot): Live {
  const cards = new Set(attentionOf(snap).actions.filter((a) => a.kind === 'triage' && a.owner === 'you' && a.card).map((a) => a.card!))
  return { cards, answers: radarOf(snap)?.answers ?? {} }
}

/** open the page at this view: the middle column on a computer, the whole screen on a phone (the Feedback page's way) */
export function openRadar(at: Partial<View>) {
  const phone = getState().ui.phone
  setView({ item: null, ...at })
  setUI({ page: PAGE, drawer: false, search: false, settings: null, artWide: false, max: null, ...(phone ? { pane: null, task: null, art: null } : {}) })
}

/** the Radar items whose cards ask the person, as Needs you opens them: their cards, where they wait */
export function radarNeeds(snap: Snapshot, cards: string[]) {
  return needsItems(snap).filter((i) => i.card && cards.includes(i.card))
}

export function RadarRow({ snap }: { snap: Snapshot }) {
  const { view } = useRadar()
  const day = shownDay(dayOf(radarOf(snap)), view)
  const on = useUI((u) => u.page === PAGE)
  const live = liveOf(snap)
  const { n, red } = rowCount(day, live, clock(Date.now(), view))
  // the name: the opening screen, every project; the grey count: exactly what it counts
  const overview = () => openRadar({ tab: 'overview', project: null })
  if (red) {
    const asks = radarNeeds(snap, (day?.items ?? []).flatMap((i) => (i.needs && live.cards.has(i.needs.card) ? [i.needs.card] : [])))
    return (
      <div className="rowx">
        <Row icon="pulse" label="Radar" current={on || undefined} onClick={overview} />
        <NeedsCount n={n} of="Radar" onOpen={() => openNeeds(asks, [...new Set(asks.map((i) => i.place))])} />
      </div>
    )
  }
  // the calm timeline has no tabs: the row keeps it, where what is new and next up are its own lines; the other
  // openings open All items on exactly what the grey count counts
  if (n) return <Row icon="pulse" label="Radar" current={on || undefined} aria-label={`Radar, ${waitingWords(n)}`} end={<Cnt n={n} />} onClick={() => (view.opening === 'timeline' ? overview() : openRadar({ tab: 'all', project: null, filter: 'waiting' }))} />
  return <Row icon="pulse" label="Radar" current={on || undefined} onClick={overview} />
}
