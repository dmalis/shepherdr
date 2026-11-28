// fork UI 13 (dmalis/shepherdr#151, "Tasks: views for a day of many projects"): the views above Tasks › Now, the
// sheet's Project and Space, counts for the view you're in, the view kept and a red count that still opens what it
// counts. Made-up data (the demo's day, and a small day of its own).
import { afterEach, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Place, Snapshot, Task } from '@shared/types.ts'
import { EV, snapshot } from '../../demo/data.ts'

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const kernel = await import('@client/kernel.ts')
mock.module('@client/kernel.ts', () => ({ ...kernel, useSnap: () => kernel.getState().snap }))
const { getState, registry, setUI } = kernel
const plugin = (await import('./client.tsx')).default
const { needsPress, needsRows, Views } = await import('./views.tsx')
const { listNeeds } = await import('@client/needs-count.tsx')
const { needsFilter } = await import('@shared/needs-open.ts')
const { needsCount, tstate } = await import('@shared/view.ts')
const { chipsOf, choices, clean, filterTasks, groupNarrows, inView, NO_FILTER, pickView, startOfDay, viewCounts } = await import('@shared/task-filter.ts')

const ui0 = { ...getState().ui }
afterEach(() => { setUI({ ...ui0 }); Object.assign(getState(), { snap: null }) })
const demo = (mode: Parameters<typeof snapshot>[0] = 'normal') => snapshot(mode) as Snapshot
const text = (html: string) => html.replace(/<[^>]+>/g, '')

// a small day of its own: one repo on two machines, a task asked in one space and living in another
const place = (id: string, name: string, machine: string, x: Partial<Place> = {}): Place => ({ id, name, machine, level: 0, status: 'idle', chat: id, ...x }) as Place
const task = (id: string, pl: string, status: Task['status'], x: Partial<Task> = {}): Task => ({ id, name: id, place: pl, status, state: status, on: 'mini', created: '', age: '', ...x })
const DAY = new Date(2026, 10, 28, 9, 30).getTime()
const small = {
  host: 'mini',
  everything: 'home',
  places: [place('home', 'home', 'mini', { home: true }), place('shop', 'shop', 'mini'), place('blog', 'blog', 'mini'), place('vshop', 'shop', 'vm')],
  machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }, { id: 'm:vm', machine: 'vm', name: 'vm', status: 'idle' }],
  needs: [],
  tasks: [
    task('A', 'shop', 'work', { work: { name: 'shop', folder: '/w/shop', repo: true }, urgent: true }),
    task('B', 'vshop', 'work', { on: 'vm', work: { name: 'shop', folder: '/srv/shop', repo: true } }),
    task('C', 'shop', 'need', { stopped: { by: 'error' }, work: { name: 'shop', folder: '/w/shop', repo: true } }),
    task('D', 'shop', 'need', { stopped: { by: 'you' }, work: { name: 'site', folder: '/w/site', repo: true } }),
    // asked in blog, lives in shop
    task('E', 'shop', 'done', { asked: 'blog', doneAt: new Date(2026, 10, 28, 0, 0).getTime(), work: { name: 'site', folder: '/w/site', repo: true } }),
    task('F', 'shop', 'done', { doneAt: new Date(2026, 10, 27, 23, 59).getTime(), work: { name: 'shop', folder: '/w/shop', repo: true } }),
    task('G', 'blog', 'done', { doneAt: DAY - 60_000, archived: DAY }),
  ],
} as unknown as Snapshot
const ids = (snap: Snapshot, f: Partial<typeof NO_FILTER> & { view?: Parameters<typeof pickView>[1] }, now = DAY) => filterTasks(snap, { ...NO_FILTER, ...f }, 'home', now).map((t) => t.id).join('')

test('each view lists what its question asks: working, stopped, done today, urgent', () => {
  expect(ids(small, {})).toBe('ABCDEFG')
  // Working is the Working group's: Paused (stopped by you) is there too
  expect(ids(small, { view: 'working' })).toBe('ABD')
  // Stopped: every open task whose agent stopped, by an error or by you
  expect(ids(small, { view: 'stopped' })).toBe('CD')
  // Done today: finished since local midnight, never an archived one
  expect(ids(small, { view: 'today' })).toBe('E')
  expect(ids(small, { view: 'urgent' })).toBe('A')
})

test("Done today rolls over at this device's midnight", () => {
  // 23:59 yesterday is not today; midnight is
  expect(ids(small, { view: 'today' }, new Date(2026, 10, 28, 0, 0).getTime())).toBe('E')
  // a minute before midnight, the one done at 23:59 is still today's
  expect(ids(small, { view: 'today' }, new Date(2026, 10, 27, 23, 59, 30).getTime())).toContain('F')
  // the next day: neither
  expect(ids(small, { view: 'today' }, new Date(2026, 10, 29, 0, 0, 1).getTime())).toBe('')
  expect(startOfDay(DAY)).toBe(new Date(2026, 10, 28).getTime())
})

