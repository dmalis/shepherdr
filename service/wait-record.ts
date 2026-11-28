// fork "Needs you 6a: wait lifecycle" (the design: fork/specs/needs-you.md): each inferred wait as herdr-task keeps it
// where it happens (mods/tasks/bin/herdr_task/wait_record.py), on the task as `wait`. The service passes it on as the
// task's `wait` only while it is open and of the kind the service reads now, so web/shared/attention.ts keys its
// action by the record (its id, first seen and deadline) instead of a guess from the task's status. A wait whose record
// hasn't landed yet (the service reads live, herdr-task each tick) stays Shepherdr's, quiet, until it has.
import type { HandUp, WaitRecord } from "../web/shared/types.ts";

const KINDS = new Set(["reply", "attention", "stopped"]);

/** the task's open wait record, checked: raw is the task list's `wait`, needs the kind of wait the service reads now
 *  (core/tasks.js place(): reply, attention, stopped, asks) */
export function waitRecordOf(raw: unknown, needs: string | null | undefined): WaitRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const w = raw as Record<string, unknown>;
  if (w.outcome || typeof w.id !== "string" || !w.id || !KINDS.has(String(w.kind)) || w.kind !== needs) return undefined;
  const first = Number(w.first), deadline = Number(w.deadline);
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(deadline)) return undefined;
  const up = handUpOf(w.up);
  return { id: w.id.slice(0, 64), gen: Math.max(1, Math.floor(Number(w.gen) || 1)), kind: w.kind as WaitRecord["kind"], first, deadline, ...(up ? { up } : {}) };
}

/** fork "Needs you 6b": the wait's hand-up (herdr_task/hand_up.py), checked */
export function handUpOf(raw: unknown): HandUp | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const at = Number(u.at), what = typeof u.what === "string" ? u.what.trim().slice(0, 120) : "";
  if (!Number.isFinite(at) || at <= 0 || !what || typeof u.lead !== "string" || !u.lead) return undefined;
  const why = typeof u.why === "string" ? u.why.trim().slice(0, 300) : "";
  const choices = Array.isArray(u.choices) ? [...new Set(u.choices.filter((c): c is string => typeof c === "string").map((c) => c.trim().slice(0, 60)).filter(Boolean))].slice(0, 4) : [];
  const settled = Number(u.settled);
  return { at, what, lead: u.lead.slice(0, 64), ...(why ? { why } : {}), ...(choices.length ? { choices } : {}), ...(Number.isFinite(settled) && settled > 0 ? { settled } : {}) };
}

/** what a task carries of its wait (service/next.ts enrich): x is its row's facts (service/model.ts: wait, keeps_waits),
 *  needs the kind the service reads now, waiting whether it is under Needs you. Its open record; else, from a source
 *  that keeps records, waitPending while an inferred wait's record hasn't landed (it stays quiet until it has, so it is
 *  told once, under the id that lasts); else nothing (an older herdr-task: the old key). */
export function waitOf(x: { wait?: unknown; keeps_waits?: boolean }, needs: string | null | undefined, waiting: boolean): { wait?: WaitRecord; waitPending?: true } {
  if (!waiting) return {};
  const wait = waitRecordOf(x.wait, needs);
  if (wait) return { wait };
  return x.keeps_waits && KINDS.has(String(needs)) ? { waitPending: true } : {};
}
