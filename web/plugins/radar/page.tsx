// Radar's page (the clickable prototype, dmalis/shepherdr "Radar: one place for work coming in"). It comes when first
// opened (client.tsx). A prototype-only bar on top, folded, picks one of four opening screens on the same day and the
// clock (now, or a week later, when parked ideas come back). The default is the calm timeline (timeline.tsx): one
// feed, no tabs, only a project filter and Jot something. The other three (Since you last looked, Pain map, Project
// pulse) stay for comparison, each over the same four views: the opening screen, Next up (Held back under it), All
// items and Shipped, as Linear's Triage, Sentry's For review and Renovate's dependency dashboard lay theirs out. An item opens beside the list on a
// wide page and over it on a narrow one or a phone, as Linear's and GitHub's inboxes do. Every click changes this
// page's copy only (model.ts); the one real card is the error's Triage card in #shop, the same one Needs you opens.
import { useState, type ReactNode } from 'react'
import { act, notice, openLink, setUI, useSnap, useUI } from '@client/kernel.ts'
import { openForm, openMenu } from '@client/overlay.tsx'
import { PaneFrame } from '@client/App.tsx'
import { Btn, cx, Empty, Hd, I, IB } from '@client/ui.tsx'
import { clearPress } from '@client/pending.ts'
import { NeedsCount, openNeeds } from '@client/needs-count.tsx'
import { attentionOf } from '@shared/attention.ts'
import type { IconName } from '@client/icons.ts'
import type { Snapshot } from '@shared/types.ts'
import { liveOf, radarNeeds, radarOf } from './row.tsx'
import { addItem, askCards, clock, dayOf, shownDay, edit, editProject, getView, itemsAt, needsYou, open, reset, resume, setView, useRadar, waiting, waitingWords, type Filter, type Live, type Opening, type RadarDemo, type RadarItem, type RadarProject, type Tab, type View } from './model.ts'
import { APPROVED, levelWords, PREVIEW, queue, SOURCE, stateWords, when, WORKFLOWS } from './say.ts'
import { Timeline } from './timeline.tsx'
import './radar.css'

const DAY = 86400_000
const OPENINGS: [Opening, string][] = [['timeline', 'Calm timeline'], ['since', 'Since you last looked'], ['pain', 'Pain map'], ['pulse', 'Project pulse']]
const TABS: [Tab, string][] = [['overview', 'Overview'], ['next', 'Next up'], ['all', 'All items'], ['shipped', 'Shipped']]
const PROTO = '(prototype: nothing was really started or posted)'
/** a toast-only action's notice: what it would do, and that nothing did */
const preview = (would: string) => notice(`${PREVIEW}: ${would}. Nothing was opened or run.`, { tone: 'ok' })
/** a toast-only action's button: its name, then "Demo preview", quieter */
const PreviewBtn = ({ children, onClick, small }: { children: ReactNode; onClick: () => void; small?: boolean }) => (
  <Btn small={small} onClick={onClick}>{children}<span className="rd-pv">{PREVIEW}</span></Btn>
)

interface Ctx { snap: Snapshot; day: RadarDemo; view: View; live: Live; now: number; items: RadarItem[]; projects: RadarProject[] }

/** a few choices side by side, by key (the app's .seg) */
function Pick<T extends string>({ values, value, onChange, label }: { values: [T, string][]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg rd-seg" role="group" aria-label={label}>
      {values.map(([k, w]) => <button type="button" key={k} aria-pressed={value === k} onClick={() => onChange(k)}>{w}</button>)}
    </div>
  )
}

const projectOf = (c: Ctx, id: string) => c.day.projects.find((p) => p.id === id)!
const openItemHere = (id: string) => setView({ item: id })
/** where an opened project or item lands: the calm timeline has no tabs, so it stays on it; the others open All items */
const listTab = (): Partial<View> => (getView().opening === 'timeline' ? { tab: 'overview' } : { tab: 'all' })

/* ---------- the prototype's own bar ---------- */

/** Start over: this page's copy, and the shared card in #shop and Needs you, back as the day came */
function startOver() {
  const cards = askCards()
  reset()
  // the card comes back the same (its id and words): forget the Yes or No pressed on it, so it can be answered again
  void act({ type: 'radar', do: 'reset' }).catch(() => undefined).finally(() => cards.forEach(clearPress))
}

/** the prototype's controls, folded behind one button until opened (so the page keeps its first screen); the button
 *  says what is picked */