test('Needs you lists exactly what the red count counts, in every demo day and space', () => {
  for (const mode of ['normal', 'more', 'long', 'one', 'five'] as const) {
    const s = demo(mode)
    expect([mode, needsRows(s, NO_FILTER, EV)]).toEqual([mode, needsCount(s)])
    for (const p of s.places) expect([p.id, needsRows(s, needsFilter([p.id]), p.id)]).toEqual([p.id, needsCount(s, p.id)])
  }
  // its tasks are the ones with an action of yours; the view's count is the panel's own
  const s = demo()
  const yours = filterTasks(s, { ...NO_FILTER, view: 'needs' }, EV)
  expect(yours.length).toBeGreaterThan(3)
  expect(yours.every((t) => ['ask', 'ready', 'working'].includes(tstate(t)))).toBe(true)
})

test('Project: a repo on two machines names its machine, one on one machine does not; Space reads where it was asked', () => {
  expect(choices(small, 'repo', NO_FILTER, 'home', DAY).map((c) => `${c.label}|${c.machine ?? ''}|${c.n}`)).toEqual(['shop|mini|3', 'site||2', 'shop|vm|1'])
  expect(chipsOf(small, { ...NO_FILTER, repo: ['vm:/srv/shop', 'mini:/w/site'] }, 'home').map((c) => c.label)).toEqual(['shop · vm', 'site'])
  // E lives in shop but was asked in blog: Space counts it under blog
  expect(choices(small, 'space', NO_FILTER, 'home', DAY).map((c) => `${c.id} ${c.n}`)).toEqual(['shop 4', 'blog 2', 'vshop 1'])
  expect(ids(small, { space: ['blog'] })).toBe('EG')
  // a task from before `asked` was kept goes by the space it lives in
  expect(ids(small, { space: ['vshop'] })).toBe('B')
})

test("counts are for the view you're in and the other groups' picks; a group's own picks don't narrow it", () => {
  const n = (key: Parameters<typeof choices>[1], f: Partial<typeof NO_FILTER> & { view?: Parameters<typeof pickView>[1] }) => Object.fromEntries(choices(small, key, { ...NO_FILTER, ...f }, 'home', DAY).map((c) => [c.id, c.n]))
  expect(n('machine', {})).toEqual({ mini: 6, vm: 1 })
  expect(n('machine', { view: 'working' })).toEqual({ mini: 2, vm: 1 })
  // vm picked: the machine group still counts both, the others count vm's alone
  expect(n('machine', { machine: ['vm'] })).toEqual({ mini: 6, vm: 1 })
  expect(n('state', { machine: ['vm'] })).toEqual({ working: 1 })
  // a choice with none in the view goes, unless it is picked
  expect(n('state', { view: 'today' })).toEqual({ done: 1 })
  expect(n('state', { view: 'today', state: ['stopped'] })).toEqual({ done: 1, stopped: 0 })
  // and the views' own counts follow the sheet's picks
  expect(viewCounts(small, { ...NO_FILTER, machine: ['mini'] }, 'home', DAY)).toMatchObject({ working: 2, stopped: 2, today: 1, urgent: 1 })
  expect(viewCounts(small, NO_FILTER, 'home', DAY)).toMatchObject({ working: 3, stopped: 2, today: 1, urgent: 1 })
})

test('a view is kept with the filter, cleaned like it; picking one takes a red count off and keeps the picks', () => {
  expect(clean({ view: 'today' })).toEqual({ ...NO_FILTER, view: 'today' })
  expect(clean({ view: 'everything' as never })).toEqual(NO_FILTER)
  // State's old Needs you pick, kept from before: the Needs you view, which State no longer offers
  expect(clean({ state: ['needs'] })).toEqual({ ...NO_FILTER, view: 'needs' })
  // picked with another state it matched either, so it stays a State pick there (and State shows it, picked)
  expect(clean({ state: ['needs', 'done'] })).toEqual({ ...NO_FILTER, state: ['needs', 'done'] })
  expect(choices(demo(), 'state', { ...NO_FILTER, state: ['needs', 'done'] }, EV).map((c) => c.id)).toContain('needs')
  expect(choices(demo(), 'state', NO_FILTER, EV).map((c) => c.id)).not.toContain('needs')
  expect(pickView({ ...needsFilter(['shop']), machine: ['vm'] }, 'working')).toEqual({ ...NO_FILTER, machine: ['vm'], view: 'working' })
  expect(pickView({ ...NO_FILTER, view: 'today' }, undefined)).toEqual(NO_FILTER)
  expect(inView(small.tasks[0]!, undefined, DAY, new Set())).toBe(true)
})

