// A machine's card in Settings › Machines (dmalis/shepherdr#107), laid out as macOS's About This Mac and Activity
// Monitor, iOS's General › About and iPhone Storage, and Tailscale's machine list: a header with its name, its role and
// a status dot with words; Health (three meters with their amounts and the start limit marked on each bar); System
// (OS, uptime, restart, versions, work there); then its actions. On a phone each card folds to its header and one line
// ("OK · disk 4% · up 2 days"), as a list row does, and opens in place on a tap (ARIA's accordion: a heading holding its button).
import { useState, type ReactNode } from 'react'
import type { Machine } from '@shared/types.ts'
import { attention, gauges, STATUS_WORDS, statusOf, summaryOf, upOf, compareVersions, type Gauge } from '@shared/machine-facts.ts'
import { cx, I } from './ui.tsx'
import './machine-card.css'

export interface CardLimit { name: string; value: string; off: boolean }

/** a bar, how full, with its start limit marked on it; amber once over that limit or the alert one (as upstream's meter) */
export function LimitBar({ pct, level, limit }: { pct: number | undefined; level: Gauge['level']; limit?: number }) {
  const w = Math.max(0, Math.min(100, pct ?? 0))
  return (
    <div className={cx('mc-bar', level !== 'ok' && level)} aria-hidden="true">
      <i style={{ ['--w' as string]: `${w}%` }} />
      {typeof limit === 'number' && limit > 0 && limit < 100 && <b style={{ ['--at' as string]: `${limit}%` }} />}
    </div>
  )
}

const LEVEL_WORDS = { busy: 'New tasks wait', over: 'Over its alert limit' } as const

function GaugeView({ g, limit }: { g: Gauge; limit?: CardLimit }) {
  const at = limit && !limit.off ? parseFloat(limit.value) : undefined
  const pct = g.pct === undefined ? '–' : `${Math.round(g.pct)}%`
  const side = g.level !== 'ok' ? LEVEL_WORDS[g.level] : limit ? (limit.off ? 'No limit' : `Limit ${limit.value}`) : ''
  return (
    <div className="mc-g" role="group" aria-label={`${g.name} ${pct}${g.lines.length ? `, ${g.lines.join(', ')}` : ''}${side ? `, ${side}` : ''}`}>
      <div className="mc-gh"><span>{g.name}</span><span className="num">{pct}</span></div>
      <LimitBar pct={g.pct} level={g.level} limit={Number.isFinite(at) ? at : undefined} />
      <div className="mc-gs">
        <span className="mc-gl">{g.lines.map((l) => <span key={l}>{l}</span>)}</span>
        {side && <span className={cx('mc-glim', g.level !== 'ok' && `c-${g.level}`)}>{side}</span>}
      </div>
    </div>
  )
}

const Fact = ({ k, children, warn }: { k: string; children: ReactNode; warn?: boolean }) => (
  <div className="mc-f"><dt>{k}</dt><dd className={warn ? 'c-busy' : undefined}>{children}</dd></div>
)

export interface MachineCardProps {
  m: Machine
  serving?: Machine
  /** "Serves this app" or "Linked" */
  role: string
  agents: number
  working: number
  limits: CardLimit[]
  /** folded until opened (a phone) */
  foldable: boolean
  /** "Read just now", beside Health */
  read?: string
  now?: number
  actions?: ReactNode
  /** a broken link's why and what to do */
  linkWhy?: string
}

export function MachineCard({ m, serving, role, agents, working, limits, foldable, read, now = Date.now(), actions, linkWhy }: MachineCardProps) {
  const [open, setOpen] = useState(!foldable)
  const st = statusOf(m, serving)
  const warns = st === 'off' ? [] : attention(m, serving)
  const shown = open || !foldable
  const s = m.system
  const up = upOf(m, now)
  const there = serving && serving.machine !== m.machine ? serving.system : undefined
  const older = (a?: string | null, b?: string | null) => !!a && !!b && compareVersions(a, b) < 0
  const work = st === 'off' ? '' : `${agents} ${agents === 1 ? 'agent' : 'agents'} running${working ? ` · ${working} ${working === 1 ? 'task' : 'tasks'} working` : ''}`
  // a phone's card: its status and the facts that matter in one line, open or folded (its role and work are under
  // System); a computer's: its role and work, its status on the right
  const second = foldable ? summaryOf(m, serving, now) : [role, work].filter(Boolean).join(' · ')
  const bodyId = `mc-${m.id.replace(/[^\w-]/g, '_')}`
  const head = (
    <>
      <span className={cx('mc-dot', st)} aria-hidden="true" />
      <span className="mc-ht">
        <span className="nm">{m.name}</span>
        <span className="mc-h2">{second}</span>
      </span>
      {!foldable && <span className="mc-hst">{STATUS_WORDS[st]}</span>}
      {foldable && <I n="down" c={cx('mc-chev', open && 'up')} />}
    </>
  )
  return (
    <section className={cx('mcard', 'mc', st)} aria-label={m.name}>
      {foldable ? (
        <h3 className="mc-hh"><button type="button" className="mc-h" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>{head}</button></h3>
      ) : (
        <h3 className="mc-hh"><div className="mc-h">{head}</div></h3>
      )}
      {shown && (
        <div className="mc-body" id={bodyId}>
          {warns.length > 0 && (
            <ul className="mc-warn">
              {warns.map((w) => <li key={w.id}><I n="warn" c="c-ask" />{w.words}</li>)}
            </ul>
          )}
          {st === 'off' ? (
            <div className="mc-off">
              <p>{m.unreachableSince ? `Last seen ${m.unreachableSince}.` : 'It isn\'t answering now.'} Its facts show again once it answers.</p>
              {linkWhy && <p>{linkWhy}</p>}
            </div>
          ) : (
            <>
              <div className="mc-grp">
                <h4>Health{read && <span>{read}</span>}</h4>
                <div className="mc-gauges">
                  {gauges(m).map((g) => <GaugeView key={g.key} g={g} limit={limits.find((l) => l.name === g.name)} />)}
                </div>
              </div>
              {(s || work) && (
                <div className="mc-grp">
                  <h4>System</h4>
                  <dl className="mc-facts">
                    {foldable && <Fact k="Role">{role}</Fact>}
                    {s?.os && <Fact k="OS">{s.os}{s.arch ? <span className="mc-fx"> · {s.arch}</span> : null}</Fact>}
                    {up && <Fact k="Up">{up}</Fact>}
                    {typeof s?.restart === 'boolean' && <Fact k="Restart" warn={s.restart}>{s.restart ? 'Needed to finish updates' : 'Not needed'}</Fact>}
                    {s?.shepherdr && <Fact k="Shepherdr" warn={older(s.shepherdr, there?.shepherdr)}>{s.shepherdr}{older(s.shepherdr, there?.shepherdr) ? ` · ${serving!.name} has ${there!.shepherdr}` : ''}</Fact>}
                    {s?.hc && <Fact k="herdr-core" warn={older(s.hc, there?.hc)}>{s.hc}{older(s.hc, there?.hc) ? ` · ${serving!.name} has ${there!.hc}` : ''}</Fact>}
                    <Fact k="Agents">{agents} running{working ? `, ${working} ${working === 1 ? 'task' : 'tasks'} working` : ''}</Fact>
                  </dl>
                </div>
              )}
            </>
          )}
          {actions && <div className="acts mc-acts">{actions}</div>}
        </div>
      )}
    </section>
  )
}
