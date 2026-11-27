// fork "Needs you 3/6": Space alerts, On or Muted. A space's menu has Mute alerts (Unmute alerts while muted), and
// Settings › Space has the row with Same as Everything, or Set here · Reset. Muted is the old Notify Off everywhere
// notifyOf is read (push, the phone app, toasts, the list's unread). The page keeps a place for "Ask me after".
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { notifyOf } from '@shared/alerts.ts'
import { WORDS } from '@shared/reach.ts'

const { spaceAlertsRow, SpaceAlertsRow, unmuted } = await import('./space.tsx')

const all = { alerts: 'On' as const }
const snapOf = (spaces: Record<string, unknown>) => ({ settings: [], config: { all, spaces } }) as unknown as Snapshot

test('the space menu: Mute alerts, Unmute alerts while muted, nothing before settings load', () => {
  expect(spaceAlertsRow(snapOf({}), { id: 'sp1' }, '#shop').map((r) => r.label)).toEqual([WORDS.mute])
  expect(spaceAlertsRow(snapOf({ sp1: { alerts: 'Muted', own: ['alerts'] } }), { id: 'sp1' }, '#shop').map((r) => r.label)).toEqual([WORDS.unmute])
  expect(spaceAlertsRow({ settings: [] } as unknown as Snapshot, { id: 'sp1' }, '#shop')).toEqual([])
  expect([WORDS.mute, WORDS.unmute, WORDS.muted('#shop')]).toEqual(['Mute alerts', 'Unmute alerts', 'Muted alerts from #shop'])
})

test('Settings › Space: the row says what its value means and where it comes from', () => {
  const on = renderToStaticMarkup(<SpaceAlertsRow snap={snapOf({})} place="sp1" />)
  expect(on).toContain('Space alerts')
  expect(on).toContain(WORDS.spaceOn)
  expect(on).toContain('Same as Everything')
  const muted = renderToStaticMarkup(<SpaceAlertsRow snap={snapOf({ sp1: { alerts: 'Muted', own: ['alerts'] } })} place="sp1" />)
  expect(muted).toContain(WORDS.spaceMuted)
  expect(muted).toContain('Reset')
})

test('Muted is Notify Off; a space with no own value has Everything’s', () => {
  expect(notifyOf(snapOf({ sp1: { alerts: 'Muted', own: ['alerts'] } }), 'sp1')).toBe('Off')
  expect(notifyOf(snapOf({ sp2: { alerts: 'On', own: [] } }), 'sp1')).toBe('Needs me')
  expect(notifyOf({ settings: [], config: { all: { alerts: 'Muted' }, spaces: {} } } as unknown as Snapshot, 'sp1')).toBe('Off')
})

test('pin: where the rows sit', () => {
  const root = join(import.meta.dir, '../../')
  const read = (f: string) => readFileSync(join(root, f), 'utf8')
  expect(read('src/settings.tsx')).toContain("if (sec === 'Space') return <><IconRow snap={snap} id={place} /><SpaceAlertsRow snap={snap} place={place} /></>")
  expect(read('plugins/alerts/client.tsx')).toMatch(/reg\.spaceMenu\.push\(\{[\s\S]*?!isEverything\(snap, p\.id\) \? spaceAlertsRow\(/)
  // the page: the device's choice, then the place for part 6's "Ask me after", then the bell
  expect(read('plugins/alerts/page.tsx')).toMatch(/<Choice<Tell> label=\{WORDS\.reach\}[\s\S]*Ask me after[\s\S]*\{WORDS\.bell\}/)
  // a machine's warning never toasts
  expect(read('plugins/alerts/client.tsx')).toContain('if (!a.notify || a.ended || a.ops ||')
})

test('Unmute alerts under a muted Everything sets this space On; else it goes back to Everything', () => {
  expect(unmuted(snapOf({ sp1: { alerts: 'Muted', own: ['alerts'] } }))).toBeNull()
  const allMuted = { settings: [], config: { all: { alerts: 'Muted' }, spaces: {} } } as unknown as Snapshot
  expect(spaceAlertsRow(allMuted, { id: 'sp1' }, '#shop').map((r) => r.label)).toEqual([WORDS.unmute])
  expect(unmuted(allMuted)).toBe('On')
})
