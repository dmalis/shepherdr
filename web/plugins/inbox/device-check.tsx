// This device, checked (fork #37), under Settings › General › Notifications, after "Alerts on this device": what the
// browser really has (its permission, the subscription), why alerts can't arrive when they can't and what to do, a test
// push to this device only, and every device that gets alerts, so one that is missing shows. The system's own switch
// (macOS, Windows, Focus) is out of a page's sight: it is named, never guessed.
import { useEffect, useState } from 'react'
import { notice } from '@client/kernel.ts'
import { Btn, cx } from '@client/ui.tsx'
import { turnOn, type DeviceNow } from '@plugins/alerts/device.ts'
import { registerWorker } from '@plugins/alerts/worker.ts'
import { agoShort } from '@shared/view.ts'
import { advice, deviceName, deviceOf, lastWords } from './words.ts'
import './inbox.css'

type Device = { id: string; device: string; at: number; seen?: number; last?: { at: number; status: number }; topics: string[]; mine?: true }

const post = (path: string, body: unknown) =>
  fetch(`api/push/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shepherdr': '1' }, body: JSON.stringify(body) }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? 'That did not work. Try again.')
    return j
  })

const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const ago = (ms: number) => (agoShort(ms) === 'now' ? 'just now' : `${agoShort(ms)} ago`)

const PERMISSION: Record<string, string> = { granted: 'Allowed', default: 'Not asked yet', denied: 'Blocked', unknown: 'No alerts in this browser' }

function Line({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="srow">
      <span className="n">{label}</span>
      <span className={cx('val', tone === 'ok' && 'c-ready', tone === 'bad' && 'c-red')}>{value}</span>
    </div>
  )
}

/** a subscription its push service let go of (404/410): this browser's is dropped and a new one made with the same
 *  choice (the permission is already given, so nothing asks), as a page does on pushsubscriptionchange */
async function renew(now: DeviceNow): Promise<string | null> {
  const reg = await registerWorker()
  await (await reg.pushManager.getSubscription())?.unsubscribe()
  const failed = await turnOn(now.tell === 'Everything' ? 'Everything' : 'Needs me')
  if (failed) return null
  return (await reg.pushManager.getSubscription())?.endpoint ?? null
}

export function DeviceCheck({ now, reread }: { now: DeviceNow | null; reread: () => Promise<unknown> }) {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [busy, setBusy] = useState(false)
  const endpoint = now?.endpoint ?? ''
  const state = now?.state
  useEffect(() => {
    if (!now) return
    post('devices', { endpoint })
      .then((j: { devices?: Device[] }) => setDevices(j.devices ?? []))
      .catch(() => setDevices(null))
  }, [endpoint, state])
  if (!now) return null
  const permission = 'Notification' in window ? Notification.permission : 'unknown'
  const app = standalone()
  const d = { ...deviceOf(navigator.userAgent, navigator.maxTouchPoints), standalone: app }
  const { why, check } = advice(now.state, d)
  const on = now.state === 'on'
  const test = async () => {
    setBusy(true)
    try {
      let r = (await post('test', { endpoint })) as { ok: boolean; said: string; gone?: true }
      if (r.gone && now) {
        // its subscription expired: renew it, then the same test to the new one
        const fresh = await renew(now).catch(() => null)
        await reread()
        if (fresh) {
          const again = (await post('test', { endpoint: fresh })) as typeof r
          r = again.ok ? { ...again, said: "This device's subscription had expired. It's renewed, and the test is sent." } : again
        }
      }
      notice(r.said, { tone: r.ok ? 'ok' : 'error' })
    } catch (e) {
      notice(e instanceof Error ? e.message : 'That did not work. Try again.', { tone: 'error' })
    } finally {
      setBusy(false)
      post('devices', { endpoint }).then((j: { devices?: Device[] }) => setDevices(j.devices ?? [])).catch(() => undefined)
    }
  }
  const others = (devices ?? []).filter((x) => !x.mine)
  return (
    <div className="dchk">
      <Line label="This device" value={`${deviceName(navigator.userAgent, navigator.maxTouchPoints)}${app ? ', installed app' : ''}`} />
      <Line label="Permission" value={PERMISSION[permission] ?? permission} tone={permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : undefined} />
      <Line label="Subscribed here" value={on ? 'Yes' : 'No'} tone={on ? 'ok' : 'bad'} />
      {why && <p className="note warn">{why}</p>}
      <div className="srow">
        <span className="n">
          Send a test alert
          <small>One push to this device only, shown even with the app open</small>
        </span>
        <Btn small disabled={!on || busy} onClick={() => void test()}>
          {busy ? 'Sending…' : 'Send test'}
        </Btn>
      </div>
      {on && <p className="note">While Shepherdr is on this screen, alerts show inside the app instead. {check}</p>}
      <div className="cap">Devices that get alerts</div>
      {devices === null && <p className="hint">Couldn’t load the list of devices.</p>}
      {devices && !devices.length && <p className="hint">No device gets alerts yet.</p>}
      {[...(devices ?? []).filter((x) => x.mine), ...others].map((x) => (
        <div className="dev" key={x.id}>
          <span className="n">
            <span className={cx('l1', x.mine && 'me')}>{deviceName(x.device)}</span>
            <span className="l2">
              {x.mine ? 'This device' : x.seen ? `Seen ${ago(x.seen)}` : `Turned on ${ago(x.at)}`} · {lastWords(x.last, ago)}
            </span>
          </span>
          <span className="v">{x.topics.includes('done') ? 'Everything' : 'Needs me'}</span>
        </div>
      ))}
    </div>
  )
}
