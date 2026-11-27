import { expect, test } from 'bun:test'
import { newsWords } from '../../../core/chat-view.js'
import { TIER_WORDS } from '@shared/needs-words.ts'
import { newsRow } from './news.ts'

const LONG = 'The proof was listed under the scratchpad folder, so ready said there was no such artifact for the task. '.repeat(2)
const REPORT = "herdr-artifact publish registers a proof under the shell's cwd · Goal: publish a proof. Tried: ran it. Fix: use the task's folder."
const said = (event: string, text: string, title = 'Research') => {
  const w = newsWords({ ref: 'SHOP-2', event, text }, { title })
  return { task: 'SHOP-2', ref: 'SHOP-2', event, ...w }
}

test("a feedback report is one quiet row naming its task, opening to the report, never the report as words", () => {
  expect(newsRow(said('feedback', `"Research" feedback: ${REPORT}`), 'Research')).toEqual({ label: 'Feedback noted from Research', body: REPORT })
  // an older line without the title, and a task the app doesn't know: still the row, named by its key
  expect(newsRow(said('feedback', `Feedback: ${REPORT}`, ''), '')?.label).toBe('Feedback noted from SHOP-2')
})

test('started, ready and done draw nothing; every other event is one row', () => {
  for (const e of ['started', 'working-again', 'ready', 'done']) expect(newsRow(said(e, `"Research" is ${e}`), 'Research')).toBeNull()
  for (const e of ['needs-you', 'failed', 'told', 'accept-failed', 'stalled', 'something-new']) {
    const r = newsRow(said(e, `"Research" ${e}: ${LONG}`), 'Research')
    expect(r).not.toBeNull()
    expect(r!.label.length).toBeLessThan(40)
    expect(r!.body).toBe(LONG.trim())
  }
  expect(newsRow(said('accept-failed', '"Research" accept-failed: the merge hit a conflict'), 'Research')?.label).toBe('Accept failed: the merge hit a conflict')
})

// dmalis/shepherdr#114: "Your need me is not mine to see until it's mine." The "you" in news is the Assistant.
// the tiers' words, from their one copy table
const { assistant: A, person: Y, failed: F } = TIER_WORDS
const kind = (event: string, text: string, needs?: string) => ({ ...said(event, text), ...(needs ? { needs } : {}) })

test("a wait the Assistant handles reads as the grey tier, never Needs you", () => {
  expect(newsRow(kind('waiting', '"Research" is waiting: Checks after the rebase are failing', 'attention'), 'Research'))
    .toEqual({ label: `${A} · Checks after the rebase are failing`, body: '' })
  expect(newsRow(kind('waiting', '"Research" is waiting: Done? Shall I open the pull request?', 'reply'), 'Research')?.label)
    .toBe(`${A} · Done? Shall I open the pull request?`)
  expect(newsRow(kind('failed', '"Research" failed: Agent stopped', 'stopped'), 'Research')?.label).toBe(`${A} · ${F}: Agent stopped`)
  // longer words wait behind the fold, the label still the grey tier's
  expect(newsRow(kind('waiting', `"Research" is waiting: ${LONG}`, 'reply'), 'Research')).toEqual({ label: `${A}`, body: LONG.trim() })
  expect(newsRow(kind('waiting', '"Research" is waiting', 'reply'), 'Research')).toEqual({ label: `${A}`, body: '' })
})

test("only the person's wait says Needs you: a prompt on its agent's own screen", () => {
  expect(newsRow(kind('needs-you', '"Research" needs the person: Asks permission', 'asks'), 'Research')).toEqual({ label: `${Y}: Asks permission`, body: '' })
  expect(newsRow(kind('needs-you', '"Research" needs the person: Asks to trust this folder', 'asks'), 'Research')?.label).toBe(`${Y}: Asks to trust this folder`)
})

test("an older log's needs-you line, with no kind, was the Assistant's news: the grey tier too", () => {
  // the line the person saw, replayed through the real reader (core/chat-view.js newsWords)
  expect(newsRow(said('needs-you', '"Typing on a phone" needs you: Checks after the rebase are failing', 'Typing on a phone'), 'Typing on a phone'))
    .toEqual({ label: `${A} · Checks after the rebase are failing`, body: '' })
  expect(newsRow(said('needs-you', 'SHOP-2 needs you: Needs a go (Research)'), 'Research')?.label).toBe(`${A} · Needs a go`)
  expect(newsRow(said('failed', '"Research" failed: Agent stopped'), 'Research')?.label).toBe(`${A} · ${F}: Agent stopped`)
  // a line from before events rode along
  expect(newsRow({ task: 'SHOP-2', ref: 'SHOP-2', mark: 'needs', what: '', text: 'Stripe or Adyen?' }, 'Pay')).toEqual({ label: `${A} · Stripe or Adyen?`, body: '' })
  for (const e of ['waiting', 'needs-you', 'failed']) expect(newsRow(kind(e, `"Research" ${e}: x`), 'Research')?.label).not.toContain(Y)
})

test("the newest row of a task that still waits says what holds now: Needs you once it is the person's", () => {
  const live = { ...kind('waiting', '"Research" is waiting: Done?', 'reply'), live: true }
  // its Assistant handed it up, or a card of the person's stands (needs-you.ts waitsOnPerson)
  expect(newsRow(live, 'Research', true)?.label).toBe(`${Y}: Done?`)
  expect(newsRow(live, 'Research', false)?.label).toBe(`${A} · Done?`)
  // an older line, still live, at a permission prompt now (the reviewer's repro)
  expect(newsRow({ ...said('needs-you', '"Research" needs you: Asks permission'), live: true }, 'Research', true)?.label).toBe(`${Y}: Asks permission`)
  // history (not its newest, or it moved on) keeps the tier its line said
  expect(newsRow(kind('waiting', '"Research" is waiting: Done?', 'reply'), 'Research', true)?.label).toBe(`${A} · Done?`)
})
