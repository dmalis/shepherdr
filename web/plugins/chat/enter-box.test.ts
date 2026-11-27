// fork #118: on a phone's on-screen keyboard Return makes a new line in the message box and the send button sends, as
// iMessage, WhatsApp, Telegram and Slack do; a hardware keyboard (a computer, an iPad's) still sends on Enter. The rule
// is upstream's own (web/src/enter.ts, its tests in enter.test.ts); the 3.2.0 web app stopped calling it. These pin the
// box to it, and the rule by kind of input as the box calls it.
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { enterHint, sendsNow } from '@client/enter.ts'

const box = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')

/** a device: a mouse or trackpad anywhere (fine), a finger (coarse) */
function device(fine: boolean, coarse: boolean) {
  globalThis.matchMedia = ((q: string) => ({ matches: q === '(any-pointer: fine)' ? fine : q === '(any-pointer: coarse)' ? coarse : false })) as typeof matchMedia
}
const real = globalThis.matchMedia
afterEach(() => (globalThis.matchMedia = real))

/** a key event as React hands it to the box */
const key = (k: { shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {}) => ({
  key: 'Enter',
  shiftKey: !!k.shiftKey,
  nativeEvent: { isComposing: !!k.isComposing, keyCode: k.keyCode ?? 13 } as KeyboardEvent,
})

test('the box asks upstream’s rule what Enter does and what its return key reads', () => {
  const at = box.indexOf('<div className="crow">')
  const row = box.slice(at, box.indexOf('<div className="cbar">', at))
  expect(row).toContain('enterKeyHint={enterHint()}')
  expect(row).toContain('if (sendsNow(e, getState().ui.keyboard)) {\n              e.preventDefault()\n              go(e.ctrlKey || e.metaKey)')
  // the # and / lists still take Enter first
  expect(row.indexOf('if (ment.onKey(e)) return')).toBeLessThan(row.indexOf('sendsNow('))
  expect(row.indexOf('if (slash.onKey(e)) return')).toBeLessThan(row.indexOf('sendsNow('))
  expect(box).toContain("import { enterHint, sendsNow } from '@client/enter.ts'")
})

test('a phone typing on its on-screen keyboard: Return makes a new line, the key reads return', () => {
  device(false, true)
  expect(sendsNow(key(), true)).toBe(false)
  expect(enterHint()).toBe('enter')
})

test('a touch device on a hardware keyboard (an iPad’s, no on-screen keyboard up): Enter sends', () => {
  device(false, true)
  expect(sendsNow(key(), false)).toBe(true)
  expect(sendsNow(key({ shiftKey: true }), false)).toBe(false)
})

test('a computer, at any width, even with the keyboard state on: Enter sends, Shift+Enter a new line', () => {
  device(true, false)
  expect(sendsNow(key(), false)).toBe(true)
  expect(sendsNow(key(), true)).toBe(true)
  expect(sendsNow(key({ shiftKey: true }), false)).toBe(false)
  expect(enterHint()).toBe('send')
})

test('a word still being composed (an IME, a phone’s autocorrect) never sends', () => {
  device(true, false)
  expect(sendsNow(key({ isComposing: true }), false)).toBe(false)
  expect(sendsNow(key({ keyCode: 229 }), false)).toBe(false)
})
