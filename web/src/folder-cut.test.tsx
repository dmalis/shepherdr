// fork #105: a folder gives way in its middle, never from its start; a phone's header has none and its space's menu
// has a Folder row instead. The upstream seams it leans on are pinned below.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { folderLast, folderParts } from '@shared/folder-cut.ts'
import { FolderCut } from './where.tsx'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('a path splits before its last part, the slash going with the last part', () => {
  expect(folderParts('~/clients/northwind/portal')).toEqual({ lead: '~/clients/northwind', last: '/portal' })
  expect(folderParts('~/dev/shop/')).toEqual({ lead: '~/dev', last: '/shop' })
  expect(folderParts('/srv')).toEqual({ lead: '', last: '/srv' })
  expect(folderParts('~')).toEqual({ lead: '', last: '~' })
  expect(folderParts('/')).toEqual({ lead: '', last: '/' })
  expect(folderParts('shop')).toEqual({ lead: '', last: 'shop' })
})

test("a folder's own name for the phone's menu row", () => {
  expect(folderLast('~/clients/northwind/portal')).toBe('portal')
  expect(folderLast('/srv')).toBe('srv')
  expect(folderLast('~')).toBe('~')
  expect(folderLast('/')).toBe('/')
})

test('the header draws the lead and the last part apart, so only the lead is cut', () => {
  expect(renderToStaticMarkup(<FolderCut path="~/dev/shop" />)).toBe('<span class="hpl">~/dev</span><span class="hpn">/shop</span>')
  expect(renderToStaticMarkup(<FolderCut path="~" />)).toBe('<span class="hpn">~</span>')
  const css = read('web/src/hpath.css')
  // the lead gives way first, from its end (…), the last part only once the lead is gone; never right to left
  expect(css).toContain('.hpath .hp.cut{display:flex;direction:ltr;min-width:0}')
  expect(css).toContain('.hpath .hp.cut>.hpl{flex:0 1000 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
  expect(css).toContain('.hpath .hp.cut>.hpn{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
})

test("a phone's header has no folder; its space's menu has it", () => {
  const css = read('web/src/hpath.css')
  expect(css).toContain('.app.phone .col > .hd .ttl > .hpath{display:none}')
  expect(read('web/plugins/chat/client.tsx')).toContain("reg.spaceMenu.push({ order: 30, rows: (p, head) => (head ? folderRows(p) : []) })")
  const row = read('web/plugins/chat/folder-row.tsx')
  expect(row).toContain("const w = snap && phone ? headerWhere(snap, p) : null")
  expect(row).toContain("label: 'Folder', value: folderLast(w.path), run: () => folderMenu(")
})

test('upstream seams: the header path, its cut, the phone class and the folder sheet', () => {
  const app = read('web/src/App.tsx')
  expect(app).toContain('<HeaderPath snap={snap} place={place} />')
  expect(app).toContain('<div className="ttl">')
  // the cut this replaces, and the name's room beside the path
  const ds = read('web/src/ds.css')
  expect(ds).toContain('.hp.cut{direction:rtl}')
  expect(ds).toContain('.ttl>.tbtn:has(+.hpath){max-width:calc(100% - 44px)}')
  expect(read('web/shared/view.ts')).toContain('export function headerWhere(snap: Snapshot, p: Pick<Place,')
  expect(read('web/src/list.tsx')).toContain('export function folderMenu(anchor: Element, placeId: string)')
  expect(read('web/src/kernel.ts')).toContain('spaceMenu: { order: number; rows: (place: Space, head: boolean) => MenuRow[] }[]')
  expect(app).toMatch(/className=\{cx\('app'[^\n]*phone && 'phone'/)
})
