import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message } from '@shared/types.ts'
import { getState, setOutbox, setUI } from '@client/kernel.ts'
import { send } from '@client/send.ts'
import { suggestionOf } from './suggest.ts'
import { bubbleQuote, firstWords, ReplyingTo } from './reply-bubbles.tsx'

// dmalis/shepherdr#51: suggested replies say which message they answer, and a tapped one goes as a reply to it. Fake
// data. The outbox is emptied at once after each send, so its delivery stops before it reaches the network.

const chat = (messages: Partial<Message>[]) => ({ key: 'p:docs', messages: messages.map((m, i) => ({ id: `m${i}`, who: 'agent', ...m })) }) as Chat
const LIST = "Here's what I'd change:\n\n1. Add the **Everything** hint\n2. Shorten the [install page](https://example.com)"
const ASKS = 'One line under the Everything row. Should I start on them?'

afterEach(() => {
  setOutbox(() => [])
  setUI({ files: {}, reply: {}, jump: null })
})

test("the quote is the first words of the message the bubbles came with: one line, no Markdown, a link's words", () => {
  expect(firstWords(LIST)).toBe("Here's what I'd change: 1. Add the Everything hint 2. Shorten the install page")
  expect(firstWords('word '.repeat(100)).length).toBe(200)
  expect(firstWords('word '.repeat(100)).endsWith('…')).toBe(true)
  const c = chat([{ text: LIST }, { who: 'you', text: 'What would it say?' }, { text: ASKS, suggests: ['Yes, do those three', 'Do all four'] }])
  const sg = suggestionOf(c, true)!
  expect(sg.id).toBe('m2')
  expect(bubbleQuote(c, sg.id)).toEqual({ id: 'm2', who: 'agent', text: ASKS })
  // gone from the chat (an older page of it): no quote, the bubble still sends
  expect(bubbleQuote(c, 'gone')).toBeUndefined()
})

test('bubbles from an older message are gone once a newer agent message comes', () => {
  const c = chat([{ text: LIST, suggests: ['Do all four'] }, { text: 'Started on the first three.' }])
  expect(suggestionOf(c, true)).toBeNull()
  const d = chat([{ text: LIST, suggests: ['Do all four'] }, { text: ASKS, suggests: ['Yes, start them'] }])
  expect(suggestionOf(d, true)).toEqual({ id: 'm1', texts: ['Yes, start them'] })
})

test('"Replying to" over the bubbles quotes that message, and a tap on it goes there', () => {
  const c = chat([{ text: LIST }, { text: ASKS, suggests: ['Do all four'] }])
  const html = renderToStaticMarkup(<ReplyingTo chat={c} id="m1" />)
  expect(html).toContain('Replying to')
  expect(html).toContain(`“${ASKS}”`)
  expect(renderToStaticMarkup(<ReplyingTo chat={c} id="gone" />)).toBe('')
  const el = ReplyingTo({ chat: c, id: 'm1' })!
  ;(el.props as { onClick: () => void }).onClick()
  expect(getState().ui.jump).toBe('m1')
})

test('a tapped bubble goes as a reply to its message; the draft keeps its own quoted reply and files', () => {
  setUI({ files: { 'p:docs': [{ name: 'plan.png', path: '/tmp/plan.png' }] }, reply: { 'p:docs': { id: 'm0', text: 'Here is' } } } as never)
  const c = chat([{ text: LIST }, { text: ASKS, suggests: ['Do all four'] }])
  send('p:docs', 'p:docs', 'Do all four', false, true, undefined, bubbleQuote(c, 'm1'))
  const [out] = getState().outbox
  setOutbox(() => [])
  expect(out!.text).toBe('Do all four')
  expect(out!.reply).toEqual({ id: 'm1', who: 'agent', text: ASKS })
  expect(out!.files).toEqual([])
  expect(out!.how).toBe('bubble')
  expect(getState().ui.reply['p:docs']?.id).toBe('m0')
  expect(getState().ui.files['p:docs']).toHaveLength(1)
})

test("the message box shows the label with the bubbles and sends a tapped one with its message's quote", () => {
  const src = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(src).toContain('{sug && <ReplyingTo chat={chat} id={sug.id} />}')
  expect(src).toContain('send(key, key, t, false, true, undefined, bubbleQuote(chat, sug.id))')
})
