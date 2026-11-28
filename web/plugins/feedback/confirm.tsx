// File it… (friction loop, slice 4, #94): the exact text an Assistant wrote up for GitHub, and where it goes, before the
// person's yes. As GitHub's own new-issue page shows its title and body before Submit, and iOS's share sheet names where
// a thing goes before Send: the place first, then the title and the body as posted, then the one line Settings adds.
// Post it is the yes for this revision only: the service keeps it (herdr-task feedback --approve), then the person's
// message with its hidden line goes to the chat that posts it. Cancel, Esc or a drag down close it and nothing is kept.
// Focus starts on the sheet itself (layer-focus.ts), so Enter can't post by accident.
import { act, go, notice } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { Btn } from '@client/ui.tsx'
import type { FeedbackDraft, FeedbackRow, Snapshot } from '@shared/types.ts'
import { spaceLabel } from '@shared/view.ts'
import { call, whose, writeUpTo } from './rows.tsx'
import { postText, W, whereWords } from './words.ts'

type Answer = { ok?: boolean; error?: string }

/** the person's message that asks the chat to post it, with its hidden line; false when it wasn't sent */
export async function sendPost(snap: Snapshot, r: FeedbackRow, rev: number): Promise<boolean> {
  const to = writeUpTo(snap, r)
  if (!to) return false
  try {
    const a = await act<Answer>({ type: 'send', chat: to.chat, text: postText(r.line), human: true, cid: `fbp-${Date.now().toString(36)}`, feedback: { id: r.id, rev } })
    if (a?.ok === false) throw new Error(a.error || "It wasn't sent.")
  } catch (e) {
    notice(`${(e as Error).message || "It wasn't sent."} ${W.sendAgainHint}`, { tone: 'error' })
    return false
  }
  notice(`${W.postSent} ${spaceLabel(snap, to.id)}`, { tone: 'ok', act: { label: W.open, run: () => go(to.id) } })
  return true
}

/** Post it: the yes kept first (nothing is sent without it), then the message */
export async function postIt(snap: Snapshot, r: FeedbackRow, d: FeedbackDraft): Promise<boolean> {
  const a = await call({ do: 'approve', ...whose(r), rev: d.rev })
  if (!a.ok) {
    notice(a.error!, { tone: 'error' })
    return false
  }
  return sendPost(snap, r, d.rev)
}

export function DraftView({ d, note }: { d: FeedbackDraft; note?: string }) {
  return (
    <>
      <p className="fb-to">{whereWords(d.target)}</p>
      <div className="fb-draft" tabIndex={0} role="group" aria-label={W.draftLabel}>
        <p className="fb-dt">{d.title}</p>
        <div className="fb-db">{d.body}</div>
      </div>
      <p className="fb-hidden">{W.hiddenLine}</p>
      {note && <p className="fb-dnote">{note}</p>}
    </>
  )
}

/** open the sheet for a row's draft: true once Post it went through, false when it was closed or didn't */
export function openFileIt(snap: Snapshot, r: FeedbackRow, note: string | undefined): Promise<boolean> {
  const d = r.draft
  if (!d) return Promise.resolve(false)
  return new Promise((done) => {
    let posting = false
    openDialog(
      (close) => (
        <div className="fb-sheet">
          <h2>{W.fileItTitle}</h2>
          <DraftView d={d} note={note} />
          <div className="acts">
            <Btn onClick={close}>{W.cancel}</Btn>
            <Btn kind="pri" onClick={() => {
              posting = true
              close()
              void postIt(snap, r, d).then(done)
            }}>{W.postIt}</Btn>
          </div>
        </div>
      ),
      { wide: true, label: W.fileItTitle, onClose: () => { if (!posting) done(false) } },
    )
  })
}
