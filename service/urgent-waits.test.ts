// dmalis/shepherdr#119 (fork/specs/urgent-tasks.md, slice 3): in the one action list (web/shared/attention.ts), the
// waits Shepherdr holds on urgent tasks come first, so Shepherdr takes those first. Nothing else changes: the same ids,
// owners, counts and deadlines, and the person's own actions (counts, Needs you, the badge, the phone feed, what may
// push) in the same order as before. Made-up tasks only.
import { expect, test } from "bun:test";
import { attend } from "./attention.ts";
import { alertsOf } from "./push.ts";
import { glanceOf } from "./glance.ts";
import { projectAttention, yours } from "../web/shared/attention.ts";
import { needsCount, nowGroups } from "../web/shared/view.ts";
import { urgentWaitsFirst } from "../web/shared/urgent.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;
const place = (id: string, machine: string) => ({ id, name: id.split(":").pop(), machine, level: 0, status: "idle", mode: "regular", chat: id, shepherdr: "running" });
const task = (id: string, x: any = {}) => ({ id, name: `Task ${id}`, place: "p:box:shop", status: "need", state: "need", created: "", age: "", at: NOW - 60 * min, needsAt: NOW - 10 * min,
  agent: { chat: `${id}/worker`, role: "worker", cli: "claude", status: "need", running: true, age: "", note: "" }, ...x });
/** a wait Shepherdr holds: herdr-task's inferred need and its record (fork Needs you 6a) */
const held = (id: string, ago: number, deadline = NOW + 10 * min) => ({
  task: { wait: { id: `w${id}`, gen: 1, kind: "reply", first: NOW - ago * min, deadline } },
  need: { id: "attention", chat: `${id}/worker`, place: "p:box:shop", task: id, at: NOW - ago * min, text: "Asked which colour", assistantFirst: true },
});
const snapOf = (tasks: any[], needs: any[], vm = "idle"): any => ({ name: "", host: "box", user: "", demo: false, everything: "p:box:root",
  machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }, { id: "m:vm", machine: "vm", name: "Build box", status: vm }],
  places: [{ ...place("p:box:root", "box"), home: true }, place("p:box:shop", "box"), place("p:vm:shop", "vm")], tasks, needs, automations: {}, artifacts: [], asks: {}, settings: [] });

/** Fix checkout and Order export wait with Shepherdr; Tidy footer asks the person; Price list is Ready; Old report's
 *  wait passed its deadline, so it is the person's now */
function world(urgent: string[]) {
  const a = held("SHOP-1", 20), b = held("SHOP-2", 5), e = held("SHOP-5", 30, NOW - 1 * min);
  const u = (id: string) => (urgent.includes(id) ? { urgent: true } : {});
  return snapOf([
    task("SHOP-1", { name: "Fix checkout", ...a.task, ...u("SHOP-1") }),
    task("SHOP-2", { name: "Order export", ...b.task, ...u("SHOP-2") }),
    task("SHOP-3", { name: "Tidy footer", ...u("SHOP-3") }),
    task("SHOP-4", { name: "Price list", status: "ready", state: "ready", ...u("SHOP-4") }),
    task("SHOP-5", { name: "Old report", ...e.task, ...u("SHOP-5") }),
  ], [a.need, b.need, e.need,
    { id: "q3", chat: "SHOP-3/worker", place: "p:box:shop", task: "SHOP-3", at: NOW - 15 * min, question: { id: "q3", title: "Which font?", kind: "Question", choices: [{ label: "A" }, { label: "B" }], to: "" } }]);
}

/** what the person sees and what may reach them */
function seen(s: any) {
  const snap = attend(structuredClone(s), NOW, new Map());
  const alerts = alertsOf(snap);
  const g = glanceOf(snap, alerts, NOW);
  return {
    yours: yours(snap).map((x) => [x.id, x.owner, x.since, x.deadline]),
    count: needsCount(snap),
    needsYou: nowGroups(snap.tasks).find((x) => x.name === "Needs you")!.tasks.map((t: any) => t.id),
    glance: [g.counts.needs, g.counts.ready],
    pushes: [...alerts.keys()].sort(),
    leads: snap.tasks.map((t: any) => [t.id, t.action?.id, t.action?.owner]),
  };
}

