// fork "Needs you 6b: hand-up": a wait Shepherdr handles first becomes the person's once, at its deadline (Ask me after)
// or at once (an explicit hand-up, no Shepherdr running), one question over several tasks is one card and one alert, and
// a late or duplicate answer sends nothing more. The acceptance cases of fork/specs/needs-you.md's part 6b. Made-up data.
import { expect, test } from "bun:test";
import { attend, nextHandUp } from "./attention.ts";
import { agentAlerts, alertsOf, pushChanges } from "./push.ts";
import { handUpOf } from "./wait-record.ts";
import { attentionOf, leadOf } from "../web/shared/attention.ts";
import { waitsOnPerson } from "../web/shared/needs-you.ts";
import { needsTask } from "../web/shared/needs-open.ts";
import { askAfterOf, isAskAfter } from "../web/shared/ask-after.ts";
import { needsCount } from "../web/shared/view.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;
const place = (id: string, machine: string, x: any = {}) => ({ id, name: id.split(":").pop(), machine, level: 0, status: "idle", mode: "regular", chat: id, shepherdr: "running", ...x });
const rec = (id: string, x: any = {}) => ({ id, gen: 1, kind: "reply", why: "Which plan?", first: NOW - 2 * min, deadline: NOW + 3 * min, ...x });
const task = (id: string, x: any = {}) => ({ id, name: `Task ${id}`, place: "p:box:shop", status: "need", state: "need", created: "", age: "", at: NOW - 30 * min, needsAt: NOW - 2 * min,
  agent: { chat: `${id}/worker`, role: "worker", cli: "claude", status: "need", running: true, age: "", note: "" }, wait: rec(`w-${id}`), ...x });
const inferred = (id: string) => ({ id: "attention", chat: `${id}/worker`, place: "p:box:shop", task: id, at: NOW - 2 * min, text: "Asked which plan", assistantFirst: true });
const snapOf = (tasks: any[], x: any = {}) => ({ name: "", host: "box", user: "", demo: false, everything: "p:box:root",
  machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Build box", status: "idle" }],
  places: [place("p:box:root", "box", { home: true }), place("p:box:shop", "box"), place("p:vm:shop", "vm")], tasks, needs: tasks.map((t) => inferred(t.id)), automations: {}, artifacts: [], asks: {}, settings: [], ...x });

/** the snapshot as the service sends it at `now`, and what would reach a device */
const at = (s: any, now = NOW, memo = new Map()) => {
  const snap = attend(structuredClone(s), now, memo);
  const alerts = alertsOf(snap);
  return { snap, alerts, pushes: [...alerts.values()].filter((a: any) => !a.muted && a.waits), count: needsCount(snap) };
};

test("before its deadline a wait is Shepherdr's, quiet; at its deadline it is the person's, once", () => {
  const s = snapOf([task("SHOP-1")]);
  const early = at(s);
  expect([early.count, early.pushes.length]).toEqual([0, 0]);
  expect(leadOf(attentionOf(early.snap), "SHOP-1")).toMatchObject({ owner: "shepherdr", deadline: NOW + 3 * min });
  // the service wakes itself for it, so it isn't late by the next unrelated change
  expect(nextHandUp(attentionOf(early.snap).actions, NOW)).toBe(NOW + 3 * min);
  const late = at(s, NOW + 3 * min);
  expect([late.count, late.pushes.length]).toEqual([1, 1]);
  expect(leadOf(attentionOf(late.snap), "SHOP-1")).toMatchObject({ owner: "you", up: "deadline", id: "wait:w-SHOP-1" });
  // read again a minute on: the same action, nothing sent again
  expect(pushChanges(late.alerts, at(s, NOW + 4 * min).alerts, 1)).toEqual([]);
});

test("a reply, a held send or a busy Shepherdr never moves the deadline", () => {
  // the space's Shepherdr at work, a send of the person's waiting for it, its latest reply after the wait began
  const s = snapOf([task("SHOP-2", { needsAt: NOW + 2 * min })], { places: [place("p:box:root", "box", { home: true }), place("p:box:shop", "box", { status: "working", queued: 1 }), place("p:vm:shop", "vm")],
    last: { "p:box:shop": NOW + 2 * min } });
  expect(leadOf(attentionOf(at(s, NOW + 3 * min).snap), "SHOP-2")).toMatchObject({ owner: "you", up: "deadline" });
});

