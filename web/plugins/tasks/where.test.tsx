import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { Snapshot, Task } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'

// dmalis/shepherdr#100: an open task's header names its project over its title. (A row's model line went to the
// header with fork UI 14: rows.test.tsx.)

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const { TaskWhere, whereWords } = await import('./where.tsx')
const { Hd } = await import('@client/ui.tsx')

const all = snapshot()
const one: Snapshot = { ...all, machines: [all.machines[0]!] }
const shop = { name: 'shop', folder: '/Users/sam/dev/shop', short: '~/dev/shop', repo: true }
const notes = { name: '~/notes', folder: '/Users/sam/notes', short: '~/notes', repo: false }
const base = { id: 'SHOP-1', name: 'A task', place: 'p:mac-mini:shop', status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: 1 } as Task
const text = (html: string) => html.replace(/<[^>]+>/g, '')
const where = (snap: Snapshot, t: Task, onShow = () => {}) => renderToStaticMarkup(<TaskWhere snap={snap} t={t} onShow={onShow} />)

test('one machine: the project alone, a button that says where for a screen reader', () => {
  const html = where(one, { ...base, work: shop })
  expect(text(html)).toBe('shop')
  expect(html).toContain('<button')
  expect(html).toContain('aria-label="in shop: show its tasks"')
})

test('several machines: the project and its machine', () => {
  const html = where(all, { ...base, work: shop })
  expect(text(html)).toBe('shop· mac-mini')
  expect(html).toContain('aria-label="in shop on mac-mini: show its tasks"')
})

test('a folder that is not a repo shows by its folder name', () => {
  expect(whereWords(one, { ...base, work: notes })).toEqual({ name: '~/notes', machine: '' })
})

test('a task outside a repo or folder says its machine, as plain text, even with one machine', () => {
  const html = where(one, { ...base, work: undefined })
  expect(html).not.toContain('<button')
  expect(text(html)).toBe('in mac-mini')
})

test('a tap shows that project (its handler runs)', () => {
  let shown = 0
  const el = TaskWhere({ snap: one, t: { ...base, work: shop }, onShow: () => shown++ }) as ReactElement<{ onClick: () => void }>
  el.props.onClick()
  expect(shown).toBe(1)
})

test('the header puts the line after the title in the page (read "<title>, in <project>") and grows to hold it', () => {
  const html = renderToStaticMarkup(<Hd title="Bigger checkout button" kicker={<span className="t0">shop</span>} sub="Working" />)
  expect(html).toContain('class="hd hd3"')
  expect(html.indexOf('class="t1"')).toBeLessThan(html.indexOf('class="t0"'))
  expect(renderToStaticMarkup(<Hd title="x" />)).toContain('class="hd"')
})
