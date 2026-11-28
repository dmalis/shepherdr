// Shepherdr's asks in Needs you (dmalis/shepherdr): a space's Shepherdr that ends its turn waiting on the person in
// plain words is one of the person's actions, on every surface but push; one that only chats is not. The idle mark
// says quietly that a space stopped with work to start. Made-up data.
import { expect, test } from "bun:test";
import { attend } from "./attention.ts";
import { alertsOf } from "./push.ts";
import { glanceOf } from "./glance.ts";
import { PlainAsks, wordsOf } from "./plain-ask.ts";
import { attentionOf } from "../web/shared/attention.ts";
import { waiting } from "../web/shared/alerts.ts";
import { needsChats, needsItems } from "../web/shared/needs-open.ts";
import { asksYou, idleSaid, idleWords, plainAskOf, spaceIdle } from "../web/shared/plain-ask.ts";
import { needsCount } from "../web/shared/view.ts";

const NOW = 1_800_000_000_000;
const min = 60_000;
const place = (id: string, x: any = {}) => ({ id, name: id.split(":").pop(), machine: "box", level: 0, status: "idle", mode: "regular", chat: id, shepherdr: "running", ...x });
const task = (id: string, pl: string, status: string, x: any = {}) => ({ id, name: `Task ${id}`, place: pl, status, state: status, created: "", age: "", at: NOW - 30 * min, ...x });
const snapOf = (x: any = {}) => ({ name: "", host: "box", user: "", demo: false, everything: "p:box:root", machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true }],
  places: [place("p:box:root", { home: true }), place("p:box:shop")], tasks: [], needs: [], automations: {}, artifacts: [], asks: {}, settings: [], last: { "p:box:root": 4, "p:box:shop": 7 }, read: {}, ...x });

// the shape of the message that went unseen: no question mark, the next step handed over, a proposal, three bubbles
const STALLED = "No, nothing's stuck. Every task I started is finished and merged, and the next step on the sticker book is your call: how the page should look.\n\n" +
  "A few things wait on their own:\n- **The last findings** post tomorrow.\n- **The new release** comes in with the next sync.\n\n" +
  "To keep things moving meanwhile, I'd start on the one that hurts every task now: **the checkout total is wrong**.\n\n" +
  '<hc suggest="Yes, fix the total now"/>\n<hc suggest="Show me the page first"/>\n<hc suggest="Leave it for today"/>';
const words = (text: string) => ({ who: "agent" as const, text });
const asked = (text: string, turn = 7) => plainAskOf(words(text), turn);
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

test("its words wait on you: a closing question, or the next step handed over in so many words; tags never words", () => {
  expect(asked(STALLED)).toEqual({ what: "Every task I started is finished and merged, and the next step on the sticker book is your call: how the page should lo…", turn: 7 });
  expect(asked("Merged both.\n\nShould I start the **migration** now, or wait for the review?\n\n<hc suggest=\"Start it now\"/>"))
    .toEqual({ what: "Should I start the migration now, or wait for the review?", turn: 7 });
  // a list of options closing the message: the line that leads into it asks
  expect(asked("Two ways to go. Which one?\n\n1. A plain list\n2. Cards")?.what).toBe("Which one?");
  for (const s of ["It's up to you which goes first.", "Ready when you give the go-ahead: your go-ahead starts the migration."])
    expect(asked(s)).not.toBeNull();
  // a question earlier on, then a closing statement: it waits on nothing now
  expect(asked("Want the diff?\n\nAll three are merged. Nothing waits on you.")).toBeNull();
  // the person wrote last, or nothing with words
  expect(plainAskOf({ who: "you", text: "Yes, do it" }, 7)).toBeNull();
  expect(asked('<hc suggest="status?"/>')).toBeNull();
  expect(asked("x".repeat(300) + "?", 1)!.what.length).toBe(120);
});

test("the message that went unseen: one action of yours in Needs you, counted everywhere, never pushed", () => {
  const x = surfaces(withAsk(asked(STALLED), { tasks: [task("SHOP-1", "p:box:shop", "done")] }));
  expect([x.count, x.space, x.items, x.rows, x.badge, x.glance]).toEqual([1, 1, 1, 1, 1, 1]);
  // read off words, and the message already went to the bell: it buzzes nothing
  expect(x.pushes).toBe(0);
  const [a] = attentionOf(x.snap).actions;
  expect(a).toMatchObject({ id: "chat:p:box:shop", owner: "you", kind: "chat", plain: true, place: "p:box:shop", chat: "p:box:shop" });
  // its row: the space asks you, its words under it
  expect(needsChats(x.snap, [""])[0]).toMatchObject({ place: "p:box:shop", card: null, sub: a!.what });
});

