// fork, "Writing: the @, # and / lists fit the room": the lists over the message box fit the room above it, keep the
// chosen row in view and leave an input method's keys alone. web/demo/phone-box-check.ts checks them in a browser.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { KeyboardEvent } from 'react'
import { composingKey, FLOOR, roomAbove, scrollToShow } from './list-fit.ts'

test('the room is from the box up to the pane header, less the gap and some air, never under a row and its label', () => {
  // a phone with the keyboard up: the box at 400, the header ending at 128
  expect(roomAbove(400, 128)).toBe(400 - 6 - 8 - 128)
  // a header off the top (iOS slid the page) counts from the page's top
  expect(roomAbove(400, -40)).toBe(400 - 6 - 8)
  // no room under the header (a phone on its side): still a row's worth, over the header
  expect(roomAbove(150, 128)).toBe(FLOOR)
  // and never past the page's top: a box at 100 leaves 86 above the gap and the air
  expect(roomAbove(100, 44)).toBe(86)
  expect(roomAbove(10, 0)).toBe(0)
})

test('the chosen row scrolls into view by the least move, and stays put when it shows', () => {
  // a list 200 tall at the top; a row from 60 to 110 shows: nothing moves
  expect(scrollToShow(0, 200, 60, 110)).toBe(0)
  // a row below the end: scroll just enough to show it and the list's padding
  expect(scrollToShow(0, 200, 210, 260)).toBe(64)
  // a row above the start (Up past the top wrapped to the end, then back): scroll up to it
  expect(scrollToShow(300, 200, 120, 170)).toBe(116)
  // never above the list's top
  expect(scrollToShow(300, 200, 2, 50)).toBe(0)
})

const key = (k: { isComposing?: boolean; keyCode?: number }) => ({ nativeEvent: { isComposing: !!k.isComposing, keyCode: k.keyCode ?? 13 } }) as unknown as KeyboardEvent<HTMLElement>

test('a key that ends a word an input method is composing is the input method\'s, never the list\'s', () => {
  expect(composingKey(key({ isComposing: true }))).toBe(true)
  // Safari's Enter that commits the word: not composing any more, but keyCode 229
  expect(composingKey(key({ keyCode: 229 }))).toBe(true)
  expect(composingKey(key({}))).toBe(false)
})

test('the @, # and / lists all use it: the room, the chosen row, the input method', () => {
  for (const f of ['./mentions.tsx', './slash.tsx']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8')
    expect(src).toContain('useListFit(open, sel,')
    expect(src).toContain('ref={fit.ref} className="pop mlist"')
    expect(src).toContain('if (!open || composingKey(e)) return false')
    expect(src).toContain('(fit.onHover(), setAt(n))')
  }
  const css = readFileSync(new URL('./mentions.css', import.meta.url), 'utf8')
  expect(css).toContain('max-height:min(22rem,var(--room,40dvh))')
  // the room is measured to the pane's header: the chat's and a task's pane are a .col with a .hd
  const box = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
  expect(box).toContain('{ment.list}')
  expect(box).toContain('{slash.list}')
  const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
  expect(app).toContain('<section className="col chat" aria-label=')
  expect(app).toContain('<section className="col pane" aria-label=')
  expect(app).toContain("<header className={cx('hd', scrolled && 'sc')}>")
  expect(readFileSync(new URL('../../src/ui.tsx', import.meta.url), 'utf8')).toContain("<header className={cx('hd', scrolled && 'sc', kicker != null && 'hd3')}>")
})
