// The alerts list and the device check (fork #37, "Alerts: a list in the app, and every device gets them"): its
// sections by day, an alert's state, a device's name, and why alerts can't arrive on this device and what to do.
// The pins at the end fail when upstream moves a place this plugin stands on.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deviceState } from '@shared/alerts.ts'
import { registry } from '@client/kernel.ts'
import { renderToStaticMarkup } from 'react-dom/server'
import { advice, agoWords, byDay, deviceName, deviceOf, lastWords, stateOf } from './words.ts'
import { kindGivesWay } from './fit.ts'

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

test('what the screen shows is seen: a task once it shows, a space once its chat does; nothing that covers it', async () => {
  const { seenIds } = await import('./client.tsx')
  const it = (id: string, o: object) => ({ id, at: 1, title: id, body: '', topic: 'needs', tag: id, ...o })
  const items = [it('t', { task: 'HERD-4', place: 'sp1' }), it('s', { place: 'sp1' })]
  const desk = { phone: false, drawer: false, pane: null, settings: null, search: false, task: null, max: null, at: 'sp1' } as any
  expect(seenIds(desk, items)).toEqual(['s'])
  expect(seenIds({ ...desk, task: 'HERD-4' }, items)).toEqual(['t'])
  expect(seenIds({ ...desk, settings: { sec: null } }, items)).toEqual([])
  expect(seenIds({ ...desk, search: true }, items)).toEqual([])
  const phone = { ...desk, phone: true }
  expect(seenIds(phone, items)).toEqual(['s'])
  // the list of spaces out, or a pane over the chat: not seen
  expect(seenIds({ ...phone, drawer: true }, items)).toEqual([])
  expect(seenIds({ ...phone, pane: 'files' }, items)).toEqual([])
  // the Tasks pane showing that task: its alerts are seen, the space's are not
  expect(seenIds({ ...phone, pane: 'tasks', task: 'HERD-4' }, items)).toEqual(['t'])
  expect(seenIds({ ...phone, pane: 'tasks' }, items)).toEqual([])
})

test('a refused auto-read is not asked again for 30 s, so a page left open never loops', async () => {
  const { markRead, seenIds } = await import('./client.tsx')
  const items = [{ id: 'alert:z@1', at: 1, title: 'z', body: '', topic: 'needs', tag: 'z', place: 'sp9' }]
  const ui = { phone: false, drawer: false, pane: null, settings: null, search: false, task: null, max: null, at: 'sp9' } as any
  const real = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch
    const now = Date.now()
    expect(seenIds(ui, items, now)).toEqual(['alert:z@1'])
    expect(await markRead(['alert:z@1'])).toBe(false)
    expect(seenIds(ui, items, Date.now())).toEqual([])
    expect(seenIds(ui, items, Date.now() + 31_000)).toEqual(['alert:z@1'])
  } finally {
    globalThis.fetch = real
  }
})

/* UI 16, "Alerts read whole": a screen reader's name and description of a row, from its markup as accessible-name
 * computation reads it: aria-labelledby and aria-describedby by id, text joined, what is aria-hidden left out */
