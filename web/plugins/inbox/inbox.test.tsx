// The alerts list and the device check (fork #37, "Alerts: a list in the app, and every device gets them"): its
// sections by day, an alert's state, a device's name, and why alerts can't arrive on this device and what to do.
// The pins at the end fail when upstream moves a place this plugin stands on.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deviceState } from '@shared/alerts.ts'
import { registry } from '@client/kernel.ts'
import { advice, byDay, deviceName, deviceOf, lastWords, stateOf } from './words.ts'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'

test('the list is in sections by day, newest first, as GitHub and Linear group theirs', () => {
  const now = new Date(2026, 10, 27, 15, 0).getTime()
  const h = 3600_000
  const g = byDay([{ at: now - h }, { at: now - 2 * h }, { at: now - 20 * h }, { at: now - 50 * h }, { at: now - 80 * h }], now)
  expect(g.map((x) => [x.name, x.items.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Earlier', 2]])
})

test('an alert that waited says whether it still does; one that never waited says nothing', () => {
  expect(stateOf({ waits: true })).toBe('Waiting')
  expect(stateOf({ waits: true, closed: 1 })).toBe('Resolved')
  expect(stateOf({})).toBeNull()
})

test("a device is named by its browser and system, from the browser's own words", () => {
  expect(deviceName(MAC)).toBe('Chrome on macOS')
  expect(deviceName(IPHONE)).toBe('Safari on iPhone')
  expect(deviceName(ANDROID)).toBe('Chrome on Android')
  expect(deviceName(EDGE_WIN)).toBe('Edge on Windows')
  expect(deviceName(SAFARI_MAC)).toBe('Safari on macOS')
  // an iPad asks for the desktop site and calls itself a Mac: its touch screen gives it away
  expect(deviceName(SAFARI_MAC, 5)).toBe('Safari on iPad')
  expect(deviceName('')).toBe('A browser')
})

test('blocked says where to allow it, for the browser and system it is', () => {
  const mac = { ...deviceOf(MAC), standalone: false }
  expect(advice('blocked', mac).why).toContain('click the icon left of the address › Notifications › Allow')
  expect(advice('blocked', { ...mac, standalone: true }).why).toContain("Google Chrome blocks alerts for Shepherdr: the app's ⋮ menu › App info")
  expect(advice('blocked', { ...deviceOf(IPHONE), standalone: true }).why).toBe('Alerts are blocked for Shepherdr: Settings › Notifications › Shepherdr › Allow Notifications.')
  expect(advice('blocked', { ...deviceOf(SAFARI_MAC), standalone: false }).why).toContain('Safari › Settings › Websites › Notifications')
  expect(advice('off', mac).why).toContain("isn't subscribed")
  expect(advice('install', { ...deviceOf(IPHONE), standalone: false }).why).toContain('Add to Home Screen')
})

test("on a Mac that is on, it names macOS's own switch, which no page can see", () => {
  const on = advice('on', { ...deviceOf(MAC), standalone: true })
  expect(on.why).toBeNull()
  expect(on.check).toBe('Nothing after a test? macOS may block Google Chrome: System Settings › Notifications › Google Chrome › Allow notifications (the installed app may be listed as Shepherdr). Focus hides them too.')
  expect(advice('on', { ...deviceOf(EDGE_WIN), standalone: false }).check).toContain('Settings › System › Notifications › Microsoft Edge')
})

test("a device's last alert: sent, refused, or never reached its push service", () => {
  const ago = () => '5m ago'
  expect(lastWords(undefined, ago)).toBe('No alert sent yet')
  expect(lastWords({ at: 1, status: 201 }, ago)).toBe('Last alert sent 5m ago')
  expect(lastWords({ at: 1, status: 403 }, ago)).toBe('Last alert refused (403) 5m ago')
  expect(lastWords({ at: 1, status: 0 }, ago)).toBe("Last alert couldn't be sent 5m ago")
})

test("a read the service refused is undone, so the bell never says read here and unread elsewhere", async () => {
  const { markRead, settle, unreadOf } = await import('./client.tsx')
  const items = [{ id: 'ready:HERD-4@1', key: 'ready:HERD-4', at: 1, title: 'a', body: '', topic: 'ready', tag: 'HERD-4' }, { id: 'alert:a1@2', key: 'alert:a1', at: 2, title: 'b', body: '', topic: 'needs', tag: 'alert:a1' }]
  const real = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch
    expect(await markRead(['ready:HERD-4@1'])).toBe(false)
    expect(unreadOf(items)).toBe(2)
    expect(await markRead('all', items)).toBe(false)
    expect(unreadOf(items)).toBe(2)
    globalThis.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    expect(await markRead(['alert:a1@2'])).toBe(false)
    expect(unreadOf(items)).toBe(2)
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    expect(await markRead(['ready:HERD-4@1'])).toBe(true)
    expect(unreadOf(items)).toBe(1)
    // the snapshot has it: the mark held here is let go, and a new row is never read by it
    settle([{ ...items[0], read: true }, items[1]])
    expect(unreadOf([{ ...items[0], id: 'ready:HERD-4@9', at: 9 }, items[1]])).toBe(2)
  } finally {
    globalThis.fetch = real
  }
})

test('nothing on a covered screen counts as seen: Settings, Search, or on a phone the list of spaces or a pane', async () => {
  const { covered } = await import('./client.tsx')
  const ui = { phone: true, drawer: false, pane: null, settings: null, search: false } as any
  expect(covered(ui)).toBe(false)
  expect(covered({ ...ui, drawer: true })).toBe(true)
  expect(covered({ ...ui, pane: 'files' })).toBe(true)
  expect(covered({ ...ui, phone: false, drawer: true })).toBe(false)
  expect(covered({ ...ui, phone: false, search: true })).toBe(true)
})

test('pin: the device states the check reads are still the alerts plugin’s', () => {
  expect(deviceState({ push: true, ios: false, standalone: false, permission: 'denied', subscribed: false })).toBe('blocked')
  expect(deviceState({ push: true, ios: false, standalone: false, permission: 'default', subscribed: false })).toBe('off')
  expect(deviceState({ push: true, ios: true, standalone: false, permission: 'default', subscribed: false })).toBe('install')
  expect(deviceState({ push: true, ios: false, standalone: true, permission: 'granted', subscribed: true })).toBe('on')
})

test('pin: the bell sits in the list’s top row, and the check under Settings › General › Notifications', async () => {
  const plugin = (await import('./client.tsx')).default
  const before = registry.sideHead.length
  plugin.setup(registry)
  expect(registry.sideHead.length).toBe(before + 1)
  const root = join(import.meta.dir, '../../')
  expect(readFileSync(join(root, 'src/list.tsx'), 'utf8')).toContain('registry.sideHead.map(')
  const settings = readFileSync(join(root, 'src/settings.tsx'), 'utf8')
  expect(settings).toMatch(/<h3>Notifications<\/h3>[\s\S]*<SRow label="Alerts on this device"[\s\S]*<DeviceCheck now=\{now\} reread=\{read\} \/>/)
  expect(JSON.parse(readFileSync(join(root, 'plugins.json'), 'utf8')).plugins).toContain('inbox')
  // the service worker still shows a test alert while the app is on screen
  expect(readFileSync(join(root, 'public/sw.js'), 'utf8')).toContain('if (!a.test && list.some((c) => c.visibilityState')
})
