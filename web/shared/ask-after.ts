// "Ask me after" (fork Needs you 6b; the design: fork/specs/needs-you.md): how long a wait Shepherdr handles first stays
// Shepherdr's before it is the person's (red, one alert), counted from when the wait was first confirmed. Kept as
// tasks.ask_after in the settings file, minutes (0: right away), Everything's or a repo's; herdr-task reads it when it
// records a wait (mods/tasks/bin/herdr_task/wait_record.py ask_after_ms), so a change applies to waits from then on.

/** the row's choices: minutes, and their words */
export const ASK_AFTER: readonly (readonly [number, string])[] = [[0, 'Right away'], [2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']]

/** with nothing set */
export const ASK_AFTER_DEFAULT = 5

/** a settings value as minutes, as herdr-task reads it: a number of minutes (0 to a day), "now" or "right away" for 0;
 *  anything else: the default */
export function askAfterOf(v: unknown): number {
  if (typeof v === 'string' && ['now', 'right away', '0'].includes(v.trim().toLowerCase().replace(/_/g, ' '))) return 0
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 24 * 60) return v
  return ASK_AFTER_DEFAULT
}

/** is it one of the row's own choices */
export const isAskAfter = (v: unknown) => ASK_AFTER.some(([m]) => m === v)

/** a value in words: a choice's, else "<n> minutes" */
export const askAfterWords = (m: number) => ASK_AFTER.find(([x]) => x === m)?.[1] ?? `${m} ${m === 1 ? 'minute' : 'minutes'}`

export const ASK_AFTER_LABEL = 'Ask me after'

/** the small print under the row */
export const askAfterAbout = (m: number) =>
  m === 0
    ? 'Every wait a task has is yours at once, even one Shepherdr could settle.'
    : `How long Shepherdr has to settle a task's wait before it's yours. A question only you can answer is yours at once.`
