// What's new's loading, and going to a place in it (fork patch #70): the build's changelog is its own chunk, fetched
// the first time About or the toast after an update asks for it. The toast says what the update brought and its
// button opens What's new there (whats-new.tsx draws it). Nothing here imports the kernel, which calls it.
import { stampOf } from '@shared/build-stamp.ts'
import { since, type Changelog } from '@shared/changelog.ts'
import type { ToastOpts } from './toasts.ts'
import { OWN_VERSION, updatedWords } from './update.ts'

let loading: Promise<Changelog> | null = null
/** the build's changelog, once */
export function loadChangelog(): Promise<Changelog> {
  loading ??= import('virtual:shepherdr-changelog').then((m) => m.default)
  loading.catch(() => (loading = null))
  return loading
}

let goto: string | null = null
const wanted = new Set<() => void>()

/** where What's new was asked to open ('top' or a release's version), once */
export function takeGoto(): string | null {
  const at = goto
  goto = null
  return at
}

/** a mounted What's new hears when it is asked to go somewhere */
export function onGoto(f: () => void): () => void {
  wanted.add(f)
  return () => void wanted.delete(f)
}

/** Asks What's new to open at 'top' (the changes on top) or a release, after `open` brought Settings › About up. */
export function goWhatsNew(at: string, open: () => void) {
  goto = at
  open()
  wanted.forEach((f) => f())
}

/**
 * The toast after an update (kernel.ts): what it brought, from the commit the old page ran, with a button to What's
 * new when there is something to see there; the plain line when the list can't be had.
 */
export async function sayUpdated(fallback: string, was: string, say: (text: string, o: ToastOpts) => unknown, open: () => void) {
  try {
    const log = await loadChangelog()
    const stamp = typeof document === 'undefined' ? null : stampOf(document.head.innerHTML)
    const w = updatedWords(OWN_VERSION, stamp, was ? since(log, was) : null)
    const at = w.at
    say(w.text, { ms: 5000, ...(at && { act: { label: "What's new", run: () => goWhatsNew(at, open) } }) })
  } catch {
    say(fallback, { ms: 5000 })
  }
}
