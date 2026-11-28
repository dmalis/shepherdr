// Shepherdr's asks in Needs you (dmalis/shepherdr): a space's Shepherdr that ends its turn waiting on the person in
// plain words is one of the person's actions, on every surface but push; one that only chats is not. The idle mark
// says quietly that a space stopped with work to start. Made-up data.
import { expect, test } from "bun:test";
import { attend } from "./attention.ts";
import { alertsOf } from "./push.ts";
import { glanceOf } from "./glance.ts";
import { PlainAsks } from "./plain-ask.ts";
import { attentionOf } from "../web/shared/attention.ts";
import { waiting } from "../web/shared/alerts.ts";
import { needsChats, needsItems } from "../web/shared/needs-open.ts";
import { asksYou, idleWords, plainAskOf, spaceIdle } from "../web/shared/plain-ask.ts";
import { needsCount } from "../web/shared/view.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;
const place = (id: string, x: any = {}) => ({ id, name: id.split(":").pop(), machine: "box", level: 0, status: "idle", mode: "regular", chat: id, shepherdr: "running", ...x });
const task = (id: string, pl: string, status: string, x: any = {}) => ({ id, name: `Task ${id}`, place: pl, status, state: status, created: "", age: "", at: NOW - 30 * min, ...x });
const snapOf = (x: any = {}) => ({ name: "", host: "box", user: "", demo: false, everything: "p:box:root", machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }],
  places: [place("p:box:root", { home: true }), place("p:box:shop")], tasks: [], needs: [], automations: {}, artifacts: [], asks: {}, settings: [], last: { "p:box:root": 4, "p:box:shop": 7 }, read: {}, ...x });

// the shape of the message that went unseen: no question mark, a proposal, three bubbles, nothing running
const STALLED = "No, nothing's stuck. Every task I started is finished and merged, and the next step on the sticker book is your call: how the page should look.\n\n" +
  "A few things wait on their own:\n- **The last findings** post tomorrow.\n- **The new release** comes in with the next sync.\n\n" +
  "To keep things moving meanwhile, I'd start on the one that hurts every task now: **the checkout total is wrong**.\n\n" +
  '<hc suggest="Yes, fix the total now"/>\n<hc suggest="Show me the page first"/>\n<hc suggest="Leave it for today"/>';
const words = (text: string, suggests: string[] = []) => ({ who: "agent" as const, text, suggests });
const asked = (text: string, suggests: string[], turn = 7) => plainAskOf(words(text, suggests), turn)!;
const withAsk = (ask: any, x: any = {}) => snapOf({ places: [place("p:box:root", { home: true }), place("p:box:shop", { asks: ask })], ...x });

function surfaces(s: any) {
  const snap = attend(structuredClone(s), NOW, new Map());
  const alerts = alertsOf(snap);
  return {
    snap,
    count: needsCount(snap),
    space: needsCount(snap, "p:box:shop"),
    items: needsItems(snap).length,
    rows: needsChats(snap, [""]).length,
    badge: waiting(snap, NOW).count,
    glance: glanceOf(snap, alerts, NOW).counts.needs,
    pushes: [...alerts.values()].filter((a: any) => !a.muted && a.waits).length,
  };
}

test("its newest words: the closing question, else its closing line; the bubbles counted; tags never words", () => {
  expect(plainAskOf(words(STALLED, ["a", "b", "c"]), 7)).toEqual({
    what: "To keep things moving meanwhile, I'd start on the one that hurts every task now: the checkout total is wrong.", question: false, choices: 3, turn: 7 });
  const q = asked("Merged both.\n\nShould I start the **migration** now, or wait for the review?\n\n<hc suggest=\"Start it now\"/>", ["Start it now", "Wait"]);
  expect(q).toEqual({ what: "Should I start the migration now, or wait for the review?", question: true, choices: 2, turn: 7 });
  // a list of options closing the message: the line that leads into it asks
  expect(asked("Two ways to go. Which one?\n\n1. A plain list\n2. Cards", ["1, a plain list", "2, cards"]).question).toBe(true);
  // a question earlier on, then a closing statement: not a question now
  expect(asked("Want the diff?\n\nAll three are merged. Nothing waits on you.", ["status?", "Show the diff"]).question).toBe(false);
  // the person wrote last, or nothing with words
  expect(plainAskOf({ who: "you", text: "Yes, do it" }, 7)).toBeNull();
  expect(plainAskOf(words('<hc suggest="status?"/>'), 7)).toBeNull();
  expect(asked("x".repeat(300) + "?", [], 1).what.length).toBe(120);
});

