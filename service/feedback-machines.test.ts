// Every linked machine's problems on one Feedback page (friction loop, slice 8, #94): each machine's list read there
// through herdr-core's machine.exec with herdr-task's own explicit path, rows told apart by machine and id, a call going
// to its row's machine; out of reach, older and without Shepherdr each shown as they are, and nothing installed.
import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Feedback, type Runner } from "./feedback.ts";
import { FeedbackMachines, READ_OLD, RUN, thereArgv, type Exec } from "./feedback-machines.ts";
import { spawn } from "./spawn.ts";

const NOW = Date.UTC(2026, 10, 28, 12);
const H = 3600_000;
const prob = (id: string, line: string, x: Record<string, unknown> = {}) =>
  ({ id, key: id, line, state: "found", count: 1, at: NOW - H, space: "sp1", reports: [{ at: (x.at as number) ?? NOW - H, from: { task: "Sticker book" }, space: "sp1" }], ...x });

type Call = { machine: string; argv: string[] };
/** a herdr-core whose machine.exec answers from `answer` (a thrown Error: the link is down) */
const core = (answer: (c: Call) => { code?: number; stdout?: string; stderr?: string } | Error) => {
  const calls: Call[] = [];
  const exec: Exec = async (machine, argv) => {
    calls.push({ machine, argv });
    const a = answer({ machine, argv });
    if (a instanceof Error) throw a;
    return { code: 0, stdout: "", stderr: "", ...a };
  };
  return { exec, calls };
};
const local = (rows: unknown[]) => {
  const calls: string[][] = [];
  const run: Runner = async (args) => { calls.push(args); return { code: 0, stdout: JSON.stringify(args.includes("--list") ? rows : { key: "a1", changed: true }), stderr: "" }; };
  return { run, calls };
};
const page = (here: ReturnType<typeof local>, exec: Exec, machines: { name: string; state: string; temporary?: boolean }[]) => {
  const fb = new Feedback(here.run, () => "/nonexistent/.feedback.json", () => ({}), () => true);
  fb.there.exec = exec;
  fb.there.machines = async () => machines;
  return fb;
};
const listing = (c: Call) => c.argv.join(" ") === thereArgv(["--list", "--all", "--json"]).join(" ");

test("two machines' lists merge, each row named by its machine; one id on both stays two rows", async () => {
  const here = local([prob("a1", "The reply bubble doesn't show which message it answers", { at: NOW - 3 * H })]);
  const c = core(({ machine }) => ({ stdout: JSON.stringify(machine === "studio"
    ? [prob("a1", "The reply bubble doesn't show which message it answers", { at: NOW - 2 * H }), prob("b2", "Ready refused a reviewed commit", { at: NOW - H })]
    : [prob("a1", "The reply bubble doesn't show which message it answers")]) }));
  const fb = page(here, c.exec, [{ name: "studio", state: "connected" }, { name: "lab", state: "connected" }, { name: "tmp1", state: "connected", temporary: true }]);
  await fb.read();
  await fb.readThere();
  const l = fb.list(NOW)!;
  expect(l.rows.map((r) => [r.machine ?? "here", r.id])).toEqual([["lab", "a1"], ["studio", "b2"], ["studio", "a1"], ["here", "a1"]]);
  expect(l.found).toBe(4);
  // another machine's space is named as its places are ("studio/sp1"), so Write it up reaches its chat there
  expect(l.rows.find((r) => r.machine === "studio" && r.id === "b2")!.space).toBe("studio/sp1");
  expect(l.rows.find((r) => !r.machine)!.space).toBe("sp1");
  expect(l.machines).toBeUndefined();
  expect(l.rows.some((r) => r.readOnly)).toBe(false);
  // a temporary machine isn't read; each linked one once, through herdr-task's own path there
  expect(c.calls.map((x) => x.machine).sort()).toEqual(["lab", "studio"]);
  expect(c.calls.every(listing)).toBe(true);
});

