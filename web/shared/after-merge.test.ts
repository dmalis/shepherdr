// dmalis/shepherdr#48: a merged task stays Done and offers what came after its merge; the turning ring only while its
// agent works
import { describe, expect, test } from 'bun:test'
import { afterMergeCard, afterMergeList, afterMergeNote, offersAfterMerge } from './after-merge.ts'
import { headLine, IDLE, ringOf, statusWord, taskLine } from './view.ts'
import { afterMergeOf } from '../../service/next.ts'
import type { Task } from './types.ts'

const task = (x: Partial<Task>): Task => ({ id: 'SHOP-20', name: 'Reactions on reviews', place: 'p', status: 'done', created: '', age: '', ...x } as Task)
const one = { count: 1, commits: ['Keep the reaction bar on one line'], onMain: false }

describe('a merged task with work after its merge', () => {
  test('its row says so in one line, and stays Done', () => {
    const t = task({ merged: true, afterMerge: one })
    expect(taskLine(t)).toBe('Done and merged · 1 change after the merge')
    expect(statusWord(t).word).toBe('Done and merged')
    expect(ringOf(t).kind).toBe('check')
    expect(offersAfterMerge(t)).toBe(true)
  })

  test('the card offers a follow-up with its commits', () => {
    expect(afterMergeCard(one).head).toBe('1 change after the merge')
    expect(afterMergeCard(one).line).toContain('A follow-up task starts from main')
    expect(afterMergeCard({ ...one, count: 3 }).head).toBe('3 changes after the merge')
    const many = { count: 8, commits: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], onMain: false }
    expect(afterMergeList(many)).toEqual({ shown: ['d', 'e', 'f', 'g', 'h'], more: 3 })
  })

  test('already on main: said, nothing offered, nothing on the row', () => {
    const a = { ...one, onMain: true }
    expect(afterMergeCard(a).head).toBe('Already on main')
    expect(afterMergeNote(a)).toBe('')
    expect(taskLine(task({ merged: true, afterMerge: a }))).toBe('Done and merged')
  })

  test('once its follow-up started, it names it', () => {
    const a = { ...one, followUp: { id: 'SHOP-21', title: 'Keep the reaction bar on one line' } }
    expect(afterMergeNote(a)).toBe('follow-up started')
    expect(afterMergeCard(a).head).toBe('Follow-up started')
    expect(afterMergeCard(a).line).toContain('"Keep the reaction bar on one line"')
  })

  test("only a Done task offers it", () => {
    expect(offersAfterMerge(task({ status: 'work', afterMerge: one }))).toBe(false)
    expect(offersAfterMerge(task({ merged: true }))).toBe(false)
  })
})

describe("the service's after_merge", () => {
  test("herdr-task's record as the web reads it, its follow-up on the same machine", () => {
    const got = afterMergeOf({ n: 2, commits: [{ sha: 'abc', s: 'One' }, { sha: 'def', s: 'Two' }], tip: 'def', on_main: false, follow_up: { id: 9, ref: 'SHOP-9', title: 'One and 1 more' } }, 'vm:SHOP-4')
    expect(got).toEqual({ count: 2, commits: ['One', 'Two'], onMain: false, followUp: { id: 'vm:SHOP-9', title: 'One and 1 more' } })
    expect(afterMergeOf({ n: 1, commits: [{ s: 'x' }], on_main: true }, 'SHOP-4')).toEqual({ count: 1, commits: ['x'], onMain: true })
  })

  test('nothing after the merge, or nothing kept: none', () => {
    expect(afterMergeOf(null, 'SHOP-4')).toBeNull()
    expect(afterMergeOf({ n: 0, commits: [] }, 'SHOP-4')).toBeNull()
    expect(afterMergeOf('x', 'SHOP-4')).toBeNull()
  })
})

describe('the turning ring only for real work', () => {
  test('a Working task whose agent is idle: a still dot, and words that say so', () => {
    const t = task({ status: 'work', agentIdle: true })
    expect(ringOf(t)).toMatchObject({ kind: 'pending', label: 'Idle' })
    expect(taskLine(t)).toBe(IDLE)
    expect(headLine(t)).toBe(IDLE)
  })

  test("its agent's own line stays, the dot still", () => {
    const t = task({ status: 'work', agentIdle: true, report: { msg: 'Waiting on CI' } })
    expect(taskLine(t)).toBe('Waiting on CI')
    expect(ringOf(t).kind).toBe('pending')
  })

  test('busy, or a share done to draw: the ring as before', () => {
    expect(ringOf(task({ status: 'work' })).kind).toBe('ring')
    expect(ringOf(task({ status: 'work', agentIdle: true, report: { msg: '', progress: 40 } }))).toMatchObject({ kind: 'ring', pct: 40 })
    expect(ringOf(task({ status: 'merging', agentIdle: true })).kind).toBe('check')
  })
})
