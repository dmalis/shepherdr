// Draft check (fork dmalis/shepherdr#149): a draft is never lost. Opens the built demo in a headless Chrome and, with
// real reloads:
//   whole     a draft with words, an @ pick, a folded paste, a reply and a file comes back whole and sends the same
//   midway    a file still going up when the page reloads goes up again from its kept bytes and is sent
//   lost      a file whose kept bytes are gone is named in the box after the reload, and not sent
//   full      with the browser's storage full, Send leaves the stored draft until the send is delivered: a reload
//             before that brings the words back
// Each case prints PASS or FAIL with what it saw; the exit code is the number of failures. `--demo <checkout>` runs
// another build's demo (a before-check), `--shots <dir>` keeps a screenshot of each reloaded box.
//
//   bun run build && bun web/demo/draft-check.ts [--demo <checkout>] [--shots <dir>] [--phone] [--dark]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { mkdirSync } from 'node:fs'
import { chromium, type Page, type Route } from 'playwright-core'
import { chrome } from './tap-check.ts'

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : '')
const demo = arg('--demo')
const shots = arg('--shots')
const phone = process.argv.includes('--phone')
const dark = process.argv.includes('--dark')
if (shots) mkdirSync(shots, { recursive: true })

async function startDemo() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  const serve = demo ? `${demo}/web/demo/serve.ts` : new URL('./serve.ts', import.meta.url).pathname
  const server = Bun.spawn(['bun', serve, String(port)], { stdout: 'ignore', stderr: 'inherit' })
  const url = `http://127.0.0.1:${port}/`
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return { server, url } } catch { /* still starting */ }
    await Bun.sleep(100)
  }
  server.kill()
  throw new Error('The built demo did not start')
}

const SHOP = 'p:mac-mini:shop'
const PASTE = Array.from({ length: 40 }, (_, i) => `2026-11-28 09:${String(i).padStart(2, '0')} checkout: payment page timed out`).join('\n')
/** the demo's own fictional checkout screenshot */
const PIC = await Bun.file(new URL('./shots/checkout.jpg', import.meta.url)).bytes()

const { server, url } = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
let failed = 0
const say = (name: string, ok: boolean, saw: unknown) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(saw)}`)
}

/** a fresh browser (empty storage), the shop's chat open, and every send the page asks the demo for */
async function open() {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' } : { viewport: { width: 1280, height: 800 }, colorScheme: dark ? 'dark' : 'light' })
  const page = await ctx.newPage()
  const sends: { text: string; attachments: string[]; reply?: string }[] = []
  page.on('request', (r) => {
    if (!r.url().endsWith('/api/action') || r.method() !== 'POST') return
    try {
      const a = JSON.parse(r.postData() ?? '{}')
      if (a.type === 'send') sends.push({ text: a.text, attachments: a.attachments, reply: a.reply })
    } catch { /* not ours */ }
  })
  await page.goto(`${url}?place=${encodeURIComponent(SHOP)}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cbox textarea')
  return { ctx, page, sends }
}
const box = (p: Page) => p.locator('.cbox textarea').first()
/** what the box shows after a reload */
const shown = (p: Page) =>
  p.evaluate(() => {
    const b = document.querySelector('.cbox')!
    return {
      text: (b.querySelector('textarea') as HTMLTextAreaElement).value,
      pastes: b.querySelectorAll('.fchip.paste').length,
      reply: !!b.querySelector('button[aria-label="Don\'t reply to it"]'),
      files: [...b.querySelectorAll('.ath .atb')].map((e) => e.getAttribute('aria-label')),
      lost: b.querySelector('.alost')?.textContent ?? null,
    }
  })
