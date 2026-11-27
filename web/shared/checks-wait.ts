// A Ready task waiting on its pull request's checks (dmalis/shepherdr#42): its line and each check's words, told again
// at the time they show (the minutes left move on), from core/checks-wait.js as the service has it.
import * as CW from '../../core/checks-wait.js'
import type { CheckRun, ChecksWait } from './types.ts'

/** "Waiting for GitHub's checks · 1 of 2 passed · about 8 min", now */
export function checksLine(w: ChecksWait, now = Date.now()): string {
  return (CW.waitWords(w, now) as ChecksWait).line
}

/** what happens once they're done, now ("It merges by itself once they pass.") */
export function checksNext(w: ChecksWait, now = Date.now()): string {
  return (CW.waitWords(w, now) as ChecksWait).next
}

/** one check's words: "passed · 2 min", "running · 4 min of about 9" */
export function runWords(r: CheckRun, now = Date.now()): string {
  return CW.runWords(r, now) as string
}
