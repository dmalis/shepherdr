// Radar, the clickable prototype (dmalis/shepherdr "Radar: one place for work coming in"): off for every real user and
// not in their Settings › Plugins, the demo's ?case=radar day loads with its one card under Needs you, and the list's
// row is red while that card asks (its own button, opening the card) and grey once it is answered (opening what it
// counts). The seams it leans on are pinned: views.feedbackRow and reg.middle, Triage cards in Needs you.
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { projectAttention } from '@shared/attention.ts'
import { snapshot } from '../../demo/data.ts'
import { radarCard } from '../../demo/radar.ts'
import { askCards, at, clock, dayOf, editProject, itemsAt, reset, resume, rowCount, setView, shownDay, useRadar, waiting, type RadarDemo } from './model.ts'
import { liveOf, RadarRow, radarNeeds } from './row.tsx'
import { APPROVED, queue, stateWords } from './say.ts'
import { dayGroup, events, recap, weeks } from './timeline.ts'
import { Timeline } from './timeline.tsx'
import { clearPress, press, pressOf, waiting as pressWaits } from '@client/pending.ts'

;(globalThis as { location?: unknown }).location ??= new URL('http://127.0.0.1/')
const root = join(import.meta.dir, '..', '..', '..')
const radarOf = (s: Snapshot) => (s as Snapshot & { radar?: RadarDemo }).radar
const CARD = 'triage:draft:f:err7'
const day = () => {
  const s = snapshot('radar')
  return { ...s, attention: projectAttention(s) }
}
/** the same day once the card was answered: the card gone, the answer kept (as the demo's service does) */
const answered = (yes: boolean): Snapshot => {
  const s = snapshot('radar')
  const r = radarOf(s)!
  const t = { ...s, triage: { ...s.triage!, cards: [] }, radar: { ...r, answers: { [CARD]: yes ? 'yes' : 'no' } } } as Snapshot
  return { ...t, attention: projectAttention(t) }
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
const withSettings = <T,>(everywhere: unknown, f: () => T): T => {
  const was = process.env.HERDR_TASK_SETTINGS
  const file = join(mkdtempSync(join(tmpdir(), 'shep-radar-')), 'settings.json')
  writeFileSync(file, JSON.stringify({ everywhere }))
  process.env.HERDR_TASK_SETTINGS = file
  try {
    return f()
  } finally {
    if (was === undefined) delete process.env.HERDR_TASK_SETTINGS
    else process.env.HERDR_TASK_SETTINGS = was
  }
}

test('off for every real user and not in their Settings › Plugins: only the demo sends its day', async () => {
  const { PLUGINS, offPlugins, setConfig } = await import('../../../service/next.ts')
  expect(PLUGINS.find((p) => p.id === 'radar')).toEqual({ id: 'radar', name: 'Radar (prototype)', offByDefault: true, demo: true })
  // off by default, and off even when a settings file names it on
  expect(withSettings({}, () => offPlugins())).toContain('radar')
  expect(withSettings({ plugins_on: ['radar'] }, () => offPlugins())).toContain('radar')
  // Settings › Plugins lists only the rest, and no switch can turn it on
  const next = readFileSync(join(root, 'service', 'next.ts'), 'utf8')
  expect(next).toContain('plugins: PLUGINS.filter((p) => !p.demo).map(')
  expect(() => withSettings({}, () => setConfig('all', 'plugin.radar', true))).toThrow('only the demo shows it')
  // the real service never sends a Radar day: no service file names it
  expect(readFileSync(join(root, 'service', 'main.ts'), 'utf8')).not.toContain('radar')
  // every other demo day has none, so the list keeps the Feedback row there
  for (const mode of ['normal', 'triage', 'empty'] as const) expect(radarOf(snapshot(mode))).toBeUndefined()
})

test('the plugin takes the Feedback row only while Feedback has it, so the shell’s old Feedback row is never hidden', async () => {
  expect(JSON.parse(readFileSync(join(root, 'web', 'plugins.json'), 'utf8')).plugins).toContain('radar')
  const plugin = (await import('./client.tsx')).default
  // Feedback switched off: no row set, so the shell draws its own (the old box)
  const off = { views: {} as { feedbackRow?: unknown }, middle: [] as unknown[] }
  plugin.setup(off as never)
  expect(off.views.feedbackRow).toBeUndefined()
  expect(off.middle).toHaveLength(1)
  // Feedback on: Radar's row wraps it
  const Feedback = () => null
  const on = { views: { feedbackRow: Feedback } as { feedbackRow?: unknown }, middle: [] as unknown[] }
  plugin.setup(on as never)
  expect(on.views.feedbackRow).not.toBe(Feedback)
  expect(typeof on.views.feedbackRow).toBe('function')
  // the kernel and the shell still have both places, and the shell's own row when none is set
  const kernel = readFileSync(join(root, 'web', 'src', 'kernel.ts'), 'utf8')
  expect(kernel).toMatch(/feedbackRow\?:/)
  expect(kernel).toMatch(/middle:/)
  expect(readFileSync(join(root, 'web', 'src', 'list.tsx'), 'utf8')).toContain('registry.views.feedbackRow ? <registry.views.feedbackRow /> : <Row icon="feedback" label="Feedback"')
})

test('the demo case loads: its four projects, and its one card counted under Needs you', () => {
  const serve = readFileSync(join(root, 'web', 'demo', 'serve.ts'), 'utf8')
  expect(serve).toContain("c === 'radar'")
  const s = day()
  const r = radarOf(s)!
  expect(r.projects.map((p) => p.name)).toEqual(['Shepherdr', 'shop', 'blog', 'garden-app'])
  expect(r.projects.map((p) => p.level)).toEqual(['fix', 'fix', 'none', 'score'])
  expect(r.projects.find((p) => p.id === 'garden')!.paused).toBeNumber()
  // the fixtures: held for each reason, parked ones that come back, and the three ways a fix ships
  expect(r.items.filter((i) => i.state === 'held').map((i) => i.held!.why).sort()).toEqual(['cap', 'checks', 'stale'])
  expect(new Set(r.items.filter((i) => i.shipped).map((i) => i.shipped!.how))).toEqual(new Set(['live', 'merged', 'reverted']))
  // the paused project has one finished draft, which waits for Resume
  expect(r.items.filter((i) => i.project === 'garden' && i.draft && i.state === 'next')).toHaveLength(1)
  // a sighting is a task: as many distinct ones as the item says hit it
  const top = r.items.find((i) => i.id === 'r-base')!
  expect(new Set(top.sightings!.map((x) => x.who)).size).toBe(top.tasks!)
  const now = Date.now()
  expect(itemsAt(r, now).filter((i) => i.later?.returned && i.state === 'new')).toHaveLength(0)
  expect(itemsAt(r, clock(now, { later: true })).filter((i) => i.later?.returned && i.state === 'new').map((i) => i.id).sort()).toEqual(['r-theme', 'r-voice'])
  // Needs you holds the error's card, the person's, as every Triage card
  const a = s.attention!.actions.find((x) => x.card === CARD)
  expect(a?.owner).toBe('you')
  expect(a?.kind).toBe('triage')
  expect(liveOf(s).cards.has(CARD)).toBe(true)
})

test('the demo never suggests automating away a provider’s trust prompt', () => {
  const words = JSON.stringify(radarOf(day())) + JSON.stringify(radarCard(Date.now()))
  expect(words).not.toMatch(/trust/i)
})

test('red is its own button, opening the one card as Needs you does; grey names what it counts and opens exactly those', () => {
  const red = renderToStaticMarkup(<RadarRow snap={day()} />)
  expect(red).toContain('class="ncnt"')
  expect(red).toContain('aria-label="Radar: 1 needs you"')
  expect(red).toMatch(/class="cnt needs">1</)
  // the count's button opens the card itself, where it waits in #shop, the same item Needs you opens
  const asks = radarNeeds(day(), [CARD])
  expect(asks).toHaveLength(1)
  expect(asks[0]!.card).toBe(CARD)
  // grey counts what could become work now (new and next up, not paused): Shepherdr's three, named
  const grey = renderToStaticMarkup(<RadarRow snap={answered(true)} />)
  expect(grey).toContain('aria-label="Radar, 3 new or next up"')
  expect(grey).toMatch(/class="cnt">3</)
  expect(grey).not.toContain('needs')
  const r = radarOf(answered(true))!
  expect(itemsAt(r, Date.now(), liveOf(answered(true))).filter((i) => waiting(i, r)).map((i) => i.id).sort()).toEqual(['r-badge', 'r-base', 'r-new'])
  // the row opens All items on that filter, every project
  expect(readFileSync(join(import.meta.dir, 'row.tsx'), 'utf8')).toContain("openRadar({ tab: 'all', project: null, filter: 'waiting' })")
  // the prototype's new install: one project not set up, nothing found, so the row is the plain name
  setView({ fresh: true })
  try {
    const plain = renderToStaticMarkup(<RadarRow snap={answered(true)} />)
    expect(text(plain).trim()).toBe('Radar')
    expect(plain).not.toContain('class="cnt')
    expect(shownDay(radarOf(day())!, { fresh: true })!.projects.map((p) => p.level)).toEqual(['none'])
  } finally {
    setView({ fresh: false })
  }
})

test('a new install keeps its project once it is watched, and Start over brings the day and the shared card back', () => {
  const s = day()
  const d = dayOf(radarOf(s))!
  editProject('blog', { level: 'watch' })
  const shown = shownDay(useRadarDay(), { fresh: true })!
  expect(shown.projects.map((p) => [p.id, p.level])).toEqual([['blog', 'watch']])
  reset()
  expect(useRadarDay()!.projects.find((p) => p.id === 'blog')!.level).toBe('none')
  expect(d).toBeTruthy()
  // Start over asks the demo's service for the day again, which puts the card back in #shop and Needs you
  expect(readFileSync(join(import.meta.dir, 'page.tsx'), 'utf8')).toContain("act({ type: 'radar', do: 'reset' })")
  expect(readFileSync(join(root, 'web', 'demo', 'serve.ts'), 'utf8')).toContain("if (a.type === 'radar' && a.do === 'reset') {\n    state.radar = structuredClone(snapshot('radar'))")
})

test('Start over: the card that comes back can be answered at once (the Yes pressed on it is forgotten)', async () => {
  dayOf(radarOf(day()))
  expect(askCards()).toEqual([CARD])
  // a held Yes: the card's buttons wait until the card moves on; the same card back (same id and words) would still wait
  const at = radarCard(Date.now()).hash
  await press(CARD, at, 'yes', async () => null)
  expect(pressWaits(pressOf(CARD, at))).toBe(true)
  // what Start over does with each of the day's cards once the service has put them back
  askCards().forEach(clearPress)
  expect(pressOf(CARD, at)).toBeUndefined()
  expect(readFileSync(join(import.meta.dir, 'page.tsx'), 'utf8')).toContain(".finally(() => cards.forEach(clearPress))")
})

test('Resume posts the paused project’s finished draft: out of the queue, its issue named, not counted grey', () => {
  reset()
  const d0 = dayOf(radarOf(day()))!
  const garden = d0.projects.find((p) => p.id === 'garden')!
  expect(queue(d0.items, 'garden').map((i) => i.id)).toEqual(['r-gdraft'])
  expect(resume('garden')).toEqual(['example/garden-app#58'])
  const d = useRadarDay()!
  const i = d.items.find((x) => x.id === 'r-gdraft')!
  expect(d.projects.find((p) => p.id === 'garden')!.paused).toBeUndefined()
  expect(i).toMatchObject({ draft: undefined, posted: 'example/garden-app#58' })
  expect(stateWords(i)).toBe('Posted · example/garden-app#58')
  expect(queue(d.items, 'garden')).toEqual([])
  expect(waiting(i, d)).toBe(false)
  expect(garden.level).toBe('score')
  reset()
  expect(useRadarDay()!.items.find((x) => x.id === 'r-gdraft')!.draft).toBe(true)
})

test('Project pulse: a project’s red count is its own button and opens the card, the row opens the project', () => {
  const page = readFileSync(join(import.meta.dir, 'page.tsx'), 'utf8')
  const pulse = page.slice(page.indexOf('function Pulse('), page.indexOf('/* ---------- Next up'))
  expect(pulse).toContain('<NeedsCount n={red} of={p.name} onOpen={() => (cards.length ? openNeeds(cards,')
  expect(pulse).not.toContain('className="cnt needs"')
  // the count sits beside the row's button, not inside it
  expect(pulse.indexOf('</button>')).toBeLessThan(pulse.indexOf('<NeedsCount'))
})
// the page's own copy of the day, as the page reads it (outside React: the store's snapshot)
const useRadarDay = () => {
  let out: RadarDemo | null = null
  const Probe = () => ((out = useRadar().day), null)
  renderToStaticMarkup(<Probe />)
  return out as RadarDemo | null
}

test('parked for 30 days or until 3 more report it: back a week later, saying why', () => {
  const now = Date.now(), DAY = 86400_000
  const i = { ...radarOf(day())!.items.find((x) => x.id === 'r-base')!, state: 'later' as const, later: { until: now + 30 * DAY, soon: now + 5 * DAY, returned: 'Came back early: 3 more tasks reported it since you parked it.' } }
  expect(at(i, now).state).toBe('later')
  expect(at(i, clock(now, { later: true }))).toMatchObject({ state: 'new', reason: 'Came back early: 3 more tasks reported it since you parked it.' })
})

test('one story for the approval: the card says Yes starts a fix too, and after Yes it is being built, for you to merge', async () => {
  const yes = answered(true), no = answered(false)
  const item = (s: Snapshot) => itemsAt(radarOf(s)!, Date.now(), liveOf(s)).find((i) => i.id === 'r-err')!
  expect(item(yes)).toMatchObject({ approved: true, state: 'running' })
  expect(stateWords(item(yes))).toBe('Fix being built · you’ll review and merge')
  expect(APPROVED).toBe('Fix being built · you’ll review and merge')
  expect(item(no)).toMatchObject({ state: 'declined' })
  expect(item(no).needs).toBeUndefined()
  // the shared card itself says the whole effect, right above its Yes
  const { TriageCardView } = await import('../triage/client.tsx')
  const card = text(renderToStaticMarkup(<TriageCardView c={radarCard(Date.now())} />))
  expect(card).toMatch(/Yes also starts a fix\. You review and merge it\. No, keep it private Yes, post it/)
  // a card without it says only what it posts, as before
  const plain = text(renderToStaticMarkup(<TriageCardView c={{ ...radarCard(Date.now()), then: undefined }} />))
  expect(plain).not.toContain('starts a fix')
  // #shop's other question (the payment task's) is answered that day, so no "1 question below" pill covers this Yes
  const s = snapshot('radar')
  expect(snapshot('normal').tasks.find((t) => t.id === 'SHOP-14')).toMatchObject({ status: 'need', blocked: 'question' })
  expect(s.tasks.find((t) => t.id === 'SHOP-14')).toMatchObject({ status: 'work', blocked: undefined })
  expect(readFileSync(join(root, 'web/demo/serve.ts'), 'utf8')).toMatch(/mode === 'radar'\) chat = .*q-pay/)
})

