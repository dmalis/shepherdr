// @ts-nocheck: fake subscriptions, a fake push service and hand-made glance docs
// fork "Needs you 3/6: one Notifications page": what reaches a device. Needs you is strict (only what the person must
// do), Needs you and done adds a done task, Off nothing; older choices map to them; a new message in a chat and a
// machine's or a schedule's warning never push (the bell keeps them); the phone app's glance feed follows the same
// rules; Space alerts Muted is the old Notify Off; nothing is pushed for what stopped waiting; a push lives an hour.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "reach-"));
const settingsFile = join(dir, "settings.json");
process.env.HERDR_TASK_SETTINGS = settingsFile;
const { Push, alertsOf, agentAlerts, schedulesFailed, wants } = await import("./push.ts");
const { GlanceFeed } = await import("./glance.ts");
const { configOf, setConfig } = await import("./next.ts");
const { canonical, levelOf, spaceAlertsOf, topicsOf, PUSH_TTL_S, REACH } = await import("../web/shared/reach.ts");
const { notifyOf, pushTopics } = await import("../web/shared/alerts.ts");
const { unreadChats } = await import("../web/shared/needs-you.ts");

const file = () => join(dir, `push-${Math.random()}.json`);
async function fakeSub(n: number) {
  const k = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey))).toString("base64url");
  return { endpoint: `https://push.example.test/dev${n}`, keys: { p256dh, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } };
}
let heads: Record<string, string>[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async (_url: string, init: any) => { heads.push(init.headers); return new Response(null, { status: 201 }); }) as any; });
afterAll(() => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { heads = []; });

/** a Push whose deliveries are kept as what each device was sent */
function recording() {
  const p = new Push(() => "https://example.test", file());
  const got: Record<string, any[]> = {};
  p.deliver = async (s, payload) => { (got[s.endpoint.split("/").pop()] ??= []).push(JSON.parse(new TextDecoder().decode(payload))); return 201; };
  return { p, got };
}

test("the device choices: Needs you is needs and ready only; Needs you and done adds done; nothing else ever pushes", () => {
  expect(REACH).toEqual(["Needs you", "Needs you and done", "Off"]);
  expect(topicsOf("Needs you")).toEqual(["needs", "ready"]);
  expect(topicsOf("Needs you and done")).toEqual(["needs", "ready", "done"]);
  const you = { topics: topicsOf("Needs you") }, done = { topics: topicsOf("Needs you and done") };
  expect(wants(you, { topic: "needs" }) && wants(you, { topic: "ready" })).toBe(true);
  expect(wants(you, { topic: "done" })).toBe(false);
  expect(wants(done, { topic: "done" })).toBe(true);
  // a new message in a chat and a machine's or a schedule's warning: no device, even one that kept them from before
  for (const topic of ["assistant", "ops"]) for (const topics of [topicsOf("Needs you and done"), ["needs", "ready", "done", "assistant", "ops"]]) expect(wants({ topics }, { topic })).toBe(false);
  // a space muted on the device: nothing from it
  expect(wants({ topics: topicsOf("Needs you and done"), muted: ["sp2"] }, { topic: "needs", place: "sp2" })).toBe(false);
  // a test has no topic: always
  expect(wants({ topics: [] }, {})).toBe(true);
});

test("older choices keep what they got: Needs me is Needs you, Everything Needs you and done, Off stays off", () => {
  // the old page's Needs me (needs, ready) and Everything (needs, ready, done; an older one with messages too)
  expect(levelOf(["needs", "ready"])).toBe("Needs you");
  expect(levelOf(["needs", "ready", "done"])).toBe("Needs you and done");
  expect(levelOf(["needs", "ready", "done", "assistant"])).toBe("Needs you and done");
  // single topics from before: Done makes it Needs you and done, any other Needs you; a message topic is dropped
  expect(canonical(["needs", "assistant"])).toEqual(["needs", "ready"]);
  expect(canonical(["ready"])).toEqual(["needs", "ready"]);
  expect(canonical(["done"])).toEqual(["needs", "ready", "done"]);
  expect(canonical(["ops"])).toEqual([]);
  expect(canonical([])).toEqual([]);
  // a subscription from before devices chose (no topics kept): Needs you
  expect(pushTopics(undefined)).toEqual(["needs", "ready"]);
  expect(pushTopics(["needs", "autopilot", "done"])).toEqual(["needs", "ready", "done"]);
});

test("the leak fixed: a new message in a chat goes to the bell, never to a device", async () => {
  const snap = { places: [{ id: "sp1", name: "shop", chat: "p:sp1" }], tasks: [], needs: [], last: { "p:sp1": 9 }, read: { "p:sp1": 1 }, settings: [] };
  const msg = [...alertsOf(snap, () => "Merged it.").values()];
  expect(msg.map((a) => a.topic)).toEqual(["assistant"]);
  const { p, got } = recording();
  const [a, b] = [await fakeSub(1), await fakeSub(2)];
  p.subscribe(a); p.subscribe(b);
  // b kept the old Everything with messages
  p.choose(b.endpoint, { topics: ["needs", "ready", "done", "assistant"] });
  await p.send(msg[0]);
  expect(got).toEqual({});
});

