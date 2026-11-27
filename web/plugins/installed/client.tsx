// fork #34: Shepherdr as an installed app (Chrome's Install on a desktop, Add to Home Screen on a phone). The manifest's
// shortcuts (Everything, Needs you, New task) and links Chrome opens in the app reach the window already open
// (launch.ts); New task asks the space's Assistant, as C does. Its sheet (installed.css): the headers in a desktop
// window's title bar (window controls overlay), the phone's safe areas on every screen, no rubber band on the frame.
import './installed.css'
import { definePlugin, getState, launchHref, openLink, registry, setUI, subscribe } from '@client/kernel.ts'
import { everything, placeOf } from '@shared/view.ts'
import { NO_FILTER } from '@shared/task-filter.ts'
import { launches, wantsNeeds, wantsNewTask, withoutAsks } from './launch.ts'

type LaunchParams = { targetURL?: string | null }
type LaunchQueue = { setConsumer: (f: (p: LaunchParams) => void) => void }

/** runs `f` once the spaces are known */
function withSnap(f: () => void) {
  if (getState().snap) return f()
  const off = subscribe(() => {
    if (!getState().snap) return
    off()
    f()
  })
}

/** the New task command (the tasks plugin's C), once the message box is drawn */
const newTask = () =>
  withSnap(() => {
    const c = registry.commands.find((x) => x.id === 'tasks.new')
    if (c && (!c.when || c.when())) setTimeout(() => c.run(), 300)
  })

/** the Needs you group: Tasks on Now, unfiltered, the group open */
const needs = () => withSnap(() => setUI((ui) => ({ tab: 'Now', tf: NO_FILTER, open: { ...ui.open, 'Needs you': true } })))

/** a place the list doesn't have (`everything` in a shortcut) is Everything */
function open(href: string) {
  const u = new URL(href)
  const snap = getState().snap
  const place = u.searchParams.get('place')
  if (snap && place && !placeOf(snap, place)) {
    const ev = everything(snap)?.id
    if (ev) u.searchParams.set('place', ev)
    else u.searchParams.delete('place')
  }
  openLink(u.href, true)
}

const reloaded = () => {
  try {
    return (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'
  } catch {
    return false
  }
}

export default definePlugin({
  name: 'installed',
  setup() {
    // opened from a shortcut: the address loses its one-off asks so a reload asks for none (voice reads its own)
    if (wantsNewTask(launchHref) || wantsNeeds(launchHref)) {
      const clean = withoutAsks(location.href)
      if (clean !== null) history.replaceState(history.state, '', clean)
      if (wantsNeeds(launchHref)) needs()
      if (wantsNewTask(launchHref)) newTask()
    }
    const handle = launches({
      loaded: launchHref,
      reloaded: reloaded(),
      here: () => location.href,
      open,
      away: (href) => void window.open(href, '_blank', 'noopener,noreferrer'),
      newTask,
      needs,
      call: () => registry.voiceWake?.(),
      now: () => Date.now(),
    })
    ;(window as { launchQueue?: LaunchQueue }).launchQueue?.setConsumer((p) => handle(p.targetURL))
  },
})
