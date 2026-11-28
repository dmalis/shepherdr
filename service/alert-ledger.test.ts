// fork Needs you 4/6, exact links: what the service remembers of its alerts (service/alert-ledger.ts). Each alert goes
// once per action, never again after a restart or a reconnect; one that came while the service was down still goes; a
// task Ready again is a new alert; a closed action says how it ended. Built on push.ts alertsOf and pushChanges (pinned
// here too).
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlertLedger, CLOSE_AFTER_MS, GONE_GRACE_MS, eventOf } from "./alert-ledger.ts";
import { alertsOf, pushChanges } from "./push.ts";
import { withAttention } from "../web/shared/attention.ts";

const fileIn = () => join(mkdtempSync(join(tmpdir(), "ledger-")), "alerted.json");
const T0 = 1_800_000_000_000;
const q = (id: string) => ({ id, kind: "Question", title: "Deploy now?", choices: [{ label: "Yes" }, { label: "No" }] });
/** a space with one task: asking a question (q), Ready for review (since: its round), or working */
const snapOf = (o: { ask?: string; ready?: number; done?: boolean } = {}, now = T0) => withAttention({
  places: [{ id: "sp1", name: "shop", chat: "sp1", shepherdr: "running" }],
  tasks: [{ id: "SHOP-1", name: "Fix login", status: o.done ? "done" : o.ready ? "ready" : o.ask ? "need" : "work", place: "sp1", at: T0, ...(o.ready ? { needsAt: o.ready } : {}) }],
  needs: o.ask ? [{ id: o.ask, chat: "SHOP-1/worker", place: "sp1", task: "SHOP-1", at: T0, question: q(o.ask) }] : [],
  settings: [], machines: [], last: {}, read: {},
} as any, now);

/** one tick of the service (main.ts alertNew): the alerts made, what goes out, what is kept */
function tick(l: AlertLedger, snap: any) {
  const now = alertsOf(snap);
  const before = l.prior(now);
  const out = before ? pushChanges(before as any, now, 1) : [];
  l.track(snap.attention);
  l.keep(now);
  l.save();
  return out.map((a) => a.key);
}

test("the first run ever sends nothing for what already waits; then what is new goes once", () => {
  let at = T0;
  const l = new AlertLedger(fileIn(), () => at);
  expect(tick(l, snapOf({ ask: "q1" }))).toEqual([]);
  expect(tick(l, snapOf({ ask: "q1" }))).toEqual([]);
  at += 1000;
  expect(tick(l, snapOf({ ask: "q2" }))).toEqual(["need:SHOP-1/worker:q2"]);
  expect(tick(l, snapOf({ ask: "q2" }))).toEqual([]);
});

test("a restart sends nothing again, and what came while it was down still goes", () => {
  const file = fileIn();
  let at = T0;
  const l1 = new AlertLedger(file, () => at);
  tick(l1, snapOf());
  at += 1000;
  expect(tick(l1, snapOf({ ask: "q1" }))).toEqual(["need:SHOP-1/worker:q1"]);
  // kept owner-only, before anything went out
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).sent)).toContain("need:SHOP-1/worker:q1");
  // started again: the same question is not new
  const l2 = new AlertLedger(file, () => at);
  expect(tick(l2, snapOf({ ask: "q1" }))).toEqual([]);
  // started again while a new question came meanwhile: that one goes
  const l3 = new AlertLedger(file, () => at);
  expect(tick(l3, snapOf({ ask: "q9" }))).toEqual(["need:SHOP-1/worker:q9"]);
});

test("an alert that blinks out and back within 10 minutes is the same alert; after that it is new", () => {
  let at = T0;
  const l = new AlertLedger(fileIn(), () => at);
  tick(l, snapOf());
  expect(tick(l, snapOf({ ask: "q1" }))).toEqual(["need:SHOP-1/worker:q1"]);
  // its card read again a moment later (a snapshot without it, then with it): nothing again
  at += 5000;
  tick(l, snapOf());
  at += 5000;
  expect(tick(l, snapOf({ ask: "q1" }))).toEqual([]);
  // gone past the grace: a new one
  tick(l, snapOf());
  at += GONE_GRACE_MS + 1;
  tick(l, snapOf());
  expect(tick(l, snapOf({ ask: "q1" }))).toEqual(["need:SHOP-1/worker:q1"]);
});

