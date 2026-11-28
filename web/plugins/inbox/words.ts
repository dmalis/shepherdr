// What the alerts list and the device check say (fork #37), as plain functions the tests read: the day an alert falls
// in, its state, a device's name from its browser's own words, and why alerts may not show on this device.
import type { DeviceState } from '@shared/alerts.ts'
import type { InboxItem } from '@shared/types.ts'
import { agoShort } from '@shared/view.ts'

/** the list's sections, as GitHub's and Linear's: Today, Yesterday, Earlier */
export function byDay<T extends { at: number }>(items: T[], now = Date.now()): { name: string; items: T[] }[] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const yesterday = today - 24 * 3600_000
  const out: { name: string; items: T[] }[] = []
  for (const x of items) {
    const name = x.at >= today ? 'Today' : x.at >= yesterday ? 'Yesterday' : 'Earlier'
    const last = out[out.length - 1]
    if (last?.name === name) last.items.push(x)
    else out.push({ name, items: [x] })
  }
  return out
}

/** an alert's time as a screen reader says it: "5 minutes ago", where the row shows "5m ago" (UI 16) */
export function agoWords(at: number, now = Date.now()): string {
  const short = agoShort(at, now)
  if (short === 'now') return 'just now'
  const n = Number.parseInt(short, 10)
  const unit = ({ m: 'minute', h: 'hour', d: 'day', w: 'week' } as const)[short.slice(-1) as 'm' | 'h' | 'd' | 'w']
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}

/** an alert that waited on you: still waiting, or resolved since; none for one that never waited */
export const stateOf = (x: Pick<InboxItem, 'waits' | 'closed'>): 'Waiting' | 'Resolved' | null => (x.waits ? (x.closed ? 'Resolved' : 'Waiting') : null)

export type Os = 'macOS' | 'iPhone' | 'iPad' | 'Android' | 'Windows' | 'ChromeOS' | 'Linux' | null
export type Browser = 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Opera' | 'Samsung Internet' | null

/** what a browser's user agent says it is: its system, and the browser */
export function deviceOf(ua: string, touch = 0): { os: Os; browser: Browser } {
  const os: Os = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : null
  const browser: Browser = /Edg(A|iOS)?\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /Chrome|CriOS|Chromium/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : null
  return { os, browser }
}

/** "Chrome on macOS"; an iPhone's Home Screen app is "Shepherdr on iPhone" (Safari is the only way there) */
export function deviceName(ua: string, touch = 0): string {
  const { os, browser } = deviceOf(ua, touch)
  if (os === 'iPhone' || os === 'iPad') return `${browser && browser !== 'Safari' ? browser : 'Safari'} on ${os}`
  if (!os && !browser) return 'A browser'
  return [browser ?? 'A browser', os].filter(Boolean).join(' on ')
}

/** the name macOS and Windows list a browser under in their notification settings */
const appName: Partial<Record<NonNullable<Browser>, string>> = { Chrome: 'Google Chrome', Edge: 'Microsoft Edge', Firefox: 'Firefox', Safari: 'Safari', Opera: 'Opera' }

/** Why alerts can't arrive here and what to do, in one line each; then what the page can't know (the system's own
 *  switch). standalone: the installed app. */
export function advice(state: DeviceState, d: { os: Os; browser: Browser; standalone: boolean }): { why: string | null; check: string | null } {
  const app = (d.browser && appName[d.browser]) || 'your browser'
  if (state === 'install') return { why: 'In Safari, tap Share › Add to Home Screen, then open Shepherdr from the Home Screen and turn alerts on there.', check: null }
  if (state === 'unsupported') return { why: 'This browser has no push alerts. Use Chrome, Edge, Firefox or Safari, or the installed app.', check: null }
  if (state === 'blocked') {
    if (d.os === 'iPhone' || d.os === 'iPad') return { why: 'Alerts are blocked for Shepherdr: Settings › Notifications › Shepherdr › Allow Notifications.', check: null }
    if (d.os === 'Android') return { why: 'Alerts are blocked for Shepherdr: long-press its icon › App info › Notifications › Allow.', check: null }
    if (d.browser === 'Safari') return { why: 'Safari blocks alerts for this site: Safari › Settings › Websites › Notifications › Allow, then reload.', check: null }
    if (d.browser === 'Firefox') return { why: 'Firefox blocks alerts for this site: click the icon left of the address › Notifications › Allow, then reload.', check: null }
    return { why: d.standalone ? `${app} blocks alerts for Shepherdr: the app's ⋮ menu › App info › Notifications › Allow, then reload.` : `${app} blocks alerts for this site: click the icon left of the address › Notifications › Allow, then reload.`, check: null }
  }
  if (state === 'off') return { why: "This device isn't subscribed, so nothing is sent here. Turn alerts on above.", check: null }
  // on: the page sees no more. The system's own switch can still hide every one of them.
  const check = d.os === 'macOS' ? `Nothing after a test? macOS may block ${app}: System Settings › Notifications › ${app} › Allow notifications${d.standalone && d.browser !== 'Safari' ? ' (the installed app may be listed as Shepherdr)' : ''}. Focus hides them too.`
    : d.os === 'Windows' ? `Nothing after a test? Windows may block ${app}: Settings › System › Notifications › ${app}. Do not disturb hides them too.`
    : d.os === 'iPhone' || d.os === 'iPad' ? 'Nothing after a test? Settings › Notifications › Shepherdr › Allow Notifications. Focus hides them too.'
    : d.os === 'Android' ? `Nothing after a test? Android settings › Apps › ${d.standalone ? 'Shepherdr' : d.browser ?? 'your browser'} › Notifications. Do not disturb hides them too.`
    : `Nothing after a test? Check your system's notification settings for ${app}.`
  return { why: null, check }
}

/** how a device's last alert went, from its push service's answer (taken: on its way to the device; whether it showed,
 *  only the device knows) */
export function lastWords(last: { at: number; status: number } | undefined, ago: (ms: number) => string): string {
  if (!last) return 'No alert sent yet'
  if (last.status >= 200 && last.status < 300) return `Last alert sent ${ago(last.at)}`
  return last.status ? `Last alert refused (${last.status}) ${ago(last.at)}` : `Last alert couldn't be sent ${ago(last.at)}`
}
