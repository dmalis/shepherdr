import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { EV, snapshot } from '../../demo/data.ts'

// dmalis/shepherdr#131: a task started by a space to work in another folder names that space on its row and over its
// title ("team-handbook · from #shop"), so "#shop only" listing it reads right. A task in its space's own folder reads
// as before.

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const { TaskWhere, fromSpace } = await import('./where.tsx')
const { RepoLine } = await import('./client.tsx')
const { chipsOf, filterTasks, NO_FILTER } = await import('@shared/task-filter.ts')

const all = snapshot()
const one: Snapshot = { ...all, machines: [all.machines[0]!] }
const SHOP = 'p:mac-mini:shop'
const shop = { name: 'shop', folder: '/Users/sam/dev/shop', short: '~/dev/shop', repo: true }
const handbook = { name: 'team-handbook', folder: '/Users/sam/dev/team-handbook', short: '~/dev/team-handbook', repo: true }
const base = { id: 'SHOP-1', name: 'A task', place: SHOP, status: 'work', state: 'work', on: 'mac-mini', created: '', age: '', started: 1, repo: 'branch' } as Task
const text = (html: string) => html.replace(/<[^>]+>/g, '')
const row = (snap: Snapshot, t: Task) => renderToStaticMarkup(<RepoLine snap={snap} t={t} />)
const head = (snap: Snapshot, t: Task) => renderToStaticMarkup(<TaskWhere snap={snap} t={t} onShow={() => {}} />)

test('in its space\'s own folder: no space named, the row and the header as before', () => {
  const t = { ...base, work: shop }
  expect(fromSpace(one, t)).toBe('')
  expect(text(row(one, t))).toBe('shop')
  expect(text(head(one, t))).toBe('shop')
  // a trailing slash on either side is the same folder
  expect(fromSpace(one, { ...t, work: { ...shop, folder: '/Users/sam/dev/shop/' } })).toBe('')
})

test('in another folder: the folder first, then the space it came from, then the machine', () => {
  const t = { ...base, work: handbook }
  expect(fromSpace(all, t)).toBe('#shop')
  expect(text(row(one, t))).toBe('team-handbook· from #shop')
  expect(text(row(all, t))).toBe('team-handbook· from #shop · mac-mini')
  expect(row(all, t)).toContain('aria-label="team-handbook from #shop · mac-mini, own branch: show its branch"')
  // the header over its title says the same, so the two agree
  expect(text(head(all, t))).toBe('team-handbook· from #shop · mac-mini')
  expect(head(all, t)).toContain('aria-label="in team-handbook on mac-mini, from #shop: show its tasks"')
  // the space and the machine are one run of words, which gives way from its end on a narrow phone
  expect(row(one, t)).toContain('<span class="rs">· from #shop</span>')
  expect(row(all, t)).toContain('<span class="rs">· from #shop · mac-mini</span>')
  expect(head(one, t)).toContain('<span class="t0s">· from #shop</span>')
  expect(head(all, t)).toContain('<span class="t0s">· from #shop · mac-mini</span>')
})

test('the same folder path on another machine is another folder: it names its space', () => {
  expect(fromSpace(all, { ...base, on: 'vm', work: shop })).toBe('#shop')
})

test('nothing more for a task from Everything, without a folder, or whose space is gone', () => {
  expect(fromSpace(all, { ...base, place: EV, work: handbook })).toBe('')
  expect(fromSpace(all, { ...base, work: undefined })).toBe('')
  expect(fromSpace(all, { ...base, place: '', work: handbook })).toBe('')
  expect(fromSpace(all, { ...base, place: 'p:mac-mini:gone', work: handbook })).toBe('')
})

test('the demo has one: #shop\'s task in team-handbook', () => {
  const t = all.tasks.find((x) => x.id === 'SHOP-22')!
  expect(text(row(all, t))).toContain('team-handbook· from #shop')
})

test('the seam it explains: "#shop only" keeps the tasks #shop started, in any folder, and its chip says "#shop only"', () => {
  const t = { ...base, id: 'X-1', work: handbook }
  const snap = { ...all, tasks: [t] }
  const f = { ...NO_FILTER, here: true }
  expect(filterTasks(snap, f, SHOP).map((x) => x.id)).toEqual(['X-1'])
  expect(chipsOf(snap, f, SHOP)[0]!.label).toBe(`${fromSpace(snap, t)} only`)
})

test('on a narrow line the machine gives way first, then the space (its own …), the folder last', () => {
  const css = readFileSync(new URL('./where.css', import.meta.url), 'utf8')
  expect(css).toContain('.rline .rs,.t0s{flex:0 1000000 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
})
