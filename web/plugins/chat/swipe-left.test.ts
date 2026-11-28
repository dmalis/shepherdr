import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ACT_W, EDGE_PX, Finger, FULL_MAX, FULL_PAST, FULL_SHARE, HOLD_MS, leftOf, OPEN_AT, REPLY_AT, slidLeft, wayOf } from './press.ts'

// fork #185 (Tasks: swipe actions on a phone, a pilot): a row with actions behind it slides to the left too, as Mail's
// and Things' rows do. These are the finger's rules (press.ts); the gesture in a browser is in the proof's CDP touch run.

const ROW = 358
/** a task row with two actions, the last a full slide's (Archive) */
const two = leftOf(2, true, ROW)!
/** a row with one action and no full slide */
const one = leftOf(1, false, ROW)!
/** a finger at y 300 that moves through `xs`, `ms` apart */
function drag(f: Finger, xs: number[], ms = 16, t0 = 0) {
  let r = { slide: 0, crossed: false }
  const crossed: boolean[] = []
  xs.forEach((x, i) => {
    r = f.move(x, 300, t0 + (i + 1) * ms)
    crossed.push(r.crossed)
  })
  return { ...r, crossed }
}

test('the thresholds: each action 76 px, open past half of them, a full slide past them and past half the row', () => {
  expect(two.w).toBe(2 * ACT_W)
  expect(two.full).toBe(Math.round(Math.max(two.w + FULL_PAST, ROW * FULL_SHARE)))
  expect(one).toEqual({ w: ACT_W, full: 0 })
  expect(leftOf(0, true, ROW)).toBeNull()
  // Zoom widens each action as it does every px of the CSS
  expect(leftOf(2, false, ROW, 1.5)!.w).toBe(Math.round(2 * ACT_W * 1.5))
})

test('let go past half the actions, slowly: they stay open; short of half: the row closes', () => {
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  // slow: 2 px a frame at the end, no flick
  drag(f, [290, 270, 250, 230, 300 - two.w * OPEN_AT - 4], 60)
  expect(f.up()).toBe('open')
  const g = new Finger(300, 300, 0, { left: two, rowW: ROW })
  drag(g, [295, 290, 285, 280, 275, 270], 60)
  expect(g.up()).toBe('back')
})

test('a pause before the lift is no flick: a finger held still sends no moves, so the lift’s time counts', () => {
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  drag(f, [290, 270, 250], 16)
  // the last move at 48 ms, let go 600 ms later
  expect(f.speed(648)).toBe(0)
  expect(f.up(648)).toBe('back')
  const g = new Finger(300, 300, 0, { left: two, rowW: ROW })
  drag(g, [290, 270, 250], 16)
  expect(g.up(60)).toBe('open')
})

test('at a high Zoom the full slide stays in reach, or the row has none (its actions still tap)', () => {
  for (const zoom of [1, 1.25, 1.5, 1.75, 2]) {
    const l = leftOf(2, true, ROW, zoom)!
    if (!l.full) continue
    expect(l.full).toBeLessThanOrEqual(Math.round(ROW * FULL_MAX))
    expect(l.full).toBeGreaterThan(l.w)
  }
  expect(leftOf(2, true, 300, 2)).toEqual({ w: 304, full: 0 })
})

test('a quick flick to the left opens it however short; one back to the right closes it', () => {
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  drag(f, [290, 270, 250], 16)
  expect(f.speed()).toBeLessThan(-0.3)
  expect(f.up()).toBe('open')
  // from open, a flick to the right
  const g = new Finger(200, 300, 0, { left: two, rowW: ROW, open: true })
  drag(g, [210, 230, 250], 16)
  expect(g.up()).toBe('back')
})

test('the speed is read over the last moments only: a pull held still before the let-go is no flick', () => {
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  drag(f, [280, 260, 240], 16)
  // then held still for half a second
  f.move(240, 300, 600)
  f.move(240, 300, 700)
  expect(f.speed()).toBe(0)
  expect(f.up()).toBe('back')
})

test('a full slide past its mark does the last action, with one tick as it crosses, and only a row that has one', () => {
  const f = new Finger(340, 300, 0, { left: two, rowW: ROW })
  const r = drag(f, [330, 300, 250, 340 - two.full - 1, 340 - two.full - 30])
  expect(r.crossed.filter(Boolean)).toHaveLength(1)
  expect(f.full).toBe(true)
  expect(f.up()).toBe('full')
  // back under the mark before letting go: no full action
  const g = new Finger(340, 300, 0, { left: two, rowW: ROW })
  drag(g, [330, 300, 340 - two.full - 10, 340 - two.full + 40], 60)
  expect(g.full).toBe(false)
  expect(g.up()).toBe('open')
  // a row with no full action stretches past its actions like a rubber band, never further
  const h = new Finger(340, 300, 0, { left: one, rowW: ROW })
  const s = drag(h, [330, 200, 40])
  expect(h.full).toBe(false)
  expect(s.slide).toBeGreaterThanOrEqual(-(one.w + 32))
  expect(s.slide).toBeLessThan(-one.w)
})

test('it follows the finger, and never past the row', () => {
  expect(slidLeft(-40, two, ROW)).toBe(-40)
  expect(slidLeft(20, two, ROW)).toBe(0)
  expect(slidLeft(-1000, two, ROW)).toBe(-ROW)
  expect(slidLeft(-one.w - 100, one, ROW)).toBeGreaterThan(-one.w - 100)
})

