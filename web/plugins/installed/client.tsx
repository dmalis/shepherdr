// fork #34: Shepherdr as an installed app (Chrome's Install on a desktop, Add to Home Screen on a phone). The manifest's
// shortcuts (Everything, Needs you, New task) and links Chrome opens in the app reach the window already open
// (launch.ts); New task asks the space's Assistant, as C does. Its sheet (installed.css): the headers in a desktop
// window's title bar (window controls overlay), the phone's safe areas on every screen, no rubber band on the frame.
import './installed.css'
import { definePlugin, getState, launchHref, openLink, registry, subscribe } from '@client/kernel.ts'
import { launches, wantsNewTask, withoutNew } from './launch.ts'

type LaunchParams = { targetURL?: string | null }
type LaunchQueue = { setConsumer: (f: (p: LaunchParams) => void) => void }

/** the New task command (the tasks plugin's C), once the spaces are known and the message box is drawn */
function newTask() {
  const run = () => {
    if (!getState().snap) return false
    const c = registry.commands.find((x) => x.id === 'tasks.new')
    if (c && (!c.when || c.when())) setTimeout(() => c.run(), 300)
    return true
  }
  if (run()) return
  const off = subscribe(() => run() && off())
}

export default definePlugin({
  name: 'installed',
  setup() {
    // opened from the New task shortcut: the address loses `new` so a reload asks for none
    if (wantsNewTask(launchHref)) {
      const clean = withoutNew(location.href)
      if (clean !== null) history.replaceState(history.state, '', clean)
      newTask()
    }
    const handle = launches({ loaded: launchHref, open: (href) => openLink(href, true), newTask, now: () => Date.now() })
    ;(window as { launchQueue?: LaunchQueue }).launchQueue?.setConsumer((p) => handle(p.targetURL))
  },
})