test("machine and schedule warnings are the ops topic: in the alerts made (the bell), on no device", async () => {
  const terms = [
    { address: "t1", name: "guard", state: "live", labels: { "herdr.alert": JSON.stringify({ id: "m1", at: 5, title: "Memory at 93% · 2 agents stopped", body: "Freed memory.", about: "memory" }) } },
    { address: "t2", name: "revive", state: "live", labels: { "herdr.alert": JSON.stringify({ id: "r1", at: 5, title: "Not back after the restart", body: "2 chats", restart: ["sp1"] }) } },
    { address: "t3", name: "worker", state: "live", labels: { "herdr.task": "shop#1", "herdr.alert": JSON.stringify({ id: "w1", at: 5, title: "Stuck", body: "why" }) } },
  ];
  const snap = { places: [{ id: "sp1", name: "shop", chat: "sp1" }], tasks: [{ id: "SHOP-1", name: "Fix login", place: "sp1" }], settings: [],
    automations: { sp1: [{ id: "nightly", name: "Nightly check", failed: 77, error: "It couldn't start." }] } };
  snap.alerts = agentAlerts(terms, snap, () => null, dir);
  expect(snap.alerts.map((a) => [a.id, !!a.ops])).toEqual([["m1", true], ["r1", true], ["w1", false]]);
  const made = alertsOf(snap);
  expect([...made].map(([k, a]) => [k, a.topic])).toEqual([["alert:m1", "ops"], ["alert:r1", "ops"], ["alert:w1", "needs"], ["schedule::nightly:77", "ops"]]);
  expect(made.get("schedule::nightly:77")).toMatchObject({ title: "Nightly che… · Schedule failed", topic: "ops", place: "sp1", url: "./?place=sp1" });
  const { p, got } = recording();
  const a = await fakeSub(1);
  p.subscribe(a);
  p.choose(a.endpoint, { topics: topicsOf("Needs you and done") });
  for (const x of made.values()) await p.send(x);
  expect(got.dev1.map((x) => x.title)).toEqual(["Agent · Stuck"]);
  // a muted space (the old Notify Off): its schedule warning stays in the bell, marked muted
  const off = { ...snap, settings: [{ level: "sp1", rows: [{ key: "notify", value: "Off" }] }] };
  expect(schedulesFailed(off).map((x) => x.muted)).toEqual([true]);
});

test("a push lives an hour at the push service, not a day", async () => {
  expect(PUSH_TTL_S).toBe(3600);
  const p = new Push(() => "https://example.test", file());
  const a = await fakeSub(1);
  p.subscribe(a);
  await p.send({ title: "x", topic: "needs" });
  expect(heads[0].ttl).toBe("3600");
});

test("the phone app: warnings never notify, a space its device muted never; the rest as before", () => {
  const g = new GlanceFeed(() => 1, 0);
  const doc = { format: 1, v: "1", urgent: "u", at: 1, counts: { needs: 2, working: 0, ready: 0, done: 0 }, order: [], groups: [], unread: 0, spaces: [], chats: [], usage: null,
    items: [
      { key: "need:A", kind: "needs", type: "need", tag: "A", title: "A · Needs you", body: "", alert: true, url: "./?place=sp1&task=A" },
      { key: "need:B", kind: "needs", type: "need", tag: "B", title: "B · Needs you", body: "", alert: true, url: "./?place=sp2&task=B" },
      { key: "alert:m1", kind: "needs", type: "alert", tag: "alert:m1", title: "Memory at 93%", body: "", alert: true, ops: true, url: "./?place=sp2" },
    ],
    events: [{ key: "schedule::n:1", kind: "schedule", title: "Nightly check · Schedule failed", body: "", alert: true, place: "sp1" }] };
  g.set(doc);
  const alerting = (d) => [...d.items, ...d.events].filter((i) => i.alert).map((i) => i.key);
  expect(alerting(g.docFor("phone"))).toEqual(["need:A", "need:B"]);
  // the warnings still show in its list
  expect(g.docFor("phone").items.map((i) => i.key)).toEqual(["need:A", "need:B", "alert:m1"]);
  g.muted = () => ["sp1"];
  expect(alerting(g.docFor("phone"))).toEqual(["need:B"]);
  // what notifies changed, so its urgent did
  expect(g.docFor("phone").urgent).not.toBe(doc.urgent);
});

