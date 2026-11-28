// dmalis/shepherdr#132, slice 10: "Waiting at a prompt" leads with its words, and several fold into one banner
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { promptLabel, stuckWords } from './stuck.ts'

test('one prompt names what waits, whole', () => {
  expect(stuckWords([{ key: 'own' }])).toBe('Waiting at a prompt')
  expect(stuckWords([{ key: 'SHOP-15', task: 'Bigger checkout button on phones' }])).toBe('Bigger checkout button on phones is waiting at a prompt')
})

test('several fold into one line that counts them', () => {
  const a = { key: 'A', task: 'Fix login' }, b = { key: 'B', task: 'Faster search' }
  expect(stuckWords([a, b])).toBe('2 tasks are waiting at a prompt')
  expect(stuckWords([{ key: 'own' }, a])).toBe('This chat and 1 task are waiting at a prompt')
  expect(stuckWords([{ key: 'own' }, a, b])).toBe('This chat and 2 tasks are waiting at a prompt')
})

test('the folded list names each one, this chat first', () => {
  expect([{ key: 'own' }, { key: 'A', task: 'Fix login' }].map(promptLabel)).toEqual(['This chat', 'Fix login'])
})

test('the chat draws one banner whose button lists each prompt, never one banner each', () => {
  const src = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
  const stuck = src.slice(src.indexOf('function Stuck('), src.indexOf('export default definePlugin'))
  expect(stuck.match(/className="banner"/g)).toHaveLength(1)
  expect(stuck).toContain('stuckWords(waits)')
  expect(stuck).toContain('aria-haspopup="menu"')
  // its place in the chat comes from the chat's rhythm (rhythm.css), not a margin of its own
  expect(stuck).not.toContain('style=')
})