test("a task Ready again (a new round) is a new alert, though its key is the same", () => {
  let at = T0;
  const l = new AlertLedger(fileIn(), () => at);
  tick(l, snapOf());
  expect(tick(l, snapOf({ ready: T0 + 1 }))).toEqual(["ready:SHOP-1"]);
  at += 60_000;
  tick(l, snapOf());
  at += 60_000;
  expect(tick(l, snapOf({ ready: T0 + 120_000 }))).toEqual(["ready:SHOP-1"]);
});

test("a closed action says how it ended: answered when the person acted on its chat or task, else moved on", () => {
  let at = T0;
  const l = new AlertLedger(fileIn(), () => at);
  tick(l, snapOf({ ask: "q1" }));
  expect(l.outcome("need:SHOP-1/worker:q1")).toBeNull();
  // answered from its card
  at += 1000;
  l.touch(["SHOP-1/worker", "SHOP-1"]);
  at += 1000;
  tick(l, snapOf());
  expect(l.outcome("need:SHOP-1/worker:q1")).toMatchObject({ outcome: "answered", what: "Deploy now?", task: "SHOP-1", card: "q1", place: "sp1" });
  // a second question the agent dropped by itself
  at += 1000;
  tick(l, snapOf({ ask: "q2" }));
  at += 1000;
  tick(l, snapOf());
  expect(l.outcome("need:SHOP-1/worker:q2")?.outcome).toBe("moved");
  // it stays closed past the 20 seconds a snapshot may lack it, and across a restart
  at += CLOSE_AFTER_MS;
  tick(l, snapOf());
  const again = new AlertLedger((l as any).file, () => at);
  expect(again.outcome("need:SHOP-1/worker:q2")?.outcome).toBe("moved");
  expect(again.outcome("need:SHOP-1/worker:q1")?.outcome).toBe("answered");
});

test("an action back within 20 seconds was never closed", () => {
  let at = T0;
  const l = new AlertLedger(fileIn(), () => at);
  tick(l, snapOf({ ask: "q1" }));
  at += 1000;
  tick(l, snapOf());
  at += 1000;
  tick(l, snapOf({ ask: "q1" }));
  at += CLOSE_AFTER_MS + 1;
  tick(l, snapOf({ ask: "q1" }));
  expect(l.outcome("need:SHOP-1/worker:q1")).toBeNull();
});

test("an alert said on screen: its uncut words, its action, its task; an agent's own stays until closed", () => {
  const ready = [...alertsOf(snapOf({ ready: T0 + 1 }))].find(([k]) => k === "ready:SHOP-1")![1];
  expect(eventOf("ready:SHOP-1", ready, 5)).toMatchObject({ key: "ready:SHOP-1", action: "review:SHOP-1:1800000000001", at: 5, topic: "ready", task: "SHOP-1", place: "sp1" });
  expect(eventOf("ready:SHOP-1", ready).sticky).toBeUndefined();
  expect(eventOf("alert:a1", { title: "Fix login · Approve", body: "Code 1234", topic: "needs" }).sticky).toBe(true);
  expect(eventOf("k", { title: "cut…", body: "cut…", full: { title: "Whole title", body: "Whole body" } })).toMatchObject({ title: "Whole title", body: "Whole body" });
});

test("a broken file starts as the first run (nothing is sent for what waits)", () => {
  const file = fileIn();
  require("node:fs").writeFileSync(file, "{not json");
  const l = new AlertLedger(file, () => T0);
  expect(l.known).toBe(false);
  expect(tick(l, snapOf({ ask: "q1" }))).toEqual([]);
});
