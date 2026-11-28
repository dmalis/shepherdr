// Triage (fork #235, fork/specs/issue-loop.md "Settings and the schedule" and "4. Act"): Settings › Triage, where the
// person switches it on for a repo and sets how far it goes, and its yes cards in Needs you. The page is Settings ›
// Tasks' shape: Applies to (VS Code's User / Workspace scope, shared with Tasks), then rows with "Same as Everything" or
// "Set here · Reset" under each value, as GitHub's repo settings override the organisation's. Each save is the app's
// own config call, checked by the service as herdr-task checks it (service/triage-keys.ts); saving a repo's level makes
// or pauses its schedule there and then. A card shows the exact words that would go public, why they wait, and Yes /
// No, as Linear's Triage accepts or declines one issue at a time; the answer is kept by the service only, bound to that
// text's hash, so a changed text asks again. Switched off (Settings › Plugins), the page and the cards are gone and
// Triage does nothing.
import { useEffect, useRef, useState } from 'react'
import { act, attempt, definePlugin, notice, tryAct, useSnap } from '@client/kernel.ts'
import { AppliesTo, useAppliesTo } from '@client/applies-to.tsx'
import { Choice as Seg } from '@client/choice.tsx'
import { GroupCard, GroupSheet } from '@client/card-group.tsx'
import { Own, SRow } from '@client/settings-rows.tsx'
import { ActBtn, ActError, Btn, I, Row, Tgl, useCardActs } from '@client/ui.tsx'
import { TRIAGE_DRAFTS, triageAsk, triageCount, triageDraftsWords, triagePlace, triageShown } from '@shared/attention.ts'
import type { Automation, Snapshot, TriageBatchItem, TriageCard, TriageKeys } from '@shared/types.ts'
import './triage.css'

export const PAGE = 'Triage'

const set = (place: string, key: string, value: unknown) => tryAct({ type: 'config', place, key: `triage.${key}`, value })

const LEVELS: [TriageKeys['level'], string][] = [['off', 'Off'], ['score', 'Score only']]
const FROM: [number, string][] = [[3, '3 and up'], [4, '4 and up'], [5, 'Only 5']]
const PER_DAY = ['1', '2', '3', '5', '10'] as const

/** what the level does, in a sentence under it */
const levelWords = (lv: TriageKeys['level'], repo: string | null) =>
  lv === 'off'
    ? 'Triage reads nothing here. Score and fix comes in a later step.'
    : `Every hour Triage reads new issues${repo ? ` in ${repo}` : ''}, scores each from 1 to 5 and labels it. It changes no code yet.`

/** the schedule as the Schedules page lists it (its next run, its last) */
const scheduleIn = (snap: Snapshot, id: string): Automation | undefined => Object.values(snap.automations ?? {}).flat().find((a) => a.id === id)

function ScheduleRow({ snap, folder }: { snap: Snapshot; folder: string }) {
  const v = snap.triage?.repos[folder]
  const s = v?.schedule
  if (!s) {
    // a level saved where no schedule could be made (an older herdr-task, a space added later): make it here
    return (
      <SRow label={<>Schedule<small>Triage has no schedule in this repo yet, so it doesn’t run.</small></>} wrap>
        <Btn small onClick={() => void tryAct({ type: 'triage', do: 'schedule', folder }, 'Schedule made', 'Making its schedule…')}>Make it</Btn>
      </SRow>
    )
  }
  const a = scheduleIn(snap, s.id)
  const when = s.paused ? (s.by === 'level' ? 'Paused while Triage is off.' : 'Paused: Triage reads nothing until you resume it.') : a?.nextWords ? `Checks every hour, next ${a.nextWords}.` : 'Checks every hour.'
  const op = s.paused ? 'resume' : 'pause'
  // the Schedules page's own Pause and Resume (web/plugins/schedules): the same call, the same words
  return (
    <SRow label={<>Schedule<small>{when}</small></>} wrap>
      <Btn small onClick={() => void tryAct({ type: 'automation', op, id: s.id, place: s.space ?? a?.place, name: a?.name ?? 'Triage' }, undefined, s.paused ? 'Resuming…' : 'Pausing…')}>
        <I n={s.paused ? 'play' : 'pause'} />
        {s.paused ? 'Resume' : 'Pause'}
      </Btn>
    </SRow>
  )
}

