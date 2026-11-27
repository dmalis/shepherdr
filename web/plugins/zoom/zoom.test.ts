// Zoom and Chat text size (dmalis/shepherdr#36): Cmd/Ctrl + = − 0 are the app's zoom on every keyboard layout, matched
// by the character, and never another shortcut; the steps; the build's px times --zoom.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { registry, type Command, type Registry } from '@client/kernel.ts'
import { appTakes, handleKey, resetPending } from '@client/commands.ts'
import { chordOf } from '@client/keys.ts'
import { stepZoom, ZOOMS } from '@client/zoom-steps.ts'
import { zoomCss, zoomValue } from '../../zoom-css.ts'
import plugin from './client.tsx'

const ran: string[] = []
const own: Command[] = []
plugin.setup({ commands: own } as unknown as Registry)
// the zoom commands as they are, each run recorded; beside them the shortcuts sheet on its own keys (Cmd+/ and ?)
const mine: Command[] = [
  ...own.map((c) => ({ ...c, run: () => void ran.push(c.id) })),
  { id: 'shortcuts.sheet', title: 'Keyboard shortcuts', area: 'General', keys: ['Shift+/', 'Mod+/'], run: () => void ran.push('shortcuts.sheet') },
]
const body = { tagName: 'BODY', isContentEditable: false, closest: () => null }
let t = 0
const press = (code: string, key: string, m: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}, mac = true) =>
  handleKey({ key, code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, target: body, timeStamp: (t += 1000), defaultPrevented: false, isComposing: false, keyCode: 0 } as unknown as KeyboardEvent, mac)
const last = () => ran.splice(0).join(',')

beforeEach(() => {
  registry.commands.push(...mine)
  ran.length = 0
  resetPending()
})
afterEach(() => {
  registry.commands.splice(0, registry.commands.length, ...registry.commands.filter((c) => !mine.includes(c)))
})

test('Cmd/Ctrl + = or +, − and 0 zoom on a US keyboard, the numpad too', () => {
  expect(press('Equal', '=', { meta: true }) && last()).toBe('zoom.in')
  expect(press('Equal', '+', { meta: true, shift: true }) && last()).toBe('zoom.in')
  expect(press('Minus', '-', { meta: true }) && last()).toBe('zoom.out')
  expect(press('Digit0', '0', { meta: true }) && last()).toBe('zoom.reset')
  expect(press('NumpadAdd', '+', { ctrl: true }, false) && last()).toBe('zoom.in')
  expect(press('NumpadSubtract', '-', { ctrl: true }, false) && last()).toBe('zoom.out')
  expect(press('Numpad0', '0', { ctrl: true }, false) && last()).toBe('zoom.reset')
  // a Mac's Cmd can leave e.key unshifted: Cmd+Shift+= still zooms in
  expect(press('Equal', '=', { meta: true, shift: true }) && last()).toBe('zoom.in')
})

test("QWERTZ (Slovenian, German): Cmd+- zooms out where US has /, never the shortcuts sheet", () => {
  // the bug: - sits on the US / key (code Slash), and the place-based chord was Mod+/
  expect(press('Slash', '-', { meta: true }) && last()).toBe('zoom.out')
  expect(press('Slash', '-', { ctrl: true }, false) && last()).toBe('zoom.out')
  // + is its own key there (code BracketRight), = is Shift+0
  expect(press('BracketRight', '+', { meta: true }) && last()).toBe('zoom.in')
  expect(press('Digit0', '=', { meta: true, shift: true }) && last()).toBe('zoom.in')
  expect(press('Digit0', '0', { meta: true }) && last()).toBe('zoom.reset')
  // the sheet stays on Cmd+/ and ?, by the character: / is Shift+7, ? is Shift+ß (code Minus)
  expect(press('Digit7', '/', { meta: true, shift: true }) && last()).toBe('shortcuts.sheet')
  expect(press('Minus', '?', { shift: true }) && last()).toBe('shortcuts.sheet')
})

test('no layout turns Cmd+- or Cmd+= into another shortcut', () => {
  // [code, key, Shift held]: US, QWERTZ, AZERTY and the numpad
  const minus: [string, string, boolean][] = [['Minus', '-', false], ['Slash', '-', false], ['Digit6', '-', false], ['NumpadSubtract', '-', false], ['KeyC', '-', false]]
  const plus: [string, string, boolean][] = [['Equal', '=', false], ['Digit0', '=', true], ['BracketRight', '+', false], ['Equal', '+', true], ['NumpadAdd', '+', false]]
  const chord = ([code, key, shift]: [string, string, boolean]) => chordOf({ key, code, metaKey: true, ctrlKey: false, altKey: false, shiftKey: shift }, true)
  for (const k of minus) expect(chord(k)).toBe('Mod+-')
  for (const k of plus) expect(['Mod+=', 'Mod+Shift+=']).toContain(chord(k)!)
})

