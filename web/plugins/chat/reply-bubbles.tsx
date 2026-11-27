// Suggested replies say which message they answer (dmalis/shepherdr#51): a "Replying to" line above the bubbles quotes
// the first words of the message they came with (a tap on it goes to that message), and a tapped bubble goes as a
// reply to it, quoted above its words like any reply (Viber, WhatsApp, iMessage, Slack): the agent gets its
// <hc reply-to="…"/> line too (core/send.js messageBody).
import type { Chat, ReplyQuote } from '@shared/types.ts'
import { setUI } from '@client/kernel.ts'
import './reply-bubbles.css'

/** a message's first words on one line, as a quote shows them: no Markdown marks, a link's words only */
export function firstWords(text: string, n = 200): string {
  const one = text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return one.length > n ? one.slice(0, n - 1).trimEnd() + '…' : one
}

/** the quote a tapped bubble's message carries: the message the bubbles came with (suggestionOf's id), while the chat
 *  has it */
export function bubbleQuote(chat: Chat | undefined, id: string): (ReplyQuote & { id: string }) | undefined {
  const m = chat?.messages.find((x) => x.id === id)
  if (!m?.text) return undefined
  return { id: m.id, who: m.who === 'you' ? 'you' : 'agent', text: firstWords(m.text) }
}

/** "Replying to “first words…”" over the bubbles: a tap goes to that message and lights it, as a sent reply's quote
 *  does */
export function ReplyingTo({ chat, id }: { chat: Chat | undefined; id: string }) {
  const q = bubbleQuote(chat, id)
  if (!q) return null
  return (
    <button
      type="button"
      className="sugfor"
      aria-label={`Suggested replies to: ${q.text}. Show that message`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setUI({ jump: q.id, chatLink: null })}
    >
      <span className="sfl">Replying to</span>
      <span className="sfq">“{q.text}”</span>
    </button>
  )
}
