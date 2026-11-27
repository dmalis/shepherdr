import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { needsCount } from '@shared/view.ts'
import { filterTasks, NO_FILTER } from '@shared/task-filter.ts'
import { needsFilter, needsItems, needsWords, oneTarget } from '@shared/needs-open.ts'
import { EV, snapshot } from '../demo/data.ts'

// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"). Red is Needs you: the one red
// count, its own button beside the row, and a tap opens the one card or the scope's Needs you list. These also pin what
// the patch relies on: needsCount's rule (needsItems must list exactly what it counts), the list's rows, the Tasks
// button and the phone's bar, ds.css's themes.

const { getState, setUI } = await import('./kernel.ts')
const { List } = await import('./list.tsx')
const { NeedsCount, openNeeds } = await import('./needs-count.tsx')

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const demo = (mode: Parameters<typeof snapshot>[0] = 'normal') => snapshot(mode) as Snapshot
const ui0 = { ...getState().ui }
afterEach(() => setUI({ ...ui0 }))

test('the items are exactly what needsCount counts, for every space and for everyone', () => {
  for (const mode of ['normal', 'more', 'long', 'one', 'five'] as const) {
    const s = demo(mode)
    expect(needsItems(s).length).toBe(needsCount(s))
    for (const p of s.places) expect([p.id, needsItems(s, p.id).length]).toEqual([p.id, needsCount(s, p.id)])
  }
})

test('the items cover a chat that asks and a queued question, as needsCount does', () => {
  const s = demo()
  const t = s.tasks.find((x) => x.id === 'vm:ROOT-3')!
  const more = { ...s, places: s.places.map((p) => (p.id === 'p:vm:root' ? { ...p, needs: true } : p)), needs: [...s.needs, { id: 'q-late', chat: 'vm:ROOT-3/worker', place: t.place, task: t.id, at: 0, question: { id: 'q-late', title: '', kind: 'Question', queued: true, choices: [], to: '' } }] } as Snapshot
  expect(needsItems(more, 'p:vm:root').length).toBe(needsCount(more, 'p:vm:root'))
  expect(needsItems(more, 'p:vm:root')).toEqual([{ place: 'p:vm:root', card: null }, { task: 'vm:ROOT-3', place: 'p:vm:root', card: 'q-late' }])
})

test('one thing opens its card: the task and the card to scroll to', () => {
  const s = demo()
  expect(oneTarget(needsItems(s, 'p:mac-mini:docs'))).toEqual({ task: 'DOCS-3', place: 'p:mac-mini:docs', card: 'q-docs' })
  // two things in one task are still one place to go
  expect(oneTarget([{ task: 'A', place: 'p', card: null }, { task: 'A', place: 'p', card: 'q1' }])).toEqual({ task: 'A', place: 'p', card: 'q1' })
  // two tasks: a list
  expect(oneTarget(needsItems(s, 'p:studio:site'))).toBeNull()
  expect(oneTarget([])).toBeNull()
})

test("two or more list that scope's Needs you, and the list shows exactly those tasks", () => {
  const s = demo()
  const site = needsItems(s, 'p:studio:site')
  const f = needsFilter(s, site, { place: 'p:studio:site' })
  expect(f).toEqual({ ...NO_FILTER, state: ['needs', 'ready'], here: true })
  expect(filterTasks(s, f, 'p:studio:site').map((t) => t.id).sort()).toEqual(['studio:SITE-5', 'studio:SITE-6'])
  // everyone's: no space, every task that counts
  const all = needsItems(s)
  const fa = needsFilter(s, all, { place: EV })
  expect(fa.here).toBe(false)
  expect(filterTasks(s, fa, EV).map((t) => t.id).sort()).toEqual([...new Set(all.map((i) => i.task!))].sort())
  // a machine's
  expect(needsFilter(s, needsItems(s, 'p:vm:shop'), { machine: 'vm' }).machine).toEqual(['vm'])
})

test('a tap on one opens its task at its card; on several opens Tasks with the Needs you filter', () => {
  const s = demo()
  setUI({ at: EV, pane: null, task: null })
  openNeeds(s, needsItems(s, 'p:mac-mini:docs'), { place: 'p:mac-mini:docs' })
  expect(getState().ui).toMatchObject({ at: 'p:mac-mini:docs', pane: 'tasks', task: 'DOCS-3', jump: 'q-docs' })
  setUI({ at: EV, pane: null, task: null, tf: NO_FILTER })
  openNeeds(s, needsItems(s, 'p:studio:site'), { place: 'p:studio:site' })
  expect(getState().ui).toMatchObject({ at: 'p:studio:site', pane: 'tasks', task: null, tf: { ...NO_FILTER, state: ['needs', 'ready'], here: true } })
})

