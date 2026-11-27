import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { isEverything, needsCount, tstate } from '@shared/view.ts'
import { taskAlerts } from '@shared/needs-you.ts'
import { chipsOf, clean, filterTasks, NO_FILTER } from '@shared/task-filter.ts'
import { needsChats, needsFilter, needsItems, needsWords, oneTarget } from '@shared/needs-open.ts'
import { EV, snapshot } from '../demo/data.ts'

// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"). Red is Needs you: the one red
// count, its own button beside the row, and a tap opens the one card or the scope's Needs you list. These also pin what
// the patch relies on: needsCount's rule (needsItems must list exactly what it counts), the list's rows, the Tasks
// button and the phone's bar, ds.css's themes.

const { getState, setUI } = await import('./kernel.ts')
const { List } = await import('./list.tsx')
const { AskRow, listNeeds, needsAsks, NeedsCount, openNeeds } = await import('./needs-count.tsx')

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const demo = (mode: Parameters<typeof snapshot>[0] = 'normal') => snapshot(mode) as Snapshot
// openLink reads the page's own address
;(globalThis as { location?: unknown }).location ??= new URL('http://127.0.0.1/')
const ui0 = { ...getState().ui }
afterEach(() => { setUI({ ...ui0 }); Object.assign(getState(), { snap: null }) })

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

const q = (id: string, task: string, place: string) => ({ id, chat: `${task}/worker`, place, task, at: 0, question: { id, title: id, kind: 'Question', queued: true, choices: [], to: '' } })
const working = (s: Snapshot) => s.tasks.find((t) => tstate(t) === 'working' && !taskAlerts(s).has(t.id))!

test('one thing opens its card, as the app draws it: a question, Ready for review, a stop, an alert, your hands', () => {
  const s = demo()
  expect(oneTarget(needsItems(s, 'p:mac-mini:docs'))).toEqual({ task: 'DOCS-3', place: 'p:mac-mini:docs', card: 'q-docs' })
  expect(oneTarget(needsItems(s, 'p:mac-mini:notes'))).toEqual({ task: 'NOTES-4', place: 'p:mac-mini:notes', card: 'review:NOTES-4' })
  const cards = needsItems(s).map((i) => i.card)
  expect(cards).toContain('stopped:BLOG-11')
  expect(cards).toContain('hands:SHOP-17')
  // a standing alert on a task at work: its alert card
  const alerting = s.tasks.find((t) => taskAlerts(s).has(t.id) && tstate(t) === 'working')
  if (alerting) expect(needsItems(s).find((i) => i.task === alerting.id)?.card).toBe(`alert:${taskAlerts(s).get(alerting.id)!.id}`)
  // two things, even in one task, are a list: the count says 2
  const w = working(s)
  const two = { ...s, needs: [...s.needs, q('q1', w.id, w.place), q('q2', w.id, w.place)] } as Snapshot
  expect(needsItems(two, w.place).filter((i) => i.task === w.id).length).toBe(2)
  expect(oneTarget([{ task: 'A', place: 'p', card: 'q1' }, { task: 'A', place: 'p', card: 'q2' }])).toBeNull()
  expect(oneTarget(needsItems(s, 'p:studio:site'))).toBeNull()
  expect(oneTarget([])).toBeNull()
})

test("two or more: the list shows exactly what the count counts, at work or not, and the chats that ask", () => {
  const s = demo()
  const listed = (snap: Snapshot, scopes: string[], at: string) => filterTasks(snap, needsFilter(scopes), at).map((t) => t.id).sort()
  const tasksOf = (items: ReturnType<typeof needsItems>) => [...new Set(items.flatMap((i) => (i.task ? [i.task] : [])))].sort()
  for (const p of s.places) expect([p.id, listed(s, [p.id], p.id)]).toEqual([p.id, tasksOf(needsItems(s, p.id))])
  expect(listed(s, [EV], EV)).toEqual(tasksOf(needsItems(s)))
  // working tasks with queued questions: counted, and listed (their questions show under Needs you)
  const ws = s.tasks.filter((t) => tstate(t) === 'working' && t.place === 'p:vm:root')
  const queued = { ...s, needs: [...s.needs, ...ws.map((t, i) => q(`qq${i}`, t.id, t.place))] } as Snapshot
  expect(listed(queued, ['p:vm:root'], 'p:vm:root')).toEqual(tasksOf(needsItems(queued, 'p:vm:root')))
  // a space's own chat asking has no task row: the list adds it
  const chat = { ...s, places: s.places.map((p) => (p.id === 'p:vm:root' ? { ...p, needs: true } : p)) } as Snapshot
  expect(needsChats(chat, ['p:vm:root'])).toEqual([{ place: 'p:vm:root', card: null }])
  expect(needsChats(chat, [EV]).map((i) => i.place)).toEqual(['p:vm:root'])
  // a folded machine: only the spaces its heading counts (the open one stays in sight with its own count)
  const mac = s.places.filter((p) => p.machine === 'mac-mini' && p.id !== 'p:mac-mini:shop' && !isEverything(s, p.id)).map((p) => p.id)
  const counted = mac.reduce((n, id) => n + needsCount(s, id), 0)
  expect(listed(s, mac, 'p:mac-mini:shop').length).toBe(counted)
  expect(listed(s, mac, 'p:mac-mini:shop')).not.toContain('SHOP-12')
  // its chip, one tap to take off; a kept filter keeps it
  expect(chipsOf(s, needsFilter(['p:mac-mini:docs']), EV).map((c) => c.label)).toEqual(['Needs you in docs'])
  expect(chipsOf(s, needsFilter([EV]), EV)[0]!.off(needsFilter([EV]))).toEqual(NO_FILTER)
  expect(clean(JSON.parse(JSON.stringify(needsFilter(mac))))).toEqual(needsFilter(mac))
  expect(clean(NO_FILTER)).toEqual(NO_FILTER)
})

