// fork "Needs you 6a: wait lifecycle" (the design: fork/specs/needs-you.md): each inferred wait as herdr-task keeps it
// where it happens (mods/tasks/bin/herdr_task/wait_record.py), on the task as `wait`. The service passes it on as the
// task's `wait` only while it is open and of the kind the service reads now, so web/shared/attention.ts keys its
// action by the record (its id, first seen and deadline) instead of a guess from the task's status. A record a newer
// read hasn't caught up with yet (the service reads live, herdr-task each tick) is not passed on: the action keeps its
// old key until the record lands.
import type { WaitRecord } from "../web/shared/types.ts";

const KINDS = new Set(["reply", "attention", "stopped"]);

/** the task's open wait record, checked: raw is the task list's `wait`, needs the kind of wait the service reads now
 *  (core/tasks.js place(): reply, attention, stopped, asks) */
export function waitRecordOf(raw: unknown, needs: string | null | undefined): WaitRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const w = raw as Record<string, unknown>;
  if (w.outcome || typeof w.id !== "string" || !w.id || !KINDS.has(String(w.kind)) || w.kind !== needs) return undefined;
  const first = Number(w.first), deadline = Number(w.deadline);
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(deadline)) return undefined;
  return { id: w.id.slice(0, 64), gen: Math.max(1, Math.floor(Number(w.gen) || 1)), kind: w.kind as WaitRecord["kind"], first, deadline };
}
