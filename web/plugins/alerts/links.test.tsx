// fork Needs you 4/6, exact links: a tap names its action and opens its live card, or says what came of it once it
// closed; an old link opens what it always did; an alert sent while the app is on screen is said once, unless its card
// is already on screen or this device hears nothing of its kind. Pins what it builds on: the kernel's visibleChats
// and openLink's link keys, the projection's action ids (web/shared/attention.ts).
import { expect, test } from 'bun:test'
import type { Snapshot } from '@shared/types.ts'
import { withAttention } from '@shared/attention.ts'
import { actionOfUrl, actionUrl, openAction, outcomeWords, settled } from '@shared/action-link.ts'
import { OFF } from '@shared/reach.ts'

const { resolveTap, heard, cardOnScreen, WAIT_MS } = await import('./links.tsx')

const T0 = 1_800_000_000_000
const q = { id: 'q1', kind: 'Question', title: 'Deploy now?', choices: [{ label: 'Yes' }, { label: 'No' }] }
const snapOf = (o: { ask?: boolean; connecting?: boolean; listed?: boolean } = {}) =>
  withAttention({
    places: [{ id: 'sp1', name: 'shop', chat: 'sp1', shepherdr: 'running' }],
    tasks: o.listed === false ? [] : [{ id: 'SHOP-1', name: 'Fix login', status: o.ask ? 'need' : 'work', place: 'sp1', at: T0 }],
    needs: o.ask ? [{ id: 'q1', chat: 'SHOP-1/worker', place: 'sp1', task: 'SHOP-1', at: T0, question: q }] : [],
    settings: [], machines: o.connecting ? [{ id: 'm2', connecting: true }] : [], last: {}, read: {},
  } as any, T0) as unknown as Snapshot
const ID = 'need:SHOP-1/worker:q1'
const ui = (o: Partial<{ at: string; task: string | null; max: string | null; jump: string | null }> = {}) =>
  ({ at: 'sp1', task: null, max: null, jump: null, chatLink: null, ...o }) as any

test("an action's link: its task's space, its task, its card, its id; an old link names none", () => {
  const s = snapOf({ ask: true })
  const a = openAction(s, ID)!
  expect(a).toMatchObject({ id: ID, task: 'SHOP-1', card: 'q1' })
  const url = actionUrl(s, a)
  expect(url).toBe('./?place=sp1&task=SHOP-1&focus=q1&action=need%3ASHOP-1%2Fworker%3Aq1')
  expect(actionOfUrl(url)).toBe(ID)
  expect(actionOfUrl('./?place=sp1&task=SHOP-1&focus=q1')).toBeNull()
  expect(actionOfUrl(null)).toBeNull()
})

test('a tap on an open action goes to its card: in place when its task is open, else by its own link', () => {
  const s = snapOf({ ask: true })
  expect(resolveTap(s, ui({ task: 'SHOP-1' }), ID, 0)).toEqual({ open: { url: null, jump: 'q1' } })
  // already at its card: nothing to move
  expect(resolveTap(s, ui({ task: 'SHOP-1', jump: 'q1' }), ID, 0)).toEqual({ open: { url: null, jump: null } })
  // another task open (the link came from elsewhere): the action's own link, without its id (said once)
  expect(resolveTap(s, ui({ task: 'SHOP-9' }), ID, 0)).toEqual({ open: { url: './?place=sp1&task=SHOP-1&focus=q1', jump: 'q1' } })
})

test("a tap on a closed action waits while its task or a machine is still being read, then says it closed", () => {
  // the remote machine still connecting, or the task not listed yet (a cold start): wait
  expect(resolveTap(snapOf({ connecting: true }), ui({ task: 'SHOP-1' }), ID, 0)).toEqual({ wait: true })
  expect(resolveTap(snapOf({ listed: false }), ui({ task: 'SHOP-1' }), ID, 1000)).toEqual({ wait: true })
  // waited long enough: closed all the same
  expect(resolveTap(snapOf({ listed: false }), ui({ task: 'SHOP-1' }), ID, WAIT_MS)).toEqual({ closed: { task: 'SHOP-1' } })
  // all read, the card gone: closed at once
  expect(resolveTap(snapOf(), ui({ task: 'SHOP-1' }), ID, 0)).toEqual({ closed: { task: 'SHOP-1' } })
  expect(settled(snapOf(), 'SHOP-1')).toBe(true)
  expect(settled(snapOf(), null)).toBe(true)
})

test("what a late tap says: answered, the task moved on, or a space's ask that's over", () => {
  expect(outcomeWords({ outcome: 'answered', what: 'Deploy now?', task: 'SHOP-1' })).toBe('Answered · Deploy now?')
  expect(outcomeWords({ outcome: 'moved', what: 'Deploy now?', task: 'SHOP-1' })).toBe('Task moved on · Deploy now?')
  expect(outcomeWords({ outcome: 'moved', what: '' })).toBe('No longer waiting')
})

test("the topics a device hears: its level's, the default when unset, none when Off", () => {
  expect(heard('Needs you')).toEqual(['needs', 'ready'])
  expect(heard('Needs you and done')).toEqual(['needs', 'ready', 'done'])
  expect(heard(null)).toEqual(['needs', 'ready'])
  expect(heard(OFF)).toEqual([])
})

test("an alert's card is on screen only when its task's chat (or its space's, for none) is open", () => {
  const s = snapOf({ ask: true })
  expect(cardOnScreen(s, ui({ task: 'SHOP-1' }), { task: 'SHOP-1' })).toBe(true)
  expect(cardOnScreen(s, ui({ max: 'SHOP-1' }), { url: './?place=sp1&task=SHOP-1&focus=q1' })).toBe(true)
  // the space is open, not the task: the person doesn't see the card
  expect(cardOnScreen(s, ui(), { task: 'SHOP-1' })).toBe(false)
  // a space's own ask: its chat open
  expect(cardOnScreen(s, ui(), { place: 'sp1' })).toBe(true)
  expect(cardOnScreen(s, ui({ at: 'sp2' }), { place: 'sp1' })).toBe(false)
})
