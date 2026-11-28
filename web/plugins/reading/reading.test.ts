// fork #144: when the bottom tabs and the box's second row step aside while reading back, and when they come back.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { END_PX, FAR_PX, HIDE_PX, SHOW_PX, START, allowed, step, type Box, type Reading } from './reading.ts'

/** a long chat: 5000px of it, at its newest message (scrollTop 4000 of 4000) */
const H = 5000
const MAX = 4000
const at = (y: number): Reading => ({ ...START, y, h: H })
/** scrolls from `s` through every y in `ys`, as scroll events come */
const scroll = (s: Reading, ys: number[], may = true, room = 0) => ys.reduce((r, y) => step(r, y, H, MAX - y, may, room), s)
/** scrolls by `by`, in 10px events */
const by = (s: Reading, d: number, may = true, room = 0) => {
  const ys: number[] = []
  for (let m = Math.sign(d) * 10; Math.abs(m) <= Math.abs(d); m += Math.sign(d) * 10) ys.push(s.y + m)
  return scroll(s, ys, may, room)
}

describe('stepping aside while reading back', () => {
  test('a deliberate scroll back toward older messages, well away from the newest, steps aside', () => {
    const far = at(2000)
    expect(by(far, -(HIDE_PX - 10)).on).toBe(false)
    expect(by(far, -HIDE_PX).on).toBe(true)
  })

  test('never near the newest message: the chat, grown by the room it gains, keeps past the jump button line', () => {
    // 300px from the end, 200px of room: 100px left, inside the line
    const near = at(MAX - 300 + 100)
    expect(by(near, -100, true, 200).on).toBe(false)
    // far enough for the room
    const far = at(MAX - FAR_PX - 200 - 50 + 100)
    expect(by(far, -100, true, 200).on).toBe(true)
  })

  test('scrolling toward the newest message never steps aside', () => {
    expect(by(at(1000), 800).on).toBe(false)
  })

  test('a small scroll toward the newest message brings all back', () => {
    const on = by(at(2000), -100)
    expect(on.on).toBe(true)
    // a nudge back is not yet enough
    expect(by(on, SHOW_PX - 10).on).toBe(true)
    expect(by(on, SHOW_PX + 10).on).toBe(false)
  })

  test('scrolling on back keeps them aside; turning back needs the full distance from the turn', () => {
    let s = by(at(3000), -100)
    s = by(s, 10)
    s = by(s, -50)
    expect(s.on).toBe(true)
    expect(by(s, SHOW_PX - 10).on).toBe(true)
  })

  test('at the newest message all is back', () => {
    const s = { ...by(at(2000), -100) }
    expect(s.on).toBe(true)
    expect(step(s, MAX - END_PX, H, END_PX, true).on).toBe(false)
  })

  test('anything that forbids it brings all back at once, and keeps them', () => {
    const s = by(at(2000), -100)
    expect(step(s, s.y - 10, H, MAX - s.y + 10, false).on).toBe(false)
    expect(by(at(2000), -300, false).on).toBe(false)
  })

  test('an earlier page loading above (a new height, the view kept) is no scroll of yours', () => {
    const s = by(at(2000), -30)
    // 3000px of older messages came above: the position jumps by as much, the height too
    const loaded = step(s, s.y + 3000, H + 3000, MAX - s.y, true)
    expect(loaded.on).toBe(false)
    expect(loaded.run).toBe(s.run)
    // and while aside, the jump down does not bring them back
    const on = by(at(2000), -100)
    expect(step(on, on.y + 3000, H + 3000, MAX - on.y, true).on).toBe(true)
  })

  test('the same answer keeps the same object', () => {
    const s = at(2000)
    expect(step(s, 2000, H, MAX - 2000, true)).toBe(s)
  })
})

describe('what may step aside', () => {
  const none: Box = { text: false, extras: false, voice: false, ask: false, keyboard: false, focus: false }
  test('an empty box, nothing waiting: it may', () => expect(allowed(none)).toBe(true))
  test.each(['text', 'extras', 'voice', 'ask', 'keyboard', 'focus'] as const)('never with %s', (k) => expect(allowed({ ...none, [k]: true })).toBe(false))
})

// the one-row box while reading is typing.css's own: pin that its rules still answer to the reading mark
test('typing.css folds the box to one row while reading too', () => {
  const css = readFileSync(new URL('../typing/typing.css', import.meta.url), 'utf8')
  expect(css).toContain(':is(.kb-up, .reading) .app .cbox:has(> .crow + .cbar)')
  expect(css).not.toMatch(/^\s*\.kb-up \.app \.cbox/m)
})

// the plugin is on the list, after typing (its one-row box)
test('the reading plugin is listed after typing', () => {
  const list = JSON.parse(readFileSync(new URL('../../plugins.json', import.meta.url), 'utf8')).plugins as string[]
  expect(list.indexOf('reading')).toBeGreaterThan(list.indexOf('typing'))
})

// Motion Reduced and the system's reduce-motion: the tabs switch at once
test('reading.css stops the tabs moving for reduced motion', () => {
  const css = readFileSync(new URL('./reading.css', import.meta.url), 'utf8')
  expect(css).toContain(":root[data-motion='reduced'] .app.phone .bar {\n  transition: none;")
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \.app\.phone \.bar \{\s*transition: none;/)
})
