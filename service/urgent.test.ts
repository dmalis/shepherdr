// dmalis/shepherdr#119 (fork/specs/urgent-tasks.md, slice 2): urgent tasks in the service. The snapshot's field from
// herdr-task's raw list, by its one rule (web/shared/urgent.ts); the task-urgent action on the task's own machine (two
// machines with the same key), read again at once, and an older herdr-task's refusal of the flag said plainly. Fake
// data, Bun.spawn faked: nothing runs.
import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "./actions.ts";
import { Compat } from "./compat.ts";

test("the row and the snapshot's task: urgent only while herdr-task's rule says so", async () => {
  const { Model } = await import("./model.ts");
  const stored = [
    { id: 1, title: "Fix checkout", state: "running", urgent: 1_700_000_000_000 },
    { id: 2, title: "Tidy footer", state: "running" },
    // done after it was marked, then reopened: not urgent
    { id: 3, title: "Order export", state: "running", urgent: 1_700_000_000_000, done_at: 1_700_000_100_000 },
    { id: 4, title: "Old report", state: "done", urgent: 1_700_000_000_000, done_at: 1_700_000_100_000 },
    { id: 5, title: "Archived one", state: "todo", urgent: 1_700_000_000_000, archived: true },
  ];
  const m = new Model({ terminals: new Map(), on: () => () => {} } as any, { put: () => {} } as any) as any;
  m.lists = new Map([[null, [{ slug: "shop", name: "shop", prefix: "SHOP", folder: "/srv/shop", machine: null, tasks: stored }]]]);
  m.value = () => undefined;
  let rows: any[] = [];
  m.onBuild = (b: any) => { rows = b.rows; };
  try { m.build(); } catch { /* the spaces half needs more of the service; the rows are made first */ }
  rows = rows.length ? rows : m.rows;
  if (m.settleTimer) clearTimeout(m.settleTimer);
  expect(rows.map((r: any) => [r.title, r.urgent])).toEqual([["Fix checkout", true], ["Tidy footer", false], ["Order export", false], ["Old report", false], ["Archived one", false]]);

  // compat copies it onto the web's Task, and only when true (an old client ignores it)
  const c = new Compat() as any;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  c.shared = { value: () => undefined, set: async () => {} };
  c.host = "mini";
  const snap = c.snapshot({ host: "mini", user: "me", machines: [{ name: "mini", here: true, state: "connected" }], spaces: [{ id: "sp1", name: "shop", folder: "/srv/shop" }], sections: [],
    rows: rows.filter((r: any) => r.section !== "done") });
  const by = (name: string) => snap.tasks.find((t: any) => t.name === name);
  expect(by("Fix checkout").urgent).toBe(true);
  expect("urgent" in by("Tidy footer")).toBe(false);
  expect("urgent" in by("Order export")).toBe(false);
});

function world() {
  const c = new Compat() as any;
  // the same key on two machines: the chat names which one, from the snapshot
  c.taskOf = (id: string) => (id === "SHOP-1" ? { ref: "SHOP-1", folder: "/srv/shop", machine: null } : id === "vm-a:SHOP-1" ? { ref: "SHOP-1", folder: "/srv/shop", machine: "vm-a" } : null);
  return { c, hub: { terminals: new Map() } as any };
}

async function spawned(run: () => Promise<unknown>, answer = { code: 0, stdout: '{"ok":true}', stderr: "" }) {
  const ran: string[][] = [];
  const spy = spyOn(Bun, "spawn").mockImplementation(((argv: string[]) => {
    ran.push(argv);
    return { stdout: new Blob([answer.stdout]).stream(), stderr: new Blob([answer.stderr]).stream(), exited: Promise.resolve(answer.code) } as any;
  }) as any);
  try { return { out: await run(), ran }; } finally { spy.mockRestore(); }
}

test("Mark as urgent runs herdr-task edit --urgent on the task's own machine; Mark as not urgent --urgent off", async () => {
  const w = world();
  const here = await spawned(() => act(w.hub, { type: "task-urgent", chat: "SHOP-1/worker", on: true }, w.c));
  expect(here.out).toEqual({ ok: true });
  expect(here.ran).toEqual([["herdr-task", "edit", "SHOP-1", "--urgent", "--folder", "/srv/shop", "--json"]]);
  const there = await spawned(() => act(w.hub, { type: "task-urgent", chat: "vm-a:SHOP-1/worker", on: false }, w.c));
  expect(there.ran).toEqual([["herdr-task", "--on", "vm-a", "edit", "SHOP-1", "--urgent", "off", "--folder", "/srv/shop", "--json"]]);
});

test("refused: a task that isn't here, and on that isn't true or false", async () => {
  const w = world();
  await expect(act(w.hub, { type: "task-urgent", chat: "SHOP-9/worker", on: true }, w.c)).rejects.toThrow("That task isn't here any more.");
  const bad = await spawned(() => act(w.hub, { type: "task-urgent", chat: "SHOP-1/worker", on: "yes" }, w.c).catch((e) => (e as Error).message));
  expect(bad.out).toBe("bad input");
  expect(bad.ran).toEqual([]);
});

test("herdr-task's refusal comes back in its words; an older one on another machine says it needs the update", async () => {
  const w = world();
  const done = await spawned(() => act(w.hub, { type: "task-urgent", chat: "SHOP-1/worker", on: true }, w.c),
    { code: 1, stdout: '{"error":"Fix checkout is done: only an open task can be urgent."}', stderr: "" });
  expect(done.out).toEqual({ ok: false, error: "Fix checkout is done: only an open task can be urgent." });
  const old = await spawned(() => act(w.hub, { type: "task-urgent", chat: "vm-a:SHOP-1/worker", on: true }, w.c),
    { code: 2, stdout: "", stderr: "usage: herdr-task [-h] ...\nherdr-task: error: unrecognized arguments: --urgent\n" });
  expect(old.out).toEqual({ ok: false, error: "vm-a needs Shepherdr's update to mark tasks urgent." });
});

test("pins: a remote toggle is read again at once (TASK_ACTS), and the voice data knows it as a change", () => {
  const main = readFileSync(join(import.meta.dir, "main.ts"), "utf8");
  const acts = main.match(/const TASK_ACTS = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";
  expect(acts).toContain('"task-urgent"');
  expect(main).toContain("const onTask = TASK_ACTS.has(body?.type) && ref ? compat.taskOf(ref) : null;");
  expect(main).toContain("if (onTask?.machine && (r as any)?.ok !== false) await Promise.race([model.reread(onTask.machine), Bun.sleep(4000)]);");
  const voice = readFileSync(join(import.meta.dir, "voice-data.ts"), "utf8");
  expect(voice).toContain('"task-urgent"');
  // the row reads the raw task through the one rule
  expect(readFileSync(join(import.meta.dir, "model.ts"), "utf8")).toContain("urgent: isUrgent(task),");
});
