// A machine's system facts for Settings › Machines (dmalis/shepherdr#107): its OS, when it started, whether a restart
// is needed, and the Shepherdr and herdr-core it runs. machine_system.py is run on each machine as machine.py is (here
// with python3, another machine through herdr-core), with the plan limits' read: these facts change rarely. Uptime goes
// to the page as the moment it started, on this clock, so it counts on between reads.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Hub } from "./hub.ts";
import { exec } from "./model.ts";
import type { MachineSystem } from "../web/shared/types.ts";
import { when } from "../core/machines.js";

export const SYSTEM_PROBE = join(import.meta.dir, "..", "mods", "tasks", "bin", "herdr_task", "machine_system.py");
// the Shepherdr this service runs: what the machine that serves the app runs, whatever its install record says
const OWN = (() => { try { return String(JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")).version); } catch { return null; } })();

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The probe's line as the page keeps it; null when it gave none. `machine` null: the machine that serves the app. */
export function systemOf(stdout: string | undefined, machine: string | null, now = Date.now(), own: string | null = OWN): MachineSystem | null {
  const line = (stdout ?? "").split("\n").find((l) => l.startsWith("{"));
  if (!line) return null;
  let d: any;
  try { d = JSON.parse(line)?.system; } catch { return null; }
  if (!d || typeof d !== "object") return null;
  const up = typeof d.up === "number" && d.up >= 0 ? d.up : null;
  return {
    at: now,
    os: str(d.os),
    arch: str(d.arch),
    bootAt: up === null ? null : now - up * 1000,
    restart: typeof d.restart === "boolean" ? d.restart : null,
    hc: str(d.hc),
    shepherdr: machine === null ? own ?? str(d.shepherdr) : str(d.shepherdr),
  };
}

// longer than this without a read (herdr-core skips a machine it can't reach): it was away, and may have restarted
const AWAY = 2 * 60_000;

/** Whether to read its system facts with this poll: with the plan limits, until it has them, after a failed read, and
 *  once it answers again after it was away (a restart changes its uptime and clears a waiting restart). */
export const systemDue = (was: { at?: number; error?: string; system?: unknown }, limits: boolean, now = Date.now()) =>
  limits || !!was.error || !was.system || now - (was.at ?? now) > AWAY;

/** A linked machine herdr-core can't reach now: when it last answered, as the warnings line and its card say it
 *  ("last seen Tue 3:05pm"). Not known after the service restarts until it answers once. */
export const lastSeen = (m: string | null, seenAt: number | undefined, connected: string[]) =>
  m !== null && seenAt && !connected.includes(m) ? { unreachableSince: when(seenAt) } : {};

/** Reads a machine's system facts (null: here); null when it can't now (the last read then stays). */
export async function readSystem(hub: Hub, machine: string | null): Promise<MachineSystem | null> {
  if (!existsSync(SYSTEM_PROBE)) return null;
  const r = await exec(hub, ["python3", "-c", readFileSync(SYSTEM_PROBE, "utf8")], machine, 30).catch(() => null);
  return systemOf(r?.stdout, machine);
}
