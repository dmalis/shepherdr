// fork #117: a swipe in from the left edge opens the spaces list (edge-swipe.tsx). The gesture itself is proved with
// emulated touches in a real browser; here, its rules and the upstream seams it stands on.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getState, type UI } from './kernel.ts'
import { claims, EDGE, edgeOpens, speed, staysOpen, wayOf } from './edge-swipe.tsx'
import { EDGE_PX } from '../plugins/chat/press.ts'
import { calm, lands, settleMs } from './motion.ts'

const ui = (o: Partial<UI>): UI => ({ ...getState().ui, phone: true, narrow: true, drawer: false, settings: null, search: false, task: null, art: null, pane: null, sideOff: false, ...o })
const BAR = ['tasks', 'artifacts']

test('on a phone, the screens at the top open the list from the edge: a chat and the bar tabs', () => {
  expect(edgeOpens(ui({}), BAR)).toBe(true)
  expect(edgeOpens(ui({ pane: 'tasks' }), BAR)).toBe(true)
  expect(edgeOpens(ui({ pane: 'artifacts' }), BAR)).toBe(true)
})

test('on a phone, a pushed screen keeps the edge for the system Back: a task, an artifact, a terminal, Settings, Search', () => {
  expect(edgeOpens(ui({ pane: 'tasks', task: 'SHOP-2' }), BAR)).toBe(false)
  expect(edgeOpens(ui({ pane: 'artifacts', art: 'a1' }), BAR)).toBe(false)
  expect(edgeOpens(ui({ pane: 'screen' }), BAR)).toBe(false)
  expect(edgeOpens(ui({ settings: { scope: 'all', sec: null } }), BAR)).toBe(false)
  expect(edgeOpens(ui({ search: true }), BAR)).toBe(false)
  // and the list already open: nothing more to open
  expect(edgeOpens(ui({ drawer: true }), BAR)).toBe(false)
})

test('on a tablet, only while the list is hidden: by its own button, or a narrow window with a pane open', () => {
  const tablet = { phone: false }
  expect(edgeOpens(ui({ ...tablet, narrow: false }), BAR)).toBe(false)
  expect(edgeOpens(ui({ ...tablet, narrow: true }), BAR)).toBe(false)
  expect(edgeOpens(ui({ ...tablet, narrow: true, pane: 'tasks', task: 'SHOP-2' }), BAR)).toBe(true)
  expect(edgeOpens(ui({ ...tablet, narrow: false, sideOff: true }), BAR)).toBe(true)
  expect(edgeOpens(ui({ ...tablet, narrow: false, sideOff: true, settings: { scope: 'all', sec: null } }), BAR)).toBe(false)
})

test('only iOS holds a touch at the edge back from the page (its Back); elsewhere the page keeps its scroll', () => {
  const chat = ui({})
  expect(claims(4, null, chat, true)).toBe('hold')
  expect(claims(4, null, chat, false)).toBe('swipe')
  expect(claims(EDGE - 1, null, chat, true)).toBe('hold')
  expect(claims(EDGE, null, chat, true)).toBe(null)
  expect(claims(4, null, ui({ pane: 'tasks', task: 'SHOP-2' }), true)).toBe(null)
})

test('the way a finger goes: right opens, left shuts, mostly up or down is the page’s scroll', () => {
  expect(wayOf(3, 2, 1)).toBe('wait')
  expect(wayOf(20, 5, 1)).toBe('go')
  expect(wayOf(-20, 5, 1)).toBe('off')
  expect(wayOf(8, 30, 1)).toBe('off')
  expect(wayOf(-20, 5, -1)).toBe('go')
  expect(wayOf(20, 5, -1)).toBe('off')
})

test('the let-go speed is over the last 100 ms only, so a pull held still is no flick', () => {
  const samples = [{ t: 0, x: 0 }, { t: 50, x: 100 }, { t: 400, x: 150 }]
  expect(speed(samples, { t: 450, x: 160 })).toBeCloseTo(10 / 50)
  expect(speed([{ t: 0, x: 0 }], { t: 50, x: 100 })).toBe(2)
  expect(speed([], { t: 50, x: 100 })).toBe(0)
})

test('a let-go lands as iOS drawers do: a flick goes its way, a slow one past half stays open', () => {
  const w = 320
  expect(staysOpen(60, 0.8, w)).toBe(true)
  expect(staysOpen(280, -0.8, w)).toBe(false)
  expect(staysOpen(200, 0, w)).toBe(true)
  expect(staysOpen(120, 0, w)).toBe(false)
  // carried: a gentle push past the middle still opens
  expect(staysOpen(130, 0.2, w)).toBe(true)
})

// the seams this stands on: a change upstream shows here first

test('the edge strip is the same one slide to reply leaves alone', () => {
  expect(EDGE_PX).toBe(EDGE)
})

test("motion.ts's fling rules are still there, as this uses them", () => {
  expect(lands(10, 0.5, 100)).toBe(true)
  expect(lands(90, -0.5, 100)).toBe(false)
  expect(settleMs(300, 0)).toBeGreaterThan(0)
  expect(typeof calm()).toBe('boolean')
})

test('the app shows the list with SideDrawer while the side is hidden, and listens for the swipe', () => {
  const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
  expect(app).toContain('useEffect(() => edgeSwipe(), [])')
  expect(app).toContain('{(ui.drawer || peek) && hidden && (\n            <SideDrawer>')
  const kernel = readFileSync(new URL('./kernel.ts', import.meta.url), 'utf8')
  // the open list is a step in the history, so Android's Back closes it
  expect(kernel).toMatch(/const STEPS: \(keyof UI\)\[\] = \[[^\]]*'drawer'/)
  expect(kernel).toContain('export const sideHidden = (ui: UI) => ui.phone || ui.sideOff || (ui.narrow && !!ui.pane)')
  // the floating list catches its "Hide the list" by its label, so it hides the floating list, not the docked one
  const list = readFileSync(new URL('./list.tsx', import.meta.url), 'utf8')
  expect(list).toContain('<IB icon="panel" label="Hide the list" onClick={() => setUI({ sideOff: true })} />')
})
