// Which build this is, beyond its release number (fork patch #44). Every build out of a git checkout says the release
// tag it starts from, how many changes sit on top of it and the commit it was built from, as `git describe` does; a
// build without git (a release tarball) says nothing more than its version. Stamped at build time (web/build-stamp.ts)
// into index.html beside the version, read back by the page (Settings › About) and by the service (webbuild.ts), so a
// device on an older build of the same version can be told apart from what the service serves.

export type Stamp = {
  /** the release tag the build starts from ('v3.2.22'); '' when the checkout has none */
  tag: string
  /** changes merged on top of that tag (first-parent commits); 0 is exactly the release */
  ahead: number
  /** the full commit it was built from */
  commit: string
  /** where that commit is on GitHub (https://github.com/<owner>/<repo>), from the checkout's origin; '' when not GitHub */
  repo: string
  /** what is on top, newest first: at most SHOWN subjects */
  changes?: string[]
  /** how many more changes are on top than `changes` lists */
  more?: number
}

/** the list in About is short: this many changes, then "and n more" */
export const SHOWN = 10

export const STAMP_ID = 'shepherdr-build'

/** the stamp as index.html carries it: JSON in a script tag the page never runs (`<` escaped, so no subject ends it) */
export function stampJson(s: Stamp): string {
  return JSON.stringify(s).replace(/</g, '\\u003c')
}

/** A build's stamp from its index.html (or the page's head): null for a build without one. */
export function stampOf(html: string): Stamp | null {
  const m = new RegExp(`<script[^>]*\\bid="${STAMP_ID}"[^>]*>([^<]*)</script>`).exec(html)
  if (!m) return null
  try {
    const s = JSON.parse(m[1]!) as Partial<Stamp>
    if (typeof s.commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(s.commit)) return null
    return {
      tag: typeof s.tag === 'string' ? s.tag : '',
      ahead: typeof s.ahead === 'number' && s.ahead >= 0 ? s.ahead : 0,
      commit: s.commit,
      repo: typeof s.repo === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(s.repo) ? s.repo : '',
      changes: Array.isArray(s.changes) ? s.changes.filter((c): c is string => typeof c === 'string') : [],
      more: typeof s.more === 'number' && s.more > 0 ? s.more : 0,
    }
  } catch {
    return null
  }
}

/** the commit as people read it: its first 7 characters, as GitHub shows one */
export const short = (commit: string) => commit.slice(0, 7)

/** exactly the release its version names: nothing to add to the number */
export const exact = (s: Stamp | null | undefined) => !s || (!!s.tag && s.ahead === 0)

/** Where the commit opens on GitHub, or null when the checkout isn't on GitHub. */
export const commitUrl = (s: Stamp) => (s.repo ? `${s.repo}/commit/${s.commit}` : null)

/** "6 changes on top", or "6 changes since 3.2.21" when the tag isn't this version's; '' for none or no tag */
export function aheadWords(version: string, s: Stamp): string {
  if (!s.tag || s.ahead === 0) return ''
  const n = `${s.ahead} ${s.ahead === 1 ? 'change' : 'changes'}`
  const from = s.tag.replace(/^v/, '')
  return from === version ? `${n} on top` : `${n} since ${from}`
}
