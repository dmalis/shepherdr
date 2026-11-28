import { expect, test } from 'bun:test'
import { IMAGE, join, keptOnError, parentOf, sizeWords } from './paths.ts'

test('paths inside a space folder, and sizes in words', () => {
  expect(join('', 'a')).toBe('a')
  expect(join('a/b', 'c')).toBe('a/b/c')
  expect(parentOf('a')).toBe('')
  expect(parentOf('a/b/c')).toBe('a/b')
  expect(IMAGE.test('x/shot.PNG')).toBe(true)
  expect(IMAGE.test('notes.md')).toBe(false)
  expect(sizeWords(12)).toBe('12 B')
  expect(sizeWords(2048)).toBe('2 KB')
  expect(sizeWords(3.5 * 1024 * 1024)).toBe('3.5 MB')
})

test('a refresh that fails keeps the folder shown, with the error and when it came; a first failure is the error', () => {
  type D = { entries?: { name: string }[]; error?: string; at?: number }
  const ok = keptOnError<D>(undefined, { entries: [{ name: 'a' }] }, 100)
  expect(ok).toEqual({ entries: [{ name: 'a' }], at: 100 })
  expect(keptOnError<D>(ok, { error: 'gone' }, 200)).toEqual({ entries: [{ name: 'a' }], at: 100, error: 'gone' })
  expect(keptOnError<D>(undefined, { error: 'gone' }, 200)).toEqual({ error: 'gone' })
  // a good answer again clears the error
  expect(keptOnError<D>({ entries: [], at: 1, error: 'x' }, { entries: [] }, 300)).toEqual({ entries: [], at: 300 })
})
