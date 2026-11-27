// This device, checked (fork #37), on Settings › Notifications, after "Alerts on this device": what the
// browser really has (its permission, the subscription), why alerts can't arrive when they can't and what to do, a test
// push to this device only, and every device that gets alerts, so one that is missing shows. The system's own switch
// (macOS, Windows, Focus) is out of a page's sight: it is named, never guessed.
import { useEffect, useState } from 'react'
import { notice } from '@client/kernel.ts'
import { confirm } from '@client/overlay.tsx'
import { Btn, cx } from '@client/ui.tsx'
import { choose, turnOn, type DeviceNow } from '@plugins/alerts/device.ts'
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
  // the choice made on this device (the alerts plugin keeps it as shepherdr.tell), else what the server had: a renewal
  // never turns Everything into Needs me
  let saved: string | null = null
  try { saved = localStorage.getItem('shepherdr.tell') } catch { /* a private window */ }
  const failed = await turnOn(saved === 'Everything' || (saved !== 'Needs me' && now.tell === 'Everything') ? 'Everything' : 'Needs me')
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
  // fork #96: a device taken off the list, asked first and named (GitHub's Sessions, Google's "Your devices"); this
  // one is alerts turned off here, as Off does; another goes by its row's id only
  const remove = (x: Device) => {
    const name = deviceName(x.device)
    confirm({
      title: `Stop alerts to ${x.mine ? 'this device' : name}?`,
      body: x.mine ? 'Alerts turn off here, as Off does. Turn them on again any time above.' : "It won't get alerts until it turns them on again.",
      ok: 'Remove',
      danger: true,
      run: async () => {
        try {
          if (x.mine) {
            await choose('Off', now)
            await reread()
          } else setDevices(((await post('remove', { id: x.id, endpoint })) as { devices?: Device[] }).devices ?? [])
          notice(x.mine ? 'Alerts are off on this device' : `Removed ${name}`, { tone: 'ok' })
        } catch (e) {
          notice(e instanceof Error ? e.message : 'That did not work. Try again.', { tone: 'error' })
        }
      },
    })
  }
  const others = (devices ?? []).filter((x) => !x.mine)
  return (
    <div className="dchk">
      <h3>This device</h3>
      <Line label="Device" value={`${deviceName(navigator.userAgent, navigator.maxTouchPoints)}${app ? ', installed app' : ''}`} />
      <Line label="Permission" value={PERMISSION[permission] ?? permission} tone={permission === 'granted' ? 'ok' : permission === 'denied' ? 'bad' : undefined} />
      <Line label="Subscribed here" value={on ? 'Yes' : 'No'} tone={on ? 'ok' : 'bad'} />
      <div className="srow">
        <span className="n">
          Send a test alert
          <small>One push to this device only, shown even with the app open</small>
        </span>
        <Btn small disabled={!on || busy} onClick={() => void test()}>
          {busy ? 'Sending…' : 'Send test'}
        </Btn>
      </div>
      {why && <p className="note warn">{why}</p>}
      {on && <p className="note">While Shepherdr is on this screen, alerts show inside the app instead. {check}</p>}
      <h3>Devices that get alerts</h3>
      {devices === null && <p className="hint">Couldn’t load the list of devices.</p>}
      {devices && !devices.length && <p className="hint">No device gets alerts yet.</p>}
      {[...(devices ?? []).filter((x) => x.mine), ...others].map((x) => (
        <div className="srow dev" key={x.id}>
          <span className="n">
            <span className={cx('l1', x.mine && 'me')}>{deviceName(x.device)}</span>
            <span className="l2">
              {x.mine ? 'This device' : x.seen ? `Seen ${ago(x.seen)}` : `Turned on ${ago(x.at)}`} · {lastWords(x.last, ago)}
            </span>
          </span>
          <span className="val">Alerts: {x.topics.includes('done') ? 'Everything' : 'Needs me'}</span>
          <Btn small aria-label={`Remove ${x.mine ? 'this device' : deviceName(x.device)}`} onClick={() => remove(x)}>
            Remove
          </Btn>
        </div>
      ))}
    </div>
  )
}
