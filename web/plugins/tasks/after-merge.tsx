// A merged task's commits after its merge (dmalis/shepherdr#48), in its own pane: its change merged and it stays Done,
// so what its agent committed since is offered as a follow-up task, as GitHub's "had recent pushes · Compare & pull
// request" banner offers a branch's new commits, and Linear's related-issue line names the one that carries them on.
// Main already holding the same change: "Already on main", nothing offered.
import { attempt, openTask } from '@client/kernel.ts'
import { ActBtn, ActError, Btn, I, useCardActs } from '@client/ui.tsx'
import type { Task } from '@shared/types.ts'
import { afterMergeCard, afterMergeList } from '@shared/after-merge.ts'
import { taskChat } from '@shared/view.ts'
import './after-merge.css'

export function AfterMergeCard({ t }: { t: Task }) {
  const a = t.afterMerge
  const acts = useCardActs(`after-merge:${t.id}`, `${a?.count ?? 0}|${a?.onMain ? 1 : 0}|${a?.followUp?.id ?? ''}`)
  if (!a || a.count < 1) return null
  const { head, line } = afterMergeCard(a)
  const { shown, more } = afterMergeList(a)
  const offered = !a.onMain && !a.followUp
  return (
    <div className={a.onMain ? 'card amcard am-main' : 'card amcard'} data-card={`after-merge:${t.id}`}>
      <span className="t amhead">
        <I n={a.onMain ? 'check' : a.followUp ? 'merged' : 'branch'} c={a.onMain ? 'c-mute' : undefined} />
        {head}
      </span>
      <span className="s">{line}</span>
      {offered && shown.length > 0 && (
        <ul className="amrows" aria-label="Commits after the merge">
          {shown.map((s, i) => <li key={i}>{s}</li>)}
          {more > 0 && <li className="ammore">and {more} more</li>}
        </ul>
      )}
      {offered && (
        <div className="acts">
          <ActBtn acts={acts} id="follow-up" kind="pri" busy="Starting…" run={() => attempt({ type: 'follow-up', chat: taskChat(t) })}>Start a follow-up</ActBtn>
        </div>
      )}
      {a.followUp && (
        <div className="acts">
          <Btn onClick={() => openTask(a.followUp!.id)}>Open the follow-up</Btn>
        </div>
      )}
      <ActError acts={acts} />
    </div>
  )
}