test('the red count: a button of its own, with words for a screen reader; nothing at 0', () => {
  expect(renderToStaticMarkup(<NeedsCount n={0} onOpen={() => {}} />)).toBe('')
  expect(renderToStaticMarkup(<NeedsCount n={1} of="docs" onOpen={() => {}} />)).toBe('<button type="button" class="ncnt" aria-label="docs: 1 needs you"><span class="cnt needs">1</span></button>')
  expect(needsWords(2)).toBe('2 need you')
})

test("in the list: the space's count, Everything's and a folded machine's are red buttons beside the row, never in it", () => {
  setUI({ at: EV, shut: {} })
  const html = renderToStaticMarkup(<List snap={demo()} />)
  const row = (id: string) => html.slice(html.indexOf(`data-project="${id}"`), html.indexOf('</div>', html.indexOf(`data-project="${id}"`)))
  expect(row('p:mac-mini:docs')).toContain('</button><button type="button" class="ncnt" aria-label="docs: 1 needs you"><span class="cnt needs">1</span></button>')
  expect(row('p:studio:site')).toContain('aria-label="site: 2 need you"')
  // no count inside a row's own button, and nothing red where nothing needs you
  expect(html).not.toMatch(/class="row[^"]*"[^>]*>(?:(?!<\/button>).)*class="cnt/)
  expect(row('p:vm:root')).not.toContain('cnt')
  expect(html).toContain('aria-label="Everything: 15 need you"')
  setUI({ shut: { 'm:studio': true } })
  expect(renderToStaticMarkup(<List snap={demo()} />)).toContain('aria-label="studio: 2 need you"')
})

test('the Tasks button and the bar: red with what needs you here, a tap lists it; else the quiet count', () => {
  const t = src('../plugins/tasks/client.tsx')
  expect(t).toContain("label={red ? `Tasks, ${needsWords(red)}` : 'Tasks'}")
  expect(t).toContain('listNeeds(snap, needsItems(snap, at), { place: at })')
  expect(t).toContain('needs: needsCount, openNeeds: (snap, place) => listNeeds(snap, needsItems(snap, place), { place })')
  const app = src('./App.tsx')
  expect(app).toContain("const red = b.needs?.(snap, at) ?? 0")
  expect(app).toContain("<span className={cx('cnt', red > 0 && 'needs')}>{n}</span>")
  // the list's drags and a machine heading's hold leave the count's button alone
  const list = src('./list.tsx')
  expect(list.match(/closest\??\.?\('\.ib,\.ncnt'\)/g)?.length).toBe(2)
})

/** WCAG relative luminance contrast of two #rrggbb colours */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const long = (h: string) => (h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h)

test('the tokens: in light, dark (both ways to pick it) and night, the number reads at 4.5:1 or more', () => {
  const css = src('./ds.css')
  const blocks = [':root{color-scheme:light', '@media(prefers-color-scheme:dark){:root:not([data-theme="light"])', ':root[data-theme="dark"]', ':root[data-theme="night"]']
  for (const b of blocks) {
    const line = css.split('\n').find((l) => l.startsWith(b))!
    const fill = long(line.match(/--needs-fill:(#[0-9a-f]+)/)![1])
    const ink = long(line.match(/--needs-ink:(#[0-9a-f]+)/)![1])
    expect([b, contrast(fill, ink) >= 4.5]).toEqual([b, true])
  }
  expect(css).toContain('.cnt.needs,.ib .cnt.needs,.pt .cnt.needs{background:var(--needs-fill);color:var(--needs-ink)}')
  // its own touch target: an icon button's size, 44px on touch
  expect(css).toContain('.ncnt{display:inline-grid;place-items:center;min-width:var(--ib);height:var(--ib)')
  expect(css).toMatch(/\.app\.tap\{[^}]*--ib:44px/)
  // the other counts on icons are quiet, not the strongest ink
  expect(css).toMatch(/\.ib \.cnt,\.pt \.cnt\{[^}]*background:var\(--cnt-quiet\);color:var\(--fg\)/)
})
