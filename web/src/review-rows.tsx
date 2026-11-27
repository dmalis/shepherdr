// fork #11: Review rounds and Must fix on Settings › Tasks, for Everything or one repo. They sit under "Review by a
// second agent" while it is on, so the two never disagree: the switch is tasks.review_rounds above 0, these rows its
// count and what a review must get fixed. Their words and values are the service's own rows' (core/settings.js).
import { MUST_FIX, ROUNDS } from '@core/settings.js'
import type { LevelConfig } from '@shared/types.ts'
import { tryAct } from './kernel.ts'
import { Own, SRow } from './settings.tsx'
import { Choice as Seg } from './choice.tsx'

const rounds = (ROUNDS as [number, string][]).filter(([n]) => n > 0)
const must = MUST_FIX as [NonNullable<LevelConfig['mustFix']>, string][]
const set = (place: string, key: string, value: unknown) => tryAct({ type: 'config', place, key, value })

/** the rows, at `place` ('all' or 'repo:<key>'); none while review is off. Rounds share the switch's key, so both say
 *  "Set here" together, and either Reset puts both back. */
export function ReviewRows({ place, lv, own }: { place: string; lv: LevelConfig; own: (k: string) => boolean }) {
  if (!lv.review) return null
  const n = lv.rounds || 1
  // a count the file holds that the row doesn't offer (herdr-task takes up to 10) still shows as it is
  const words = rounds.some(([x]) => x === n) ? rounds : [...rounds, [n, `${n} rounds`] as [number, string]]
  const m = must.find(([v]) => v === (lv.mustFix ?? 'major')) ?? must[1]!
  return (
    <>
      <SRow label={<>Review rounds<Own place={place} own={own('review')} k="review_rounds" /></>} wrap>
        <Seg label="Review rounds" values={words.map((w) => w[1])} value={words.find(([x]) => x === n)![1]}
          onChange={(v) => { const to = words.find((w) => w[1] === v)![0]; if (rounds.some(([x]) => x === to)) void set(place, 'review_rounds', to) }} />
      </SRow>
      <SRow label={<>Must fix<Own place={place} own={own('must_fix')} k="must_fix" /></>} wrap>
        <Seg label="Must fix" values={must.map((w) => w[1])} value={m[1]} onChange={(v) => void set(place, 'must_fix', must.find((w) => w[1] === v)![0])} />
      </SRow>
    </>
  )
}
