// dmalis/shepherdr#59: a message sent while its agent asks something (a question or a permission card, or its own
// menu) is never refused: it waits, nothing typed and no key pressed, and goes by itself once the card is answered,
// mid-turn or as the next message when the answer ended its turn. One that raced the card (hc saw the question before
// Shepherdr did) waits the same way. Fake data, no real hc.
import { beforeEach, expect, test } from "bun:test";
import { Compat } from "./compat.ts";
import { act, asking, carded } from "./actions.ts";
import { forgetAll, wentIn } from "./send-once.ts";
import { ASKING, ASKING_TERMINAL, WAITS_ANSWER } from "../core/asking.js";

const SPACE = { "herdr.role": "coordinator", "herdr.coordinator.space": "sp1", "herdr.space": "sp1", "herdr.agent": "codex" };
/** the service's held line looks once a second */
const tick = () => Bun.sleep(1300);

/** a hub whose Assistant t1 asks something until it is answered: hc refuses a send as blocked meanwhile. status: what
 *  Shepherdr's status says (a race: still "working" while hc already sees the question) */
function world(card: boolean, status = "blocked", refuses = true) {
  const sent: string[] = [], calls: string[] = [];
  let asks = true;
  const t: any = { address: "t1", state: "live", argv: ["codex"], foreground: { name: "codex" }, status: { state: status }, labels: { ...SPACE } };
  const hub: any = {
    terminals: new Map<string, any>([["t1", t]]),
    on: () => () => {},
    front: async () => "agent",
    call: async (m: string) => { calls.push(m); throw new Error("no machine.exec here"); },
    keys: async () => { calls.push("keys"); return { code: 0, stdout: "", stderr: "" }; },
    send: async (_addr: string, text: string) => {
      if (asks && refuses) return { code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: "blocked", message: "terminal is blocked" } }) };
      sent.push(text);
      return { code: 0, stdout: "{}", stderr: "" };
    },
  };
  const compat = new Compat() as any;
  compat.spaceList = [{ id: "sp1", machine: null, folder: "/srv/shop", assistant: "t1" }];
  compat.addrOf = (k: string) => (k === "p:sp1" ? "t1" : null);
  compat.tasksFor = () => [];
  let open = card ? [{ id: "t1.1795800000.1", terminal: "t1", kind: "Permission", command: "npm test" }] : [];
  compat.asks = { of: (a: string) => open.filter((x) => x.terminal === a), open: new Map() };
  const noted: string[] = [];
  compat.noteSend = (_a: string, s: { cid: string }) => noted.push(s.cid);
  /** answered: its turn goes on (working), or the answer ended it (idle) */
  const answer = (then = "working") => { asks = false; open = []; t.status = { state: then }; };
  return { hub, compat, sent, calls, noted, answer, t };
}

beforeEach(() => forgetAll());

test("a send while a permission card waits: kept, then sent by itself once answered, nothing typed meanwhile", async () => {
  const w = world(true);
  const r = await act(w.hub, { type: "send", chat: "p:sp1", text: "and run the linter too", cid: "asking-p1" }, w.compat);
  expect(r).toEqual({ ok: true, waiting: true, waitsFor: WAITS_ANSWER });
  await tick();
  expect(w.sent).toEqual([]);
  expect(w.calls).toEqual([]);
  w.answer();
  await tick();
  expect(w.sent).toEqual(["and run the linter too"]);
  expect(w.noted).toEqual(["asking-p1"]);
});

test("the answer ended its turn: it goes as the next message", async () => {
  const w = world(true);
  await act(w.hub, { type: "send", chat: "p:sp1", text: "now the docs", cid: "asking-p2" }, w.compat);
  w.answer("idle");
  await tick();
  expect(w.sent).toEqual(["now the docs"]);
});

test("only its terminal asks (no card): it waits the same way", async () => {
  const w = world(false);
  expect(asking(w.hub, w.compat, "t1")).toBe(true);
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "hi", cid: "asking-p3" }, w.compat)).toMatchObject({ waiting: true, waitsFor: WAITS_ANSWER });
  w.answer();
  await tick();
  expect(w.sent).toEqual(["hi"]);
});

