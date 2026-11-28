// A still waiting picture (fork/specs/ui-polish.md, slice 2; docs/design.md, Motion and Performance): a tile that waits
// for its picture is a still frame with a sketch of a page's first lines, never a pulse, and its picture loads lazily
// into a frame that keeps its shape. web/demo/still-check.ts measures it in a browser through the seams pinned here.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Artifact } from '@shared/types.ts'
import { Preview } from './client.tsx'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const art = (x: Partial<Artifact> = {}): Artifact => ({ id: 'plan-9z', title: 'Plan', place: '', v: 3, at: 0, when: '', by: '', keeper: '', versions: [], ...x }) as Artifact

/** every rule in the app's stylesheet whose selector names the tile's frame or its sketch */
const rules = () => [...read('web/src/styles.css').matchAll(/([^{}]*\.(?:prev|psk)\b[^{}]*)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }))

test('a tile waiting for its picture shows the still sketch under a lazy picture', () => {
  const html = renderToStaticMarkup(<Preview a={art({ thumb: true })} dark={false} />)
  expect(html).toContain('class="prev wait"')
  expect(html).toContain('<span class="psk" aria-hidden="true"><i></i><i></i><i></i></span>')
  expect(html).toMatch(/<img [^>]*loading="lazy"/)
  // the sketch comes first, so the picture paints over it
  expect(html.indexOf('class="psk"')).toBeLessThan(html.indexOf('<img'))
})

test('a tile with no picture shows its first lines alone, no sketch', () => {
  const html = renderToStaticMarkup(<Preview a={art({ thumb: false })} dark />)
  expect(html).not.toContain('psk')
})

test('nothing on the frame or its sketch animates, and its shape is fixed', () => {
  const rs = rules()
  expect(rs.length).toBeGreaterThan(0)
  for (const r of rs) expect(r.body).not.toMatch(/\banimation\b/)
  expect(read('web/src/styles.css')).not.toContain('@keyframes prevwait')
  expect(rs.find((r) => r.sel === '.prev')?.body).toContain('aspect-ratio:16/10')
  // the picture fills the frame out of its flow: one taller than 16:10 can't stretch the tile as it loads
  expect(rs.find((r) => r.sel === '.prev img' && r.body.includes('position:'))?.body).toContain('position:absolute;inset:0')
  // the picture fades in over the sketch; the sketch hides once that fade is over, at once under either reduced setting
  expect(rs.some((r) => r.sel === '.prev:not(.wait) .psk' && r.body.includes('transition:visibility 0s .2s'))).toBe(true)
  expect(read('web/src/styles.css')).toContain(':root[data-motion="reduced"] .prev img,:root[data-motion="reduced"] .prev:not(.wait) .psk{transition:none}')
})

test("a picture opened in Files sits in a frame the pane's height, fitted inside it", () => {
  const css = read('web/plugins/files/files.css')
  expect(css).toMatch(/\.ftimg\{[^}]*height:100%/)
  expect(css).toMatch(/\.ftimg img\{[^}]*max-width:100%;max-height:100%/)
  expect(read('web/plugins/files/client.tsx')).toContain('<div className="ftimg"><img ')
})

test('the still check finds what it measures: the demo refuses pictures on ?case=nopics, at the tile\'s address', () => {
  const serve = read('web/demo/serve.ts')
  expect(serve).toContain("m?.[2] === 'thumb' && /(?:^|;\\s*)demo-case=nopics/")
  expect(serve).toContain("`demo-case=${url.searchParams.get('case') ?? 'normal'}")
  const check = read('web/demo/still-check.ts')
  expect(check).toContain('/\\/api\\/artifacts\\/[^/]+\\/thumb/')
  expect(renderToStaticMarkup(<Preview a={art({ thumb: true })} dark={false} />)).toContain('src="api/artifacts/plan-9z/thumb?v=3"')
  expect(read('web/src/kernel.ts')).toContain("q.get('pane')")
})
