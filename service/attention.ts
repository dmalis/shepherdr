// fork Needs you 5/6, one list: the service works out every open action once per snapshot (web/shared/attention.ts
// projectAttention, the one rule) and sends it with the snapshot, each task carrying its lead action. The pages' counts
// and lists, the app badge, the glance feed and which alerts may reach a device (service/push.ts alertsOf) all read
// this one result, so they never disagree. The design: fork/specs/needs-you.md.
import { byAge, projectAttention, withActions, type Action } from "../web/shared/attention.ts";
import type { Snapshot } from "../web/shared/types.ts";

/** fork Needs you 6b: when the next wait Shepherdr handles reaches its hand-up deadline (ms), past `now`; none: no wait
 *  has one ahead. A wait on a machine that can't be read hands up nothing until it is read again. */
export function nextHandUp(actions: Action[], now = Date.now()): number | undefined {
  let next: number | undefined;
  for (const a of actions)
    if (a.kind === "wait" && a.owner === "shepherdr" && !a.stale && typeof a.deadline === "number" && a.deadline > now && (next === undefined || a.deadline < next)) next = a.deadline;
  return next;
}

let handUpTimer: ReturnType<typeof setTimeout> | null = null;
let handUpAt: number | undefined;
/** fork Needs you 6b: the snapshot is worked out again when the next deadline comes, so a wait still open then is the
 *  person's at that moment (its one alert goes then), not at the next unrelated change. rebuild: the model's. */
export function wakeForHandUp(snap: Pick<Snapshot, "attention">, rebuild: () => void, now = Date.now()) {
  const at = nextHandUp(snap.attention?.actions ?? [], now);
  if (at === handUpAt) return;
  if (handUpTimer) clearTimeout(handUpTimer);
  handUpTimer = null;
  handUpAt = at;
  if (at === undefined) return;
  handUpTimer = setTimeout(() => { handUpTimer = null; handUpAt = undefined; rebuild(); }, Math.min(at - now + 250, 2 ** 31 - 1));
  (handUpTimer as any).unref?.();
}

/** each other machine's open actions as last read (by its machine key): kept while it can't be read */
const held = new Map<string, Action[]>();

/** the snapshot with its open actions (snapshot.attention) and each task's lead action (task.action), at `now` */
export function attend<S extends Snapshot>(snap: S, now = Date.now(), memo = held): S {
  const att = projectAttention({ ...snap, attention: undefined }, now);
  const withIt = withActions(snap, { at: att.at, actions: keepLast(snap, att.actions, memo) });
  // in place: the service's snapshot is one object its later steps (push, glance, the inbox) read from
  snap.tasks = withIt.tasks;
  snap.attention = withIt.attention;
  return snap;
}

/**
 * A machine that can't be read now keeps the actions it had when it was last read, each saying so (stale: "Can't check
 * <machine> right now"), in place of what its kept rows would say on their own (its agents' prompts and cards come
 * from its live terminals, gone while it is away). A kept action whose task is gone, done or archived, or whose space is
 * gone, goes. One read since the service started is needed: before that, its rows say what they can.
 */
export function keepLast(snap: Pick<Snapshot, "tasks" | "places"> & Partial<Pick<Snapshot, "machines">>, actions: Action[], memo: Map<string, Action[]>): Action[] {
  const others = (snap.machines ?? []).filter((m) => !m.here);
  const tasks = new Map((snap.tasks ?? []).map((t) => [t.id, t]));
  const places = new Map((snap.places ?? []).map((p) => [p.id, p]));
  const machineOf = (a: Action) => (a.task ? tasks.get(a.task)?.on : undefined) || places.get(a.place)?.machine;
  let out = actions;
  for (const m of others) {
    if (m.status !== "off") { memo.set(m.machine, actions.filter((a) => machineOf(a) === m.machine)); continue; }
    const last = memo.get(m.machine);
    if (!last) continue;
    const kept = last.filter((a) => {
      const t = a.task ? tasks.get(a.task) : undefined;
      return a.task ? !!t && !t.archived && t.status !== "done" : places.has(a.place);
    }).map((a) => ({ ...a, stale: m.name }));
    out = [...out.filter((a) => machineOf(a) !== m.machine), ...kept];
  }
  // a machine no longer listed: forgotten
  for (const k of [...memo.keys()]) if (!others.some((m) => m.machine === k)) memo.delete(k);
  return out === actions ? actions : [...out].sort(byAge);
}
