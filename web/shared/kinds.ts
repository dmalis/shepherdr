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

/** the fewest letters of a name a cut title keeps before its kind takes a shorter word */
const NAME_MIN = 10

/** a "<kind> · <name> · <what>" title cut to n characters (a watch's line): the name shortened, never what happened.
 *  Too narrow for a readable name, the kind takes its short word ("Run" for a schedule's run), then gives way to the
 *  name: a watch line names the task first (the alerts list and the app keep the whole title). null: nothing to cut. */
export function cutKindTitle(title: string, n: number): string | null {
  if (title.length <= n) return null
  const kind = KINDS.find((k) => title.startsWith(`${k} · `))
  const at = title.lastIndexOf(' · ')
  if (!kind || at <= kind.length) return null
  const what = title.slice(at + 3), name = title.slice(kind.length + 3, at)
  const cut = (s: string, room: number) => (s.length <= room ? s : `${s.slice(0, room - 1).trimEnd()}…`)
  const short = kind === 'Schedule run' ? 'Run' : kind
  for (const k of [kind, short]) {
    const room = n - k.length - what.length - 6
    if (room >= Math.min(NAME_MIN, name.length)) return `${k} · ${cut(name, room)} · ${what}`
  }
  const room = n - what.length - 3
  return room >= 4 ? `${cut(name, room)} · ${what}` : null
}
