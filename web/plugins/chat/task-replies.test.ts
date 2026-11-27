import { expect, test } from 'bun:test'
import type { Task } from '@shared/types.ts'
import { taskReplies } from './task-replies.ts'

// dmalis/shepherdr#42: in a task's chat the reply buttons show only while the task waits on the person

const task = (x: Partial<Task>): Task => ({ id: 'SHOP-1', name: 'x', place: 'p', status: 'work', ...x }) as Task
const sg = { suggests: ['Merge it', 'Not yet'] }

test("a task's chat: buttons only while it waits on the person", () => {
  expect(taskReplies(sg, task({ status: 'need' }))).toBe(sg)
  expect(taskReplies(sg, task({ status: 'ready' }))).toBeNull() // a hand-in asks nothing
  expect(taskReplies(sg, task({ status: 'work' }))).toBeNull() // working, merging or waiting for its checks
  expect(taskReplies(sg, task({ status: 'merging' }))).toBeNull()
  expect(taskReplies(sg, task({ status: 'done' }))).toBeNull()
})

test('any other chat keeps its buttons; none stays none', () => {
  expect(taskReplies(sg, undefined)).toBe(sg)
  expect(taskReplies(null, task({ status: 'need' }))).toBeNull()
})
