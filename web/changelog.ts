// What's new at build time (fork patch #70; web/shared/changelog.ts says what it is): CHANGELOG.md's releases, their
// dates from git, and the changes merged on top of each release on this checkout's branch. A build without git gets
// CHANGELOG.md alone.
//
// The changes on top are the first-parent commits no release tag has (one merged pull request is one change),
// walked back from HEAD to the newest release commit. Each sits on the release package.json named at it: a commit that
// changes that version is a release coming in (an upstream sync's merge), so the changes before it sat on the one
// before. That needs no tag, as an install fetches without them.
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { githubRepo } from './build-stamp.ts'
import { parseChangelog, shown, SHORT, title, type Changelog, type OnTop } from './shared/changelog.ts'

function git(root: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 20_000, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })
    return r.status === 0 ? r.stdout : null
  } catch {
    return null
  }
}

/** this folder is a checkout of its own (a tarball unpacked inside another repo is not that repo's build) */
function ownCheckout(root: string): boolean {
  const top = git(root, ['rev-parse', '--show-toplevel'])?.trim()
  try {
    return !!top && realpathSync(top) === realpathSync(root)
  } catch {
    return false
  }
}

/** the most first-parent commits walked back: years of merges, and a stop for a checkout that has no tags at all */
const WALK = 3000

const versionAt = (root: string, rev: string): string => {
  try {
    return (JSON.parse(git(root, ['show', `${rev}:package.json`]) ?? '') as { version?: string }).version ?? ''
  } catch {
    return ''
  }
}

/** The changes on top of each release, newest first, from HEAD back to the newest release commit. */
export function onTop(root: string, version: string): OnTop[] {
  const SEP = '\x1e'
  const F = '\x1f'
  const log = git(root, ['log', '--first-parent', '--diff-merges=first-parent', '--name-only', `--format=${SEP}%H${F}%P${F}%s${F}%b${F}`, `-${WALK}`, 'HEAD', '--not', '--tags=v*'])
  if (log === null) return []
  const out: OnTop[] = []
  let top: OnTop = { v: version, changes: [], trail: [] }
  for (const rec of log.split(SEP).slice(1)) {
    const [sha = '', parents = '', subject = '', body = '', names = ''] = rec.split(F)
    // upstream's own release commit: what's before it is in CHANGELOG.md
    if (/^Release Shepherdr v?\d/.test(subject)) break
    const files = names.split('\n').map((f) => f.trim()).filter(Boolean)
    const id = sha.slice(0, SHORT)
    top.trail.push(id)
    const t = title(subject, body, parents.trim().includes(' '))
    if (files.includes('package.json')) {
      const was = versionAt(root, `${sha}^1`)
      // a release came in here: what's older sat on the one before
      if (was && was !== versionAt(root, sha)) {
        out.push(top)
        top = { v: was, changes: [], trail: [] }
        continue
      }
    }
    if (shown(t, files)) top.changes.push({ c: id, s: t })
  }
  out.push(top)
  return out.filter((t) => t.trail.length)
}

/** each release's date (YYYY-MM-DD): its tag's, else the date of the commit that released it upstream */
function dates(root: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of (git(root, ['log', '--format=%as %s', '--grep=^Release Shepherdr ', 'HEAD']) ?? '').split('\n')) {
    const r = /^(\d{4}-\d\d-\d\d) Release Shepherdr v?(\d+\.\d+\.\d+)/.exec(l)
    if (r && !m.has(r[2]!)) m.set(r[2]!, r[1]!)
  }
  for (const l of (git(root, ['for-each-ref', '--format=%(refname:short) %(creatordate:short)', 'refs/tags/v*']) ?? '').split('\n')) {
    const r = /^v(\d+\.\d+\.\d+\S*) (\d{4}-\d\d-\d\d)$/.exec(l.trim())
    if (r) m.set(r[1]!, r[2]!)
  }
  return m
}

export function changelog(root: string, version: string): Changelog {
  let md = ''
  try {
    md = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  } catch {
    /* none: only the changes on top */
  }
  const releases = parseChangelog(md)
  if (!ownCheckout(root)) return { releases, onTop: [], repo: '' }
  const when = dates(root)
  for (const r of releases) {
    const d = when.get(r.v)
    if (d) r.date = d
  }
  return { releases, onTop: onTop(root, version), repo: githubRepo(git(root, ['remote', 'get-url', 'origin']) ?? '') }
}

/** how many changes sit on top of this build's own release (About's "n changes on top") */
export const onTopCount = (log: Changelog, version: string) => (log.onTop[0]?.v === version ? log.onTop[0].changes.length : 0)
