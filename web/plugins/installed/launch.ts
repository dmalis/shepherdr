// fork #34: the installed app's launches. Chrome opens an installed app's shortcut (the dock's or taskbar's menu, a long
// press on Android) and a Shepherdr link it captures into the app's window. With the manifest's launch_handler
// (focus-existing) a window already open only comes forward and hears the launch on window.launchQueue; this takes it
// where the launch points, as a tap on a link in the app would; an artifact's page opens in the Artifacts pane. The
// icon itself launches the bare start address: that only brings the window forward, as any app's icon does, and keeps
// what's on screen. A page that just loaded hears its own launch there too: that one is let go, the page already
// opened at its address.
import { appLink } from '@client/applink.ts'

/** the parts of an address that say where in the app (what openLink reads) */
const WHERE = ['place', 'task', 'artifact', 'pane', 'max', 'focus']
/** the parts that ask for something beyond a place, each done once and then dropped from the address */
const ASKS = ['new', 'show', 'voice']

/** a new task (the New task shortcut, `?new=task`) */
export function wantsNewTask(href: string) {
  return param(href, 'new') === 'task'
}

/** the Needs you group in Tasks (the Needs you shortcut, `?show=needs-you`) */
export function wantsNeeds(href: string) {
  return param(href, 'show') === 'needs-you'
}

/** a call (the voice plugin's `?voice=1`) */
export function wantsCall(href: string) {
  const v = param(href, 'voice')
  return v === '' || v === '1' || v === 'true'
}

function param(href: string, key: string) {
  try {
    return new URL(href, 'http://x/').searchParams.get(key)
  } catch {
    return null
  }
}

/** the address without the one-off asks, as a path the history takes; null when it has none */
export function withoutAsks(href: string) {
  const u = new URL(href, 'http://x/')
  if (!ASKS.some((k) => u.searchParams.has(k))) return null
  for (const k of ASKS) u.searchParams.delete(k)
  const q = u.searchParams.toString()
  return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`
}

/** what a launch into the open window asks for */
export type Launch =
  /** the icon (the bare start address): only come forward */
  | { kind: 'focus' }
  /** not the app's own page (a file, another machine's artifact): it opens on its own, the app stays */
  | { kind: 'away'; href: string }
  /** the app: `go` where it points (null: stay), then the asks */
  | { kind: 'app'; go: string | null; newTask: boolean; needs: boolean; call: boolean }

/** an artifact's page under the app (`api/artifacts/<id>/page`, or a version's `.../v/<n>/k/<key>/page/...`): the
    app's own address for that artifact, which opens it in the Artifacts pane */
function artifactLink(href: string, here: string): URL | null {
  let u: URL, h: URL
  try {
    h = new URL(here)
    u = new URL(href, h)
  } catch {
    return null
  }
  const base = h.pathname.replace(/\/index\.html$/, '/').replace(/\/?$/, '/')
  if (u.origin !== h.origin || !u.pathname.startsWith(base)) return null
  const m = /^api\/artifacts\/(\w[\w.-]{0,119})\/(?:v\/\d{1,9}\/k\/[\w-]{16,64}\/)?page(?:\/|$)/.exec(u.pathname.slice(base.length))
  if (!m) return null
  const go = new URL(base, h.origin)
  go.searchParams.set('artifact', m[1])
  return go
}

export function launchOf(href: string, here: string): Launch {
  const u = appLink(href, here) ?? artifactLink(href, here)
  if (!u) return { kind: 'away', href }
  const where = WHERE.some((k) => u.searchParams.has(k))
  const newTask = wantsNewTask(u.href), needs = wantsNeeds(u.href), call = wantsCall(u.href)
  if (!where && !newTask && !needs && !call) return { kind: 'focus' }
  if (!where) return { kind: 'app', go: null, newTask, needs, call }
  const go = new URL(u.href)
  for (const k of ASKS) go.searchParams.delete(k)
  return { kind: 'app', go: go.href, newTask, needs, call }
}

export type LaunchDeps = {
  /** the address the page loaded with */
  loaded: string
  /** the page's address now */
  here: () => string
  /** go where the link points, as a link in the app does */
  open: (href: string) => void
  /** open an address that isn't the app's page on its own */
  away: (href: string) => void
  newTask: () => void
  needs: () => void
  call: () => void
  now: () => number
}

/** the page's own launch reaches the queue this soon after loading, or not at all */
const OWN_MS = 5000

/** handles each launch the queue hands over: call it with the launch's address */
export function launches(d: LaunchDeps) {
  const start = d.now()
  let first = true
  return (href: string | null | undefined) => {
    if (!href) return
    const own = first && href === d.loaded && d.now() - start < OWN_MS
    first = false
    if (own) return
    const l = launchOf(href, d.here())
    if (l.kind === 'focus') return
    if (l.kind === 'away') return d.away(l.href)
    if (l.go) d.open(l.go)
    if (l.needs) d.needs()
    if (l.newTask) d.newTask()
    if (l.call) d.call()
  }
}