test("a direct question waits on you whatever its bubbles, and while tasks run", () => {
  // one bubble (or none, with suggested replies off): the question is what counts
  expect(surfaces(withAsk(asked('Which delivery date should I use?\n\n<hc suggest="The 14th"/>'))).count).toBe(1);
  expect(surfaces(withAsk(asked("Merge it as it is, or fix it first?"))).count).toBe(1);
  const x = surfaces(withAsk(asked("The review found one thing. Merge it as it is, or fix it first?"), { tasks: [task("SHOP-1", "p:box:shop", "work")] }));
  expect([x.count, x.space, x.pushes]).toEqual([1, 1, 0]);
});

test("noise stays out: an update with bubbles, a throwaway closing question, a hand-over said in the negative", () => {
  // an ordinary reply in an idle space, ending with next steps as bubbles
  expect(asked('Everything is merged and installed.\n\n<hc suggest="Show the diff"/>\n<hc suggest="status?"/>')).toBeNull();
  // a status reply while a task works
  expect(asked("Checkout is at 60%, about 20 minutes left.")).toBeNull();
  for (const s of ["All merged. Anything else?", "Done. What's next?", "Shipped. Any questions?", "All merged. Nothing waits on you."])
    expect(asked(s)).toBeNull();
});

test("only while Shepherdr's turn has ended and its words are the chat's newest", () => {
  const ask = asked(STALLED)!;
  const p = (x: any) => ({ ...place("p:box:shop"), asks: ask, ...x });
  expect(asksYou(p({}) as any, { "p:box:shop": 7 })).toBe(ask);
  // at work again (the person answered), at a prompt (its card says it), stopped (that is its own Needs you)
  for (const x of [{ status: "work" }, { status: "need" }, { shepherdr: "stopped" }, { shepherdr: "none" }, { archived: true }])
    expect(asksYou(p(x) as any, { "p:box:shop": 7 })).toBeNull();
  // words of an older turn say nothing of now
  expect(asksYou(p({}) as any, { "p:box:shop": 8 })).toBeNull();
});

test("a question card of its own is the one action: the plain words add none", () => {
  const card = { id: "q9", chat: "p:box:shop", place: "p:box:shop", at: NOW - min, question: { id: "q9", title: "Which look?", kind: "Question", choices: [{ label: "A" }, { label: "B" }], to: "" } };
  const x = surfaces(withAsk(asked(STALLED), { needs: [card] }));
  expect(attentionOf(x.snap).actions.map((a) => a.id)).toEqual(["need:p:box:shop:q9"]);
  // its Shepherdr stopped: the one Waits for you it always had
  const y = surfaces(snapOf({ places: [place("p:box:root", { home: true }), place("p:box:shop", { needs: true, asks: asked(STALLED) })] }));
  expect(attentionOf(y.snap).actions.map((a) => [a.id, a.what, a.plain])).toEqual([["chat:p:box:shop", "Waits for you", undefined]]);
});

test("the idle mark: nothing running and work to start, its count on the row, never a count of yours", () => {
  const p = place("p:box:shop") as any;
  expect(spaceIdle(p, [task("A", "p:box:shop", "todo"), task("B", "p:box:shop", "todo"), task("C", "p:box:shop", "done")] as any)).toEqual({ todo: 2 });
  expect([idleWords(2), idleSaid(2), idleSaid(1)]).toEqual(["Idle · 2", "idle, 2 tasks up next", "idle, 1 task up next"]);
  // something runs there (its own, or one of another space's working in it), or Shepherdr is at work: not idle
  expect(spaceIdle(p, [task("A", "p:box:shop", "todo"), task("B", "p:box:shop", "work")] as any)).toBeNull();
  expect(spaceIdle(p, [task("A", "p:box:shop", "todo"), task("B", "p:box:root", "merging", { also: ["p:box:shop"] })] as any)).toBeNull();
  expect(spaceIdle({ ...p, status: "work" }, [task("A", "p:box:shop", "todo")] as any)).toBeNull();
  // nothing to start, or only archived ones: nothing to say
  expect(spaceIdle(p, [task("A", "p:box:shop", "done"), task("B", "p:box:shop", "todo", { archived: true })] as any)).toBeNull();
  expect(surfaces(snapOf({ tasks: [task("A", "p:box:shop", "todo")] })).count).toBe(0);
});

