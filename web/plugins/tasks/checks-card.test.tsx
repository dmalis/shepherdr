import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChecksWait, Task } from '@shared/types.ts'
import { etaOf, ringOf, statusWord, taskLine } from '@shared/view.ts'
import { waitWords } from '../../../core/checks-wait.js'
import { ChecksCard } from './checks-card.tsx'

// dmalis/shepherdr#42: a Ready task waiting on its pull request's checks says what it waits for: its row, its ring (a
// still dot, never the working ring) and a card listing each check, as GitHub's merge box

const MIN = 60_000
const NOW = Date.now()
const runs = [
  { name: 'lint', state: 'passed', at: NOW - 9 * MIN, end: NOW - 7 * MIN, typical: 2 * MIN },
  { name: 'check', state: 'running', at: NOW - 6 * MIN, end: 0, typical: 14 * MIN },
]
const cw = (x: Partial<{ runs: unknown[]; auto: boolean }> = {}) => waitWords({ runs, more: false, auto: true, ...x }, NOW) as ChecksWait
const task = (w: ChecksWait): Task => ({ id: 'SHOP-21', name: 'Thumbnails', place: 'p', status: 'work', state: 'work', pr: { number: 216, url: 'https://github.com/example/shop/pull/216', checks: 'running' }, report: { msg: 'x', progress: 100, eta: 5 }, checksWait: w }) as Task

test('its row says what it waits for, a still dot, no time left of its own', () => {
  const t = task(cw())
  expect(taskLine(t)).toBe("Waiting for GitHub's checks · 1 of 2 passed · about 8 min")
  expect(statusWord(t)).toMatchObject({ word: 'Waiting for checks' })
  expect(ringOf(t)).toMatchObject({ kind: 'pending', tone: 'working', pct: null })
  expect(etaOf(t)).toBeNull()
  const failed = task(cw({ runs: [{ ...runs[0], state: 'failed' }] }))
  expect(statusWord(failed)).toMatchObject({ word: 'A check failed' })
  expect(ringOf(failed)).toMatchObject({ kind: 'pending', tone: 'red' })
})

test('its card lists each check, what happens next, and GitHub', () => {
  const html = renderToStaticMarkup(<ChecksCard t={task(cw())} />)
  expect(html).toContain('role="status"')
  expect(html).toContain('Waiting for GitHub&#x27;s checks')
  expect(html).toContain('It merges by itself once they pass.')
  expect(html).toContain('lint')
  expect(html).toContain('passed · 2 min')
  expect(html).toContain('running · 6 min of about 14')
  expect(html).toContain('href="https://github.com/example/shop/pull/216/checks"')
  expect(html).not.toContain('title=')
})
