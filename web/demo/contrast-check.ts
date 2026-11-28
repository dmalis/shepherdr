// Contrast check (UI polish slice 11, docs/design.md's Readability): rows and controls you can read, as painted.
//
// Opens the built demo in a headless Chrome at a phone's width (touch) and a desktop's, in light, the device's dark,
// Dark and Night, and measures from a screenshot:
//   - every row that can't be reached (`.row.dim`, ?case=down) or is switched off (`.row.off`): its name and second
//     line over the row's own background, at 4.5:1 (WCAG AA), with its opacity and its parents' counted; and its mark
//     dimmed (the mark, not the words);
//   - a checkbox unticked (its edge) and ticked (its fill), the Tasks filter's: 3:1 against what is around it (WCAG 2.2,
//     non-text contrast), and a field's edge where the scene has one;
//   - the focus ring on what the keyboard reached: 3:1 against the surface beside it;
//   - red's role in the Tasks list: a stopped task that waits on you has a red ring, a failed check its agent fixes
//     does not.
//
//   bun run build && bun web/demo/contrast-check.ts [--url <a running demo>] [--shots <dir>] [--before]
//
// --before: report only, never fail (for measuring an older build, served with --url).
// Chrome: $CHROME, else agent-browser's, else google-chrome / chromium on PATH (tap-check.ts's chrome()).
import { mkdirSync } from 'node:fs'
import { chromium, type Page } from 'playwright-core'
import { contrast, over } from './artifact-check.ts'
import { chrome, step } from './tap-check.ts'

export const TEXT = 4.5
export const EDGE = 3

const LOOKS = [
  { name: 'light', theme: 'System', device: 'light' },
  { name: 'dark', theme: 'System', device: 'dark' },
  { name: 'Dark', theme: 'Dark', device: 'dark' },
  { name: 'Night', theme: 'Night', device: 'dark' },
] as const
const WIDTHS = [{ name: 'phone', width: 390, height: 844, touch: true }, { name: 'desktop', width: 1280, height: 800, touch: false }]
const SCALE = 2

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined }
const before = process.argv.includes('--before')
const shots = arg('--shots')
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

/** a pair to compare: `fg` painted (rgba, its opacity counted) over the pixel at `bg`, or the pixel at `fg` against it */
type Probe = { what: string; min: number; bg: [number, number]; fg?: [number, number]; ink?: number[]; dim?: number }
type Result = { what: string; min: number; ratio: number; dim?: number }

/** every probe the page has now, in CSS px */
const probesOf = (page: Page, which: string[]) => page.evaluate((which) => {
  const out: Probe[] = []
  const probe = document.createElement('canvas').getContext('2d')!
  const rgba = (css: string) => { probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = css; probe.fillRect(0, 0, 1, 1); return Array.from(probe.getImageData(0, 0, 1, 1).data).map((v, i) => (i === 3 ? v / 255 : v)) }
  const alpha = (el: Element | null) => { let a = 1; for (let e = el; e; e = e.parentElement) a *= Number(getComputedStyle(e).opacity); return a }
  // a checkbox's mark is hidden from screen readers (its row is the checkbox), so only [inert] counts against it
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !el.closest(el.matches(".cbx") ? "[inert]" : "[aria-hidden=\"true\"], [inert]") }
  const name = (el: Element) => (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
  if (which.includes('rows')) {
    for (const row of Array.from(document.querySelectorAll('.row.dim, .row.off')).filter(shown)) {
      const r = row.getBoundingClientRect()
      // the row's own background, in its padding beside its mark
      const bg: [number, number] = [r.left + 3, r.top + r.height / 2]
      const lead = row.firstElementChild && !row.firstElementChild.matches('.n') ? row.firstElementChild : null
      for (const sel of ['.l1', '.l2', '.n']) {
        const el = row.querySelector(sel)
        if (!el || (sel === '.n' && el.querySelector('.l1'))) continue
        const ink = rgba(getComputedStyle(el).color)
        ink[3] = ink[3]! * alpha(el)
        out.push({ what: `${row.matches('.dim') ? 'dim' : 'off'} row "${name(row)}" ${sel === '.l2' ? 'second line' : 'name'}`, min: 4.5, bg, ink, dim: lead ? alpha(lead) : undefined })
      }
    }
  }
  if (which.includes('controls')) {
    // on top at its middle: not scrolled out of its menu or under something
    const onTop = (el: Element) => { const r = el.getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!at && (el.closest(".row") ?? el).contains(at) }
    for (const box of Array.from(document.querySelectorAll(".cbx")).filter((b) => shown(b) && onTop(b))) {
      const r = box.getBoundingClientRect(), y = r.top + r.height / 2
      const on = box.matches('.on')
      out.push({ what: `checkbox ${on ? 'ticked (fill)' : 'unticked (edge)'} "${name(box.closest('.row') ?? box)}"`, min: 3, fg: [r.left + (on ? 1.5 : 0.5), y], bg: [r.left - 2, y] })
    }
    for (const f of Array.from(document.querySelectorAll('.inp, .tg')).filter(shown)) {
      const r = f.getBoundingClientRect(), y = r.top + r.height / 2
      const on = f.matches('.tg[aria-checked="true"], .tg.on')
      out.push({ what: `${f.matches('.tg') ? `toggle ${on ? 'on (fill)' : 'off (edge)'}` : 'field (edge)'} "${f.getAttribute('aria-label') ?? ''}"`, min: 3, fg: [r.left + (on ? 1.5 : 0.5), y], bg: [r.left - 2, y] })
    }
  }
  if (which.includes('focus')) {
    const el = document.querySelector(':focus-visible')
    if (el && shown(el)) {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect(), y = r.top + r.height / 2
      const off = parseFloat(cs.outlineOffset) || 0, w = parseFloat(cs.outlineWidth) || 0
      if (cs.outlineStyle !== 'none' && w > 0) out.push({ what: `focus ring on "${el.getAttribute('aria-label') ?? name(el)}"`, min: 3, fg: [r.left - off - w / 2, y], bg: [r.left - off - w - 2, y] })
    }
  }
  return out
}, which) as Promise<Probe[]>