test("a device's muted spaces for its phone app: the ones muted on all its subscriptions", async () => {
  const p = new Push(() => "https://example.test", file());
  const [a, b] = [await fakeSub(1), await fakeSub(2)];
  p.subscribe(a, "pwa", undefined, "node1"); p.subscribe(b, "chrome", undefined, "node1");
  p.choose(a.endpoint, { muted: ["sp1", "sp2"] });
  p.choose(b.endpoint, { muted: ["sp2"] });
  expect(p.mutedOn("node1")).toEqual(["sp2"]);
  expect(p.mutedOn("node2")).toEqual([]);
});

test("Space alerts: On by default, Muted kept as the space's own \"alerts\", and Muted is the old Notify Off", () => {
  writeFileSync(settingsFile, JSON.stringify({}));
  const pick = { agent: "claude", model: null, effort: null, fast: false, perm: null };
  const config = () => configOf({ defaults: { Chats: pick, Tasks: pick, Reviews: pick }, spaces: ["sp1", "sp2"], secrets: [], plans: [] });
  expect(config().all.alerts).toBe("On");
  expect(spaceAlertsOf({ config: config() }, "sp1")).toBe("On");
  setConfig("sp1", "alerts", "Muted", { id: "sp1", name: "shop", machine: null });
  expect(JSON.parse(readFileSync(settingsFile, "utf8")).spaces.sp1).toMatchObject({ alerts: "muted", name: "shop" });
  const c = config();
  expect(c.spaces.sp1).toMatchObject({ alerts: "Muted", own: ["alerts"] });
  expect(c.spaces.sp2).toBeUndefined();
  const snap = { config: c, settings: [], places: [{ id: "sp1", chat: "p:sp1" }, { id: "sp2", chat: "p:sp2" }], tasks: [], needs: [], last: { "p:sp1": 9, "p:sp2": 9 }, read: {} };
  expect([notifyOf(snap, "sp1"), notifyOf(snap, "sp2")]).toEqual(["Off", "Needs me"]);
  // a muted space's chat isn't unread in the list, as with Notify Off
  expect(unreadChats(snap).map((x) => x.place)).toEqual(["sp2"]);
  // its schedule's warning is made quiet
  expect(schedulesFailed({ ...snap, automations: { sp1: [{ id: "n", name: "Nightly", failed: 3, error: "x" }] } }).map((x) => x.muted)).toEqual([true]);
  // Reset: back to Everything's (On); only its two choices
  setConfig("sp1", "alerts", null, { id: "sp1", name: "shop", machine: null });
  expect(config().spaces.sp1).toBeUndefined();
  expect(() => setConfig("sp1", "alerts", "Off", { id: "sp1", name: "shop", machine: null })).toThrow("Not one of its choices.");
});

test("Off on a device reaches its phone app: nothing notifies there until alerts are on again", async () => {
  const f = file();
  const p = new Push(() => "https://example.test", f);
  const [a, b] = [await fakeSub(1), await fakeSub(2)];
  p.subscribe(a, "pwa", undefined, "node1"); p.subscribe(b, "mac", undefined, "node2");
  // a subscription lost for another reason (gone at the push service) isn't Off
  p.unsubscribe(b.endpoint);
  expect(p.offOn("node2")).toBe(false);
  p.turnOff(a.endpoint);
  expect(p.offOn("node1")).toBe(true);
  // kept across a restart
  expect(new Push(() => "https://example.test", f).offOn("node1")).toBe(true);
  const g = new GlanceFeed(() => 1, 0);
  g.set({ format: 1, v: "1", urgent: "u", at: 1, counts: { needs: 1, working: 0, ready: 0, done: 0 }, order: [], groups: [], unread: 0, spaces: [], chats: [], usage: null, events: [],
    items: [{ key: "need:A", kind: "needs", type: "need", tag: "A", title: "A · Needs you", body: "", alert: true, url: "./?place=sp1&task=A" }] });
  g.off = (d) => p.offOn(d);
  expect(g.docFor("node1").items[0].alert).toBe(false);
  expect(g.docFor("node2").items[0].alert).toBe(true);
  // on again there
  p.subscribe(a, "pwa", undefined, "node1", true);
  expect(p.offOn("node1")).toBe(false);
  expect(g.docFor("node1").items[0].alert).toBe(true);
});

test("a phone app's stream with no known device still never buzzes for a warning", async () => {
  const g = new GlanceFeed(() => 1, 0);
  g.set({ format: 1, v: "1", urgent: "u", at: 1, counts: { needs: 0, working: 0, ready: 0, done: 0 }, order: [], groups: [], unread: 0, spaces: [], chats: [], usage: null, items: [],
    events: [{ key: "machine:vm:down", kind: "machine", title: "Can't reach vm", body: "", alert: true }] });
  const first = async (r) => { const rd = r.body.getReader(); const { value } = await rd.read(); await rd.cancel(); return new TextDecoder().decode(value); };
  expect(await first(g.stream(null, true))).toContain('"alert":false');
  // a plain stream (no notifications of its own) keeps the doc as it is
  expect(await first(g.stream(null, false))).toContain('"alert":true');
});
