// dmalis/shepherdr#42: suggested replies an agent wrote as plain words, read from real log lines (Claude Code's blocks,
// Codex's messages) through core/chat-log.js: never shown as words, read over the whole reply.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records } from "./chat-log.js";
import { plainSuggests } from "./plain-suggests.js";

// a log as LOG reads it, fed to a Conversation (as core/chat-log.test.js does)
async function read(lines, kind = "claude") {
  const dir = mkdtempSync(join(tmpdir(), "plain-suggests-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation(kind);
  c.feed(records(out).records);
  return c;
}

// lines as Claude Code 2.1.314 writes them
const at = "2026-11-04T15:50:49.652Z";
let n = 0;
const reply = (id, content, more = {}) => ({ parentUuid: null, isSidechain: false,
  message: { model: "claude-opus-5-5", id, type: "message", role: "assistant", content, stop_reason: "tool_use" },
  ...more, type: "assistant", uuid: `u${n++}`, timestamp: at });
const text = (words) => ({ type: "text", text: words });
const person = { parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: "Which one?" }, uuid: "p1", timestamp: at };

// dmalis/shepherdr#42: a "Suggested replies:" list an agent wrote as words (its compacted conversation lost the
// <hc suggest> form) is never shown: its items are the reply's suggestions; a list earlier in a reply stays words
test("a plain Suggested replies list last in a reply becomes its suggestions, never its words", async () => {
  const c = await read([person,
    reply("m1", [text('Done: the tests pass.\n\nSuggested replies:\n- "Merge it"\n- "Show me the diff"')]),
    reply("m2", [text('Suggested replies:\n- one\n\nThen I carried on.')]),
  ]);
  const agents = c.items.filter((x) => x.kind === "agent");
  expect(agents.map((x) => x.text)).toEqual(["Done: the tests pass.", "Suggested replies:\n- one\n\nThen I carried on."]);
  expect(agents.map((x) => x.suggests)).toEqual([["Merge it", "Show me the diff"], undefined]);
});

// the same reply in two blocks (one message id): a question, then its list or its suggest lines on their own; and a
// list that a later block shows wasn't last after all
test("suggestions in a block of their own are the question's buttons; a list followed by more words stays words", async () => {
  for (const tail of ['Suggested replies:\n- Red\n- Blue', '<hc suggest="Red"/>\n<hc suggest="Blue"/>']) {
    const c = await read([person, reply("m1", [text("Which colour?")]), reply("m1", [text(tail)])]);
    const agents = c.items.filter((x) => x.kind === "agent");
    expect(agents.map((x) => [x.text, x.suggests])).toEqual([["Which colour?", ["Red", "Blue"]]]);
  }
  const c = await read([person, reply("m1", [text("Plan:\nSuggested replies:\n- a\n- b")]), reply("m1", [text("Then I carry on.")])]);
  const agents = c.items.filter((x) => x.kind === "agent");
  expect(agents.map((x) => [x.text, x.suggests])).toEqual([["Plan:\nSuggested replies:\n- a\n- b\n\nThen I carry on.", undefined]]);
});

// review round 2: read over the whole reply, never block by block (a list block between words stays; a fence an
// earlier block opened holds it), in Claude's blocks and in Codex's messages
test("a plain list is read over the whole reply: a block between words stays, a fence opened earlier holds it", async () => {
  const mid = await read([person, reply("m1", [text("Which colour?")]), reply("m1", [text("Suggested replies:\n- Red\n- Blue")]), reply("m1", [text("Or tell me another.")])]);
  expect(mid.items.filter((x) => x.kind === "agent").map((x) => [x.text, x.suggests]))
    .toEqual([["Which colour?\n\nSuggested replies:\n- Red\n- Blue\n\nOr tell me another.", undefined]]);
  for (const open of ["```", "~~~"]) {
    const c = await read([person, reply("m1", [text(`The template:\n${open}md`)]), reply("m1", [text("Suggested replies:\n- Red")])]);
    expect(c.items.filter((x) => x.kind === "agent").map((x) => [x.text, x.suggests]))
      .toEqual([[`The template:\n${open}md\n\nSuggested replies:\n- Red`, undefined]]);
  }
});

test("plain-suggests: ~~~ fences hold a list too, and a closed one before it doesn't", () => {
  expect(plainSuggests("~~~\nSuggested replies:\n- a\n~~~")).toBeNull();
  expect(plainSuggests("Here:\n~~~\nSuggested replies:\n- a")).toBeNull();
  expect(plainSuggests("~~~\ncode\n~~~\nPick one.\nSuggested replies:\n- a")).toEqual({ text: "~~~\ncode\n~~~\nPick one.", suggests: ["a"] });
  // a ``` inside a ~~~ block doesn't close it
  expect(plainSuggests("~~~\n```\nSuggested replies:\n- a")).toBeNull();
});

test("Codex: a message of suggestions only, after its question, is that question's buttons", async () => {
  const msg = (t) => ({ timestamp: "2026-11-27T09:42:42Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: t }] } });
  for (const tail of ['<hc suggest="Red"/>\n<hc suggest="Blue"/>', "Suggested replies:\n- Red\n- Blue"]) {
    const c = await read([msg("Which colour?"), msg(tail)], "codex");
    expect(c.items.filter((x) => x.kind === "agent").map((x) => [x.text, x.suggests])).toEqual([["Which colour?", ["Red", "Blue"]]]);
  }
});
