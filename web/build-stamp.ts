// The build's stamp at build time (fork patch #44; web/shared/build-stamp.ts says what it is): the release the
// checkout starts from (its tag, or the commit that set package.json to its version), the changes merged on top (first-parent, so
// one merged pull request is one change), the commit, and the GitHub repo its origin names. No git, no checkout of
// its own (a release tarball, even one unpacked inside another repo) or no commit: null, and the build says only its
// version.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { SHOWN, type Stamp } from './shared/build-stamp.ts'

function git(root: string, args: string[]): string | null {
  try {
    const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] })
    return r.status === 0 ? r.stdout.trim() : null
  } catch {
    return null
  }
}

/** https://github.com/<owner>/<repo> for a GitHub remote (https, ssh or scp form, any sign-in in it dropped); else '' */
export function githubRepo(remote: string): string {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/:]+@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote.trim())
  return m ? `https://github.com/${m[1]}/${m[2]}` : ''
}

/**
 * The release this build starts from: its own tag when the checkout has it; else, by hand, the commit that set
 * package.json to this version (an install fetches without tags, so it may lack the newest one), never in a shallow
 * checkout; else the nearest release tag, as `git describe --tags --match 'v*'` finds it.
 */
function release(root: string, version: string): { tag: string; at: string } | null {
  if (version) {
    const tag = `v${version}`
    const at = git(root, ['rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`])
    if (at) return { tag, at }
    // a shallow checkout (CI's) cuts history short, and its edge would pass for the commit that set the version
    const set = git(root, ['rev-parse', '--is-shallow-repository']) === 'false' && git(root, ['log', '--no-merges', '--full-history', '--reverse', '--format=%H', `-S"version": "${version}"`, '--', 'package.json'])
    const first = set ? set.split('\n')[0] : ''
    if (first) return { tag, at: first }
  }
  const tag = git(root, ['describe', '--tags', '--abbrev=0', '--match', 'v*'])
  return tag ? { tag, at: tag } : null
}

export function buildStamp(root: string, version = ''): Stamp | null {
  const top = git(root, ['rev-parse', '--show-toplevel'])
  if (!top) return null
  try {
    if (realpathSync(top) !== realpathSync(root)) return null
  } catch {
    return null
  }
  const commit = git(root, ['rev-parse', 'HEAD'])
  if (!commit || !/^[0-9a-f]{40,64}$/.test(commit)) return null
  const repo = githubRepo(git(root, ['remote', 'get-url', 'origin']) ?? '')
  const from = release(root, version)
  if (!from) return { tag: '', ahead: 0, commit, repo, changes: [], more: 0 }
  // what this build has and the release hasn't, one line per merged change: fork patches merged before the release
  // came in are on top of it too, as git describe counts them
  const log = git(root, ['log', '--first-parent', '--format=%s', `${from.at}..HEAD`])
  // a log that can't be read must not pass for an exact release: the commit alone
  if (log === null) return { tag: '', ahead: 0, commit, repo, changes: [], more: 0 }
  const subjects = log.split('\n').filter(Boolean)
  return { tag: from.tag, ahead: subjects.length, commit, repo, changes: subjects.slice(0, SHOWN), more: Math.max(0, subjects.length - SHOWN) }
}
