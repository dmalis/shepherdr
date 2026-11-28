// A brotli and a gzip copy beside each hashed file the build writes in assets/ (fork patch #148): the service sends
// one of them to a browser that takes it (service/static.ts), so a phone's first load downloads a third of the bytes.
// Made once here, at the strongest settings, rather than per request. A file that would barely shrink (a picture, a
// font, a tiny chunk) gets no copy and is sent as it is.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants, gzip } from 'node:zlib'
import type { Plugin } from 'vite'

const br = promisify(brotliCompress), gz = promisify(gzip)
// the kinds that compress; pictures, fonts and media already are
const TEXT = /\.(js|mjs|css|html|svg|json|txt|xml|wasm|map)$/
// under this, or saving under a tenth, a copy isn't worth a second file
const MIN = 1024, GAIN = 0.9

export async function compressDir(dir: string): Promise<string[]> {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const wrote: string[] = []
  await Promise.all(names.filter((n) => TEXT.test(n)).map(async (n) => {
    const p = join(dir, n)
    if (!statSync(p).isFile()) return
    const raw = readFileSync(p)
    if (raw.length < MIN) return
    const [b, g] = await Promise.all([
      br(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }),
      gz(raw, { level: 9 }),
    ])
    if (b.length < raw.length * GAIN) { writeFileSync(p + '.br', b); wrote.push(n + '.br') }
    if (g.length < raw.length * GAIN) { writeFileSync(p + '.gz', g); wrote.push(n + '.gz') }
  }))
  return wrote.sort()
}

export function compressAssets(): Plugin {
  let out = ''
  return {
    name: 'shepherdr-compress',
    apply: 'build',
    configResolved: (c) => { out = join(c.build.outDir, c.build.assetsDir) },
    writeBundle: async () => { await compressDir(out) },
  }
}
