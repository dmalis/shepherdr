// Edit check (fork dmalis/shepherdr#186): edits keep what you wrote. Opens the built demo in a headless Chrome, in the
// docs chat (its last reply has suggested replies and a "Replying to" line), and:
//   hold      words in the box, the caret in their middle: a held suggestion goes in at the caret, the words kept, and
//             is sent as a reply to the message it answers
//   keys      a suggestion opens to edit from the keyboard (Shift+Enter on its bubble)
//   ask       the box replies to another message: holding a suggestion asks before changing that
//   paste     a long paste in the middle of the words, then typing before and after it: it is sent in the middle
//   together  on a phone with the keyboard up, typing hides "Replying to" with the suggestions
//   drop      a file dragged over the page: the box shows where to drop it, and takes the drop
// Each case prints PASS or FAIL with what it saw; the exit code is the number of failures. `--demo <checkout>` runs
// another build's demo (a before-check), `--shots <dir>` keeps a screenshot of each case, `--dark` in dark.
//
//   bun run build && bun web/demo/edit-check.ts [--demo <checkout>] [--shots <dir>] [--dark]
//
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : '')
const demo = arg('--demo')
const shots = arg('--shots')
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

const DOCS = 'p:mac-mini:docs'
const PASTE = Array.from({ length: 40 }, (_, i) => `2026-11-28 09:${String(i).padStart(2, '0')} docs: broken link in faq.md line ${i + 3}`).join('\n')
const TALL = 844
const KEYBOARD = 336

const { server, url } = await startDemo()
const browser = await chromium.launch({ executablePath: chrome() })
let failed = 0
const say = (name: string, ok: boolean, saw: unknown) => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(saw)}`)
}

/** a fresh browser (empty storage), the docs chat open, and every send the page asks the demo for */
async function open(phone = false) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: TALL }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' } : { viewport: { width: 1280, height: 800 }, colorScheme: dark ? 'dark' : 'light' })
  const page = await ctx.newPage()
  const sends: { text: string; reply?: string }[] = []
  page.on('request', (r) => {
    if (!r.url().endsWith('/api/action') || r.method() !== 'POST') return
    try {
      const a = JSON.parse(r.postData() ?? '{}')
      if (a.type === 'send') sends.push({ text: a.text, reply: a.reply?.id ?? a.reply })
    } catch { /* not ours */ }
  })
  await page.goto(`${url}?place=${encodeURIComponent(DOCS)}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cbox textarea')
  await page.waitForSelector('.sugs .sug')
  return { ctx, page, sends }
}
const box = (p: Page) => p.locator('.cbox textarea').first()
const value = (p: Page) => box(p).inputValue()
/** the caret put in the box at `at`, as a click there does */
async function caret(p: Page, at: number) {
  await box(p).focus()
  await box(p).evaluate((b: HTMLTextAreaElement, at) => b.setSelectionRange(at, at), at)
}
/** a suggestion held to edit, as a right-click (a desktop's hold) does */
const hold = (p: Page, n = 0) => p.locator('.sugs .sug').nth(n).click({ button: 'right' })
async function send(p: Page) {
  await p.locator('.cbox button.send[aria-label="Send"]').click()
  await p.waitForTimeout(800)
}
const FOOT = '.foot:has(.cbox)'
const shot = async (p: Page, name: string, what = FOOT) => {
  if (!shots) return
  await p.locator(what).first().screenshot({ path: `${shots}/${name}${dark ? '-dark' : ''}.png` })
  // and the whole screen, to see it in its place
  await p.screenshot({ path: `${shots}/${name}${dark ? '-dark' : ''}-screen.png` })
}
const WORDS = 'Thanks for the list. Also fix the FAQ links.'
const AT = 'Thanks for the list.'.length

// hold: a held suggestion goes in at the caret, the words kept, and is sent as a reply to its message
{
  const { ctx, page, sends } = await open()
  const sug = (await page.locator('.sugs .sug').first().textContent()) ?? ''
  await box(page).fill(WORDS)
  await caret(page, AT)
  await hold(page)
  await page.waitForTimeout(200)
  const v = await value(page)
  const pos = await box(page).evaluate((b: HTMLTextAreaElement) => b.selectionStart)
  await shot(page, 'hold')
  say('hold: the words stay and the suggestion goes in at the caret', v === `Thanks for the list. ${sug} Also fix the FAQ links.`, { value: v })
  say('hold: the caret is after it', pos === `Thanks for the list. ${sug}`.length, { caret: pos })
  await send(page)
  const s = sends.at(-1)
  say('hold: it is sent as a reply to the message it answers', !!s && s.text === v && !!s.reply, s)
  await ctx.close()
}

// keys: Shift+Enter on a focused bubble puts it in the box
{
  const { ctx, page } = await open()
  const sug = (await page.locator('.sugs .sug').first().textContent()) ?? ''
  await page.locator('.sugs .sug').first().focus()
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(200)
  const v = await value(page)
  const focused = await page.evaluate(() => document.activeElement?.tagName)
  say('keys: Shift+Enter on a suggestion puts it in the box to edit, and the box takes the keyboard', v === sug && focused === 'TEXTAREA', { value: v, focused })
  await ctx.close()
}

