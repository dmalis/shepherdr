// The page starts here: the styles, this device's look, the plugins that are on, the link to the server.
import './styles.css'
import './prefs.ts'
import './awake.ts'
import './warnings.tsx'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import plugins, { enabled, user } from '../generated/client-plugins.ts'
import { App } from './App.tsx'
import { boot } from './boot.ts'
import { connect, getState, registry, retryNow, setUI, subscribe, useStore, useUI } from './kernel.ts'
import { warmLater } from './later.tsx'
import { offlineWords, TRY_AGAIN } from './states.ts'
import { applySizes } from './resize.ts'
import { UpdateChip } from './update-chip.tsx'
import { watchViewport } from './viewport.ts'
import { LiveRegion } from './ui.tsx'

/** Your phone can't reach Shepherdr: a thin line. What you see stays, as it was when the link went (said with its
 *  time), it tries again by itself, and Try again tries now. What you typed stays in the box and sends when it is back.
 *  A screen reader hears it go and come back once, through the live region (kernel.ts), not from this line. */
function Offline() {
  const offline = useUI((u) => u.offline)
  const restarting = useStore((s) => s.update?.state === 'restarting')
  const [trying, setTrying] = useState(false)
  useEffect(() => {
    if (!trying) return
    const t = setTimeout(() => setTrying(false), 2000)
    return () => clearTimeout(t)
  }, [trying])
  if (!offline) return null
  return (
    <div className="tline">
      <span>{offlineWords(offline, restarting)}</span>
      {!restarting && (
        <button type="button" className="lk" aria-disabled={trying || undefined} onClick={() => trying || (setTrying(true), retryNow())}>
          {trying ? 'Trying…' : TRY_AGAIN}
        </button>
      )}
    </div>
  )
}
registry.topBars.push(Offline, UpdateChip)

async function start() {
  // fork #163: api/me and the link at once, the plugins side by side (boot.ts). api/me is bounded: a service that never
  // answers must not keep the page blank (it then says Loading…, then can't reach)
  const off = await boot({ plugins, enabled, user, me: () => fetch('api/me', { signal: AbortSignal.timeout(3000) }), connect })
  applySizes()
  watchViewport((up) => setUI({ keyboard: up }))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
      {/* the one live region (live.ts), beside the app so the first snapshot doesn't replace it */}
      <LiveRegion />
    </StrictMode>,
  )
  // the parts that come later (later.tsx): fetched once the first snapshot is here and the page is idle
  const warm = () => {
    if (!getState().snap) return false
    warmLater(off)
    return true
  }
  if (!warm()) {
    const stop = subscribe(() => warm() && stop())
  }
}
void start()