test('with nothing open and nothing asking, the row is the name alone', () => {
  const r: RadarDemo = { looked: 0, projects: [], items: [] }
  expect(rowCount(r, { cards: new Set(), answers: {} }, Date.now())).toEqual({ n: 0, red: false })
})

/* ---------- the calm timeline, the default opening ---------- */

const tlOf = (s: Snapshot, project: string | null = null, fresh = false) => {
  const r = shownDay(radarOf(s)!, { fresh })!
  const now = Date.now(), live = liveOf(s)
  const items = itemsAt(r, now, live)
  return { snap: s, view: { ...useRadarView(), project, item: null }, live, now, items, projects: r.projects }
}
const useRadarView = () => {
  let out: ReturnType<typeof useRadar>['view'] | null = null
  const Probe = () => ((out = useRadar().view), null)
  renderToStaticMarkup(<Probe />)
  return out!
}
const lines = (c: ReturnType<typeof tlOf>) => events(c.items, c.projects, c.live, c.now, c.view.project).map((e) => e.words + (e.status ? ` · ${e.status}` : ''))

test('the calm timeline is the opening screen, the prototype’s controls folded, the other three kept to compare', () => {
  const v = useRadarView()
  expect(v.opening).toBe('timeline')
  expect(v.proto).toBe(false)
  const page = readFileSync(join(import.meta.dir, 'page.tsx'), 'utf8')
  expect(page).toContain("[['timeline', 'Calm timeline'], ['since', 'Since you last looked'], ['pain', 'Pain map'], ['pulse', 'Project pulse']]")
  // no tabs on it: the bar is the project filter and Jot something alone
  expect(page).toContain("const calm = view.opening === 'timeline' && view.tab === 'overview'")
  expect(page).toContain('? <div className="rd-bar">{filter}{jot}</div>')
})