test('a red count opens what it counts whatever view was kept', () => {
  const s = demo()
  Object.assign(getState(), { snap: s })
  setUI({ at: 'p:mac-mini:shop', pane: 'tasks', task: null, tab: 'Now', tf: { ...NO_FILTER, view: 'today', machine: ['vm'] } })
  expect(listNeeds(['p:mac-mini:shop'])).toBe(true)
  expect(getState().ui.tf).toEqual(needsFilter(['p:mac-mini:shop']))
  // the row shows it as Needs you, with the count it opened
  const html = renderToStaticMarkup(<Views snap={s} />)
  expect(html).toMatch(/aria-pressed="true"><span class="vl">Needs<span class="vy"> you<\/span><\/span><span class="cnt needs">(\d+)</)
  expect(html).toContain(`>${needsCount(s, 'p:mac-mini:shop')}</span>`)
  expect(html).toContain('aria-pressed="false"><span class="vl">All</span></button>')
  // pressing Needs you then keeps those spaces: the list it shows is the one its badge counts
  expect(needsPress(getState().ui.tf)).toEqual(needsFilter(['p:mac-mini:shop']))
  expect(needsPress({ ...NO_FILTER, view: 'today', machine: ['vm'] })).toEqual({ ...NO_FILTER, machine: ['vm'], view: 'needs' })
})

test("in Needs you the sheet counts its rows: each action of yours, and a space's own chat asking", () => {
  for (const mode of ['normal', 'more', 'five'] as const) {
    const base = demo(mode)
    // a space with no task of its own whose Shepherdr asks you in its chat
    const quiet = base.places.find((p) => !p.needs && !base.tasks.some((t) => (t.asked || t.place) === p.id))!
    const s = { ...base, places: base.places.map((p) => (p === quiet ? { ...p, needs: true } : p)) } as Snapshot
    const f = { ...NO_FILTER, view: 'needs' as const }
    const sum = (key: 'space' | 'machine') => choices(s, key, f, EV).reduce((n, c) => n + c.n, 0)
    // every row is in one space and on one machine, so each group's counts add up to the list
    expect(needsRows(s, f, EV)).toBe(needsCount(s))
    expect([mode, sum('space'), sum('machine')]).toEqual([mode, needsRows(s, f, EV), needsRows(s, f, EV)])
    // that space is still a choice, its chat counted
    expect(choices(s, 'space', f, EV).find((c) => c.id === quiet.id)?.n).toBe(1)
  }
})

test('a group with one choice shows when picking it leaves something out', () => {
  // vm has one task, in one project: nothing to narrow
  expect(groupNarrows(small, 'repo', { ...NO_FILTER, machine: ['vm'] }, 'home', DAY)).toBe(false)
  // blog has a site task and one in no project: picking site leaves the other out
  expect(choices(small, 'repo', { ...NO_FILTER, space: ['blog'] }, 'home', DAY).map((c) => c.label)).toEqual(['site'])
  expect(groupNarrows(small, 'repo', { ...NO_FILTER, space: ['blog'] }, 'home', DAY)).toBe(true)
  expect(groupNarrows(small, 'repo', NO_FILTER, 'home', DAY)).toBe(true)
})

test('the pane: the views row under Now; Needs you alone in its view; Done today open, only today\'s', () => {
  plugin.setup(registry)
  const Pane = registry.panes.find((p) => p.id === 'tasks')!.View
  const s = demo()
  Object.assign(getState(), { snap: s })
  setUI({ pane: 'tasks', task: null, tab: 'Now', tf: NO_FILTER, at: EV, open: {} })
  let html = renderToStaticMarkup(<Pane />)
  expect(html).toContain('class="vrow" role="group" aria-label="Views"')
  expect(text(html)).toContain(`AllNeeds you${needsCount(s)}More views`)
  // one row, above the chips and the list
  expect(html.indexOf('class="vrow"')).toBeLessThan(html.indexOf('class="grp"'))

  setUI({ tf: { ...NO_FILTER, view: 'needs' } })
  html = renderToStaticMarkup(<Pane />)
  const groups = [...html.matchAll(/class="grp" aria-expanded="(true|false)">([^<·]+) · (\d+)/g)].map((m) => [m[2]!.trim(), Number(m[3])])
  expect(groups).toEqual([['Needs you', needsCount(s)]])

  setUI({ tf: { ...NO_FILTER, view: 'today' } })
  html = renderToStaticMarkup(<Pane />)
  const rows = [...html.matchAll(/data-task-row="([^"]+)"/g)].map((m) => s.tasks.find((t) => t.id === m[1])!)
  const today = s.tasks.filter((t) => tstate(t) === 'done' && (t.doneAt ?? 0) >= startOfDay(Date.now()))
  expect(rows.map((t) => t.id).sort()).toEqual(today.map((t) => t.id).sort())
  if (today.length) expect(html).toContain('class="grp" aria-expanded="true">Done · ')
  // the picker's segment names the view, and Show all tasks when there is none
  expect(text(html)).toContain('Done today, view picked;')
  setUI({ tf: { ...NO_FILTER, view: 'urgent', machine: ['pi'] } })
  expect(text(renderToStaticMarkup(<Pane />))).toContain('No tasks match')
  Object.assign(getState(), { snap: { ...s, tasks: s.tasks.map((t) => ({ ...t, urgent: undefined })) } })
  setUI({ tf: { ...NO_FILTER, view: 'urgent' } })
  html = renderToStaticMarkup(<Pane />)
  expect(text(html)).toContain('Nothing urgent')
  expect(text(html)).toContain('Show all tasks')
})
