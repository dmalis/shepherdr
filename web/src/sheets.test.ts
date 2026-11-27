// fork #109: sheets, menus and dialogs, one system. The parts that decide things (when a drag closes, where a popover
// goes and grows from, which item a key moves to, what a sheet says on top), plus pins on what the system leans on.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { closes, rubber, speed } from './sheet-drag.ts'
import { step } from './layer-focus.ts'
import { closeAll, layersNow, openDialog, openMenu, originOf, placeAt } from './overlay.tsx'

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('a sheet pulled up past its top gives a little, never more than its band', () => {
  expect(rubber(40)).toBe(40)
  expect(rubber(0)).toBe(0)
  expect(rubber(-10)).toBeLessThan(0)
  expect(rubber(-10)).toBeGreaterThan(-10)
  expect(rubber(-1000)).toBeGreaterThan(-24)
  // the further it is pulled, the less each px moves it
  expect(rubber(-20) - rubber(-40)).toBeGreaterThan(rubber(-200) - rubber(-220))
})

test('a let-go closes the sheet on a flick down or past a third, else it settles back', () => {
  expect(closes(12, 0.8, 600)).toBe(true) // a short flick down
  expect(closes(150, -0.8, 600)).toBe(false) // flicked back up
  expect(closes(260, 0, 600)).toBe(true) // carried past a third
  expect(closes(80, 0, 600)).toBe(false) // let go early
  expect(closes(-20, 0.5, 600)).toBe(false) // above its top
})

test('a pull held still before letting go is no flick: it is measured up to the let-go, over the last 100 ms', () => {
  const moves = [{ t: 0, y: 0 }, { t: 16, y: 6 }, { t: 32, y: 12 }]
  expect(speed(moves, { t: 48, y: 18 })).toBeCloseTo(0.375)
  // 12 px, then held for a second: nothing recent, no speed, and 12 px of 600 is no close
  expect(speed(moves, { t: 1032, y: 12 })).toBe(0)
  expect(closes(12, speed(moves, { t: 1032, y: 12 }), 600)).toBe(false)
  expect(speed([], { t: 10, y: 10 })).toBe(0)
})

test('↑ ↓ wrap through a menu, Home and End go to its ends', () => {
  expect(step('ArrowDown', -1, 4)).toBe(0)
  expect(step('ArrowDown', 3, 4)).toBe(0)
  expect(step('ArrowUp', 0, 4)).toBe(3)
  expect(step('ArrowUp', -1, 4)).toBe(3)
  expect(step('Home', 2, 4)).toBe(0)
  expect(step('End', 0, 4)).toBe(3)
  expect(step('a', 0, 4)).toBe(-1)
  expect(step('ArrowDown', 0, 0)).toBe(-1)
})

test('a popover goes under its button, flips above near the bottom, stays on screen, and grows from its button', () => {
  const g = globalThis as any
  const was = { iw: g.innerWidth, ih: g.innerHeight }
  g.innerWidth = 1280
  g.innerHeight = 800
  try {
    const btn = (x: number, y: number) => ({ left: x, top: y, right: x + 28, bottom: y + 28, width: 28, height: 28 }) as DOMRect
    const under = placeAt(btn(100, 100), 240, 200)
    expect(under).toMatchObject({ left: 100, top: 132 })
    expect(under.origin).toBe('14px 0px') // the button's middle, on its top edge
    const flipped = placeAt(btn(100, 700), 240, 200)
    expect(flipped.top).toBe(700 - 200 - 4)
    expect(flipped.origin).toBe('14px 200px') // its bottom edge
    const edge = placeAt(btn(1260, 100), 240, 200)
    expect(edge.left).toBe(1280 - 240 - 8)
    expect(originOf(btn(1260, 100), { left: edge.left, top: 132, w: 240, h: 200 })).toBe('240px 0px')
  } finally {
    g.innerWidth = was.iw
    g.innerHeight = was.ih
  }
})

test("a menu of rows names itself on a phone's sheet and offers Cancel; one drawn by its caller does neither", () => {
  openMenu(null, [{ label: 'Photos', run: () => {} }], { label: 'Add' })
  expect(layersNow()[0]).toMatchObject({ kind: 'menu', title: 'Add', cancel: true })
  closeAll()
  // a quiet line on top already says what it is: no second title
  openMenu(null, [{ label: 'Run now', run: () => {} }], { label: 'Backups', cap: 'Last ran 9:00' })
  expect(layersNow()[0]?.title).toBeUndefined()
  closeAll()
  openMenu(null, () => null, { label: 'Emoji' })
  expect(layersNow()[0]).toMatchObject({ title: undefined, cancel: false })
  closeAll()
  openDialog(() => null, { label: 'Rename' })
  expect(layersNow()[0]?.title).toBeUndefined()
  closeAll()
  expect(layersNow()).toHaveLength(0)
})

/* pins (fork #109): what the one system leans on, so a sync that breaks one fails here first */
test('pinned: every layer is drawn by one component, with its shape, motion, keys and drag', () => {
  const ov = read('web/src/overlay.tsx')
  // the stack and Search both draw through LayerView; no second overlay component is left
  expect(ov.match(/<LayerView /g)?.length).toBe(2)
  expect(ov).not.toMatch(/function (Popover|Dialog)\(/)
  expect(ov).toContain('useMotion(wrap, MOTION[shape], !layer.byKey)')
  expect(ov).toContain('sheetDrag(box,')
  expect(ov).toContain('layerKey(e.nativeEvent')
  expect(ov).toMatch(/aria-modal=\{kind === 'dialog'/)
  expect(read('web/src/App.tsx')).toMatch(/<Overlay wide bare label="Search"/)
  // the sheet's styles load after the design system's, so they win at the same weight
  expect(read('web/src/styles.css')).toMatch(/@import "\.\/ds\.css";\s*@import "\.\/sheets\.css";/)
})

test('pinned: motion follows Motion: Reduced as well as the device, and nothing but transform and opacity moves', () => {
  const m = read('web/src/motion.ts')
  expect(m).toMatch(/export const calm = \(\) => still\(\) \|\| [^\n]*dataset\.motion === 'reduced'/)
  // the upstream helpers the drag settles with
  expect(m).toMatch(/export const lands = /)
  expect(m).toMatch(/export function settleMs\(/)
  expect(m).toMatch(/export function moveTo\(/)
  const both = m.slice(m.indexOf('function enter('), m.indexOf('/** A still copy'))
  expect(both).toContain('function leave(')
  for (const prop of both.match(/\b(\w+):\s*['`]/g) ?? []) expect(['transform', 'scale', 'opacity', 'backgroundColor', 'easing', 'fill'].some((p) => prop.startsWith(p))).toBe(true)
  // the viewport's keyboard height the layer sits on (an iPhone home-screen app)
  expect(read('web/src/viewport.ts')).toContain('--app-h')
  expect(read('web/src/sheets.css')).toContain('.layer{bottom:auto;height:var(--app-h,100dvh)}')
})