test('one short line an event, newest first: what shipped and what’s next are events, what needs you is pinned instead', () => {
  const c = tlOf(day())
  const ls = lines(c)
  expect(ls).toContain('Review stall fixed · holding')
  expect(ls).toContain('Old-main starts · rising, next up')
  expect(ls).toContain('Review buttons wrap · reverted')
  expect(ls).toContain('garden-app paused')
  expect(ls).toContain('Seed list order · waits for Resume')
  // the error whose card asks is not an event: it is the pinned line
  expect(ls.some((l) => l.startsWith('Empty-cart checkout error'))).toBe(false)
  const es = events(c.items, c.projects, c.live, c.now, null)
  expect(es.map((e) => e.at)).toEqual([...es.map((e) => e.at)].sort((a, b) => b - a))
  // every line is short: a few words and a status, never the paragraph (that opens on tap)
  for (const l of ls) expect(l.length).toBeLessThanOrEqual(48)
  const html = text(renderToStaticMarkup(<Timeline c={c} onSetup={() => undefined} setupEmpty={() => null} />))
  expect(html).toContain('shop needs you · Checkout fails on an empty cart')
  expect(html).toMatch(/This week: 10 fixed · 1 reverted · 1 waits for you Today .* Yesterday .* This week .* Week of \d+ \w+: 3 parked · 1 not doing Earlier/)
  // the project not set up is offered once, at the end
  expect(html.trim().endsWith('blog isn’t watched yet · set it up')).toBe(true)
})