function Proto({ view }: { view: View }) {
  const shown = view.proto
  const picked = [OPENINGS.find(([o]) => o === view.opening)![1], view.later ? 'A week later' : 'Today', view.fresh ? 'A new install' : ''].filter(Boolean).join(' · ')
  return (
    <section className={cx('rd-proto', shown && 'on')} aria-label="Prototype controls">
      <button type="button" className="rd-ptog" aria-expanded={shown} aria-controls="rd-pbody" onClick={() => setView({ proto: !shown })}>
        <span className="rd-tag">Prototype</span>
        <span className="rd-psum">{picked}</span>
        <I n={shown ? 'up' : 'down'} />
      </button>
      {shown && (
        <div className="rd-pbody" id="rd-pbody">
          <div className="rd-pr">
            <span className="rd-pl">Opening screen</span>
            <Pick label="Opening screen" values={OPENINGS} value={view.opening} onChange={(opening) => setView({ opening, tab: 'overview', item: null })} />
          </div>
          <div className="rd-pr">
            <span className="rd-pl">Clock</span>
            <Pick label="Clock" values={[['now', 'Today'], ['later', 'A week later']]} value={view.later ? 'later' : 'now'} onChange={(v) => setView({ later: v === 'later' })} />
          </div>
          <div className="rd-pr">
            <span className="rd-pl">Fixture</span>
            <Pick label="Fixture" values={[['day', 'Today’s day'], ['fresh', 'A new install']]} value={view.fresh ? 'fresh' : 'day'} onChange={(v) => setView({ fresh: v === 'fresh', tab: 'overview', project: null, item: null })} />
            <Btn small onClick={startOver}>Start over</Btn>
          </div>
        </div>
      )}
    </section>
  )
}

/* ---------- rows ---------- */

function mark(i: RadarItem, live: Live): { icon: IconName; c?: string } {
  if (needsYou(i, live)) return { icon: 'ask', c: 'need' }
  if (i.approved || i.state === 'running') return { icon: 'working', c: 'warm' }
  if (i.state === 'held') return { icon: 'pause' }
  if (i.state === 'shipped') return i.shipped?.how === 'reverted' ? { icon: 'reload', c: 'warm' } : i.shipped?.how === 'merged' ? { icon: 'merged' } : { icon: 'check', c: 'ok' }
  if (i.state === 'later') return { icon: 'clock' }
  if (i.kind === 'error') return { icon: 'warn' }
  if (i.kind === 'idea') return { icon: 'note' }
  if (i.kind === 'release') return { icon: 'download' }
  return { icon: 'feedback' }
}

/** a short second line: how many hit it, where from */
function subOf(i: RadarItem, c: Ctx, withProject: boolean): string {
  const bits = [
    withProject ? projectOf(c, i.project).name : '',
    i.events ?? (i.tasks ? `${i.tasks} ${i.tasks === 1 ? 'task' : 'tasks'} hit it` : ''),
    i.trend === 'rising' ? 'rising' : '',
    i.sources.map((s) => SOURCE[s]).join(', '),
  ]
  return bits.filter(Boolean).join(' · ')
}

function ItemRow({ i, c, n, sub }: { i: RadarItem; c: Ctx; n?: number; sub?: string }) {
  const m = mark(i, c.live)
  const all = !c.view.project
  const red = needsYou(i, c.live)
  return (
    <li>
      <button type="button" className={cx('rd-row', c.view.item === i.id && 'on')} aria-current={c.view.item === i.id || undefined} onClick={() => openItemHere(i.id)}>
        {n != null ? <span className="rd-n num" aria-hidden="true">{n}</span> : <span className={cx('rd-m', m.c)}><I n={m.icon} /></span>}
        <span className="rd-t">
          <span className="rd-l1">{i.title}</span>
          {/* a narrow page has no room at the end: the status starts the second line instead */}
          <span className="rd-l2"><span className={cx('rd-sv', red && 'need')}>{stateWords(i)} · </span>{sub ?? subOf(i, c, all)}</span>
        </span>
        <span className={cx('rd-v', red && 'need')}>{stateWords(i)}</span>
      </button>
    </li>
  )
}

const List = ({ label, children }: { label?: string; children: ReactNode }) => (
  <section className="rd-sec">
    {label && <h3 className="rd-h">{label}</h3>}
    <ul className="rd-list">{children}</ul>
  </section>
)

/* ---------- the three opening screens ---------- */

function Story({ icon, tone, lead, children, onClick }: { icon: IconName; tone?: string; lead: string; children: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="rd-story" onClick={onClick}>
        <span className={cx('rd-m', tone)}><I n={icon} /></span>
        <span className="rd-t"><b className={cx(tone === 'need' && 'need')}>{lead}</b> {children}</span>
        <I n="right" c="rd-go" />
      </button>
    </li>
  )
}