/** the probes measured on a screenshot of the page now, read back through a canvas */
async function measure(page: Page, probes: Probe[]): Promise<Result[]> {
  const png = await page.screenshot()
  return page.evaluate(async ({ src, probes, scale }) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0)
    const px = ([x, y]: [number, number]) => Array.from(g.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data).slice(0, 3)
    return probes.map((p) => ({ ...p, bgPx: px(p.bg), fgPx: p.fg ? px(p.fg) : null }))
  }, { src: `data:image/png;base64,${png.toString("base64")}`, probes, scale: SCALE }).then((rows: (Probe & { bgPx: number[]; fgPx: number[] | null })[]) =>
    rows.map((p) => {
      const fg = p.fgPx ?? over(p.ink!, p.bgPx)
      return { what: p.what, min: p.min, ratio: contrast(fg, p.bgPx), dim: p.dim }
    }))
}

/** red's roles (docs/design.md, Colour): each task ring painted in `--red`, with the Now list's group it sits under
 *  (the group's heading, "Needs you · 5"), and the ring of the demo's failed check (SHOP-25) */
const redRings = (page: Page) => page.evaluate(() => {
  const d = document.createElement('i')
  d.style.color = 'var(--red)'
  document.body.append(d)
  const red = getComputedStyle(d).color
  d.remove()
  const red_ = Array.from(document.querySelectorAll('[data-task-row] .tring')).filter((r) => getComputedStyle(r).color === red).map((r) => {
    const row = r.closest('[data-task-row]')!
    return { id: row.getAttribute('data-task-row')!, group: (row.parentElement?.querySelector(':scope > .grp')?.textContent ?? '').split(' · ')[0]!.trim() }
  })
  const f = document.querySelector('[data-task-row="SHOP-25"] .tring')
  return { red: red_, failed: f ? { colour: getComputedStyle(f).color, isRed: getComputedStyle(f).color === red } : null }
})

/** `tasks`: the Tasks pane open from the start (its button opens Needs you while it has a red count) */
const SCENES: { name: string; url: string; tasks?: boolean; steps: string[]; measure: string[]; then?: (p: Page) => Promise<void> }[] = [
  { name: 'unreachable machine', url: '?case=down', steps: ['phone-list'], measure: ['rows'] },
  { name: 'unreachable tasks', url: '?case=down', tasks: true, steps: [], measure: ['rows'] },
  {
    name: 'tasks filter',
    url: '',
    tasks: true,
    steps: ['[aria-label^="Filter tasks"]'],
    measure: ['controls'],
    // tick one, so the menu shows both
    then: async (p) => { await p.locator('.layer [role="checkbox"][aria-checked="false"]').locator('visible=true').first().click({ timeout: 3000 }) },
  },
  { name: 'focus ring', url: '', tasks: true, steps: [], measure: ['focus'], then: async (p) => { await p.keyboard.press('Tab'); await p.keyboard.press('Tab') } },
]