test('after a Yes on its card the pinned line goes, and the item is an event again', () => {
  const c = tlOf(answered(true))
  expect(lines(c)).toContain('Empty-cart checkout error · fix being built')
  expect(text(renderToStaticMarkup(<Timeline c={c} onSetup={() => undefined} setupEmpty={() => null} />))).not.toContain('needs you')
  expect(lines(tlOf(answered(false)))).toContain('Empty-cart checkout error · not doing')
})

test('the day groups and the week’s recap read plainly', () => {
  const now = new Date(2026, 10, 28, 15).getTime(), h = 3600_000
  expect([now - h, now - 24 * h, now - 3 * 24 * h, now - 8 * 24 * h].map((t) => dayGroup(t, now))).toEqual(['Today', 'Yesterday', 'This week', 'Earlier'])
  const plain = (s: string) => s.replace(/\u00a0/g, ' ')
  expect(plain(recap([], 0))).toBe('0 changes')
  // a number keeps its word on a narrow page
  expect(recap([], 2)).toBe('2\u00a0wait for you')
  expect(weeks([], now, 1).map((w) => plain(w.recap))).toEqual(['This week: 1 waits for you'])
})

test('the empty and paused fixtures read well: set it up, and a paused project’s own lines', () => {
  const empty = tlOf(day(), null, true)
  expect(events(empty.items, empty.projects, empty.live, empty.now, null)).toEqual([])
  const html = renderToStaticMarkup(<Timeline c={empty} onSetup={() => undefined} setupEmpty={(p) => <b>{`set up ${p.name}`}</b>} />)
  expect(html).toBe('<b>set up blog</b>')
  const garden = tlOf(day(), 'garden')
  expect(lines(garden)).toEqual(['garden-app paused', 'Seed list order · waits for Resume', 'Weather reminders · parked'])
  // one project picked: the project's name leaves the end of each line
  expect(text(renderToStaticMarkup(<Timeline c={garden} onSetup={() => undefined} setupEmpty={() => null} />))).not.toMatch(/paused garden-app/)
})

