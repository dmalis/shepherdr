// New space's folder list (3.1's dropdown, back in 3.2): what it shows for what the Folder field holds, as a shell
// completes a path. Empty: the machine's recent folders, then what's in its home. A word: those whose name matches it.
// A path: the folder up to its last / (one way up first), its subfolders whose name matches the word after it. The
// words and path rules are core/newspace.js's, the same as the window's New space.
import * as NS from '@core/newspace.js'

/** what /api/newspace says about a machine: its home and its recent folders (whole paths, newest first) */
export interface Info {
  home: string
  recent: string[]
}

/** what /api/folders says about one folder: its subfolders (path from home as ~), whether it is there */
export interface Listing {
  exists: boolean
  entries: { name: string; path: string; repo: boolean }[]
}

/** a folder the list asked for: listed, still on its way, or not (its error in plain words) */
export type Asked = Listing | 'loading' | { error: string }

/** one row: picked, the field becomes `text` (a folder ends in /, so the list goes into it) */
export interface FRow {
  kind: 'up' | 'recent' | 'folder'
  text: string
  label: string
  sub?: string
  repo?: boolean
}

/** the list: its groups (a quiet name over each, none for the plain one) and a quiet line under them */
export interface Shown {
  groups: { label?: string; rows: FRow[] }[]
  note: string | null
}

const isPath = (t: string) => /^[~/]/.test(t)

/** the folder the list needs listed for the field's text: home for an empty field or a word, else the folder the
 *  typed path is inside ("~" alone is home itself) */
export function wanted(text: string, home: string): string {
  const t = text.trim()
  if (t === '~') return home
  return (isPath(t) && NS.typedDir(t, home)?.dir) || home
}

const folderRow = (path: string, home: string, kind: FRow['kind'], repo?: boolean): FRow => ({
  kind,
  text: NS.asDir(NS.untilde(path, home), home),
  label: NS.base(NS.untilde(path, home), home),
  ...(kind === 'recent' ? { sub: NS.tilde(NS.untilde(path, home), home) } : {}),
  ...(repo ? { repo } : {}),
})

/** the rows for the field's text, from the machine's info and the wanted folder's listing (undefined: not asked yet) */
export function shown(text: string, info: Info, asked: Asked | undefined): Shown {
  const { home } = info
  const t = text.trim()
  const listing = asked && asked !== 'loading' && !('error' in asked) ? asked : null
  const wait = !asked || asked === 'loading'
  const fail = asked && asked !== 'loading' && 'error' in asked ? asked.error : null
  // a word (or nothing): recent folders and home's own, by name
  if (!isPath(t)) {
    const recent = NS.matching(info.recent.filter((p) => !NS.scratch(p)), t).map((p) => folderRow(p, home, 'recent'))
    const seen = new Set(recent.map((r) => r.text))
    const inHome = listing ? NS.matching(listing.entries.map((e) => e.path), t).map((p) => folderRow(p, home, 'folder', listing.entries.find((e) => e.path === p)?.repo)).filter((r) => !seen.has(r.text)) : []
    const groups = [...(recent.length ? [{ label: 'Recent', rows: recent }] : []), ...(inHome.length ? [{ label: 'In ~', rows: inHome }] : [])]
    // home couldn't be listed: said under the recent folders too, never a list that looks whole
    const note = fail ?? (groups.length ? (wait && !listing ? NS.WORDS.loading : null) : wait ? NS.WORDS.loading : t ? NS.WORDS.noMatch : NS.WORDS.empty)
    return { groups, note }
  }
  const dir = wanted(t, home)
  const word = t === '~' ? '' : NS.typedDir(t, home)?.word ?? ''
  const up: FRow[] = dir === '/' ? [] : [{ kind: 'up', text: NS.asDir(NS.parent(dir), home), label: '..', sub: NS.tilde(NS.parent(dir), home) }]
  const rows = listing ? NS.matching(listing.entries.map((e) => e.path), word).map((p) => folderRow(p, home, 'folder', listing.entries.find((e) => e.path === p)?.repo)) : []
  // a folder that isn't there yet (typed whole, or a word nothing starts with) is made by Create
  const note = fail ? fail : wait ? NS.WORDS.loading : !listing!.exists || (!rows.length && word) ? NS.WORDS.missing : rows.length ? null : NS.WORDS.empty
  return { groups: [{ rows: [...up, ...rows] }], note }
}

/** the next row a key moves to: -1 is none (the field itself), down from the last goes back to the first */
export function step(at: number, n: number, down: boolean): number {
  if (!n) return -1
  if (down) return at + 1 >= n ? 0 : at + 1
  return at <= 0 ? n - 1 : at - 1
}

/** what a key in the field does: open the list, move in it, pick a row, create (Enter on no row, or the list shut),
 *  or nothing (the key goes on as usual). Escape isn't here: the dialog's stack gives it to the list first. */
export type KeyDo = { do: 'open' } | { do: 'move'; at: number } | { do: 'pick'; row: FRow } | { do: 'create' } | { do: 'none' }

export function onKey(key: string, s: { open: boolean; at: number; rows: FRow[]; value: string; shift?: boolean }): KeyDo {
  if (key === 'ArrowDown' || key === 'ArrowUp') return s.open ? { do: 'move', at: step(s.at, s.rows.length, key === 'ArrowDown') } : { do: 'open' }
  if (key === 'Enter') return s.open && s.rows[s.at] ? { do: 'pick', row: s.rows[s.at]! } : { do: 'create' }
  if (key === 'Tab' && !s.shift && s.open) {
    // as a shell: the word typed completes to the row moved to, else to the first folder it matches
    const t = s.value.trim()
    const word = isPath(t) ? t.slice(t.lastIndexOf('/') + 1) : t
    const r = s.rows[s.at] ?? (word ? s.rows.find((x) => x.kind !== 'up') : undefined)
    if (r && r.text !== s.value) return { do: 'pick', row: r }
  }
  return { do: 'none' }
}
