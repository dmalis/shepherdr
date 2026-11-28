// A reply's HTML, kept by what it was made from (dmalis/shepherdr#190): opening a chat again,
// or a live update that changes nothing a reply links to, shows each reply without parsing its markdown again. The
// key holds everything the HTML depends on: the words after their links were written in, and the kind of each task a
// link names (its mark). The oldest unused one goes first once the cache is full.

export const KEEP = 1500
const kept = new Map<string, string>()

export function made(key: string, make: () => string): string {
  const hit = kept.get(key)
  if (hit !== undefined) {
    // used again: newest
    kept.delete(key)
    kept.set(key, hit)
    return hit
  }
  const html = make()
  kept.set(key, html)
  if (kept.size > KEEP) kept.delete(kept.keys().next().value!)
  return html
}

const decoded = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** a reply's key: its words with their links written in (`source`), whether it is drawn plain, and the kind of each
 *  task a link in it names (`kindOf`, by the task's id) */
export function replyKey(source: string, plain: boolean, kindOf: (task: string) => string): string {
  const kinds = [...source.matchAll(/#task=([^\s)"'<>\]]+)/g)].map((m) => kindOf(decoded(m[1]!))).join()
  return `${plain ? 1 : 0}\n${kinds}\n${source}`
}

/** how many replies are kept (tests) */
export const keptSize = () => kept.size
export const forgetMade = () => kept.clear()
