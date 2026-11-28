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
const { TriageCardView, TriageSettings, triageCards, whyWords } = await import('./client.tsx')

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