// the service: a fake log per chat (what the chat lists), read only through the reader, never a stream or a screen
function service(times = { again: [] as number[], recheck: 1_000 }) {
  const logs: Record<string, any[]> = {}, reads: string[] = [], made: string[] = [];
  let clock = NOW, changed = 0;
  const said = (addr: string, kind: "agent" | "user", text: string) => (logs[addr] ??= []).push({ kind, text });
  const asks = new PlainAsks((k) => `addr-${k}`, async (a) => ({ address: a, state: "live" }), (addr) => {
    made.push(addr);
    const r = { conv: null as any, locate: async () => false, pull: async () => { reads.push(addr); r.conv = { items: [...(logs[addr] ?? [])] }; return true; } };
    return r as any;
  }, () => changed++, times, () => clock);
  const snap = (shop: any = {}, last = 7) => ({ places: [place("p:box:root", { home: true }), place("p:box:shop", shop)], last: { "p:box:root": 4, "p:box:shop": last } }) as any;
  return { asks, said, snap, reads, made, changed: () => changed, tick: (ms: number) => (clock += ms) };
}
const settle = () => Bun.sleep(5);

test("the service reads a chat's log when its turn ends, keeps the ask while it stays done, and reads nothing else", async () => {
  const s = service();
  s.said("addr-p:box:shop", "agent", STALLED);
  s.asks.stamp(s.snap());
  await settle();
  expect(s.reads.sort()).toEqual(["addr-p:box:root", "addr-p:box:shop"]);
  expect(s.changed()).toBe(1);
  const b = s.snap();
  s.asks.stamp(b);
  expect(b.places[1].asks).toMatchObject({ turn: 7 });
  expect(s.reads.length).toBe(2); // the same done turn: not read again
  // one reader per chat, kept: each read takes only what its log gained
  expect(s.made.sort()).toEqual(["addr-p:box:root", "addr-p:box:shop"]);
});

test("an answered ask never stays: back from work with the same turn count, its log is read again", async () => {
  const s = service();
  s.said("addr-p:box:shop", "agent", STALLED);
  s.asks.stamp(s.snap());
  await settle();
  // the person answers: Shepherdr works (the ask goes at once), then is done again with the turn count unmoved
  s.said("addr-p:box:shop", "user", "Yes, fix the total now");
  const w = s.snap({ status: "work" });
  s.asks.stamp(w);
  expect(w.places[1].asks).toBeUndefined();
  const d = s.snap();
  s.asks.stamp(d);
  expect(d.places[1].asks).toBeUndefined(); // nothing kept from before: read again
  await settle();
  const e = s.snap();
  s.asks.stamp(e);
  expect(e.places[1].asks).toBeUndefined(); // the person's words are the newest: no ask
});

test("a reply missed between snapshots, a log that lands late: read again, the newest words win", async () => {
  const s = service({ again: [10], recheck: 1_000 });
  // its turn ended, but its words reach the log a moment later
  s.said("addr-p:box:shop", "user", "What do you think?");
  s.asks.stamp(s.snap());
  await settle();
  s.said("addr-p:box:shop", "agent", "Which delivery date should I use?");
  await Bun.sleep(30);
  const a = s.snap();
  s.asks.stamp(a);
  expect(a.places[1].asks?.what).toBe("Which delivery date should I use?");
  // the person answered and Shepherdr replied in plain words between two snapshots (no work, no new turn seen):
  // while the ask shows, its log is read again now and then
  s.said("addr-p:box:shop", "user", "The 14th");
  s.said("addr-p:box:shop", "agent", "Set to the 14th.");
  s.tick(1_000);
  s.asks.stamp(s.snap());
  await settle();
  const b = s.snap();
  s.asks.stamp(b);
  expect(b.places[1].asks).toBeUndefined();
});

test("a read still on its way when Shepherdr starts work again is dropped", async () => {
  const s = service();
  s.said("addr-p:box:shop", "agent", STALLED);
  s.asks.stamp(s.snap());
  s.asks.stamp(s.snap({ status: "work" })); // before the read lands
  await settle();
  const a = s.snap({ status: "work" });
  s.asks.stamp(a);
  expect(a.places[1].asks).toBeUndefined();
  expect(s.changed()).toBe(0);
});

test("wordsOf: the chat's newest words to or from the person, never messages between agents", () => {
  expect(wordsOf([{ kind: "agent", text: "Hi" }, { kind: "user", text: "from another agent", from: "t9" }])).toEqual({ who: "agent", text: "Hi" });
  expect(wordsOf([{ kind: "agent", text: "Hi" }, { kind: "user", text: "Yes" }])).toEqual({ who: "you", text: "Yes" });
  expect(wordsOf(null)).toBeNull();
});
