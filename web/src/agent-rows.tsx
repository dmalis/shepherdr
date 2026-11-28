// Settings › Agents' rows (fork #219), as macOS System Settings, iOS Settings and Linear lay out a setting: one row is
// one unit, what it is, what it is set to and one way to change it, and the whole row is the control. Its agent's logo
// and name, then each choice as its own label over its value (the picker's own rows, in its order), wrapping onto more
// lines where the row is narrow. Pressing it opens the same picker as "This chat runs on".
import { useId, type ReactNode } from 'react'
import type { Catalog } from '@shared/types.ts'
import { Bolts, pickerRows, pickWords, SPEEDS, type Pick } from './picker.tsx'
import { I, Logo } from './ui.tsx'
import './agent-rows.css'

/** the parts a row shows: every picker row but the agent's own, which is the row's heading */
export function agentParts(pick: Pick, cat?: Catalog): { f: string; label: string; value: string }[] {
  return pickerRows(pick, cat).filter((r) => r.f !== 'agent' && r.value)
}

/** One role's row: `name` (Chats, Tasks, Reviews), `small` what follows it (a space's "Set here · Reset"), kept
 *  outside the button so its Reset is a control of its own. */
export function AgentRow({ name, small, pick, cat, onOpen }: { name: string; small?: ReactNode; pick: Pick; cat?: Catalog; onOpen: () => void }) {
  const w = pickWords(pick, cat)
  const parts = agentParts(pick, cat)
  // its name is its title, what it is set to its description (docs/design.md: Names for screen readers), each part
  // read as "Model, Opus 5.5"
  const id = useId()
  return (
    <div className="srow agr">
      <button type="button" className="agr-b" aria-labelledby={`${id}n`} aria-describedby={`${id}a ${id}f`} onClick={onOpen}>
        <Logo agent={pick.agent} name={w.agent} />
        <span className="agr-t">
          <span className="agr-n" id={`${id}n`}>{name}</span>
          <span className="agr-a" id={`${id}a`} translate="no">{w.agent}</span>
        </span>
        <I n="right" c="s16 agr-c" />
        <span className="agr-f" id={`${id}f`}>
          {parts.map((p) => (
            <span key={p.f} className="agr-p">
              <span className="agr-k">{p.label}<span className="agr-sr">,</span></span>
              <span className="agr-v">
                <span className="agr-vt" translate={p.f === 'model' ? 'no' : undefined}>{p.f === 'speed' ? SPEEDS[w.speed] : p.value}</span>
                {p.f === 'speed' && <Bolts speed={w.speed} decorative />}
              </span>
            </span>
          ))}
        </span>
      </button>
      {small && <span className="agr-own">{small}</span>}
    </div>
  )
}
