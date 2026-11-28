// A machine's card in Settings › Machines (dmalis/shepherdr#107), laid out as macOS's About This Mac and Activity
// Monitor, iOS's General › About and iPhone Storage, and Tailscale's machine list. Its header is a status row you can
// read at a glance, as Vercel's and Linear's status rows, GitHub's runners list and Grafana's stat tiles: the name, a
// status dot with words, its role and work, and the three numbers (CPU, Memory, Disk), each with a small bar that
// carries its start limit and turns amber past it. Then Health (each meter's bar and one short line of amounts), System
// (OS, uptime, restart, versions) and its actions. On a phone each card folds to that header and opens in place on a
// tap (ARIA's accordion: a heading holding its button); the three numbers show folded or open, at every width.
import { useState, type ReactNode } from 'react'
import type { Machine } from '@shared/types.ts'
import { attention, gauges, STATUS_WORDS, statusOf, upOf, compareVersions, type Gauge } from '@shared/machine-facts.ts'
import { cx, I } from './ui.tsx'
import './machine-card.css'

export interface CardLimit { name: string; value: string; off: boolean }

/** a bar, how full, with its start limit marked on it; amber once over that limit or the alert one (as upstream's meter) */
export function LimitBar({ pct, level, limit, small }: { pct: number | undefined; level: Gauge['level']; limit?: number; small?: boolean }) {
  // a processor limit past 100% (load over the cores, up to 400%): the bar reaches to it, so its mark still shows
  const on = typeof limit === 'number' && limit > 0, top = on ? Math.max(100, limit) : 100
  const w = Math.max(0, Math.min(100, ((pct ?? 0) * 100) / top))
  const at = on ? Math.round((limit * 1000) / top) / 10 : 0
  return (
    <span className={cx('mc-bar', small && 'sm', level !== 'ok' && level)} aria-hidden="true">
      <i style={{ ['--w' as string]: `${Math.round(w * 10) / 10}%` }} />
      {on && <b style={{ ['--at' as string]: `${at}%` }} />}
    </span>
  )
}

const LEVEL_WORDS = { busy: 'New tasks wait', over: 'Over its alert limit' } as const

/** a start limit as a number the bar can mark, or none when it's off or unknown */
const limitAt = (l?: CardLimit) => (l && !l.off && Number.isFinite(parseFloat(l.value)) ? parseFloat(l.value) : undefined)
const pctWords = (g: Gauge) => (g.pct === undefined ? '–' : `${Math.round(g.pct)}%`)

/** one of the header's three: its name, its share and a small bar; its level said in words for screen readers too */
function Glance({ g, limit }: { g: Gauge; limit?: CardLimit }) {
  return (
    <span className={cx('mc-m', g.level !== 'ok' && g.level)}>
      {/* said as one phrase ("Memory 44%, new tasks wait."), as the button's description; the two shown parts stay quiet */}
      <span className="mc-sr">{`${g.short} ${pctWords(g)}${g.level !== 'ok' ? `, ${LEVEL_WORDS[g.level].toLowerCase()}` : ''}. `}</span>
      <span className="mc-ml" aria-hidden="true">{g.short}</span>
      <span className="num" aria-hidden="true">{pctWords(g)}</span>
      <LimitBar small pct={g.pct} level={g.level} limit={limitAt(limit)} />
    </span>
  )
}

/** Health's row for one meter, under the header's three: its amounts in a short line (a line per disk), what its level
 *  means once it matters, and its start limit for screen readers (the header's bar marks it) */
function HealthRow({ g, limit }: { g: Gauge; limit?: CardLimit }) {
  const at = limitAt(limit)
  return (
    <div className="mc-f">
      <dt>{g.short}</dt>
      <dd>
        {g.lines.map((l) => <span key={l}>{l}</span>)}
        {g.level !== 'ok' && <span className={`c-${g.level}`}>{LEVEL_WORDS[g.level]}</span>}
        {at !== undefined && <span className="mc-sr">Start limit {limit!.value}</span>}
      </dd>
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
  const gs = gauges(m)
  const limitOf = (g: Gauge) => limits.find((l) => l.name === g.name)
  // its work, once, in the header: "12 agents · 10 working"
  const work = st === 'off' ? '' : `${agents} ${agents === 1 ? 'agent' : 'agents'}${working ? ` · ${working} working` : ''}`
  const glance = st !== 'off' && gs.some((g) => g.pct !== undefined)
  const id = m.id.replace(/[^\w-]/g, '_'), bodyId = `mc-${id}`
  const head = (
    <>
      <span className={cx('mc-dot', st)} aria-hidden="true" />
      <span className="nm" id={`${bodyId}-n`}>{m.name}</span>
      <span className="mc-end">
        <span className="mc-hst" id={`${bodyId}-s`}>{STATUS_WORDS[st]}</span>
        {foldable && <I n="down" c={cx('mc-chev', open && 'up')} />}
      </span>
      <span className="mc-h2">{[role, work].filter(Boolean).join(' · ')}</span>
      {glance && <span className="mc-ms" id={`${bodyId}-m`}>{gs.map((g) => <Glance key={g.key} g={g} limit={limitOf(g)} />)}</span>}
    </>
  )
  return (
    <section className={cx('mcard', 'mc', st)} aria-label={m.name}>
      {foldable ? (
        // its name is the machine and its status; its three numbers are its description, said on focus while folded
        <h3 className="mc-hh"><button type="button" className="mc-h" aria-expanded={open} aria-controls={bodyId} aria-labelledby={`${bodyId}-n ${bodyId}-s`}
          aria-describedby={glance ? `${bodyId}-m` : undefined}
          onClick={() => setOpen(!open)}>{head}</button></h3>
      ) : (
        <h3 className="mc-hh"><div className="mc-h">{head}</div></h3>
      )}
      {/* folded: kept in the page, hidden, so its button's aria-controls always names it */}
      <div className="mc-body" id={bodyId} hidden={!shown}>
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
              {/* no amounts yet: its heading still says when it was read, or that it couldn't be */}
              {(gs.some((g) => g.lines.length) || read) && (
                <div className="mc-grp">
                  <h4>Health{read && <span>{read}</span>}</h4>
                  {gs.some((g) => g.lines.length) && (
                    <dl className="mc-facts mc-health">
                      {gs.filter((g) => g.lines.length).map((g) => <HealthRow key={g.key} g={g} limit={limitOf(g)} />)}
                    </dl>
                  )}
                </div>
              )}
              {s && (
                <div className="mc-grp">
                  <h4>System</h4>
                  <dl className="mc-facts">
                    {s.os && <Fact k="OS">{s.os}{s.arch ? <span className="mc-fx"> · {s.arch}</span> : null}</Fact>}
                    {up && <Fact k="Up">{up}</Fact>}
                    {typeof s.restart === 'boolean' && <Fact k="Restart" warn={s.restart}>{s.restart ? 'Needed to finish updates' : 'Not needed'}</Fact>}
                    {s.shepherdr && <Fact k="Shepherdr" warn={older(s.shepherdr, there?.shepherdr)}>{s.shepherdr}{older(s.shepherdr, there?.shepherdr) ? ` · ${serving!.name} has ${there!.shepherdr}` : ''}</Fact>}
                    {s.hc && <Fact k="herdr-core" warn={older(s.hc, there?.hc)}>{s.hc}{older(s.hc, there?.hc) ? ` · ${serving!.name} has ${there!.hc}` : ''}</Fact>}
                  </dl>
                </div>
              )}
            </>
          )}
          {actions && <div className="acts mc-acts">{actions}</div>}
      </div>
    </section>
  )
}
