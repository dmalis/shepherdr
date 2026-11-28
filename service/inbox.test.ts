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
  // fork Needs you 4/6: its review card, naming its action
  expect(ready.url).toBe("./?place=sp1&task=HERD-4&focus=review%3AHERD-4&action=review%3AHERD-4%3A0");
  expect(a.get("need:HERD-5/worker:q1")).toMatchObject({ topic: "needs", tag: "HERD-5", waits: true });
});

test("the list keeps an alert's whole words; the push keeps the watch's cut and never carries them", async () => {
  const title = "Agent · Pick a payment provider for the checkout";
  const body = "Stripe or Adyen? The checkout waits on it, and so does the launch on Friday, which is why this cannot wait long.";
  const before = alertsOf({ ...snap(), alerts: [] });
  const now = alertsOf({ ...snap(), alerts: [{ id: "a1", title, body, notify: true }] });
  const pushed = now.get("alert:a1")!;
  expect(pushed.title.length).toBeLessThanOrEqual(30);
  expect(pushed.body.length).toBeLessThanOrEqual(80);
  const box = new Inbox(join(dir(), "inbox.json"));
  box.record(before, now);
  expect(box.list()[0]).toMatchObject({ key: "alert:a1", title, body });
  // a question that needs you: the same (needAlert's words are cut only at the end)
  const long = "Which payment provider should the checkout use from Friday on, Stripe or Adyen, given the fees we compared?";
  const asks = alertsOf({ ...snap(), needs: [{ id: "q9", chat: "sp1", place: "sp1", question: { id: "q9", kind: "Question", title: long, choices: [] } }] });
  const box2 = new Inbox(join(dir(), "inbox.json"));
  box2.record(new Map(), asks);
  expect(box2.list()[0].body.length).toBeGreaterThan(80);
  expect([...asks.values()][0].body.length).toBeLessThanOrEqual(80);
  // what a device gets: the cut words, no `full`
  const sent: string[] = [];
  const push = new Push(() => "https://example.test", join(dir(), "push.json")) as any;
  push.subs = [{ endpoint: "https://push.example/x", keys: {}, at: 1 }];
  push.deliver = async (_s: unknown, payload: Uint8Array) => { sent.push(new TextDecoder().decode(payload)); return 201; };
  await push.send({ ...pushed });
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0])).not.toHaveProperty("full");
  expect(JSON.parse(sent[0]).title).toBe(pushed.title);
});

test("a new alert is a record on top, with its task; none for what was there when the service started", () => {
  const box = new Inbox(join(dir(), "inbox.json"));
  const first = alertsOf(snap({ ready: true }));
  box.record(null, first);
  expect(box.list()).toEqual([]);
  box.record(first, alertsOf(snap({ ready: true, need: true })));
  expect(box.list().map((x) => [x.key, x.task, x.waits])).toEqual([["need:HERD-5/worker:q1", "HERD-5", true]]);
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
  expect(box.list()[0]).toMatchObject({ key: "ready:HERD-4", closed: t });
  // Ready again: a new row of its own on top, unread and waiting; the one it resolved stays, read, below
  box.read("all");
  const first = box.list()[0].id;
  t += 60_000;
  box.record(none, ready);
  expect(box.list()).toHaveLength(2);
  expect(box.list()[0]).toMatchObject({ key: "ready:HERD-4", at: t, waits: true });
  expect(box.list()[0].id).not.toBe(first);
  expect(box.list()[0].read).toBeUndefined();
  expect(box.list()[0].closed).toBeUndefined();
  expect(box.list()[1]).toMatchObject({ id: first, read: true, closed: expect.any(Number) });
  // a read of the old row (a page that opened it) never reads the new one
  box.read([first]);
  expect(box.unread()).toBe(1);
});

test("an open alert from a machine that can't be reached stays open until it can say what happened", () => {
  const box = new Inbox(join(dir(), "inbox.json"));
  const ready = alertsOf(snap({ ready: true }));
  box.record(new Map(), ready);
  // its machine went quiet: the model has no task to show, so no alert either
  box.record(ready, new Map(), (x) => x.task === "HERD-4");
  expect(box.list()[0].closed).toBeUndefined();
  // back, still Ready: the same open row, not a second one
  box.record(new Map(), ready, () => false);
  expect(box.list()).toHaveLength(1);
  // back, and the task is no longer Ready
  box.record(ready, new Map(), () => false);
  expect(box.list()[0].closed).toEqual(expect.any(Number));
});

