// dmalis/shepherdr#415: a task's status marks say what they mean. A tap (or a press held) on a row's status ring or its
// urgent mark opens a small popover at the mark with its words, the ring's the same words a screen reader hears; a tap
// anywhere else on the row still opens the task, and a press held there still opens its menu. An open task's header
// ring is a button that does the same. Made-up data, and stand-in elements (the tests have no DOM).
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Task } from '@shared/types.ts'

const { closeAll, layersNow, MenuRows } = await import('@client/overlay.tsx')
const { explainAt, HeadRing, MARKS, URGENT_SAYS } = await import('./marks.tsx')

afterEach(() => closeAll())
const t = { id: 'SHOP-1', name: 'Fix checkout', place: 'p:mac-mini:shop', status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: 1, urgent: true, report: { msg: 'Reading the code', progress: 20 } } as unknown as Task

/** a stand-in element: its class, its spoken words, and the mark it sits in (or none) */
function el(cls: string, label = '', inMark?: object | null): HTMLElement {
  const me: Record<string, unknown> = {
    matches: (sel: string) => sel === `.${cls.split(' ')[0]}`,
    getAttribute: (a: string) => (a === 'aria-label' ? label : null),
    setAttribute: () => {},
    removeAttribute: () => {},
  }
  me.closest = (sel: string) => (sel === MARKS ? (inMark === undefined ? me : inMark) : null)
  return me as unknown as HTMLElement
}
/** a row that holds everything given */
const rowOf = (...inside: object[]) => ({ contains: (x: object) => inside.includes(x) }) as unknown as HTMLElement
/** the popover open now: what it is at, its name, and what it shows */
const popover = () => {
  const [l] = layersNow()
  const shown = l ? (l.render(() => {}) as ReactElement<Parameters<typeof MenuRows>[0]>) : null
  return { anchor: l?.anchor, label: l?.label, float: l?.float, html: shown ? renderToStaticMarkup(<MenuRows {...shown.props} />) : '' }
}

test('a tap on the ring: its spoken words in a small popover at it, not the task', () => {
  const ring = el('tring t-working', 'Working, 20% done, 13 min left')
  expect(explainAt(ring, rowOf(ring))).toBe(true)
  const p = popover()
  expect(p.anchor).toBe(ring)
  expect(p.float).toBe(true)
  expect(p.label).toBe('Working, 20% done, 13 min left')
  // a menu with its top line alone: the words, no rows to pick
  expect(p.html).toBe('<div class="cap">Working, 20% done, 13 min left</div>')
})

test('a tap on the urgent mark: "Urgent" and what it means', () => {
  const urg = el('urg')
  expect(explainAt(urg, rowOf(urg))).toBe(true)
  expect(popover().html).toBe(`<div class="cap">${URGENT_SAYS}</div>`)
  expect(URGENT_SAYS).toBe('Urgent: marked to do first')
})

test('a tap anywhere else on the row opens the task: no popover', () => {
  const title = el('l1', '', null)
  expect(explainAt(title, rowOf(title))).toBe(false)
  expect(explainAt(null, rowOf())).toBe(false)
  expect(layersNow()).toEqual([])
  // a mark of another row is not this one's
  expect(explainAt(el('tring', 'Done'), rowOf())).toBe(false)
  expect(layersNow()).toEqual([])
})

test("an open task's header: its ring is a button named by its words, a tap or Enter says them", () => {
  const html = renderToStaticMarkup(<HeadRing t={t} />)
  expect(html).toStartWith('<button type="button" class="hring" aria-label="Working, 20% done">')
  expect(html).toContain('class="tring')
  // the button's click (a tap, Enter or Space) opens the popover at it, its words as the row's ring's
  const btn = el('hring', 'Working, 20% done')
  const onClick = (HeadRing({ t }) as ReactElement<{ onClick: (e: unknown) => void }>).props.onClick
  onClick({ currentTarget: btn })
  const p = popover()
  expect(p.anchor).toBe(btn)
  expect(p.html).toBe('<div class="cap">Working, 20% done</div>')
})

test('the row wires them in: a tap or a press held on a mark explains it before opening the task or its menu', () => {
  // pins the one call site in upstream's TaskRow and TaskHead this patch relies on; a press held clears the row's
  // skip, as the lift's click is already swallowed, so the next tap opens it
  const src = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(src).toContain('explainAt(e.target, e.currentTarget) || open(t)')
  expect(src).toContain("hold: (el) => { skip.current = false; explainHeld(el) || taskMenu(el, t, 'row') } })")
  expect(src).toContain('<HeadRing t={live} />')
  expect(src).toContain('<UrgentTag t={t} more={!!sub} />')
})
