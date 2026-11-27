// Agent messages: fold, no tags (dmalis/shepherdr#55). A message another agent sent with hc is one quiet "Message from …"
// row: when the agent wrote its own <hc from="…"> around its words (hc send adds one more), the row's words have no
// tags and it names the most specific sender; and while it waits in Claude Code's queue (the first, unsettled view)
// it keeps its sender, so it is never the person's own bubble.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records } from "./chat-log.js";
import { fromName, senderName } from "./chat-view.js";

async function conv(lines) {
  const dir = mkdtempSync(join(tmpdir(), "relayed-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}
const at = "2026-11-27T20:48:00.000Z";
const user = (id, content) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: id, timestamp: at });
const q = (operation, content) => ({ type: "queue-operation", operation, timestamp: at, sessionId: "s", ...(content !== undefined ? { content } : {}) });
const users = (c) => c.items.filter((x) => x.kind === "user").map(({ text, from, by }) => ({ text, from, ...(by ? { by } : {}) }));

const TWICE = '<hc from="t1pb shop-4-fix-login"><hc from="SHOP-4 worker">Your hand-in case is ready to try.</hc></hc>';

test("a message wrapped twice is unwrapped: no tags in its words, its sender's address and its own name kept", async () => {
  expect(users(await conv([user("u1", TWICE)]))).toEqual([{ text: "Your hand-in case is ready to try.", from: "t1pb shop-4-fix-login", by: "SHOP-4 worker" }]);
  // an inner terminal address is the more specific sender; three deep is unwrapped too
  expect(users(await conv([user("u1", '<hc from="t2 assistant-shop"><hc from="t9 shop-4-fix-login">\n<hc from="t9">Done.</hc>\n</hc></hc>')])))
    .toEqual([{ text: "Done.", from: "t9" }]);
  // a bare inner address is on the outer sender's machine, never a terminal of the same name here
  expect(users(await conv([user("u1", '<hc from="m3/t9 shop-4-fix-login"><hc from="t9">Ready.</hc></hc>')]))).toEqual([{ text: "Ready.", from: "m3/t9" }]);
  // a closing tag quoted in code inside it doesn't keep the wrapper
  expect(users(await conv([user("u1", '<hc from="t1 a"><hc from="SHOP-4 worker">The parser rejects a stray `</hc>` tag.</hc></hc>')])))
    .toEqual([{ text: "The parser rejects a stray `</hc>` tag.", from: "t1 a", by: "SHOP-4 worker" }]);
  // in any kind of code: a double-backtick span, a tilde fence, a fence left open three deep
  for (const words of ["Use `` `</hc>` `` to close it.", "Like this:\n~~~\n</hc>\n~~~", "Like this:\n```\n<hc from=\"x\">\n```", "```js\nconst end = 1"]) {
    expect(users(await conv([user("u1", `<hc from="t1 a"><hc from="SHOP-4 worker">${words}</hc></hc>`)]))).toEqual([{ text: words, from: "t1 a", by: "SHOP-4 worker" }]);
  }
  expect(users(await conv([user("u1", '<hc from="t1 a"><hc from="t2 b">\n<hc from="t3">```partial</hc>\n</hc></hc>')]))).toEqual([{ text: "```partial", from: "t3" }]);
  // a sender outside any terminal on another machine: a bare inner address is on that machine too
  expect(users(await conv([user("u1", '<hc from="m3/ppid:123"><hc from="t9">Ready.</hc></hc>')]))).toEqual([{ text: "Ready.", from: "m3/t9" }]);
  // a slash command's markers quoted in it don't make it the person's command
  expect(users(await conv([user("u1", '<hc from="t1 a"><hc from="SHOP-4 worker">It sees `<command-name>/help</command-name>`.</hc></hc>')])))
    .toEqual([{ text: "It sees `<command-name>/help</command-name>`.", from: "t1 a", by: "SHOP-4 worker" }]);
  // the pasted way the CLI may log it
  expect(users(await conv([user("u1", `<pasted_content id="1">\n${TWICE}\n</pasted_content>`)]))[0].text).toBe("Your hand-in case is ready to try.");
});

test("only a whole, paired wrapper goes: tags quoted in the words, side by side or never naming a sender, stay", async () => {
  const side = '<hc from="t1 a"><hc from="x">one</hc> and <hc from="y">two</hc></hc>';
  expect(users(await conv([user("u1", side)]))).toEqual([{ text: '<hc from="x">one</hc> and <hc from="y">two</hc>', from: "t1 a" }]);
  const mid = '<hc from="t1 a">Use <hc from="x">this</hc> to wrap.</hc>';
  expect(users(await conv([user("u1", mid)]))[0].text).toBe('Use <hc from="x">this</hc> to wrap.');
  // a reaction line, a self-closing tag, is no wrapper; an inner from="person" never makes it the person's
  expect(users(await conv([user("u1", '<hc from="t1 a"><hc from="person">hi</hc></hc>')]))).toEqual([{ text: "hi", from: "t1 a" }]);
});

test("the first, unsettled view: a relayed message in Claude Code's queue keeps its sender, its words unwrapped", async () => {
  const c = await conv([q("enqueue", TWICE)]);
  expect(c.queued()).toEqual([{ id: expect.any(String), raw: TWICE, at: Date.parse(at), text: "Your hand-in case is ready to try.", images: 0,
    from: "t1pb shop-4-fix-login", by: "SHOP-4 worker" }]);
  // the person's own words in the queue are theirs, as before
  expect((await conv([q("enqueue", "what now?")])).queued()).toEqual([{ id: expect.any(String), raw: "what now?", at: Date.parse(at), text: "what now?", images: 0 }]);
  // taken from the queue when the log has it: one message, the same row
  const taken = await conv([q("enqueue", TWICE), user("u1", TWICE)]);
  expect(taken.queued()).toEqual([]);
  expect(users(taken)).toHaveLength(1);
});

test("the row names the task by its title, else the name the agent wrapped its words with", () => {
  const x = { from: "t1pb shop-4-fix-login", by: "SHOP-4 worker", text: "Ready." };
  const known = (f, t) => senderName(f, t, { find: () => ({ name: "shop-4-fix-login", labels: {} }), taskOf: () => "Fix login" });
  expect(fromName(x, known)).toBe("Fix login");
  // its terminal gone: "SHOP-4 worker", not a bare "Task"
  expect(fromName(x, (f, t) => senderName(f, t))).toBe("SHOP-4 worker");
  expect(fromName({ ...x, from: "m3/t1pb" }, (f, t) => senderName(f, t, { here: "vm" }))).toBe("SHOP-4 worker on m3");
  // without one, as before
  expect(fromName({ from: "t1pb", text: "Ready." }, (f, t) => senderName(f, t))).toBe("Another agent");
});
