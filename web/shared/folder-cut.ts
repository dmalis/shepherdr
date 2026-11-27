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
