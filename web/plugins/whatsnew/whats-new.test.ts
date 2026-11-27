// fork patch #70 (the whatsnew plugin): What's new's blocks, its dates, and the toast's words after an update
import { describe, expect, test } from 'bun:test'
import type { Changelog } from '@shared/changelog.ts'
import { commitOf, updatedWords } from './go.ts'
import { blocks, dateWords } from './whats-new.tsx'

const log: Changelog = {
  repo: 'https://github.com/o/r',
  releases: [
    { v: '3.2.22', date: '2026-11-27', groups: [{ title: 'Fixes', items: [{ line: 'A fix.' }] }] },
    { v: '3.2.21', date: '2026-11-20', groups: [] },
    { v: '3.2.20', groups: [] },
  ],
  onTop: [
    { v: '3.2.22', changes: [{ c: 'aaaaaaa', s: 'Sidebar: move a space' }], trail: ['aaaaaaa', 'bbbbbbb'] },
    { v: '3.2.21', changes: [{ c: 'ccccccc', s: 'Review rounds' }], trail: ['ccccccc'] },
  ],
}
const NOW = new Date(2026, 10, 28)

describe("What's new", () => {
  test('the build\'s changes on top first, then each release with its date; earlier changes on top inside their release', () => {
    const b = blocks(log, '3.2.22', NOW)
    expect(b.map((x) => [x.key, x.head, x.meta, x.ours.map((c) => c.s)])).toEqual([
      ['top', 'On top of 3.2.22', '1 change', ['Sidebar: move a space']],
      ['3.2.22', '3.2.22', 'Nov 27', []],
      ['3.2.21', '3.2.21', 'Nov 20', ['Review rounds']],
      ['3.2.20', '3.2.20', '', []],
    ])
  })

  test('nothing on top: the releases alone; changes on top of a release CHANGELOG.md lacks keep a block of their own', () => {
    expect(blocks({ ...log, onTop: [] }, '3.2.22', NOW).map((x) => x.key)).toEqual(['3.2.22', '3.2.21', '3.2.20'])
    const odd = blocks({ ...log, onTop: [{ v: '3.2.19-x', changes: [{ c: 'ddddddd', s: 'Odd' }], trail: ['ddddddd'] }] }, '3.2.22', NOW)
    expect(odd.map((x) => x.key)).toEqual(['3.2.19-x', '3.2.22', '3.2.21', '3.2.20'])
  })

  test('a date reads short, with its year when it isn\'t this year\'s', () => {
    expect(dateWords('2026-11-27', NOW)).toBe('Nov 27')
    expect(dateWords('2025-01-03', NOW)).toBe('Jan 3, 2025')
    expect(dateWords('nope', NOW)).toBe('')
  })
})

describe('the toast after an update', () => {
  const stamp = { tag: 'v3.2.22', ahead: 3, commit: '9fedf5c' + '0'.repeat(33), repo: '' }
  test('names the build as About does', () => {
    expect(updatedWords('3.2.22', stamp, null)).toEqual({ text: 'Updated to 3.2.22 · 9fedf5c' })
    expect(updatedWords('3.2.22', { ...stamp, ahead: 0 }, null)).toEqual({ text: 'Updated to 3.2.22' })
    expect(updatedWords('3.2.22', null, null)).toEqual({ text: 'Updated to 3.2.22' })
    expect(updatedWords('', null, null)).toEqual({ text: 'Updated to the newest version' })
  })
  test('new changes on top of the same release: how many, opening What\'s new at them', () => {
    const c = (n: number) => Array.from({ length: n }, (_, i) => ({ c: `${i}`.padStart(7, 'a'), s: `C${i}` }))
    expect(updatedWords('3.2.22', stamp, { v: '3.2.22', changes: c(3) })).toEqual({ text: 'Updated · 3 new changes', at: 'top' })
    expect(updatedWords('3.2.22', stamp, { v: '3.2.22', changes: c(1) })).toEqual({ text: 'Updated · 1 new change', at: 'top' })
    // only housekeeping came: the build, no button
    expect(updatedWords('3.2.22', stamp, { v: '3.2.22', changes: [] })).toEqual({ text: 'Updated to 3.2.22 · 9fedf5c' })
  })
  test('a new release: its number and what came on top, opening at them, else at the release', () => {
    expect(updatedWords('3.2.22', stamp, { v: '3.2.21', changes: [] })).toEqual({ text: 'Updated to 3.2.22 · 9fedf5c', at: '3.2.22' })
    expect(updatedWords('3.2.22', stamp, { v: '3.2.21', changes: [{ c: 'aaaaaaa', s: 'A' }, { c: 'bbbbbbb', s: 'B' }], newest: '3.2.22' })).toEqual({ text: 'Updated to 3.2.22 · 2 new changes', at: 'top' })
    // the changes all sat on the release before: What's new opens at that release, where they are
    expect(updatedWords('3.2.22', stamp, { v: '3.2.21', changes: [{ c: 'aaaaaaa', s: 'A' }], newest: '3.2.21' })).toEqual({ text: 'Updated to 3.2.22 · 1 new change', at: '3.2.21' })
  })
  test('the old build\'s commit comes from its build id', () => {
    expect(commitOf(`assets/a.js v3.2.22 @${stamp.commit}`)).toBe(stamp.commit)
    expect(commitOf('assets/a.js v3.2.22')).toBe('')
  })
})
