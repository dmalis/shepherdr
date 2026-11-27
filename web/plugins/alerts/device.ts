// Alerts on this device (fork Needs you 3/6: one Notifications page): Needs you (the default: only what you must do),
// Needs you and done, or Off. The words and levels are web/shared/reach.ts's. What this phone or browser really has
// comes from the subscription the browser holds and the server's list, so it never says Off for a device that is on.
// Tapping an alert opens its task.
import { useEffect, useState } from 'react'
import { setPushEndpoint } from '@client/kernel.ts'
import { deviceState, type DeviceState, type PushTopic } from '@shared/alerts.ts'
import { DEFAULT_LEVEL, levelOf, OFF, REACH, topicsOf, type Level, type Reach } from '@shared/reach.ts'
import { registerWorker } from './worker.ts'

export const TELL = REACH
export type Tell = Reach

type Server = { on: boolean; topics: PushTopic[]; muted: string[]; devices: number; removed?: true }

const post = (path: string, body: unknown) =>
  fetch(`api/push/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify(body) }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? 'That did not work. Try again.')
    return j
  })

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const pushable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function browserSub() {
  if (!pushable()) return null
  const reg = await registerWorker()
  return reg.pushManager.getSubscription()
}

export interface DeviceNow {
  state: DeviceState
  endpoint: string | null
  tell: Tell
}

/** what this device has now: the browser's word, then the server's (a subscription it lost is given back) */
export async function readNow(): Promise<DeviceNow> {
  const permission = 'Notification' in window ? Notification.permission : 'unknown'
  const sub = await browserSub().catch(() => null)
  let server: Server | null = null
  if (sub && permission === 'granted') {
    server = await post('state', { endpoint: sub.endpoint }).catch(() => null)
    // fork #96: one removed from another device's list stays off here, with its usual Turn on
    if (server?.removed) want(OFF)
    else if (server && !server.on) server = await post('subscribe', { sub, device: navigator.userAgent }).catch(() => server)
  }
  const state = deviceState({ push: pushable(), ios: ios(), standalone: standalone(), permission, subscribed: !!sub && !!server?.on })
  const on = state === 'on' && !!server
  const level: Level = (on && levelOf(server!.topics)) || levelWanted()
  if (on) want(level)
  return { state, endpoint: sub?.endpoint ?? null, tell: on || wanted() !== OFF ? level : OFF }
}

/* the choice made on this device, kept until alerts are on. 'shepherdr.tell' held the page's choice before (Needs me,
   Everything, Off): Needs me is Needs you now, and Everything (which added done tasks) Needs you and done */
const KEY = 'shepherdr.reach'
const OLD = 'shepherdr.tell'
const get = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
/** an older pick, as the choices now name it */
export const fromOld = (v: string | null): Tell | null => (v === 'Everything' ? 'Needs you and done' : v === 'Needs me' ? 'Needs you' : v === OFF ? OFF : null)
export function wanted(): Tell | null {
  const v = get(KEY) as Tell | null
  return v && REACH.includes(v) ? v : fromOld(get(OLD))
}
const levelWanted = (): Level => {
  const v = wanted()
  return v && v !== OFF ? v : DEFAULT_LEVEL
}
function want(v: Tell) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* a private window */
  }
}

/** turn alerts on in this browser: it asks the device, then subscribes with the choice made */
export async function turnOn(tell: Level = levelWanted()): Promise<string | void> {
  const reg = await registerWorker()
  if ((await Notification.requestPermission()) !== 'granted') return 'Alerts were not allowed on this device.'
  const { key } = (await fetch('api/push/key').then((r) => r.json())) as { key: string }
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
  // turnOn (fork #96): asked for here, so a device removed from another one's list is on again
  await post('subscribe', { sub, device: navigator.userAgent, turnOn: true })
  // the spaces it mutes stay as they were: the server keeps them
  await post('choose', { endpoint: sub.endpoint, topics: topicsOf(tell), all: false })
  setPushEndpoint(sub.endpoint)
  want(tell)
}

/** what reaches this device: one of the levels, or Off */
export async function choose(tell: Tell, now: DeviceNow): Promise<string | void> {
  want(tell)
  if (tell === OFF) {
    const sub = await browserSub()
    if (sub) {
      await post('unsubscribe', { endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    return setPushEndpoint(null)
  }
  if (now.state !== 'on') return now.state === 'off' ? turnOn(tell) : undefined
  await post('choose', { endpoint: now.endpoint, topics: topicsOf(tell), all: false })
}

/** why alerts can't be on here, when they can't */
export const WHY: Partial<Record<DeviceState, string>> = {
  blocked: "This device's settings block Shepherdr's alerts",
  install: 'On an iPhone, add Shepherdr to the Home Screen first',
  unsupported: 'This browser has no alerts',
}

export function useDeviceAlerts() {
  const [now, setNow] = useState<DeviceNow | null>(null)
  const read = () => readNow().then(setNow).catch(() => setNow({ state: 'off', endpoint: null, tell: levelWanted() }))
  useEffect(() => {
    void read()
    // back from the phone's settings (allowed there): read again
    const on = () => document.visibilityState === 'visible' && void read()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return { now, read }
}
