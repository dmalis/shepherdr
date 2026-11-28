// dmalis/shepherdr#415: a task row's status marks say what they mean. A tap (or a press held) on its status ring or its
// urgent mark opens a small popover at the mark with its words, the ring's the same words a screen reader hears; a tap
// anywhere else on the row still opens the task, and a press held there still opens its menu. Made-up data, and
// stand-in elements (the tests have no DOM).
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Task } from '@shared/types.ts'

const { closeAll, layersNow } = await import('@client/overlay.tsx')
const { explainClick, explainHold, MARKS, URGENT_WORDS } = await import('./marks.tsx')

afterEach(() => closeAll())
const t = { id: 'SHOP-1', name: 'Fix checkout', place: 'p:mac-mini:shop', status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: 1, urgent: true, report: { msg: 'Reading the code', progress: 20 } } as unknown as Task
const text = (html: string) => html.replace(/<[^>]+>/g, '')

/** a stand-in element: its class, its spoken words, and the mark it sits in (or none) */
function el(cls: string, label = '', inMark?: object | null): HTMLElement {
  const me: Record<string, unknown> = {
    classList: { contains: (c: string) => cls.split(' ').includes(c) },
    getAttribute: (a: string) => (a === 'aria-label' ? label : null),
    matches: () => false,
    setAttribute: () => {},
    removeAttribute: () => {},
  }
  me.closest = (sel: string) => (sel === MARKS ? (inMark === undefined ? me : inMark) : null)
  return me as unknown as HTMLElement
}
/** a row that holds everything given */
const rowOf = (...inside: object[]) => ({ contains: (x: object) => inside.includes(x) }) as unknown as HTMLElement
const click = (target: HTMLElement, row: HTMLElement) => {
  let prevented = false
  const e = { target, currentTarget: row, preventDefault: () => void (prevented = true) }
  return { shown: explainClick(e as never, t), prevented: () => prevented }
}
const popover = () => {
  const [l] = layersNow()
  return { anchor: l?.anchor, label: l?.label, float: l?.float, html: l ? renderToStaticMarkup(l.render(() => {}) as ReactElement) : '' }
}

test('a tap on the ring: its spoken words in a small popover at it, not the task', () => {
  const ring = el('tring t-working', 'Working, 20% done, 13 min left')
  const r = click(ring, rowOf(ring))
  expect(r.shown).toBe(true)
  expect(r.prevented()).toBe(true)
  const p = popover()
  expect(p.anchor).toBe(ring)
  expect(p.float).toBe(true)
  expect(p.label).toBe('Working, 20% done, 13 min left')
  expect(text(p.html)).toBe('Working, 20% done, 13 min left')
  // the ring drawn again beside its words, its spoken name not read twice there
  expect(p.html).toContain('<span class="mic" aria-hidden="true"><span class="tring')
})

test('a tap on the urgent mark: "Urgent" and what it means', () => {
  const urg = el('urg')
  expect(click(urg, rowOf(urg)).shown).toBe(true)
  const p = popover()
  expect(p.label).toBe('Urgent')
  expect(text(p.html)).toBe(`${URGENT_WORDS.title}${URGENT_WORDS.what}`)
  expect(URGENT_WORDS.what).toBe('Marked to do first')
})

test('a tap anywhere else on the row opens the task: no popover', () => {
  const title = el('l1', '', null)
  const r = click(title, rowOf(title))
  expect(r.shown).toBe(false)
  expect(r.prevented()).toBe(false)
  expect(layersNow()).toEqual([])
  // a mark of another row is not this one's
  expect(click(el('tring', 'Done'), rowOf()).shown).toBe(false)
})

test('a press held: on a mark it explains it, anywhere else the row keeps its menu', () => {
  const ring = el('tring', 'Needs you, 35% done')
  const row = rowOf(ring)
  expect(explainHold(row, t, el('n', '', null))).toBe(false)
  expect(layersNow()).toEqual([])
  expect(explainHold(row, t, ring)).toBe(true)
  expect(popover().label).toBe('Needs you, 35% done')
})

test('the row wires them in: a tap or a press held on a mark explains it before opening the task or its menu', () => {
  // pins the one call site in upstream's TaskRow this patch relies on
  const src = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(src).toContain("explainClick(e, t) || open(t)")
  expect(src).toContain("hold: (el) => void (explainHold(el, t) || taskMenu(el, t, 'row'))")
  expect(src).toContain('<UrgentTag t={t} more={!!sub} />')
})
