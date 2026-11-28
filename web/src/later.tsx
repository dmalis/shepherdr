// Parts of the app whose code comes when they are first used, not in the first screen's script (docs/design.md,
// Performance: "Features you open load when opened"): voice and dictation, the screens, Settings, the agent picker.
// Each plugin keeps its registrations, keys and switch; only the code behind them comes later. A second after the
// first screen is up, they are fetched one at a time while the page is idle, so opening one is usually instant. A part
// that can't be fetched (offline, or this page is older than the app now served) says so, and is tried again on its
// next use.
import { createElement, useEffect, useState, type FC } from 'react'
import { notice } from './kernel.ts'

/** a module fetched on its first use: `part()` is it once here (else undefined), `part.load()` fetches it */
export interface Later<T> {
  (): T | undefined
  load(): Promise<T>
}

const parts: Later<unknown>[] = []

export function later<T>(get: () => Promise<T>): Later<T> {
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
  parts.push(part as Later<unknown>)
  return part
}

let said = 0
/** a part couldn't be fetched: said once, not per view that wanted it */
export function laterFailed(e?: unknown) {
  if (e) console.warn('a part of the app could not load:', e)
  if (Date.now() - said < 5000) return
  said = Date.now()
  notice("This part of Shepherdr couldn't load. Check the connection, then try again.", { tone: 'error' })
}

/** a view whose code comes later: nothing in its place until it is here, then the view itself */
export function laterView<V extends FC<any>>(get: () => Promise<V>): V {
  const part = later(get)
  function LaterView(props: Parameters<V>[0]) {
    const View = part()
    const [, came] = useState(0)
    useEffect(() => {
      if (!View) part.load().then(() => came((n) => n + 1), laterFailed)
    }, [View])
    return View ? createElement(View, props) : null
  }
  return LaterView as V
}

type Idle = (f: () => void, o?: { timeout: number }) => number
/** after the first screen: each part fetched in turn while the page is idle (Safari has no requestIdleCallback) */
export function warmLater(wait = 1000) {
  const idle: Idle = (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback ?? ((f) => setTimeout(f, 50) as unknown as number)
  let i = 0
  const next = () => {
    const part = parts[i++]
    if (!part) return
    if (part()) return next()
    part.load().then(() => idle(next, { timeout: 2000 }), () => undefined)
  }
  setTimeout(() => idle(next, { timeout: 2000 }), wait)
}
