// fork patch #70: What's new's parsing and words, and the update toast's count
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { firstSentence, parseChangelog, plain, shown, since, title, type OnTop } from './changelog.ts'

describe('CHANGELOG.md', () => {
  const md = [
    '# Changelog',
    '',
    '## 3.2.22',
    '',
    'A short intro. It says more.',
    '',
    '### What you will notice first',
    '',
    '- Needs you alerts are for questions only you can answer. Routine task waits go to the space\'s Assistant, and',
    '  old alerts clear when the task can move on.',
    '- Effort levels use capitals.',
    '- See [macOS service accounts](https://github.com/o/r/blob/v3.2.22/docs/settings.md#x) for **how**. Then go.',
    '',
    '### Updating',
    '',
    'Run `shepherdr update`. Codex may ask you to review Shepherdr\'s permission hook once after this update. If it does,',
    'review it in the Codex terminal.',
    '',
    '### Empty',
    '',
    '## v3.2.21',
    '',
    '- One.',
    '',
    '## 2.1.1',
    '',
    'See branch `v2.1`.',
  ].join('\n')

  test('one release per version heading, newest first, with its groups; wrapped lines are one bullet', () => {
    const r = parseChangelog(md)
    expect(r.map((x) => x.v)).toEqual(['3.2.22', '3.2.21', '2.1.1'])
    expect(r[0]!.groups.map((g) => g.title)).toEqual(['', 'What you will notice first', 'Updating'])
    expect(r[0]!.groups[1]!.items[0]).toEqual({ line: 'Needs you alerts are for questions only you can answer.', rest: "Routine task waits go to the space's Assistant, and old alerts clear when the task can move on." })
    expect(r[0]!.groups[1]!.items[1]).toEqual({ line: 'Effort levels use capitals.' })
    expect(r[2]!.groups).toEqual([{ title: '', items: [{ line: 'See branch `v2.1`.' }] }])
  })

  test('no link leaves the app: a link is its words; bold is plain', () => {
    expect(parseChangelog(md)[0]!.groups[1]!.items[2]).toEqual({ line: 'See macOS service accounts for how.', rest: 'Then go.' })
    expect(plain('a ![pic](x.png) and [b](https://e.example)')).toBe('a pic and b')
  })

  test('a paragraph is an item too, its code kept', () => {
    expect(parseChangelog(md)[0]!.groups[2]!.items[0]!.line).toBe('Run `shepherdr update`.')
  })

  test('the real CHANGELOG.md: every release, each with something to show', () => {
    const real = parseChangelog(readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'))
    const heads = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8').match(/^## /gm)!.length
    expect(real.length).toBe(heads)
    for (const r of real) expect(r.groups.flatMap((g) => g.items).length).toBeGreaterThan(0)
  })
})

describe('first sentences', () => {
  test('up to the end of the first sentence', () => {
    expect(firstSentence('Find Everything by name. Kept artifacts stay.')).toBe('Find Everything by name.')
    expect(firstSentence('Does it work? Yes.')).toBe('Does it work?')
    expect(firstSentence('One sentence only.')).toBe('One sentence only.')
    expect(firstSentence('No full stop')).toBe('No full stop')
  })
  test('not at a version, a file name, an abbreviation or inside code', () => {
    expect(firstSentence('Needs Herdr 0.1.12 or newer. Then more.')).toBe('Needs Herdr 0.1.12 or newer.')
    expect(firstSentence('Tools, e.g. Codex, work. Then more.')).toBe('Tools, e.g. Codex, work.')
    expect(firstSentence('Run `a. B` now. Then more.')).toBe('Run `a. B` now.')
    expect(firstSentence('Open README.md to read. Then more.')).toBe('Open README.md to read.')
    expect(firstSentence('A stop. lowercase goes on')).toBe('A stop. lowercase goes on')
  })
})

describe('the changes on top', () => {
  test('a squash is its subject without "(#n)"; a merge commit is its pull request title', () => {
    expect(title('Sidebar: move a space above groups (#41)')).toBe('Sidebar: move a space above groups')
    expect(title('Merge pull request #23 from o/sync/v3.2.22', '\nTake upstream v3.2.22\n', true)).toBe('Take upstream v3.2.22')
    expect(title('Merge branch main into x', '', true)).toBe('')
    // not a merged pull request: a branch's own commit isn't a change yet
    expect(title('Fix (#2) in the middle')).toBe('')
    expect(title('About: a changelog')).toBe('')
    expect(title('Waiting prompts count under Needs you (#45) (#64)')).toBe('Waiting prompts count under Needs you')
  })

  test('housekeeping and changes that install nothing are left out', () => {
    expect(shown('Sidebar: move a space above groups', ['web/src/list.tsx', 'fork/patches.json'])).toBe(true)
    expect(shown('Fork rule: follow industry standards', ['web/src/x.ts'])).toBe(false)
    expect(shown('Sync: install merged', ['bin/shepherdr'])).toBe(false)
    expect(shown('AGENTS.md: a line', ['service/x.ts'])).toBe(false)
    expect(shown('Spec the upstream sync', ['fork/specs/sync.md'])).toBe(false)
    expect(shown('Upstream issues: a rule', ['FORK.md', '.agents/skills/a/SKILL.md', '.claude/skills/a'])).toBe(false)
    expect(shown('A test only', ['test/test_x.py', 'web/src/a.test.ts', 'docs/x.md', '.github/workflows/c.yml'])).toBe(false)
    expect(shown('Nothing at all', [])).toBe(false)
    expect(shown('', ['web/src/x.ts'])).toBe(false)
  })
})

describe('after an update', () => {
  const log: { onTop: OnTop[] } = {
    onTop: [
      { v: '3.2.22', changes: [{ c: 'ccccccc', s: 'Three' }, { c: 'aaaaaaa', s: 'One' }], trail: ['ccccccc', 'bbbbbbb', 'aaaaaaa', '5555555'] },
      { v: '3.2.21', changes: [{ c: 'ddddddd', s: 'Old' }], trail: ['ddddddd', 'eeeeeee'] },
    ],
  }
  const full = (s: string) => s + '0'.repeat(33)

  test('what came after the old build on the same release: housekeeping between counts nothing', () => {
    expect(since(log, full('bbbbbbb'))).toEqual({ v: '3.2.22', changes: [{ c: 'ccccccc', s: 'Three' }], newest: '3.2.22' })
    expect(since(log, full('5555555'))).toEqual({ v: '3.2.22', changes: [{ c: 'ccccccc', s: 'Three' }, { c: 'aaaaaaa', s: 'One' }], newest: '3.2.22' })
    expect(since(log, full('ccccccc'))).toEqual({ v: '3.2.22', changes: [] })
  })

  test('from an older release: everything since, and the release it sat on', () => {
    expect(since(log, full('eeeeeee'))).toEqual({ v: '3.2.21', changes: [{ c: 'ccccccc', s: 'Three' }, { c: 'aaaaaaa', s: 'One' }, { c: 'ddddddd', s: 'Old' }], newest: '3.2.22' })
    // nothing on top of the new release yet: the newest change is the older release's, so the toast opens there
    const older = { onTop: [{ v: '3.2.22', changes: [], trail: ['fffffff', '1111111'] }, log.onTop[1]!] }
    expect(since(older, full('eeeeeee'))).toEqual({ v: '3.2.21', changes: [{ c: 'ddddddd', s: 'Old' }], newest: '3.2.21' })
  })

  test('a build not on this branch, or no commit: unknown', () => {
    expect(since(log, full('9999999'))).toBeNull()
    expect(since(log, '')).toBeNull()
    expect(since({ onTop: [] }, full('aaaaaaa'))).toBeNull()
  })
})
