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

/** a name of more than `max` characters, cut in its middle: its start and its end kept, … between (a menu row's value,
 *  which doesn't shrink, so its label always has room) */
export function cutMiddle(s: string, max = 20): string {
  const c = [...s]
  if (c.length <= max) return s
  const head = Math.ceil((max - 1) / 2)
  return `${c.slice(0, head).join('')}…${c.slice(c.length - (max - 1 - head)).join('')}`
}
