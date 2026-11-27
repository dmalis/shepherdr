// The Feedback page (friction loop, slice 2, #94): the box at the top, then Found, Filed, and the folded Not now and
// Said no. Rows follow Linear's Triage and GitHub's notifications: the problem first, the fix under it, one quiet line
// of where and when, then the buttons, one of them primary. Every call stays on this machine (service/feedback.ts):
// nothing here posts anywhere. Write it up sends the person's own message to the chat of the space it came from.
import { useEffect, useRef, useState } from 'react'
import { act, getState, go, notice, openSettings, setUI, useSnap, useUI } from '@client/kernel.ts'
import { openMenu } from '@client/overlay.tsx'
import { DictateButton } from '@client/dictate.tsx'
import { PaneFrame } from '@client/App.tsx'
import { Btn, Cnt, cx, Empty, Hd, I, useGrow } from '@client/ui.tsx'
import type { FeedbackList, FeedbackRow, Place, Snapshot } from '@shared/types.ts'
import { everything, isEverything, spaceLabel } from '@shared/view.ts'
import { backWords, doneWords, elsewhereWords, filedWords, fromBox, LATER, metaOf, offWords, chatOfSpace, sectionsOf, spaceOfChat, W, writeUpText } from './words.ts'

type Answer = { ok?: boolean; error?: string; off?: boolean }