test('a tap on one opens it at its card, even past a maximized task or a terminal view; on several, the list', () => {
  const s = demo()
  setUI({ at: EV, pane: null, task: null })
  openNeeds(needsItems(s, 'p:mac-mini:docs'), ['p:mac-mini:docs'], 'p:mac-mini:docs')
  expect(getState().ui).toMatchObject({ at: 'p:mac-mini:docs', pane: 'tasks', task: 'DOCS-3', jump: 'q-docs' })
  // the space's own chat asking, with a task maximized over it and the chat shown as a terminal
  Object.assign(getState(), { snap: s })
  const chat = s.places.find((p) => p.id === 'p:vm:root')!.chat!
  setUI({ at: 'p:vm:root', pane: null, task: null, max: 'vm:ROOT-3', aterm: { [chat]: true } })
  openNeeds([{ place: 'p:vm:root', card: 'c1' }], ['p:vm:root'], 'p:vm:root')
  expect(getState().ui).toMatchObject({ at: 'p:vm:root', max: null, jump: 'c1', aterm: { [chat]: false } })
  setUI({ at: EV, pane: null, task: null, max: null, tf: NO_FILTER })
  openNeeds(needsItems(s, 'p:studio:site'), ['p:studio:site'], 'p:studio:site')
  expect(getState().ui).toMatchObject({ at: 'p:studio:site', pane: 'tasks', task: null, tab: 'Now', tf: needsFilter(['p:studio:site']) })
})

test('a red Tasks button lists Needs you from any state; once it shows, a tap does what it always did', () => {
  setUI({ at: 'p:mac-mini:shop', pane: 'tasks', task: null, tab: 'Scheduled', tf: NO_FILTER })
  expect(listNeeds(['p:mac-mini:shop'])).toBe(true)
  expect(getState().ui).toMatchObject({ pane: 'tasks', tab: 'Now', tf: needsFilter(['p:mac-mini:shop']) })
  expect(listNeeds(['p:mac-mini:shop'])).toBe(false)
  setUI({ task: 'SHOP-12' })
  expect(listNeeds(['p:mac-mini:shop'])).toBe(true)
})

test("round 2: a chat's queued questions a row each, the rest of the filter applies to chat rows, a changed filter or a drawer", () => {
  const s = demo()
  const ask = (id: string) => ({ id, chat: 'vm:root', place: 'p:vm:root', at: 0, question: { id, title: `Pick ${id}`, kind: 'Question', queued: true, choices: [], to: '' } })
  const two = { ...s, needs: [...s.needs, ask('c1'), ask('c2')] } as Snapshot
  expect(needsChats(two, ['p:vm:root']).map((i) => [i.card, i.title])).toEqual([['c1', 'Pick c1'], ['c2', 'Pick c2']])
  expect(needsChats(two, ['p:vm:root']).length).toBe(needsCount(two, 'p:vm:root') - needsItems(two, 'p:vm:root').filter((i) => i.task).length)
  expect(renderToStaticMarkup(<AskRow snap={two} i={needsChats(two, ['p:vm:root'])[0]!} />)).toContain('Pick c1')
  // Everything's list, Site picked in the Space filter: root's chat row goes, as its tasks do
  const f = { ...needsFilter([EV]), space: ['p:studio:site'] }
  expect(needsAsks(two, f, EV)).toEqual([])
  expect(needsAsks(two, { ...needsFilter([EV]), space: ['p:vm:root'] }, EV).length).toBe(2)
  expect(needsAsks(two, { ...needsFilter([EV]), machine: ['studio'] }, EV)).toEqual([])
  expect(needsAsks(two, { ...needsFilter([EV]), state: ['done'] }, EV)).toEqual([])
  // the list on screen with State › Done picked: a tap puts Needs you back, not the button's other job
  setUI({ at: 'p:studio:site', pane: 'tasks', task: null, tab: 'Now', drawer: false, tf: { ...needsFilter(['p:studio:site']), state: ['done'] } })
  expect(listNeeds(['p:studio:site'], 'p:studio:site')).toBe(true)
  expect(getState().ui.tf).toEqual(needsFilter(['p:studio:site']))
  // the phone's Spaces drawer open over that list: the tap closes it
  setUI({ drawer: true })
  expect(listNeeds(['p:studio:site'], 'p:studio:site')).toBe(true)
  expect(getState().ui.drawer).toBe(false)
  expect(listNeeds(['p:studio:site'], 'p:studio:site')).toBe(false)
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
  expect(t).toContain("onClick={() => (red && listNeeds([at])) || togglePane('tasks')}")
  expect(t).toContain('needs: needsCount, openNeeds: (_, place) => listNeeds([place]) })')
  expect(t).toContain('{o && chats.map((i) => <AskRow')
  const app = src('./App.tsx')
  expect(app).toContain("const red = b.needs?.(snap, at) ?? 0")
  expect(app).toContain('onClick={() => (red && b.openNeeds?.(snap, at)) || setUI(')
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
