// dmalis/shepherdr#190: a long chat opens on its newest rows and the older ones come in after, a step at a time
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { FIRST, STEP, firstOf, stepFrom, useNewestFirst } from './first-rows.ts'

const keys = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)

test('a short chat is drawn whole; a long one starts on its newest rows', () => {
  expect(firstOf([])).toBeNull()
  expect(firstOf(keys(2 * FIRST))).toBeNull()
  const long = keys(404)
  expect(firstOf(long)).toBe(`m${404 - FIRST}`)
})

test('each step adds older rows until the oldest is drawn', () => {
  const long = keys(404)
  let first: string | null = firstOf(long)
  const starts: number[] = []
  while (first !== null) {
    starts.push(long.indexOf(first))
    first = stepFrom(long, first)
  }
  expect(starts[0]).toBe(404 - FIRST)
  for (let i = 1; i < starts.length; i++) expect(starts[i - 1]! - starts[i]!).toBe(STEP)
  // the last step reaches the oldest: nothing is left out
  expect(starts.at(-1)!).toBeLessThanOrEqual(STEP)
  // a row that is no longer there (the chat was replaced) draws everything
  expect(stepFrom(long, 'gone')).toBeNull()
})

function Start({ chat, rows, whole }: { chat: string; rows: string[]; whole: boolean }) {
  return <i>{useNewestFirst(chat, rows, whole)}</i>
}
const start = (rows: string[], whole = false) => Number(renderToStaticMarkup(<Start chat="c" rows={rows} whole={whole} />).replace(/\D/g, ''))

test('the first paint draws the newest rows, or all of them for a link to a message', () => {
  expect(start(keys(10))).toBe(0)
  expect(start(keys(404))).toBe(404 - FIRST)
  // opened at a linked message: it may be far up, so the whole chat is drawn at once
  expect(start(keys(404), true)).toBe(0)
})