test("the message that went unseen: one action of yours in Needs you, counted everywhere, never pushed", () => {
  const x = surfaces(withAsk(asked(STALLED, ["a", "b", "c"]), { tasks: [task("SHOP-1", "p:box:shop", "done")] }));
  expect([x.count, x.space, x.items, x.rows, x.badge, x.glance]).toEqual([1, 1, 1, 1, 1, 1]);
  // read off words, and the message already went to the bell: it buzzes nothing
  expect(x.pushes).toBe(0);
  const [a] = attentionOf(x.snap).actions;
  expect(a).toMatchObject({ id: "chat:p:box:shop", owner: "you", kind: "chat", plain: true, place: "p:box:shop", chat: "p:box:shop" });
  // its row: the space asks you, its question under it
  expect(needsChats(x.snap, [""])[0]).toMatchObject({ place: "p:box:shop", card: null, sub: a!.what });
});

test("a direct question with its answers offered waits on you even while tasks run", () => {
  const ask = asked("The review found one thing. Merge it as it is, or fix it first?", ["Merge it as it is", "Fix it first"]);
  const x = surfaces(withAsk(ask, { tasks: [task("SHOP-1", "p:box:shop", "work")] }));
  expect([x.count, x.space, x.pushes]).toEqual([1, 1, 0]);
  // with suggested replies off there are no bubbles: the question alone
  expect(surfaces(withAsk(asked("Merge it as it is, or fix it first?", []))).count).toBe(1);
});

test("noise stays out: bubbles alone, one bubble, choices while work runs", () => {
  const running = { tasks: [task("SHOP-1", "p:box:shop", "work")] };
  // a status reply ends with next steps as bubbles while a task works: not an ask
  expect(surfaces(withAsk(asked("Checkout is at 60%, about 20 minutes left.", ["status?", "Show the diff"]), running)).count).toBe(0);
  // one bubble on a closing question ("Anything else?" with "status?")
  expect(surfaces(withAsk(asked("All merged. Anything else?", ["status?"]))).count).toBe(0);
  // a plain update with one bubble, nothing running
  expect(surfaces(withAsk(asked("All merged and installed.", ["status?"]))).count).toBe(0);
  // queued work starts by itself: the space hasn't stopped
  expect(surfaces(withAsk(asked(STALLED, ["a", "b"]), { tasks: [task("SHOP-2", "p:box:shop", "queued")] })).count).toBe(0);
});

test("only while Shepherdr's turn has ended and its words are the chat's newest", () => {
  const ask = asked(STALLED, ["a", "b", "c"]);
  const p = (x: any) => ({ ...place("p:box:shop"), asks: ask, ...x });
  expect(asksYou(p({}) as any, [], { "p:box:shop": 7 })).toBe(ask);
  // at work again (the person answered), at a prompt (its card says it), stopped (that is its own Needs you)
  for (const x of [{ status: "work" }, { status: "need" }, { shepherdr: "stopped" }, { shepherdr: "none" }, { archived: true }])
    expect(asksYou(p(x) as any, [], { "p:box:shop": 7 })).toBeNull();
  // words of an older turn say nothing of now
  expect(asksYou(p({}) as any, [], { "p:box:shop": 8 })).toBeNull();
});

