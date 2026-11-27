// fork #86: while a phone's keyboard is up the chat gets the room. <html> carries kb-up in the same step the UI's
// `keyboard` turns on, keeps it until the keyboard has finished going down, and typing.css steps the bottom tabs, the
// header's second line and the notes on top aside, only where a finger is the pointer. The upstream seams this leans
// on are pinned below, so a sync sees a break at once.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getState, setUI, subscribe } from '@client/kernel.ts'
import { markTyping, TYPING, withAfter } from './typing.ts'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const css = read('web/plugins/typing/typing.css')

function fakeRoot() {
  const on = new Set<string>()
  const calls: boolean[] = []
  return { on, calls, classList: { toggle: (c: string, v: boolean) => (calls.push(v), v ? on.add(c) : on.delete(c)) } }
}

/** a visual viewport and a clock the test moves by hand */
function fakePhone(height: number) {
  const fs = new Set<() => void>()
  let now = 0
  let n = 0
  const due = new Map<number, { at: number; f: () => void }>()
  const vv = {
    width: 390,
    height,
    addEventListener: (_: 'resize', f: () => void) => void fs.add(f),
    removeEventListener: (_: 'resize', f: () => void) => void fs.delete(f),
  }
  const timers = {
    set: (f: () => void, ms: number) => (due.set(++n, { at: now + ms, f }), n),
    clear: (t: unknown) => void due.delete(t as number),
  }
  const resize = (h: number, w = vv.width) => ((vv.width = w), (vv.height = h), [...fs].forEach((f) => f()))
  const pass = (ms: number) => {
    const until = now + ms
    for (;;) {
      const next = [...due.entries()].filter(([, d]) => d.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      due.delete(next[0])
      now = next[1].at
      next[1].f()
    }
    now = until
  }
  return { vv, timers, resize, pass }
}

test('the mark goes on in the same step as the keyboard (before the frame is drawn)', () => {
  const r = fakeRoot()
  setUI({ keyboard: false })
  const stop = markTyping(r, () => getState().ui.keyboard, subscribe)
  expect(r.on.has(TYPING)).toBe(false)
  setUI({ keyboard: true })
  expect(r.on.has(TYPING)).toBe(true)
  // no viewport to watch: it goes as the keyboard does
  setUI({ keyboard: false })
  expect(r.on.has(TYPING)).toBe(false)
  stop()
  setUI({ keyboard: true })
  expect(r.on.has(TYPING)).toBe(false)
  setUI({ keyboard: false })
})

test('other changes to the state touch nothing', () => {
  const r = fakeRoot()
  let up = true
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}))
  tell()
  tell()
  expect(r.calls).toEqual([true])
  up = false
  tell()
  expect(r.calls).toEqual([true, false])
})

test('the box loses focus while the keyboard is still sliding away: the tabs wait until it is down', () => {
  const r = fakeRoot()
  const p = fakePhone(844)
  let up = false
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}), p.vv, p.timers)
  p.resize(508)
  up = true
  tell()
  expect(r.on.has(TYPING)).toBe(true)
  // a tap outside: the box blurs first, the visible part is still short
  up = false
  tell()
  p.pass(400)
  expect(r.on.has(TYPING)).toBe(true)
  // the keyboard reports its way down in steps (695 is within a keyboard of the full height already)
  p.resize(695)
  p.pass(100)
  expect(r.on.has(TYPING)).toBe(true)
  // the height back: the tabs come back in that same resize, never a frame without them first
  p.resize(844)
  expect(r.on.has(TYPING)).toBe(false)
  expect(r.calls).toEqual([true, false])
})

test('a browser bar that comes back shorter: the tabs come back once the height is still', () => {
  const r = fakeRoot()
  const p = fakePhone(844)
  let up = true
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}), p.vv, p.timers)
  p.resize(508)
  up = false
  tell()
  p.resize(720)
  p.pass(149)
  expect(r.on.has(TYPING)).toBe(true)
  p.pass(1)
  expect(r.on.has(TYPING)).toBe(false)
})

test('turned while typing and back: the other way up never lets go early', () => {
  const r = fakeRoot()
  const p = fakePhone(844)
  let up = false
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}), p.vv, p.timers)
  p.resize(390, 844)
  p.resize(844, 390)
  p.resize(508)
  up = true
  tell()
  // turned with the keyboard up, then back
  p.resize(190, 844)
  p.resize(508, 390)
  up = false
  tell()
  p.pass(500)
  expect(r.on.has(TYPING)).toBe(true)
  p.resize(844)
  expect(r.on.has(TYPING)).toBe(false)
})

