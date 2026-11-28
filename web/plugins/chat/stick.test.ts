// dmalis/shepherdr#190: the reader has left the chat's foot though their scroll event hasn't come yet
import { expect, test } from 'bun:test'
import { movedUp } from './stick.ts'

const at = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({ scrollTop, scrollHeight, clientHeight }) as HTMLElement

test('a scroll up from where the chat was pinned is a move', () => {
  // left at 1000, its foot (2000 tall, 1000 shown); the reader went up to 600
  expect(movedUp(at(600, 2000, 1000), 1000)).toBe(true)
  // still there, and rows came in below before the chat followed them: no move
  expect(movedUp(at(1000, 2600, 1000), 1000)).toBe(false)
  expect(movedUp(at(952, 2000, 1000), 952)).toBe(false)
  // a pixel or two is rounding
  expect(movedUp(at(998.5, 2000, 1000), 1000)).toBe(false)
})

test('a taller window clamps the scroll to its new foot, which is no move', () => {
  // the keyboard went down: 1300 shown, so the foot is at 700 and the scroll was clamped there
  expect(movedUp(at(700, 2000, 1300), 1000)).toBe(false)
  // a chat that isn't shown has no size at all
  expect(movedUp(at(0, 0, 0), 1000)).toBe(false)
})
