// Say what each thing is (dmalis/shepherdr, "Chat: say what each thing is"): a task a chat names by its title gets its
// kind first, quiet, so "✓ Install merged" reads "✓ Schedule run · Install merged · Done", not "the install merged".
// GitHub's timeline ("Issue"), Linear's ("Issue ENG-12") and Slack's app label ("Workflow"): the kind muted, the name
// the main words and the one part cut short on a narrow screen, the state word after it so the icon isn't the only
// sign. Inline in words (a link to a task), the kind is a quiet word inside the link.
import { taskKind } from '@shared/kinds.ts'
import './kind.css'

type Named = { schedule?: string } | null | undefined

/** one line: its kind, its name (cut short first), then its state word */
export function KindName({ t, name, state }: { t?: Named; name: string; state?: string }) {
  return (
    <span className="knd">
      <span className="kd">{taskKind(t)}</span>
      <span className="kn">{name}</span>
      {state ? <span className="ks">{state}</span> : null}
    </span>
  )
}

/** the kind inside a link to a task, before its title ("Task Fix login") */
export function KindWord({ t }: { t?: Named }) {
  return <span className="kdi">{taskKind(t)}</span>
}

/** the same, put into a link the markdown drew (markdown.tsx toHtml) */
export function markKind(a: HTMLElement, t?: Named) {
  if (a.querySelector(':scope > .kdi')) return
  const k = document.createElement('span')
  k.className = 'kdi'
  k.textContent = taskKind(t)
  a.prepend(k)
}