test("an action goes to its row's machine, and that machine's list is read again; this machine's stay here", async () => {
  const here = local([prob("a1", "x")]);
  const c = core((x) => ({ stdout: listing(x) ? JSON.stringify([prob("a1", "x")]) : JSON.stringify({ key: "a1", changed: true }) }));
  const fb = page(here, c.exec, [{ name: "studio", state: "connected" }, { name: "lab", state: "connected" }]);
  await fb.read();
  await fb.readThere();
  c.calls.length = 0;
  here.calls.length = 0;
  expect(await fb.act({ do: "later", key: "a1", when: "week", machine: "studio" })).toEqual({ ok: true, key: "a1", changed: true });
  expect(c.calls.map((x) => [x.machine, x.argv.slice(5).join(" ")])).toEqual([["studio", "--key a1 --later week --json"], ["studio", "--list --all --json"]]);
  expect(c.calls[0].argv.slice(0, 4)).toEqual(["sh", "-c", RUN, "herdr-task"]);
  expect(here.calls).toEqual([]);
  c.calls.length = 0;
  expect((await fb.act({ do: "no", key: "a1" })).ok).toBe(true);
  expect(here.calls[0]).toEqual(["--key", "a1", "--no", "--person", "--json"]);
  expect(c.calls).toEqual([]);
  // the box's reports stay on this machine; a machine that isn't linked is refused
  expect((await fb.act({ do: "report", text: "x", space: "sp1", machine: "studio" })).ok).toBe(false);
  expect(await fb.act({ do: "no", key: "a1", machine: "elsewhere" })).toEqual({ ok: false, error: "That machine isn't linked any more." });
  expect(await fb.act({ do: "no", key: "a1", machine: "../x" })).toEqual({ ok: false, error: "That machine isn't linked any more." });
  expect(c.calls).toEqual([]);
});

test("an unreachable machine's rows show as of their last read, stale, with their actions off", async () => {
  let down = false;
  const c = core((x) => (down ? new Error("link lost") : { stdout: listing(x) ? JSON.stringify([prob("a1", "x")]) : "{}" }));
  const machines = [{ name: "studio", state: "connected" }, { name: "lab", state: "connected" }];
  const fb = page(local([]), c.exec, machines);
  await fb.read();
  await fb.readThere();
  // studio's link drops (herdr-core says so); lab's read fails as it goes
  machines[0].state = "disconnected";
  down = true;
  await fb.readThere();
  const l = fb.list(NOW)!;
  expect(l.rows.map((r) => [r.machine, r.readOnly])).toEqual([["lab", "stale"], ["studio", "stale"]]);
  expect(l.machines!.map((m) => [m.name, m.state])).toEqual([["lab", "stale"], ["studio", "stale"]]);
  c.calls.length = 0;
  expect(await fb.act({ do: "later", key: "a1", when: "week", machine: "studio" })).toEqual({ ok: false, error: "studio can't be reached just now: try again once it's back." });
  expect(c.calls).toEqual([]);
  // back: read again, and acted on again
  down = false;
  machines[0].state = "connected";
  await fb.readThere();
  expect(fb.list(NOW)!.rows.every((r) => !r.readOnly)).toBe(true);
  expect(fb.list(NOW)!.machines).toBeUndefined();
  // a machine removed from Settings › Machines takes its rows with it
  machines.splice(1, 1);
  await fb.readThere();
  expect(fb.list(NOW)!.rows.map((r) => r.machine)).toEqual(["studio"]);
});

test("an older machine's record is read as a file, its rows read only; nothing there runs its own --list", async () => {
  const old = { problems: { k1: { line: "The service skipped a tick", state: "told", at: NOW - H, space: "sp2" } } };
  const c = core((x) => (listing(x) ? { code: 2, stderr: "usage: herdr-task feedback ...\nherdr-task: error: unrecognized arguments: --all" }
    : x.argv[2] === READ_OLD ? { stdout: JSON.stringify(old) } : { code: 2, stderr: "herdr-task: error: unrecognized arguments: --later" }));
  const fb = page(local([]), c.exec, [{ name: "old-mac", state: "connected" }]);
  await fb.read();
  await fb.readThere();
  const l = fb.list(NOW)!;
  expect(l.rows.map((r) => [r.machine, r.id, r.readOnly, r.space, r.section])).toEqual([["old-mac", "k1", "old", "old-mac/sp2", "found"]]);
  expect(l.machines).toEqual([{ name: "old-mac", state: "old", at: expect.any(Number) }]);
  // only its list (refused) and the file read: an older herdr-task's --list rewrites and prunes its record
  expect(c.calls.map((x) => (listing(x) ? "list" : x.argv[2] === READ_OLD ? "cat" : x.argv.join(" ")))).toEqual(["list", "cat"]);
  expect(READ_OLD).toContain('exec cat -- "$SHEP_TASKS/.feedback.json"');
  c.calls.length = 0;
  expect(await fb.act({ do: "no", key: "k1", machine: "old-mac" })).toEqual({ ok: false, error: "Update Shepherdr on old-mac to act on these here." });
  expect(c.calls).toEqual([]);
});