test('the keyboard closed by height with the focus kept (Android back): it goes in that resize', () => {
  const r = fakeRoot()
  const p = fakePhone(844)
  let up = true
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}), p.vv, p.timers)
  p.resize(508)
  p.resize(844)
  up = false
  tell()
  expect(r.on.has(TYPING)).toBe(false)
  // and it opens again as before
  up = true
  tell()
  expect(r.on.has(TYPING)).toBe(true)
})

test('typing again before the keyboard is down keeps the mark; one that never reports its way down lets go', () => {
  const r = fakeRoot()
  const p = fakePhone(844)
  let up = false
  let tell = () => {}
  markTyping(r, () => up, (f) => ((tell = f), () => {}), p.vv, p.timers)
  p.resize(508)
  up = true
  tell()
  up = false
  tell()
  p.pass(200)
  up = true
  tell()
  p.pass(2000)
  expect(r.on.has(TYPING)).toBe(true)
  expect(r.calls).toEqual([true])
  // the focus leaves and no resize ever comes
  up = false
  tell()
  p.pass(999)
  expect(r.on.has(TYPING)).toBe(true)
  p.pass(1)
  expect(r.on.has(TYPING)).toBe(false)
})

test('only where a finger is the pointer, and only with the mark: a desktop window never loses its tabs', () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const open = rules.indexOf('@media (pointer: coarse) {')
  expect(open).toBeGreaterThan(-1)
  // every rule sits inside the one coarse-pointer block, and every selector needs the mark
  expect(rules.slice(0, open).trim()).toBe('')
  const selectors = [...rules.slice(open + 26).matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim())
  expect(selectors.length).toBeGreaterThan(5)
  for (const s of selectors) expect(s.startsWith(`.${TYPING} .app`) || s.startsWith(`html.${TYPING} .app`)).toBe(true)
})

test('what steps aside: the tabs, the bands, the folder and the model line, a task line, the notes on top', () => {
  expect(css).toContain('.kb-up .app.phone .bar {\n    display: none;')
  expect(css).toContain('.kb-up .app:not(.phone) .device {\n    padding-bottom: 0;')
  // the box right on the keyboard, in a chat and in a pane
  expect(css).toContain('.kb-up .app :is(.chat, .pane) > .foot {\n    padding-bottom: 8px;')
  // every layout's headers (a phone turned and a tablet too), above .app.phone's own height
  expect(css).toContain('html.kb-up .app {\n    --hd: 44px;')
  // the chat's folder and model line, a task's status line; never another pane's (an artifact's version)
  expect(css).toContain('.kb-up .app .col > .hd :is(.chat-heading > .t2, .ttl > .hpath, .ttl > .t2:has(> .hline))')
  expect(read('web/plugins/tasks/client.tsx')).toContain('<span className="hline">')
  expect(css).toContain('.kb-up .app :is(.anote, .upchip)')
  // the offline line (.tline) stays: it says why a message waits
  expect(css).not.toContain('.tline')
})

test('upstream seams: the keyboard state, the bar, the header lines, the bands and the notes', () => {
  // viewport.ts reports the keyboard into the UI's `keyboard`
  expect(read('web/src/main.tsx')).toContain('watchViewport((up) => setUI({ keyboard: up }))')
  expect(read('web/src/kernel.ts')).toContain('keyboard: boolean')
  expect(read('web/src/viewport.ts')).toContain("document.activeElement?.matches('input, textarea, [contenteditable]')")
  // the phone's bottom bar, and the chat header's folder and second line
  const app = read('web/src/App.tsx')
  expect(app).toContain('<nav className="bar" aria-label="Views">')
  expect(app).toContain('{ui.phone && <Bar snap={snap} />}')
  expect(app).toContain('<div className="chat-heading">')
  expect(app).toContain('<HeaderPath snap={snap} place={place} />')
  expect(app).toContain('<span className="t2">')
  expect(read('web/src/where.tsx')).toContain('className="hpath"')
  expect(read('web/src/ui.tsx')).toContain('{sub != null && sub !== \'\' && <span className="t2">{sub}</span>}')
  // the headers' height, set again for a phone; the box's margin under it
  expect(read('web/src/ds.css')).toContain('.app.phone{--hd:52px;')
  expect(read('web/src/ds.css')).toContain('.chat>.foot,.pane>.foot{padding-bottom:12px}')
  // viewport.ts's line between a keyboard and a browser bar, which typing.ts uses as well
  expect(read('web/src/viewport.ts')).toContain('const KEYBOARD = 150')
  // the bands for the home indicator that the keyboard covers
  expect(read('web/src/ds.css')).toContain('.bar{padding-bottom:calc(12px + env(safe-area-inset-bottom))}')
  expect(read('web/src/styles.css')).toContain('.app:not(.phone) .device{padding-bottom:env(safe-area-inset-bottom)}')
  // the notes that wait
  expect(read('web/plugins/analytics/client.tsx')).toContain('<div className="anote" role="status">')
  expect(read('web/src/update-chip.tsx')).toContain('className="upchip"')
  // the plugin is in the list
  expect(JSON.parse(read('web/plugins.json')).plugins).toContain('typing')
})

