// dmalis/shepherdr#119 (fork/specs/urgent-tasks.md, slice 2): the one rule the service reads a task's urgency by, the
// same table of cases as herdr-task's urgent_now (test/test_herdr_task.py Urgent.test_the_rule), and the order it gives
// Working and Up next. Made-up tasks only.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Task } from './types.ts'
import { nowGroups } from './view.ts'
import { isUrgent, urgentFirst } from './urgent.ts'

const CASES: [Record<string, unknown>, boolean][] = [
  [{}, false], [{ state: 'todo' }, false], [{ state: 'todo', urgent: 5 }, true],
  ...(['scheduled', 'queued', 'running', 'ready'].map((state) => [{ state, urgent: 5 }, true]) as [Record<string, unknown>, boolean][]),
  [{ state: 'done', urgent: 5 }, false], [{ state: 'todo', urgent: 5, archived: 9 }, false],
  [{ state: 'running', urgent: 5, done_at: 7 }, false], // done after it was marked: reopen, resume, switch, a reply
  [{ state: 'running', urgent: 9, done_at: 7 }, true], // marked again after
  [{ state: 'ready', urgent: 5, done_at: 5 }, false],
  [{ state: 'todo', urgent: true }, false], [{ state: 'todo', urgent: '5' }, false], [{ state: 'todo', urgent: 0 }, false],
  [{ state: 'todo', urgent: null }, false], [{ state: 'migrated', urgent: 5 }, false],
]

test("the rule: herdr-task's own table of cases", () => {
  for (const [t, want] of CASES) expect({ t, urgent: isUrgent(t) }).toEqual({ t, urgent: want })
  expect(isUrgent(null)).toBe(false)
  expect(isUrgent('urgent')).toBe(false)
})

test("pin: herdr-task's table is still the one this file copies", () => {
  // the Python table's lines this one mirrors; a change there must come here too
  const py = readFileSync(join(import.meta.dir, '..', '..', 'test', 'test_herdr_task.py'), 'utf8')
  const at = py.indexOf('from herdr_task.urgent import urgent_now')
  const body = py.slice(at, py.indexOf('for t, want in cases', at))
  expect(at).toBeGreaterThan(0)
  const n = (body.match(/\(\{/g) ?? []).length
  // the list comprehension's one line stands for four states
  expect(n - 1 + 4).toBe(CASES.length)
  const py2 = readFileSync(join(import.meta.dir, '..', '..', 'mods', 'tasks', 'bin', 'herdr_task', 'urgent.py'), 'utf8')
  expect(py2).toContain('OPEN = ("todo", "scheduled", "queued", "running", "ready")')
})

const task = (id: string, status: Task['status'], more: Partial<Task> = {}) => ({ id, name: id, status, place: 'p1', state: '', on: 'vm-a', created: '', age: '', started: 1, ...more }) as Task

test('urgent first, each part in the order it came in (stable)', () => {
  const list = [task('A', 'work'), task('B', 'work', { urgent: true }), task('C', 'work'), task('D', 'work', { urgent: true })]
  expect(urgentFirst(list).map((t) => t.id)).toEqual(['B', 'D', 'A', 'C'])
  // none or all urgent: the same list back
  const plain = [task('A', 'work'), task('C', 'work')]
  expect(urgentFirst(plain)).toBe(plain)
  const all = [task('B', 'work', { urgent: true }), task('D', 'work', { urgent: true })]
  expect(urgentFirst(all)).toBe(all)
})

test("Needs you, Done and Archived keep their own order: the groups aren't sorted by it", () => {
  const list = [
    task('N1', 'need', { needsAt: 1 }), task('N2', 'need', { needsAt: 2, urgent: true }),
    task('W1', 'work'), task('W2', 'work', { urgent: true }),
    task('D1', 'done', { doneAt: 9 }), task('D2', 'done', { doneAt: 5, urgent: true }),
  ]
  const g = Object.fromEntries(nowGroups(list).map((x) => [x.name, x.tasks.map((t) => t.id)]))
  expect(g['Needs you']).toEqual(['N1', 'N2'])
  expect(g['Done']).toEqual(['D1', 'D2'])
  // nowGroups itself never reorders Working: the Tasks plugin puts urgent ones first where it renders them
  expect(g['Working']).toEqual(['W1', 'W2'])
})
