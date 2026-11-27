// fork #86: while a phone's keyboard is up the chat gets the room. <html> carries kb-up in the same step the UI's
// `keyboard` changes, and typing.css steps the bottom tabs, the header's second line and the notes on top aside, only
// where a finger is the pointer. The upstream seams this leans on are pinned below, so a sync sees a break at once.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getState, setUI, subscribe } from '@client/kernel.ts'
import { markTyping, TYPING } from './typing.ts'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const css = read('web/plugins/typing/typing.css')

function fakeRoot() {
  const on = new Set<string>()
  const calls: boolean[] = []
  return { on, calls, classList: { toggle: (c: string, v: boolean) => (calls.push(v), v ? on.add(c) : on.delete(c)) } }
}

test('the mark follows the keyboard, in the same step as the change (before the frame is drawn)', () => {
  const r = fakeRoot()
  setUI({ keyboard: false })
  const stop = markTyping(r, () => getState().ui.keyboard, subscribe)
  expect(r.on.has(TYPING)).toBe(false)
  setUI({ keyboard: true })
  expect(r.on.has(TYPING)).toBe(true)
  setUI({ keyboard: false })
  expect(r.on.has(TYPING)).toBe(false)
  stop()
  setUI({ keyboard: true })
  expect(r.on.has(TYPING)).toBe(false)
  setUI({ keyboard: false })
})

test('other changes to the state touch nothing', () => {
  const r = fakeRoot()
  let up = true
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}))
  tell()
  tell()
  expect(r.calls).toEqual([true])
  up = false
  tell()
  expect(r.calls).toEqual([true, false])
})

test('only where a finger is the pointer, and only with the mark: a desktop window never loses its tabs', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const open = rules.indexOf('@media (pointer: coarse) {')
  expect(open).toBeGreaterThan(-1)
  // every rule sits inside the one coarse-pointer block, and every selector needs the mark
  expect(rules.slice(0, open).trim()).toBe('')
  const selectors = [...rules.slice(open + 26).matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim())
  expect(selectors.length).toBeGreaterThan(3)
  for (const s of selectors) expect(s.startsWith(`.${TYPING} .app`)).toBe(true)
})

test('what steps aside: the tabs, the frame band, the folder and the model line, a task line, the notes on top', () => {
  expect(css).toContain('.kb-up .app.phone .bar {\n    display: none;')
  expect(css).toContain('.kb-up .app:not(.phone) .device {\n    padding-bottom: 0;')
  expect(css).toContain('.kb-up .app.phone .col > .hd :is(.chat-heading > .t2, .ttl > .hpath, .ttl > .t2)')
  expect(css).toContain('.kb-up .app.phone :is(.anote, .upchip)')
  // the offline line (.tline) stays: it says why a message waits
  expect(css).not.toContain('.tline')
})

test('upstream seams: the keyboard state, the bar, the header lines, the bands and the notes', () => {
  // viewport.ts reports the keyboard into the UI's `keyboard`
  expect(read('web/src/main.tsx')).toContain('watchViewport((up) => setUI({ keyboard: up }))')
  expect(read('web/src/kernel.ts')).toContain('keyboard: boolean')
  expect(read('web/src/viewport.ts')).toContain("document.activeElement?.matches('input, textarea, [contenteditable]')")
  // the phone's bottom bar, and the chat header's folder and second line
  const app = read('web/src/App.tsx')
  expect(app).toContain('<nav className="bar" aria-label="Views">')
  expect(app).toContain('{ui.phone && <Bar snap={snap} />}')
  expect(app).toContain('<div className="chat-heading">')
  expect(app).toContain('<HeaderPath snap={snap} place={place} />')
  expect(app).toContain('<span className="t2">')
  expect(read('web/src/where.tsx')).toContain('className="hpath"')
  expect(read('web/src/ui.tsx')).toContain('{sub != null && sub !== \'\' && <span className="t2">{sub}</span>}')
  // the bands for the home indicator that the keyboard covers
  expect(read('web/src/ds.css')).toContain('.bar{padding-bottom:calc(12px + env(safe-area-inset-bottom))}')
  expect(read('web/src/styles.css')).toContain('.app:not(.phone) .device{padding-bottom:env(safe-area-inset-bottom)}')
  // the notes that wait
  expect(read('web/plugins/analytics/client.tsx')).toContain('<div className="anote" role="status">')
  expect(read('web/src/update-chip.tsx')).toContain('className="upchip"')
  // the plugin is in the list
  expect(JSON.parse(read('web/plugins.json')).plugins).toContain('typing')
})