test("Shepherdr's waits on urgent tasks come first, with the same ids, owners and deadlines", () => {
  const plain = projectAttention(world([]), NOW).actions;
  // oldest first, as before this slice
  expect(plain.map((a) => a.id)).toEqual(["wait:wSHOP-5", "wait:wSHOP-1", "need:SHOP-3/worker:q3", "review:SHOP-4:" + (NOW - 10 * min), "wait:wSHOP-2"]);
  // Order export urgent: its wait (Shepherdr's) goes ahead of every other action; the rest stay oldest first
  const marked = projectAttention(world(["SHOP-2"]), NOW).actions;
  expect(marked.map((a) => a.id)).toEqual(["wait:wSHOP-2", "wait:wSHOP-5", "wait:wSHOP-1", "need:SHOP-3/worker:q3", "review:SHOP-4:" + (NOW - 10 * min)]);
  const facts = (xs: typeof plain) => xs.map((a) => [a.id, a.owner, a.kind, a.since, a.gen, a.deadline, a.up]).sort();
  expect(facts(marked)).toEqual(facts(plain));
  // two urgent waits: both first, oldest first among themselves
  expect(projectAttention(world(["SHOP-2", "SHOP-1"]), NOW).actions.map((a) => a.id).slice(0, 2)).toEqual(["wait:wSHOP-1", "wait:wSHOP-2"]);
});

test("the person's actions keep their order, place and counts: urgent never moves what is theirs", () => {
  const plain = seen(world([]));
  // every task urgent: Shepherdr's own waits come first in the one list, and nothing the person sees changes
  const all = seen(world(["SHOP-1", "SHOP-2", "SHOP-3", "SHOP-4", "SHOP-5"]));
  expect(all).toEqual(plain);
  // Old report's wait passed its deadline: it is the person's, so its place is theirs (oldest first), not Shepherdr's
  const handed = projectAttention(world(["SHOP-5"]), NOW).actions;
  expect(handed.find((a) => a.task === "SHOP-5")).toMatchObject({ owner: "you", up: "deadline" });
  expect(handed.map((a) => a.id)).toEqual(projectAttention(world([]), NOW).actions.map((a) => a.id));
  expect(plain.yours.map((x) => x[0])).toEqual(["wait:wSHOP-5", "need:SHOP-3/worker:q3", "review:SHOP-4:" + (NOW - 10 * min)]);
});

test("a machine that can't be read keeps its last actions in the same order", () => {
  const a = held("SHOP-1", 20), b = held("vm:SHOP-7", 5);
  const vmTask = task("vm:SHOP-7", { name: "Fix checkout", place: "p:vm:shop", on: "vm", urgent: true, ...b.task, agent: { chat: "vm:SHOP-7/worker", role: "worker", cli: "codex", status: "need", running: true, age: "", note: "" } });
  const s = (vm: string) => snapOf([task("SHOP-1", { name: "Tidy footer", ...a.task }), vmTask], [a.need, { ...b.need, place: "p:vm:shop" }], vm);
  const memo = new Map();
  const fresh = attend(structuredClone(s("idle")), NOW, memo).attention!.actions as { id: string; stale?: string }[];
  expect(fresh.map((x) => x.id)).toEqual(["wait:wvm:SHOP-7", "wait:wSHOP-1"]);
  // the build box drops out: its wait is kept as last read ("Can't check"), still first
  const kept = attend(structuredClone(s("off")), NOW, memo).attention!.actions as { id: string; stale?: string }[];
  expect(kept.map((x) => [x.id, x.stale])).toEqual([["wait:wvm:SHOP-7", "Build box"], ["wait:wSHOP-1", undefined]]);
});

test("the order: a stable partition, only Shepherdr's own on an urgent task, by any task it holds", () => {
  const acts = [
    { id: "1", owner: "you", task: "T1" }, { id: "2", owner: "shepherdr", task: "T2" }, { id: "3", owner: "shepherdr", task: "T1" },
    { id: "4", owner: "shepherdr", task: "T3", tasks: ["T3", "T1"] }, { id: "5", owner: "shepherdr" },
  ];
  expect(urgentWaitsFirst(acts, [{ id: "T1", urgent: true }, { id: "T2" }]).map((a) => a.id)).toEqual(["3", "4", "1", "2", "5"]);
  // none urgent: the same list, untouched
  expect(urgentWaitsFirst(acts, [{ id: "T1" }])).toBe(acts);
  expect(urgentWaitsFirst(acts, [])).toBe(acts);
});
