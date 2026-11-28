/* The words for a place's states, one set for every pane (docs/design.md, Components: empty, loading, offline).
   Loading, saved-from-before, offline and try-again are each said in their own words, and the same way everywhere. */

/** still on its way */
export const LOADING = 'Loading…'
/** the button that asks again */
export const TRY_AGAIN = 'Try again'
/** the page can't reach the service at all (a fetch that never got an answer) */
export const UNREACHABLE = "Can't reach Shepherdr."

/** when something was had: "14:02" today, else "Mon 14:02", else the date (this device's own way of writing them) */
export function timeWords(at: number, now = Date.now()): string {
  const d = new Date(at), today = new Date(now)
  const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return hm
  if (now - at < 6 * 86400_000) return `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** a refresh that failed over what was shown: what is on screen is from then */
export function staleWords(at: number, why?: string, now = Date.now()): string {
  const said = (why ?? '').trim().replace(/\.$/, '')
  return `${said ? `${said}. ` : ''}Last updated ${timeWords(at, now)}.`
}

/** the line at the top while the link to Shepherdr is gone: what you see is as it was when the link went */
export function offlineWords(since: number | null, restarting = false, now = Date.now()): string {
  if (restarting) return 'Shepherdr is updating · back in a moment'
  return since ? `Can't reach Shepherdr · last updated ${timeWords(since, now)}` : "Can't reach Shepherdr"
}

/** said to a screen reader as the link goes and comes back (live.ts) */
export const LINK_LOST = "Can't reach Shepherdr. What you see stays, and it tries again by itself."
export const LINK_BACK = 'Shepherdr is back.'
export const LINK_UPDATING = 'Shepherdr is updating. It is back in a moment.'

/** what a failed send says to a screen reader, once (its bubble shows Not sent with Retry and Remove) */
export function failedSendWords(error?: string): string {
  const why = (error ?? '').trim().replace(/\.$/, '')
  return `Your message wasn't sent${why ? `: ${why}` : ''}. Retry or remove it in the chat.`
}

/** a filter's new count, said once as it changes */
export const filterCountWords = (n: number) => (n ? `${n} ${n === 1 ? 'task' : 'tasks'} shown` : 'No tasks match')