// fork #105: less chrome while typing on a phone. The message box is one row (+, the text, the microphone and send),
// its model and effort line stepping aside until the keyboard closes, and the suggested replies step aside once you
// type. Its text area is fitted to its new width each time the mark changes.

const ONE_ROW = '.kb-up .app .cbox:has(> .crow + .cbar):not(:has(> .cbar > :is(.dsurf, .vin)))'

test('the message box is one row while typing: + first, then the text, then the rest; the agent line steps aside', () => {
  expect(css).toContain(`${ONE_ROW} {\n    display: flex;\n    flex-wrap: wrap;\n    align-items: flex-end;`)
  // the bar's buttons join the box's row
  expect(css).toContain(`${ONE_ROW} > .cbar {\n    display: contents;`)
  expect(css).toContain(`${ONE_ROW} > .crow {\n    flex: 1 1 0;\n    order: 2;`)
  expect(css).toContain(`${ONE_ROW} > .cbar > :first-child {\n    order: 1;`)
  expect(css).toContain(`${ONE_ROW} > .cbar > * {\n    order: 3;`)
  // the model and effort line, the update hint and the spacer go; the + and the round button stay
  expect(css).toContain(`${ONE_ROW} > .cbar > :is(.agent, .agent-upd, .sp) {\n    display: none;`)
  // chips over the box (a reply, files, a paste, a command's mode) keep their whole rows
  expect(css).toContain(`${ONE_ROW} > * {\n    flex: 0 0 100%;`)
})

test('suggested replies step aside once there is text in the box, only while typing', () => {
  expect(css).toContain('.kb-up .app .foot:has(.cin:not(:placeholder-shown)) > .sugs {\n    display: none;')
})

test('each change of the mark fits the box again, in the same step', () => {
  const r = fakeRoot()
  const after: boolean[] = []
  const root = withAfter(r, () => after.push(r.on.has(TYPING)))
  const off = markTyping(root, () => getState().ui.keyboard, subscribe)
  setUI({ keyboard: true })
  // fitted after the mark went on, so it reads the new width
  expect(after).toEqual([true])
  setUI({ keyboard: false })
  expect(after).toEqual([true, false])
  off()
})

test('upstream seams of the one-row box: its parts, the replies, dictation, the box fitting and its label', () => {
  const box = read('web/plugins/chat/client.tsx')
  // the box: its text row, then its bar with + first, the agent line, the update hint, a spacer, then the buttons
  expect(box).toContain('<div className="crow">')
  expect(box).toContain('<div className="cbar">\n        <AddButtons finger={finger} onFiles={(f) => attach(key, key, f)} />\n        <AgentLine')
  expect(box).toContain('<UpdateHint chat={chat} />\n        <span className="sp" />')
  expect(box).toContain('<button type="button" className="send" aria-label="Send"')
  expect(box).toContain('<div className="sugs" ref={row} role="group" aria-label="Suggested replies">')
  expect(box).toContain('placeholder={hint}')
  expect(read('web/src/ui.tsx')).toContain('export function IB(')
  expect(box).toContain('<IB icon="plus" label={finger ? \'Add\' : \'Add files\'} onClick={plus} />')
  expect(read('web/src/picker.tsx')).toContain('<button ref={ref} type="button" className="agent"')
  expect(read('web/plugins/chat/update.tsx')).toContain('className="agent-upd"')
  // dictation takes over the bar with its own surface: the box keeps its two rows then
  const dictate = read('web/src/dictate.css')
  expect(dictate).toContain('.cbar:has(>.dsurf)>:not(.dsurf,.vs){display:none}')
  expect(dictate).toContain('.cbar:has(>.vin)>:not(.vin,.vs){display:none}')
  // the box's height follows its text only as it changes; the plugin fits it again when its width changes
  expect(read('web/src/grow.ts')).toContain('export function fitBox(t: HTMLTextAreaElement)')
  expect(read('web/plugins/typing/client.tsx')).toContain("querySelectorAll<HTMLTextAreaElement>('.cbox > .crow > textarea.cin').forEach(fitBox)")
})