test("a machine whose herdr-task can't do one call yet says to update it", async () => {
  const m = new FeedbackMachines(core((x) => (listing(x) ? { stdout: "[]" } : { code: 2, stderr: "herdr-task: error: unrecognized arguments: --follow" })).exec,
    async () => [{ name: "studio", state: "connected" }]);
  await m.read();
  const r = await m.run("studio", ["--key", "a1", "--follow", "https://github.com/example/shepherdr/issues/3", "--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ error: "Update Shepherdr on studio to do this here." });
});

// a real shell, as a core started by launchd or systemd runs a remote command: PATH=/usr/bin:/bin, herdr-task only at
// ~/.local/bin (a throwaway HOME here, for the child alone)
const bare = (home: string): Exec => async (_m, argv) => {
  const p = spawn(argv, { env: { PATH: "/usr/bin:/bin", HOME: home }, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
};

test("listing and an action work with the remote command's PATH set to /usr/bin:/bin", async () => {
  const home = mkdtempSync(join(tmpdir(), "fb-there-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const bin = join(home, ".local", "bin", "herdr-task");
  writeFileSync(bin, `#!/bin/sh
echo "$*" >> "$HOME/calls"
case "$*" in
  *--list*) echo '[{"id":"a1","key":"a1","line":"The reply bubble doesn\\u0027t show which message it answers","state":"found","count":1,"at":1,"space":"sp1"}]';;
  *) echo '{"key":"a1","changed":true}';;
esac
`);
  chmodSync(bin, 0o755);
  const fb = page(local([]), bare(home), [{ name: "studio", state: "connected" }]);
  await fb.read();
  await fb.readThere();
  expect(fb.list(NOW)!.rows.map((r) => [r.machine, r.id])).toEqual([["studio", "a1"]]);
  expect(await fb.act({ do: "later", key: "a1", when: "tomorrow", machine: "studio" })).toEqual({ ok: true, key: "a1", changed: true });
  expect(readFileSync(join(home, "calls"), "utf8").trim().split("\n")).toEqual([
    "feedback --list --all --json", "feedback --key a1 --later tomorrow --json", "feedback --list --all --json"]);
});

test("a machine without herdr-task installs nothing and says so", async () => {
  const home = mkdtempSync(join(tmpdir(), "fb-none-"));
  const calls: string[][] = [];
  const real = bare(home);
  const fb = page(local([]), async (m, argv, t) => { calls.push(argv); return real(m, argv, t); }, [{ name: "studio", state: "connected" }]);
  await fb.read();
  await fb.readThere();
  const l = fb.list(NOW)!;
  expect(l.rows).toEqual([]);
  expect(l.machines).toEqual([{ name: "studio", state: "none", at: expect.any(Number) }]);
  // one read, and nothing written or copied there
  expect(calls).toEqual([thereArgv(["--list", "--all", "--json"])]);
  expect(await fb.act({ do: "no", key: "a1", machine: "studio" })).toEqual({ ok: false, error: "Shepherdr isn't set up on studio." });
  expect(calls.length).toBe(1);
});

test("no call uses herdr-task --on (it copies its bundle over), nor hc's own file writes", () => {
  for (const f of ["feedback-machines.ts", "feedback.ts"]) {
    const src = readFileSync(join(import.meta.dir, f), "utf8");
    expect(src).not.toMatch(/["']--on["']/);
    expect(src).not.toMatch(/file\.write|"file", "write"/);
  }
  // the explicit path herdr-task's own remote calls use (herdr_task/cli.py remote_run): a bare PATH can't hide it
  const cli = readFileSync(join(import.meta.dir, "..", "mods", "tasks", "bin", "herdr_task", "cli.py"), "utf8");
  expect(cli).toContain(`'${RUN}'`);
});

test("other machines are read only while a page is open and the plugin is on", async () => {
  const c = core(() => ({ stdout: "[]" }));
  let open = false, on = true;
  const fb = new Feedback(local([]).run, () => "/nonexistent/.feedback.json", () => ({}), () => on);
  fb.there.exec = c.exec;
  fb.there.machines = async () => [{ name: "studio", state: "connected" }];
  fb.watched = () => open;
  await fb.readThere();
  expect(c.calls).toEqual([]);
  open = true;
  on = false;
  await fb.readThere();
  expect(c.calls).toEqual([]);
  on = true;
  await fb.readThere();
  expect(c.calls.length).toBe(1);
});