// ask: the box replies to another message: holding a suggestion asks first
{
  const { ctx, page } = await open()
  // reply to the first message in the chat, then hold a suggestion for the last one
  const first = page.locator('.msgs [data-msg]').first()
  await first.scrollIntoViewIfNeeded()
  await first.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Reply' }).click()
  await box(page).fill('Hm.')
  await hold(page)
  await page.waitForTimeout(300)
  const dialog = page.getByRole('dialog')
  const asked = await dialog.count()
  const before = await value(page)
  await shot(page, 'ask', asked ? '[role="dialog"]' : FOOT)
  say('ask: holding a suggestion for another message asks before changing the reply, the words untouched', asked === 1 && before === 'Hm.', { asked, value: before })
  if (asked) {
    await dialog.getByRole('button', { name: 'Keep my reply' }).click()
    await page.waitForTimeout(200)
    const after = await value(page)
    const quote = await page.locator('.cbox .fchip').first().textContent()
    say('ask: Keep my reply puts the suggestion in and keeps the reply', after.startsWith('Hm. ') && !!quote && quote.includes("Here's what I'd change"), { value: after, quote })
  }
  await ctx.close()
}

// paste: a long paste in the middle is sent in the middle, after typing before and after it
{
  const { ctx, page, sends } = await open()
  await box(page).fill(WORDS)
  await caret(page, AT)
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('.cbox textarea')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PASTE)
  await page.waitForTimeout(100)
  // type where the caret is (after the paste), then at the start, then at the end
  await page.keyboard.type(' Here:', { delay: 10 })
  await caret(page, 0)
  await page.keyboard.type('Hi! ', { delay: 10 })
  await box(page).press('End')
  await page.keyboard.type(' Thanks.', { delay: 10 })
  await shot(page, 'paste')
  await send(page)
  const s = sends.at(-1)
  const want = `Hi! Thanks for the list.\n\n${PASTE}\n\nHere: Also fix the FAQ links. Thanks.`
  say('paste: it is sent where it was pasted, the words typed after it around it', s?.text === want, s && { start: s.text.slice(0, 40), end: s.text.slice(-50) })
  await ctx.close()
}

// together: on a phone with the keyboard up, typing hides "Replying to" with the suggestions
{
  const { ctx, page } = await open(true)
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.foot > :is(.sugs, .sugfor)')].map((e) => `${e.className.split(' ')[0]}:${getComputedStyle(e).display !== 'none'}`))
  const at = await shown()
  await box(page).tap()
  await page.setViewportSize({ width: 390, height: TALL - KEYBOARD })
  await page.waitForFunction(() => document.documentElement.classList.contains('kb-up'), null, { timeout: 3000 }).catch(() => undefined)
  await page.keyboard.type('Sure', { delay: 10 })
  await page.waitForTimeout(200)
  const typing = await shown()
  await shot(page, 'together-phone', FOOT)
  say('together: both show before typing', at.length === 2 && at.every((x) => x.endsWith(':true')), at)
  say('together: typing with the keyboard up hides both', typing.length === 2 && typing.every((x) => x.endsWith(':false')), typing)
  await ctx.close()
}

// drop: a file dragged over the page shows where it goes; over the box it is ready; a drop attaches it
{
  const { ctx, page } = await open()
  const drag = (type: string, sel: string) =>
    page.evaluate(([type, sel]) => {
      const dt = new DataTransfer()
      dt.items.add(new File(['fictional notes'], 'notes.txt', { type: 'text/plain' }))
      const el = document.querySelector(sel!)!
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new DragEvent(type!, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 20 }))
    }, [type, sel])
  const state = () => page.evaluate(() => ({ cls: document.querySelector('.cbox')!.className, words: document.querySelector('.cdrop')?.textContent ?? null }))
  await drag('dragenter', '.msgs')
  await drag('dragover', '.msgs')
  const page1 = await state()
  await shot(page, 'drop-page', FOOT)
  await drag('dragover', '.cbox textarea')
  const over = await state()
  await shot(page, 'drop-over', FOOT)
  await drag('drop', '.cbox textarea')
  await page.waitForTimeout(300)
  const after = await state()
  const files = await page.locator('.cbox [aria-label="Files to send"] [role="listitem"]').count()
  say('drop: over the page, the box shows where to drop', /\bdrop\b/.test(page1.cls) && !/\bover\b/.test(page1.cls) && !!page1.words, page1)
  say('drop: over the box, it is ready to take it', /\bover\b/.test(over.cls), over)
  say('drop: the drop attaches the file and the box goes back', files === 1 && !/\bdrop\b/.test(after.cls), { files, after })
  await ctx.close()
}

await browser.close()
server.kill()
process.exit(failed)