test('each older week has its own recap, and only the first is labelled Earlier', () => {
  const now = new Date(2026, 10, 28, 15).getTime(), d = 86400_000
  const e = (id: string, ago: number, count?: 'fixed' | 'parked') => ({ id, at: now - ago * d, project: 'x', icon: 'check' as const, words: id, open: id, count })
  const ws = weeks([e('a', 0, 'fixed'), e('b', 8, 'parked'), e('c', 9, 'parked'), e('f', 16, 'fixed')], now, 0)
  expect(ws.map((w) => w.recap.replace(/ /g, ' '))).toEqual(['This week: 1 fixed', 'Week of 15 Nov: 2 parked', 'Week of 8 Nov: 1 fixed'])
  expect(ws.map((w) => w.days.map((x) => x.day))).toEqual([['Today'], ['Earlier'], [null]])
})

test('a paused project’s queue waits for Resume; what runs stays still, never a spinner', () => {
  const s = day()
  const r = radarOf(s)!
  const paused = { ...s, radar: { ...r, projects: r.projects.map((p) => (p.id === 'shepherdr' ? { ...p, paused: Date.now() } : p)) } } as Snapshot
  const ls = lines(tlOf(paused))
  expect(ls).toContain('Old-main starts · waits for Resume')
  expect(ls).toContain('Archive asks twice · waits for Resume')
  expect(ls).toContain('Long chats jump · being fixed')
  expect(ls.some((l) => l.includes('next up'))).toBe(false)
  // the shared working ring turns for as long as it shows: the calm feed uses a still mark
  const c = tlOf(answered(true))
  expect(events(c.items, c.projects, c.live, c.now, null).filter((e) => e.icon === 'working')).toEqual([])
})

test('Resume and a card’s answer are events at the time they happened, not when the item was found', () => {
  const now = Date.now()
  reset()
  dayOf(radarOf(day()))
  resume('garden', now)
  const i = useRadarDay()!.items.find((x) => x.id === 'r-gdraft')!
  expect(i.changed).toBe(now)
  reset()
  const c = tlOf(answered(true))
  const yes = events(c.items, c.projects, c.live, c.now, null).find((e) => e.id === 'r-err')!
  expect(dayGroup(yes.at, c.now)).toBe('Today')
  expect(yes.at).toBe(c.now)
})

test('on the calm timeline the Radar row keeps it: the grey count does not jump to the tabbed All items', () => {
  const row = readFileSync(join(import.meta.dir, 'row.tsx'), 'utf8')
  expect(row).toContain("onClick={() => (view.opening === 'timeline' ? overview() : openRadar({ tab: 'all', project: null, filter: 'waiting' }))}")
  // and an item opens beside the timeline from 720 px of page, so a desktop with a pane open keeps the list
  expect(readFileSync(join(import.meta.dir, 'radar.css'), 'utf8')).toContain('@container (min-width:720px){')
})