test('the steps: a browser zoom’s, staying at the ends', () => {
  expect(ZOOMS[0]).toBe(67)
  expect(ZOOMS.at(-1)).toBe(200)
  expect(stepZoom(100, 1)).toBe(110)
  expect(stepZoom(100, -1)).toBe(90)
  expect(stepZoom(200, 1)).toBe(200)
  expect(stepZoom(67, -1)).toBe(67)
  expect(stepZoom(105, 1)).toBe(110)
})

test('the build: every px over 1 times --zoom; hairlines, urls and words stay', () => {
  expect(zoomValue('16px/24px Inter')).toBe('calc(16px*var(--zoom))/calc(24px*var(--zoom)) Inter')
  expect(zoomValue('translate(-50%,-24px)')).toBe('translate(-50%,calc(-24px*var(--zoom)))')
  expect(zoomValue('calc(100% - 32px)')).toBe('calc(100% - calc(32px*var(--zoom)))')
  expect(zoomValue('inset 0 0 0 1px var(--line2)')).toBe('inset 0 0 0 1px var(--line2)')
  expect(zoomValue('0 -1px .5px')).toBe('0 -1px .5px')
  expect(zoomValue('url(a-16px.png) 12px')).toBe('url(a-16px.png) calc(12px*var(--zoom))')
  expect(zoomValue('max(16PX,var(--chat))')).toBe('max(16PX,var(--chat))')
})

test('the build: a width query is written once per zoom step, specificity unchanged', async () => {
  const out = (await postcss([zoomCss()]).process('@container (max-width:336px){.a .b{gap:8px}}@media(pointer:coarse){.c{top:4px}}', { from: undefined })).css
  expect(out).toContain('@container (max-width:504px){:where(:root[data-zoom="150"]) .a .b{gap:calc(8px*var(--zoom))}}')
  expect(out).toContain('@container (max-width:336px){:where(:root:not([data-zoom])) .a .b{gap:calc(8px*var(--zoom))}}')
  expect(out.match(/@container/g)!.length).toBe(ZOOMS.length)
  // a query on no width is left as it is
  expect(out).toContain('@media(pointer:coarse){.c{top:calc(4px*var(--zoom))}}')
})

// the seams in upstream's files this patch hangs on (dmalis/shepherdr#36): a sync that moves one fails here first
test('pinned: the build runs the zoom pass, the layout follows it, Settings shows the rows, the chat uses its tokens', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  expect(read('../../vite.config.ts')).toContain('css: { postcss: { plugins: [zoomCss()] } }')
  expect(read('../../src/kernel.ts')).toMatch(/const MQ = widthUpTo\(767\)\nconst MQ2 = widthUpTo\(1023\)/)
  expect(read('../../src/settings.tsx')).toMatch(/<SRow label="Theme">.*\n\s*<SizeRows \/>\n\s*<SRow label="Chat width"/)
  // the rules size.css takes over are still upstream's, under the same selectors
  const ds = read('../../src/ds.css'), styles = read('../../src/styles.css')
  for (const sel of ['.msgs{', '.b{', '.rpl{', '.wsign .wbub{', '.wdots{', '.wstep{', '.wrow>.wstop{', '.ref{', '.quote.qtask{', '.chip{', '.card{', '.files{', '.code{', '.donerow{', '.cin{']) expect(ds).toContain(sel)
  for (const sel of ['.quote{', 'button.quote{', '.md h1,.md h2,.md h3,.md h4{', '.md code{', '.md pre{', '.md table{']) expect(styles).toContain(sel)
  expect(read('./client.tsx')).toContain("import '@client/size.css'")
  expect(read('../../src/prefs.ts')).toContain('zoom: ZOOMS.includes(v.zoom as Zoom)')
  expect(read('../../plugins.json')).toContain('"zoom"')
  // a computer zoomed into the phone's layout keeps the sheet on its keys; a phone with a finger doesn't list it
  expect(read('../shortcuts/client.tsx')).toContain("when: () => !getState().ui.phone || !touch(), run: openSheet")
})

test('from inside a terminal the zoom keys are the app’s, as VS Code’s are; the shell keeps its own keys', () => {
  const ev = (code: string, key: string, m: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) => ({ key, code, metaKey: !!m.meta, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: false })
  expect(appTakes(ev('Equal', '=', { ctrl: true }), false)).toBe(true)
  expect(appTakes(ev('Minus', '-', { ctrl: true }), false)).toBe(true)
  expect(appTakes(ev('Digit0', '0', { ctrl: true }), false)).toBe(true)
  expect(appTakes(ev('Slash', '-', { meta: true }), true)).toBe(true)
  // the shell's own: Ctrl+C, Ctrl+L, Ctrl+/ stay in the terminal
  expect(appTakes(ev('KeyC', 'c', { ctrl: true }), false)).toBe(false)
  expect(appTakes(ev('KeyL', 'l', { ctrl: true }), false)).toBe(false)
  expect(appTakes(ev('Slash', '/', { ctrl: true }), false)).toBe(false)
})
