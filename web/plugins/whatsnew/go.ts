// What's new's loading, the toast after an update, and going to a place in What's new (fork patch #70): the build's
// changelog is its own chunk, fetched the first time About or the toast asks for it. The toast says what the update
// brought and its button opens What's new there (whats-new.tsx draws it). Nothing here imports the kernel, so the
// words are tested without a page.
import { exact, short, stampOf, type Stamp } from '@shared/build-stamp.ts'
import { changesWords, since, type Changelog, type Since } from '@shared/changelog.ts'

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

/** the commit a build id ends with ("… @<commit>", fork patch #44), or '' for a build without one */
export const commitOf = (build: string) => /@([0-9a-f]{7,64})$/.exec(build)?.[1] ?? ''

/** the toast's words, and where in What's new its button opens: 'top' (the changes on top) or a release */
export type Updated = { text: string; at?: 'top' | string }

/**
 * The line after an update, naming the build as About does ("Updated to 3.2.22 · 9fedf5c"). Changes on top that the
 * old build didn't have: how many, opening What's new at them ("Updated · 3 new changes"), the way VS Code says
 * "updated, see the release notes". A new release says its number too ("Updated to 3.2.23 · 3 new changes"), and
 * opens What's new at the changes on top, else at the release.
 */
export function updatedWords(version: string, stamp: Stamp | null, news: Since | null): Updated {
  if (!version) return { text: 'Updated to the newest version' }
  const build = `Updated to ${version}${exact(stamp) ? '' : ` · ${short(stamp!.commit)}`}`
  const n = news?.changes.length ?? 0
  // the button opens at the newest of them: the changes on top of this release, or of an older one inside it
  const at = news?.newest && news.newest !== version ? news.newest : 'top'
  if (news && news.v !== version) return n ? { text: `Updated to ${version} · ${changesWords(n)}`, at } : { text: build, at: version }
  if (n) return { text: `Updated · ${changesWords(n)}`, at }
  return { text: build }
}

type Toast = { ms: number; act?: { label: string; run: () => void } }

/**
 * The toast after an update (the kernel's afterUpdate place): what it brought, from the build the old page ran
 * (`from`, its build id), with a button to What's new when there is something to see there; the plain line when the
 * list can't be had.
 */
export async function sayUpdated(version: string, fallback: string, from: string, say: (text: string, o: Toast) => unknown, open: () => void) {
  try {
    const log = await loadChangelog()
    const stamp = typeof document === 'undefined' ? null : stampOf(document.head.innerHTML)
    const was = commitOf(from)
    const w = updatedWords(version, stamp, was ? since(log, was) : null)
    const at = w.at
    say(w.text, { ms: 5000, ...(at && { act: { label: "What's new", run: () => goWhatsNew(at, open) } }) })
  } catch {
    say(fallback, { ms: 5000 })
  }
}
