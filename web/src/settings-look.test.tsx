// Settings, one look on every page (dmalis/shepherdr#68): a choice is a segmented control only where it fits beside
// its label, the theme pictures are each theme's own colours, General's sections and its chat sample, and the seams in
// upstream's files this hangs on.
import { afterAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

const disk = new Map<string, string>()
const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
afterAll(() => {
  if (had) Object.defineProperty(globalThis, 'localStorage', had)
  else delete (globalThis as { localStorage?: unknown }).localStorage
})
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, v), removeItem: (k: string) => void disk.delete(k) },
})
const { Choice, fits } = await import('./choice.tsx')
const { Here, Sample, Themes } = await import('./appearance.tsx')
const { setUI } = await import('./kernel.ts')
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('a choice fits when the control, a gap and its label (at most 40% of the row) fit in the row', () => {
  // a short label beside a short control
  expect(fits(200, 60, 600)).toBe(true)
  // a long label keeps only 40% of the row: 300 + 16 + 240 fits 600
  expect(fits(300, 500, 600)).toBe(true)
  // Merge's three long choices on a phone's row
  expect(fits(420, 50, 326)).toBe(false)
  // exactly full
  expect(fits(524, 60, 600)).toBe(true)
  expect(fits(525, 60, 600)).toBe(false)
})

test('each theme picture is that theme, in ds.css’s own colours', () => {
  const ds = read('./ds.css')
  const css = read('./settings-look.css')
  const tokens = (block: string) => Object.fromEntries([...block.matchAll(/--(canvas|well|raised|mine|line2):([^;}]+)/g)].map((m) => [m[1], m[2]!.trim()]))
  const looks = {
    light: ds.match(/^:root\{([^}]*)\}/m)![1]!,
    dark: ds.match(/^:root\[data-theme="dark"\]\{([^}]*)\}/m)![1]!,
    night: ds.match(/^:root\[data-theme="night"\]\{([^}]*)\}/m)![1]!,
  }
  for (const [look, block] of Object.entries(looks)) {
    const want = tokens(block)
    const pic = css.match(new RegExp(`\\.thm-sc\\.${look}\\{([^}]*)\\}`))![1]!
    const got = Object.fromEntries([...pic.matchAll(/--t-(canvas|well|raised|mine|line2):([^;}]+)/g)].map((m) => [m[1], m[2]!.trim()]))
    expect(got).toEqual(want)
  }
})

test('General: four titled sections kept on this device, the theme pictures, and a chat sample in the chat’s own bubbles', () => {
  // the sections, in order, each with its tag; the sample before Zoom and Chat text size; no footnote any more
  const src = read('./appearance.tsx')
  expect([...src.matchAll(/<Here>([^<]+)<\/Here>/g)].map((m) => m[1])).toEqual(['Theme', 'Text and zoom', 'Layout', 'Behaviour'])
  expect(src).toMatch(/<Here>Text and zoom<\/Here>\n\s*<Sample \/>\n\s*<SRow label="Zoom">[\s\S]*<SRow label="Chat text size">/)
  expect(src).toMatch(/<Here>Behaviour<\/Here>\n\s*<SRow label="Motion">[\s\S]*Keep the screen on/)
  expect(src).not.toContain('kept on this device.')
  expect(renderToStaticMarkup(<Here>Theme</Here>)).toBe('<h3>Theme<span class="dtag">This device</span></h3>')
  // one picture per theme, the one picked pressed, and System half Light half Dark
  const pics = renderToStaticMarkup(<Themes value="Dark" />)
  expect([...pics.matchAll(/class="thm" aria-pressed="(true|false)"><span class="thm-pic" aria-hidden="true">([\s\S]*?)<\/span><span class="thm-n">(\w+)/g)].map((m) => `${m[3]}:${m[1]}`)).toEqual(['System:false', 'Light:false', 'Dark:true', 'Night:false'])
  expect(pics).toContain('<span class="thm-sc light">')
  expect(pics).toContain('<span class="thm-sc dark half">')
  expect(pics).toContain('<span class="thm-sc night">')
  // the sample: the chat's .msgs, an agent's .b and the person's .b.mine, framed and hidden from screen readers
  expect(renderToStaticMarkup(<Sample />)).toMatch(/^<div class="tprev" aria-hidden="true"><div class="msgs"><div class="b"><div class="md"><p>[^<]+<\/p><\/div><\/div><div class="b mine gap"><div class="md" style="white-space:pre-wrap">[^<]+<\/div><\/div><\/div><\/div>$/)
})

test('on a phone every choice is a menu button with its value; on a computer the segmented control', () => {
  setUI({ phone: true })
  const phone = renderToStaticMarkup(<Choice label="Motion" values={['System', 'Reduced']} value="Reduced" onChange={() => undefined} />)
  expect(phone).toMatch(/^<button type="button" class="chv" aria-haspopup="menu" aria-label="Motion: Reduced"><span class="v">Reduced<\/span><svg/)
  expect(phone).not.toContain('class="seg"')
  setUI({ phone: false })
  const desk = renderToStaticMarkup(<Choice label="Motion" values={['System', 'Reduced']} value="Reduced" onChange={() => undefined} />)
  expect(desk).toContain('<span class="chp" aria-hidden="true">')
  expect(desk).toMatch(/<div class="seg" role="group" aria-label="Motion">.*aria-pressed="true">Reduced</)
})

// the seams in upstream's files this patch hangs on (dmalis/shepherdr#68): a sync that moves one fails here first
test('pinned: Settings swaps its choices by import, has a page title, Notifications its own page, and ds.css’s rows', () => {
  const settings = read('./settings.tsx')
  expect(settings).toContain("import { Choice as Seg } from './choice.tsx'")
  expect(settings).not.toMatch(/import \{[^}]*\bSeg\b[^}]*\} from '\.\/ui\.tsx'/)
  expect(settings).toContain('<h2 className="ptl">{cur}</h2>')
  expect(settings).toContain("['General', 'gear'], ['Notifications', 'bell'], ['Agents', 'agent']")
  expect(settings).toContain("if (sec === 'Notifications') return <Notifications />")
  expect(settings).toMatch(/export function SRow\(\{ label, wrap, children \}[^\n]*\n\s*return \(\n\s*<div className=\{cx\('srow', wrap && 'wrap'\)\}>\n\s*<span className="n">\{label\}<\/span>/)
  expect(read('./review-rows.tsx')).toContain("import { Choice as Seg } from './choice.tsx'")
  // About's "What's in it" sits right under This device's row, so it joins that group (#44's file)
  expect(read('./about.tsx')).toMatch(/<SRow label="This device" wrap>\n\s*<span className="val">[\s\S]*?<\/SRow>\n\s*\{changes\.length > 0 && \(\n\s*<section className="about-in"/)
  // the classes the look restyles are still ds.css's
  const ds = read('./ds.css')
  for (const sel of ['.srow{', '.win .pg{', '.win h3{', '.kset .srow{', '.mcard{', '.seg{', '.seg button{', '.b{', '.b.mine{', '.msgs{']) expect(ds).toContain(sel)
  // the segmented control and the menu it becomes
  expect(read('./ui.tsx')).toContain('export function Seg<T extends string>({ values, value, onChange, label }: { values: readonly T[]; value: T; onChange: (v: T) => void; label?: string })')
  expect(read('./overlay.tsx')).toContain('export function openMenu(anchor: Element | null, rows: MenuRow[]')
  expect(read('./kernel.ts')).toMatch(/export interface MenuRow \{[\s\S]*?\n {2}on\?: boolean/)
})
