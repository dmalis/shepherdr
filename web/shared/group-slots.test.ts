// Fork patch #31 (Sidebar: move a space above groups): a machine's groups and its spaces in no group in one order.
import { expect, test } from 'bun:test'
import type { Place, Snapshot } from './types.ts'
import { inSlots, slottedSpaces } from './group-slots.ts'
import { listOf } from './view.ts'

const place = (id: string, x = {}) => ({ id, name: id, machine: 'mini', level: 0 as const, status: 'idle' as const, mode: 'regular' as const, chat: id, ...x }) as Place
const a = place('a'), b = place('b'), c = place('c')
const names = (items: ReturnType<typeof inSlots<{ id: string; after?: string[] }>>) => items.map((x) => (x.group ? x.group.id : x.space.id))

test('nobody dragged a group among the spaces: groups first, as before', () => {
  expect(names(inSlots([{ id: 'G1' }, { id: 'G2' }], [a, b]))).toEqual(['G1', 'G2', 'a', 'b'])
})

test('a group goes right after the last loose space kept above it; none kept: at the top', () => {
  expect(names(inSlots([{ id: 'G1', after: [] }, { id: 'G2', after: ['a', 'b'] }], [a, b, c]))).toEqual(['G1', 'a', 'b', 'G2', 'c'])
  expect(names(inSlots([{ id: 'G1', after: ['a'] }, { id: 'G2', after: ['a'] }], [a, b]))).toEqual(['a', 'G1', 'G2', 'b'])
})

test('a group with none kept (new since) goes where the group before it went', () => {
  expect(names(inSlots([{ id: 'G1', after: ['a', 'b'] }, { id: 'G2' }], [a, b, c]))).toEqual(['a', 'b', 'G1', 'G2', 'c'])
})

test('the space it followed is gone, grouped or hidden: it follows the one before that, or goes to the top', () => {
  expect(names(inSlots([{ id: 'G1', after: ['a', 'gone'] }], [a, b]))).toEqual(['a', 'G1', 'b'])
  expect(names(inSlots([{ id: 'G1', after: ['gone'] }], [a, b]))).toEqual(['G1', 'a', 'b'])
  // the spaces keep their own order: the group follows the one it was below, wherever that is now
  expect(names(inSlots([{ id: 'G1', after: ['a'] }], [b, a]))).toEqual(['b', 'a', 'G1'])
})

test("listOf gives the machine's groups and loose spaces in one order; the spaces as they show follow it", () => {
  const snap = {
    host: 'mini', everything: 'home', places: [place('home', { home: true }), a, b, c], machines: [{ id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle' }],
    sections: [{ id: 's:g1', name: 'One', machine: 'mini', spaces: ['b'], after: ['a'] }, { id: 's:g2', name: 'Two', machine: 'mini', spaces: [] }],
  } as unknown as Snapshot
  const [m] = listOf(snap, 'Active')
  expect(m.items.map((x) => (x.group ? x.group.id : x.space.id))).toEqual(['a', 's:g1', 's:g2', 'c'])
  expect(slottedSpaces(m.items).map((p) => p.id)).toEqual(['a', 'b', 'c'])
  // the archived view lists spaces only, as before
  expect(listOf(snap, 'Archived')[0].items).toEqual([])
})
