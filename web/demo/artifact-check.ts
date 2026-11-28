// Artifact check (UI polish slice 19): every demo artifact's words read in every look. In Dark and Night the demo's
// pages once showed light words on a white page: a page that says `color-scheme: light dark` and paints no background
// of its own was drawn on the frame's own white.
//
// Opens the built demo in a headless Chrome, at a phone's width (touch) and a desktop's, in each look the app has
// (the device's light and dark with the theme on System, Dark and Night, and each theme against the device's own), opens every artifact the demo has, and
// measures each line of words in its frame as it is painted: the words' colour over the pixels behind them (read from
// a screenshot with the words hidden), against 4.5:1 (WCAG AA). The page is scrolled to its end, a screen at a time.
//
//   bun run build && bun web/demo/artifact-check.ts [--shots <dir>]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { mkdirSync } from 'node:fs'
import { chromium, type Browser, type Frame, type Page } from 'playwright-core'
import { artifacts } from './data.ts'
import { chrome } from './tap-check.ts'

export const MIN = 4.5

/** the app's looks: its theme setting (Settings › General) and the device's own light or dark */
export const LOOKS = [
  { name: 'light', theme: 'System', device: 'light' },
  { name: 'dark', theme: 'System', device: 'dark' },
  { name: 'Dark', theme: 'Dark', device: 'dark' },
  { name: 'Night', theme: 'Night', device: 'dark' },
  { name: 'Dark on a light device', theme: 'Dark', device: 'light' },
  { name: 'Night on a light device', theme: 'Night', device: 'light' },
  { name: 'Light on a dark device', theme: 'Light', device: 'dark' },
] as const
const WIDTHS = [{ width: 390, height: 844, touch: true }, { width: 1280, height: 800, touch: false }]

const at = process.argv.indexOf('--shots')
const shots = at > 0 ? process.argv[at + 1] : ''
if (shots) mkdirSync(shots, { recursive: true })

async function startDemo() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', new URL('./serve.ts', import.meta.url).pathname, String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* still starting */ }
    await Bun.sleep(50)
  }
  server.kill()
  throw new Error('The built demo did not start')
}

/** WCAG's relative luminance of an sRGB colour, 0 to 255 each */
export const lum = ([r, g, b]: number[]) => {
  const c = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!)
}
export const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }
/** a colour with its alpha painted over an opaque one */
export const over = ([r, g, b, a]: number[], bg: number[]) => [r!, g!, b!].map((v, i) => v * a! + bg[i]! * (1 - a!))

type Line = { text: string; fg: number[]; x: number; y: number; w: number; h: number; top: number }

/** every run of words on screen in the frame now: its colour (rgba) and the box of its first line */
const linesOf = (frame: Frame) => frame.evaluate(() => {
  const out: { text: string; fg: number[]; x: number; y: number; w: number; h: number; top: number }[] = []
  const probe = document.createElement('canvas').getContext('2d')!
  const rgba = (css: string) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1); return Array.from(probe.getImageData(0, 0, 1, 1).data).map((v, i) => (i === 3 ? v / 255 : v)) }
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = (n.textContent ?? '').trim()
    const el = n.parentElement
    if (!text || !el || el.closest('script, style, [aria-hidden="true"]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const range = document.createRange()
    range.selectNodeContents(n)
    const r = Array.from(range.getClientRects()).find((x) => x.width >= 2 && x.height >= 2)
    // a line cut by the frame's edge is measured on the next screen, where it is whole
    if (!r || r.top < 0 || r.bottom > innerHeight || r.right <= 0 || r.left >= innerWidth) continue
    // the colour as painted: the element's own opacity and its parents' fade the words too
    let op = 1
    for (let e: Element | null = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
    const fg = rgba(cs.color)
    out.push({ text: text.slice(0, 40), fg: [fg[0]!, fg[1]!, fg[2]!, fg[3]! * op], x: Math.max(0, r.left), y: r.top, w: Math.min(r.right, innerWidth) - Math.max(0, r.left), h: r.height, top: scrollY })
  }
  return out
})

/** the pixels behind each line, from a picture of the frame with every word hidden: the most common colour in its box */
async function behind(decoder: Page, png: Buffer, boxes: Line[], scale: number) {
  return decoder.evaluate(async ({ src, boxes, scale }) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = new OffscreenCanvas(img.width, img.height)
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0)
    return boxes.map((b) => {
      // inside the picture: a frame taller than the window is pictured only as far as it shows
      const x = Math.min(Math.floor(b.x * scale), img.width - 1), y = Math.min(Math.floor(b.y * scale), img.height - 1)
      const d = g.getImageData(x, y, Math.max(1, Math.min(Math.floor(b.w * scale), img.width - x)), Math.max(1, Math.min(Math.floor(b.h * scale), img.height - y))).data
      const count = new Map<string, number>()
      for (let i = 0; i < d.length; i += 4) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; count.set(k, (count.get(k) ?? 0) + 1) }
      return [...count].sort((p, q) => q[1] - p[1])[0]![0].split(',').map(Number)
    })
  }, { src: `data:image/png;base64,${png.toString('base64')}`, boxes, scale })
}

