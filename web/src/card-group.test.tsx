import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { TRIAGE_GROUP_OVER } from '@shared/attention.ts'
import { snapshot } from '../demo/data.ts'

// fork #279: a run of one kind of chat card is one card past 3 (GROUP_OVER, as Android bundles 4 or more notifications
// from one app), whose Show them lists each card as it was. Each kind that piles up holds the same threshold: Triage's
// drafts, reviews waiting for you, stopped agents. Hands cards (a step on an agent's own screen) stay one by one, as
// does every card in a task's own thread.

const { getState } = await import('./kernel.ts')
const { GROUP_OVER, GroupCard, GroupSheet, groupCards, withGroups } = await import('./card-group.tsx')
const { TASK_KINDS } = await import('@plugins/tasks/groups.ts')
const tasksPlugin = (await import('@plugins/tasks/client.tsx')).default
const { handsCards } = await import('@plugins/screens/client.tsx')

;(globalThis as { location?: unknown }).location ??= new URL('http://127.0.0.1/')
afterEach(() => void Object.assign(getState(), { snap: null }))
const text = (html: string) => html.replace(/<wbr\/?>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')

/** the tasks plugin's chat cards, as its setup registers them (with its groups) */
type Cards = (snap: Snapshot, thread: { chat: string; place: string; task?: Task; where: 'chat' }) => { key: string; at?: number; node: unknown }[]
function tasksCards(): Cards {
  const got: Cards[] = []
  const reg = new Proxy({} as Record<string, unknown>, {
    get: (o, k: string) => (k === 'chatCards' ? { push: (c: { cards: Cards }) => got.push(c.cards) } : (o[k] ??= k === 'views' ? {} : []) ),
  })
  tasksPlugin.setup(reg as never)
  return got[0]!
}

const base = () => snapshot('normal') as Snapshot
const ev = (snap: Snapshot) => ({ chat: snap.places.find((p) => p.id === snap.everything)!.chat, place: snap.everything!, where: 'chat' as const })
/** n more tasks in one space, each made from `like` */
function more(snap: Snapshot, n: number, x: Partial<Task>): Snapshot {
  const place = snap.places.find((p) => p.name === 'shop')!.id
  const add = Array.from({ length: n }, (_, i) => ({ ...snap.tasks[0]!, id: `GRP-${i}`, name: `Grouped ${i}`, place, asked: place, archived: false, needsAt: Date.now() - (n - i) * 60_000, ...x }) as Task)
  return { ...snap, tasks: [...snap.tasks, ...add] }
}
const ready = { status: 'ready', state: 'ready', stopped: undefined } as Partial<Task>
const stopped = { status: 'need', state: 'need', stopped: { by: 'error', why: 'its session ended' } } as Partial<Task>
const keys = (cards: { key: string }[], prefix: string) => cards.map((c) => c.key).filter((k) => k.startsWith(prefix) || k === prefix.replace(/:$/, ''))

test('one threshold for every kind: more than 3, as Triage', () => {
  expect(GROUP_OVER).toBe(3)
  expect(TRIAGE_GROUP_OVER).toBe(GROUP_OVER)
})

test('the generic grouping: 3 stay, a 4th makes one card where the newest came up, the rest untouched', () => {
  const kind = { id: 'many', is: (c: { key: string }) => c.key.startsWith('k:'), title: (n: number) => `${n} wait`, none: 'None', label: 'Many' }
  const mk = (n: number) => [{ key: 'other', at: 1, node: null }, ...Array.from({ length: n }, (_, i) => ({ key: `k:${i}`, at: 10 + i, node: null })), { key: 'last', at: 99, node: null }]
  const snap = base()
  const th = ev(snap)
  expect(groupCards(mk(3), snap, th, [kind], () => mk(3)).map((c) => c.key)).toEqual(['other', 'k:0', 'k:1', 'k:2', 'last'])
  const four = groupCards(mk(4), snap, th, [kind], () => mk(4))
  expect(four.map((c) => c.key)).toEqual(['other', 'many', 'last'])
  expect(four[1]!.at).toBe(13)
  // it waits below a later message any one of them waits under
  const after = groupCards(mk(4).map((c) => (c.key === 'k:0' ? { ...c, after: (m: { text?: string }) => m.text === 'news' } : c)), snap, th, [kind], () => mk(4))
  expect(after[1]!.after!({ at: 50, text: 'news' } as never)).toBe(true)
  expect(after[1]!.after!({ at: 50, text: 'else' } as never)).toBe(false)
})

test('reviews waiting for you: 3 stay single in a chat, a 4th makes one card; a merging one stays its own', () => {
  const cards = tasksCards()
  // the demo's day has none waiting, so the count is only these (Everything's chat holds every space's)
  const s0 = { ...base(), tasks: base().tasks.filter((t) => t.status !== 'ready') }
  const had = 0
  const three = more(s0, GROUP_OVER - had, ready)
  expect(keys(cards(three, ev(three)), 'review:GRP-').length).toBe(GROUP_OVER)
  expect(keys(cards(three, ev(three)), 'reviews')).toEqual([])
  const four = more(s0, GROUP_OVER - had + 1, ready)
  const got = cards(four, ev(four))
  expect(keys(got, 'reviews')).toEqual(['reviews'])
  expect(got.filter((c) => c.key.startsWith('review:') && four.tasks.find((t) => `review:${t.id}` === c.key)?.status === 'ready')).toEqual([])
  const one = text(renderToStaticMarkup(<>{got.find((c) => c.key === 'reviews')!.node}</>))
  expect(one).toContain(`${GROUP_OVER + 1} tasks wait for your review`)
  expect(one).toContain('Show them')
  // it names the first of them, as Android's group summary carries some of each one's text
  expect(one).toContain('Grouped 0, Grouped 1 and 2 more')
  // the demo's own day: 6 tasks wait for a review in Everything's chat, one card
  const day = base()
  expect(keys(cards(day, ev(day)), 'reviews')).toEqual(['reviews'])
  // one being merged waits for no one: it stays where it is, and the rest still count
  const merging = more(s0, GROUP_OVER - had + 2, ready)
  merging.tasks.at(-1)!.status = 'merging'
  const m = cards(merging, ev(merging))
  expect(keys(m, 'reviews')).toEqual(['reviews'])
  expect(m.some((c) => c.key === `review:${merging.tasks.at(-1)!.id}`)).toBe(true)
})

test('stopped agents: 3 stay single, a 4th makes one card', () => {
  const cards = tasksCards()
  const s0 = { ...base(), tasks: base().tasks.filter((t) => !t.stopped || t.stopped.by === 'you') }
  const three = more(s0, 3, stopped)
  expect(keys(cards(three, ev(three)), 'stopped:').length).toBe(3)
  const four = more(s0, 4, stopped)
  const got = cards(four, ev(four))
  expect(keys(got, 'stopped:')).toEqual([])
  expect(keys(got, 'stops')).toEqual(['stops'])
  expect(text(renderToStaticMarkup(<>{got.find((c) => c.key === 'stops')!.node}</>))).toContain('4 tasks stopped')
})

test("a task's own thread never groups: its one card is its own", () => {
  const cards = tasksCards()
  const four = more(base(), 5, ready)
  const t = four.tasks.at(-1)!
  expect(cards(four, { chat: `${t.id}/worker`, place: t.place, task: t, where: 'chat' }).map((c) => c.key)).toContain(`review:${t.id}`)
})

test('the sheet lists each card as it is in the chat, read live, oldest first; answered, it says so', () => {
  const s = more(base(), 5, ready)
  Object.assign(getState(), { snap: s })
  const cards = tasksCards()
  const all = cards(s, ev(s))
  const html = renderToStaticMarkup(<GroupSheet title="5 wait" note="One by one." items={[{ key: 'a', node: <i>first</i> }, { key: 'b', node: <i>second</i> }]} bulk={<p>Post all</p>} close={() => {}} />)
  expect(text(html)).toContain('5 wait One by one. Post all first second Close')
  expect(text(renderToStaticMarkup(<GroupSheet title="Nothing" items={[]} close={() => {}} />))).toBe(' Nothing Close ')
  // the reviews sheet: every waiting review's own card, the same markup as in the chat
  const sheet = (all.find((c) => c.key === 'reviews')!.node as { props: { sheet: (close: () => void) => React.ReactNode } }).props.sheet
  const listed = renderToStaticMarkup(<>{sheet(() => {})}</>)
  expect(listed.match(/data-card="review:/g)!.length).toBe(s.tasks.filter((t) => t.status === 'ready' && !t.archived).length)
  expect(listed.indexOf('Grouped 0')).toBeLessThan(listed.indexOf('Grouped 1'))
  // a group card names itself to screen readers by its words, and Show them is its one button
  const card = renderToStaticMarkup(<GroupCard id="x:y" title="4 wait" sub="Why" label="X" sheet={() => null} />)
  expect(card).toContain('aria-labelledby="cgrp-x-y-q"')
  expect(card).toContain('data-ask=""')
  expect(renderToStaticMarkup(<GroupCard id="x" title="4" label="X" sheet={() => null} ask={false} />)).not.toContain('data-ask')
})

test('hands cards stay one by one, however many: each is a step on an agent’s own screen', () => {
  const s0 = base()
  const s = more(s0, 5, { status: 'need', state: 'need' })
  const screens = { ...(s.screens ?? {}) }
  for (const t of s.tasks.filter((x) => x.id.startsWith('GRP-'))) screens[`task:${t.id}`] = { hands: { what: 'Sign in to the shop' } } as never
  const snap = { ...s, screens }
  const got = handsCards(snap, ev(snap) as never).map((c) => c.key).filter((k) => k.startsWith('hands:GRP-'))
  expect(got.length).toBe(5)
})

test('the seams it relies on: one call at the tasks plugin, none at screens, Triage on the shared card', () => {
  expect(src('../plugins/tasks/client.tsx')).toContain('reg.chatCards.push({ order: 20, cards: withGroups(taskCards, TASK_KINDS) })')
  expect(src('../plugins/screens/client.tsx')).toContain('reg.chatCards.push({ order: 30, cards: handsCards })')
  const triage = src('../plugins/triage/client.tsx')
  expect(triage).toContain('<GroupCard id={TRIAGE_DRAFTS}')
  expect(triage).toContain('<GroupSheet')
  expect(typeof withGroups).toBe('function')
  // upstream's card shape the grouping reads (kernel.ts Registry.chatCards)
  expect(src('./kernel.ts')).toContain('chatCards: { order: number; cards: (snap: Snapshot, thread: Thread) => { key: string; at?: number; past?: boolean; after?: (m: Message) => boolean; node: ReactNode }[] }[]')
})

test('the demo’s ?case=cards: in #shop’s chat, Triage’s drafts, the reviews and the stopped agents are one card each', async () => {
  const day = snapshot('cards') as Snapshot
  const shop = day.places.find((p) => p.name === 'shop')!
  const th = { chat: shop.chat, place: shop.id, where: 'chat' as const }
  expect(tasksCards()(day, th).map((c) => c.key).filter((k) => k === 'reviews' || k === 'stops')).toEqual(['reviews', 'stops'])
  const { triageCards } = await import('@plugins/triage/client.tsx')
  expect(triageCards(day, th).map((c) => c.key)).toContain('triage:drafts')
})
