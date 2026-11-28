import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lookAfter, onFrameSaid, spotOf } from './client.tsx'

// A link to another site in an artifact took over its frame and left a dead grey panel. The page's link catcher tells
// the app instead; the panel and the full-screen view (one Page) open another site in a new tab and the app's own
// links in place, and know whether the frame still shows the artifact.

const HERE = 'https://box.example.ts.net/shepherdr/?artifact=research-1a2b'

function said(d: unknown) {
  const opened: string[] = [], tabs: string[] = []
  const r = onFrameSaid(d, HERE, (h) => opened.push(h), (h) => tabs.push(h))
  return { r, opened, tabs }
}

test("another site's link opens in a new tab; the artifact stays", () => {
  expect(said({ shepherdr: 'link', href: 'https://www.youtube.com/watch?v=abc' })).toEqual({ r: null, opened: [], tabs: ['https://www.youtube.com/watch?v=abc'] })
})

test("a link to another artifact, a task or a space opens in the app, with no reload", () => {
  expect(said({ shepherdr: 'link', href: 'https://box.example.ts.net/shepherdr/?artifact=plan-9z9z' })).toEqual({ r: null, opened: ['https://box.example.ts.net/shepherdr/?artifact=plan-9z9z'], tabs: [] })
  expect(said({ shepherdr: 'link', href: 'https://box.example.ts.net/shepherdr/?task=t1' }).opened).toHaveLength(1)
})

test('nothing but a web address opens, and what the frame says of itself is passed on', () => {
  expect(said({ shepherdr: 'link', href: 'javascript:alert(1)' })).toEqual({ r: null, opened: [], tabs: [] })
  expect(said({ shepherdr: 'link', href: 42 })).toEqual({ r: null, opened: [], tabs: [] })
  expect(said({ shepherdr: 'page' }).r).toBe('page')
  expect(said({ shepherdr: 'leave' }).r).toBeNull()
  expect(said({ shepherdr: 'inside' }).r).toBe('inside')
  expect(said({ shepherdr: 'answer', text: 'yes' }).r).toBeNull()
  expect(said(null).r).toBeNull()
  expect(said('page').r).toBeNull()
})

// Mark up (SHEP-464): the page's catcher says where a tap was, as fractions of the whole page; anything else is no pin.
test('a pin is only a spot the page said, kept inside the page', () => {
  expect(spotOf({ shepherdr: 'spot', x: 0.25, y: 0.5 })).toEqual({ x: 0.25, y: 0.5 })
  expect(spotOf({ shepherdr: 'spot', x: -1, y: 3 })).toEqual({ x: 0, y: 1 })
  expect(spotOf({ shepherdr: 'spot', x: '0.2', y: 0.5 })).toBeNull()
  expect(spotOf({ shepherdr: 'spot', x: Number.NaN, y: 0.5 })).toBeNull()
  expect(spotOf({ shepherdr: 'page' })).toBeNull()
  expect(spotOf(null)).toBeNull()
})

// A picture opened inside an artifact on a busy machine got "Couldn't show this page" (a flaky CI check): what the look
// after each load finds, and who hears the page's word.
test('the look after a load: a page that spoke is shown, a picture tapped to is white, a tap after the load waits', () => {
  // the page said so as it loaded: shown, nothing kept
  expect(lookAfter(10_000, 10_005, 0)).toEqual({ bare: false, lost: false, keep: false })
  // a picture tapped to: no word near its load, the tap before it: white, the tap used
  expect(lookAfter(10_000, 12_000, 11_900)).toEqual({ bare: true, lost: false, keep: false })
  // another site the page's own script went to: no word, no tap: the notice
  expect(lookAfter(10_000, 12_000, 0)).toEqual({ bare: true, lost: true, keep: false })
  // the page's look comes late, after a tap that sends the frame on: the page is shown and the tap kept for the next load
  expect(lookAfter(10_000, 10_005, 11_300)).toEqual({ bare: false, lost: false, keep: true })
})

test("the frame's words are heard from the moment it is in the page", () => {
  const src = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  const listen = /\n {2}(use\w*Effect)\(\(\) => \{\n {4}const on = \(e: MessageEvent\)/.exec(src)
  // a passive effect ran after a quick page's words on a busy runner: the page got the notice that it can't be shown
  expect(listen?.[1]).toBe('useLayoutEffect')
})
