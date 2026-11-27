import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { isEverything } from '@shared/view.ts'
import type { Pick } from './picker.tsx'
import { EVERYTHING_LINE, EverythingLine } from './everything-line.tsx'

// dmalis/shepherdr#49: Everything's header says what it is in one plain line, then its model. These pin what the patch
// relies on: ChatHeader's second line (.t2) and the message box's rule, isEverything, PickSummary's markup and
// ds.css's .chat-heading>.t2 rule.

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const pick: Pick = { agent: 'claude', label: 'Sonnet 5.5', model: 'sonnet', effort: 'medium', fast: false, perm: null }

test('the line is short and plain: at most 12 words, uncut on a small phone', () => {
  expect(EVERYTHING_LINE.split(/\s+/).length).toBeLessThanOrEqual(12)
  // a 320px phone leaves about 240px for it at the header's secondary size: about 36 characters
  expect(EVERYTHING_LINE.length).toBeLessThanOrEqual(36)
  // the app's own words: never Assistant, worker or coordinator (docs/develop.md)
  expect(EVERYTHING_LINE).not.toMatch(/assistant|worker|coordinator/i)
})

test('the line, then the model in its own wrapper; boxed only while the message box shows', () => {
  const html = (box: boolean) => renderToStaticMarkup(<EverythingLine pick={pick} box={box} />)
  expect(html(true)).toMatch(new RegExp(`^<span class="ev-line">${EVERYTHING_LINE}</span><span class="ev-pick boxed"><span class="pick-summary"><span class="pick-model">[^<]*Sonnet 5.5</span>`))
  expect(html(false)).toContain('<span class="ev-pick"><span class="pick-summary">')
  expect(html(false)).toContain('Medium')
})

test("ChatHeader shows it on Everything's header only, and knows when the message box shows", () => {
  const app = src('./App.tsx')
  expect(app).toContain('const every = isEverything(snap, place.id)')
  expect(app).toContain('<span className="t2">{every ? <EverythingLine pick={pick} cat={cat} box={box} /> : <PickSummary pick={pick} cat={cat} />}</span>')
  // the box's rule as ChatColumn has it: no chat body (View as terminal), the machine reached, a box view
  expect(app).toContain('{!down && !Body && Box && <Box ')
  expect(app).toContain('const Body = registry.chatBody.find((b) => b.when(ui, thread))?.View')
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
  expect(css).toMatch(/@container evh \(max-width:\d+px\)\{\.ev-pick\.boxed\{display:none\}\}/)
})
