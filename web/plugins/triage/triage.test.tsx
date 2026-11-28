import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { attentionOf, projectAttention } from '@shared/attention.ts'
import { needsChats, needsItems } from '@shared/needs-open.ts'
import { isEverything, needsCount } from '@shared/view.ts'
import { snapshot } from '../../demo/data.ts'

// Settings › Triage and its yes cards (fork #235): the page shows a repo's keys with Same as Everything / Set here, its
// schedule's Pause, and nothing while the plugin is off; each card is one Needs you item in its repo's space, bound to
// its text's hash, with the exact words and Yes / No. Settings › Tasks keeps its Applies to picker (now shared).

const { getState, setUI } = await import('@client/kernel.ts')
const { AppliesTo, RepoPicker } = await import('@client/applies-to.tsx')
const { answerOf, batchShown, postWords, TriageCardView, TriageDraftsCard, TriageDraftsList, triageCards, whyWords } = await import('./client.tsx')
const { TriageSettings } = await import('./settings.tsx')

;(globalThis as { location?: unknown }).location ??= new URL('http://127.0.0.1/')
const ui0 = { ...getState().ui }
afterEach(() => { setUI({ ...ui0 }); Object.assign(getState(), { snap: null }) })
const text = (html: string) => html.replace(/<wbr\/?>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const SHOP = '/Users/sam/dev/shop'

function page(snap: Snapshot, repo: string | null) {
  Object.assign(getState(), { snap })
  setUI({ settings: { scope: 'all', sec: 'Triage', repo } })
  return text(renderToStaticMarkup(<TriageSettings place="all" />))
}

test('Settings › Tasks keeps its Applies to picker, now shared with Settings › Triage', () => {
  const snap = snapshot('normal') as Snapshot
  Object.assign(getState(), { snap })
  setUI({ settings: { scope: 'all', sec: 'Tasks', repo: null } })
  const settings = src('../../src/settings.tsx')
  expect(settings).toContain("import { AppliesTo, repoMachine, tilde } from './applies-to.tsx'")
  expect(settings).toContain('<AppliesTo snap={snap} repo={repo} />')
  expect(settings).not.toContain('function RepoPicker')
  expect(text(renderToStaticMarkup(<AppliesTo snap={snap} repo={undefined} />))).toContain('Applies to Everything')
  const shop = snap.config!.repos!.find((r) => r.key === SHOP)!
  expect(renderToStaticMarkup(<AppliesTo snap={snap} repo={shop} />)).toContain('aria-label="Applies to shop. Change"')
  // every repo on Tasks' picker, each machine's under its name; Triage's lists only this machine's
  const all = text(renderToStaticMarkup(<RepoPicker snap={snap} repos={snap.config!.repos!} value={null} onPick={() => {}} close={() => {}} />))
  expect(all).toContain('garden-app')
  const here = text(renderToStaticMarkup(<RepoPicker snap={snap} repos={snap.config!.repos!.filter((r) => !r.machine)} value={SHOP} onPick={() => {}} close={() => {}} />))
  expect(here).not.toContain('garden-app')
  expect(here).toContain('blog')
})

test('Settings › Triage: Everything sets the shared keys, a repo its level and its own values, with its schedule', () => {
  const snap = snapshot('triage') as Snapshot
  const all = page(snap, null)
  expect(all).toContain('Each repo is switched on by itself')
  expect(all).not.toContain('Same as Everything')
  for (const w of ['Fix from', 'Fixes a day', 'Ask me before merging its fixes']) expect(all).toContain(w)
  const shop = page(snap, SHOP)
  expect(shop).toContain('Score only')
  expect(shop).not.toContain('Set here · Reset') // the level is the repo's own: Off is its reset
  expect(shop).toContain('Same as Everything')
  expect(shop).toContain('in example/shop')
  expect(shop).toContain('Checks every hour, next in 24 min.')
  expect(shop).toContain('Pause')
  // another machine's repo is no choice here
  expect(page(snap, 'vm:/home/sam/dev/garden-app')).toContain('Each repo is switched on by itself')
})

test('a repo switched on with no schedule offers to make it; a paused one offers Resume', () => {
  const snap = snapshot('triage') as Snapshot
  const none = { ...snap, triage: { ...snap.triage!, repos: { ...snap.triage!.repos, [SHOP]: { ...snap.triage!.repos[SHOP]!, schedule: null } } } }
  expect(page(none, SHOP)).toContain('Make it')
  const paused = { ...snap, triage: { ...snap.triage!, repos: { ...snap.triage!.repos, [SHOP]: { ...snap.triage!.repos[SHOP]!, schedule: { ...snap.triage!.repos[SHOP]!.schedule!, paused: true } } } } }
  expect(page(paused, SHOP)).toContain('Resume')
})

test('the plugin switched off: no page, no cards, nothing in Needs you', () => {
  const on = snapshot('triage') as Snapshot
  const off = { ...on, config: { ...on.config!, triage: undefined }, triage: undefined } as Snapshot
  expect(page(off, SHOP)).toBe('')
  expect(triageCards(off, { place: on.places.find((p) => p.name === 'shop')!.id })).toEqual([])
  expect(projectAttention(off, Date.now()).actions.filter((a) => a.kind === 'triage')).toEqual([])
  expect(src('../../plugins.json')).toContain('"triage"')
  // the service's side: no config, no view, no action while it is off (service/next.ts, service/main.ts)
  const main = readFileSync(new URL('../../../service/main.ts', import.meta.url), 'utf8')
  expect(main).toContain('return pluginOn("triage") && triageView.last ? { ...snap, triage: triageView.last } : snap;')
  expect(main).toContain('if (!pluginOn("triage")) return json({ ok: false, error: "Triage is switched off in Settings › Plugins." });')
})

test("each card is one Needs you item in its repo's space, its hash in its id, and opens at its card", () => {
  const snap = snapshot('triage') as Snapshot
  const shop = snap.places.find((p) => p.id === snap.triage!.repos[SHOP]!.schedule!.space)!
  const acts = projectAttention(snap, Date.now()).actions.filter((a) => a.kind === 'triage')
  expect(acts.map((a) => [a.owner, a.place, a.card])).toEqual([['you', shop.id, 'triage:draft:f:t1c2'], ['you', shop.id, 'triage:start:41']])
  expect(acts[0]!.id).toContain('aaaaaaaaaaaa')
  // a changed text is a new question (a new id), not the old one answered
  const changed = { ...snap, triage: { ...snap.triage!, cards: snap.triage!.cards.map((c) => (c.kind === 'draft' ? { ...c, hash: 'c'.repeat(64) } : c)) } }
  expect(projectAttention(changed, Date.now()).actions.find((a) => a.card === 'triage:draft:f:t1c2')!.id).not.toBe(acts[0]!.id)
  const s2 = { ...snap, attention: projectAttention(snap, Date.now()) }
  expect(needsCount(s2, shop.id)).toBe(needsItems(s2, shop.id).length)
  const rows = needsChats(s2, [shop.id]).filter((i) => i.card?.startsWith('triage:'))
  expect(rows.map((r) => [r.title, r.sub])).toEqual([['Post this to GitHub?', 'The cart badge keeps the old count after an item is removed'], ['Start a fix for this?', 'Coupon field accepts an expired code']])
  // in #shop's chat, nowhere else
  expect(triageCards(snap, { place: shop.id }).map((c) => c.key)).toEqual(['triage:draft:f:t1c2', 'triage:start:41'])
  expect(triageCards(snap, { place: snap.everything! })).toEqual([])
  expect(isEverything(snap, shop.id)).toBe(false)
  expect(attentionOf(s2).actions.length).toBeGreaterThan(0)
})

test('a card shows the exact words, why they wait, and Yes / No; the start card asks to start a fix', () => {
  const snap = snapshot('triage') as Snapshot
  const [draft, start] = snap.triage!.cards
  const d = renderToStaticMarkup(<TriageCardView c={draft!} />)
  const t = text(d)
  expect(t).toContain('Post this to GitHub?')
  expect(t).toContain(whyWords(draft!))
  expect(t).toContain('Yes posts it to example/shop as a new issue, as written below.')
  expect(t).toContain(draft!.title)
  expect(d).toContain('Update the badge from the cart’s own change event')
  expect(t).toContain('No, keep it private')
  expect(t).toContain('Yes, post it')
  expect(d).toContain('role="region"')
  const s = text(renderToStaticMarkup(<TriageCardView c={start!} />))
  expect(s).toContain('Start a fix for this?')
  expect(s).toContain('example/shop#41 is marked ready')
  expect(s).toContain('Yes, start a fix')
  expect(whyWords({ ...draft!, why: 'private', found: ['an email, line 3'] })).toContain('an email, line 3')
  // a comment says which issue it goes on, and shows only what it posts (its body)
  const c = text(renderToStaticMarkup(<TriageCardView c={{ ...draft!, action: 'comment', issue: 12 }} />))
  expect(c).toContain('Yes posts it as a comment on example/shop#12, as written below.')
  expect(c).not.toContain(draft!.title)
  // too long to carry whole: no Yes, only No
  const cut = text(renderToStaticMarkup(<TriageCardView c={{ ...draft!, cut: true }} />))
  expect(cut).toContain('can only be kept private')
  expect(cut).not.toContain('Yes, post it')
  expect(cut).toContain('No, keep it private')
})

// "Triage: one card, not 150": more than 3 drafts in a space are one card in its chat and one row under Needs you; it
// opens their list, each draft its own card answered as before; start cards stay single; 3 or fewer stay single too
const shopOf = (snap: Snapshot) => snap.places.find((p) => p.id === snap.triage!.repos[SHOP]!.schedule!.space)!.id
const withDrafts = (snap: Snapshot, n: number): Snapshot => {
  const [draft, start] = snap.triage!.cards
  const drafts = Array.from({ length: n }, (_, i) => ({ ...draft!, id: `draft:f:x${i}`, key: `x${i}`, hash: String(i).padStart(64, 'e'), title: `Finding ${i}`, at: draft!.at + i }))
  return { ...snap, triage: { ...snap.triage!, cards: [...drafts, start!] } }
}

test('150 drafts are one card and one Needs you row; the start card stays single', () => {
  const snap = withDrafts(snapshot('triage') as Snapshot, 150)
  const shop = shopOf(snap)
  const cards = triageCards(snap, { place: shop })
  expect(cards.map((c) => c.key)).toEqual(['triage:drafts', 'triage:start:41'])
  const one = text(renderToStaticMarkup(<>{cards[0]!.node}</>))
  expect(one).toContain('150 findings wait to be posted to GitHub')
  expect(one).toContain('Show them')
  // it names the first of them (the shared group card, fork #279), never lists all 150
  expect(one).toContain('Finding 0, Finding 1 and 148 more')
  expect(one).not.toContain('Finding 2')
  // Needs you: one row for the drafts, opening their card, and the start card's own; the count is 2, not 151
  const s2 = { ...snap, attention: projectAttention(snap, Date.now()) }
  const acts = s2.attention.actions.filter((a) => a.kind === 'triage')
  expect(acts.map((a) => [a.id, a.card, a.drafts ?? null])).toEqual([[`triage:drafts:${shop}`, 'triage:drafts', 150], [expect.stringContaining('triage:start:41:'), 'triage:start:41', null]])
  expect(needsCount(s2, shop)).toBe(needsItems(s2, shop).length)
  expect(needsChats(s2, [shop]).filter((i) => i.card?.startsWith('triage:')).map((r) => r.title)).toEqual(['150 findings wait to be posted to GitHub', 'Start a fix for this?'])
  // the start card is exactly as before
  expect(renderToStaticMarkup(<>{cards[1]!.node}</>)).toBe(renderToStaticMarkup(<TriageCardView c={snap.triage!.cards.at(-1)!} />))
})

test('the list behind the one card shows each draft as its own card, oldest first, answered as before', () => {
  const snap = withDrafts(snapshot('triage') as Snapshot, 150)
  Object.assign(getState(), { snap })
  const shop = shopOf(snap)
  const html = renderToStaticMarkup(<TriageDraftsList place={shop} close={() => {}} />)
  // every draft's own card, the same markup as a single one (its Yes / No, its hash), and no start card
  expect(html.match(/data-card="triage:draft:/g)!.length).toBe(150)
  expect(html).toContain(renderToStaticMarkup(<TriageCardView c={snap.triage!.cards[0]!} />))
  expect(html.indexOf('Finding 0')).toBeLessThan(html.indexOf('Finding 1<'))
  expect(html).not.toContain('triage:start:41')
  // all answered while it is open: it says so, and only Close is left
  Object.assign(getState(), { snap: withDrafts(snapshot('triage') as Snapshot, 0) })
  expect(text(renderToStaticMarkup(<TriageDraftsList place={shop} close={() => {}} />))).toContain('Nothing waits to be posted')
  expect(renderToStaticMarkup(<TriageDraftsCard place={shop} n={4} />)).toContain('4 findings wait to be posted to GitHub')
})

test('2 drafts stay 2 cards, and 3; a 4th makes them one', () => {
  const base = snapshot('triage') as Snapshot
  const shop = shopOf(base)
  for (const [n, keys] of [[2, ['triage:draft:f:x0', 'triage:draft:f:x1', 'triage:start:41']], [3, ['triage:draft:f:x0', 'triage:draft:f:x1', 'triage:draft:f:x2', 'triage:start:41']], [4, ['triage:drafts', 'triage:start:41']]] as const) {
    const snap = withDrafts(base, n)
    expect(triageCards(snap, { place: shop }).map((c) => c.key)).toEqual([...keys])
    expect(projectAttention(snap, Date.now()).actions.filter((a) => a.kind === 'triage').map((a) => a.card)).toEqual([...keys])
  }
  // the demo's backlog day: 150 drafts and the start card in #shop
  const day = snapshot('drafts') as Snapshot
  expect(triageCards(day, { place: shopOf(day) }).map((c) => c.key)).toEqual(['triage:drafts', 'triage:start:41'])
})

// "Triage: one Yes posts all": the drafts one Yes can post are in the same one card, its list the batch review: every
// draft ticked, by kind, one Yes for the ticked set, then the held drafts each with its own answer
const withBatch = (snap: Snapshot, n: number, held: number): Snapshot => {
  const [draft, start] = snap.triage!.cards
  const items = Array.from({ length: n }, (_, i) => ({ key: `a${i}`, copy: false, rev: 1, hash: String(i).padStart(64, 'c'), title: `Batch ${i}`, body: `Text ${i}`, kind: i % 2 ? 'confusing' : 'bug', at: draft!.at - 100 + i }))
  const batch = { id: 'batch', kind: 'batch' as const, repo: 'example/shop', title: `${n} findings`, body: '', hash: 'f'.repeat(64), items, at: draft!.at - 100 }
  const drafts = Array.from({ length: held }, (_, i) => ({ ...draft!, id: `draft:f:x${i}`, key: `x${i}`, hash: String(i).padStart(64, 'e'), title: `Held ${i}`, at: draft!.at + i }))
  return { ...snap, triage: { ...snap.triage!, cards: [...(n ? [batch] : []), ...drafts, start!] } }
}

test('a batch is always in the one card, counted by its drafts; Needs you says one Yes posts them', () => {
  const base = snapshot('triage') as Snapshot
  const shop = shopOf(base)
  for (const [n, held, words, sub] of [[1, 0, '1 finding waits', 'One Yes posts the ones you tick'], [85, 65, '150 findings wait', 'One Yes posts 85 of them'], [2, 1, '3 findings wait', 'One Yes posts 2 of them']] as const) {
    const snap = withBatch(base, n, held)
    const cards = triageCards(snap, { place: shop })
    expect(cards.map((c) => c.key)).toEqual(['triage:drafts', 'triage:start:41'])
    const one = text(renderToStaticMarkup(<>{cards[0]!.node}</>))
    expect(one).toContain(words)
    expect(one).toContain('privacy check')
    const s2 = { ...snap, attention: projectAttention(snap, Date.now()) }
    const acts = s2.attention.actions.filter((a) => a.kind === 'triage')
    expect(acts.map((a) => [a.card, a.drafts ?? null, a.batch ?? null])).toEqual([['triage:drafts', n + held, n], ['triage:start:41', null, null]])
    expect(needsChats(s2, [shop]).find((i) => i.card === 'triage:drafts')!.sub).toBe(sub)
  }
  // with no batch, 3 held drafts stay single as before
  expect(triageCards(withBatch(base, 0, 3), { place: shop }).map((c) => c.key)).toEqual(['triage:draft:f:x0', 'triage:draft:f:x1', 'triage:draft:f:x2', 'triage:start:41'])
})

test('the list is the batch review: every draft ticked by kind, one Yes for them, then the held drafts with their own answer', () => {
  const snap = withBatch(snapshot('triage') as Snapshot, 4, 2)
  Object.assign(getState(), { snap })
  const html = renderToStaticMarkup(<TriageDraftsList place={shopOf(snap)} close={() => {}} />)
  const t = text(html)
  expect(t).toContain('6 findings wait to be posted to GitHub')
  expect(t).toContain('All 4 ticked')
  expect(t).toContain('Post all 4')
  // grouped by kind, Bugs first, each a checkbox row, ticked
  expect(t.indexOf('Bugs · 2')).toBeLessThan(t.indexOf('Confusing · 2'))
  expect(html.match(/role="checkbox" aria-checked="true"/g)!.length).toBe(5)
  // the held ones: their own cards, Yes and No each, after the batch; one bar at the sheet's foot, after them all (the shared group sheet's, fork #279)
  expect(html.match(/data-card="triage:draft:/g)!.length).toBe(2)
  expect(t.indexOf('Bugs · 2')).toBeLessThan(t.indexOf('Held 0'))
  expect(html.match(/class="cgrp-foot"/g)).toHaveLength(1)
  expect(html.lastIndexOf('Held 1')).toBeLessThan(html.indexOf('class="cgrp-foot"'))
  expect(text(html.slice(html.indexOf('class="cgrp-foot"')))).toMatch(/Close.*Post all 4/)
  expect(t).toContain('Your answer one by one · 2')
  expect(t).toContain('Yes, post it')
  // only a batch left: no held part
  Object.assign(getState(), { snap: withBatch(snapshot('triage') as Snapshot, 3, 0) })
  const only = text(renderToStaticMarkup(<TriageDraftsList place={shopOf(snap)} close={() => {}} />))
  expect(only).toContain('Post all 3')
  expect(only).not.toContain('Your answer one by one')
})

test('the demo backlog is one card of 150: 85 in the batch, 65 held', () => {
  const day = snapshot('drafts') as Snapshot
  const shop = shopOf(day)
  Object.assign(getState(), { snap: day })
  const t = text(renderToStaticMarkup(<>{triageCards(day, { place: shop })[0]!.node}</>))
  expect(t).toContain('150 findings wait to be posted to GitHub')
  expect(t).toContain('One Yes posts the 85 that passed the privacy check')
  expect(t).toContain('The other 65 wait for your answer one by one')
})

test('an open review keeps the list the person read: a change from elsewhere says so and posts nothing; their own Post takes the new one', () => {
  const base = snapshot('triage') as Snapshot
  const read = withBatch(base, 4, 0).triage!.cards[0]!
  const now = { ...read, hash: 'a'.repeat(64), items: read.items!.slice(1) }
  expect(batchShown(read, { ...read }, false)).toEqual({ list: read, stale: false })
  expect(batchShown(read, now, false)).toEqual({ list: read, stale: true })
  expect(batchShown(read, now, true)).toEqual({ list: now, stale: false })
})

test("a held draft's Yes in the review says it was given there, so it goes with the batch; its own card's doesn't", () => {
  const snap = withBatch(snapshot('triage') as Snapshot, 4, 2)
  const held = snap.triage!.cards.find((c) => c.kind === 'draft')!
  expect(answerOf(held, 'yes', true)).toEqual({ type: 'triage', do: 'answer', answer: 'yes', kind: 'draft', hash: held.hash, key: held.key, copy: !!held.copy, rev: held.rev, from: 'backlog' })
  expect(answerOf(held, 'yes')).not.toHaveProperty('from')
  // the review's held cards are the ones that say it; a card in Needs you stays as it was
  expect(src('./client.tsx')).toContain('node: <TriageCardView c={c} backlog />')
})

test("the bulk bar names its count: Post all N while all are ticked, Post N once one is unticked", () => {
  expect(postWords(85, 85)).toBe('Post all 85')
  expect(postWords(84, 85)).toBe('Post 84')
  expect(postWords(1, 1)).toBe('Post 1')
  expect(postWords(0, 85)).toBe('Nothing ticked')
})