function Since({ c }: { c: Ctx }) {
  const mine = c.items.filter((i) => !c.view.project || i.project === c.view.project)
  const needs = mine.filter((i) => needsYou(i, c.live))
  const yes = mine.filter((i) => i.approved)
  const live = mine.filter((i) => i.shipped?.how === 'live' && i.shipped.after)
  const rising = mine.filter((i) => open(i) && i.trend === 'rising')
  const reverted = mine.filter((i) => i.shipped?.how === 'reverted')
  const back = mine.filter((i) => i.later?.returned && i.state === 'new')
  const paused = c.projects.filter((p) => p.paused)
  const none = c.projects.filter((p) => p.level === 'none')
  const merged = mine.filter((i) => i.shipped?.how === 'merged')
  return (
    <div className="rd-since">
      <p className="rd-intro">Since you looked {when(c.day.looked, c.now)}</p>
      <ul className="rd-stories">
        {needs.map((i) => <Story key={i.id} icon="ask" tone="need" lead={`${projectOf(c, i.project).name} needs you.`} onClick={() => openItemHere(i.id)}>{i.title}: {i.events}. One yes posts its issue and starts a fix.</Story>)}
        {yes.map((i) => <Story key={i.id} icon="working" tone="warm" lead="Your yes went through." onClick={() => openItemHere(i.id)}>{i.title}: {APPROVED}.</Story>)}
        {live.map((i) => <Story key={i.id} icon="check" tone="ok" lead="Fixed and holding." onClick={() => openItemHere(i.id)}>{i.title}. {i.shipped!.after}</Story>)}
        {rising.map((i) => <Story key={i.id} icon="up" lead="Rising." onClick={() => openItemHere(i.id)}>{i.title}: {i.tasks} tasks this week, up from 3. It’s first in line.</Story>)}
        {reverted.map((i) => <Story key={i.id} icon="reload" tone="warm" lead="Reverted." onClick={() => openItemHere(i.id)}>{i.title}. {i.shipped!.after}</Story>)}
        {merged.map((i) => <Story key={i.id} icon="merged" lead="Merged, not installed yet." onClick={() => openItemHere(i.id)}>{i.title}. Radar checks it after the next install.</Story>)}
        {back.length > 0 && <Story icon="clock" lead={back.length === 1 ? 'A parked idea came back.' : `${back.length} parked ideas came back.`} onClick={() => setView({ tab: 'all', item: back[0]!.id })}>{back.map((i) => i.title).join('; ')}.</Story>}
        {paused.map((p) => <Story key={p.id} icon="pause" lead={`${p.name} is paused`} onClick={() => setView({ project: p.id, tab: 'next', item: null })}>since {when(p.paused!, c.now)}. Nothing is read or started there{c.items.some((i) => i.project === p.id && i.draft && i.state === 'next') ? '; a finished draft waits for Resume' : ''}.</Story>)}
        {none.map((p) => <Story key={p.id} icon="plus" lead={`${p.name} isn’t watched yet.`} onClick={() => openSetup(p)}>Set it up in under a minute.</Story>)}
      </ul>
      <p className="rd-note">Reading this answers nothing: what needs you stays under Needs you until you answer it.</p>
    </div>
  )
}