async function reload(p: Page) {
  // the page hides first, as it does when a phone drops it or the person reloads
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForSelector('.cbox textarea')
  await p.waitForTimeout(600)
}
async function attach(p: Page) {
  await p.locator('.cbox input[type="file"]:not([data-pick])').first().setInputFiles({ name: 'checkout.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(PIC) })
}
async function paste(p: Page) {
  await box(p).focus()
  await p.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('.cbox textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PASTE)
}
async function replyToLast(p: Page) {
  const msg = p.locator('.msgs [data-msg]').last()
  await msg.scrollIntoViewIfNeeded()
  await msg.hover()
  const q = p.locator('button.qbtn[aria-label="Reply"]').first()
  if (await q.count()) await q.click()
  else {
    await msg.click({ button: 'right' })
    await p.getByRole('menuitem', { name: 'Reply' }).click()
  }
}
const shot = async (p: Page, name: string) => {
  if (!shots) return
  await p.locator('.cbox').first().screenshot({ path: `${shots}/${name}.png` })
}

// whole: words with an @ pick, a folded paste, a reply and an uploaded file, back after a reload, sent the same
{
  const { ctx, page, sends } = await open()
  await replyToLast(page)
  await box(page).click()
  await page.keyboard.type('Check this with @fix', { delay: 20 })
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  await page.keyboard.type('please', { delay: 20 })
  await paste(page)
  await attach(page)
  await page.waitForFunction(() => !document.querySelector('.cbox .ast'), null, { timeout: 5000 }).catch(() => undefined)
  const before = await shown(page)
  await reload(page)
  const after = await shown(page)
  await shot(page, `whole${phone ? '-phone' : ''}${dark ? '-dark' : ''}`)
  say('whole: the box comes back as it was', JSON.stringify(after) === JSON.stringify(before) && !!after.files.length && after.reply && after.pastes === 1, { before, after })
  await page.locator('.cbox button.send[aria-label="Send"]').click()
  await page.waitForTimeout(800)
  const s = sends.at(-1)
  say('whole: it sends the pick as its link, the paste, the file and the reply', !!s && /\[@[^\]]+\]\(task:/.test(s.text) && s.text.includes(PASTE.split('\n')[0]) && s.attachments.length === 1 && !!s.reply, s && { text: s.text.slice(0, 120), attachments: s.attachments, reply: s.reply })
  await ctx.close()
}

// midway: a file still going up when the page reloads
{
  const { ctx, page, sends } = await open()
  let hold = true
  const held: Route[] = []
  await page.route('**/api/upload', (r) => (hold ? void held.push(r) : r.continue()))
  await box(page).click()
  await page.keyboard.type('the screenshot', { delay: 10 })
  await attach(page)
  await page.waitForTimeout(500)
  hold = false
  await reload(page)
  await page.waitForFunction(() => document.querySelector('.cbox .ath') && !document.querySelector('.cbox .ast'), null, { timeout: 8000 }).catch(() => undefined)
  const after = await shown(page)
  say('midway: the file comes back and goes up', after.files.length === 1 && !/Adding|Not kept/.test(after.files[0] ?? ''), after)
  await page.locator('.cbox button.send[aria-label="Send"]').click()
  await page.waitForTimeout(800)
  say('midway: it is sent with the message', sends.at(-1)?.attachments.length === 1, sends.at(-1))
  await ctx.close()
}

// lost: the file's kept bytes are gone (a browser that let them go): named in the box, not sent
{
  const { ctx, page, sends } = await open()
  // its upload never ends, on this page or the next
  await page.route('**/api/upload', () => undefined)
  await box(page).click()
  await page.keyboard.type('see the file', { delay: 10 })
  await attach(page)
  await page.waitForTimeout(500)
  await page.evaluate(() => new Promise<void>((ok) => {
    const r = indexedDB.open('shepherdr-drafts')
    r.onsuccess = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('files')) return ok()
      const t = d.transaction('files', 'readwrite')
      t.objectStore('files').clear()
      t.oncomplete = () => ok()
    }
    r.onerror = () => ok()
  }))
  await reload(page)
  const after = await shown(page)
  await shot(page, `lost${phone ? '-phone' : ''}${dark ? '-dark' : ''}`)
  say('lost: the box names the file it could not bring back', after.text === 'see the file' && !!after.lost?.includes('checkout.jpg') && /Not kept/.test(after.files[0] ?? ''), after)
  await page.locator('.cbox button.send[aria-label="Send"]').click()
  await page.waitForTimeout(800)
  say('lost: the words go without it', sends.at(-1)?.text === 'see the file' && sends.at(-1)?.attachments.length === 0, sends.at(-1))
  await ctx.close()
}

// full: storage is full when Send is pressed, and the send never arrives
{
  const { ctx, page } = await open()
  await box(page).click()
  await page.keyboard.type('do not lose me', { delay: 10 })
  await page.waitForTimeout(800)
  await page.route('**/api/action', async (r) => (JSON.parse(r.request().postData() ?? '{}').type === 'send' ? r.abort() : r.continue()))
  await page.evaluate(() => {
    const big = 'x'.repeat(256 * 1024)
    for (let i = 0; i < 400; i++) {
      try { localStorage.setItem(`fill:${i}`, big) } catch { break }
    }
    // then smaller and smaller, until not one more character fits
    let i = 0
    for (let n = 128 * 1024; n >= 1; n = Math.floor(n / 2)) {
      for (;;) {
        try { localStorage.setItem(`fill:s${i++}`, 'x'.repeat(n)) } catch { break }
      }
    }
  })
  await page.locator('.cbox button.send[aria-label="Send"]').click()
  await page.waitForTimeout(1500)
  const cleared = await shown(page)
  await reload(page)
  const after = await shown(page)
  say('full: the box clears on Send, and a reload before delivery brings the words back', cleared.text === '' && after.text === 'do not lose me', { onSend: cleared.text, afterReload: after.text })
  await ctx.close()
}

await browser.close()
server.kill()
process.exit(failed)
