// The Changes pane's plain rules, kept apart from its drawing so they can be tested.
import type { Snapshot, Task } from '@shared/types.ts'
import type { IconName } from '@client/icons.ts'
import { isEverything, placeOf, spaceLabel, spacesOf, tasksIn, tstate } from '@shared/view.ts'

/** a task with a folder to read: it has begun and isn't done (a finished task's worktree is removed) */
export function hasFolder(t: Task) {
  const s = tstate(t)
  return s !== 'done' && s !== 'archived' && (s !== 'next' || !!t.started)
}

const STATE_WORD: Record<string, string> = { ready: 'Ready for review', ask: 'Needs you', working: 'Working', next: 'Up next' }

/** what the pane can show, in order: this view's tasks (newest news first), then its space's folder (from Everything:
 *  every space's) */
export function sourcesOf(snap: Snapshot, at: string): { key: string; label: string; sub: string; icon: IconName }[] {
  const tasks = tasksIn(snap, at).filter(hasFolder).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  const spaces = isEverything(snap, at) ? spacesOf(snap).filter((p) => !p.archived) : [placeOf(snap, at)].filter((p) => !!p)
  return [
    ...tasks.map((t) => ({ key: `task:${t.id}`, label: t.name, sub: STATE_WORD[tstate(t)] ?? '', icon: 'tasks' as IconName })),
    ...spaces.map((p) => ({ key: `space:${p.id}`, label: `${spaceLabel(snap, p.id)} folder`, sub: p.machine && p.machine !== snap.host ? `Not committed · ${p.machine}` : 'Not committed', icon: 'folder' as IconName })),
  ]
}

/** "web/src/App.tsx" -> dir "web/src", name "App.tsx" */
export function splitPath(path: string) {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) }
}

/** one line of a unified diff: added, taken out, kept, a hunk's start, or git's own header lines (not shown) */
export function lineKind(l: string): 'add' | 'del' | 'ctx' | 'hunk' | 'meta' {
  if (l.startsWith('@@')) return 'hunk'
  if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|Binary files)/.test(l)) return 'meta'
  if (l.startsWith('\\')) return 'meta'
  if (l.startsWith('+')) return 'add'
  if (l.startsWith('-')) return 'del'
  return 'ctx'
}

/** what the pane asked for, as it came: its answer and when; `stale` when a refresh failed over a good answer, which
 *  stays shown (saved from before) with the error and when it was had */
export type Got<T> = { url: string; v: T | { error: string }; at: number; stale?: { at: number; why: string } }
const failed = (v: unknown): v is { error: string } => !!v && typeof v === 'object' && 'error' in v

/** an answer in: a good one or a first failure replaces what was had; a failure over a good answer for the same address
 *  keeps it, marked stale */
export function settled<T>(was: Got<T> | null, url: string, v: T | { error: string }, now: number): Got<T> {
  if (failed(v) && was && was.url === url && !failed(was.v)) return { ...was, stale: { at: was.stale?.at ?? was.at, why: v.error } }
  return { url, v, at: now }
}