const demo = arg('--url') ? null : await startDemo()
const base = arg('--url') ?? demo!.url
const browser = await chromium.launch({ executablePath: chrome(), args: ['--hide-scrollbars'] })
const fails: string[] = []
let n = 0
try {
  for (const size of WIDTHS) {
    for (const look of LOOKS) {
      for (const sc of SCENES) {
        const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch, deviceScaleFactor: SCALE, colorScheme: look.device, reducedMotion: 'reduce' })
        await ctx.addInitScript(({ theme, tasks }) => {
          localStorage.setItem('shepherdr.prefs', JSON.stringify({ theme, motion: 'reduced' }))
          if (tasks) localStorage.setItem('shepherdr.ui', JSON.stringify({ pane: 'tasks' }))
        }, { theme: look.theme, tasks: !!sc.tasks })
        const page = await ctx.newPage()
        await page.goto(base + sc.url)
        await page.locator('.app').waitFor({ timeout: 10000 })
        await page.waitForTimeout(400)
        for (const st of sc.steps) await step(page, st).catch(() => {})
        await page.waitForTimeout(300)
        await sc.then?.(page).catch(() => {})
        // what fades in has finished (a finite animation; the endless ones keep going)
        await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {}))))
        await page.waitForTimeout(300)
        const where = `${size.name} ${look.name} · ${sc.name}`
        const res = await measure(page, await probesOf(page, sc.measure))
        if (!res.length) fails.push(`${where}: nothing to measure`)
        for (const r of res) {
          n++
          const ok = r.ratio >= r.min && (r.dim === undefined || r.dim < 1)
          console.log(`${ok ? 'ok  ' : 'LOW '} ${where} · ${r.what}: ${r.ratio.toFixed(2)}:1 (needs ${r.min})${r.dim !== undefined ? `, mark at ${r.dim.toFixed(2)}` : ''}`)
          if (!ok) fails.push(`${where} · ${r.what}: ${r.ratio.toFixed(2)}:1${r.dim === 1 ? ', its mark not dimmed' : ''}`)
        }
        if (sc.name === 'tasks filter' && !res.some((r) => r.what.includes('ticked (fill)')) ) fails.push(`${where}: no ticked checkbox`)
        if (sc.name === 'tasks filter' && !res.some((r) => r.what.includes('unticked'))) fails.push(`${where}: no unticked checkbox`)
        if (sc.name === 'focus ring' && size.name === 'desktop') {
          // red is Needs you: every red ring in the list sits under Needs you, and the failed check its agent fixes
          // (the demo's "Search suggestions as you type") is not red
          const rings = await redRings(page)
          const stray = rings.red.filter((r) => r.group !== 'Needs you')
          console.log(`${rings.red.length && !stray.length ? 'ok  ' : 'BAD '} ${where} · ${rings.red.length} red rings, all under Needs you${stray.length ? `; not: ${stray.map((r) => `${r.id} (${r.group})`).join(', ')}` : ''}`)
          console.log(`${rings.failed && !rings.failed.isRed ? 'ok  ' : 'BAD '} ${where} · a failed check its agent fixes: ring ${rings.failed?.colour ?? 'missing'}`)
          if (!rings.red.length) fails.push(`${where}: no red ring under Needs you`)
          for (const r of stray) fails.push(`${where}: ${r.id}'s ring is red under ${r.group}`)
          if (!rings.failed || rings.failed.isRed) fails.push(`${where}: the failed check's ring is ${rings.failed ? 'red' : 'missing'}`)
        }
        if (shots) await page.screenshot({ path: `${shots}/${sc.name.replaceAll(' ', '-')}--${size.name}--${look.name}.png` })
        await ctx.close()
      }
    }
  }
} finally {
  await browser.close()
  demo?.server.kill()
}
console.log(`\n${n} measured, ${fails.length} below`)
if (fails.length) {
  for (const f of fails) console.log(`  ${f}`)
  if (!before) process.exit(1)
}
