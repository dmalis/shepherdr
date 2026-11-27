// What changed in each version, for Settings › About's "What's new" (fork patch #70). Read at build time
// (web/changelog.ts), never fetched: the releases from CHANGELOG.md, and the changes merged on top of each release on
// the build's own branch. Short lines: a release's bullet is its first sentence, its full text on a tap; a change on top
// is its pull request's title without "(#n)". This file is the parsing and the words; the page draws them
// (web/src/whats-new.tsx).

/** one line of a release: its first sentence, and the rest of its text when it says more (on a tap) */
export type Item = { line: string; rest?: string }
export type Group = { title: string; items: Item[] }
export type Release = { v: string; date?: string; groups: Group[] }
/** a change merged on top of a release: its short commit and its title */
export type Change = { c: string; s: string }
/**
 * What sat on top of one release on the build's branch, newest first: the changes people see, and every commit's
 * short id (the housekeeping left out too), so an update can count what came after the build it replaced.
 */
export type OnTop = { v: string; changes: Change[]; trail: string[] }
export type Changelog = {
  /** newest first, as CHANGELOG.md has them */
  releases: Release[]
  /** newest first; the build's own release first when it has changes on top */
  onTop: OnTop[]
  /** https://github.com/<owner>/<repo> of the checkout's origin, or '' */
  repo: string
}

/** the build's changelog, as the web app imports it (web/vite.config.ts makes it; its own chunk) */
export const CHANGELOG_ID = 'virtual:shepherdr-changelog'

/** how short ids are kept: GitHub's 7 characters */
export const SHORT = 7

/* ---------- CHANGELOG.md ---------- */

/** the words a person reads: a link becomes its text (no link leaves the app), bold its words, spaces one */
export function plain(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

const ABBR = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl|no)\.$/i

/** The first sentence: up to a . ! or ? followed by a space and a new sentence, outside `code`; else all of it. */
export function firstSentence(text: string): string {
  let code = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '`') code = !code
    if (code || (ch !== '.' && ch !== '!' && ch !== '?')) continue
    const rest = text.slice(i + 1)
    // a sentence ends at a space, then what starts one (a capital, a digit, code, a quote or a bracket)
    if (!/^\s+[A-Z0-9`"“'(\[]/.test(rest)) continue
    if (ch === '.' && ABBR.test(text.slice(0, i + 1))) continue
    return text.slice(0, i + 1)
  }
  return text
}

const item = (md: string): Item => {
  const full = plain(md)
  const line = firstSentence(full)
  const rest = full.slice(line.length).trim()
  return rest ? { line, rest } : { line }
}

/**
 * CHANGELOG.md's releases: one `## <version>` each, its `###` groups, and their bullets (a bullet's wrapped lines are
 * one) and paragraphs, each one item. Text before a release's first group is an untitled group of its own.
 */
export function parseChangelog(md: string): Release[] {
  const out: Release[] = []
  let rel: Release | null = null
  let group: Group | null = null
  let para: string[] = []
  const flush = () => {
    if (!rel || !para.length) return (para = [])
    if (!group) rel.groups.push((group = { title: '', items: [] }))
    group.items.push(item(para.join(' ')))
    para = []
  }
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const h2 = /^##\s+v?(\d+\.\d+\.\d+[\w.-]*)\s*$/.exec(line)
    if (h2) {
      flush()
      out.push((rel = { v: h2[1]!, groups: [] }))
      group = null
      continue
    }
    if (/^#\s/.test(line)) continue
    if (!rel) continue
    const h3 = /^###\s+(.+)$/.exec(line)
    if (h3) {
      flush()
      rel.groups.push((group = { title: plain(h3[1]!), items: [] }))
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      para = [bullet[1]!]
    } else para.push(line.trim())
  }
  flush()
  for (const r of out) r.groups = r.groups.filter((g) => g.items.length)
  return out
}

/* ---------- the changes on top ---------- */

/** titles that are the fork's housekeeping, not something the person uses */
const HOUSEKEEPING = /^(?:Fork rule:|Sync:|AGENTS\.md)/i
/** files no install puts anywhere: the fork's own rules and tools, agents' instructions, CI, docs and tests */
const NOTHING = [/^FORK\.md$/, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^README\.md$/, /^fork\//, /^\.agents\//, /^\.claude\//, /^\.github\//, /^docs\//, /^test\//, /\.test\.[cm]?[jt]sx?$/]

/** The change's title as people read it: a merge commit's pull request title (its body's first line), "(#n)" dropped. */
export function title(subject: string, body = '', merge = false): string {
  let s = subject.trim()
  if (merge || /^Merge pull request #\d+ from /.test(s)) {
    if (!/^Merge pull request #\d+ from /.test(s)) return ''
    s = body.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  }
  return s.replace(/\s*\(#\d+\)\s*$/, '').trim()
}

/** Does this change belong in What's new: a title, not housekeeping, and it installs something? */
export function shown(t: string, files: string[]): boolean {
  if (!t || HOUSEKEEPING.test(t)) return false
  return files.some((f) => !NOTHING.some((re) => re.test(f)))
}

/* ---------- after an update ---------- */

export type Since = { v: string; changes: Change[] }

/**
 * What a build has that the one it replaced (by its commit) didn't: the changes on top that came after that commit,
 * and the release it sat on. null when that commit isn't on this build's branch (or no changelog says).
 */
export function since(log: Pick<Changelog, 'onTop'>, commit: string): Since | null {
  if (!/^[0-9a-f]{7,64}$/.test(commit)) return null
  const id = commit.slice(0, SHORT)
  const changes: Change[] = []
  for (const top of log.onTop) {
    const at = top.trail.indexOf(id)
    if (at < 0) {
      changes.push(...top.changes)
      continue
    }
    const newer = new Set(top.trail.slice(0, at))
    changes.push(...top.changes.filter((c) => newer.has(c.c)))
    return { v: top.v, changes }
  }
  return null
}

/** "3 new changes" */
export const changesWords = (n: number) => `${n} new ${n === 1 ? 'change' : 'changes'}`
