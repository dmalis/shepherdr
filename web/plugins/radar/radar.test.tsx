// Radar, the clickable prototype (dmalis/shepherdr "Radar: one place for work coming in"): off for every real user, the
// demo's ?case=radar day loads with its one card under Needs you, and the list's row is red while that card asks and
// grey once it is answered. The seams it leans on are pinned: views.feedbackRow and reg.middle, Triage cards in Needs you.
import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { projectAttention } from '@shared/attention.ts'
import { snapshot } from '../../demo/data.ts'
import { clock, itemsAt, open, rowCount, type RadarDemo } from './model.ts'
import { liveOf, RadarRow } from './row.tsx'

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

test('off for every real user: off by default in the service, and only the demo sends its day', async () => {
  const { PLUGINS, offPlugins } = await import('../../../service/next.ts')
  expect(PLUGINS.find((p) => p.id === 'radar')).toEqual({ id: 'radar', name: 'Radar (prototype)', offByDefault: true })
  const was = process.env.HERDR_TASK_SETTINGS
  const file = join(mkdtempSync(join(tmpdir(), 'shep-radar-')), 'settings.json')
  writeFileSync(file, JSON.stringify({ everywhere: {} }))
  process.env.HERDR_TASK_SETTINGS = file
  try {
    expect(offPlugins()).toContain('radar')
  } finally {
    if (was === undefined) delete process.env.HERDR_TASK_SETTINGS
    else process.env.HERDR_TASK_SETTINGS = was
  }
  // the real service never sends a Radar day: no service file names it
  expect(readFileSync(join(root, 'service', 'main.ts'), 'utf8')).not.toContain('radar')
  // every other demo day has none, so the list keeps the Feedback row there
  for (const mode of ['normal', 'triage', 'empty'] as const) expect(radarOf(snapshot(mode))).toBeUndefined()
})

test('the plugin is listed and takes the Feedback row and the middle, as the Feedback page does', () => {
  expect(JSON.parse(readFileSync(join(root, 'web', 'plugins.json'), 'utf8')).plugins).toContain('radar')
  const client = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(client).toContain('reg.views.feedbackRow =')
  expect(client).toContain('reg.middle.push(')
  // the kernel still has both places
  const kernel = readFileSync(join(root, 'web', 'src', 'kernel.ts'), 'utf8')
  expect(kernel).toMatch(/feedbackRow\?:/)
  expect(kernel).toMatch(/middle:/)
})

test('the demo case loads: its four projects, and its one card counted under Needs you', () => {
  const serve = readFileSync(join(root, 'web', 'demo', 'serve.ts'), 'utf8')
  expect(serve).toContain("c === 'radar'")
  const s = day()
  const r = radarOf(s)!
  expect(r.projects.map((p) => p.name)).toEqual(['Shepherdr', 'shop', 'blog', 'garden-app'])
  expect(r.projects.map((p) => p.level)).toEqual(['fix', 'score', 'none', 'score'])
  expect(r.projects.find((p) => p.id === 'garden')!.paused).toBeNumber()
  // the fixtures: held for each reason, parked ones that come back, and the three ways a fix ships
  expect(r.items.filter((i) => i.state === 'held').map((i) => i.held!.why).sort()).toEqual(['cap', 'checks', 'stale'])
  expect(new Set(r.items.filter((i) => i.shipped).map((i) => i.shipped!.how))).toEqual(new Set(['live', 'merged', 'reverted']))
  const now = Date.now()
  expect(itemsAt(r, now).filter((i) => i.later?.returned && i.state === 'new')).toHaveLength(0)
  expect(itemsAt(r, clock(now, { later: true })).filter((i) => i.later?.returned && i.state === 'new').map((i) => i.id).sort()).toEqual(['r-theme', 'r-voice'])
  // Needs you holds the error's card, the person's, as every Triage card
  const a = s.attention!.actions.find((x) => x.card === CARD)
  expect(a?.owner).toBe('you')
  expect(a?.kind).toBe('triage')
  expect(liveOf(s).cards.has(CARD)).toBe(true)
})

test('the row is red while the card asks, grey once it is answered, with the count in words', () => {
  const red = renderToStaticMarkup(<RadarRow snap={day()} />)
  expect(red).toContain('aria-label="Radar, 1 needs you"')
  expect(red).toMatch(/class="cnt needs">1</)
  const s = answered(true)
  const open5 = itemsAt(radarOf(s)!, Date.now(), liveOf(s)).filter(open).length
  const grey = renderToStaticMarkup(<RadarRow snap={s} />)
  expect(grey).toContain(`aria-label="Radar, ${open5} open"`)
  expect(grey).toMatch(new RegExp(`class="cnt">${open5}<`))
  expect(grey).not.toContain('needs')
})

test('a Yes on the card makes the item approved and waiting for your merge; a No moves it to Not doing', () => {
  const yes = answered(true), no = answered(false)
  const item = (s: Snapshot) => itemsAt(radarOf(s)!, Date.now(), liveOf(s)).find((i) => i.id === 'r-err')!
  expect(item(yes)).toMatchObject({ approved: true, state: 'running' })
  expect(item(no)).toMatchObject({ state: 'declined' })
  expect(item(no).needs).toBeUndefined()
})

test('with nothing open and nothing asking, the row is the name alone', () => {
  const r: RadarDemo = { looked: 0, projects: [], items: [] }
  expect(rowCount(r, { cards: new Set(), answers: {} }, Date.now())).toEqual({ n: 0, red: false })
})
