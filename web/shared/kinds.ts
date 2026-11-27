// Say what each thing is (dmalis/shepherdr, "Chat: say what each thing is"): wherever a chat, an alert or Glance names a
// task by its title, a short kind goes first, so a title that reads like a sentence ("Install merged") never reads as
// news ("the install merged"). The pattern of GitHub's timeline ("Issue"), Linear's ("Issue ENG-12") and Slack's app
// label ("Workflow"): the kind quiet, the name the main words, the state after it.
//   "Task · Fix login · Needs you", "Schedule run · Install merged · Done"

/** the kinds a chat names */
export type Kind = 'Task' | 'Schedule run'

/** a task's kind: a schedule's run says so (its schedule's name rides on it), anything else is a task */
export const taskKind = (t?: { schedule?: string | null } | null): Kind => (t?.schedule ? 'Schedule run' : 'Task')

/** every kind a title can start with, longest first */
const KINDS: Kind[] = ['Schedule run', 'Task']

/** "Task · Fix login": who an alert's title names, its kind first */
export const kindWho = (kind: Kind, name: string) => `${kind} · ${name}`

/** the same for herdr-task's own row (its schedule's name is x.automation): "Schedule run · Install merged" */
export const rowWho = (r: { title?: string; x?: { automation?: unknown } | null }) => kindWho(r.x?.automation ? 'Schedule run' : 'Task', String(r.title ?? ''))

const cut = (s: string, room: number) => (s.length <= room ? s : `${s.slice(0, room - 1).trimEnd()}…`)
const letters = (s: string) => s.replace(/[\s…]/g, '').length

/** a "<kind> · <name> · <what>" title in its parts (the alerts list draws it as one line, its name cut), else null */
export function splitKindTitle(title: string): { kind: Kind; name: string; what: string } | null {
  const kind = KINDS.find((k) => title.startsWith(`${k} · `))
  const at = title.lastIndexOf(' · ')
  return kind && at > kind.length ? { kind, name: title.slice(kind.length + 3, at), what: title.slice(at + 3) } : null
}

/** "<who> · <what>" in n characters (an alert's title, kept whole for the alerts list): a kind title's name is
 *  shortened first, so what happened always shows. Longer still, the caller clips it. */
export function fitWho(who: string, what: string, n: number): string {
  const whole = `${who} · ${what}`
  const kind = KINDS.find((k) => who.startsWith(`${k} · `))
  const room = n - what.length - 3 - (kind ? kind.length + 3 : 0)
  return whole.length <= n || !kind || room < 4 ? whole : `${kind} · ${cut(who.slice(kind.length + 3), room)} · ${what}`
}

/** the fewest letters of a name a cut title keeps before its kind takes a shorter word */
const NAME_MIN = 10

/** a "<kind> · <name> · <what>" title cut to n characters (a watch's line): the name shortened, never what happened.
 *  Too narrow for a readable name, the kind takes its short word ("Run" for a schedule's run), then gives way to the
 *  name: a watch line names the task first (the alerts list and the app keep the whole title). null: nothing to cut. */
export function cutKindTitle(title: string, n: number): string | null {
  if (title.length <= n) return null
  const parts = splitKindTitle(title)
  if (!parts) return null
  const { kind, name, what } = parts
  const short = kind === 'Schedule run' ? 'Run' : kind
  for (const k of [kind, short]) {
    const room = n - k.length - what.length - 6
    // the letters a reader still sees of the name (no spaces, no …)
    if (room > 0 && letters(cut(name, room)) >= Math.min(NAME_MIN, letters(name))) return `${k} · ${cut(name, room)} · ${what}`
  }
  const room = n - what.length - 3
  return room >= 4 ? `${cut(name, room)} · ${what}` : null
}