/** the pain map: one row a workflow, one square a day of the last 14, darker where more tasks hit friction */
function Pain({ c }: { c: Ctx }) {
  const mine = c.items.filter((i) => (!c.view.project || i.project === c.view.project) && i.days)
  const rows = WORKFLOWS.map((w) => {
    const of = mine.filter((i) => i.workflow === w)
    const days = Array.from({ length: 14 }, (_, d) => of.reduce((n, i) => n + (i.days![d] ?? 0), 0))
    const sum = (i: RadarItem) => i.days!.reduce((a, b) => a + b, 0)
    const top = [...of].sort((a, b) => sum(b) - sum(a))[0]
    return { w, days, total: days.reduce((a, b) => a + b, 0), top }
  })
  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 3 : 4)
  const worst = [...mine].filter(open).sort((a, b) => (b.tasks ?? 0) - (a.tasks ?? 0)).slice(0, 3)
  return (
    <div className="rd-pain">
      <p className="rd-intro">Where tasks hit friction, the last 14 days</p>
      <ul className="rd-map" aria-label="Pain map">
        {rows.map((r) => (
          <li key={r.w}>
            <button type="button" className="rd-mrow" disabled={!r.top} onClick={() => r.top && openItemHere(r.top.id)} aria-label={`${r.w}: ${r.total} times in 14 days${r.top ? `, most from ${r.top.title}` : ''}`}>
              <span className="rd-mw">{r.w}</span>
              <span className="rd-cells" aria-hidden="true">{r.days.map((n, d) => <i key={d} className={`l${level(n)}`} />)}</span>
              <span className="rd-mt num">{r.total}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="rd-legend"><span aria-hidden="true" className="rd-cells"><i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /></span>Darker: more tasks hit it that day. Out of about 30 tasks a day. Today is on the right.</p>
      {worst.length > 0 && (
        <List label="Hurts most now">
          {worst.map((i) => <ItemRow key={i.id} i={i} c={c} />)}
        </List>
      )}
    </div>
  )
}

function pulseLine(p: RadarProject, c: Ctx): { line: string; warn?: string } {
  const of = c.items.filter((i) => i.project === p.id)
  if (p.level === 'none') return { line: 'Not watched yet · Set it up' }
  const week = of.filter((i) => i.shipped && i.shipped.at > c.now - 7 * DAY)
  const bits = [
    p.paused ? `Paused since ${when(p.paused, c.now)}` : '',
    of.filter((i) => needsYou(i, c.live)).length ? `${of.filter((i) => needsYou(i, c.live)).length} needs you` : '',
    week.filter((i) => i.shipped!.how === 'live').length ? `${week.filter((i) => i.shipped!.how === 'live').length} live this week` : '',
    week.filter((i) => i.shipped!.how === 'reverted').length ? `${week.filter((i) => i.shipped!.how === 'reverted').length} reverted` : '',
    of.filter(open).length ? `${of.filter(open).length} open` : '',
    p.fixes ? `${p.fixes.used} of ${p.fixes.cap} fixes today` : '',
  ].filter(Boolean)
  const stale = p.sources.find((s) => !s.ok)
  return { line: bits.join(' · ') || levelWords(p), ...(stale ? { warn: stale.words } : p.paused ? { warn: 'Silent because paused, not because all is well.' } : {}) }
}

function Pulse({ c }: { c: Ctx }) {
  return (
    <div className="rd-pulse">
      <p className="rd-intro">Each project in a line</p>
      <ul className="rd-list">
        {c.projects.map((p) => {
          const { line, warn } = pulseLine(p, c)
          const asks = c.items.filter((i) => i.project === p.id && needsYou(i, c.live))
          const red = asks.length
          // the red count is its own button and opens the card itself, as the list's red counts do; the row opens the project
          const cards = radarNeeds(c.snap, asks.map((i) => i.needs!.card))
          return (
            <li key={p.id} className="rd-rx">
              <button type="button" className="rd-row" onClick={() => (p.level === 'none' ? openSetup(p) : setView({ project: p.id, tab: 'all', item: null }))}>
                <span className={cx('rd-m', red > 0 && 'need')}><I n={p.level === 'none' ? 'plus' : p.paused ? 'pause' : red ? 'ask' : 'folder'} /></span>
                <span className="rd-t">
                  <span className="rd-l1">{p.name}</span>
                  <span className="rd-l2">{line}</span>
                  {warn && <span className="rd-l2 warn"><I n="warn" />{warn}</span>}
                </span>
              </button>
              <NeedsCount n={red} of={p.name} onOpen={() => (cards.length ? openNeeds(cards, [...new Set(cards.map((i) => i.place))]) : setView({ project: p.id, tab: 'all', item: asks[0]!.id }))} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ---------- Next up, All items, Shipped ---------- */

function Strip({ p, c }: { p: RadarProject; c: Ctx }) {
  const words = p.paused
    ? `Paused since ${when(p.paused, c.now)}`
    : p.level === 'fix'
      ? `On · ${p.fixes?.used ?? 0} of ${p.fixes?.cap ?? 1} fixes today · next check ${p.next}`
      : `${levelWords(p)} · starts no fixes · next check ${p.next}`
  return (
    <div className={cx('rd-strip', !!p.paused && 'paused')}>
      <span className="rd-sw"><b>{p.name}</b> {words}</span>
      {p.level !== 'none' && (
        <Btn small onClick={() => {
          if (!p.paused) {
            editProject(p.id, { paused: c.now })
            notice(`${p.name} paused`, { tone: 'ok' })
            return
          }
          // its finished draft posts now, as the paused line promised
          const posted = resume(p.id)
          notice(posted.length ? `${p.name} resumed · its draft posted as ${posted.join(', ')}` : `${p.name} resumed`, { tone: 'ok' })
        }}>
          <I n={p.paused ? 'play' : 'pause'} />
          {p.paused ? 'Resume' : 'Pause'}
        </Btn>
      )}
    </div>
  )
}

/** a paused project: what stops, what keeps running, and what waits for Resume */
function PausedNote({ p, c }: { p: RadarProject; c: Ctx }) {
  const running = c.items.filter((i) => i.project === p.id && i.state === 'running')
  const next = queue(c.items, p.id).filter((i) => i.state === 'next')
  const draft = next.find((i) => i.draft)
  return (
    <div className="rd-paused">
      <p><b>What stops:</b> reading issues and findings, scoring, posting, and new fixes. Nothing merges or installs on its own.</p>
      {running.length > 0 && <p><b>Still running:</b> {running.map((i) => `“${i.task}”`).join(', ')} finishes its work, then waits for your review.</p>}
      {draft ? <p><b>Waits for Resume:</b> “{draft.title}”, its issue draft finished before the pause. It posts once you Resume; nothing is posted until then.</p>
        : next[0] && <p><b>Waits for Resume:</b> “{next[0].title}” would start next. Nothing new starts until you Resume.</p>}
    </div>
  )
}

/** a project opened from the calm timeline (its "paused" line): how it runs, Pause or Resume, and what a pause holds */
function ProjectDetail({ p, c, narrow }: { p: RadarProject; c: Ctx; narrow: boolean }) {
  return (
    <article className="rd-detail" aria-labelledby="rd-dt">
      <div className="rd-dh">
        <span className="rd-st">{levelWords(p)}</span>
        {!narrow && <IB icon="x" label="Close" onClick={() => setView({ item: null })} />}
      </div>
      <h2 id="rd-dt" className="rd-title">{p.name}</h2>
      <p className="rd-meta">{[p.repo, `${p.folder} on ${p.machine}`].filter(Boolean).join(' · ')}</p>
      <Strip p={p} c={c} />
      {p.paused && <PausedNote p={p} c={c} />}
    </article>
  )
}

function NextUp({ c }: { c: Ctx }) {
  const ps = c.projects.filter((p) => p.level !== 'none' && (!c.view.project || p.id === c.view.project))
  if (!ps.length) {
    // nothing watched in what is shown (a new install, or a project not set up): offer to set one up
    const none = c.view.project ? projectOf(c, c.view.project) : c.projects.find((p) => p.level === 'none')
    return none ? <SetupEmpty p={none} /> : <Empty title="Nothing is watched yet">Pick a project to watch, and its queue shows here.</Empty>
  }
  return (
    <div className="rd-next">
      {ps.map((p) => {
        const q = queue(c.items, p.id)
        const running = c.items.filter((i) => i.project === p.id && i.state === 'running')
        const next = q.filter((i) => i.state === 'next'), held = q.filter((i) => i.state === 'held')
        // today's fixes all used: the first in line says when it can start, not only why it is first
        const full = !p.paused && p.level === 'fix' && !!p.fixes && p.fixes.used >= p.fixes.cap
        const first = (i: RadarItem) => (full ? `First eligible after the cap resets${running.length ? ' and the running fix finishes' : ''}.` : i.reason)
        return (
          <section key={p.id} className="rd-proj">
            <Strip p={p} c={c} />
            {p.paused && <PausedNote p={p} c={c} />}
            {running.length > 0 && <List label="Being fixed">{running.map((i) => <ItemRow key={i.id} i={i} c={c} sub={`Task: ${i.task}`} />)}</List>}
            {next.length > 0 && <List label={p.paused ? 'Next, once resumed' : 'Next'}>{next.map((i, n) => <ItemRow key={i.id} i={i} c={c} n={n + 1} sub={n === 0 ? first(i) : undefined} />)}</List>}
            {held.length > 0 && <List label="Held back">{held.map((i) => <ItemRow key={i.id} i={i} c={c} sub={i.held!.words} />)}</List>}
            {!running.length && !q.length && <p className="rd-note">Nothing queued here. New findings and issues land in All items first.</p>}
          </section>
        )
      })}
    </div>
  )
}

function AllItems({ c }: { c: Ctx }) {
  const f = c.view.filter
  const p = c.view.project ? projectOf(c, c.view.project) : null
  if (p?.level === 'none') return <SetupEmpty p={p} />
  const mine = c.items.filter((i) => !p || i.project === p.id)
  const order: RadarItem['state'][] = ['new', 'next', 'held', 'running']
  const fits = (i: RadarItem, x: Filter) => (x === 'open' ? order.includes(i.state) : x === 'waiting' ? waiting(i, c.day) : i.state === x)
  const rows = mine
    .filter((i) => fits(i, f))
    .sort((a, b) => Number(needsYou(b, c.live)) - Number(needsYou(a, c.live)) || order.indexOf(a.state) - order.indexOf(b.state))
  const count = (x: Filter) => mine.filter((i) => fits(i, x)).length
  return (
    <div className="rd-all">
      <div className="rd-tools">
        <Pick label="Show" values={[['open', `Open ${count('open')}`], ['waiting', `New or next up ${count('waiting')}`], ['later', `Parked ${count('later')}`], ['declined', `Not doing ${count('declined')}`]]} value={f} onChange={(filter) => setView({ filter, item: null })} />
      </div>
      {/* the row's grey count opens this: say what it counts, and what it leaves out */}
      {f === 'waiting' && !p && rows.length > 0 && <p className="rd-note">What the Radar row’s grey count counts: {waitingWords(rows.length)}, what could become work now. Held back items wait on something else, and a paused project’s wait for Resume, so they aren’t counted.</p>}
      {rows.length ? <ul className="rd-list">{rows.map((i) => <ItemRow key={i.id} i={i} c={c} />)}</ul> : <Empty title={f === 'later' ? 'Nothing parked' : f === 'declined' ? 'Nothing here' : 'Nothing waits here'}>{f === 'open' ? 'New findings and issues show here first. Jot something to keep an idea.' : ''}</Empty>}
    </div>
  )
}

function Shipped({ c }: { c: Ctx }) {
  const mine = c.items.filter((i) => i.state === 'shipped' && (!c.view.project || i.project === c.view.project))
  const live = mine.filter((i) => i.shipped!.how === 'live'), merged = mine.filter((i) => i.shipped!.how === 'merged'), rev = mine.filter((i) => i.shipped!.how === 'reverted')
  if (!mine.length) return <Empty title="Nothing shipped yet">What a fix reached shows here once it is installed and checked.</Empty>
  const sub = (i: RadarItem) => [c.view.project ? '' : projectOf(c, i.project).name, i.shipped!.words].filter(Boolean).join(' · ')
  return (
    <div className="rd-ship">
      <p className="rd-intro">This week: {live.length} live and checked · {merged.length} merged, not installed · {rev.length} reverted</p>
      {merged.length > 0 && <List label="Merged, waiting for an install">{merged.map((i) => <ItemRow key={i.id} i={i} c={c} sub={sub(i)} />)}</List>}
      {rev.length > 0 && <List label="Reverted">{rev.map((i) => <ItemRow key={i.id} i={i} c={c} sub={sub(i)} />)}</List>}
      <List label="Live and checked">{live.map((i) => <ItemRow key={i.id} i={i} c={c} sub={sub(i)} />)}</List>
    </div>
  )
}

/* ---------- an item ---------- */

function laterMenu(anchor: Element, i: RadarItem, now: number) {
  const park = (days: number, trigger: string, returned: string, soon?: number) => () => {
    edit(i.id, { state: 'later', changed: now, later: { until: now + days * DAY, trigger, returned, ...(soon ? { soon: now + soon * DAY } : {}) } })
    setView({ item: null })
    notice('Parked. It comes back by itself.', { tone: 'ok', act: { label: 'Undo', run: () => edit(i.id, { state: i.state, later: i.later, changed: i.changed }) } })
  }
  openMenu(anchor, [
    { icon: 'clock', label: 'For a week', run: park(7, 'Back in a week', 'Came back: the week you set is up.') },
    { icon: 'clock', label: 'For 30 days, or sooner if 3 more report it', run: park(30, 'Back in 30 days, or sooner if 3 more report it', 'Came back early: 3 more tasks reported it since you parked it.', 5) },
    { icon: 'clock', label: 'Until the next release', run: park(10, 'Back with the next release', 'Came back: the next release is out.') },
  ], { label: 'Park it' })
}

function Steps({ steps }: { steps: [string, 'done' | 'now' | 'next' | 'back'][] }) {
  return (
    <ol className="rd-steps">
      {steps.map(([w, s]) => <li key={w} className={s}><I n={s === 'done' ? 'check' : s === 'now' ? 'working' : s === 'back' ? 'reload' : 'square'} /><span>{w}{s === 'now' ? ' (now)' : ''}</span></li>)}
    </ol>
  )
}

function Detail({ i, c, narrow }: { i: RadarItem; c: Ctx; narrow: boolean }) {
  const p = projectOf(c, i.project)
  const red = needsYou(i, c.live)
  // the card where it waits: the app's own link to it, as a tap in Needs you opens it
  const need = red ? attentionOf(c.snap).actions.find((a) => a.card === i.needs!.card) : undefined
  const [all, setAll] = useState(false)
  const shown = (all ? i.sightings : i.sightings?.slice(0, 5)) ?? []
  const change = (patch: Partial<RadarItem>, words: string, undo = true) => {
    const was = { state: i.state, task: i.task, later: i.later, changed: i.changed }
    edit(i.id, { changed: c.now, ...patch })
    notice(words, { tone: 'ok', ...(undo ? { act: { label: 'Undo', run: () => edit(i.id, was) } } : {}) })
  }
  // only a project that starts fixes, not paused, offers one; never a release (the sync takes those) or a held item
  const fixable = !p.paused && p.level === 'fix' && !i.held && i.kind !== 'release'
  return (
    <article className="rd-detail" aria-labelledby="rd-dt">
      <div className="rd-dh">
        <span className={cx('rd-st', red && 'need')}>{stateWords(i)}</span>
        {!narrow && <IB icon="x" label="Close" onClick={() => setView({ item: null })} />}
      </div>
      <h2 id="rd-dt" className="rd-title">{i.title}</h2>
      {/* the list's longer line: the project, how many hit it, rising, where from */}
      <p className="rd-meta">{subOf(i, c, true)}</p>

      {red && (
        <section className="card rd-card">
          <b>{i.needs!.ask}</b>
          <span className="rd-q">{i.needs!.after}</span>
          <span className="rd-q">Its exact words wait on its card in #{p.name}’s chat, the same card Needs you opens.</span>
          <div className="acts"><Btn kind="pri" onClick={() => need && openLink(`./?${new URLSearchParams({ place: need.place, focus: need.card! })}`, true)}>Open the card</Btn></div>
        </section>
      )}
      {i.approved && (
        <section className="rd-blk">
          <h3 className="rd-h">What happens now</h3>
          <Steps steps={[['You said yes on its card', 'done'], [`Posted to ${p.repo} as written`, 'done'], [`A fix is being built: “${i.task}”`, 'now'], ['You review and merge it', 'next'], ['Installed, then Radar checks the error stops', 'next']]} />
        </section>
      )}
      {i.held && i.state === 'held' && (
        <section className="rd-blk">
          <h3 className="rd-h">Why it’s held</h3>
          <p>{i.held.words}</p>
          <p className="rd-q">{i.held.mover}</p>
          {!(p.paused && i.held.why === 'cap') && (
            <div className="rd-acts">
              {i.held.why === 'cap'
                ? <Btn small kind="pri" onClick={() => change({ state: 'running', task: 'Fix: ' + i.title }, `Fix started ${PROTO}`)}>{i.held.act}</Btn>
                : <PreviewBtn small onClick={() => preview(i.held!.why === 'stale' ? 'this would ask the release list again' : 'this would open the task “Main is red”')}>{i.held.act}</PreviewBtn>}
            </div>
          )}
        </section>
      )}
      {i.shipped && (
        <section className="rd-blk">
          <h3 className="rd-h">{i.shipped.how === 'live' ? 'Live and checked' : i.shipped.how === 'merged' ? 'Merged, not installed yet' : 'Reverted'}</h3>
          <p>{i.shipped.words}</p>
          {i.shipped.after && <p className="rd-q">{i.shipped.after}</p>}
          <Steps steps={i.shipped.how === 'live' ? [['Merged', 'done'], ['Installed', 'done'], ['Checked healthy', 'done']] : i.shipped.how === 'merged' ? [['Merged', 'done'], ['Installed', 'next'], ['Checked', 'next']] : [['Merged', 'done'], ['Installed', 'done'], ['Reverted, open again', 'back']]} />
        </section>
      )}
      {i.later && (i.state === 'later' || i.later.returned) && (
        <section className="rd-blk">
          <h3 className="rd-h">{i.state === 'later' ? 'Parked' : 'Came back'}</h3>
          <p>{i.state === 'later' ? i.later.trigger : i.later.returned}</p>
        </section>
      )}

      {!i.held && !i.shipped && !(i.later && i.state === 'later') && i.reason !== i.later?.returned && (
        <section className="rd-blk">
          <h3 className="rd-h">{i.state === 'next' ? 'Why it’s next' : 'Why it’s here'}</h3>
          <p>{i.reason}</p>
        </section>
      )}

      {i.days && (
        <section className="rd-blk">
          <h3 className="rd-h">The last 14 days</h3>
          <span className="rd-cells big" aria-label={`${i.days.reduce((a, b) => a + b, 0)} times in 14 days`}>{i.days.map((n, d) => <i key={d} className={`l${Math.min(4, n)}`} />)}</span>
        </section>
      )}

      {shown.length > 0 && (
        <section className="rd-blk">
          <h3 className="rd-h">{i.tasks} {i.tasks === 1 ? 'task' : 'tasks'} hit it, {i.sightings!.length} times</h3>
          <p className="rd-q">One problem, so one fix: each sighting is a task that ran into it, kept with what it saw.</p>
          <ul className="rd-sights">
            {shown.map((s, k) => <li key={k}><b>{s.who}</b><span>{s.note}</span><time className="num">{when(s.at, c.now)}</time></li>)}
          </ul>
          {i.sightings!.length > shown.length && <div><Btn small onClick={() => setAll(true)}>Show all {i.sightings!.length}</Btn></div>}
        </section>
      )}

      <div className="rd-acts">
        {(i.state === 'new' || i.state === 'next' || i.state === 'held') && !red && (
          <>
            {fixable && <Btn kind="pri" onClick={() => change({ state: 'running', task: 'Fix: ' + i.title }, `Fix started ${PROTO}`)}>Fix now</Btn>}
            <Btn onClick={(e) => laterMenu(e.currentTarget, i, c.now)}>Park it…</Btn>
            <Btn onClick={() => { change({ state: 'declined' }, 'Moved to Not doing'); setView({ item: null }) }}>Not doing</Btn>
          </>
        )}
        {(i.state === 'later' || i.state === 'declined') && <Btn onClick={() => change({ state: 'new', later: undefined }, 'Back in Open')}>Bring it back</Btn>}
        {i.state === 'running' && !i.approved && <PreviewBtn onClick={() => preview(`this would open “${i.task}”`)}>Open the task</PreviewBtn>}
        <PreviewBtn onClick={() => preview(`this would open a chat about it in #${p.name}`)}><I n="chat" />Ask about this</PreviewBtn>
      </div>
    </article>
  )
}

/* ---------- setup and Jot something ---------- */

function SetupEmpty({ p }: { p: RadarProject }) {
  return <Empty title={`${p.name} isn’t watched yet`} act={{ label: 'Set it up', run: () => openSetup(p) }}>Radar reads its issues and what its agents find. Nothing is posted or started until you say so.</Empty>
}

function openSetup(p: RadarProject) {
  openForm(({ close }) => {
    const [lv, setLv] = useState<'watch' | 'score'>('watch')
    return (
      <div className="rd-form">
        <h2>Watch {p.name}</h2>
        <dl className="rd-dl">
          <dt>Folder</dt><dd>{p.folder} on {p.machine}</dd>
          <dt>Issues from</dt><dd>{p.repo}, from the folder’s GitHub remote</dd>
        </dl>
        <fieldset className="rd-radio">
          <legend>How far Radar goes</legend>
          <label><input type="radio" name="rd-lv" checked={lv === 'watch'} onChange={() => setLv('watch')} /><span><b>Watch</b><small>Reads issues and what its agents find. Posts nothing, starts nothing.</small></span></label>
          <label><input type="radio" name="rd-lv" checked={lv === 'score'} onChange={() => setLv('score')} /><span><b>Watch and score</b><small>Also scores each issue from 1 to 5 and labels it on GitHub.</small></span></label>
        </fieldset>
        <div className="rd-opt"><span><b>Errors</b><small>Connect an error tracker later, with a read-only key of your own.</small></span></div>
        <p className="rd-q">Starting fixes on its own is a separate choice, later, one a day to begin with.</p>
        <div className="acts">
          <Btn onClick={close}>Cancel</Btn>
          <Btn kind="pri" onClick={() => {
            editProject(p.id, { level: lv, next: '15:00', sources: [{ name: 'Agents', ok: true, words: 'Agents’ findings, read just now' }, { name: 'GitHub', ok: true, words: 'Issues, read just now' }] })
            setView({ project: p.id, ...listTab(), item: null })
            close()
            notice(`Watching ${p.name}`, { tone: 'ok' })
          }}>Start watching</Btn>
        </div>
      </div>
    )
  }, { label: `Watch ${p.name}` })
}

function openJot(c: Ctx) {
  const choices = c.projects
  openForm(({ close }) => {
    const [text, setText] = useState('')
    // the project shown, else the first one there is (a new install has only its own)
    const [pid, setPid] = useState(c.view.project ?? choices[0]!.id)
    const p = choices.find((x) => x.id === pid) ?? choices[0]!
    return (
      <div className="rd-form">
        <h2>Jot something</h2>
        <label className="rd-fl">
          <span>For</span>
          <select className="inp" value={pid} onChange={(e) => setPid(e.target.value)}>{choices.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </label>
        <label className="rd-fl">
          <span>The idea or problem</span>
          <textarea className="inp rd-ta" value={text} onChange={(e) => setText(e.target.value)} placeholder="What should be better?" />
        </label>
        <p className="rd-priv"><I n="key" />Kept on this machine only. Nothing goes public. If you pick it later, it becomes an issue in {p.repo}, and you see its exact words first.</p>
        <div className="acts">
          <Btn onClick={close}>Cancel</Btn>
          <Btn kind="pri" disabled={!text.trim()} onClick={() => {
            const id = `r-jot${Date.now()}`
            addItem({ id, project: pid, kind: 'idea', title: text.trim(), changed: c.now, sources: ['you'], state: 'new', reason: 'You jotted this. It waits here, private, until you pick it, park it or say no.' })
            close()
            notice(`Saved to Radar · ${p.name}`, { tone: 'ok', act: { label: 'Open', run: () => setView({ project: pid, ...listTab(), item: id }) } })
          }}>Save</Btn>
        </div>
      </div>
    )
  }, { label: 'Jot something' })
}

function projectMenu(anchor: Element, c: Ctx) {
  openMenu(anchor, [
    { label: 'All projects', on: !c.view.project, run: () => setView({ project: null, item: null }) },
    ...c.projects.map((p) => ({ label: p.name, value: levelWords(p), on: c.view.project === p.id, run: () => setView({ project: p.id, item: null }) })),
  ], { label: 'Project' })
}

/* ---------- the page ---------- */

export function RadarPage() {
  const snap = useSnap()
  const phone = useUI((u) => u.phone)
  const { view } = useRadar()
  const day = shownDay(dayOf(radarOf(snap)), view)
  if (!snap) return null
  // the address lost the demo's ?case=radar (a reload): the prototype has no day to show
  if (!day) return <PaneFrame scrollKey="radar" head={(sc) => <Hd back={{ label: 'Back', run: () => setUI({ page: null }) }} title="Radar" scrolled={sc} />}><Empty title="Radar is a prototype">It shows only in the demo opened with ?case=radar.</Empty></PaneFrame>
  const now = clock(Date.now(), view)
  const live = liveOf(snap)
  const c: Ctx = { snap, day, view, live, now, items: itemsAt(day, now, live), projects: day.projects }
  const item = view.item ? c.items.find((i) => i.id === view.item) : undefined
  // the calm timeline's paused line opens its project
  const opened = view.item?.startsWith('p:') ? c.projects.find((p) => p.id === view.item!.slice(2)) : undefined
  const proj = view.project ? projectOf(c, view.project) : null
  // a phone shows an item over the page, with Back; a wide page beside the list
  const full = phone && !!(item || opened)
  const back = () => (full ? setView({ item: null }) : setUI({ page: null }))
  // the calm timeline is one feed: no tabs, only the project filter and Jot something
  const calm = view.opening === 'timeline' && view.tab === 'overview'
  const overview = view.opening === 'timeline'
    ? <Timeline c={c} onSetup={openSetup} setupEmpty={(p) => <SetupEmpty p={p} />} />
    : view.opening === 'since' ? <Since c={c} /> : view.opening === 'pain' ? <Pain c={c} /> : <Pulse c={c} />
  const body = view.tab === 'overview' ? overview : view.tab === 'next' ? <NextUp c={c} /> : view.tab === 'all' ? <AllItems c={c} /> : <Shipped c={c} />
  const filter = <Btn small className="rd-pp" onClick={(e) => projectMenu(e.currentTarget, c)}>{proj ? proj.name : 'All projects'}<I n="down" /></Btn>
  const jot = <Btn small onClick={() => openJot(c)}><I n="plus" />Jot something</Btn>
  return (
    <PaneFrame scrollKey="radar" head={(sc) => <Hd back={{ label: full ? 'Back to Radar' : 'Back', run: back }} title={full && item ? projectOf(c, item.project).name : 'Radar'} sub={full ? undefined : 'What might become work, before it’s a task'} scrolled={sc} />}>
      <div className={cx('rdp', (item || opened) && 'open', full && 'full')}>
        {!full && <Proto view={view} />}
        {!full && (calm
          ? <div className="rd-bar">{filter}{jot}</div>
          : (
            <div className="rd-bar">
              <Pick label="Radar views" values={TABS} value={view.tab} onChange={(tab) => setView({ tab, item: null })} />
              <div className="rd-barr">{filter}{jot}</div>
            </div>
          ))}
        <div className="rd-body">
          {!full && <div className="rd-main">{body}</div>}
          {item && <Detail key={item.id} i={item} c={c} narrow={full} />}
          {!item && opened && <ProjectDetail key={opened.id} p={opened} c={c} narrow={full} />}
        </div>
      </div>
    </PaneFrame>
  )
}
export { RadarRow } from './row.tsx'
