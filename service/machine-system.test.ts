import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { systemOf, SYSTEM_PROBE } from "./machine-system.ts";
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
  expect(m).toMatch(/const sys = limits \|\| was\.error \|\| !was\.system \? readSystem/);
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