test("an explicit hand-up is the person's at once, with its ask, its choices and Reply to Shepherdr's chat", () => {
  const up = { at: NOW - min, what: "Choose a migration plan", why: "Both are tested", choices: ["In place", "Copy then swap"], lead: "w-SHOP-3" };
  const x = at(snapOf([task("SHOP-3", { wait: rec("w-SHOP-3", { up }) })]));
  const a = leadOf(attentionOf(x.snap), "SHOP-3")!;
  expect(a).toMatchObject({ owner: "you", up: "asked", what: "Choose a migration plan", card: "handup:w-SHOP-3", handUp: up });
  expect(x.pushes).toHaveLength(1);
  expect(x.pushes[0]).toMatchObject({ title: "Task · Task SHOP-3 · Needs you", body: "Choose a migration plan. Both are tested", reply: { chat: "p:box:shop" } });
});

test("a deadline escalation, then a hand-up of the same wait: still one alert", () => {
  const s = snapOf([task("SHOP-4")]);
  const first = at(s, NOW + 4 * min);
  const asked = at(snapOf([task("SHOP-4", { wait: rec("w-SHOP-4", { up: { at: NOW + 4 * min, what: "Pick one", lead: "w-SHOP-4" } }) })]), NOW + 5 * min);
  expect(leadOf(attentionOf(asked.snap), "SHOP-4")!.id).toBe(leadOf(attentionOf(first.snap), "SHOP-4")!.id);
  expect(pushChanges(first.alerts, asked.alerts, 1)).toEqual([]);
});

test("one question over two tasks: one action, one card, one alert, both tasks under Needs you", () => {
  const up = { at: NOW - min, what: "Pick one database for both", lead: "w-SHOP-5" };
  const x = at(snapOf([task("SHOP-5", { wait: rec("w-SHOP-5", { up }) }), task("SHOP-6", { wait: rec("w-SHOP-6", { up }) })]));
  const mine = attentionOf(x.snap).actions.filter((a) => a.owner === "you");
  expect(mine.map((a) => [a.id, a.task, a.tasks])).toEqual([["wait:w-SHOP-5", "SHOP-5", ["SHOP-5", "SHOP-6"]]]);
  // a row and a count each task it holds (Needs you lists what the count counts), and still one alert
  expect([x.count, x.pushes.length]).toEqual([2, 1]);
  expect(x.pushes[0]).toMatchObject({ title: "Task · Task SHOP-5 · Needs you", body: "Pick one database for both. Also holds Task SHOP-6" });
  for (const t of x.snap.tasks) {
    expect(waitsOnPerson(x.snap, t.id)).toBe(true);
    expect(needsTask(x.snap, t, ["p:box:shop"])).toBe(true);
  }
});

test("taken back (settled): Shepherdr's again, quiet, and its deadline no longer hands it up", () => {
  const up = { at: NOW - min, what: "Pick one", lead: "w-SHOP-7", settled: NOW };
  const x = at(snapOf([task("SHOP-7", { wait: rec("w-SHOP-7", { up }) })]), NOW + 10 * min);
  expect(leadOf(attentionOf(x.snap), "SHOP-7")).toMatchObject({ owner: "shepherdr" });
  expect(leadOf(attentionOf(x.snap), "SHOP-7")!.deadline).toBeUndefined();
  expect(x.pushes).toHaveLength(0);
});

test("a stopped or missing Shepherdr: the person's at once, whatever the deadline", () => {
  for (const state of ["stopped", "none"]) {
    const s = snapOf([task("SHOP-8")], { places: [place("p:box:root", "box", { home: true }), place("p:box:shop", "box", { shepherdr: state }), place("p:vm:shop", "vm")] });
    const x = at(s);
    expect(leadOf(attentionOf(x.snap), "SHOP-8")).toMatchObject({ owner: "you", up: "no-shepherdr" });
    expect(x.pushes).toHaveLength(1);
  }
});

