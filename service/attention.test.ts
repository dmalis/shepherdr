// fork Needs you 5/6, one list: every count and list reads one projection of the open actions (web/shared/attention.ts),
// so the space's count, Everything's, Tasks › Needs you, the app badge, the glance feed and what may push always agree.
// The acceptance cases of fork/specs/needs-you.md's part 5. Made-up data.
import { expect, test } from "bun:test";
import { attend } from "./attention.ts";
import { alertsOf } from "./push.ts";
import { glanceOf } from "./glance.ts";
import { attentionOf, projectAttention, yours } from "../web/shared/attention.ts";
import { waiting } from "../web/shared/alerts.ts";
import { moreActions, needsItems } from "../web/shared/needs-open.ts";
import { cantCheck } from "../web/shared/needs-words.ts";
import { needsCount, nowGroups, statusWord, taskLine } from "../web/shared/view.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;
const q = (id: string, title = "Which one?") => ({ id, title, kind: "Question", choices: [{ label: "A" }, { label: "B" }], to: "" });
const place = (id: string, machine: string, x: any = {}) => ({ id, name: id.split(":").pop(), machine, level: 0, status: "idle", mode: "regular", chat: id, shepherdr: "running", ...x });
const task = (id: string, pl: string, x: any = {}) => ({ id, name: `Task ${id}`, place: pl, status: "need", state: "need", created: "", age: "", at: NOW - 30 * min, needsAt: NOW - 10 * min, agent: { chat: `${id}/worker`, role: "worker", cli: "claude", status: "need", running: true, age: "", note: "" }, ...x });
const snapOf = (x: any = {}) => ({ name: "", host: "box", user: "", demo: false, everything: "p:box:root", machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Build box", status: "idle" }],
  places: [place("p:box:root", "box", { home: true }), place("p:box:shop", "box"), place("p:vm:shop", "vm")], tasks: [], needs: [], automations: {}, artifacts: [], asks: {}, settings: [], ...x });

/** what each surface shows for the person, everywhere */
function surfaces(s: any) {
  const snap = attend(structuredClone(s), NOW);
  const alerts = alertsOf(snap);
  const g = glanceOf(snap, alerts, NOW);
  const groups = nowGroups(snap.tasks);
  const listed = groups.find((x) => x.name === "Needs you")!.tasks;
  return {
    snap,
    count: needsCount(snap),
    items: needsItems(snap).length,
    badge: waiting(snap, NOW).count,
    glance: g.counts.needs + g.counts.ready,
    // Tasks › Needs you: a row a task, plus a row each for its other actions
    rows: listed.length + snap.tasks.reduce((n: number, t: any) => n + moreActions(snap, t).length, 0),
    pushes: [...alerts.values()].filter((a: any) => !a.muted && a.waits).length,
  };
}
const agree = (x: ReturnType<typeof surfaces>, n: number) => expect([x.count, x.items, x.badge, x.glance, x.rows, x.pushes]).toEqual([n, n, n, n, n, n]);

test("two machines with the same task ref: two actions, the same on every surface, each in its own space", () => {
  const s = snapOf({
    tasks: [task("SHOP-1", "p:box:shop"), task("vm:SHOP-1", "p:vm:shop", { on: "vm", agent: { chat: "vm:SHOP-1/worker", role: "worker", cli: "codex", status: "need", running: true, age: "", note: "" } })],
    needs: [{ id: "q1", chat: "SHOP-1/worker", place: "p:box:shop", task: "SHOP-1", at: NOW - 3 * min, question: q("q1") },
      { id: "q1", chat: "vm:SHOP-1/worker", place: "p:vm:shop", task: "vm:SHOP-1", at: NOW - 2 * min, question: q("q1") }],
  });
  const x = surfaces(s);
  agree(x, 2);
  expect(attentionOf(x.snap).actions.map((a) => a.id)).toEqual(["need:SHOP-1/worker:q1", "need:vm:SHOP-1/worker:q1"]);
  expect([needsCount(x.snap, "p:box:shop"), needsCount(x.snap, "p:vm:shop")]).toEqual([1, 1]);
});

test("two prompts on one task: two actions, a row each, two alerts", () => {
  const s = snapOf({
    tasks: [task("SHOP-2", "p:box:shop")],
    needs: [{ id: "q1", chat: "SHOP-2/worker", place: "p:box:shop", task: "SHOP-2", at: NOW - 3 * min, question: q("q1", "Pick a colour") },
      { id: "sec1", chat: "SHOP-2/worker", place: "p:box:shop", task: "SHOP-2", at: NOW - 1 * min, secret: { id: "sec1", name: "STORE_KEY", why: "" } }],
  });
  const x = surfaces(s);
  agree(x, 2);
  expect(needsCount(x.snap, "p:box:shop")).toBe(2);
  // its row leads with the oldest; the second is a row of its own
  expect(x.snap.tasks[0].action).toMatchObject({ id: "need:SHOP-2/worker:q1", owner: "you" });
  expect(moreActions(x.snap, x.snap.tasks[0]).map((a) => a.id)).toEqual(["need:SHOP-2/worker:sec1"]);
});

