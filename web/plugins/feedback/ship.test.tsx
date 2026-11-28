// The Feedback page's fixed rows (friction loop, slice 6, #94): On this machine with Try it and Works / Still broken,
// Fixed in a release this machine is older than, a build that can't be known, Works, a row that came back, and the
// folded Fixed history. The demo's `?case=ship` day is the snapshot. Made-up names only.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeedbackRow, Snapshot } from '@shared/types.ts'
import { feedbackShip, snapshot } from '../../demo/data.ts'

const { FeedbackPage } = await import('./rows.tsx')
const W = await import('./words.ts')

const NOW = Date.now()
const page = (s: Snapshot) => renderToStaticMarkup(<FeedbackPage now={NOW} snap={s} at={s.everything} />)
const rowOf = (html: string, line: string) => html.slice(html.indexOf(line), html.indexOf('</div></div></li>', html.indexOf(line)))
const ship = snapshot('ship')

test('on this machine: its release, what to try, and Works as the row’s one primary', () => {
  const r = rowOf(page(ship), 'Search in the task list')
  expect(r).toContain('class="fb-st fixed"')
  expect(r).toContain('Fixed in 3.2.23 · On this machine')
  expect(r).toContain('<p class="fb-try"><span class="fb-k">Try it:</span> Search for a task on the VM from the Mac mini: it shows in the results</p>')
  expect(r.match(/btn[^"]*pri/g)?.length).toBe(1)
  expect(r).toMatch(/pri[^>]*>Works</)
  expect(r).toContain('>Still broken<')
  expect(r).toContain(`>${W.W.onGitHub}<`)
})

test('a release this machine is older than says update, with no Works to press', () => {
  const r = rowOf(page(ship), 'Dictation stops after')
  expect(r).toContain('Fixed in 3.2.24: update Shepherdr to get it')
  expect(r).not.toContain('class="fb-st fixed"')
  expect(r).not.toContain('>Works<')
})

test('a build that can’t be known: GitHub’s side, said so, and only the person’s Works', () => {
  const r = rowOf(page(ship), 'A pasted image loses')
  expect(r).toContain('Closed as fixed')
  expect(r).toContain(W.W.unknown)
  expect(r).toContain('>Works<')
  expect(r).not.toContain('On this machine')
  expect(r).not.toContain(W.W.broken)   // its comment would say the fix is installed: not without the proof
})

test('Works said today stays under Filed; a day on it folds under Fixed', () => {
  const html = page(ship)
  const r = rowOf(html, 'Settings › Agents forgets')
  expect(r).toContain(W.W.worked)
  expect(r).not.toContain('>Works<')
  expect(html).toMatch(/<button[^>]*class="fb-fold"[^>]*aria-expanded="false"[^>]*>.*?<span>Fixed<\/span>/)
  expect(html).not.toContain('The Tasks panel loses its filter')
})

test('came back: under Found, why, its issue linked, and File it… for the comment', () => {
  const html = page(ship)
  const r = rowOf(html, 'The task list jumps')
  expect(html.indexOf('The task list jumps')).toBeLessThan(html.indexOf('fb-h-filed'))
  expect(r).toContain('Came back: it still happens with its fix installed')
  expect(r).toContain('<a class="fb-ml" href="https://github.com/example/shepherdr/issues/34" target="_blank" rel="noreferrer">Its issue</a>')
  expect(r).toContain(`>${W.W.fileIt}<`)
})

test('the words, from what herdr-task proved only', () => {
  const s = (x: Partial<FeedbackRow>) => W.shipWords(x as FeedbackRow)
  expect(s({})).toBeNull()
  expect(s({ ship: {} })).toBeNull()
  expect(s({ ship: { here: true } })?.text).toBe('On this machine')
  expect(s({ ship: { release: '3.2.23' } })).toEqual({ icon: 'check', fixed: true, text: 'Fixed in 3.2.23' })
  expect(s({ ship: { release: '3.2.23', update: true } })?.icon).toBe('clock')
  expect(s({ ship: { here: true }, tried: { result: 'works', at: 1 } })?.text).toBe(W.W.worked)
  // Try it falls back to the draft's Expected
  const body = '## Goal\n\nx\n\n## Expected\n\nThe first line of the answered message above the reply.\nMore.\n\n## Suggested fix\n\ny'
  expect(W.tryWords({ ship: { here: true }, draft: { rev: 1, title: 't', body, target: { repo: 'a/b', action: 'create' } } })).toBe('The first line of the answered message above the reply.')
  expect(W.tryWords({ ship: { here: true } })).toBeNull()
  expect(W.cameBackWords({ why: 'reported' })).toBe('Came back: it happened again after its fix')
})

test('no "Assistant", "worker" or key in the new words', () => {
  for (const k of ['fixed', 'here', 'tryIt', 'works', 'broken', 'worked', 'unknown', 'worksDone', 'brokenDone', 'backIssue'] as const)
    expect(W.W[k]).not.toMatch(/assistant|worker|coordinator|--|SHEP-\d/i)
  expect(feedbackShip.rows.every((r) => !/@|\/Users\/|\/home\//.test(JSON.stringify(r)))).toBe(true)
})