test("a machine that can't be read hands nothing up, its deadline passing or not", () => {
  const s = snapOf([task("vm:SHOP-9", { place: "p:vm:shop", on: "vm", wait: rec("w9", { deadline: NOW - min }) })],
    { machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Build box", status: "off" }] });
  const x = at(s);
  expect(x.pushes).toHaveLength(0);
  expect(nextHandUp([{ id: "w", kind: "wait", owner: "shepherdr", stale: "Build box", deadline: NOW + min, since: 0, what: "", place: "", card: null } as any], NOW)).toBeUndefined();
});

test("Right away: the wait is the person's as soon as its record lands, not before", () => {
  // herdr-task writes deadline == first for 0 minutes (wait_record.py ask_after_ms)
  const x = at(snapOf([task("SHOP-10", { wait: rec("w10", { first: NOW, deadline: NOW }) })]));
  expect(leadOf(attentionOf(x.snap), "SHOP-10")).toMatchObject({ owner: "you", up: "deadline" });
  // its record not written yet (at most a tick): quiet, so it is told once under the id that lasts
  const pending = at(snapOf([task("SHOP-10", { wait: undefined, waitPending: true })]));
  expect(pending.pushes).toHaveLength(0);
  expect([askAfterOf(0), askAfterOf("now"), askAfterOf(undefined), askAfterOf("soon")]).toEqual([0, 0, 5, 5]);
  expect([isAskAfter(0), isAskAfter(30), isAskAfter(7)]).toEqual([true, true, false]);
});

test("a provider prompt stays the person's only: nothing Shepherdr does takes it, hands it up or answers it", () => {
  const perm = { id: "perm1", chat: "SHOP-11/worker", place: "p:box:shop", task: "SHOP-11", at: NOW - min, text: "Allow Bash: rm -rf build?", prompt: true };
  const s = { ...snapOf([task("SHOP-11", { wait: rec("w11", { up: { at: NOW, what: "Approve the delete", lead: "w11" } }) })]), needs: [perm] };
  const mine = attentionOf(at(s).snap).actions;
  expect(mine.map((a) => [a.id, a.owner, a.kind])).toEqual([["need:SHOP-11/worker:perm1", "you", "prompt"]]);
});

test("the wait's hand-up as the service reads it: kept short, junk dropped", () => {
  expect(handUpOf({ at: 5, what: "Pick", lead: "w1", choices: ["a", "a", "b", "c", "d", "e", 7], why: "x".repeat(400) })).toEqual({ at: 5, what: "Pick", lead: "w1", choices: ["a", "b", "c", "d"], why: "x".repeat(300) });
  expect(handUpOf({ at: 5, what: "", lead: "w1" })).toBeUndefined();
  expect(handUpOf("nope")).toBeUndefined();
});

test("an Assistant's alert about no task stays in the bell; a hand-up's label is history only", () => {
  const snap = { places: [{ id: "sp1", name: "shop", chat: "sp1" }], tasks: [{ id: "SHOP-1", place: "sp1" }], settings: [] };
  const lab = (a: any) => ({ address: "t1", state: "live", labels: { "herdr.role": "coordinator", "herdr.alert": JSON.stringify({ at: 5, title: "Look", body: "now", ...a }) } });
  const [bare, handed] = agentAlerts([lab({ id: "a" }), { ...lab({ id: "b", task: "SHOP-1", about: true, waits: ["w1"] }), address: "t2" }], snap, () => "sp1", "/nonexistent");
  expect(bare.notify).toBe(false);
  expect(handed).toMatchObject({ notify: true, waits: ["w1"], task: "SHOP-1" });
  // the label of a hand-up is not an alert of its own: its wait's action is the one (no second card or push)
  const s = { ...snapOf([task("SHOP-12")]), alerts: [{ ...handed, id: "b", task: "SHOP-12", place: "p:box:shop" }] };
  expect(attentionOf(at(s).snap).actions.filter((a) => a.kind === "alert")).toEqual([]);
});