test("read on one device is read for all: kept in the file, a changed list rebuilds the snapshot", () => {
  const file = join(dir(), "inbox.json");
  const box = new Inbox(file);
  let told = 0;
  box.onChange = () => told++;
  box.record(alertsOf(snap()), alertsOf(snap({ ready: true, need: true })));
  expect(box.unread()).toBe(2);
  const id = box.list().find((x) => x.key === "ready:HERD-4")!.id;
  expect(box.read([id])).toBe(true);
  expect(box.read([id])).toBe(false);
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
});

/** a real browser's keys (P-256, 16 bytes of auth), so a delivery is encrypted and reaches fetch */
async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as ArrayBuffer).toString("base64url");
  return { p256dh: b64u(await crypto.subtle.exportKey("raw", pair.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
}

test("a device's last alert is its push service's answer: accepted, refused, or not reached; a test of a gone one says so", async () => {
  const real = globalThis.fetch;
  let answer: () => Promise<Response> = async () => new Response("", { status: 201 });
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => { calls.push(String(url)); return answer(); }) as unknown as typeof fetch;
  try {
    const q = new Push(() => "mailto:x@example.com", join(dir(), "push.json"));
    const endpoint = "https://push.example/mac";
    q.subscribe({ endpoint, keys: await browserKeys() });
    expect(await q.test(endpoint)).toMatchObject({ ok: true });
    expect(q.devices("")[0].last).toMatchObject({ status: 201 });
    answer = async () => new Response("", { status: 403 });
    await q.test(endpoint);
    expect(q.devices("")[0].last).toMatchObject({ status: 403 });
    answer = async () => { throw new Error("offline"); };
    await q.test(endpoint);
    expect(q.devices("")[0].last).toMatchObject({ status: 0 });
    expect(calls).toHaveLength(3);
    answer = async () => new Response("", { status: 410 });
    expect(await q.test(endpoint)).toMatchObject({ ok: false, gone: true });
    expect(q.devices("")).toEqual([]);
  } finally {
    globalThis.fetch = real;
  }
});

test("a failed write of a device's notes never stops its next alert", async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async () => { n++; return new Response("", { status: 201 }); }) as unknown as typeof fetch;
  try {
    const q = new Push(() => "mailto:x@example.com", join(dir(), "push.json")) as any;
    q.subscribe({ endpoint: "https://push.example/mac", keys: await browserKeys() });
    const save = q.save;
    q.save = () => { throw new Error("ENOSPC"); };
    await q.send({ title: "a", body: "", tag: "x", topic: "needs" });
    q.save = save;
    await q.send({ title: "b", body: "", tag: "y", topic: "needs" });
    expect(n).toBe(2);
    expect(q.sending.size).toBe(0);
  } finally {
    globalThis.fetch = real;
  }
});

test("last seen is written every 10 minutes of steady use, not only after a gap", () => {
  const file = join(dir(), "push.json");
  const p = new Push(() => "mailto:x@example.com", file);
  p.subscribe({ endpoint: "https://push.example/mac", keys: { p256dh: "x", auth: "y" } });
  for (let m = 0; m <= 30; m++) p.saw(["https://push.example/mac"], 1_000_000 + m * 60_000);
  const disk = JSON.parse(readFileSync(file, "utf8"))[0].seen;
  expect(disk).toBeGreaterThanOrEqual(1_000_000 + 20 * 60_000);
});

// fork Needs you 4/6: the bell is passive, keyed as delivery is: a task Ready again (another review round) between two
// reads closes the old row and adds a new one, whose link names the new round
test("a task Ready again is a new row; the old round's row closes", () => {
  const box = new Inbox(join(dir(), "inbox.json"));
  const ready = (needsAt: number) => alertsOf({ ...snap({ ready: true }), tasks: snap({ ready: true }).tasks.map((t) => ({ ...t, needsAt })) } as any);
  box.record(alertsOf(snap()), ready(1));
  box.record(ready(1), ready(2));
  const rows = box.list().filter((x) => x.key === "ready:HERD-4");
  expect(rows.map((x) => [x.action, !!x.closed])).toEqual([["review:HERD-4:2", false], ["review:HERD-4:1", true]]);
  expect(rows[0].url).toContain("action=review%3AHERD-4%3A2");
});
