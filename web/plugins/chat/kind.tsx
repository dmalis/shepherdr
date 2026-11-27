// Say what each thing is (dmalis/shepherdr, "Chat: say what each thing is"): a task a chat names by its title gets its
// kind first, quiet, so "✓ Install merged" reads "✓ Schedule run · Install merged · Done", not "the install merged".
// GitHub's timeline ("Issue"), Linear's ("Issue ENG-12") and Slack's app label ("Workflow"): the kind muted, the name
// the main words and the one part cut short on a narrow screen, the state word after it so the icon isn't the only
// sign. Inline in words (a link to a task), the kind is a quiet word inside the link.
import { splitKindTitle, taskKind, type Kind } from '@shared/kinds.ts'
import './kind.css'

type Named = { schedule?: string } | null | undefined

/** one line: its kind, its name, then its state word. On a narrow screen a state's tail ("· told you in Everything")
 *  gives way first, then the name; the kind and the state's first words ("Done") always stay. */
export function KindName({ t, kind, name, state }: { t?: Named; kind?: Kind; name: string; state?: string }) {
  const [word, ...tail] = (state ?? '').split(' · ')
  return (
    <span className="knd">
      <span className="kd">{kind ?? taskKind(t)}</span>
      <span className="kn">{name}</span>
      {word ? <span className="ks">{word}</span> : null}
      {word && tail.length ? <span className="kx">{tail.join(' · ')}</span> : null}
    </span>
  )
}

/** an alert's stored title ("Schedule run · Install merged · Done") as that one line; any other title as it is */
export function KindTitle({ title }: { title: string }) {
  const p = splitKindTitle(title)
  return p ? <KindName kind={p.kind} name={p.name} state={p.what} /> : <>{title}</>
}

/** a quiet line that starts with a task ("Task · Fix login · Asked to allow npm test: answered Yes"): its kind and name
 *  as one line, the name cut on a narrow screen, then what happened, wrapping as words do; any other line as it is */
export function KindLine({ text }: { text: string }) {
  const p = splitKindTitle(text)
  return p ? <><KindName kind={p.kind} name={p.name} /><span className="kw">{p.what}</span></> : <>{text}</>
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