type Found = { text: string; ratio: number; fg: string; bg: string }

async function check(browser: Browser, base: string, look: (typeof LOOKS)[number], size: (typeof WIDTHS)[number], id: string) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch, deviceScaleFactor: 1, colorScheme: look.device })
  const fails: Found[] = []
  let measured = 0
  try {
    await ctx.addInitScript((theme) => localStorage.setItem('shepherdr.prefs', JSON.stringify({ theme })), look.theme)
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(`${base}?artifact=${encodeURIComponent(id)}`)
    const el = page.locator('iframe.page').first()
    await el.waitFor()
    const handle = (await el.elementHandle())!
    let frame: Frame | null = null
    for (let i = 0; i < 100 && !frame; i++) {
      const f = await handle.contentFrame()
      if (f && f.url().includes(`/api/artifacts/${encodeURIComponent(id)}/page`)) frame = f
      else await page.waitForTimeout(50)
    }
    if (!frame) throw new Error(`${id}: its page never loaded in the frame`)
    await frame.waitForLoadState('load')
    await frame.evaluate(() => document.fonts.ready)
    // pictures in the page: loaded, so they are where they will stay
    await frame.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode().catch(() => {}))))
    const decoder = await ctx.newPage()
    const tall = await frame.evaluate(() => document.documentElement.scrollHeight)
    const view = await frame.evaluate(() => innerHeight)
    // a screen at a time, each overlapping the last by a few lines, each line measured once
    const seen = new Set<string>()
    for (let top = 0, step = 0; ; top += view - 80, step++) {
      await frame.evaluate((y) => scrollTo(0, y), top)
      const lines = await linesOf(frame)
      if (shots && step === 0) await el.screenshot({ path: `${shots}/${id}--${size.width}--${look.name.replaceAll(' ', '-')}.png` })
      // the words hidden (not removed: nothing moves), and the frame pictured as it is painted
      await frame.evaluate(() => { const s = document.createElement('style'); s.id = 'artifact-check-hide'; s.textContent = '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}*::placeholder{color:transparent!important}'; document.head.append(s) })
      const png = await el.screenshot({ animations: 'disabled' })
      await frame.evaluate(() => document.getElementById('artifact-check-hide')?.remove())
      const bgs = await behind(decoder, png, lines, 1)
      lines.forEach((l, i) => {
        const key = `${l.text}@${Math.round(l.top + l.y)}`
        if (seen.has(key)) return
        seen.add(key)
        const bg = bgs[i]!
        const fg = over(l.fg, bg)
        const ratio = contrast(fg, bg)
        measured++
        if (ratio < MIN) fails.push({ text: l.text, ratio, fg: fg.map(Math.round).join(','), bg: bg.join(',') })
      })
      if (top + view >= tall) break
    }
  } finally {
    await ctx.close()
  }
  return { fails, measured }
}

/** every artifact, at each width, in each look: a line for each scene, and what fell under MIN */
async function main() {
  const demo = await startDemo()
  const browser = await chromium.launch({ executablePath: chrome() })
  const started = performance.now()
  let failed = 0, scenes = 0, lines = 0
  try {
    for (const size of WIDTHS)
      for (const look of LOOKS)
        for (const a of artifacts) {
          scenes++
          const name = `${a.id} ${size.width}px ${look.name}`
          const { fails, measured } = await check(browser, demo.url, look, size, a.id)
          lines += measured
          if (!measured) { failed++; console.log(`FAIL  ${name}: no words found in its frame`); continue }
          if (!fails.length) { console.log(`ok    ${name} (${measured} lines)`); continue }
          failed++
          console.log(`FAIL  ${name}`)
          for (const f of fails) console.log(`        ${f.ratio.toFixed(2)}:1  “${f.text}”  words ${f.fg} on ${f.bg}`)
        }
    const took = ((performance.now() - started) / 1000).toFixed(1)
    if (failed) {
      console.log(`artifact check: ${failed} of ${scenes} scenes have words under ${MIN}:1 (${took}s)`)
      process.exitCode = 1
    } else console.log(`artifact check: ${scenes} scenes, ${lines} lines, every one at ${MIN}:1 or more (${took}s)`)
  } finally {
    await browser.close()
    demo.server.kill()
  }
}

// run as a script; imported (its test), only its measures
if (import.meta.main) await main()
