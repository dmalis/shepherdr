// Urgent tasks (dmalis/shepherdr#119, fork/specs/urgent-tasks.md): the person marks a task urgent, "this one first".
// One rule, the same as herdr-task's (mods/tasks/bin/herdr_task/urgent.py urgent_now): a task is urgent while its
// `urgent` time is set, it is open, it isn't archived and it hasn't been done since it was marked. So Done by any path
// ends it, and nothing that reopens a task brings it back. The service reads it here from the raw task (service/model.ts);
// the app gets `urgent: true` on the task, and lists urgent tasks first in Working and Up next (urgentFirst). Needs you,
// Done and Archived keep their own order. In the one action list (web/shared/attention.ts inOrder), Shepherdr's own
// waits on urgent tasks come first (urgentWaitsFirst); the person's actions keep theirs.

const OPEN = new Set(['todo', 'scheduled', 'queued', 'running', 'ready'])

/** THE rule, on herdr-task's own task record: marked (ms), open, not archived, and not done since it was marked. */
export function isUrgent(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false
  const t = raw as { urgent?: unknown; state?: unknown; archived?: unknown; done_at?: unknown }
  const at = t.urgent
  if (typeof at !== 'number' || !(at > 0)) return false
  const done = typeof t.done_at === 'number' ? t.done_at : 0
  return typeof t.state === 'string' && OPEN.has(t.state) && !t.archived && at > done
}

/** Urgent ones first, each part in the order it came in (a stable partition): Working's and Up next's order. */
export function urgentFirst<T extends { urgent?: boolean }>(tasks: T[]): T[] {
  const first = tasks.filter((t) => t.urgent)
  return first.length && first.length < tasks.length ? [...first, ...tasks.filter((t) => !t.urgent)] : tasks
}

/** Shepherdr's own open actions (owner shepherdr: its waits) on an urgent task first, each part in the order it came in
 *  (a stable partition): the one action list's order (web/shared/attention.ts inOrder). The person's keep their order. */
export function urgentWaitsFirst<A extends { owner: string; task?: string; tasks?: string[] }>(actions: A[], tasks: { id: string; urgent?: boolean }[]): A[] {
  const urgent = new Set(tasks.filter((t) => t.urgent).map((t) => t.id))
  if (!urgent.size) return actions
  const first = (a: A) => a.owner === 'shepherdr' && (a.tasks ?? (a.task ? [a.task] : [])).some((id) => urgent.has(id))
  const lead = actions.filter(first)
  return lead.length ? [...lead, ...actions.filter((a) => !first(a))] : actions
}