/** why nothing happens in this repo now, in the page's words */
function stoppedWords(snap: Snapshot, folder: string): string | null {
  const v = snap.triage?.repos[folder]
  const dest = snap.triage?.destination
  if (!v?.stopped || /schedule|paused/i.test(v.stopped)) return null
  if (!dest) return 'Findings have nowhere to go yet: set agents.feedback_repo in the settings file.'
  if (v.repo?.toLowerCase() !== dest.toLowerCase()) return `Triage files and scores only in ${dest} for now, and this repo isn’t it.`
  return v.stopped
}

export function TriageSettings({ place }: { place: string }) {
  const snap = useSnap()
  const c = snap?.config?.triage
  // Triage works on this machine's repos only for now (the service refuses another machine's)
  const here = (snap?.config?.repos ?? []).filter((r) => !r.machine)
  const repo = useAppliesTo(snap!, here)
  if (!snap || !c || place !== 'all') return null
  const at = repo ? `repo:${repo.key}` : 'all'
  const lv = repo ? c.repos[repo.key] ?? { ...c.all, own: [] } : { ...c.all, own: [] as string[] }
  const own = (k: string) => lv.own.includes(k)
  const v = repo ? snap.triage?.repos[repo.folder] : undefined
  const why = repo && lv.level !== 'off' ? stoppedWords(snap, repo.folder) : null
  return (
    <>
      <p className="hint">
        Triage reads the issues in {snap.triage?.destination ?? 'your own repo'}, scores each and labels it, so you see what matters first. Nothing goes public that it isn’t sure is free of private words: that waits for your yes under Needs you.
      </p>
      <AppliesTo snap={snap} repo={repo} repos={here} />
      {/* the level is each repo's own (Everything has none): no Same as Everything, Off is its reset */}
      {repo ? (
        <SRow label={<>Triage<small>{levelWords(lv.level, v?.repo ?? null)}</small></>} wrap>
          <Seg label="Triage" values={LEVELS.map((x) => x[1])} value={LEVELS.find((x) => x[0] === lv.level)![1]} onChange={(w) => void set(at, 'level', LEVELS.find((x) => x[1] === w)![0])} />
        </SRow>
      ) : (
        <p className="hint">Each repo is switched on by itself: pick it under Applies to. What you set here, every repo gets unless it sets its own.</p>
      )}
      {why && <p className="tri-why" role="status"><I n="warn" />{why}</p>}
      {repo && lv.level !== 'off' && <ScheduleRow snap={snap} folder={repo.folder} />}
      <div className="lab">Fixes</div>
      <p className="hint">Used once Score and fix comes: Triage then starts a fix for each issue scored this high, a few a day.</p>
      <SRow label={<>Fix from<Own place={at} own={own('fix_from')} k="triage.fix_from" /></>} wrap>
        <Seg label="Fix from" values={FROM.map((x) => x[1])} value={FROM.find((x) => x[0] === lv.fix_from)?.[1] ?? FROM[1]![1]} onChange={(w) => void set(at, 'fix_from', FROM.find((x) => x[1] === w)![0])} />
      </SRow>
      <SRow label={<>Fixes a day<Own place={at} own={own('fixes_per_day')} k="triage.fixes_per_day" /></>} wrap>
        <Seg label="Fixes a day" values={PER_DAY.includes(String(lv.fixes_per_day) as (typeof PER_DAY)[number]) ? PER_DAY : [...PER_DAY, String(lv.fixes_per_day) as (typeof PER_DAY)[number]]} value={String(lv.fixes_per_day) as (typeof PER_DAY)[number]} onChange={(w) => void set(at, 'fixes_per_day', Number(w))} />
      </SRow>
      <SRow label={<>Ask me before merging its fixes<Own place={at} own={own('ask_merge')} k="triage.ask_merge" /></>}>
        <Tgl label="Ask me before merging its fixes" on={lv.ask_merge} onChange={(on) => void set(at, 'ask_merge', on)} />
      </SRow>
    </>
  )
}

/* ---------- the yes cards ---------- */

/** why a held draft waits for you, in a sentence */
export function whyWords(c: TriageCard): string {
  const found = c.found?.length ? `: ${c.found.join('; ')}` : ''
  switch (c.why) {
    case 'machine': return 'It was found on another machine, so Shepherdr can’t check its words here. It goes public only when you say so.'
    case 'written': return 'An agent wrote these words, not Triage, so they wait for you before they go public.'
    case 'space': return 'It was found in another space, and its words may be about that work. It goes public only when you say so.'
    case 'private': return `The privacy check wasn’t sure of something${found}. It goes public only when you say so.`
    default: return 'Shepherdr can’t tell where these words came from. They go public only when you say so.'
  }
}

/** what a card's Yes or No sends; `backlog`: a held draft in the backlog's review, whose Yes goes with the batch, at the
 *  batch's pace (still only on its own Yes) */
