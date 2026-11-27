import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// The tick itself, against a stand-in herdr-task in an app home of the test's own (the service runs the app home's
// first), for that test only: it logs each pass's start and end, and a pass waits while the hold file is there.
const passes = (log: string) => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
const until = async (ok: () => boolean, ms = 3000) => {
  for (const end = Date.now() + ms; !ok(); await Bun.sleep(20)) if (Date.now() > end) throw new Error("timed out");
};
/** a tick of this machine only (no other machine to reach, no terminals but the test's), its first pass held open */
async function held(run: (t: { hub: any; j: any; passes: () => string[]; release: () => Promise<void> }) => Promise<void>) {
  const was = process.env.HERDR_APP_HOME;
  const app = mkdtempSync(join(tmpdir(), "shep-jobs-"));
  const bin = join(app, "mods", "tasks", "bin"), log = join(app, "ticks.log"), hold = join(app, "hold");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "herdr-task"), `#!/bin/sh
[ "$1" = tick ] || exit 0
echo start >> "${log}"
while [ -e "${hold}" ]; do sleep 0.02; done
echo end >> "${log}"
`, { mode: 0o755 });
  writeFileSync(hold, "");
  process.env.HERDR_APP_HOME = app;
  const hub: any = { terminals: new Map(), on() {} };
  const host: any = { tickOn: () => [], serving: () => true, reachable: () => true, participants: () => new Set(), machines: new Map() };
  const j: any = new Jobs(hub, host);
  const first = j.tick();
  const release = async () => { rmSync(hold, { force: true }); await first; };
  try {
    await until(() => passes(log).length === 1);
    await run({ hub, j, passes: () => passes(log), release });
  } finally {
    clearTimeout(j.soon);
    await release();
    await until(() => !passes(log).length || passes(log).at(-1) === "end").catch(() => {});
    if (was === undefined) delete process.env.HERDR_APP_HOME; else process.env.HERDR_APP_HOME = was;
    rmSync(app, { recursive: true, force: true });
  }
}
const agent = (status: string) => ({ address: "t1", state: "live", status, labels: { "herdr.task": "T-1" } });

test("changes while a tick runs get one tick right after it, never two at once (upstream issue 1615, point 2)", async () => {
  await held(async ({ hub, j, passes, release }) => {
    hub.terminals.set("t1", agent("working"));
    j.onChange();
    // a task's agent changes while the pass runs, twice two seconds apart (and once more within the first two
    // seconds): each change's tick comes while that pass still runs
    for (const status of ["idle", "working"]) {
      hub.terminals.set("t1", agent(status));
      j.onChange();
      if (status === "idle") { hub.terminals.set("t1", agent("blocked")); j.onChange(); }
      await until(() => j.soon === null);
    }
    expect(passes()).toEqual(["start"]);
    await release();
    await until(() => passes().length === 4).catch(() => {});
    await Bun.sleep(300);
    // exactly one follow-up, started only after the first pass ended
    expect(passes()).toEqual(["start", "end", "start", "end"]);
  });
}, 15_000);

test("the 15-second tick that finds one running is still dropped: the next interval takes it", async () => {
  await held(async ({ j, passes, release }) => {
    j.tick();
    j.tick();
    await release();
    await Bun.sleep(300);
    expect(passes()).toEqual(["start", "end"]);
  });
});
