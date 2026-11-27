// fork #105: a folder too long for its room gives way in its middle, never from its start: its last part (the folder
// itself, which is what tells spaces apart) stays whole and the parents before it are cut with …, as macOS Finder's
// path bar and VS Code's breadcrumbs do. "~/development/projects/shop" → "~/develo…/shop", never "…ects/shop".

/** a path split for a middle cut: what leads to its last part, and the last part with the slash before it
 *  ("~/dev/shop" → "~/dev" and "/shop"; "/srv" → "" and "/srv"; "~" → "" and "~") */
export function folderParts(path: string): { lead: string; last: string } {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path
  const at = p.lastIndexOf('/')
  if (at < 0 || p === '/') return { lead: '', last: p }
  return { lead: p.slice(0, at), last: p.slice(at) }
}

/** a folder's own name, for where only that fits (a phone's menu row): "~/dev/shop" → "shop", "~" and "/" as they are */
export const folderLast = (path: string) => folderParts(path).last.replace(/^\/(?=.)/, '')

/** a character as wide as two letters: CJK, Hangul, full-width forms, emoji */
const WIDE = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
const cols = (c: string) => (WIDE.test(c) ? 2 : 1)

/** a name wider than `max` columns (a letter one, a CJK character or an emoji two), cut in its middle: its start and its
 *  end kept, … between. A menu row's value doesn't shrink, so this keeps it to about a third of a small phone's sheet
 *  and the row's label always has room. */
export function cutMiddle(s: string, max = 18): string {
  const c = [...s]
  if (c.reduce((n, x) => n + cols(x), 0) <= max) return s
  // the … takes one column; the start gets half the rest, the end what the start left
  const room = max - 1
  let used = 0
  let i = 0
  while (used + cols(c[i]) <= Math.ceil(room / 2)) used += cols(c[i++])
  let j = c.length
  while (j > i && used + cols(c[j - 1]) <= room) used += cols(c[--j])
  const head = c.slice(0, i).join('')
  const tail = c.slice(j).join('')
  return `${head}…${tail}`
}
