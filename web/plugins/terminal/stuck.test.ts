// dmalis/shepherdr#132, slice 10: "Waiting at a prompt" leads with its words, and several fold into one banner
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { promptLabels, stuckWords } from './stuck.ts'

test('one prompt says why first, then what waits (a long name is cut, never the why)', () => {
  expect(stuckWords([{ key: 'own' }])).toBe('Waiting at a prompt')
  expect(stuckWords([{ key: 'SHOP-15', task: 'Bigger checkout button on phones' }])).toBe('Waiting at a prompt · Bigger checkout button on phones')
})

test('several fold into one line that counts them', () => {
  const a = { key: 'A', task: 'Fix login' }, b = { key: 'B', task: 'Faster search' }
  expect(stuckWords([a, b])).toBe('2 tasks are waiting at a prompt')
  expect(stuckWords([{ key: 'own' }, a])).toBe('This chat and 1 task are waiting at a prompt')
  expect(stuckWords([{ key: 'own' }, a, b])).toBe('This chat and 2 tasks are waiting at a prompt')
})

test('the folded list names each one, this chat first', () => {
  expect(promptLabels([{ key: 'own' }, { key: 'A', id: 'A', task: 'Fix login' }])).toEqual(['This chat', 'Fix login'])
  // two tasks of one name (Everything holds every space's) are told apart by their ids
  expect(promptLabels([{ key: 'A', id: 'SHOP-4', task: 'Fix login' }, { key: 'B', id: 'BLOG-2', task: 'Fix login' }, { key: 'C', id: 'C', task: 'Faster search' }])).toEqual(['Fix login · SHOP-4', 'Fix login · BLOG-2', 'Faster search'])
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