export const answerOf = (c: TriageCard, answer: 'yes' | 'no', backlog = false) =>
  ({ type: 'triage', do: 'answer', answer, kind: c.kind, hash: c.hash, ...(c.kind === 'draft' ? { key: c.key, copy: !!c.copy, rev: c.rev, ...(backlog ? { from: 'backlog' } : {}) } : { issue: c.issue }) })

export function TriageCardView({ c, backlog = false }: { c: TriageCard; backlog?: boolean }) {
  const acts = useCardActs(`triage:${c.id}`, c.hash)
  const say = (answer: 'yes' | 'no') => () => attempt(answerOf(c, answer, backlog))
  const start = c.kind === 'start'
  const comment = c.kind === 'draft' && c.action === 'comment'
  const id = `tri-${c.id.replace(/[^\w-]/g, '-')}`
  // where Yes sends it, exactly: a new issue, or a comment on which one
  const where = comment ? `Yes posts it as a comment on ${c.repo}#${c.issue}, as written below.` : `Yes posts it to ${c.repo} as a new issue, as written below.`
  // too long to carry here whole: its Yes would be for words the card doesn't show, so only No
  const cut = c.cut ? ' It’s too long to show here whole, so from here it can only be kept private.' : ''
  return (
    <section className="card tri-card" data-card={`triage:${c.id}`} data-ask="" aria-labelledby={`${id}-q`} aria-describedby={`${id}-why`}>
      <span className="t" id={`${id}-q`}>{triageAsk(c)}</span>
      <span className="s" id={`${id}-why`}>
        {start ? `${c.repo}#${c.issue} is marked ready. It’s someone else’s words, so Triage starts a fix only when you say so.${cut ? ' It’s too long to show here whole, so it can’t be started from here.' : ''}` : `${whyWords(c)} ${cut ? cut.trim() : where}`}
      </span>
      {/* the exact words, as they would go: what your answer is bound to (a comment posts its body only) */}
      <div className="tri-text" role="region" aria-label={start ? 'The issue' : 'What would be posted'} tabIndex={0}>
        {!comment && <b>{c.title}</b>}
        {c.body && <pre>{c.body}</pre>}
      </div>
      <div className="acts">
        <ActBtn acts={acts} id="no" busy="Saving…" run={say('no')}>{start ? 'No' : 'No, keep it private'}</ActBtn>
        {!c.cut && <ActBtn acts={acts} id="yes" kind="pri" busy="Saving…" run={say('yes')}>{start ? 'Yes, start a fix' : 'Yes, post it'}</ActBtn>}
      </div>
      <ActError acts={acts} />
    </section>
  )
}

/* ---------- a space's grouped drafts: one card, its list the batch review ---------- */

