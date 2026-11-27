// A task's news line in its Assistant's chat (Herdr's <herdr-news> lines, read by core/chat-view.js newsWords), drawn as
// one quiet row under the task's line, never as a message: Herdr said it, not the Assistant nor the person. A
// feedback report is "Feedback noted from <task>", opening to its words; other news says what happened and, when
// short, why on the same row, else opens to it.
import { forAssistant } from '@shared/needs-you.ts'
import { tierLabel, type Tier } from '@shared/needs-words.ts'
import type { Message } from '@shared/types.ts'

type News = NonNullable<Message['news']>
export type NewsRow = { label: string; body: string }

/** words that fit on the row itself; longer ones wait behind its fold */
const SHORT = 140
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** the news of a task that waits: a wait Shepherdr handles, a prompt that is the person's, or a stop */
const WAITS = new Set(['waiting', 'needs you', 'failed'])
/** herdr-task's stock reason of a wait on a reply before #114, which said "your" to whoever read it */
const OLD_STOCK: Record<string, string> = { 'Waits for your reply': 'Waits for a reply' }

/** Whose a wait's row is (dmalis/shepherdr#114). The task's newest wait row while it still waits (live) says what holds
 *  now (theirs: needs-you.ts waitsOnPerson, a card of the person's or a hand-up); an older row says what its line said,
 *  by Needs you's own rule (forAssistant on its kind); an old line with no kind has no known owner. */
function tierOf(n: News, theirs: boolean): Tier {
  if (n.live) return theirs ? 'person' : n.needs ? 'shepherdr' : 'unknown'
  if (!n.needs) return 'unknown'
  return forAssistant(n.needs) ? 'shepherdr' : 'person'
}

/** null: nothing to draw (the app shows started, ready and done by itself, from the task's status). theirs: its task
 *  waits on the person now (needs-you.ts waitsOnPerson) */
export function newsRow(n: News, title: string, theirs = false): NewsRow | null {
  if (n.mark === 'started' || n.mark === 'ready' || n.mark === 'done') return null
  const said = String(n.text ?? '').replace(/\s+/g, ' ').trim()
  // Herdr's event names the row ("stalled": "Stalled"); a line from before it rode along, the words it said
  const what = (n.event || n.what || (n.mark === 'needs' ? 'needs you' : 'news')).trim().toLowerCase().replace(/-/g, ' ')
  if (what === 'feedback') return { label: `Feedback noted from ${title || n.ref}`, body: said }
  if (WAITS.has(what)) {
    // the "you" in news is the Assistant: a wait reads by whose it is, never "Needs you" unless it is the person's
    const text = OLD_STOCK[said] ?? said
    const tier = tierOf(n, theirs)
    return text.length <= SHORT ? { label: tierLabel(tier, text), body: '' } : { label: tierLabel(tier), body: text }
  }
  const head = cap(what)
  if (!said) return { label: head, body: '' }
  return said.length <= SHORT ? { label: `${head}: ${said}`, body: '' } : { label: head, body: said }
}
