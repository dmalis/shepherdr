// Settings › Triage (fork #235, fork/specs/issue-loop.md "Settings and the schedule"): where the person switches Triage
// on for a repo and sets how far it goes. The page is Settings › Tasks' shape: Applies to (VS Code's User / Workspace
// scope, shared with Tasks), then rows with "Same as Everything" or "Set here · Reset" under each value, as GitHub's
// repo settings override the organisation's. Each save is the app's own config call, checked by the service as
// herdr-task checks it (service/triage-keys.ts); saving a repo's level makes or pauses its schedule there and then. Its
// code comes when Settings first shows it (web/src/later.tsx), not in the first screen's script (dmalis/shepherdr#415).
import { tryAct, useSnap } from '@client/kernel.ts'
import { AppliesTo, useAppliesTo } from '@client/applies-to.tsx'
import { Choice as Seg } from '@client/choice.tsx'
import { Own, SRow } from '@client/settings-rows.tsx'
import { Btn, I, Tgl } from '@client/ui.tsx'
import type { Automation, Snapshot, TriageKeys } from '@shared/types.ts'

const set = (place: string, key: string, value: unknown) => tryAct({ type: 'config', place, key: `triage.${key}`, value })

const LEVELS: [TriageKeys['level'], string][] = [['off', 'Off'], ['score', 'Score only'], ['fix', 'Score and fix']]
const FROM: [number, string][] = [[3, '3 and up'], [4, '4 and up'], [5, 'Only 5']]
const PER_DAY = ['1', '2', '3', '5', '10'] as const

/** what the level does, in a sentence under it */
const levelWords = (lv: TriageKeys['level'], repo: string | null) =>
  lv === 'off'
    ? 'Triage reads nothing here.'
    : lv === 'score'
      ? `Every hour Triage reads new issues${repo ? ` in ${repo}` : ''}, scores each from 1 to 5 and labels it. It changes no code.`
      : `Every hour Triage scores new issues${repo ? ` in ${repo}` : ''}, then starts a fix, one at a time, for an issue you mark ready or one of its own findings scored high enough.`

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
      <p className="hint">At Score and fix, Triage marks its own findings scored this high ready and fixes them, up to this many a day. A fix that stops or fails waits for you; it never starts again by itself.</p>
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
