import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { doneWords } from '@shared/view.ts'
import { snapshot } from '../../demo/data.ts'
import { LATER, readyWords } from './ready-words.ts'

// dmalis/shepherdr#29: a card that waits for the person starts with the decision in plain words and says why it waits;
// each button names what it does. A task that changed nothing reads "Close, nothing changes", never a merge.

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const snap: Snapshot = snapshot()
const kernel = await import('@client/kernel.ts')
mock.module('@client/kernel.ts', () => ({ ...kernel, useSnap: () => snap }))
const { ReviewCard } = await import('./client.tsx')

const ready = { id: 'SHOP-9', name: 'Check the coupon bug', place: snap.places[0]!.id, status: 'ready', state: 'ready', created: '', age: '' } as Task
const text = (t: Partial<Task>, ctx: 'chat' | 'thread' = 'thread') => renderToStaticMarkup(<ReviewCard t={{ ...ready, ...t }} ctx={ctx} />).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')

test('nothing to merge: the decision is to close it, and the button says nothing changes', () => {
  const why = 'Waits for you: Merge in this repo is When I mark it as done.'
  for (const ctx of ['thread', 'chat'] as const) {
    const s = text({ repo: 'branch', base: 'main', nothingToMerge: true, summary: 'Already fixed upstream.', waitsWhy: why }, ctx)
    expect(s).toContain("This task changed nothing, so there's nothing to merge. Close it?")
    expect(s).toContain(why)
    expect(s).toContain('Close, nothing changes')
    expect(s).toContain(LATER)
    expect(s).not.toContain('merge Not')
    expect(s).not.toContain('Merge into')
    // the decision comes before what its agent said
    expect(s.indexOf('Close it?')).toBeLessThan(s.indexOf('Already fixed upstream.'))
  }
})

test('on a branch: the button merges into its base, by name', () => {
  const s = text({ repo: 'branch', base: 'main', pr: { number: 3, url: 'https://example.com/pr/3' }, summary: 'Faster search.' })
  expect(s).toContain('Merge its changes into main?')
  expect(s).toContain('Merge into main')
  expect(s).not.toContain('Mark as done and merge')
})

test('in the folder itself, or no repo: mark it as done', () => {
  expect(readyWords({ ...ready, repo: 'folder' }).go).toBe('Mark as done')
  expect(readyWords({ ...ready }).ask).toBe('It is finished. Mark it as done?')
})

test('closed by its Merge setting: one quiet line with what it found', () => {
  const s = text({ status: 'done', state: 'done', repo: 'branch', nothingToMerge: true, closedAlone: true, summary: 'Already fixed upstream.' })
  expect(s).toContain('Done · nothing to merge')
  expect(s).toContain('Already fixed upstream.')
  expect(s).not.toContain('Close, nothing changes')
  expect(doneWords({ ...ready, repo: 'branch', nothingToMerge: true })).toBe('Done · nothing to merge')
})
