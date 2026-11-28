// fork "Needs you 6a: wait lifecycle": an inferred wait is keyed by the record herdr-task keeps where it happens
// (herdr_task/wait_record.py), not by a guess from the task's status. The acceptance cases of fork/specs/needs-you.md's
// part 6a, service side. Made-up data.
import { expect, test } from "bun:test";
import { attend } from "./attention.ts";
import { alertsOf, pushChanges } from "./push.ts";
import { waitRecordOf } from "./wait-record.ts";
import { yours } from "../web/shared/attention.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;
const place = (id: string, machine: string, x: any = {}) => ({ id, name: id.split(":").pop(), machine, level: 0, status: "idle", mode: "regular", chat: id, shepherdr: "running", ...x });
const task = (id: string, pl: string, x: any = {}) => ({ id, name: `Task ${id}`, place: pl, status: "need", state: "need", created: "", age: "", at: NOW - 30 * min, needsAt: NOW - 30 * min, agent: { chat: `${id}/worker`, role: "worker", cli: "claude", status: "need", running: true, age: "", note: "" }, ...x });
const rec = (id: string, gen: number, first: number) => ({ id, gen, kind: "reply" as const, first, deadline: first + 5 * min });
const machines = [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Build box", status: "idle" }];
// a space whose Shepherdr chat isn't running: its inferred waits are the person's at once, so they count and push
const snapOf = (wait: any, x: any = {}) => ({ name: "", host: "box", user: "", demo: false, everything: "p:box:root", machines,
  places: [place("p:box:root", "box", { home: true }), place("p:vm:shop", "vm", { shepherdr: "stopped" })], automations: {}, artifacts: [], asks: {}, settings: [],
  tasks: [task("vm:SHOP-3", "p:vm:shop", { on: "vm", ...(wait ? { wait } : {}) })],
  needs: [{ id: "attention", chat: "vm:SHOP-3/worker", place: "p:vm:shop", task: "vm:SHOP-3", at: NOW - 30 * min, text: "Which colour?", assistantFirst: true }], ...x });
const off = (s: any) => ({ ...s, machines: [machines[0], { ...machines[1], status: "off", unreachableSince: "14:02" }] });

test("only an open record of the kind the service reads now is passed on", () => {
  const raw = { id: "a1b2c3d4e5f60718", gen: 2, kind: "reply", why: "Which colour?", mark: "reply:1", first: NOW - 2 * min, deadline: NOW + 3 * min };
  expect(waitRecordOf(raw, "reply")).toEqual({ id: "a1b2c3d4e5f60718", gen: 2, kind: "reply", first: NOW - 2 * min, deadline: NOW + 3 * min });
  // closed, of another kind than now (herdr-task's tick hasn't caught up), or not a record: none
  expect(waitRecordOf({ ...raw, outcome: { how: "moved-on", at: NOW } }, "reply")).toBeUndefined();
  expect(waitRecordOf(raw, "attention")).toBeUndefined();
  expect(waitRecordOf(raw, "asks")).toBeUndefined();
  expect(waitRecordOf({ ...raw, first: "soon" }, "reply")).toBeUndefined();
  expect(waitRecordOf(null, "reply")).toBeUndefined();
});

test("the wait's action is keyed by its record: its id, first seen and deadline", () => {
  const snap = attend(structuredClone(snapOf(rec("w1", 1, NOW - 2 * min))), NOW, new Map());
  expect(yours(snap).map((a) => [a.id, a.since, a.deadline, a.gen])).toEqual([["wait:w1", NOW - 2 * min, NOW + 3 * min, 1]]);
  // a source that keeps no record yet: the old key, from the task's own facts
  expect(yours(attend(structuredClone(snapOf(null)), NOW, new Map())).map((a) => a.id)).toEqual([`wait:vm:SHOP-3:${NOW - 30 * min}`]);
});

test("a replacement question in the same status is a new action, and alerts once", () => {
  const memo = new Map();
  const p1 = alertsOf(attend(structuredClone(snapOf(rec("w1", 1, NOW - 2 * min))), NOW, memo));
  // the same wait read again (a restart of the service or herdr-task keeps the record): nothing new
  const p2 = alertsOf(attend(structuredClone(snapOf(rec("w1", 1, NOW - 2 * min))), NOW + min, memo));
  expect(pushChanges(p1, p2, 1)).toEqual([]);
  // a new question, the task still Needs you all along: a new id, so it goes out
  const p3 = alertsOf(attend(structuredClone(snapOf(rec("w2", 2, NOW + 2 * min))), NOW + 2 * min, memo));
  expect([...p3.values()].map((a: any) => a.key ?? a.id).join()).not.toContain("w1");
  expect(pushChanges(p2, p3, 1).length).toBe(1);
});

test("a machine that can't be reached keeps the old row until it is read again", () => {
  const memo = new Map();
  const live = snapOf(rec("w1", 1, NOW - 2 * min));
  const p1 = alertsOf(attend(structuredClone(live), NOW, memo));
  // away: its terminals are gone from the snapshot, only its kept rows remain
  const away = attend(structuredClone({ ...off(live), needs: [] }), NOW + min, memo);
  expect(yours(away).map((a) => [a.id, a.stale])).toEqual([["wait:w1", "Build box"]]);
  const p2 = alertsOf(away);
  expect(pushChanges(p1, p2, 1)).toEqual([]);
  // back, with the same record: the same action, nothing sent again
  const p3 = alertsOf(attend(structuredClone(live), NOW + 2 * min, memo));
  expect(pushChanges(p2, p3, 1)).toEqual([]);
});

// the whole path: the stored task (herdr-task's JSON) through the model's row and enrich to the task the projection reads
test("the stored record reaches the task through the model, and only while it is open", async () => {
  const { Model } = await import("./model.ts");
  const { enrich } = await import("./next.ts");
  const wait = { id: "0f1e2d3c4b5a6978", gen: 4, kind: "stopped", why: "Its agent is no longer running.", mark: "stopped:1", first: NOW - 3 * min, deadline: NOW + 2 * min };
  // running with no agent live: the service reads it as stopped, as herdr-task did
  const stored = [{ id: 1, title: "Sync stock", state: "running", started: Date.now() - 30 * min, wait }, { id: 2, title: "Old wait", state: "running", started: Date.now() - 30 * min, wait: { ...wait, id: "aa", outcome: { how: "moved-on", at: NOW } } }];
  const m = new Model({ terminals: new Map(), on: () => () => {} } as any, { put: () => {} } as any) as any;
  m.lists = new Map([[null, [{ slug: "app", name: "app", prefix: "APP", folder: "/srv/app", machine: null, tasks: stored }]]]);
  m.value = () => undefined;
  let rows: any[] = [];
  m.onBuild = (b: any) => { rows = b.rows; };
  try { m.build(); } catch { /* the spaces half needs more of the service; the rows are made first */ }
  rows = rows.length ? rows : m.rows;
  if (m.settleTimer) clearTimeout(m.settleTimer);
  expect(rows.map((r: any) => [r.needs, r.x.wait?.id])).toEqual([["stopped", wait.id], ["stopped", "aa"]]);
  const t = (id: number) => ({ id: `APP-${id}`, name: "", place: "sp1", status: "need", state: "need", on: "mini", created: "", age: "" });
  const out: any = enrich({ places: [{ id: "sp1", chat: "p:sp1", name: "app", machine: "mini" }], tasks: [t(1), t(2)], machines: [], needs: [] } as any,
    { spaces: [{ id: "sp1", folder: "/srv/app", machine: null }], rows, archived: [], asked: () => null, reportOf: () => null, config: { plans: [], all: { agents: { Tasks: { agent: "claude" } } } } } as any);
  expect(out.tasks[0].wait).toEqual({ id: wait.id, gen: 4, kind: "stopped", first: NOW - 3 * min, deadline: NOW + 2 * min });
  expect(out.tasks[1].wait).toBeUndefined();
});
