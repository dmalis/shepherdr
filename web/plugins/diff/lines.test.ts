import { expect, test } from 'bun:test'
import type { Snapshot, Task } from '@shared/types.ts'
import { hasFolder, lineKind, settled, sourcesOf, splitPath } from './lines.ts'

const task = (id: string, status: Task['status'], more: Partial<Task> = {}) => ({ id, name: `Task ${id}`, status, place: 'p1', ...more }) as Task
const snap = {
  host: 'box', everything: 'e',
  places: [{ id: 'e', name: 'Everything', machine: 'box', home: true }, { id: 'p1', name: 'shop', machine: 'box' }, { id: 'p2', name: 'shop', machine: 'vm' }],
  tasks: [task('A', 'work', { started: 1, at: 5 }), task('B', 'ready', { at: 9 }), task('C', 'done', { started: 1 }), task('D', 'todo'), task('E', 'work', { place: 'p2', started: 1, at: 1 })],
} as unknown as Snapshot

test('a space lists its tasks with a folder, newest first, then its own folder', () => {
  expect(sourcesOf(snap, 'p1').map((s) => s.key)).toEqual(['task:B', 'task:A', 'space:p1'])
  expect(sourcesOf(snap, 'p1')[0].sub).toBe('Ready for review')
})

test('Everything lists every task and every space, another machine named', () => {
  const all = sourcesOf(snap, 'e')
  expect(all.map((s) => s.key)).toEqual(['task:B', 'task:A', 'task:E', 'space:p1', 'space:p2'])
  expect(all.at(-1)?.sub).toBe('Not committed · vm')
})

test('done and not started tasks have no folder to read', () => {
  expect(hasFolder(task('x', 'done', { started: 1 }))).toBe(false)
  expect(hasFolder(task('x', 'todo'))).toBe(false)
  expect(hasFolder(task('x', 'todo', { started: 1 }))).toBe(true)
})

test('diff lines and paths', () => {
  expect(['diff --git a/x b/x', 'index 1..2', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '+new', '-old', ' same', '\\ No newline at end of file'].map(lineKind))
    .toEqual(['meta', 'meta', 'meta', 'meta', 'hunk', 'add', 'del', 'ctx', 'meta'])
  expect(splitPath('web/src/App.tsx')).toEqual({ dir: 'web/src', name: 'App.tsx' })
  expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
})

test('Changes keeps what it showed when a refresh fails, marked stale with when it was had', () => {
  const first = settled<{ n: number }>(null, 'u', { n: 1 }, 100)
  expect(first).toEqual({ url: 'u', v: { n: 1 }, at: 100 })
  const stale = settled(first, 'u', { error: 'gone' }, 200)
  expect(stale).toEqual({ url: 'u', v: { n: 1 }, at: 100, stale: { at: 100, why: 'gone' } })
  // failing again keeps the first time; a good answer clears it; another address or a first failure is the error
  expect(settled(stale, 'u', { error: 'still' }, 300).stale).toEqual({ at: 100, why: 'still' })
  expect(settled(stale, 'u', { n: 2 }, 400)).toEqual({ url: 'u', v: { n: 2 }, at: 400 })
  expect(settled(first, 'other', { error: 'gone' }, 500)).toEqual({ url: 'other', v: { error: 'gone' }, at: 500 })
  expect(settled<{ n: number }>(null, 'u', { error: 'gone' }, 600).v).toEqual({ error: 'gone' })
})