test("a question card of its own is the one action: the plain words add none", () => {
  const card = { id: "q9", chat: "p:box:shop", place: "p:box:shop", at: NOW - min, question: { id: "q9", title: "Which look?", kind: "Question", choices: [{ label: "A" }, { label: "B" }], to: "" } };
  const x = surfaces(withAsk(asked(STALLED, ["a", "b", "c"]), { needs: [card] }));
  expect(attentionOf(x.snap).actions.map((a) => a.id)).toEqual(["need:p:box:shop:q9"]);
  // its Shepherdr stopped: the one Waits for you it always had
  const y = surfaces(withAsk(asked(STALLED, ["a", "b", "c"]), { places: [place("p:box:root", { home: true }), place("p:box:shop", { needs: true, asks: asked(STALLED, ["a", "b"]) })] }));
  expect(attentionOf(y.snap).actions.map((a) => [a.id, a.what, a.plain])).toEqual([["chat:p:box:shop", "Waits for you", undefined]]);
});

test("the idle mark: nothing running and work to start, said quietly", () => {
  const p = place("p:box:shop") as any;
  expect(spaceIdle(p, [task("A", "p:box:shop", "todo"), task("B", "p:box:shop", "todo"), task("C", "p:box:shop", "done")] as any)).toEqual({ todo: 2 });
  expect(idleWords(2)).toBe("Idle · 2 up next");
  // something runs there (its own, or one of another space's working in it), or Shepherdr is at work: not idle
  expect(spaceIdle(p, [task("A", "p:box:shop", "todo"), task("B", "p:box:shop", "work")] as any)).toBeNull();
  expect(spaceIdle(p, [task("A", "p:box:shop", "todo"), task("B", "p:box:root", "merging", { also: ["p:box:shop"] })] as any)).toBeNull();
  expect(spaceIdle({ ...p, status: "work" }, [task("A", "p:box:shop", "todo")] as any)).toBeNull();
  // nothing to start, or only archived ones: nothing to say
  expect(spaceIdle(p, [task("A", "p:box:shop", "done"), task("B", "p:box:shop", "todo", { archived: true })] as any)).toBeNull();
  // never a count of yours
  expect(surfaces(snapOf({ tasks: [task("A", "p:box:shop", "todo")] })).count).toBe(0);
});

test("the service reads each idle chat once a turn and keeps its words with that turn", async () => {
  let said: any = words(STALLED, ["a", "b", "c"]);
  const watched: string[] = [], unwatched: string[] = [];
  let changed = 0;
  const chats = { watch: (a: string, w: () => void) => { watched.push(a); w(); }, unwatch: (a: string) => { unwatched.push(a); } };
  const asks = new PlainAsks(() => chats as any, (k) => `addr-${k}`, () => said, () => changed++, 5);
  const snap = () => withAsk(undefined) as any;
  const a = snap();
  asks.stamp(a);
  // read at once (the fake answers at once): Everything's chat and the shop's
  expect(watched).toEqual(["addr-p:box:root", "addr-p:box:shop"]);
  expect(changed).toBe(2);
  const b = snap();
  asks.stamp(b);
  expect(b.places[1].asks).toMatchObject({ question: false, choices: 3, turn: 7 });
  expect(watched.length).toBe(2); // the same turn: not read again
  // the chat moved on (the person answered, Shepherdr replied): read again, never the old words
  said = { who: "you", text: "Yes, fix the total now" };
  const c = snap();
  c.last["p:box:shop"] = 8;
  asks.stamp(c);
  expect(c.places[1].asks).toBeUndefined();
  expect(watched.length).toBe(3);
  // at work: nothing kept on it, nothing read
  const d = snap();
  d.places[1].status = "work";
  asks.stamp(d);
  expect(d.places[1].asks).toBeUndefined();
  expect(watched.length).toBe(3);
  await Bun.sleep(20);
  expect(unwatched.length).toBe(3); // each read lets its chat go
});
