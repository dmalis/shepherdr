import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { writeRegistry } from './build-plugins.ts'
import { zoomCss } from './zoom-css.ts'
import { buildStamp } from './build-stamp.ts'
import { STAMP_ID, stampJson } from './shared/build-stamp.ts'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

writeRegistry(at('./'))

// the version this build is, in its index.html: Settings › About says it, "Updated to …" after an update, and the
// service tells pages the version of the web app it serves from the same line (SHEP-337)
const VERSION = (JSON.parse(readFileSync(at('../package.json'), 'utf8')) as { version: string }).version
// and which build of it, beside the version (fork patch #44): none for a build without git
const STAMP = buildStamp(at('../'))

// Relative base: the app works under any path (tailscale serve --set-path /shepherdr).
export default defineConfig({
  root: at('./'),
  base: './',
  plugins: [react(), { name: 'shepherdr-version', transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'shepherdr-version', content: VERSION }, injectTo: 'head' }, ...(STAMP ? [{ tag: 'script', attrs: { type: 'application/json', id: STAMP_ID }, children: stampJson(STAMP), injectTo: 'head' as const }] : [])] }],
  // Zoom (Settings › General): every px of the CSS times --zoom
  css: { postcss: { plugins: [zoomCss()] } },
  resolve: { alias: { '@shared': at('./shared'), '@client': at('./src'), '@plugins': at('./plugins'), '@core': at('../core') } },
  build: { outDir: at('./dist'), emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', allowedHosts: ['.ts.net'], proxy: { '/api': { target: process.env.SHEPHERDR_API_URL || `http://127.0.0.1:${process.env.SHEPHERDR_PORT || 7788}`, ws: true } } },
})
