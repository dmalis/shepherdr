import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// who runs the background work: this service, always (3.2: no window takes it), unless SHEPHERDR_JOBS=off
delete process.env.SHEPHERDR_JOBS;
const { jobsOn, agentMachines, Jobs } = await import("./jobs.ts");

test("the service runs the background work unless it is told not to", () => {
  expect(jobsOn()).toBe(true);
  process.env.SHEPHERDR_JOBS = "off";
  expect(jobsOn()).toBe(false);
  delete process.env.SHEPHERDR_JOBS;
});

test("other machines running an Assistant or a revivable agent get ticked (it comes back after a crash)", () => {
  expect(agentMachines([
    { address: "t1", state: "live", labels: { "herdr.role": "coordinator" } },
    { address: "vm/t2", state: "live", labels: { "herdr.role": "coordinator" } },
    { address: "box/t3", state: "live", labels: { "herdr.resume": "{}" } },
    { address: "old/t4", state: "finished", labels: { "herdr.role": "coordinator" } },
    { address: "plain/t5", state: "live", labels: {} },
  ]).sort()).toEqual(["box", "vm"]);
});

// The tick itself, against a stand-in herdr-task (the app home's, which the service runs first; test/preload.ts makes
// that home a throwaway): it logs each pass's start and end, and a pass waits while the hold file is there.
const app = process.env.HERDR_APP_HOME!;
const bin = join(app, "mods", "tasks", "bin");
const log = join(app, "ticks.log");
const hold = join(app, "hold");
mkdirSync(bin, { recursive: true });
writeFileSync(join(bin, "herdr-task"), `#!/bin/sh
[ "$1" = tick ] || exit 0
echo start >> "${log}"
while [ -e "${hold}" ]; do sleep 0.02; done
echo end >> "${log}"
`, { mode: 0o755 });

const passes = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
const until = async (ok: () => boolean, ms = 3000) => {
  for (const end = Date.now() + ms; !ok(); await Bun.sleep(20)) if (Date.now() > end) throw new Error("timed out");
};
/** a tick of this machine only: no other machine to reach, no terminals but the test's */
function jobs() {
  rmSync(log, { force: true });
  const hub: any = { terminals: new Map(), on() {} };
  const host: any = { tickOn: () => [], serving: () => true, reachable: () => true, participants: () => new Set(), machines: new Map() };
  return { hub, j: new Jobs(hub, host) as any };
}

test("a change while a tick runs gets one tick right after it, never two at once (upstream issue 1615, point 2)", async () => {
  const { hub, j } = jobs();
  writeFileSync(hold, "");
  const first = j.tick();
  await until(() => passes().length === 1);
  // a task's agent changes while the pass runs: its tick two seconds later comes while that pass still runs
  hub.terminals.set("t1", { address: "t1", state: "live", status: "working", labels: { "herdr.task": "SD-1" } });
  j.onChange();
  hub.terminals.set("t1", { address: "t1", state: "live", status: "idle", labels: { "herdr.task": "SD-1" } });
  j.onChange();
  await until(() => j.soon === null, 3000);
  // more changes' ticks land meanwhile: they make no second follow-up
  j.tick(true);
  j.tick(true);
  await Bun.sleep(100);
  expect(passes()).toEqual(["start"]);
  rmSync(hold);
  await first;
  await until(() => passes().length === 4).catch(() => {});
  await Bun.sleep(300);
  // exactly one follow-up, started only after the first pass ended
  expect(passes()).toEqual(["start", "end", "start", "end"]);
}, 10_000);

test("the 15-second tick that finds one running is still dropped: the next interval takes it", async () => {
  const { j } = jobs();
  writeFileSync(hold, "");
  const first = j.tick();
  await until(() => passes().length === 1);
  j.tick();
  j.tick();
  rmSync(hold);
  await first;
  await Bun.sleep(300);
  expect(passes()).toEqual(["start", "end"]);
});
