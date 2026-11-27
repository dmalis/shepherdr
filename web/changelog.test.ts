// fork patch #70: What's new at build time, read from a real throwaway git repo shaped like the fork's history
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { changelog, onTopCount } from './changelog.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function git(d: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}

const put = (d: string, f: string, text: string) => { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), text); git(d, 'add', f) }
const commit = (d: string, subject: string, file = 'web/src/a.ts') => { put(d, file, subject); git(d, 'commit', '-q', '-m', subject) }
const pkg = (d: string, v: string) => put(d, 'package.json', `{\n  "name": "x",\n  "version": "${v}"\n}\n`)
const CHANGES = '# Changelog\n\n## 1.1.0\n\n- New things. More words.\n\n## 1.0.0\n\n- First.\n'

/**
 * The fork's shape: upstream's release commits, our pull requests on main, the next release merged in on the second
 * parent (a merge commit, as the sync's pull request is), more of ours after.
 */
function fork(tags: boolean): string {
  const d = mkdtempSync(join(tmpdir(), 'changelog-'))
  dirs.push(d)
  git(d, 'init', '-q', '-b', 'main')
  pkg(d, '1.0.0')
  put(d, 'CHANGELOG.md', '# Changelog\n\n## 1.0.0\n\n- First.\n')
  git(d, 'commit', '-q', '-m', 'Release Shepherdr 1.0.0 (#10)')
  if (tags) git(d, 'tag', 'v1.0.0')
  git(d, 'checkout', '-q', '-b', 'upstream')
  commit(d, 'Upstream fix (#11)', 'service/u.ts')
  pkg(d, '1.1.0')
  put(d, 'CHANGELOG.md', CHANGES)
  git(d, 'commit', '-q', '-m', 'Release Shepherdr 1.1.0 (#12)')
  if (tags) git(d, 'tag', 'v1.1.0')
  git(d, 'checkout', '-q', 'main')
  commit(d, 'Fork setup: rules', 'FORK.md')
  commit(d, 'Review rounds back in Settings (#1)')
  commit(d, 'Sync: CI and state (#2)', 'fork/sync/ci.py')
  git(d, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #3 from o/sync/v1.1.0', '-m', 'Take upstream v1.1.0', 'upstream')
  commit(d, 'Fork rule: follow standards (#4)', 'web/src/b.ts')
  commit(d, 'Sidebar: move a space above groups (#5)')
  commit(d, 'Spec the next thing (#6)', 'fork/specs/next.md')
  git(d, 'checkout', '-q', '-b', 'side')
  commit(d, 'Alerts a', 'service/alerts.ts')
  git(d, 'checkout', '-q', 'main')
  git(d, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from o/alerts', '-m', 'Alerts: a list in the app', 'side')
  git(d, 'remote', 'add', 'origin', 'git@github.com:someone/shepherdr.git')
  return d
}

const sha = (d: string, rev: string) => git(d, 'rev-parse', '--short=7', rev)

describe('changelog at build time', () => {
  test('the changes on top of each release, newest first, housekeeping left out, merges by their pull request title', () => {
    const d = fork(true)
    const log = changelog(d, '1.1.0')
    expect(log.repo).toBe('https://github.com/someone/shepherdr')
    expect(log.releases.map((r) => r.v)).toEqual(['1.1.0', '1.0.0'])
    expect(log.onTop.map((t) => ({ v: t.v, s: t.changes.map((c) => c.s) }))).toEqual([
      { v: '1.1.0', s: ['Alerts: a list in the app', 'Sidebar: move a space above groups'] },
      { v: '1.0.0', s: ['Review rounds back in Settings'] },
    ])
    expect(log.onTop[0]!.changes[0]!.c).toBe(sha(d, 'HEAD'))
    // every commit is in the trail, the housekeeping and the release's merge too, so an update can count from any build
    expect(log.onTop[0]!.trail).toEqual([sha(d, 'HEAD'), sha(d, 'HEAD~1'), sha(d, 'HEAD~2'), sha(d, 'HEAD~3'), sha(d, 'HEAD~4')])
    expect(log.onTop[1]!.trail.length).toBe(3)
    expect(onTopCount(log, '1.1.0')).toBe(2)
    expect(onTopCount(log, '1.2.0')).toBe(0)
  })

  test('an install fetches without tags: the same, found by package.json and upstream\'s release commit', () => {
    const d = fork(false)
    const log = changelog(d, '1.1.0')
    expect(log.onTop.map((t) => ({ v: t.v, n: t.changes.length }))).toEqual([{ v: '1.1.0', n: 2 }, { v: '1.0.0', n: 1 }])
  })

  test('each release gets its date: its tag, else its release commit', () => {
    const d = fork(false)
    const day = git(d, 'log', '-1', '--format=%as', ':/Release Shepherdr 1.1.0')
    expect(changelog(d, '1.1.0').releases.map((r) => r.date)).toEqual([day, day])
  })

  test('exactly a release: no changes on top', () => {
    const d = fork(true)
    git(d, 'checkout', '-q', 'v1.1.0')
    const log = changelog(d, '1.1.0')
    expect(log.onTop).toEqual([])
    expect(log.releases.length).toBe(2)
  })

  test('no git (a release tarball), or a folder inside another repo: CHANGELOG.md alone', () => {
    const d = mkdtempSync(join(tmpdir(), 'changelog-'))
    dirs.push(d)
    writeFileSync(join(d, 'CHANGELOG.md'), CHANGES)
    expect(changelog(d, '1.1.0')).toEqual({ releases: [{ v: '1.1.0', groups: [{ title: '', items: [{ line: 'New things.', rest: 'More words.' }] }] }, { v: '1.0.0', groups: [{ title: '', items: [{ line: 'First.' }] }] }], onTop: [], repo: '' })
    const outer = fork(true)
    mkdirSync(join(outer, 'shepherdr'))
    writeFileSync(join(outer, 'shepherdr', 'CHANGELOG.md'), CHANGES)
    expect(changelog(join(outer, 'shepherdr'), '1.1.0').onTop).toEqual([])
  })
})

// The seams this patch hangs on: if one of these changes, the next sync sees it here.
describe('pinned seams', () => {
  const at = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  test('CHANGELOG.md keeps one "## <version>" per release, its own version first', () => {
    const v = (JSON.parse(at('../package.json')) as { version: string }).version
    expect(/^## (\S+)$/m.exec(at('../CHANGELOG.md'))?.[1]).toBe(v)
  })
  test('the build makes the module and counts it into the stamp; About shows it; the toast after an update asks it', () => {
    expect(at('./vite.config.ts')).toContain("if (STAMP) STAMP.onTop = onTopCount(LOG, VERSION)")
    expect(at('./vite.config.ts')).toMatch(/name: 'shepherdr-changelog'.*CHANGELOG_ID/)
    expect(at('./src/about.tsx')).toMatch(/<WhatsNew \/>\n    <\/>/)
    expect(at('./src/kernel.ts')).toContain("const after = afterLoad(mark, BUILD, OWN_VERSION, Date.now())")
    expect(at('./src/kernel.ts')).toContain("sayUpdated(said, commitOf(mark?.from ?? ''), notice, () => openSettings('all', 'About'))")
  })
})
