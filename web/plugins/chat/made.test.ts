// dmalis/shepherdr#190: a reply's HTML is kept by everything it depends on, and the oldest unused one goes first
import { beforeEach, expect, test } from 'bun:test'
import { forgetMade, KEEP, keptSize, made, replyKey } from './made.ts'

beforeEach(forgetMade)

test('the same reply again is not made again', () => {
  let n = 0
  const make = () => `<p>${++n}</p>`
  expect(made('a', make)).toBe('<p>1</p>')
  expect(made('a', make)).toBe('<p>1</p>')
  expect(n).toBe(1)
})

test('a full cache lets the least recently used reply go, not one just shown again', () => {
  for (let i = 0; i < KEEP; i++) made(`r${i}`, () => `<p>${i}</p>`)
  // the oldest, used again: it stays
  made('r0', () => 'made again')
  made('new', () => '<p>new</p>')
  expect(keptSize()).toBe(KEEP)
  expect(made('r0', () => 'made again')).toBe('<p>0</p>')
  // the next oldest went
  expect(made('r1', () => 'made again')).toBe('made again')
})

test("a reply's key changes with its words, plain or not, and the kind of each task it links", () => {
  const kind = new Map([['SHOP-2', 'Task']])
  const kindOf = (id: string) => kind.get(id) ?? 'Task'
  const linked = 'See [Fix login](#task=SHOP-2) and [#shop](#space=p%3Ashop)'
  const before = replyKey(linked, false, kindOf)
  expect(replyKey(linked, false, kindOf)).toBe(before)
  expect(replyKey(linked + '.', false, kindOf)).not.toBe(before)
  expect(replyKey(linked, true, kindOf)).not.toBe(before)
  // the task became a schedule's run: its link's mark changes, so the kept HTML can't be used
  kind.set('SHOP-2', 'Schedule run')
  expect(replyKey(linked, false, kindOf)).not.toBe(before)
})

test('a task link written with an escaped key reads the task by its real key', () => {
  const asked: string[] = []
  replyKey('[x](#task=vm%2FSHOP-2) [y](#task=%E0%A4%A)', false, (id) => (asked.push(id), 'Task'))
  // a key that doesn't decode is read as it is
  expect(asked).toEqual(['vm/SHOP-2', '%E0%A4%A'])
})
