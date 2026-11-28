// Radar's calm timeline, drawn (the rules are timeline.ts): what needs the person pinned on top as one line that opens
// its Needs you card, then each week's recap over its days, one short line an event. A tap opens the event's item (or
// paused project) in the page's detail: beside the list on a wide page, over it on a phone.
import type { ReactNode } from 'react'
import { cx, Empty, I } from '@client/ui.tsx'
import { openNeeds } from '@client/needs-count.tsx'
import type { Snapshot } from '@shared/types.ts'
import { radarNeeds } from './row.tsx'
import { needsYou, setView, type Live, type RadarItem, type RadarProject, type View } from './model.ts'
import { events, weeks, type Event } from './timeline.ts'

export interface TimelineCtx { snap: Snapshot; view: View; live: Live; now: number; items: RadarItem[]; projects: RadarProject[] }

function Line({ e, on, end }: { e: Event; on: boolean; end?: string }) {
  return (
    <li>
      <button type="button" className={cx('rd-ev', on && 'on')} aria-current={on || undefined} onClick={() => setView({ item: e.open })}>
        <span className={cx('rd-m', e.tone)}><I n={e.icon} /></span>
        <span className="rd-ew">
          <span className="rd-et">{e.words}</span>
          {e.status && <span className="rd-es">· {e.status}</span>}
        </span>
        {end && <span className="rd-ee">{end}</span>}
      </button>
    </li>
  )
}

export function Timeline({ c, onSetup, setupEmpty }: { c: TimelineCtx; onSetup: (p: RadarProject) => void; setupEmpty: (p: RadarProject) => ReactNode }) {
  const pick = c.view.project
  const shown = c.projects.filter((p) => !pick || p.id === pick)
  const asks = c.items.filter((i) => (!pick || i.project === pick) && needsYou(i, c.live))
  const es = events(c.items, c.projects, c.live, c.now, pick)
  const ws = weeks(es, c.now, asks.length)
  const unwatched = shown.filter((p) => p.level === 'none')
  const name = (id: string) => c.projects.find((p) => p.id === id)?.name ?? id
  if (!asks.length && !es.length) {
    // a new install, or a project not set up: offer to set it up; one that is watched and quiet says what will come
    if (unwatched[0]) return <>{setupEmpty(unwatched[0])}</>
    return <Empty title="Nothing yet">What its agents find and its issues show here as they come.</Empty>
  }
  return (
    <div className="rd-tl">
      {asks.map((i) => {
        const cards = radarNeeds(c.snap, [i.needs!.card])
        return (
          <button key={i.id} type="button" className="rd-pin" onClick={() => (cards.length ? openNeeds(cards, [...new Set(cards.map((x) => x.place))]) : setView({ item: i.id }))}>
            <span className="rd-m need"><I n="ask" /></span>
            <span className="rd-pw"><b>{name(i.project)} needs you</b> · {i.title}</span>
            <I n="right" c="rd-go" />
          </button>
        )
      })}
      {ws.map((w) => (
        <section key={w.recap} className="rd-week">
          <p className="rd-recap">{w.recap}</p>
          {w.days.map((d) => (
            <section key={d.day} className="rd-sec">
              <h3 className="rd-h">{d.day}</h3>
              <ul className="rd-list">
                {d.events.map((e) => <Line key={e.id} e={e} on={c.view.item === e.open} end={pick ? undefined : name(e.project)} />)}
              </ul>
            </section>
          ))}
        </section>
      ))}
      {unwatched.length > 0 && (
        <ul className="rd-list">
          {unwatched.map((p) => (
            <li key={p.id}>
              <button type="button" className="rd-ev" onClick={() => onSetup(p)}>
                <span className="rd-m"><I n="plus" /></span>
                <span className="rd-ew"><span className="rd-et">{p.name} isn’t watched yet</span><span className="rd-es">· set it up</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
