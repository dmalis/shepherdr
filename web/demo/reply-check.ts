// Reply check (fork #164): an agent's reply reads well, in a real browser on the built demo, at a phone's width with a
// finger and on a desktop, at each Chat text size:
//   - its code is the chat's code size (14 px on touch, 13 with a mouse, at Default) and every code block has a Copy;
//   - its headings step down: h1 over h2 over h3 over h4;
//   - a table wider than its message scrolls in a box named for screen readers that Tab reaches, faded at the edge
//     where it is cut (the fade moves as it scrolls), with Open table under it, which shows it whole in a sheet on a
//     phone and a dialog on a desktop, and Esc closes;
//   - a table that fits is just a table: no name, no Tab stop, no Open table.
//
//   bun run build && bun web/demo/reply-check.ts
import { chromium, type Browser, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

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

/** the demo's two replies in the Everything chat (web/demo/data.ts) */
const REPORT = 'Archive links fixed', WIDE = 'The broken links I found'
/** the chat's code size at each Chat text size (web/src/size.css), with a mouse and on touch */
const CODE: Record<string, [number, number]> = { Small: [12, 13], Default: [13, 14], Large: [14, 15], Larger: [15, 16] }

type Scene = { name: string; phone: boolean; text: string }
const SCENES: Scene[] = []
for (const phone of [true, false]) for (const text of Object.keys(CODE)) SCENES.push({ name: `${phone ? 'phone 390' : 'desktop 1280'}, ${text}`, phone, text })

const reply = (p: Page, words: string) => p.locator('.md', { hasText: words }).first()

async function check(browser: Browser, url: string, s: Scene): Promise<string[]> {
  const ctx = await browser.newContext(s.phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 800 } })
  await ctx.addInitScript((p) => localStorage.setItem('shepherdr.prefs', p), JSON.stringify({ text: s.text }))
  const page = await ctx.newPage()
  const fails: string[] = []
  const want = (ok: boolean, what: string) => void (ok || fails.push(what))
  try {
    await page.goto(url)
    const report = reply(page, REPORT)
    await report.waitFor()
    await report.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    // a frame for the watcher to measure the boxes
    await page.waitForTimeout(150)
    const r = await report.evaluate((md) => ({
      code: [...md.querySelectorAll('code')].map((c) => parseFloat(getComputedStyle(c).fontSize)),
      blocks: md.querySelectorAll('.code.block').length,
      copies: md.querySelectorAll('.code.block > button[aria-label="Copy"]').length,
      heads: ['h1', 'h2', 'h3', 'h4'].map((h) => parseFloat(getComputedStyle(md.querySelector(h)!).fontSize)),
      fits: (() => {
        const s = md.querySelector<HTMLElement>('.tbls'), open = md.querySelector<HTMLElement>('.tblx')
        if (!s || !open) return { role: 'no box', tab: null, open: 'none' }
        return { role: s.getAttribute('role'), tab: s.getAttribute('tabindex'), open: getComputedStyle(open).display }
      })(),
    }))
    const size = CODE[s.text][s.phone ? 1 : 0]
    want(r.code.length >= 2 && r.code.every((x) => x === size), `code at ${size}px, got ${r.code.join(', ')}`)
    want(r.blocks > 0 && r.copies === r.blocks, `a Copy on each of ${r.blocks} code blocks, got ${r.copies}`)
    want(r.heads.every((x, i) => i === 0 || x < r.heads[i - 1]), `h1 to h4 step down, got ${r.heads.join(', ')}`)
    want(!r.fits.role && !r.fits.tab && r.fits.open === 'none', `a table that fits is just a table, got ${JSON.stringify(r.fits)}`)

    const wide = reply(page, WIDE)
    await wide.evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(150)
    const box = wide.locator('.tbls')
    if (!(await box.count())) {
      fails.push('the wide table has no box of its own')
      return fails
    }
    const named = await box.evaluate((s) => ({ role: s.getAttribute('role'), name: s.getAttribute('aria-label'), cut: s.getAttribute('data-cut'), mask: getComputedStyle(s).maskImage }))
    want(named.role === 'region' && named.name === WIDE, `the wide table's box is a region named "${WIDE}", got ${named.role} "${named.name}"`)
    want(named.cut === 'end' && named.mask.includes('gradient'), `the wide table fades at its end, got ${named.cut} ${named.mask}`)
    // Tab from whatever the keyboard reaches just before the box lands on it
    const landed = await box.evaluate((s) => {
      const all = [...document.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select, [tabindex]')].filter((e) => e.tabIndex >= 0 && !e.closest('[inert], [hidden]') && e.getClientRects().length)
      const before = all.filter((e) => e.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).pop()
      before?.focus()
      return !!before
    })
    await page.keyboard.press('Tab')
    const focused = await box.evaluate((s) => document.activeElement === s && s.matches(':focus-visible') && getComputedStyle(s.parentElement!).outlineStyle === 'solid')
    want(landed && focused, 'Tab reaches the wide table\'s box, with a ring round it')
    // scrolled to its end, the fade moves to the start
    await box.evaluate((s) => s.scrollTo({ left: s.scrollWidth }))
    await page.waitForTimeout(150)
    const after = await box.getAttribute('data-cut')
    want(after === 'start', `scrolled to its end, the fade is at its start, got ${after}`)
    const open = wide.locator('.tblx')
    want(await open.isVisible(), 'Open table shows under the wide table')
    await open.click()
    const sheet = page.locator('[data-panel]:has(.tblsheet)')
    await sheet.waitFor({ timeout: 3000 }).catch(() => undefined)
    const shown = await sheet.evaluate((p) => ({ cls: p.className, title: p.querySelector('h2')?.textContent, rows: p.querySelectorAll('tbody tr').length, w: p.getBoundingClientRect().width, clear: p.querySelector('.hd')!.getBoundingClientRect().bottom <= p.querySelector('table')!.getBoundingClientRect().top })).catch(() => null)
    want(!!shown?.clear, 'the sheet\'s title sits above its table')
    want(!!shown && shown.title === WIDE && shown.rows === 2, `Open table shows the table whole, titled, got ${JSON.stringify(shown)}`)
    if (shown) want(s.phone ? shown.cls.includes('sheet') : shown.cls.includes('dlg') && shown.w > 900, `on a ${s.phone ? 'phone, a sheet' : 'desktop, a wide dialog'}, got ${shown.cls} ${Math.round(shown.w)}px`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    want((await sheet.count()) === 0, 'Esc closes it')
  } catch (e) {
    fails.push(String(e))
  } finally {
    await ctx.close()
  }
  return fails
}

const demo = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
let failed = 0
try {
  for (const s of SCENES) {
    const fails = await check(browser, demo.url, s)
    if (!fails.length) console.log(`ok    ${s.name}`)
    else {
      failed++
      console.log(`FAIL  ${s.name}`)
      for (const f of fails) console.log(`        ${f}`)
    }
  }
  if (failed) {
    console.log(`reply check: ${failed} of ${SCENES.length} scenes broken`)
    process.exitCode = 1
  } else console.log(`reply check: ${SCENES.length} scenes; code sized, a Copy on each block, headings step down, a wide table named, reached, faded and opened whole`)
} finally {
  await browser.close()
  demo.server.kill()
}
