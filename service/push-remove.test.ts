// @ts-nocheck: fake subscriptions and a fake push service
// fork #96 ("Notifications: remove a device"): Settings › Notifications removes any device from its list, by the row's
// id, never by an endpoint: only that device stops getting alerts, an unknown id changes nothing, and this device's
// own removal is the same as turning alerts off here. A removed device's page doesn't sign itself up again on its own.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { Push } from "./push.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "push-remove-"));

async function fakeSub(n: number) {
  const k = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const p256dh = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey))).toString("base64url");
  return { endpoint: `https://push.example.test/dev${n}`, keys: { p256dh, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url") } };
}

let hits: string[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async (url: string) => { hits.push(String(url).split("/").pop()!); return new Response(null, { status: 201 }); }) as any; });
afterAll(() => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { hits = []; });

const file = () => join(dir, `push-${Math.random()}.json`);
async function three() {
  const f = file();
  const p = new Push(() => "https://example.test", f);
  const [a, b, c] = [await fakeSub(1), await fakeSub(2), await fakeSub(3)];
  p.subscribe(a, "phone"); p.subscribe(b, "laptop"); p.subscribe(c, "old laptop");
  return { p, f, a, b, c };
}
const idOf = (p, mine: string, device: string) => p.devices(mine).find((d) => d.device === device).id;

test("removing a device by its id drops only that one: it gets no more alerts, the others still do", async () => {
  const { p, f, a, b, c } = await three();
  expect(p.remove(idOf(p, a.endpoint, "old laptop"))).toBe(true);
  expect(p.devices(a.endpoint).map((d) => d.device)).toEqual(["phone", "laptop"]);
  expect(p.state(c.endpoint).on).toBe(false);
  expect(p.state(b.endpoint)).toEqual({ on: true, topics: ["needs", "ready"], muted: [], devices: 2 });
  await p.send({ title: "x", topic: "needs" });
  expect(hits.sort()).toEqual(["dev1", "dev2"]);
  // kept: a restart doesn't bring it back, and no endpoint is written for the removed one
  expect(JSON.parse(readFileSync(f, "utf8")).map((s) => s.endpoint)).toEqual([a.endpoint, b.endpoint]);
  expect(readFileSync(f.replace(/\.json$/, "-removed.json"), "utf8")).not.toContain("push.example.test");
  expect(new Push(() => "https://example.test", f).state(c.endpoint)).toEqual({ on: false, topics: ["needs", "ready"], muted: [], devices: 2, removed: true });
});

test("an unknown or empty id changes nothing", async () => {
  const { p, a } = await three();
  const before = JSON.stringify(p.devices(a.endpoint));
  expect(p.remove("000000000000")).toBe(false);
  expect(p.remove("")).toBe(false);
  // an endpoint is never an id: a page can't remove another device by naming its endpoint
  expect(p.remove(a.endpoint)).toBe(false);
  expect(JSON.stringify(p.devices(a.endpoint))).toBe(before);
});

test("removing this device by its id is the same as turning alerts off here", async () => {
  const one = await three(), two = await three();
  one.p.remove(idOf(one.p, one.a.endpoint, "phone"));
  two.p.unsubscribe(two.a.endpoint);
  const { removed, ...state } = one.p.state(one.a.endpoint);
  expect(state).toEqual(two.p.state(two.a.endpoint));
  expect(one.p.devices(one.a.endpoint)).toEqual(two.p.devices(two.a.endpoint));
  expect(JSON.parse(readFileSync(one.f, "utf8")).map((s) => s.endpoint)).toEqual(JSON.parse(readFileSync(two.f, "utf8")).map((s) => s.endpoint));
});

test("a removed device's page giving its subscription back on its own (an older build too) is refused: it stays removed", async () => {
  const { p, a, c } = await three();
  p.remove(idOf(p, a.endpoint, "old laptop"));
  // a tab left open since before this change runs the old readNow: subscribe with no turnOn
  expect(() => p.subscribe(c, "old laptop")).toThrow("removed from the list");
  expect(() => p.subscribe(c, "old laptop", c.endpoint, null)).toThrow("removed from the list");
  expect(p.state(c.endpoint)).toEqual({ on: false, topics: ["needs", "ready"], muted: [], devices: 2, removed: true });
  await p.send({ title: "x", topic: "needs" });
  expect(hits.sort()).toEqual(["dev1", "dev2"]);
});

test("a removed device turned on again on that device is on, and no longer removed", async () => {
  const { p, a, c } = await three();
  p.remove(idOf(p, a.endpoint, "old laptop"));
  expect(p.state(c.endpoint).removed).toBe(true);
  p.subscribe(c, "old laptop", undefined, null, true);
  expect(p.state(c.endpoint)).toEqual({ on: true, topics: ["needs", "ready"], muted: [], devices: 3 });
  // a device turned off on its own (not removed) says nothing of removal
  p.unsubscribe(a.endpoint);
  expect(p.state(a.endpoint).removed).toBeUndefined();
});

test("the service takes a removal by id beside unsubscribe and the devices list, with the same auth", () => {
  const main = readFileSync(join(import.meta.dir, "main.ts"), "utf8");
  const block = main.slice(main.indexOf('if (path.startsWith("/api/push/") && req.method === "POST")'), main.indexOf("fork #37: the bell's list"));
  expect(block).toContain('if (path === "/api/push/unsubscribe")');
  // only a page's own Turn on brings a removed device back (alerts/device.ts turnOn sends it)
  expect(main).toContain('await deviceFrom(req, pass.via), body?.turnOn === true);');
  expect(readFileSync(join(import.meta.dir, "../web/plugins/alerts/device.ts"), "utf8")).toContain("await post('subscribe', { sub, device: navigator.userAgent, turnOn: true })");
  expect(block).toContain('if (path === "/api/push/remove") return json({ ok: true, removed: push.remove(typeof body?.id === "string" ? body.id : ""), devices: push.devices(endpoint) });');
});
