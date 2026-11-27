// dmalis/shepherdr#59: the message box while its agent asks something (a question, a permission, a plan). You can always
// write and send: with words in the box one quiet line says "Sends after you answer the card above."; sent, the
// message waits over the box with the same words and no Send now, until the card is answered. Fake data.
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Question } from '@shared/types.ts'
import type { Outgoing } from '@client/outbox.ts'
import { AFTER, AFTER_TERMINAL } from '@core/asking.js'
import { AskLine, afterOf, boxLine, openCard } from './asking-box.tsx'
import { heldOf, isHeld } from './queued.ts'
import { expire } from '@client/outbox.ts'
import { getState, setOutbox } from '@client/kernel.ts'
import { recheckWaiting } from '@client/send.ts'

const q = (p: Partial<Question>): Question => ({ id: 'q', title: 'Which one?', kind: 'Question', to: 'p:sp1', choices: [{ label: 'A' }, { label: 'B' }], other: true, ...p })
const permission = (p: Partial<Question> = {}) => q({ title: 'Run a command', other: undefined, command: 'npm test', choices: [{ label: 'Allow once' }, { label: 'Decline' }], ...p })
const chat = (...qs: Question[]): Chat => ({ key: 'p:sp1', cli: 'claude', messages: qs.map((x, i) => ({ id: `m${i}`, who: 'agent', at: i, question: x })) }) as Chat

test('words typed while a card waits: the line says it sends after the answer; nothing typed, no line', () => {
  for (const c of [q({}), permission(), q({ kind: 'Plan', other: undefined })]) {
    expect(boxLine(chat(c), true)).toBe(AFTER)
    expect(boxLine(chat(c), false)).toBeNull()
  }
  // answered, closed, one answered while it works, or a worker's copied here: no line
  for (const p of [{ sent: 0 }, { closed: 'Closed' }, { queued: true }, { by: { ref: 'SHOP-1', chat: 'x/worker' } }])
    expect(boxLine(chat(permission(p)), true)).toBeNull()
  expect(boxLine(undefined, true)).toBeNull()
})

test('only its terminal can answer: a CLI menu, or the chat saying it asks in its terminal', () => {
  expect(boxLine(chat(q({ press: true, other: undefined })), true)).toBe(AFTER_TERMINAL)
  expect(boxLine({ ...chat(), blocked: 'It asks in its terminal' } as Chat, true)).toBe(AFTER_TERMINAL)
  // Codex's own question: its card opens the terminal (cards.tsx TerminalCard)
  expect(boxLine(chat(q({ id: 'cq:1', other: undefined })), true)).toBe(AFTER_TERMINAL)
  // a message that raced the card: the card above, before and after it reaches the page
  expect(afterOf(chat())).toBe(AFTER)
  expect(afterOf(chat(permission()))).toBe(AFTER)
})

test('openCard: only a card the chat answers, unless any open card is asked for', () => {
  expect(openCard(chat(q({ press: true })))).toBeUndefined()
  expect(openCard(chat(q({ press: true })), false)?.id).toBe('q')
  expect(openCard(chat(q({ terminal: true })))).toBeUndefined()
  expect(openCard(chat(permission()))?.id).toBe('q')
})

test('a message waiting for the answer is a held row over the box, not a bubble in the chat or a failure', () => {
  const o = { cid: 'c1', chat: 'p:sp1', text: 'and the linter', files: [], at: 1, state: 'sent', waiting: true, waitsFor: 'answer' } as unknown as Outgoing
  expect(isHeld(o)).toBe(true)
  expect(heldOf([o], 'p:sp1', chat(permission()))).toEqual([o])
  expect(isHeld({ ...o, state: 'failed' })).toBe(false)
})

test('the line: quiet, announced, never a refusal', () => {
  const html = renderToStaticMarkup(<AskLine id="ask-p:sp1" words={AFTER} />)
  expect(html).toContain('class="askline"')
  expect(html).toContain('role="status"')
  expect(html).toContain('id="ask-p:sp1"')
  expect(html).toContain(AFTER)
  expect(html).not.toContain('Not sent')
})

// the seams in upstream's message box this relies on
test('the box: Send stays, the line describes the words, a held row waiting for an answer has no Send now', () => {
  const src = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')
  expect(src).toContain('const after = boxLine(chat, filled)')
  expect(src).toContain('{after && <AskLine id={`ask-${key}`} words={after} />}')
  expect(src).toContain('aria-describedby={after ? `ask-${key}` : undefined}')
  expect(src).toContain("{o.waitsFor === 'answer' ? afterOf(chat) : 'Queued'}")
  expect(src).toContain("{o.waitsFor !== 'answer' && <button")
  expect(src).not.toContain('Answer its question above first')
  const css = readFileSync(new URL('./asking.css', import.meta.url), 'utf8')
  expect(css).toContain('var(--muted)')
})

const waiting = { cid: 'w1', chat: 'p:sp1', text: 'later', files: [], at: 0, state: 'sent', waiting: true, waitsFor: 'answer' } as unknown as Outgoing

test('one waiting for an answer waits as long as the question: never failed after 30 minutes', () => {
  expect(expire([waiting], 2 * 60 * 60_000)[0]!.state).toBe('sent')
  expect(expire([{ ...waiting, waitsFor: 'turn' }], 2 * 60 * 60_000)[0]!.state).toBe('failed')
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  setOutbox(() => [])
})
test('the page asks about one waiting by its id; it sends it again only when the server lost it', async () => {
  const asked: any[] = []
  let state: object = { ok: true, state: 'waiting' }
  globalThis.fetch = (async (_u: string, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body))
    asked.push(b)
    return Response.json(b.type === 'send' ? { ok: true, waiting: true, waitsFor: 'answer' } : state)
  }) as unknown as typeof fetch
  setOutbox(() => [waiting])
  await recheckWaiting()
  expect(asked).toEqual([{ type: 'send-state', cid: 'w1' }])
  expect(getState().outbox[0]).toEqual(waiting)
  // a restart lost it: sent again by its id, and it waits again
  state = { ok: true, state: 'unknown' }
  await recheckWaiting()
  expect(asked.at(-1)).toMatchObject({ type: 'send', cid: 'w1', text: 'later' })
  expect(getState().outbox[0]).toMatchObject({ waiting: true, waitsFor: 'answer' })
  // it went: shows like any sent one, timed from now (never failed at once)
  state = { ok: true, state: 'went', at: 5 }
  await recheckWaiting()
  expect(getState().outbox[0]).toMatchObject({ state: 'sent', waiting: undefined, serverAt: 5, wentAt: expect.any(Number) })
  expect(expire(getState().outbox, Date.now() + 1000)[0]!.state).toBe('sent')
  // failed (it stayed in the box): Retry is the person's, never sent by this ask
  setOutbox(() => [waiting])
  state = { ok: true, state: 'failed', error: "It stayed in the agent's message box." }
  const n = asked.length
  await recheckWaiting()
  expect(asked.slice(n).map((x) => x.type)).toEqual(['send-state'])
  expect(getState().outbox[0]).toMatchObject({ state: 'failed' })
  // out of reach: nothing changes
  setOutbox(() => [waiting])
  globalThis.fetch = (async () => { throw new TypeError('offline') }) as unknown as typeof fetch
  await recheckWaiting()
  expect(getState().outbox[0]).toEqual(waiting)
})
