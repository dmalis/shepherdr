// fork #34: the installed app's launches. Chrome opens an installed app's shortcut (the dock's or taskbar's menu, a long
// press on Android) and a Shepherdr link it captures into the app's window. With the manifest's launch_handler
// (focus-existing) a window already open only comes forward and hears the launch on window.launchQueue; this takes it
// where the launch points, as a tap on a link in the app would. A page that just loaded hears its own launch there too:
// that one is let go, the page already opened at its address.

/** what a launch asks for beyond a place: a new task (the New task shortcut, `?new=task`) */
export function wantsNewTask(href: string) {
  try {
    return new URL(href, 'http://x/').searchParams.get('new') === 'task'
  } catch {
    return false
  }
}

/** the address without `new`, as a path the history takes; null when it has none */
export function withoutNew(href: string) {
  const u = new URL(href, 'http://x/')
  if (!u.searchParams.has('new')) return null
  u.searchParams.delete('new')
  const q = u.searchParams.toString()
  return `${u.pathname}${q ? `?${q}` : ''}${u.hash}`
}

export type LaunchDeps = {
  /** the address the page loaded with */
  loaded: string
  /** go where the link points, as a link in the app does */
  open: (href: string) => void
  /** ask for a new task (the New task command) */
  newTask: () => void
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
    d.open(href)
    if (wantsNewTask(href)) d.newTask()
  }
}
