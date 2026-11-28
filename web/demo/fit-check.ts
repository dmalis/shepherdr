// Fit check (Fix: phone card buttons fit): on a phone, everything in a chat stays inside its column. A review card's
// buttons once reached past the card's border (a task's name on one line sized the card's grid column, and the
// buttons stretched to it) and a done task's row ran off the screen (its name and its words were two flex items that
// couldn't wrap), with every other check green.
//
// Opens the built demo in a headless Chrome whose only pointer is a finger, at 320 and 390 px, at Chat text size
// Default and Larger, in Everything, each demo space's chat and two tasks' threads, and measures as painted:
//   - every row, card and bubble in the chat (.msgs's children) sits inside the chat's column and the screen;
//   - everything inside a card or a news row (a done row, a task's line, a fold), each element and each run of text,
//     sits inside that card or row, on both sides. Only two kinds of clipping box excuse what they cut: a scroller (a
//     code block, a wide table) and a one-line ellipsis (a task's name); anything else cut off counts.
//   - the case that broke is there to measure: #blog's review card and its done row.
// A scene reports every break it finds, not only the first.
//
//   bun run build && bun web/demo/fit-check.ts [--shots <dir>]
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium, type Browser } from 'playwright-core'
import { chrome } from './tap-check.ts'

const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1]! : ''
if (shots) mkdirSync(shots, { recursive: true })

async function startDemo() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const server = Bun.spawn(['bun', `${import.meta.dir}/serve.ts`, String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* still starting */ }
    await Bun.sleep(50)
  }
  server.kill()
  throw new Error('The built demo did not start')
}

/** the demo's chats: Everything, each space's, and two tasks' threads (a review card's own, a long worker's) */
const PLACES = ['place=p:mac-mini:~', 'place=p:mac-mini:blog', 'place=p:mac-mini:shop', 'place=p:mac-mini:notes', 'place=p:vm:garden-app', 'task=BLOG-10', 'task=SHOP-15']
type Scene = { width: number; text: 'Default' | 'Larger' }

/** what reaches past its box in the chat on screen now, in words */
const breaks = () => {
  const out: string[] = []
  const sc = [...document.querySelectorAll<HTMLElement>(':is(.chat, .pane) > .scroll')].find((e) => e.getClientRects().length)
  const msgs = sc?.querySelector<HTMLElement>(':scope > .msgs')
  if (!msgs) return ['no chat on screen']
  const say = (e: Element | Text) => {
    const el = e instanceof Text ? e.parentElement! : e
    const words = (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
    return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${words ? ` "${words}"` : ''}`
  }
  const col = msgs.getBoundingClientRect()
  const right = Math.min(col.right, innerWidth) + 0.5
  const left = Math.max(col.left, 0) - 0.5
  for (const box of msgs.children) {
    const b = box.getBoundingClientRect()
    if (!b.width) continue
    if (b.right > right) out.push(`${say(box)} ends at ${b.right.toFixed(0)}, past the column (${col.right.toFixed(0)}) or the screen (${innerWidth})`)
    if (b.left < left) out.push(`${say(box)} starts at ${b.left.toFixed(0)}, before the column (${col.left.toFixed(0)}) or the screen`)
    if (!box.matches('.card, .donerow, .ref, .fold')) continue
    // inside it: each element and each run of text, unless a scroller or a one-line ellipsis between cuts it on purpose
    const excused = (n: Node) => {
      for (let p = n.parentElement; p && p !== box; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return true
        if (cs.overflowX !== 'visible' && cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap') return true
      }
      return false
    }
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      let r: DOMRect
      if (n instanceof Text) {
        if (!n.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        r = range.getBoundingClientRect()
      } else {
        if (!(n as Element).getClientRects().length) continue
        r = (n as Element).getBoundingClientRect()
      }
      if (!r.width || excused(n)) continue
      if (r.right > b.right + 0.5) out.push(`${say(n as Element | Text)} ends at ${r.right.toFixed(0)}, past its ${say(box).split(' ')[0]} (${b.right.toFixed(0)})`)
      if (r.left < b.left - 0.5) out.push(`${say(n as Element | Text)} starts at ${r.left.toFixed(0)}, before its ${say(box).split(' ')[0]} (${b.left.toFixed(0)})`)
    }
  }
  return out
}

async function check(browser: Browser, base: string, s: Scene) {
  const name = `${s.width}px, Chat text ${s.text}`
  const fails: string[] = []
  const ctx = await browser.newContext({ viewport: { width: s.width, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  try {
    await ctx.addInitScript((text) => localStorage.setItem('shepherdr.prefs', JSON.stringify({ text })), s.text)
    const page = await ctx.newPage()
    page.setDefaultTimeout(8000)
    for (const where of PLACES) {
      await page.goto(`${base}?${where.replace(/=(.*)/, (_, v: string) => `=${encodeURIComponent(v)}`)}`)
      await page.locator(':is(.chat, .pane) > .scroll > .msgs >> visible=true').first().waitFor()
      // its cards' files and checks come in after the first paint (useEvidence): wait for the page to settle
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
      for (const f of await page.evaluate(breaks)) fails.push(`${where}: ${f}`)
      // the case that broke, so a changed demo can't leave nothing to measure
      if (where === 'place=p:mac-mini:blog') {
        const msgs = page.locator('.chat > .scroll > .msgs >> visible=true').first()
        if (!(await msgs.locator(':scope > .card.rvcard', { hasText: 'Fix typo on the About page' }).count())) fails.push(`${where}: no review card for "Fix typo on the About page" to measure`)
        if (!(await msgs.locator(':scope > .donerow', { hasText: 'Check the broken RSS link' }).count())) fails.push(`${where}: no done row for "Check the broken RSS link" to measure`)
      }
      if (shots) await page.screenshot({ path: `${shots}/${`${s.width} ${s.text} ${where}`.replace(/[^\w]+/g, '-')}.png` })
    }
    return { name, fails }
  } finally {
    await ctx.close()
  }
}

const SCENES: Scene[] = [
  { width: 320, text: 'Default' },
  { width: 320, text: 'Larger' },
  { width: 390, text: 'Default' },
  { width: 390, text: 'Larger' },
]

const demo = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
let failed = 0
try {
  for (const { name, fails } of await Promise.all(SCENES.map((scene) => check(browser, demo.url, scene)))) {
    if (!fails.length) console.log(`ok    ${name}`)
    else {
      failed++
      console.log(`FAIL  ${name}`)
      for (const f of fails) console.log(`        ${f}`)
    }
  }
  assert.equal(failed, 0, `fit check: ${failed} of ${SCENES.length} scenes broken`)
  console.log(`fit check: ${SCENES.length} scenes, ${PLACES.length} chats each; every card, row and bubble stays inside the chat's column`)
} finally {
  await browser.close()
  demo.server.kill()
}