test('an open row slides back to its rest at most: never on into a reply', () => {
  const f = new Finger(200, 300, 0, { left: two, rowW: ROW, open: true })
  const r = drag(f, [220, 300, 400])
  expect(r.slide).toBe(0)
  expect(f.armed).toBe(false)
  expect(f.up()).toBe('back')
  // a tap on an open row is a tap (the hook closes it without opening the row)
  const g = new Finger(200, 300, 0, { left: two, rowW: ROW, open: true })
  g.move(202, 301, 30)
  expect(g.up()).toBe('tap')
})

test('right still replies on a row with actions; left with none is the page’s', () => {
  const f = new Finger(100, 300, 0, { left: two, rowW: ROW })
  drag(f, [120, 140, 100 + REPLY_AT + 10])
  expect(f.up()).toBe('reply')
  expect(wayOf(-30, 2)).toBe('scroll')
  expect(wayOf(-30, 2, true)).toBe('slide')
  const g = new Finger(300, 300, 0)
  expect(g.move(200, 300, 16).slide).toBe(0)
  expect(g.up()).toBe('none')
})

test('it locks to sideways first: up and down from a row with actions scrolls the list', () => {
  expect(wayOf(-10, 40, true)).toBe('scroll')
  expect(wayOf(-20, 18, true)).toBe('scroll')
  expect(wayOf(-4, 3, true)).toBe('undecided')
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  f.move(296, 260, 16)
  // once it scrolls, going sideways later doesn't take it over
  expect(f.move(150, 260, 32).slide).toBe(0)
  expect(f.up()).toBe('none')
})

test("never from the screen's left edge strip: that opens the spaces list", () => {
  const f = new Finger(EDGE_PX - 2, 300, 0, { left: two, rowW: ROW })
  expect(f.move(EDGE_PX - 60, 300, 16).slide).toBe(0)
  expect(f.move(EDGE_PX + 120, 300, 32).slide).toBe(0)
  expect(f.up()).toBe('none')
})

test('a cancelled pointer (the browser took it) puts the row back where it rested', () => {
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  drag(f, [290, 250])
  expect(f.cancel()).toBe('back')
  const g = new Finger(200, 300, 0, { left: two, rowW: ROW, open: true })
  drag(g, [220, 260])
  expect(g.cancel()).toBe('open')
  // a finger that never slid leaves nothing to put back
  expect(new Finger(200, 300, 0, { left: two, rowW: ROW }).cancel()).toBe('none')
})

test('a long press is a hold: moving after it never slides the row', () => {
  const f = new Finger(300, 300, 0, { left: two, rowW: ROW })
  expect(f.hold(HOLD_MS)).toBe(true)
  expect(f.move(100, 300, HOLD_MS + 20).slide).toBe(0)
  expect(f.up()).toBe('hold')
  // a press that went sideways first is no hold
  const g = new Finger(300, 300, 0, { left: two, rowW: ROW })
  g.move(270, 300, 30)
  expect(g.hold(HOLD_MS + 10)).toBe(false)
})

test('the hook: one row open, a second one’s touch puts it away, a scroll and Escape too; Reduced lands at once', () => {
  // the React side has no DOM here: the seams it keeps are pinned in its source, and the browser run proves them
  const src = readFileSync(new URL('./slide.tsx', import.meta.url), 'utf8')
  // one row open at a time: opening one shuts the last, a pointerdown outside it (another row) puts it away
  expect(src).toContain('if (shut && shut !== put) shut()')
  expect(src).toMatch(/addEventListener\('pointerdown', away, true\)/)
  expect(src).toMatch(/e\.key === 'Escape' && put\(\)/)
  // a scroll from an open row puts its actions away
  expect(src).toMatch(/if \(f\.way === 'scroll'\) \{[\s\S]*?if \(open\) close\(\)/)
  // with less motion nothing springs (calm(), both switches), and the haptic tick is off
  expect(src).toContain('const settle = () => setSettling(!calm())')
  expect(src).toMatch(/export const tick = \(ms = 8\) => \{\s*if \(calm\(\)\) return/)
  // a mouse never slides; a second finger is ignored
  expect(src).toContain("e.pointerType === 'mouse' || !e.isPrimary")
  // only the pointer that started it moves, ends or cancels it (a mouse's lift can't finish a finger's Archive), and a
  // lost capture is a cancel
  expect(src.match(/e\.pointerId !== pid\.current/g)?.length).toBe(3)
  expect(src).toContain('onLostPointerCapture: (e: RPE<HTMLElement>) => e.target === e.currentTarget && cancel(e)')
  // a cancel makes no click: nothing is skipped, and a cancelled hold's click eater goes
  expect(src).toMatch(/if \(o === 'back'\) close\(\)/)
  expect(src).toContain("addEventListener('pointercancel', lifted, true)")
  // React's Strict Mode runs the cleanup and the setup again: the row is alive again after it
  expect(src).toMatch(/useLayoutEffect\(\(\) => \{\s*alive\.current = true/)
  // focus on an action goes back to the row as they close; Archiving… is said; the row behind is inert meanwhile
  expect(src).toContain("el.querySelector('.sla')?.contains(at)")
  expect(src).toContain('role="status"')
  expect(src).toContain('inert: busy || undefined')
  // a wheel or keys scrolling the list put it away; actions gone while it is out put it back
  expect(src).toContain("addEventListener('scroll', scrolled, true)")
  expect(src).toMatch(/if \(!now && !busy && \(open \|\| slide < 0\)\) close\(\)/)
})
