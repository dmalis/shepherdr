import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastSeen, markAway, systemDue, systemOf, SYSTEM_PROBE } from "./machine-system.ts";
import { Machines } from "./machines.ts";
import { when } from "../core/machines.js";
import { warningsOf } from "./next.ts";

// Machines: more health facts, clearer cards (dmalis/shepherdr#107): machine_system.py's line as the page gets it, and
// the seams the patch hangs on in upstream's service, so the next sync sees a break at once.

const NOW = 1_800_000_000_000;
const line = (system: object) => `noise\n${JSON.stringify({ system })}\n`;

test("the probe's line: uptime becomes when it started, on this clock", () => {
  const s = systemOf(line({ os: "Ubuntu 24.04.1 LTS", arch: "x86_64", up: 3600, restart: true, hc: "0.1.20", shepherdr: "3.2.21" }), "vps", NOW);
  expect(s).toEqual({ at: NOW, os: "Ubuntu 24.04.1 LTS", arch: "x86_64", bootAt: NOW - 3_600_000, restart: true, hc: "0.1.20", shepherdr: "3.2.21" });
});

test("what it can't say stays null; no line is no read", () => {
  expect(systemOf(line({ os: "macOS 15.1", up: null, restart: null, hc: null, shepherdr: null }), "mac", NOW)).toMatchObject({ bootAt: null, restart: null, hc: null, shepherdr: null, arch: null });
  expect(systemOf("", "vps", NOW)).toBeNull();
  expect(systemOf("{not json\n", "vps", NOW)).toBeNull();
  expect(systemOf(undefined, "vps", NOW)).toBeNull();
});

test("the machine serving the app runs this service's Shepherdr, whatever its install record says", () => {
  expect(systemOf(line({ shepherdr: "3.2.20" }), null, NOW, "3.2.22")!.shepherdr).toBe("3.2.22");
  expect(systemOf(line({ shepherdr: "3.2.20" }), "vps", NOW, "3.2.22")!.shepherdr).toBe("3.2.20");
});

test("seams: machines.ts reads the facts with the limits and passes them to the page; next.ts adds the warnings", () => {
  const src = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
  const m = src("machines.ts");
  expect(m).toContain('readSystem(this.hub, m)');
  expect(m).toContain("const sys = systemDue(was, limits, now) ? readSystem(this.hub, m) : null;");
  expect(m).toContain("this.connected = markAway(this.stats, listed, this.connected);");
  expect(m).toContain("if (system) delete out.away;");
  expect(m).toContain("out.seenAt = Date.now();");
  expect(m).toContain("const seen = lastSeen(m, s.seenAt, this.list());");
  expect(m).toContain("...(system ? { system } : {})");
  expect(m).toContain("return { health, stats, ...system,");
  expect(src("next.ts")).toContain("out.push(...moreWarnings(snap.machines));");
  // the probe is sent as text, like machine.py, so an older install there runs this version's
  expect(readFileSync(SYSTEM_PROBE, "utf8")).toContain('if __name__ == "__main__":');
});

test("the warnings line says a restart waits", () => {
  const vm = { id: "m:vm", machine: "vm", name: "vm", status: "idle", system: { at: NOW, os: null, arch: null, bootAt: null, restart: true, hc: null, shepherdr: null } };
  const w = warningsOf({ machines: [{ id: "m:mini", machine: "mini", name: "mini", status: "idle", here: true }, vm] } as any, []);
  expect(w).toEqual([{ id: "m:vm:restart", kind: "machine", text: "vm: restart needed to finish updates" }]);
});

test("the system facts are read again once it answers after it was away (a restart changes them)", () => {
  const sys = { at: NOW } as any;
  expect(systemDue({ at: NOW - 45_000, system: sys }, false, NOW)).toBe(false);
  expect(systemDue({ at: NOW - 45_000, system: sys }, true, NOW)).toBe(true);
  expect(systemDue({ at: NOW - 45_000, system: sys, error: "No answer" }, false, NOW)).toBe(true);
  expect(systemDue({ at: NOW - 45_000 }, false, NOW)).toBe(true);
  // herdr-core skipped it while it couldn't reach it: its last read is old
  expect(systemDue({ at: NOW - 5 * 60_000, system: sys }, false, NOW)).toBe(true);
});

test("last seen: a linked machine herdr-core can't reach, from its last good read", () => {
  const seen = NOW - 3_600_000;
  expect(lastSeen("vm", seen, ["studio"], NOW)).toEqual({ unreachableSince: when(seen) });
  // a week or more ago: its date, not a weekday that would name this week's
  expect(lastSeen("vm", Date.UTC(2027, 0, 5, 12), ["studio"], Date.UTC(2027, 0, 20, 12))).toEqual({ unreachableSince: "Jan 5" });
  expect(lastSeen("vm", seen, ["vm"])).toEqual({});
  expect(lastSeen(null, seen, [])).toEqual({});
  expect(lastSeen("vm", undefined, [])).toEqual({});
});

test("a machine lost at one poll is marked away, and only that one", () => {
  const stats = new Map<string | null, any>([["vm", {}], ["pi", {}]]);
  expect(markAway(stats, ["vm", "pi"], null)).toEqual(new Set(["vm", "pi"]));
  expect(stats.get("vm").away).toBeUndefined();
  expect(markAway(stats, ["pi"], new Set(["vm", "pi"]))).toEqual(new Set(["pi"]));
  expect(stats.get("vm").away).toBe(true);
  expect(stats.get("pi").away).toBeUndefined();
});

test("a machine that restarts within two minutes: its system facts are read again the poll it's back, until one works", async () => {
  const prev = process.env.HERDR_TASK_SETTINGS;
  process.env.HERDR_TASK_SETTINGS = join(mkdtempSync(join(tmpdir(), "shep-away-")), "settings.json");
  try {
    let restart = true, connected = ["vm"], sysFails = false;
    const b64 = (s: string) => Buffer.from(s).toString("base64");
    const hub = {
      call: async (_method: string, p: any) => {
        const sys = String(p.argv[2]).includes("def restart_needed");
        const out = sys ? (sysFails ? "" : JSON.stringify({ system: { os: "Ubuntu 24.04", up: 60, restart, hc: "0.1.22", shepherdr: null } }))
          : JSON.stringify({ health: { cores: 8, load: 1, cpu: 12, memory: 40, disk: 50 } });
        return { code: 0, stdout: b64(out + "\n"), stderr: "" };
      },
    } as any;
    const m = new Machines(hub, () => connected);
    await m.poll();
    expect((m.of("vm") as any).system.restart).toBe(true);
    // it restarts: herdr-core loses it at one poll and has it back at the next, seconds apart
    restart = false;
    connected = [];
    await m.poll();
    connected = ["vm"];
    sysFails = true; // its first read after coming back fails: it stays due
    await m.poll();
    expect((m.of("vm") as any).system.restart).toBe(true);
    expect(m.stats.get("vm").away).toBe(true);
    sysFails = false;
    await m.poll();
    expect((m.of("vm") as any).system.restart).toBe(false);
    expect(m.stats.get("vm").away).toBeUndefined();
  } finally {
    if (prev === undefined) delete process.env.HERDR_TASK_SETTINGS;
    else process.env.HERDR_TASK_SETTINGS = prev;
  }
});