type Node = { tag: string; attrs: Record<string, string>; kids: (Node | string)[] }
function parse(html: string): Node {
  const root: Node = { tag: '', attrs: {}, kids: [] }
  const stack = [root]
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>|([^<]+)/gi)) {
    const top = stack[stack.length - 1]
    if (m[5] !== undefined) top.kids.push(m[5].replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"'))
    else if (m[1]) stack.pop()
    else {
      const node: Node = { tag: m[2], attrs: Object.fromEntries([...m[3].matchAll(/([a-z-]+)="([^"]*)"/gi)].map((a) => [a[1], a[2]])), kids: [] }
      top.kids.push(node)
      if (!m[4] && !['path', 'circle', 'rect', 'line', 'br'].includes(m[2])) stack.push(node)
    }
  }
  return root
}
const find = (n: Node, id: string): Node | null => (n.attrs.id === id ? n : n.kids.reduce<Node | null>((f, k) => f ?? (typeof k === 'string' ? null : find(k, id)), null))
// as Chrome reads the CSS: a flex container's items (kind.css .knd, inbox.css .inbx-m) are blocks, set apart by a
// space; the dot between place and time reads as a comma (its content's alt text)
const FLEX = ['knd', 'inbx-m']
const words = (n: Node | string): string => {
  if (typeof n === 'string') return n
  if (n.attrs['aria-hidden'] === 'true') return ''
  const lead = n.attrs.class === 'inbx-a' ? ', ' : ''
  return lead + n.kids.map(words).join(FLEX.includes(n.attrs.class) ? ' ' : '')
}
const by = (root: Node, ids = '') => ids.split(' ').filter(Boolean).map((id) => words(find(root, id)!).replace(/\s+/g, ' ').trim()).join(' ')

test('an alert reads whole: its title is its name, its body, place, time and status its description', async () => {
  const { Item } = await import('./client.tsx')
  const { snapshot } = await import('../../demo/data.ts')
  const snap = snapshot('normal')
  const row = (id: string) => {
    const x = snap.inbox!.find((a) => a.id === id)!
    const root = parse(renderToStaticMarkup(<Item x={x} snap={snap} close={() => {}} now={x.at + 40 * 60_000} />))
    const button = root.kids.find((k): k is Node => typeof k !== 'string' && k.tag === 'button')!
    return { button, name: by(root, button.attrs['aria-labelledby']), description: by(root, button.attrs['aria-describedby']) }
  }
  const unread = row('alert:a7')
  // no aria-label in place of what the row shows
  expect(unread.button.attrs['aria-label']).toBeUndefined()
  expect(unread.name).toBe('Unread: Task Bigger checkout button Approval code')
  expect(unread.description).toBe('The payment sandbox sent a code to your phone: enter it in the browser #shop, 40 minutes ago')
  const waited = row('need:SHOP-14/worker:q2')
  expect(waited.name).toBe('Task Switch payment provider Needs you')
  expect(waited.description).toBe('Which provider, Stripe or Adyen? #shop, 40 minutes ago Waiting on you')
  // an Assistant's alert has no task kind: its title as it is
  expect(row('msg:p:mac-mini:blog:9').name).toBe('#blog Assistant · New message')
})

test("a row's time in words for a screen reader, the short form on screen", () => {
  const now = new Date(2026, 10, 27, 15, 0).getTime()
  expect(agoWords(now - 10_000, now)).toBe('just now')
  expect(agoWords(now - 60_000, now)).toBe('1 minute ago')
  expect(agoWords(now - 40 * 60_000, now)).toBe('40 minutes ago')
  expect(agoWords(now - 3600_000, now)).toBe('1 hour ago')
  expect(agoWords(now - 3 * 24 * 3600_000, now)).toBe('3 days ago')
  expect(agoWords(now - 14 * 24 * 3600_000, now)).toBe('2 weeks ago')
})

test("a title's kind gives way, whole, before the task's name is cut; the state word always keeps its room", () => {
  // room 300: "Task · " 40, the name 200, " · Approval code" 100: it all fits
  expect(kindGivesWay(300, 40, 160, 100)).toBe(false)
  expect(kindGivesWay(300, 40, 200, 100)).toBe(true)
  // the kind gone, the name may still be cut (kind.css .kn): never the state word
  const css = readFileSync(join(import.meta.dir, 'inbox.css'), 'utf8')
  expect(css).toContain('.inbx-t>.knd.tight>.kd{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}')
  expect(readFileSync(join(import.meta.dir, '../chat/kind.css'), 'utf8')).toMatch(/\.knd>\.kd,\.knd>\.ks\{flex:none/)
})

test('pin: the device states the check reads are still the alerts plugin’s', () => {
  expect(deviceState({ push: true, ios: false, standalone: false, permission: 'denied', subscribed: false })).toBe('blocked')
  expect(deviceState({ push: true, ios: false, standalone: false, permission: 'default', subscribed: false })).toBe('off')
  expect(deviceState({ push: true, ios: true, standalone: false, permission: 'default', subscribed: false })).toBe('install')
  expect(deviceState({ push: true, ios: false, standalone: true, permission: 'granted', subscribed: true })).toBe('on')
})

test('pin: the bell sits in the list’s top row, and the check on Settings › Notifications (its own page, #68)', async () => {
  const plugin = (await import('./client.tsx')).default
  const before = registry.sideHead.length
  plugin.setup(registry)
  expect(registry.sideHead.length).toBe(before + 1)
  const root = join(import.meta.dir, '../../')
  expect(readFileSync(join(root, 'src/list.tsx'), 'utf8')).toContain('registry.sideHead.map(')
  const settings = readFileSync(join(root, 'src/settings.tsx'), 'utf8')
  expect(settings).toContain("['General', 'gear'], ['Notifications', 'bell']")
  // fork Needs you 3/6: the page is the alerts plugin's, ending on the device check
  expect(settings).toContain('const Notifications = NotificationsPage')
  expect(readFileSync(join(root, 'plugins/alerts/page.tsx'), 'utf8')).toMatch(/{WORDS\.reach}[\s\S]*Ask me after[\s\S]*\{WORDS\.bell\}[\s\S]*<DeviceCheck now=\{now\} reread=\{read\} \/>/)
  expect(JSON.parse(readFileSync(join(root, 'plugins.json'), 'utf8')).plugins).toContain('inbox')
  // the service worker still shows a test alert while the app is on screen
  // (fork Needs you 4/6: and hands any other to the app on screen, which says it itself)
  expect(readFileSync(join(root, 'public/sw.js'), 'utf8')).toContain("const shown = list.filter((c) => c.visibilityState === 'visible')\n        if (!a.test && shown.length)")
})
