// dmalis/shepherdr#59: the message box while its agent asks something (a question, a permission, a plan). You can always
// write and send: with words in the box one quiet line says "Sends after you answer the card above."; sent, the
// message waits over the box with the same words and no Send now, until the card is answered. Fake data.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Question } from '@shared/types.ts'
import type { Outgoing } from '@client/outbox.ts'
import { AFTER, AFTER_TERMINAL } from '@core/asking.js'
import { AskLine, afterOf, boxLine, openCard } from './asking-box.tsx'
import { heldOf, isHeld } from './queued.ts'

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
