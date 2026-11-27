// fork patch #44: the build's stamp, read from a real throwaway git repo
import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStamp, githubRepo } from './build-stamp.ts'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'stamp-'))
  dirs.push(d)
  git(d, 'init', '-q', '-b', 'main')
  return d
}

function git(d: string, ...args: string[]): string {
  const r = spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
  if (r.status !== 0) throw new Error(r.stderr)
  return r.stdout.trim()
}

const commit = (d: string, subject: string) => { writeFileSync(join(d, 'f'), subject); git(d, 'add', 'f'); git(d, 'commit', '-q', '-m', subject) }

describe('buildStamp', () => {
  test('no git: null, the build says only its version', () => {
    const d = mkdtempSync(join(tmpdir(), 'stamp-'))
    dirs.push(d)
    expect(buildStamp(d)).toBeNull()
  })

  test('a folder inside another repo (a tarball unpacked there) is not that repo’s build', () => {
    const d = repo()
    commit(d, 'one')
    mkdirSync(join(d, 'shepherdr'))
    expect(buildStamp(join(d, 'shepherdr'))).toBeNull()
  })

  test('exactly a release: no changes on top', () => {
    const d = repo()
    commit(d, 'Release 3.2.22')
    git(d, 'tag', 'v3.2.22')
    git(d, 'tag', 'ours-3.2.22-1')
    git(d, 'remote', 'add', 'origin', 'https://github.com/someone/shepherdr.git')
    const s = buildStamp(d)!
    expect(s).toMatchObject({ tag: 'v3.2.22', ahead: 0, repo: 'https://github.com/someone/shepherdr', changes: [], more: 0 })
    expect(s.commit).toBe(git(d, 'rev-parse', 'HEAD'))
  })

  test('changes on top: one per merged change (first-parent), newest first, at most 10 then more', () => {
    const d = repo()
    commit(d, 'Release 3.2.22')
    git(d, 'tag', 'v3.2.22')
    for (let i = 1; i <= 11; i++) commit(d, `Change ${i} (#${i})`)
    // a merged branch counts once, by its merge commit, not by each of its commits
    git(d, 'checkout', '-q', '-b', 'side')
    commit(d, 'side a')
    commit(d, 'side b')
    git(d, 'checkout', '-q', 'main')
    git(d, 'merge', '-q', '--no-ff', '-m', 'Merge the side change', 'side')
    const s = buildStamp(d)!
    expect(s.ahead).toBe(12)
    expect(s.changes).toEqual(['Merge the side change', 'Change 11 (#11)', 'Change 10 (#10)', 'Change 9 (#9)', 'Change 8 (#8)', 'Change 7 (#7)', 'Change 6 (#6)', 'Change 5 (#5)', 'Change 4 (#4)', 'Change 3 (#3)'])
    expect(s.more).toBe(2)
    expect(s.repo).toBe('')
  })

  test('only v tags count as releases', () => {
    const d = repo()
    commit(d, 'one')
    git(d, 'tag', 'v1.0.0')
    commit(d, 'two')
    git(d, 'tag', 'ours-1.0.0-1')
    expect(buildStamp(d)).toMatchObject({ tag: 'v1.0.0', ahead: 1, changes: ['two'] })
  })

  test('no release tag: the commit alone', () => {
    const d = repo()
    commit(d, 'one')
    expect(buildStamp(d)).toMatchObject({ tag: '', ahead: 0, changes: [] })
  })
})

describe('githubRepo', () => {
  test('https, ssh and scp forms; a sign-in in the address never comes along', () => {
    expect(githubRepo('https://github.com/dmalis/shepherdr.git')).toBe('https://github.com/dmalis/shepherdr')
    expect(githubRepo('https://x-access-token:abc123@github.com/o/r.git')).toBe('https://github.com/o/r')
    expect(githubRepo('git@github.com:o/r.git')).toBe('https://github.com/o/r')
    expect(githubRepo('ssh://git@github.com/o/r')).toBe('https://github.com/o/r')
    expect(githubRepo('https://github.com/o/r/')).toBe('https://github.com/o/r')
  })

  test('not GitHub, or not a repo: none', () => {
    expect(githubRepo('https://gitlab.com/o/r.git')).toBe('')
    expect(githubRepo('https://github.com.evil.example/o/r')).toBe('')
    expect(githubRepo('/srv/git/shepherdr')).toBe('')
    expect(githubRepo('')).toBe('')
  })
})