test("reading or muting changes no count: only what is delivered", () => {
  // a task's question, and the space's own Shepherdr asking
  const base = snapOf({ tasks: [task("SHOP-3", "p:box:shop")], needs: [{ id: "q3", chat: "SHOP-3/worker", place: "p:box:shop", task: "SHOP-3", at: NOW - min, question: q("q3") },
    { id: "q4", chat: "p:box:shop", place: "p:box:shop", at: NOW - min, question: q("q4") }] });
  const read = { ...base, read: { "p:box:shop": NOW }, last: { "p:box:shop": NOW - min }, alerts: [] };
  const muted = { ...base, settings: [{ name: "Notify", level: "p:box:shop", rows: [{ key: "notify", value: "Off" }] }] };
  // the space's own ask has no task row: the list adds one for it (needsChats), so rows count tasks' actions only
  const counts = (x: ReturnType<typeof surfaces>) => [x.count, x.items, x.badge, x.glance, x.rows + 1]
  expect(counts(surfaces(base))).toEqual([2, 2, 2, 2, 2]);
  expect(counts(surfaces(read))).toEqual([2, 2, 2, 2, 2]);
  const m = surfaces(muted);
  expect(counts(m)).toEqual([2, 2, 2, 2, 2]);
  // muted: the space's own stays in the bell, quiet; a task's still reaches the device (its alerts always do)
  expect([surfaces(base).pushes, m.pushes]).toEqual([2, 1]);
});

test("an inferred wait is Shepherdr's: never red, never counted or pushed, until it is handed up", () => {
  const inferred = { id: "attention", chat: "SHOP-4/worker", place: "p:box:shop", task: "SHOP-4", at: NOW - 5 * min, text: "Asked which colour", assistantFirst: true };
  const s = snapOf({ tasks: [task("SHOP-4", "p:box:shop", { report: { msg: "Asked which colour" } })], needs: [inferred] });
  const x = surfaces(s);
  agree(x, 0);
  const t = x.snap.tasks[0];
  expect(t.action).toMatchObject({ owner: "shepherdr", kind: "wait" });
  expect(statusWord(t)).toEqual({ word: "With Shepherdr", tone: "mute" });
  expect(taskLine(t)).toBe("With Shepherdr · Asked which colour");
  expect(nowGroups(x.snap.tasks).find((g) => g.name === "Working")!.tasks.map((y) => y.id)).toEqual(["SHOP-4"]);
  // Shepherdr hands it up (herdr-task alert --task): now the person's, once
  const up = surfaces({ ...s, alerts: [{ id: "up1", task: "SHOP-4", chat: "p:box:shop", at: NOW - min, title: "Task SHOP-4 · Pick a colour", what: "Pick a colour", body: "Red or blue?", notify: true, place: "p:box:shop" }] });
  expect([up.count, up.items, up.badge, up.glance, up.rows]).toEqual([1, 1, 1, 1, 1]);
  expect(up.snap.tasks[0].action).toMatchObject({ owner: "you", kind: "alert" });
  // no Shepherdr chat running in its space: the person's at once
  const none = surfaces({ ...s, places: s.places.map((p: any) => (p.id === "p:box:shop" ? { ...p, shepherdr: "stopped" } : p)) });
  agree(none, 1);
  expect(none.snap.tasks[0].action).toMatchObject({ owner: "you", up: "no-shepherdr" });
});

test("Paused (stopped by the person) is no one's: quiet, under Working, never counted", () => {
  const x = surfaces(snapOf({ tasks: [task("SHOP-5", "p:box:shop", { stopped: { by: "you" } })] }));
  agree(x, 0);
  expect(statusWord(x.snap.tasks[0])).toEqual({ word: "Paused", tone: "mute" });
});

test("a machine that can't be read keeps its last row, saying so, and sends nothing new", () => {
  const s = snapOf({
    machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Build box", status: "off", unreachableSince: "14:02" }],
    tasks: [task("vm:SHOP-6", "p:vm:shop", { on: "vm" })],
    needs: [{ id: "q6", chat: "vm:SHOP-6/worker", place: "p:vm:shop", task: "vm:SHOP-6", at: NOW - 4 * min, question: q("q6") }],
  });
  const x = surfaces(s);
  // still counted and listed, as last read
  expect([x.count, x.items, x.badge, x.rows]).toEqual([1, 1, 1, 1]);
  expect(yours(x.snap)[0]).toMatchObject({ id: "need:vm:SHOP-6/worker:q6", stale: "Build box" });
  expect(x.pushes).toBe(0);
  expect(cantCheck("Build box")).toBe("Can't check Build box right now");
  // read again: it alerts as before
  const back = surfaces({ ...s, machines: snapOf().machines });
  expect(back.pushes).toBe(1);
});

test("the projection is pure and stable: the same facts give the same ids, oldest first", () => {
  const s = snapOf({ tasks: [task("SHOP-7", "p:box:shop", { status: "ready", state: "ready", needsAt: NOW - 9 * min }), task("SHOP-8", "p:box:shop")],
    needs: [{ id: "q8", chat: "SHOP-8/worker", place: "p:box:shop", task: "SHOP-8", at: NOW - 2 * min, question: q("q8") }] });
  const a = projectAttention(s as any, NOW).actions.map((x) => x.id);
  expect(a).toEqual([`review:SHOP-7:${NOW - 9 * min}`, "need:SHOP-8/worker:q8"]);
  expect(projectAttention(s as any, NOW + 5 * min).actions.map((x) => x.id)).toEqual(a);
});
