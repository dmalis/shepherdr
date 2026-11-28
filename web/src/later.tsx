// Parts of the app whose code comes when they are first used, not in the first screen's script (docs/design.md,
// Performance: "Features you open load when opened"): Settings, the pickers, the Screen view, what a call reads of the
// page. Each plugin keeps its registrations, keys and switch; only the code behind them comes later. A second after the
// first screen is up, the parts of the plugins that are on are fetched one at a time while the page is idle, so opening
// one is usually instant. A part that can't be fetched (offline, or this page is older than the app now served) says
// so, with Reload beside it, and is tried again on its next use. What must run inside a tap (the microphone's and a
// call's audio) is never one of these.
import { createElement, useEffect, useState, type FC } from 'react'
import { notice, updateNow } from './kernel.ts'

/** a module fetched on its first use: `part()` is it once here (else undefined), `part.load()` fetches it */
export interface Later<T> {
  (): T | undefined
  load(): Promise<T>
}

/** each part, with the plugin it belongs to (none: the app's own) */
const parts: { part: Later<unknown>; of?: string }[] = []

export function later<T>(get: () => Promise<T>, of?: string): Later<T> {
  let mod: T | undefined
  let asking: Promise<T> | null = null
  const part = (() => mod) as Later<T>
  part.load = () =>
    (asking ??= get().then(
      (m) => (mod = m),
      (e: unknown) => {
        // tried again on the next use
        asking = null
        throw e
      },
    ))
  parts.push({ part: part as Later<unknown>, of })
  return part
}

let said = 0
/** a part couldn't be fetched: said once, not per view that wanted it. Reload brings the app as it is served now,
 *  what was typed and where you were kept (an update can take the old files away) */
export function laterFailed(e?: unknown) {
  if (e) console.warn('a part of the app could not load:', e)
  if (Date.now() - said < 5000) return
  said = Date.now()
  notice("This part of Shepherdr couldn't load. Check the connection, then reload.", { tone: 'error', sticky: true, act: { label: 'Reload', run: updateNow } })
}

/** a view whose code comes later: nothing in its place until it is here, then the view itself. `failed` closes
 *  whatever it was opened in, when its code can't be fetched (so no empty layer is left over the app) */
export function laterView<V extends FC<any>>(get: () => Promise<V>, failed?: () => void, of?: string): V {
  const part = later(get, of)
  function LaterView(props: Parameters<V>[0]) {
    const View = part()
    const [, came] = useState(0)
    useEffect(() => {
      if (!View)
        part.load().then(
          () => came((n) => n + 1),
          (e: unknown) => {
            failed?.()
            laterFailed(e)
          },
        )
    }, [View])
    return View ? createElement(View, props) : null
  }
  return LaterView as V
}

type Idle = (f: () => void, o?: { timeout: number }) => number
/** after the first screen: each part of the app and of the plugins that are on, fetched in turn while the page is idle
 *  (Safari has no requestIdleCallback) */
export function warmLater(off: string[] = [], wait = 1000) {
  const idle: Idle = (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback ?? ((f) => setTimeout(f, 50) as unknown as number)
  let i = 0
  const next = () => {
    const p = parts[i++]
    if (!p) return
    if (p.part() || (p.of && off.includes(p.of))) return next()
    p.part.load().then(() => idle(next, { timeout: 2000 }), () => undefined)
  }
  setTimeout(() => idle(next, { timeout: 2000 }), wait)
}
