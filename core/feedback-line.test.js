// Friction loop, slice 4 (#94): the Feedback page's Post it reaches the Assistant as the person's message plus a hidden
// line <hc feedback id="…" rev="N"/>; the chat never shows that line. Made-up ids only.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LOG, Conversation, records } from "./chat-log.js";
import { feedbackLine, messageBody } from "./send.js";

async function read(lines) {
  const dir = mkdtempSync(join(tmpdir(), "feedback-line-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const p = Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" });
  const out = await new Response(p.stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}
const at = "2026-11-04T15:50:49.652Z";
const said = (uuid, content) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid, timestamp: at });

test("a Post it carries its hidden line after the reply and task tags, and only a real id and revision", () => {
  const words = "Post the feedback about “Reply bubble hides its message”";
  expect(messageBody({ text: words, feedback: { id: "k3x9a2", rev: 2 } })).toBe(`<hc feedback id="k3x9a2" rev="2"/>\n${words}`);
  expect(messageBody({ text: words, quote: "earlier", feedback: { id: "k3x9a2", rev: 1 } }))
    .toBe(`<hc reply-to="earlier"/>\n<hc feedback id="k3x9a2" rev="1"/>\n${words}`);
  for (const bad of [null, { id: "k3", rev: 0 }, { id: "k3", rev: 1e21 }, { id: 'k3" x="y', rev: 1 }, { id: "k3", rev: "1.5" }, { id: "", rev: 1 }])
    expect(feedbackLine(bad)).toBe("");
  expect(messageBody({ text: "hello" })).toBe("hello");
});

test("the hidden line never shows in the chat; the person's words do", async () => {
  const body = messageBody({ text: "Post the feedback about “Reply bubble hides its message”", feedback: { id: "k3x9a2", rev: 2 } });
  const quoted = messageBody({ text: "Also this", quote: "Earlier words", feedback: { id: "k3x9a2", rev: 3 } });
  const c = await read([said("p1", body), said("p2", quoted), said("p3", "Look at `<hc feedback id=\"x\" rev=\"1\"/>` in the docs")]);
  const you = c.items.filter((x) => x.kind === "user");
  expect(you.map((x) => x.text)).toEqual(["Post the feedback about “Reply bubble hides its message”", "Also this",
    "Look at `<hc feedback id=\"x\" rev=\"1\"/>` in the docs"]);
  expect(JSON.stringify(c.items)).not.toContain('id="k3x9a2"');
});
