import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Job } from '@shared/types.ts'
import { ago, Jobs, jobsShown, jobsWords } from './jobs.tsx'

// #1560 (6): what an agent left running shows over the box, quiet when none

const NOW = Date.now()
const chat = (jobs?: Job[]) => ({ key: 'SHOP-1/worker', cli: 'claude', messages: [], ...(jobs ? { jobs } : {}) }) as Chat
const shell: Job = { id: 'b:1', kind: 'shell', title: 'Dev server', at: NOW - 90_000, command: 'bun run dev', stop: true, more: 'output' }
const helper: Job = { id: 'c:x', kind: 'child', title: 'shop-1-review', at: NOW - 5000, chat: 't:x', status: 'needs' }

test('nothing when no job runs', () => {
  expect(renderToStaticMarkup(<Jobs chat={chat()} />)).toBe('')
  expect(renderToStaticMarkup(<Jobs chat={chat([])} />)).toBe('')
  expect(renderToStaticMarkup(<Jobs chat={undefined} />)).toBe('')
})

test('one job: its own row, folded, with its age', () => {
  const html = renderToStaticMarkup(<Jobs chat={chat([shell])} />)
  expect(html).toContain('Dev server')
  expect(html).toContain('<span class="qm">1m</span>')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('Stop')
})

test('two or more fold into one line that opens to them', () => {
  const html = renderToStaticMarkup(<Jobs chat={chat([shell, helper])} />)
  expect(html).toContain('2 running in the background')
  expect(html).not.toContain('Dev server')
})

test('words and ages', () => {
  expect(jobsWords([shell, { ...helper, ended: NOW }])).toBe('1 running in the background')
  expect(jobsWords([{ ...helper, ended: NOW }])).toBe('1 finished: shop-1-review')
  expect(ago(NOW - 5000, NOW)).toBe('5s')
  expect(ago(NOW - 3 * 3600_000, NOW)).toBe('3h')
  expect(ago(NOW - 600_000, NOW + 999_999, NOW)).toBe('10m')
})

// dmalis/shepherdr#42: what finished is named, and a line that opens to nothing is gone
test('what finished is named; nothing that opens, no line', () => {
  const review = { ...helper, title: 'Reviewer · Codex', ended: NOW, chat: undefined }
  expect(jobsWords([review, { ...review, id: 'c:y' }, { ...shell, title: 'Run the tests', ended: NOW }])).toBe('3 finished: Reviewer (2), Run the tests')
  expect(jobsShown([review, { ...review, id: 'c:y' }])).toEqual([])
  expect(renderToStaticMarkup(<Jobs chat={chat([review])} />)).toBe('')
  expect(renderToStaticMarkup(<Jobs chat={chat([review, { ...review, id: 'c:y' }])} />)).toBe('')
  // one that still runs, or a finished shell whose output opens: shown
  expect(jobsShown([review, helper])).toHaveLength(2)
  expect(jobsShown([review, { ...shell, ended: NOW }])).toHaveLength(2)
})
