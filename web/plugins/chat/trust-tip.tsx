// The trust card's per-repo tip (service/trust-tip.ts): the command that trusts the repo once, for the person to run
// in their own terminal on the task's machine. Shepherdr never runs it. Copying it marks it seen for that repo, so the
// repo's later trust cards leave it out (this card keeps it, to read while running it).
import { copyText } from '@client/copy.ts'
import { attempt, notice, useSnap } from '@client/kernel.ts'
import { IB } from '@client/ui.tsx'
import type { Question } from '@shared/types.ts'
import { machineLabel } from '@shared/view.ts'
import './trust-tip.css'

export function TrustTip({ q }: { q: Question }) {
  const snap = useSnap()
  const tip = q.trust?.tip
  if (!tip) return null
  // the machine, once there is more than one to run it on
  const on = snap && snap.machines.length > 1 ? ` on ${machineLabel(snap, tip.machine)}` : ''
  const copy = (at: Element) => void copyText(tip.command, at).then((ok) => {
    if (!ok) return
    notice('Copied')
    void attempt({ type: 'trust-tip', key: tip.key, card: q.id })
  })
  return (
    <div className="ttip" data-trust-tip="">
      <span>{tip.lead}</span>
      <div className="code">
        <code>{tip.command}</code>
        <IB icon="copy" label="Copy" onClick={(e) => copy(e.currentTarget)} />
      </div>
      <span className="s">Run it in your own terminal{on}, {tip.then}{tip.covers ? ` ${tip.covers}` : ''}</span>
    </div>
  )
}
