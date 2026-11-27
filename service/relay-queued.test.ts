// Agent messages: fold, no tags (dmalis/shepherdr#55): a message another agent sent while the receiver works waits in
// Claude Code's queue; the chat shows it at once as its quiet "Message from …" row (Message.relay), never as the person's
// own "Sent" bubble, and the same row once the log has it, its words without the <hc from=…> the agent wrapped them in.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import * as CL from "../core/chat-log.js";
const { LOG, Conversation, records } = CL as any;

const at = "2026-11-27T20:48:00.000Z";
const user = (id: string, content: string) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: id, timestamp: at });
const q = (operation: string, content?: string) => ({ type: "queue-operation", operation, timestamp: at, sessionId: "s", ...(content !== undefined ? { content } : {}) });

async function conv(lines: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), "relay-queued-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const out = await new Response(Bun.spawn(["sh", "-c", LOG, "log", "tail", f, "0"], { stdout: "pipe", stderr: "ignore" }).stdout).text();
  rmSync(dir, { recursive: true });
  const c = new Conversation("claude");
  c.feed(records(out).records);
  return c;
}

function compat() {
  const c = new Compat() as any;
  c.rows = [{ ref: "SHOP-4", title: "Fix login", key: "shop#4", slug: "shop", id: 4, machine: null, section: "working", worker: "t9", folder: "/work/shop", space: "local/shop" }];
  const terms: Record<string, any> = { t2: { name: "assistant-shop", labels: { "herdr.role": "coordinator" } }, t9: { name: "shop-4-fix-login", labels: { "herdr.task": "shop#4" } } };
  c.terminalsOf = (a: string) => terms[a] ?? null;
  c.chats.set("p:local:shop", "t2");
  return c;
}
const busy = { state: "live", labels: { "herdr.role": "coordinator" }, status: { state: "working" } };
const shown = (chat: any) => chat.messages.filter((m: any) => m.who === "you")
  .map((m: any) => ({ text: m.text, ...(m.relay ? { relay: m.relay.name, label: m.brief?.label } : {}), ...(m.waitsFor ? { waitsFor: m.waitsFor } : {}) }));

const TWICE = '<hc from="t9 shop-4-fix-login"><hc from="SHOP-4 worker">Your hand-in case is ready to try.</hc></hc>';
const row = { text: "Your hand-in case is ready to try.", relay: "Fix login", label: "Message from Fix login" };

test("a relayed message waiting in the queue is its row at once, the same row the log gives it", async () => {
  const read = (lines: unknown[]) => compat().chat("p:local:shop", { conv: lines, start: 0, machine: null, addr: "t2", kind: "claude" }, busy);
  const first = read(await conv([user("u0", "Check on the login task"), q("enqueue", TWICE)]) as any);
  expect(shown(first)).toEqual([{ text: "Check on the login task" }, row]);
  const settled = read(await conv([user("u0", "Check on the login task"), q("enqueue", TWICE), q("dequeue"), user("u1", TWICE)]) as any);
  expect(shown(settled)).toEqual([{ text: "Check on the login task" }, row]);
  // the person's own words in the queue still wait as theirs
  const mine = read(await conv([user("u0", "Check on the login task"), q("enqueue", "and the search one?")]) as any);
  expect(shown(mine)).toEqual([{ text: "Check on the login task" }, { text: "and the search one?", waitsFor: "queue" }]);
});
