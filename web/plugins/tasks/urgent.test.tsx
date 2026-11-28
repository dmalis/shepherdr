// dmalis/shepherdr#119 (fork/specs/urgent-tasks.md, slice 2): urgent tasks in the Tasks plugin. Its menu rows per
// state and the action they send, none on a Done or archived task; the row's mark and the name a screen reader hears;
// urgent first in Working and Up next only; the header's word; the Needs you count unchanged by a mark. Made-up data
// (the demo's day).
import { afterEach, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const kernel = await import('@client/kernel.ts')
// another file's mock of useSnap (a fixed snapshot) outlives it: this file reads the store's, as the app does
mock.module('@client/kernel.ts', () => ({ ...kernel, useSnap: () => kernel.getState().snap }))
const { getState, registry, setUI } = kernel
const { taskRows } = await import('./client.tsx')
const plugin = (await import('./client.tsx')).default
const { UrgentMark, UrgentTag, UrgentWord, urgentRows } = await import('./urgent.tsx')
const { needsCount } = await import('@shared/view.ts')
const { NO_FILTER } = await import('@shared/task-filter.ts')
const { IC } = await import('@client/icons.ts')

const ui0 = { ...getState().ui }
afterEach(() => { setUI({ ...ui0 }); Object.assign(getState(), { snap: null }) })
const base = { id: 'SHOP-1', name: 'Fix checkout', place: 'p:mac-mini:shop', status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: 1 } as Task
const text = (html: string) => html.replace(/<[^>]+>/g, '')
const labels = (t: Task) => urgentRows(t).map((r) => r.label)

test('the menu: Mark as urgent on an open task, Mark as not urgent on an urgent one, none once done or archived', () => {
  expect(labels(base)).toEqual(['Mark as urgent'])
  expect(labels({ ...base, urgent: true })).toEqual(['Mark as not urgent'])
  for (const s of ['need', 'ready', 'queued', 'todo', 'scheduled'] as const) expect(labels({ ...base, status: s })).toEqual(['Mark as urgent'])
  expect(labels({ ...base, status: 'done', doneAt: 5 })).toEqual([])
  expect(labels({ ...base, archived: 9 })).toEqual([])
  expect(urgentRows(base)[0]!.icon).toBe('urgent')
})

test("a task's menu and the palette (its rows) carry the row, after Mark as done", () => {
  const snap = snapshot()
  Object.assign(getState(), { snap })
  const t = snap.tasks.find((x) => x.status === 'work' && !x.urgent)!
  const rows = taskRows(t, 'row')!.map((r) => r.label)
  expect(rows.indexOf('Mark as urgent')).toBe(rows.indexOf('Mark as done') + 1)
  const u = snap.tasks.find((x) => x.urgent)!
  expect(taskRows(u, 'thread')!.map((r) => r.label)).toContain('Mark as not urgent')
  const done = snap.tasks.find((x) => x.status === 'done')!
  expect(taskRows(done, 'row')!.map((r) => r.label).filter((l) => /urgent/.test(l))).toEqual([])
})

test('a tap sends task-urgent with on, for the task\'s chat', async () => {
  const real = globalThis.fetch
  const sent: unknown[] = []
  globalThis.fetch = (async (_: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response('{"ok":true}') }) as typeof fetch
  try {
    urgentRows(base)[0]!.run!()
    urgentRows({ ...base, urgent: true })[0]!.run!()
    await Bun.sleep(5)
  } finally { globalThis.fetch = real }
  expect(sent).toEqual([{ type: 'task-urgent', chat: 'SHOP-1/worker', on: true }, { type: 'task-urgent', chat: 'SHOP-1/worker', on: false }])
})

test('the mark: a screen reader hears "Urgent, " first; the row shows the icon with its word (#415); nothing when not urgent', () => {
  const html = renderToStaticMarkup(<span className="l1"><UrgentMark t={{ ...base, urgent: true }} />{base.name}</span>)
  expect(text(html)).toBe('Urgent, Fix checkout')
  expect(renderToStaticMarkup(<UrgentMark t={base} />)).toBe('')
  // the second line: "[!] Urgent ·" seen, not read out twice; the dot only before more words
  const tag = renderToStaticMarkup(<UrgentTag t={{ ...base, urgent: true }} more />)
  expect(tag).toStartWith('<span class="urg" aria-hidden="true">')
  expect(tag).toContain(IC.urgent)
  expect(text(tag)).toBe('Urgent·')
  expect(text(renderToStaticMarkup(<UrgentTag t={{ ...base, urgent: true }} more={false} />))).toBe('Urgent')
  expect(renderToStaticMarkup(<UrgentTag t={base} more />)).toBe('')
  // the header: "Urgent" first, the dot after it not read out
  const head = renderToStaticMarkup(<UrgentWord t={{ ...base, urgent: true }} />)
  expect(head).toContain(IC.urgent)
  expect(head).toContain('<span class="hsep" aria-hidden="true">·</span>')
  expect(renderToStaticMarkup(<UrgentWord t={base} />)).toBe('')
})

test('Tasks: urgent first in Working, each row named "Urgent, <title>"; Needs you and Done keep their order', () => {
  plugin.setup(registry)
  const Pane = registry.panes.find((p) => p.id === 'tasks')!.View
  const snap = snapshot()
  Object.assign(getState(), { snap })
  setUI({ pane: 'tasks', task: null, tab: 'Now', tf: NO_FILTER, at: snap.places[0]!.id, open: {} })
  const html = renderToStaticMarkup(<Pane />)
  // a group's rows, as drawn: from its heading to the next one
  const group = (h: string, name: string) => {
    const from = h.indexOf(`>${name} · `)
    const to = h.indexOf('class="grp"', from)
    return [...h.slice(from, to < 0 ? undefined : to).matchAll(/data-task-row="([^"]+)"/g)].map((m) => m[1]!)
  }
  const working = group(html, 'Working')
  const urgent = snap.tasks.filter((t) => t.urgent).map((t) => t.id)
  expect(urgent.length).toBe(2)
  expect(working.slice(0, 2)).toEqual(urgent)
  // the rest of Working in the list's own order
  const own = snap.tasks.filter((t) => !t.urgent && working.includes(t.id)).map((t) => t.id)
  expect(working.slice(2)).toEqual(own)
  expect(working.length).toBeGreaterThan(4)
  // the row's button: its name starts with the mark's words
  const row = html.slice(html.indexOf(`data-task-row="${urgent[0]}"`))
  const button = row.slice(row.indexOf('<button'), row.indexOf('</button>'))
  expect(text(button)).toStartWith(`Urgent, ${snap.tasks.find((t) => t.id === urgent[0])!.name}`)
  // #415: its second line starts with the word, beside the icon
  expect(button.slice(button.indexOf('class="l2')).replace(/^[^>]*>/, '')).toStartWith('<span class="urg" aria-hidden="true">')
  // Needs you as the shared list orders it, whatever is urgent
  const needs = group(html, 'Needs you')
  const marked = { ...snap, tasks: snap.tasks.map((t) => (t.id === needs[needs.length - 1] ? { ...t, urgent: true as const } : t)) }
  Object.assign(getState(), { snap: marked })
  const again = group(renderToStaticMarkup(<Pane />), 'Needs you')
  expect(again).toEqual(needs)
  expect(needs.length).toBeGreaterThan(2)
  // Up next: the last one marked comes first, the others as they were
  const next = group(html, 'Up next')
  expect(next.length).toBeGreaterThan(2)
  const last = next[next.length - 1]!
  Object.assign(getState(), { snap: { ...snap, tasks: snap.tasks.map((t) => (t.id === last ? { ...t, urgent: true as const } : t)) } })
  expect(group(renderToStaticMarkup(<Pane />), 'Up next')).toEqual([last, ...next.slice(0, -1)])
})

test('a mark never changes the Needs you count', () => {
  const snap: Snapshot = snapshot()
  const all = snap.tasks.map((t) => ({ ...t, urgent: true as const }))
  const none = snap.tasks.map((t) => ({ ...t, urgent: undefined }))
  expect(needsCount({ ...snap, tasks: all })).toBe(needsCount({ ...snap, tasks: none }))
  expect(needsCount({ ...snap, tasks: none })).toBeGreaterThan(0)
})
