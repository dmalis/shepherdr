// "Ask me after" (fork Needs you 6b): how long a wait Shepherdr handles first stays Shepherdr's before it is yours.
// Everything's on Settings › Notifications; a repo's own on its Tasks page, with Same as Everything or Set here ·
// Reset, as the rows beside it. The words and choices: web/shared/ask-after.ts. iOS's Auto-Lock and Slack's "notify me
// after" pattern: one choice of a few fixed times, the value now on the row.
import { tryAct } from '@client/kernel.ts'
import { Choice } from '@client/choice.tsx'
import { Own } from '@client/settings-rows.tsx'
import { ASK_AFTER, ASK_AFTER_DEFAULT, ASK_AFTER_LABEL, askAfterAbout, askAfterWords } from '@shared/ask-after.ts'
import type { Snapshot } from '@shared/types.ts'

const KEY = 'ask_after'

/** the row at `place`: 'all' (Everything), or 'repo:<key>' */
export function AskAfterRow({ snap, place }: { snap: Snapshot; place: string }) {
  const c = snap.config
  if (!c) return null
  const repo = place.startsWith('repo:') ? c.repos?.find((r) => r.key === place.slice(5)) : undefined
  if (place !== 'all' && !repo) return null
  const m = (repo ?? c.all).askAfter ?? ASK_AFTER_DEFAULT
  // a value the file holds that the row doesn't offer (set by hand) still shows as it is
  const words = ASK_AFTER.some(([x]) => x === m) ? ASK_AFTER : [...ASK_AFTER, [m, askAfterWords(m)] as const]
  return (
    <div className="srow">
      <span className="n">
        {ASK_AFTER_LABEL}
        <small>{askAfterAbout(m)}</small>
        <Own place={place} own={!!repo?.own.includes(KEY)} k={KEY} />
      </span>
      <Choice<string>
        label={ASK_AFTER_LABEL}
        values={words.map((w) => w[1])}
        value={askAfterWords(m)}
        onChange={(v) => {
          const to = ASK_AFTER.find((w) => w[1] === v)?.[0]
          if (to !== undefined) void tryAct({ type: 'config', place, key: KEY, value: to })
        }}
      />
    </div>
  )
}
