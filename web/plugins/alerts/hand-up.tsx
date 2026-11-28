// A hand-up's card (fork Needs you 6b; the design: fork/specs/needs-you.md): Shepherdr handed a task's wait up to the
// person (herdr-task alert --task, optional --choice). In the task, where it came up: "Needs you · <the ask>", a line
// more, the other tasks the same question holds, and its choices as buttons. A choice goes to Shepherdr's chat as the
// person's own message about this task (as a row's Reply in chat), then the hand-up is taken back on the task's machine
// (the wait is Shepherdr's again, quiet). With no choices, Answer in chat opens Shepherdr's chat about the task. The
// pattern of Slack's and Linear's actionable notifications: the question, then one button per answer.
import { attempt, go } from '@client/kernel.ts'
import { replyToTask } from '@plugins/chat/slide.tsx'
import { ActBtn, ActError, useCardActs } from '@client/ui.tsx'
import { attentionOf, leadOf, type Action } from '@shared/attention.ts'
import { tierLabel } from '@shared/needs-words.ts'
import type { Snapshot, Task } from '@shared/types.ts'

/** the task's open hand-up action, if it has one */
export function handUpOf(snap: Snapshot, t: Pick<Task, 'id'>): (Action & { handUp: NonNullable<Action['handUp']> }) | null {
  const a = leadOf(attentionOf(snap), t.id)
  return a?.up === 'asked' && a.handUp ? (a as Action & { handUp: NonNullable<Action['handUp']> }) : null
}

/** what a choice says to Shepherdr: the question and the answer, so its chat reads on its own */
export const answerText = (what: string, choice: string) => `“${what}”: ${choice}`

export function HandUpCard({ snap, t }: { snap: Snapshot; t: Task }) {
  const a = handUpOf(snap, t)
  const acts = useCardActs(`handup:${a?.handUp.lead ?? t.id}`, `${a?.id ?? ''}|${a?.handUp.at ?? ''}`)
  if (!a) return null
  const u = a.handUp
  const chat = snap.places.find((p) => p.id === a.place)?.chat
  const others = (a.tasks ?? []).filter((id) => id !== t.id).map((id) => snap.tasks.find((x) => x.id === id)?.name).filter(Boolean)
  const answer = (choice: string) => async () => {
    if (!chat) return 'Shepherdr’s chat for this space isn’t here any more.'
    const sent = await attempt({ type: 'send', chat, text: answerText(u.what, choice), replyTask: t.id, human: true, cid: `hu-${Date.now().toString(36)}` })
    if (sent) return sent
    return attempt({ type: 'task-handup-settled', chat: `${t.id}/worker` })
  }
  // as a question's card (web/plugins/chat/cards.tsx): its answers as chips, then a way to say more in chat
  return (
    <div className="card" data-card={`handup:${u.lead}`} data-ask="">
      <span className="t">{tierLabel('person', u.what)}</span>
      {u.why && <span>{u.why}</span>}
      {others.length > 0 && <span className="s">{`Also holds ${others.join(', ')}`}</span>}
      <div className="chips">
        {u.choices?.map((c, i) => (
          <ActBtn key={c} acts={acts} id={`c${i}`} chip busy="Sending…" run={answer(c)}>
            {c}
          </ActBtn>
        ))}
        {chat && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              // Shepherdr's chat in this task's space, a reply about this task ready to write
              go(a.place)
              replyToTask(t)
            }}
          >
            {u.choices?.length ? 'Answer in chat' : 'Answer'}
          </button>
        )}
      </div>
      <ActError acts={acts} />
    </div>
  )
}

/** the task thread's card list entry (web/plugins/tasks/client.tsx taskCards): where the hand-up came up */
export const handUpCards = (snap: Snapshot, t: Task) => {
  const a = handUpOf(snap, t)
  return a ? [{ key: `handup:${a.handUp.lead}`, at: a.handUp.at, after: () => true, node: <HandUpCard snap={snap} t={t} /> }] : []
}
