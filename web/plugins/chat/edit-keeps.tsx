// Edits keep what you wrote (fork dmalis/shepherdr#186). A suggested reply held to edit goes into the box at the caret,
// or over only what is selected, as an emoji picker or a snippet does in Slack or Notion: the rest of your draft stays.
// It goes as a reply to the message it answers, as a tapped one does; when the box already replies to another
// message, it asks first. A long paste's place in the words is fold.ts's.
import { getDraft, getState, setDraft, setUI } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { Btn } from '@client/ui.tsx'
import type { ReplyQuote } from '@shared/types.ts'
import { firstWords } from './reply-bubbles.tsx'

/** `t` put into `text` over its `start`..`end`, a space either side where it would touch a word. The caret goes after
 *  it */
export function insertAt(text: string, start: number, end: number, t: string): { text: string; caret: number } {
  const a = Math.min(Math.max(start, 0), text.length)
  const b = Math.min(Math.max(end, a), text.length)
  const head = text.slice(0, a)
  const tail = text.slice(b)
  const left = head && !/\s$/.test(head) ? ' ' : ''
  const right = tail && !/^\s/.test(tail) ? ' ' : ''
  const put = `${head}${left}${t}`
  return { text: `${put}${right}${tail}`, caret: put.length }
}

type Quote = ReplyQuote & { id: string }

/** a held suggestion for the message `q`: its words into `key`'s box at the box's caret (`box`'s selection, once the
 *  person has put the caret there: `placed`; else after the words), and the box's reply to `q`. Another reply in the
 *  box: asked first, and both answers put the words in */
export function holdSuggestion(key: string, t: string, q: Quote | undefined, box: HTMLTextAreaElement | null, placed: boolean) {
  const was = getState().ui.reply[key]
  const put = (reply: boolean) => {
    const text = getDraft(key)
    const [from, to] = box && placed ? [box.selectionStart, box.selectionEnd] : [text.length, text.length]
    const at = insertAt(text, from, to, t)
    if (reply && q) setUI((ui) => ({ reply: { ...ui.reply, [key]: q } }))
    setDraft(key, at.text, { from, to })
    if (!box) return
    box.focus()
    // after React writes the new words, which puts the caret at their end
    requestAnimationFrame(() => box.setSelectionRange(at.caret, at.caret))
  }
  if (!q || !was || was.id === q.id) return put(!!q)
  askReply(was, q, put)
}

/** "Change what you reply to?": the box replies to one message and the held suggestion answers another. Each is
 *  named by its first words, short enough to tell them apart at a glance */
function askReply(was: { text: string; task?: string }, now: Quote, put: (reply: boolean) => void) {
  const TITLE = 'Change what you reply to?'
  openDialog(
    (done) => (
      <>
        <h2>{TITLE}</h2>
        <p>
          Your message replies to {was.task ? 'the task ' : ''}“{firstWords(was.text, 60)}”. This suggestion answers “{firstWords(now.text, 60)}”.
        </p>
        <div className="acts">
          <Btn onClick={() => { done(); put(false) }}>Keep my reply</Btn>
          <Btn kind="pri" onClick={() => { done(); put(true) }}>Switch the reply</Btn>
        </div>
      </>
    ),
    { label: TITLE },
  )
}
