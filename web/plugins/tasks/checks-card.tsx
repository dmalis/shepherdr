// A Ready task waiting on its pull request's checks (dmalis/shepherdr#42), in its own pane where the review card would
// be: what it waits for, what happens once they're done, and each check with its state and time, as GitHub's merge box
// lists them. A still dot for a check that runs (GitHub's and Vercel's pending mark), never a spinner: nothing is
// merging yet, and nothing needs the person.
import { useEffect, useState } from 'react'
import { I } from '@client/ui.tsx'
import type { CheckRun, Task } from '@shared/types.ts'
import { checksLine, checksNext, runWords } from '@shared/checks-wait.ts'
import './checks-card.css'

/** the clock its minutes count from, every 30 s while it shows */
function useMinute() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  return now
}

function Mark({ r }: { r: CheckRun }) {
  if (r.state === 'passed') return <I n="check" c="c-ready" />
  if (r.state === 'failed') return <I n="x" c="c-red" />
  if (r.state === 'running') return <svg className="i ckdot" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4.5" /></svg>
  return <I n="checking" c="c-mute" />
}

const SPOKEN: Record<CheckRun['state'], string> = { passed: 'passed', failed: 'failed', running: 'running', queued: 'queued', skipped: 'skipped' }

export function ChecksCard({ t }: { t: Task }) {
  const now = useMinute()
  const w = t.checksWait
  if (!w) return null
  const line = checksLine(w, now)
  // the headline is what it waits for; the count and time follow it ("1 of 2 passed · about 8 min")
  const [head, ...rest] = line.split(' · ')
  return (
    <div className="card ckcard" data-card={`checks:${t.id}`} role="status">
      <span className="t ckhead">
        <svg className={w.state === 'failed' ? 'i ckdot c-red' : 'i ckdot'} viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4.5" /></svg>
        {head}
      </span>
      {rest.length > 0 && <span className="s">{rest.join(' · ')}</span>}
      <span className="s">{checksNext(w, now)}</span>
      {w.runs.length > 0 && (
        <ul className="ckrows" aria-label="Its checks">
          {w.runs.map((r, i) => (
            <li key={i + ":" + r.name} aria-label={`${r.name}, ${SPOKEN[r.state]}`}>
              <Mark r={r} />
              <span className="ckn">{r.name}</span>
              <span className="ckw">{runWords(r, now)}</span>
            </li>
          ))}
          {w.more && <li className="ckmore"><I n="checking" c="c-mute" /><span className="ckn">More checks to come</span></li>}
        </ul>
      )}
      {t.pr?.url && (
        <a className="gh lk" href={t.pr.url + '/checks'} target="_blank" rel="noreferrer">
          See them on GitHub<I n="ext" />
        </a>
      )}
    </div>
  )
}
