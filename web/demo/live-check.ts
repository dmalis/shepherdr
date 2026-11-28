// The app's one live region, in a real browser (docs/design.md, Touch, gestures and keys; UI 18): what changes on its
// own reaches a screen reader once. `bun run build`, `bun web/demo/serve.ts <port>`, then
// `bun web/demo/live-check.ts <port>`: it counts every line added to a live region while a send fails, a toast shows,
// the link to the demo goes and comes back, and the Tasks filter changes, and fails unless each is said exactly once
// and the page has only the one live region. Exits 1 on a failure.
import { chromium, type Page } from 'playwright-core'
import { chrome } from './tap-check.ts'

const port = Number(process.argv[2] || 7799)
const base = `http://127.0.0.1:${port}/`
let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures++
}

/** every line added to any live region (aria-live, role=status, role=alert, role=log) from now on */
async function listen(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { heard: string[] }
    w.heard = []
    const live = (el: Element | null) => el?.closest('[aria-live]:not([aria-live="off"]),[role="status"],[role="alert"],[role="log"]')
    new MutationObserver((ms) => {
      for (const m of ms) {
        // a text changed in place inside a live region (an implicit one too, role=status) is spoken as well
        if (m.type === 'characterData' && live(m.target.parentElement) && m.target.textContent?.trim()) w.heard.push(m.target.textContent.trim())
        for (const n of m.addedNodes) {
          const el = n.nodeType === 1 ? (n as Element) : n.parentElement
          if (live(el) && n.textContent?.trim()) w.heard.push(n.textContent.trim())
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })
}
const heard = (page: Page) => page.evaluate(() => (window as unknown as { heard: string[] }).heard)
const times = (list: string[], re: RegExp) => list.filter((t) => re.test(t)).length

const browser = await chromium.launch({ executablePath: chrome() })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
// the link to the demo: kept until `drop` closes it, then refused while `down`
let down = false
const socks: { close(): void }[] = []
await page.routeWebSocket(/api\/ws/, (ws) => {
  if (down) return void ws.close()
  const server = ws.connectToServer()
  socks.push({ close: () => (ws.close(), server.close()) })
})
// a send the service refuses, and an action that fails (its toast)
await page.route(/api\/action/, async (r) => {
  const body = r.request().postDataJSON() as { type?: string }
  if (body?.type === 'send') return r.fulfill({ status: 400, body: 'That chat is closed.' })
  return r.continue()
})
await page.route(/api\/inbox\/read/, (r) => r.abort())
await page.goto(`${base}?place=p:mac-mini:shop`)
await page.waitForSelector('.cbox textarea, .cbox [contenteditable]')
await page.waitForTimeout(800)

check((await page.locator('[aria-live]:not([aria-live="off"])').count()) === 1, 'one live region on the page')
check((await page.locator('.toasts[aria-live], .toasts [role="alert"]').count()) === 0, 'the toasts are not a live region of their own')
await listen(page)

// a failed send: said once, and not again as the page goes on
const box = page.locator('.cbox textarea, .cbox [contenteditable]').first()
await box.click()
await box.fill('Is the checkout button done?')
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
let h = await heard(page)
check(times(h, /^Your message wasn't sent/) === 1, `a failed send is said once (${JSON.stringify(h)})`)
check(await page.getByText('Not sent').first().isVisible(), 'its bubble shows Not sent')

// a `!` command that isn't sent: said once too (its row is not a live region of its own)
await box.click()
await box.fill('!ls')
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
h = await heard(page)
check(times(h, /^Your message wasn't sent/) === 2 && !h.some((t) => /^Not sent/.test(t)), `a command not sent is said once (${JSON.stringify(h)})`)

// a toast: said once (the bell's Mark all read, refused)
await page.getByRole('button', { name: /^Alerts/ }).first().click()
await page.getByRole('button', { name: 'Mark all read' }).click()
await page.waitForTimeout(800)
h = await heard(page)
check(times(h, /^Couldn't mark them read/) === 1, `a toast is said once (${JSON.stringify(h.slice(-2))})`)
await page.keyboard.press('Escape')

// the link goes (said after the line shows, a few seconds) and comes back
down = true
socks.forEach((s) => s.close())
await page.waitForSelector('.tline', { timeout: 10_000 })
await page.waitForTimeout(500)
const line = (await page.locator('.tline').innerText()).replace(/\s+/g, ' ')
check(/^Can't reach Shepherdr · last updated .+ Try again$/.test(line), `the line says when it was last updated, and Try again (${line})`)
down = false
await page.locator('.tline').getByRole('button', { name: 'Try again' }).click()
await page.waitForSelector('.tline', { state: 'detached', timeout: 10_000 })
await page.waitForTimeout(500)
h = await heard(page)
check(times(h, /^Can't reach Shepherdr\./) === 1, 'going offline is said once')
check(times(h, /^Shepherdr is back\./) === 1, 'coming back is said once')
check(times(h, /^Your message wasn't sent/) === 2, 'the failed sends are not said again')

// the Tasks filter's new count
await page.goto(`${base}?place=p:mac-mini:~&pane=tasks`)
await page.waitForTimeout(1200)
await listen(page)
await page.getByRole('button', { name: /^Filter/ }).first().click()
await page.getByRole('checkbox').first().click()
await page.waitForTimeout(600)
h = await heard(page)
check(h.length === 1 && /tasks? shown$|^No tasks match$/.test(h[0]!), `a filter's new count is said once (${JSON.stringify(h)})`)

// a first load whose /api/me never answers and whose link is refused: never a blank page, and one link at a time
const cold = await ctx.newPage()
let opened = 0
let open = 0
let most = 0
await cold.route(/api\/me/, () => {})
await cold.routeWebSocket(/api\/ws/, (ws) => {
  opened++
  most = Math.max(most, ++open)
  ws.onClose(() => open--)
  ws.close()
})
await cold.goto(`${base}?place=p:mac-mini:shop`)
await cold.waitForTimeout(1500)
cold.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => {})
await cold.getByText("Can't reach Shepherdr").first().waitFor({ timeout: 15_000 }).then(() => check(true, 'a first load that hangs says it can\'t reach Shepherdr'), () => check(false, 'a first load that hangs says it can\'t reach Shepherdr'))
// fork #163: the link opens with the page, not after api/me gives up (3 s), so the backoff's first tries (at once, half
// a second, a second) come before it says so; the pace after them is the same
check(opened <= 8, `its tries to link stay few (${opened})`)
check(most === 1, `one link at a time (${most} at once)`)

await browser.close()
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
