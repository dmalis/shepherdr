import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { isEverything } from '@shared/view.ts'
import { EVERYTHING_LINE, EverythingLine } from './everything-line.tsx'

// dmalis/shepherdr#49: Everything's header says what it is in one plain line. These pin what the patch relies on:
// ChatHeader's second line (.t2, with the model after it), isEverything, and ds.css's .chat-heading>.t2 rule.

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')

test('the line is short and plain: at most 12 words, uncut on a phone', () => {
  expect(EVERYTHING_LINE.split(/\s+/).length).toBeLessThanOrEqual(12)
  expect(EVERYTHING_LINE.length).toBeLessThanOrEqual(44)
  // the app's own words: never Assistant, worker or coordinator (docs/develop.md)
  expect(EVERYTHING_LINE).not.toMatch(/assistant|worker|coordinator/i)
  expect(renderToStaticMarkup(<EverythingLine />)).toBe(`<span class="ev-line">${EVERYTHING_LINE}</span>`)
})

test("ChatHeader shows it before the model, on Everything's header only", () => {
  const app = src('./App.tsx')
  expect(app).toContain("const every = isEverything(snap, place.id)")
  expect(app).toContain('<span className="t2">{every && <EverythingLine />}<PickSummary pick={pick} cat={cat} /></span>')
})

test('isEverything still tells Everything from the home space beside it', () => {
  const p = (id: string, home = false) => ({ id, name: id, machine: 'mini', level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, home })
  const snap = { name: '', host: 'mini', user: '', everything: 'ev', places: [p('ev', true), p('mh', true), p('shop')] } as unknown as Snapshot
  expect(isEverything(snap, 'ev')).toBe(true)
  expect(isEverything(snap, 'mh')).toBe(false)
  expect(isEverything(snap, 'shop')).toBe(false)
})

test("ds.css keeps the header's second line and the rules that lay the line out", () => {
  const css = src('./ds.css')
  expect(css).toContain('.chat-heading>.t2{padding-inline:4px}')
  expect(css).toContain('.chat-heading:has(>.t2>.ev-line){container:evh/inline-size}')
  expect(css).toMatch(/@container evh \(max-width:\d+px\)\{\.ev-line\+\.pick-summary\{display:none\}\}/)
})
