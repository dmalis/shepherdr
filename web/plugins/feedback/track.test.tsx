// The Feedback page's filed rows follow their issue (friction loop, slice 5, #94): each says what GitHub said last
// (Open on GitHub, Closed as fixed, Declined there, Closed as a duplicate of the issue it points to), only from what
// herdr-task read; while a post is under way its step shows instead; GitHub out of reach since says so. The demo's
// normal day is the snapshot. Made-up names only.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeedbackRow, Snapshot } from '@shared/types.ts'
import { feedback, snapshot } from '../../demo/data.ts'

const { FeedbackPage } = await import('./rows.tsx')
const W = await import('./words.ts')

const NOW = Date.now()
const page = (s: Snapshot) => renderToStaticMarkup(<FeedbackPage now={NOW} snap={s} at={s.everything} />)
const rowOf = (html: string, line: string) => html.slice(html.indexOf(line), html.indexOf('</div></div></li>', html.indexOf(line)))
const row = (id: string) => feedback.rows.find((r) => r.id === id)! as FeedbackRow
const with_ = (rows: FeedbackRow[]): Snapshot => ({ ...snapshot('normal'), feedback: { rows, found: 0, off: false } })

test('each filed row says what GitHub said of its issue', () => {
  const html = page(snapshot('normal'))
  expect(rowOf(html, 'A mention resolved')).toContain('Open on GitHub')
  const followed = rowOf(html, 'Search in the task list')
  expect(followed).toContain('Following “Task search covers linked machines”')
  expect(followed).toContain('Closed as fixed')
  expect(rowOf(html, 'The service skipped a tick')).toContain('Declined there')
  // a duplicate names the issue it points to, linked, and that one's state
  const dupe = rowOf(html, 'Ready failed to push')
  expect(dupe).toContain('Closed as a duplicate of <a class="fb-ml" href="https://github.com/example/shepherdr/issues/8" target="_blank" rel="noreferrer">“Ready can’t push a rebased branch”</a>, which is closed as fixed')
  // each keeps its On GitHub link; no "Filed" once GitHub's side is known
  for (const line of ['A mention resolved', 'Ready failed to push', 'The service skipped a tick']) {
    expect(rowOf(html, line)).toContain(`>${W.W.onGitHub}<`)
    expect(rowOf(html, line)).not.toContain('>Filed<')
  }
})

test('fixed is the one green mark, and every mark has its words beside it', () => {
  const html = page(snapshot('normal'))
  expect(rowOf(html, 'Search in the task list')).toContain('class="fb-st fixed"')
  expect(rowOf(html, 'Ready failed to push')).toContain('class="fb-st fixed"')
  expect(rowOf(html, 'A mention resolved')).toContain('class="fb-st"')
  expect(rowOf(html, 'The service skipped a tick')).toContain('class="fb-st"')
  for (const m of html.matchAll(/<p class="fb-st[^"]*">(<svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>)<span>([^<]+)/g)) expect(m[2].trim().length).toBeGreaterThan(4)
})

test('the words for each state, a duplicate taking its look from the issue it points to', () => {
  const o = (x: NonNullable<FeedbackRow['outcome']>) => W.outcomeWords(x)
  expect(o({ state: 'open' })).toEqual({ icon: 'clock', fixed: false, lead: 'Open on GitHub' })
  expect(o({ state: 'closed', reason: 'completed' })).toEqual({ icon: 'check', fixed: true, lead: 'Closed as fixed' })
  expect(o({ state: 'closed', reason: 'not_planned' })).toEqual({ icon: 'x', fixed: false, lead: 'Declined there' })
  expect(o({ state: 'closed', reason: 'duplicate' })).toEqual({ icon: 'copy', fixed: false, lead: 'Closed as a duplicate' })
  expect(o({ state: 'closed' })).toEqual({ icon: 'check', fixed: false, lead: 'Closed' })
  const c = { title: 'Reply context in chat', url: 'https://github.com/example/shepherdr/issues/7' }
  expect(o({ state: 'closed', reason: 'duplicate', canonical: { ...c, state: 'open' } })).toEqual({ icon: 'clock', fixed: false, lead: 'Closed as a duplicate of ', link: c, tail: ', which is open' })
  expect(o({ state: 'closed', reason: 'duplicate', canonical: { ...c, state: 'closed', reason: 'not_planned' } }).tail).toBe(', which was declined')
})

test('GitHub out of reach since: the last state, said to be the last', () => {
  const html = page(snapshot('normal'))
  expect(rowOf(html, 'The service skipped a tick')).toContain(W.W.trackFailed)
  expect(rowOf(html, 'A mention resolved')).not.toContain(W.W.trackFailed)
})

test('a filed row nothing has read yet still says Filed; a post under way shows its step, not the issue', () => {
  const plain = { ...row('d4c3f5'), outcome: undefined }
  expect(rowOf(page(with_([plain])), 'A mention resolved')).toContain('>Filed<')
  const waiting: FeedbackRow = { ...row('d4c3f5'), url: undefined, approved: 1, post: { state: 'waiting', rev: 1 } }
  const html = rowOf(page(with_([waiting])), 'A mention resolved')
  expect(html).toContain('Waiting to post')
  expect(html).not.toContain('Open on GitHub')
})

test('no "Assistant", "worker" or key in the new words', () => {
  for (const s of [W.W.trackFailed, ...(['open', 'closed'] as const).flatMap((state) => ([undefined, 'completed', 'not_planned', 'duplicate'] as const).map((reason) => JSON.stringify(W.outcomeWords({ state, reason }))))])
    expect(s).not.toMatch(/assistant|worker|coordinator|--|SHEP-\d/i)
})