test("the race: Shepherdr still says working, hc already sees the question: kept, not refused", async () => {
  const w = world(false, "working");
  expect(asking(w.hub, w.compat, "t1")).toBe(false);
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "one more thing", cid: "asking-p4" }, w.compat)).toMatchObject({ waiting: true, waitsFor: WAITS_ANSWER });
  // its status catches up: the question shows
  w.t.status = { state: "blocked" };
  await tick();
  expect(w.sent).toEqual([]);
  w.answer();
  await tick();
  expect(w.sent).toEqual(["one more thing"]);
});

test("Send now can't push one waiting for an answer past its question; sent again with its id it stays one", async () => {
  const w = world(true);
  await act(w.hub, { type: "send", chat: "p:sp1", text: "x", cid: "asking-p5" }, w.compat);
  await act(w.hub, { type: "held-now", cid: "asking-p5" }, w.compat);
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "x", cid: "asking-p5" }, w.compat)).toMatchObject({ waiting: true });
  await tick();
  expect(w.sent).toEqual([]);
  w.answer();
  await tick();
  expect(w.sent).toEqual(["x"]);
});

test("a reaction can't wait: it says where to answer", async () => {
  const w = world(true);
  w.compat.reader = () => ({ conv: { items: [{ id: "m1", text: "Which one?" }], reactions: new Map() } });
  const e: any = await act(w.hub, { type: "react", chat: "p:sp1", message: "m1", emoji: "👍" }, w.compat).catch((x) => x);
  expect(e.message).toBe(ASKING);
  w.compat.asks = { of: () => [], open: new Map() };
  const t: any = await act(w.hub, { type: "react", chat: "p:sp1", message: "m1", emoji: "👍" }, w.compat).catch((x) => x);
  expect(t.message).toBe(ASKING_TERMINAL);
});

test("carded: only the agent's own open asks count", () => {
  const compat: any = { asks: { of: (a: string) => (a === "t1" ? [{}] : []) } };
  expect(carded(compat, "t1")).toBe(true);
  expect(carded(compat, "t2")).toBe(false);
  expect(carded({ asks: null } as any, "t1")).toBe(false);
});

// review round 1: Codex reports "working" while its permission hook waits, and hc doesn't refuse a send then
test("a card open while it says working: no send goes, Ctrl+Enter's and Send now's included", async () => {
  const w = world(true, "working", false);
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "plain", cid: "asking-r1" }, w.compat)).toMatchObject({ waitsFor: WAITS_ANSWER });
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "later", cid: "asking-r2", hold: true }, w.compat)).toMatchObject({ waitsFor: "turn" });
  await act(w.hub, { type: "held-now", cid: "asking-r2" }, w.compat);
  await tick();
  expect(w.sent).toEqual([]);
  w.answer("idle");
  await tick();
  expect(w.sent).toEqual(["plain", "later"]);
});

test("one sent right after the answer never overtakes one that waited for it", async () => {
  const w = world(true);
  await act(w.hub, { type: "send", chat: "p:sp1", text: "A", cid: "asking-o1" }, w.compat);
  w.answer();
  // before the held line's next look
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "B", cid: "asking-o2" }, w.compat)).toMatchObject({ waitsFor: WAITS_ANSWER });
  await tick();
  expect(w.sent).toEqual(["A", "B"]);
});

test("once it went, asked again with its id it says so, across a restart: never twice", async () => {
  const w = world(true);
  await act(w.hub, { type: "send", chat: "p:sp1", text: "once", cid: "asking-w1" }, w.compat);
  w.answer();
  await tick();
  expect(wentIn("asking-w1")).toEqual(expect.any(Number));
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "once", cid: "asking-w1" }, w.compat)).toMatchObject({ ok: true, at: expect.any(Number) });
  forgetAll();
  expect(await act(w.hub, { type: "send", chat: "p:sp1", text: "once", cid: "asking-w1" }, w.compat)).toMatchObject({ ok: true, at: expect.any(Number) });
  expect(w.sent).toEqual(["once"]);
});
