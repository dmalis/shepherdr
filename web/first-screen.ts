// The first screen's script, as the built app sends it (fork #163, docs/design.md Performance: "Script for the first
// screen: 250 kB sent, compressed"): the page's own module script and every chunk it imports before it can run,
// followed through each chunk's static imports, counted as the brotli copy the service sends (service/static.ts).
// What comes later (an `import()`) isn't counted. `bun web/first-screen.ts [dist]` after `bun run build` fails above
// LIMIT, kept under the budget so a breach is seen before it is reached. Brotli is what every browser gets over HTTPS;
// gzip (a browser without it) is shown, not checked.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** docs/design.md's budget, and the check's line under it */
export const BUDGET = 250 * 1024
export const LIMIT = 230 * 1024

export interface Chunk { file: string; raw: number; br: number; gz: number }

/** the scripts a page loads before it can run: its module scripts and preloads, and what they import, in turn */
export function firstScripts(dist: string): string[] {
  const html = readFileSync(join(dist, 'index.html'), 'utf8')
  const start = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"|<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map((m) => clean(m[1] ?? m[2]!))
  const seen = new Set<string>()
  const walk = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    const js = readFileSync(join(dist, file), 'utf8')
    // static imports only (import … from "./x.js", import "./x.js", export … from "./x.js"); import("…") comes later
    for (const m of js.matchAll(/(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g))
      walk(join(file, '..', m[1]!).replace(/^\.\//, ''))
  }
  start.forEach(walk)
  return [...seen]
}

const clean = (src: string) => src.replace(/^\.?\//, '')
const size = (p: string) => (existsSync(p) ? statSync(p).size : 0)

/** each first-screen script's size: as it is, and its brotli and gzip copies (a file too small for one: as it is) */
export function firstScreen(dist: string): { chunks: Chunk[]; raw: number; br: number; gz: number } {
  const chunks = firstScripts(dist).map((file) => {
    const p = join(dist, file)
    const raw = size(p)
    return { file, raw, br: size(p + '.br') || raw, gz: size(p + '.gz') || raw }
  })
  const sum = (k: 'raw' | 'br' | 'gz') => chunks.reduce((s, c) => s + c[k], 0)
  return { chunks, raw: sum('raw'), br: sum('br'), gz: sum('gz') }
}

if (import.meta.main) {
  const dist = process.argv[2] ?? fileURLToPath(new URL('./dist', import.meta.url))
  const r = firstScreen(dist)
  const kB = (n: number) => `${(n / 1024).toFixed(1)} kB`
  for (const c of r.chunks) console.log(`${c.file.padEnd(48)} ${kB(c.raw).padStart(9)}  br ${kB(c.br).padStart(9)}  gzip ${kB(c.gz).padStart(9)}`)
  console.log(`first screen: ${r.chunks.length} scripts, ${kB(r.raw)}, sent as ${kB(r.br)} (brotli), ${kB(r.gz)} (gzip); budget ${kB(BUDGET)}, check ${kB(LIMIT)}`)
  if (r.br > LIMIT) {
    console.error(`the first screen's script is ${kB(r.br)} sent, over ${kB(LIMIT)}: move what it doesn't need into a part that comes later (web/src/later.tsx)`)
    process.exit(1)
  }
}
