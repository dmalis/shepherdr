// fork #134: web/demo/phone-box-check.ts types into a phone's message box in a real browser on every pull request.
// It finds the box, the keyboard and what is sent through the seams below; if one moves, the check would wait on
// something that never comes, or measure the wrong thing. These pin them, so a sync sees the break at once.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { keyboardWatch } from '@client/viewport.ts'
import { TYPING } from '../plugins/typing/typing.ts'

const root = new URL('../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const check = read('web/demo/phone-box-check.ts')
const box = read('web/plugins/chat/client.tsx')

test('the check finds the box as the chat draws it: the text row, then the bar, its round button Send or Stop', () => {
  expect(check).toContain(`'.cbox:has(> .crow + .cbar) >> visible=true'`)
  const at = box.indexOf('className="cbox"')
  expect(at).toBeGreaterThan(-1)
  const row = box.indexOf('<div className="crow">', at)
  const bar = box.indexOf('<div className="cbar">', row)
  expect(row).toBeGreaterThan(at)
  expect(bar).toBeGreaterThan(row)
  expect(box.slice(row, bar)).toContain("className={cx('cin', mode && 'mono')}")
  expect(box.slice(row, bar)).toContain('<textarea')
  const end = box.slice(bar)
  expect(end).toContain('<button type="button" className="send" aria-label="Stop"')
  expect(end).toContain('<button type="button" className="send" aria-label="Send"')
  // + is the bar's first button (.ib), the model line its .agent with the model's name in .m
  expect(end.indexOf('<AddButtons')).toBeLessThan(end.indexOf('<AgentLine'))
})

test('an on-screen keyboard is the page shrinking by more than 150px while the box has focus, marked kb-up', () => {
  // the check shrinks the page by KEYBOARD and waits for <html>'s mark
  expect(check).toContain('const KEYBOARD = 336')
  expect(check).toContain(`classList.contains('kb-up')`)
  expect(TYPING).toBe('kb-up')
  const up = keyboardWatch()
  expect(up(390, 844)).toBe(false)
  expect(up(390, 844 - 336)).toBe(true)
  expect(up(390, 844)).toBe(false)
})

test('what the box sends goes to /api/action as a send with its text, which the check reads', () => {
  expect(read('web/src/kernel.ts')).toContain("fetch('api/action', { method: 'POST'")
  expect(read('web/src/send.ts')).toContain("const sendOf = (o: Outgoing) => ({ type: 'send', chat: o.chat, text: o.text,")
})

test('it runs in GitHub’s Check on every pull request, and docs/develop.md says how to run it', () => {
  expect(read('.github/workflows/check.yml')).toContain('run: bun web/demo/phone-box-check.ts')
  expect(read('docs/develop.md')).toContain('bun web/demo/phone-box-check.ts')
})
