// fork #96 ("Notifications: remove a device"): a device removed from another device's list still holds its browser's
// subscription. When its app opens it shows alerts off, with its usual Turn on, and never signs itself up again on its
// own; one the server lost for any other reason is still given back, as before.
import { afterAll, beforeAll, expect, test } from 'bun:test'

const saved: Record<string, PropertyDescriptor | undefined> = {}
const fake: Record<string, unknown> = {}
let posts: { path: string; body: any }[] = []
let server: Record<string, unknown> = {}
const store = new Map<string, string>()

function put(name: string, value: unknown) {
  saved[name] ??= Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

let readNow: typeof import('./device.ts').readNow
beforeAll(async () => {
  // loaded before the fakes below: the app's kernel reads a real page's document only when there is one
  readNow = (await import('./device.ts')).readNow
  const sub = { endpoint: 'https://push.example.test/old-laptop', unsubscribe: async () => true }
  fake.reg = { pushManager: { getSubscription: async () => sub } }
  put('window', globalThis)
  put('document', { baseURI: 'https://shepherdr.example.test/', addEventListener() {}, removeEventListener() {} })
  put('navigator', { userAgent: 'Firefox on Windows', platform: 'Win32', maxTouchPoints: 0, serviceWorker: { register: async () => fake.reg } })
  put('PushManager', class {})
  put('Notification', { permission: 'granted' })
  put('matchMedia', () => ({ matches: false }))
  put('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
  put('fetch', async (url: string, init: { body: string }) => {
    const path = String(url).replace('api/push/', '')
    posts.push({ path, body: JSON.parse(init.body) })
    return new Response(JSON.stringify(path === 'state' ? server : { on: true, topics: ['needs', 'ready'], muted: [], devices: 3 }), { status: 200 })
  })
})
afterAll(() => {
  for (const [name, d] of Object.entries(saved)) {
    if (d) Object.defineProperty(globalThis, name, d)
    else delete (globalThis as Record<string, unknown>)[name]
  }
})

test('a device removed elsewhere shows alerts off here and does not sign itself up again', async () => {
  store.set('shepherdr.tell', 'Needs me')
  posts = []
  server = { on: false, topics: ['needs', 'ready'], muted: [], devices: 2, removed: true }
  const now = await readNow()
  expect(posts.map((p) => p.path)).toEqual(['state'])
  expect(now).toEqual({ state: 'off', endpoint: 'https://push.example.test/old-laptop', tell: 'Off' })
  // its Turn on (Settings' banner) turns on Needs me, as for any device that is off
  expect(store.get('shepherdr.tell')).toBe('Off')
})

test('one the server lost for another reason is still given back, as before', async () => {
  store.set('shepherdr.tell', 'Needs me')
  posts = []
  server = { on: false, topics: ['needs', 'ready'], muted: [], devices: 2 }
  const now = await readNow()
  expect(posts.map((p) => p.path)).toEqual(['state', 'subscribe'])
  expect(now.state).toBe('on')
})
