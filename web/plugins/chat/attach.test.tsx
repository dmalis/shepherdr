// Phone + sheet: one tap to camera, photos, files (dmalis/shepherdr#112). A desktop opens files at once; an iPhone or
// iPad opens Apple's own menu at once (iOS shows it for every picture or file input, so a sheet of ours first would be
// a second menu); an Android phone gets Camera, Photos and Files tiles, each straight to its picker.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { AddButtons, AddSheet, appleTouch, pickFiles, PICKS, plusWay } from './attach.tsx'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36'

test('iOS and iPadOS are told apart from Android and a Mac', () => {
  expect(appleTouch(IPHONE, 5)).toBe(true)
  // an iPad says it is a Mac; its touch screen gives it away
  expect(appleTouch(IPAD, 5)).toBe(true)
  expect(appleTouch(IPAD, 0)).toBe(false)
  expect(appleTouch(ANDROID, 5)).toBe(false)
})

test('+ goes to files on a desktop, to Apple\'s menu on iOS, to the sheet elsewhere', () => {
  expect(plusWay(false, false)).toBe('files')
  expect(plusWay(false, true)).toBe('files')
  expect(plusWay(true, true)).toBe('apple')
  expect(plusWay(true, false)).toBe('sheet')
})

test('an iPhone: + opens one input with no accept, one at a time, so Apple\'s menu offers all three and a tap attaches', () => {
  const html = renderToStaticMarkup(<AddButtons finger apple onFiles={() => undefined} />)
  expect(html).toContain('aria-label="Add photos or files"')
  expect(html).not.toContain('aria-haspopup')
  expect(html.match(/<input/g)?.length).toBe(1)
  expect(html).not.toContain('accept=')
  expect(html).not.toContain('multiple')
  expect(html).not.toContain('capture')
})

test('an Android phone: + opens a menu; Camera captures at once, Photos is image-only, Files takes several', () => {
  const html = renderToStaticMarkup(<AddButtons finger apple={false} onFiles={() => undefined} />)
  expect(html).toContain('aria-label="Add"')
  expect(html).toContain('aria-haspopup="menu"')
  expect(html).toMatch(/<input type="file" multiple="" hidden=""/)
  expect(html).toMatch(/<input type="file" accept="image\/\*" capture="environment" hidden="" data-pick="camera"/)
  expect(html).toMatch(/<input type="file" accept="image\/\*" hidden="" data-pick="photos"/)
})

test('a desktop: + opens files straight away, several at once', () => {
  const html = renderToStaticMarkup(<AddButtons finger={false} onFiles={() => undefined} />)
  expect(html).toContain('aria-label="Add files"')
  expect(html.match(/<input/g)?.length).toBe(1)
  expect(html).toContain('multiple=""')
})

test('the sheet: three named tiles, Camera, Photos, Files, each a menu item with its icon', () => {
  const html = renderToStaticMarkup(<AddSheet close={() => undefined} pick={() => undefined} />)
  expect([...html.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(['Camera', 'Photos', 'Files'])
  expect(html.match(/role="menuitem"/g)?.length).toBe(3)
  expect(html.match(/<svg/g)?.length).toBe(3)
  expect(PICKS.map((p) => p.icon)).toEqual(['camera', 'image', 'folder'])
})

test('tiles are big touch targets, and the press follows the Motion setting and the system\'s reduced motion', async () => {
  const css = await Bun.file(new URL('./attach.css', import.meta.url)).text()
  expect(css).toMatch(/\.addt\{[^}]*min-height:88px/)
  expect(css).toContain('@media(prefers-reduced-motion:reduce)')
  expect(css).toContain(':root[data-motion="reduced"] .addt:active{transform:none}')
  expect(css).toContain('@media(hover:hover){.addt:hover')
  // the drag back is instant with less motion
  const src = await Bun.file(new URL('./attach.tsx', import.meta.url)).text()
  expect(src).toContain("still() || document.documentElement.dataset.motion === 'reduced'")
})

test('On Android, Files opens the document picker itself where Chrome has one, else the input does', async () => {
  const got: File[][] = []
  let fell = 0
  // none (an older Chrome, or not https): the input opens
  expect(pickFiles((f) => got.push(f), () => fell++, {})).toBe(false)
  expect(pickFiles((f) => got.push(f), () => fell++, { showOpenFilePicker: async () => [], isSecureContext: false })).toBe(false)
  // picked two: both attach
  const f = (n: string) => new File(['x'], n)
  expect(pickFiles((x) => got.push(x), () => fell++, { showOpenFilePicker: async (o) => (o.multiple ? [f('a.pdf'), f('b.txt')].map((x) => ({ getFile: async () => x })) : []) })).toBe(true)
  // cancelled: nothing more; failed: the input opens instead
  pickFiles((x) => got.push(x), () => fell++, { showOpenFilePicker: () => Promise.reject(Object.assign(new Error('no'), { name: 'AbortError' })) })
  pickFiles((x) => got.push(x), () => fell++, { showOpenFilePicker: () => Promise.reject(Object.assign(new Error('no'), { name: 'SecurityError' })) })
  await Bun.sleep(0)
  expect(got.map((x) => x.map((y) => y.name))).toEqual([['a.pdf', 'b.txt']])
  expect(fell).toBe(1)
})

test('at a big zoom the tiles wrap instead of cutting their labels', async () => {
  const css = await Bun.file(new URL('./attach.css', import.meta.url)).text()
  expect(css).toContain('grid-template-columns:repeat(auto-fit,minmax(min(100%,max(96px,5.5em)),1fr))')
  expect(css).not.toContain('ellipsis')
  // its classes are its own: .atile is the artifact cards'
  expect(css).not.toContain('.atile')
})

// the seams this patch stands on: upstream may change them
test('pinned: a phone\'s menu is a .sheet with role menu, and openMenu takes a drawn body', async () => {
  const overlay = await Bun.file(new URL('../../src/overlay.tsx', import.meta.url)).text()
  expect(overlay).toContain('<div className="pop sheet in" role="menu" aria-label={l.label}>')
  expect(overlay).toMatch(/export function openMenu\(anchor: Element \| null, rows: MenuRow\[\] \| \(\(close: \(\) => void\) => ReactNode\)/)
  const { IC } = await import('@client/icons.ts')
  expect(IC.camera).toBeTruthy()
  const chat = await Bun.file(new URL('./client.tsx', import.meta.url)).text()
  expect(chat).toContain("import { AddButtons } from './attach.tsx'")
  expect(chat).toContain('<AddButtons finger={finger} onFiles={(f) => attach(key, key, f)} />')
})
