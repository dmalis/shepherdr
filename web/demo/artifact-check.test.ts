// UI polish slice 19: web/demo/artifact-check.ts measures every demo artifact's words in its frame, in each look, on
// every pull request. These pin what it relies on and what it guards: the frame under the page is the app's own page
// colour (--canvas), never a fixed white, and the demo's pages still say they can be dark and paint no background of
// their own, the case that showed light words on white. If one moves, the check could pass without measuring it.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { contrast, LOOKS, MIN, over } from './artifact-check.ts'

const root = new URL('../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

test('the frame under an artifact is the app’s own page colour, not a fixed white', () => {
  const rule = /^\.page\{[^}]*\}/m.exec(read('web/src/styles.css'))?.[0] ?? ''
  expect(rule).toContain('background:var(--canvas)')
  expect(rule).not.toMatch(/background:(#fff|white)/)
  // the app's themes set color-scheme on the root: a dark page is see-through over the frame only when the app is dark too
  const ds = read('web/src/ds.css')
  expect(ds).toContain(':root[data-theme="dark"]{color-scheme:dark;')
  expect(ds).toContain(':root[data-theme="night"]{color-scheme:dark;')
  expect(ds).toContain('@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;')
})

test('the demo’s pages can be light or dark and paint no background: the case the check guards', () => {
  const serve = read('web/demo/serve.ts')
  const page = serve.slice(serve.indexOf('const page = (id: string) =>'))
  const style = /<style>(.*?)<\/style>/.exec(page)?.[1] ?? ''
  expect(style).toContain(':root{color-scheme:light dark}')
  expect(style).not.toMatch(/(^|\})(html|body|:root)\{[^}]*background/)
  // its grey reads on the browser's own canvas in each: white, and Chrome's dark #121212
  expect(style).toContain('p{color:#666;')
  expect(style).toContain('@media(prefers-color-scheme:dark){p{color:#a3a3a3}}')
  expect(contrast([0x66, 0x66, 0x66], [255, 255, 255])).toBeGreaterThanOrEqual(MIN)
  expect(contrast([0xa3, 0xa3, 0xa3], [0x12, 0x12, 0x12])).toBeGreaterThanOrEqual(MIN)
})

test('the check opens each artifact as the app does and sets the theme as Settings keeps it', () => {
  const check = read('web/demo/artifact-check.ts')
  expect(check).toContain("page.locator('iframe.page')")
  expect(read('web/plugins/artifacts/client.tsx')).toContain("className={cx('page', bare && 'bare')}")
  expect(read('web/plugins/artifacts/client.tsx')).toContain('`api/artifacts/${encodeURIComponent(a.id)}/page/')
  expect(read('web/src/prefs.ts')).toContain("const KEY = 'shepherdr.prefs'")
  expect(check).toContain("localStorage.setItem('shepherdr.prefs', JSON.stringify({ theme }))")
  const themes = /THEMES = \[([^\]]*)\]/.exec(read('web/src/prefs.ts'))?.[1] ?? ''
  for (const l of LOOKS) expect(themes).toContain(`'${l.theme}'`)
  // the device's dark is Chrome's own, never emulated media: emulation sets every frame's scheme, a real frame takes the app's
  expect(check).toContain("args: ['--force-dark-mode']")
  expect(check).toContain('colorScheme: null')
  expect(check).not.toContain("colorScheme: 'dark'")
  // dark and night, on a dark device and on a light one
  expect(LOOKS.map((l) => `${l.theme}/${l.device}`)).toEqual(expect.arrayContaining(['Dark/dark', 'Night/dark', 'Dark/light', 'Night/light', 'System/dark']))
})

test('contrast is WCAG’s, and see-through words are measured as painted', () => {
  expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 5)
  expect(contrast([255, 255, 255], [255, 255, 255])).toBe(1)
  expect(contrast([0x73, 0x73, 0x73], [0x12, 0x12, 0x12])).toBeLessThan(MIN)
  expect(over([0, 0, 0, 0.5], [255, 255, 255])).toEqual([127.5, 127.5, 127.5])
})

test('a document of the artifact with no link catcher gets white under it', () => {
  const client = read('web/plugins/artifacts/client.tsx')
  // no word from the catcher near a load (an SVG, a picture), and the page's word takes it back
  expect(client).toContain('const far = Math.abs(said - at) > 1000')
  expect(client).toContain('return { bare: far, lost: far && !tapped, keep: tapped > at }')
  expect(client).toContain('const found = lookAfter(said.current, at, inside.current)\n      setBare(found.bare)')
  expect(client).toContain("if (what === 'page') { said.current = Date.now(); setLost(false); setBare(false); tell() }")
  expect(read('web/src/styles.css')).toContain('.page.bare{color-scheme:light;background:Canvas}')
  // the catcher says "page" as each HTML page of the artifact starts
  expect(read('service/artifact-links.ts')).toContain('S({shepherdr:"page"});')
})
