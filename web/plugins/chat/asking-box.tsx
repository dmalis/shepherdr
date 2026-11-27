// dmalis/shepherdr#59: the message box while its agent asks something (a question, a permission, a plan). You can always
// write and send: a message sent now waits over the box, "Sends after you answer the card above.", and goes by itself
// once the card is answered (service/actions.ts `held`: nothing typed into the agent, no key pressed). One sent before
// the card reached the page waits the same way. Only its terminal can answer (a CLI's own menu, a prompt no card shows):
// the line says its terminal instead.
import type { Chat, Question } from '@shared/types.ts'
import { AFTER, AFTER_TERMINAL } from '@core/asking.js'
import { I } from '@client/ui.tsx'
import './asking.css'

/** an open card of the chat's own agent that it waits on (not one answered while it works, nor a task worker's copied
 *  here). here: only one answered in the chat (a question, a permission, a plan), not a CLI's own menu whose card
 *  opens its terminal */
export function openCard(chat?: Chat, here = true): Question | undefined {
  for (let i = (chat?.messages.length ?? 0) - 1; i >= 0; i--) {
    const q = chat!.messages[i]!.question
    if (q && !q.queued && !q.by && q.sent === undefined && !q.closed && (!here || (!q.press && !q.terminal))) return q
  }
  return undefined
}

/** where a message waiting for its agent's answer is answered: the card above, or its terminal when no card here can
 *  (a CLI's menu, or the chat's "asks in its terminal" line). Before the card reaches the page: the card above. */
export const afterOf = (chat?: Chat) => (!openCard(chat) && (openCard(chat, false) || chat?.blocked !== undefined) ? AFTER_TERMINAL : AFTER)

/** The box's line while its agent asks: what Send does now, or null (no card waits, or nothing is typed). */
export function boxLine(chat: Chat | undefined, filled: boolean): string | null {
  if (!filled) return null
  return openCard(chat, false) || chat?.blocked !== undefined ? afterOf(chat) : null
}

/** the quiet line over the words */
export function AskLine({ id, words }: { id: string; words: string }) {
  return (
    <div className="askline" id={id} role="status">
      <I n="ask" c="s16" />
      <span>{words}</span>
    </div>
  )
}
