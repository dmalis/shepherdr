// The alerts list (fork #37, "Alerts: a list in the app, and every device gets them"): one record per push alert,
// resolved when it stops waiting, read on one device and so on all, kept 7 days or 200. Built on what upstream's push
// path makes (service/push.ts alertsOf, Push): these tests pin that too.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Inbox, KEEP_MAX, KEEP_MS } from "./inbox.ts";
import { alertsOf, Push } from "./push.ts";

const dir = () => mkdtempSync(join(tmpdir(), "inbox-"));
const snap = (o: { ready?: boolean; need?: boolean } = {}) => ({
  places: [{ id: "sp1", name: "shop", chat: "sp1" }],
  tasks: [{ id: "HERD-4", name: "Fix login", status: o.ready ? "ready" : "working", place: "sp1", summary: "Login works again" }],
  needs: o.need ? [{ id: "q1", chat: "HERD-5/worker", place: "sp1", task: "HERD-5" }] : [],
  last: {}, read: {},
});

test("pin: alertsOf still makes the alerts the list keeps, keyed, with their words, topic, task link and waits", () => {
  const a = alertsOf(snap({ ready: true, need: true }));
  const ready = a.get("ready:HERD-4")!;
  expect(ready).toMatchObject({ title: expect.stringContaining("Fix login"), body: "Login works again", tag: "HERD-4", topic: "ready", place: "sp1", waits: true });
  expect(ready.url).toBe("./?place=sp1&task=HERD-4");
  expect(a.get("need:HERD-5/worker:q1")).toMatchObject({ topic: "needs", tag: "HERD-5", waits: true });
});

test("a new alert is a record on top, with its task; none for what was there when the service started", () => {
  const box = new Inbox(join(dir(), "inbox.json"));
  const first = alertsOf(snap({ ready: true }));
  box.record(null, first);
  expect(box.list()).toEqual([]);
  box.record(first, alertsOf(snap({ ready: true, need: true })));
  expect(box.list().map((x) => [x.id, x.task, x.waits])).toEqual([["need:HERD-5/worker:q1", "HERD-5", true]]);
  expect(box.unread()).toBe(1);
});

test("an alert that stops waiting is marked resolved, and stays in the list", () => {
  let t = 1_000_000;
  const box = new Inbox(join(dir(), "inbox.json"), () => t);
  const none = alertsOf(snap());
  const ready = alertsOf(snap({ ready: true }));
  box.record(none, ready);
  expect(box.list()[0].closed).toBeUndefined();
  t += 60_000;
  box.record(ready, none);
  expect(box.list()[0]).toMatchObject({ id: "ready:HERD-4", closed: t });
  // Ready again: it moves up, unread and waiting again
  box.read("all");
  t += 60_000;
  box.record(none, ready);
  expect(box.list()).toHaveLength(1);
  expect(box.list()[0]).toMatchObject({ at: t, waits: true });
  expect(box.list()[0].read).toBeUndefined();
  expect(box.list()[0].closed).toBeUndefined();
});

test("read on one device is read for all: kept in the file, a changed list rebuilds the snapshot", () => {
  const file = join(dir(), "inbox.json");
  const box = new Inbox(file);
  let told = 0;
  box.onChange = () => told++;
  box.record(alertsOf(snap()), alertsOf(snap({ ready: true, need: true })));
  expect(box.unread()).toBe(2);
  expect(box.read(["ready:HERD-4"])).toBe(true);
  expect(box.read(["ready:HERD-4"])).toBe(false);
  expect(told).toBe(1);
  expect(new Inbox(file).unread()).toBe(1);
  box.read("all");
  expect(new Inbox(file).unread()).toBe(0);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("an Assistant's new message takes its chat's last one's place", () => {
  const box = new Inbox(join(dir(), "inbox.json"));
  const msg = (n: number) => new Map([[`msg:sp1:${n}`, { title: "#shop Assistant · New message", body: `said ${n}`, tag: "msg:sp1", topic: "assistant", place: "sp1", url: "./?place=sp1" }]]);
  box.record(new Map(), msg(1));
  box.record(msg(1), msg(2));
  expect(box.list().map((x) => x.body)).toEqual(["said 2"]);
});

test("kept 7 days, at most 200", () => {
  let t = 10 * KEEP_MS;
  const file = join(dir(), "inbox.json");
  const box = new Inbox(file, () => t);
  const one = (i: number) => new Map([[`alert:${i}`, { title: `a${i}`, body: "", tag: `alert:${i}`, topic: "needs" }]]);
  box.record(new Map(), one(0));
  t += KEEP_MS + 1;
  for (let i = 1; i <= KEEP_MAX + 5; i++) box.record(new Map(), one(i));
  expect(box.list()).toHaveLength(KEEP_MAX);
  expect(box.list()[0].title).toBe(`a${KEEP_MAX + 5}`);
  expect(box.list().some((x) => x.title === "a0")).toBe(false);
  expect(JSON.parse(readFileSync(file, "utf8"))).toHaveLength(KEEP_MAX);
});

test("pin: Push lists its devices by a hash, never an endpoint, with last seen and its last alert", async () => {
  const file = join(dir(), "push.json");
  const p = new Push(() => "mailto:x@example.com", file);
  const sub = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "x", auth: "y" } });
  p.subscribe(sub("mac"), "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0");
  p.subscribe(sub("phone"), "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
  p.saw(["https://push.example/phone"], 5000);
  const list = p.devices("https://push.example/mac");
  expect(list).toHaveLength(2);
  expect(JSON.stringify(list)).not.toContain("push.example");
  expect(list[0]).toMatchObject({ device: expect.stringContaining("Macintosh"), mine: true, topics: ["needs", "ready"] });
  expect(list[0].seen).toBeUndefined();
  expect(list[1]).toMatchObject({ seen: 5000 });
  expect(list[1].mine).toBeUndefined();
  // a delivery that can't reach its push service is kept as status 0 (no network here: a refused address)
  const q = new Push(() => "mailto:x@example.com", join(dir(), "push.json"));
  q.subscribe({ endpoint: "https://127.0.0.1:1/x", keys: { p256dh: "BPcYz0Yb0hM7ek9JqVlOHWj5Vq1OdZdOyYFHBeRmn-0oZg8bOyQ6JdYEH6VdNq1kLwFLhM7I8xYeV2q2v0FoJXU", auth: "c2VjcmV0c2VjcmV0MTIzNA" } });
  await q.test("https://127.0.0.1:1/x");
  expect(q.devices("")[0].last).toMatchObject({ status: 0 });
});