/** one of the person's calls, answered (never thrown): the service's own words when it says no */
export async function call(b: Record<string, unknown>): Promise<Answer> {
  try {
    const r = await act<Answer>({ type: 'feedback', ...b })
    return r?.ok === false ? { ok: false, error: r.error || "That didn't work.", off: r.off } : { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Shepherdr couldn't be reached." }
  }
}

/** The box's Send: kept as the person's report first; the text leaves the box only once it is kept. : the open
 *  place's chat key, which names its space */
export async function saveBox(text: string, chat: string, setText: (v: string) => void): Promise<Answer> {
  const t = text.trim()
  if (!t) return { ok: false, error: 'Write what should be better first.' }
  const r = await call({ do: 'report', text: t, space: spaceOfChat(chat) })
  if (r.ok) setText('')
  return r
}

/** Not now, Never or Undo on a row; its toast offers Undo (Gmail's and Linear's pattern) */
export async function decide(r: FeedbackRow, what: 'later' | 'no' | 'undo', when?: string, expect?: 'later' | 'declined'): Promise<boolean> {
  const a = await call({ do: what, key: r.id, ...(when ? { when } : {}), ...(expect ? { expect } : {}) })
  if (!a.ok) {
    notice(a.error!, { tone: 'error' })
    return false
  }
  notice(doneWords(what, when), { tone: 'ok', ...(what === 'undo' ? {} : { act: { label: W.undo, run: () => void decide(r, 'undo', undefined, what === 'no' ? 'declined' : 'later') } }) })
  return true
}

/** where a row's space is now: its place, and whether Write it up reaches it */
export function originOf(snap: Snapshot, r: Pick<FeedbackRow, 'space' | 'noChat'>): { place?: Place; why?: 'gone' | 'away' | 'asleep' } {
  const place = r.space ? snap.places.find((p) => p.chat === chatOfSpace(r.space!)) : undefined
  if (!r.space) return {}
  if (!place || place.archived) return { why: 'gone' }
  if (place.unreachableSince || place.herdrDown) return { place, why: 'away' }
  if (r.noChat) return { place, why: 'asleep' }
  return { place }
}

/** where Write it up goes: the origin's chat, else Everything's */
export function writeUpTo(snap: Snapshot, r: Pick<FeedbackRow, 'space' | 'noChat'>): Place | undefined {
  const o = originOf(snap, r)
  return (!o.why && o.place) || everything(snap)
}

function RowView({ r, snap, now, leaving, leave }: { r: FeedbackRow; snap: Snapshot; now: number; leaving: boolean; leave: (on: boolean) => void }) {
  const [busy, setBusy] = useState('')
  const o = originOf(snap, r)
  const where = o.place ? spaceLabel(snap, o.place.id) : ''
  const run = async (which: string, f: () => Promise<boolean>, goes: boolean) => {
    setBusy(which)
    if (goes) leave(true)
    const ok = await f()
    setBusy('')
    if (!ok && goes) leave(false)
  }
  const later = (el: HTMLElement) =>
    openMenu(el, LATER.map((x) => ({ label: x.label, run: () => void run('later', () => decide(r, 'later', x.when), true) })), { label: W.notNow })
  const btns = () => {
    if (r.section === 'filed') return r.url ? <a className="btn s fb-gh" href={r.url} target="_blank" rel="noreferrer">{W.onGitHub}<I n="ext" c="s16" /></a> : null
    if (r.section === 'later') return <Btn small disabled={!!busy} onClick={() => void run('undo', () => decide(r, 'undo', undefined, 'later'), true)}>{W.restore}</Btn>
    if (r.section === 'declined') return <Btn small disabled={!!busy} onClick={() => void run('undo', () => decide(r, 'undo', undefined, 'declined'), true)}>{W.undo}</Btn>
    const never = <Btn small disabled={!!busy} onClick={() => void run('no', () => decide(r, 'no'), true)}>{W.never}</Btn>
    if (r.off) return never
    return (
      <>
        <Btn small kind="pri" disabled={!!busy} className={cx(busy === 'write' && 'going')} onClick={() => void run('write', () => sendWriteUp(snap, r), false)}>{W.writeUp}</Btn>
        <Btn small disabled={!!busy} aria-haspopup="menu" onClick={(e) => later(e.currentTarget)}>{W.notNow}<I n="down" c="s16" /></Btn>
        {never}
      </>
    )
  }
  const note = r.section === 'later' ? backWords(r.until, now)
    : r.section === 'filed' ? filedWords(r)
    : r.off ? offWords(where)
    : r.section === 'found' && o.why ? elsewhereWords(where, o.why) : ''
  return (
    <li className={cx('fb-row', leaving && 'leave')} inert={leaving || undefined}>
      <div className="fb-in">
        <p className="fb-line">{r.line}</p>
        <p className={cx('fb-fix', !r.fix && 'none')}>{r.fix ? <><span className="fb-k">Fix:</span> {r.fix}</> : W.noFix}</p>
        <p className="fb-meta">{metaOf(r, where, now)}</p>
        {note && <p className={cx('fb-note', r.off && 'off')}>{note}</p>}
        <div className="fb-acts">{btns()}</div>
      </div>
    </li>
  )
}

/** Write it up, with its toast: Open goes to the chat it went to */
async function sendWriteUp(snap: Snapshot, r: FeedbackRow): Promise<boolean> {
  const to = writeUpTo(snap, r)
  if (!to) return false
  try {
    const a = await act<Answer>({ type: 'send', chat: to.chat, text: writeUpText(r.line), human: true, cid: `fbw-${Date.now().toString(36)}` })
    if (a?.ok === false) throw new Error(a.error || "It wasn't sent.")
  } catch (e) {
    notice((e as Error).message || "It wasn't sent.", { tone: 'error' })
    return false
  }
  notice(`Sent to ${spaceLabel(snap, to.id)}`, { tone: 'ok', act: { label: W.open, run: () => go(to.id) } })
  return true
}

function Section({ id, name, rows, snap, now, fold }: { id: string; name: string; rows: FeedbackRow[]; snap: Snapshot; now: number; fold?: boolean }) {
  const [open, setOpen] = useState(!fold)
  const [gone, setGone] = useState<Set<string>>(new Set())
  // a row that left and came back (Undo in its toast) shows again: only rows still here can be leaving
  const ids = rows.map((r) => r.id).join('\n')
  useEffect(() => setGone((g) => (g.size ? new Set([...g].filter((id) => ids.split('\n').includes(id))) : g)), [ids])
  if (!rows.length) return null
  const head = `fb-h-${id}`
  return (
    <section className={cx('fb-sec', fold && 'fb-folded')} aria-labelledby={head}>
      <h2 id={head} className="fb-h">
        {fold ? (
          <button type="button" className="fb-fold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <I n={open ? 'down' : 'right'} c="s16" />
            <span>{name}</span>
            <Cnt n={rows.length} />
          </button>
        ) : (
          <><span>{name}</span><Cnt n={rows.length} /></>
        )}
      </h2>
      {open && (
        <ul className="fb-list">
          {rows.map((r) => (
            <RowView key={`${r.id}:${r.section}`} r={r} snap={snap} now={now} leaving={gone.has(r.id)}
              leave={(on) => setGone((g) => { const n = new Set(g); if (on) n.add(r.id); else n.delete(r.id); return n })} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** what the box held when the page closed: it waits there until it is sent (the composer keeps its drafts too) */
let draft = ''

function Box({ snap, place }: { snap: Snapshot; place: string }) {
  const [text, setTextNow] = useState(draft)
  const setText = (v: string) => { draft = v; setTextNow(v) }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useGrow(box, text)
  const where = isEverything(snap, place) ? 'Everything' : spaceLabel(snap, place) || 'Everything'
  const chat = snap.places.find((p) => p.id === place)?.chat ?? everything(snap)?.chat ?? ''
  const send = async () => {
    if (busy || !text.trim()) return box.current?.focus()
    setBusy(true)
    setError('')
    const sent = text.trim()
    // kept: the box empties only if it still holds what was sent (what was typed meanwhile stays)
    const r = await saveBox(text, chat, (v) => { if (draft.trim() === sent) setText(v) })
    setBusy(false)
    if (r.ok) notice(W.saved, { tone: 'ok' })
    else setError(r.off ? W.boxOff : r.error!)
  }
  return (
    <form className="fb-box" onSubmit={(e) => { e.preventDefault(); void send() }}>
      <div className="cbox">
        <textarea ref={box} className="cin fb" name="feedback" autoComplete="off" rows={2} aria-label={W.boxLabel} aria-describedby={error ? 'fb-box-err' : undefined} aria-invalid={!!error || undefined}
          placeholder={W.box} value={text} onChange={(e) => { setText(e.target.value); if (error) setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }} />
        <div className="cbar">
          <span className="fb-from">{fromBox(where)}</span>
          <span className="sp" />
          <DictateButton setText={setText} scope="feedback" />
          <Btn kind="pri" small type="submit" className={cx(busy && 'going')} aria-busy={busy || undefined}>{busy ? W.saving : W.send}</Btn>
        </div>
      </div>
      <p id="fb-box-err" className="fb-err" role="status">{error}</p>
    </form>
  )
}

/** `given`/`at`: a test's own day, drawn without the live state */
export function FeedbackPage({ now = Date.now(), snap: given, at }: { now?: number; snap?: Snapshot; at?: string }) {
  const live = useSnap()
  const ui = useUI()
  const snap = given ?? live
  if (!snap) return null
  const list: FeedbackList | undefined = snap.feedback
  const s = sectionsOf(list)
  const any = (list?.rows.length ?? 0) > 0
  const place = at ?? (ui.at || everything(snap)?.id || '')
  return (
    <PaneFrame
      scrollKey="feedback"
      head={(sc) => <Hd back={{ label: 'Back', run: () => setUI({ page: null }) }} title={W.title} sub={W.sub} scrolled={sc} />}
    >
      <div className="fbp">
        <Box snap={snap} place={place} />
        {list?.off && (
          <p className="fb-banner">
            {W.offAll} <button type="button" className="lk" onClick={() => openSettings('all', 'Agents')}>{W.offAllLink}</button>
          </p>
        )}
        {list?.error && <p className="fb-banner">{W.stale}</p>}
        {!any ? (
          <Empty title={W.empty}>{W.emptySub}</Empty>
        ) : (
          <>
            <Section id="found" name={W.found} rows={s.found} snap={snap} now={now} />
            <Section id="filed" name={W.filed} rows={s.filed} snap={snap} now={now} />
            <div className="fb-folds">
              <Section id="later" name={W.later} rows={s.later} snap={snap} now={now} fold />
              <Section id="declined" name={W.declined} rows={s.declined} snap={snap} now={now} fold />
            </div>
          </>
        )}
      </div>
    </PaneFrame>
  )
}

/** open the page: the middle column on a computer, the whole screen on a phone */
export function openFeedback() {
  const phone = getState().ui.phone
  setUI({ page: 'feedback', drawer: false, search: false, settings: null, artWide: false, max: null, ...(phone ? { pane: null, task: null, art: null } : {}) })
}
