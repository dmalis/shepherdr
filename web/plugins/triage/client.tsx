// Triage (fork #235, fork/specs/issue-loop.md "Settings and the schedule" and "4. Act"): Settings › Triage, where the
// person switches it on for a repo and sets how far it goes, and its yes cards in Needs you. The page is Settings ›
// Tasks' shape: Applies to (VS Code's User / Workspace scope, shared with Tasks), then rows with "Same as Everything" or
// "Set here · Reset" under each value, as GitHub's repo settings override the organisation's. Each save is the app's
// own config call, checked by the service as herdr-task checks it (service/triage-keys.ts); saving a repo's level makes
// or pauses its schedule there and then. A card shows the exact words that would go public, why they wait, and Yes /
// No, as Linear's Triage accepts or declines one issue at a time; the answer is kept by the service only, bound to that
// text's hash, so a changed text asks again. Switched off (Settings › Plugins), the page and the cards are gone and
// Triage does nothing.
import { attempt, definePlugin, tryAct, useSnap } from '@client/kernel.ts'
import { AppliesTo, useAppliesTo } from '@client/applies-to.tsx'
import { Choice as Seg } from '@client/choice.tsx'
import { Own, SRow } from '@client/settings-rows.tsx'
import { ActBtn, ActError, Btn, I, Tgl, useCardActs } from '@client/ui.tsx'
import { triageAsk, triagePlace } from '@shared/attention.ts'
import type { Automation, Snapshot, TriageCard, TriageKeys } from '@shared/types.ts'
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
        Triage reads the issues in {snap.triage?.destination ?? 'your own repo'}, scores each and labels it, so you see what matters first. Its posts carry no private words: whatever it isn’t sure of waits for you under Needs you.
      </p>
      <AppliesTo snap={snap} repo={repo} repos={here} />
      {repo ? (
        <SRow label={<>Triage<Own place={at} own={own('level')} k="triage.level" /><small>{levelWords(lv.level, v?.repo ?? null)}</small></>} wrap>
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

export function TriageCardView({ c }: { c: TriageCard }) {
  const acts = useCardActs(`triage:${c.id}`, c.hash)
  const say = (answer: 'yes' | 'no') => () =>
    attempt({ type: 'triage', do: 'answer', answer, kind: c.kind, hash: c.hash, ...(c.kind === 'draft' ? { key: c.key, copy: !!c.copy, rev: c.rev } : { issue: c.issue }) })
  const start = c.kind === 'start'
  const id = `tri-${c.id.replace(/[^\w-]/g, '-')}`
  return (
    <section className="card tri-card" data-card={`triage:${c.id}`} data-ask="" aria-labelledby={`${id}-q`} aria-describedby={`${id}-why`}>
      <span className="t" id={`${id}-q`}>{triageAsk(c)}</span>
      <span className="s" id={`${id}-why`}>
        {start ? `${c.repo}#${c.issue} is marked ready. It’s someone else’s words, so Triage starts a fix only when you say so.` : `${whyWords(c)} It goes to ${c.repo} as written below.`}
      </span>
      {/* the exact words, as they would go: what your answer is bound to */}
      <div className="tri-text" role="region" aria-label={start ? 'The issue' : 'What would be posted'} tabIndex={0}>
        <b>{c.title}</b>
        {c.body && <pre>{c.body}</pre>}
      </div>
      <div className="acts">
        <ActBtn acts={acts} id="no" busy="Saving…" run={say('no')}>{start ? 'No' : 'No, keep it private'}</ActBtn>
        <ActBtn acts={acts} id="yes" kind="pri" busy={start ? 'Saving…' : 'Posting…'} run={say('yes')}>{start ? 'Yes, start a fix' : 'Yes, post it'}</ActBtn>
      </div>
      <ActError acts={acts} />
    </section>
  )
}

/** the cards in a space's own chat (its repo's, else Everything's), oldest first, where Needs you opens them */
export const triageCards = (snap: Snapshot, thread: { place: string; task?: unknown }) =>
  thread.task ? [] : (snap.triage?.cards ?? []).filter((c) => triagePlace(snap, c) === thread.place).map((c) => ({ key: `triage:${c.id}`, at: c.at, after: () => true, node: <TriageCardView c={c} /> }))

export default definePlugin({
  name: 'triage',
  setup(reg) {
    reg.settings.push({ name: PAGE, icon: 'filter', order: 35, scope: 'all', View: TriageSettings })
    reg.chatCards.push({ order: 40, cards: triageCards })
  },
})