/** the finding kinds, in the order the review lists them (the Feedback page's own words for each) */
const KINDS: [string, string][] = [['bug', 'Bugs'], ['miss', 'Agent mistakes'], ['confusing', 'Confusing'], ['workaround', 'Workarounds'], ['manual', 'Done by hand'], ['', 'Not sorted']]
const kindOf = (k: string | null) => (KINDS.some((x) => x[0] === k) ? k ?? '' : '')
export const itemId = (x: TriageBatchItem) => `${x.copy ? 'c' : 'f'}:${x.key}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** a space's held drafts, oldest first (each its own card), and its batch card (the drafts one Yes can post) */
const draftsIn = (snap: Snapshot, place: string) => (snap.triage?.cards ?? []).filter((c) => c.kind === 'draft' && triagePlace(snap, c) === place)
const batchIn = (snap: Snapshot, place: string) => (snap.triage?.cards ?? []).find((c) => c.kind === 'batch' && !!c.items?.length && triagePlace(snap, c) === place)

const Tick = ({ on, part }: { on: boolean; part?: boolean }) => <span className={`cbx${on || part ? ' on' : ''}`} aria-hidden="true">{on ? <I n="check" /> : part ? <I n="minus" /> : null}</span>

/** the list a review shows: the one the person opened, kept while the live one differs (it then says it changed), and the
 *  live one once the change is their own Post's -> {list, stale} */
export function batchShown(shown: TriageCard, live: TriageCard, theirs: boolean): { list: TriageCard; stale: boolean } {
  if (live.hash === shown.hash) return { list: shown, stale: false }
  return theirs ? { list: live, stale: false } : { list: shown, stale: true }
}

/** the bulk bar's words: "Post all N" while every one is ticked, "Post N" once any is unticked (Gmail's and GitHub's
 *  bulk bars name the count they act on) */
export const postWords = (ticked: number, of: number) => (!ticked ? 'Nothing ticked' : ticked === of && of > 1 ? `Post all ${ticked}` : `Post ${ticked}`)

/** The batch review's state: the list shown, what is unticked, and its one Post. The Yes sends the hash of the list
 *  shown, so it is for what the person read: a list that changes while it is open stays as it was, says it changed and
 *  posts nothing until they show the new one (as GitHub's "This page is out of date"); after their own Post, the list
 *  left takes its place. The unticked stay unticked. */
function useBatch(c: TriageCard | undefined) {
  const [shown, setShown] = useState(c)
  const [skip, setSkip] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // set while the person's own Post goes and right after: the change it makes is theirs, so the new list is taken
  const adopt = useRef(false)
  const view = !shown || !c ? { list: c, stale: false } : batchShown(shown, c, adopt.current)
  const stale = view.stale
  useEffect(() => { if (view.list !== shown) { adopt.current = false; setShown(view.list) } }, [view.list, shown])
  const list = view.list
  const items = list?.items ?? []
  const ticked = items.filter((x) => !skip.has(itemId(x)))
  const flip = (id: string) => setSkip((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const post = async () => {
    if (!list || !ticked.length || busy || stale) return
    setBusy(true)
    setError(null)
    adopt.current = true
    try {
      const r = await act<{ ok?: boolean; error?: string; kept?: number; changed?: number | boolean }>({ type: 'triage', do: 'answer', answer: 'yes', kind: 'batch', hash: list.hash, skip: [...skip] })
      if (r.ok === false) { adopt.current = false; setError(r.error || 'That did not work.'); return }
      // a list that never came back changed (a slow link) is not theirs for ever: a later change asks again
      setTimeout(() => { adopt.current = false }, 10_000)
      const kept = r.kept ?? 0, changed = Number(r.changed) || 0
      // the unticked ones stay here, still unticked: kept private until the person ticks them
      notice(`${plural(kept, 'finding')} will be posted, a couple of seconds apart.${changed ? ` ${plural(changed, 'finding')} changed since you read ${changed === 1 ? 'it' : 'them'} and wait${changed === 1 ? 's' : ''} again.` : ''}`, { tone: 'ok' })
    } catch (e) {
      adopt.current = false
      setError(e instanceof Error && e.message ? e.message : 'That did not work.')
    } finally { setBusy(false) }
  }
  const renew = () => { setShown(c); setError(null) }
  return { list, items, skip, setSkip, ticked, flip, busy, error, stale, post, renew }
}
type Batch = ReturnType<typeof useBatch>

/** The batch part of the list: every draft one Yes would post, its exact title and text, grouped by kind, each ticked;
 *  untick any to keep it out (GitHub's issue list, Gmail and Linear: a select-all with its count, one bulk action) */
function BatchPart({ b }: { b: Batch }) {
  const { items, skip, setSkip, ticked, flip, list } = b
  const all = ticked.length === items.length
  return (
    <section className="tri-batch" aria-labelledby="tri-batch-h">
      <div className="lab" id="tri-batch-h">One Yes for these · {items.length}</div>
      <p className="hint">They passed the privacy check. Each ticked one becomes its own issue in {list?.repo}, exactly as written here. Untick any you’d rather keep private: it waits here for later.</p>
      <Row className="tri-all" lead={<Tick on={all} part={!all && ticked.length > 0} />} label={all ? `All ${items.length} ticked` : `${ticked.length} of ${items.length} ticked`}
        role="checkbox" aria-checked={all ? true : ticked.length ? 'mixed' : false} onClick={() => setSkip(all ? new Set(items.map(itemId)) : new Set())} />
      {KINDS.map(([k, name]) => {
        const rows = items.filter((x) => kindOf(x.kind) === k)
        if (!rows.length) return null
        return (
          <div className="tri-kind" key={k || 'none'} role="group" aria-label={`${name}, ${rows.length}`}>
            <div className="lab">{name} · {rows.length}</div>
            {rows.map((x) => {
              const id = itemId(x), on = !skip.has(id)
              return (
                <div className="tri-item" key={id}>
                  <Row lead={<Tick on={on} />} label={x.title} role="checkbox" aria-checked={on} onClick={() => flip(id)} />
                  <details>
                    <summary>The text</summary>
                    <pre>{x.body}</pre>
                  </details>
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}

/** the list behind the one card (the shared group sheet, web/src/card-group.tsx): first the batch (a tick per draft),
 *  then each held draft as its own card, answered one by one as before, and at the sheet's foot one bar that stays in
 *  view while it scrolls (Gmail's and GitHub's bulk bars): Close, and Post for the ticked ones. It reads the snapshot
 *  live, so what is answered leaves the list, and the list stays open while it empties */
export function TriageDraftsList({ place, close }: { place: string; close: () => void }) {
  const snap = useSnap()
  const drafts = snap ? draftsIn(snap, place) : []
  const b = useBatch(snap ? batchIn(snap, place) : undefined)
  const batch = b.list && b.items.length ? b.list : undefined
  const n = drafts.length + (batch ? b.items.length : 0)
  return (
    <GroupSheet
      title={n ? triageDraftsWords(n) : 'Nothing waits to be posted'}
      note={!n ? 'Every finding here has its answer.' : batch ? 'Each goes public only when you say yes: the ticked ones with one Yes, the rest one by one.' : 'Each goes public only when you say yes. Answer them one by one, oldest first.'}
      bulk={batch && <BatchPart b={b} />}
      head={batch && (
        <>
          <div className="lab" id="tri-held-h">Your answer one by one · {drafts.length}</div>
          <p className="hint">The privacy check found something in these, or they can’t go in one Yes. Each has its own answer.</p>
        </>
      )}
      headId={batch ? 'tri-held-h' : undefined}
      items={drafts.map((c) => ({ key: c.id, node: <TriageCardView c={c} backlog /> }))}
      foot={(b.error || b.stale) && (
        <>
          {b.error && <p className="tri-err" role="alert">{b.error}</p>}
          {b.stale && <p className="tri-why" role="status"><I n="warn" />The list changed since you opened it. Look at the new one before you post.</p>}
        </>
      )}
      actions={(b.stale || batch) && (
        <>
          {b.stale && <Btn onClick={b.renew}>Show the new list</Btn>}
          {batch && <Btn kind="pri" disabled={b.busy || b.stale || !b.ticked.length} onClick={() => void b.post()}>{b.busy ? 'Saving…' : postWords(b.ticked.length, b.items.length)}</Btn>}
        </>
      )}
      close={close}
    />
  )
}

/** more drafts than TRIAGE_GROUP_OVER in a space, or any that one Yes can post: one card (the shared group card) that
 *  says how many and names the first of them, and opens their list; once it goes, focus goes to the first draft left */
export function TriageDraftsCard({ place, n, batch = 0, peek }: { place: string; n: number; batch?: number; peek?: string[] }) {
  const held = n - batch
  const why = !batch ? 'Each goes public only when you say yes.'
    : held ? `One Yes posts the ${batch} that passed the privacy check, the ones you tick. ${held === 1 ? 'The other waits' : `The other ${held} wait`} for your answer one by one.`
    : `${batch === 1 ? 'It passed' : `All ${batch} passed`} the privacy check: one Yes posts the ones you tick.`
  return (
    <GroupCard id={TRIAGE_DRAFTS} title={triageDraftsWords(n)} peek={peek} sub={why} label="Findings to post" single='[data-card^="triage:draft:"]'
      sheet={(close) => <TriageDraftsList place={place} close={close} />} />
  )
}

/** what a space's grouped drafts are about, oldest first: each held draft's title, a batch's each */
const titlesOf = (drafts: TriageCard[]) => drafts.flatMap((c) => (c.kind === 'batch' ? (c.items ?? []).map((x) => x.title) : [c.title]))

/** the cards in a space's own chat (its repo's, else Everything's), oldest first, where Needs you opens them: more
 *  drafts than TRIAGE_GROUP_OVER, or a batch, are one card (triageShown), start cards always single */
export function triageCards(snap: Snapshot, thread: { place: string; task?: unknown }) {
  if (thread.task) return []
  const { drafts, single } = triageShown((snap.triage?.cards ?? []).filter((c) => triagePlace(snap, c) === thread.place))
  const one = drafts.length ? [{ key: TRIAGE_DRAFTS, at: Math.min(...drafts.map((c) => c.at)), after: () => true, node: <TriageDraftsCard place={thread.place} n={triageCount(drafts)} batch={triageCount(drafts.filter((c) => c.kind === 'batch'))} peek={titlesOf(drafts)} /> }] : []
  return [...one, ...single.map((c) => ({ key: `triage:${c.id}`, at: c.at, after: () => true, node: <TriageCardView c={c} /> }))]
}

export default definePlugin({
  name: 'triage',
  setup(reg) {
    reg.settings.push({ name: PAGE, icon: 'filter', order: 35, scope: 'all', View: TriageSettings })
    reg.chatCards.push({ order: 40, cards: triageCards })
  },
})
