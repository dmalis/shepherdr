// #56: a picture the person sent shows under their message, and opens. Claude Code names an image's file
// ("[Image: source: …]") only for a message it took between turns; one typed while it worked (its queued_command) or
// pasted in its terminal is only in the log, as an image block: the chat shows that one from the log.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import { LOG_IMAGE, imagesIn, logImage, readLogImage, sentPictures } from "./sent-images.ts";
import * as CL from "../core/chat-log.js";
const { LOG, Conversation, records } = CL as any;

// a real 1x1 PNG
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const at = (s: number) => new Date(Date.UTC(2026, 10, 27, 9, 0, s)).toISOString();
const image = { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } };
const user = (id: string, content: unknown, s: number) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content }, uuid: id, timestamp: at(s), origin: { kind: "human" } });
const meta = (id: string, text: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: [{ type: "text", text }] }, isMeta: true, uuid: id, timestamp: at(s) });
const reply = (id: string, text: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "assistant", uuid: id, timestamp: at(s),
  message: { model: "claude-opus-5-5", id: `m${id}`, type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn" } });
// as Claude Code 2.1.332 logs a message typed while it works, taken mid-turn: its words and picture, no source line
const takenMidTurn = (id: string, text: string, s: number) => ({ parentUuid: null, isSidechain: false, type: "attachment", uuid: id, timestamp: at(s),
  attachment: { type: "queued_command", prompt: [{ type: "text", text: `[Image #3]${text}` }, image], imagePasteIds: [3], commandMode: "prompt", origin: { kind: "human" }, timestamp: at(s) } });

const sh = async (script: string, args: string[]) => {
  const p = Bun.spawn(["sh", "-c", script, ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(p.stdout).text();
  return { code: await p.exited, stdout };
};

/** the chat as the service builds it from a log, with the reader that follows it */
async function chatOf(lines: unknown[], c = new Compat() as any, state = "idle") {
  const dir = mkdtempSync(join(tmpdir(), "sent-images-"));
  const f = join(dir, "log.jsonl");
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const conv = new Conversation("claude");
  conv.feed(records((await sh(LOG, ["log", "tail", f, "0"])).stdout).records);
  const reader = { conv, start: 0, machine: null, addr: "t2", kind: "claude", path: f, run: sh };
  c.chats.set("p:local:shop", "t2");
  const chat = c.chat("p:local:shop", reader, { state: "live", labels: { "herdr.role": "coordinator" }, status: { state } });
  return { chat, reader, c, done: () => rmSync(dir, { recursive: true }) };
}
const mine = (chat: any) => chat.messages.filter((m: any) => m.who === "you").map((m: any) => m.file ? { file: m.file.path } : m.images ? { images: m.images } : { text: m.text });

test("a picture typed while the agent worked shows from the log, and opens as the very picture", async () => {
  const { chat, reader, c, done } = await chatOf([
    user("u1", "Fix the header", 0), reply("a1", "On it.", 1),
    takenMidTurn("q1", "in chat, let me open the image", 2),
    reply("a2", "Got it.", 3),
  ]);
  const shown = mine(chat);
  // its words, then the picture: never the "1 image" line
  expect(shown.map((m: any) => m.text ?? "")).toContain("in chat, let me open the image");
  expect(shown.some((m: any) => m.images)).toBe(false);
  const pic = chat.messages.find((m: any) => m.file && LOG_IMAGE.test(m.file.path));
  expect(pic.file.name).toBe("Image.png");
  // only a file the chat names is served, and it is the bytes the agent got
  expect(c.fileOf("p:local:shop", pic.file.path)).toBe(pic.file.path);
  const img = await readLogImage(reader, pic.file.path);
  expect(img?.type).toBe("image/png");
  expect(Buffer.from(img!.bytes).toString("base64")).toBe(PNG);
  done();
});

test("a picture pasted in the terminal shows from the log too; one with its source line shows its own file", async () => {
  const { chat, done } = await chatOf([
    user("u1", [{ type: "text", text: "[Image #1] look" }, image], 0), reply("a1", "Nice.", 1),
    user("u2", [{ type: "text", text: "[Image #2] and this" }, image], 2), meta("m2", "[Image: source: /work/shots/after.png]", 2), reply("a2", "Ok.", 3),
  ]);
  const files = chat.messages.filter((m: any) => m.file).map((m: any) => m.file.path);
  expect(files.length).toBe(2);
  expect(files[0]).toMatch(LOG_IMAGE);
  expect(files[1]).toBe("/work/shots/after.png");
  done();
});

test("a picture the page sent shows its own upload while the send is known (no reload as it goes in)", async () => {
  const c = new Compat() as any;
  c.noteSend("t2", { cid: "c1", text: "look at this", files: ["/data/chat-attach/web-1-shot.png"], at: Date.parse(at(2)) });
  const { chat, done } = await chatOf([user("u1", "hi", 0), reply("a1", "Hi.", 1), takenMidTurn("q1", "look at this", 2)], c);
  const pic = chat.messages.find((m: any) => m.file);
  expect(pic.file.path).toBe("/data/chat-attach/web-1-shot.png");
  expect(pic.cid).toBe("c1");
  done();
});

test("only a picture of a message the chat has now, in the log it reads now", async () => {
  const { chat, reader, done } = await chatOf([takenMidTurn("q1", "look", 0)]);
  const path = chat.messages.find((m: any) => m.file).file.path as string;
  const [, , id] = LOG_IMAGE.exec(path)!;
  expect(await readLogImage(reader, path.replace(/:0$/, ":1"))).toBeNull();
  expect(await readLogImage(reader, logImage("/another/log.jsonl", `u${id}`, 0))).toBeNull();
  expect(await readLogImage(reader, logImage(reader.path, "u999999", 0))).toBeNull();
  expect(await readLogImage(reader, "/etc/passwd")).toBeNull();
  done();
});

test("which pictures a message shows", () => {
  const x = { id: "u10", images: 2 };
  expect(sentPictures({ ...x, paths: ["/a/1.png", "/a/2.png"] }, "/log").files.map((f) => f.path)).toEqual(["/a/1.png", "/a/2.png"]);
  expect(sentPictures(x, "/log", { files: ["/c/a.png", "/c/notes.pdf", "/c/b.jpg"] }).files.map((f) => f.path)).toEqual(["/c/a.png", "/c/b.jpg"]);
  const log = sentPictures({ ...x, paths: ["/a/1.png"] }, "/log");
  expect(log.files.map((f) => f.alt)).toEqual(["Image 1 of 2", "Image 2 of 2"]);
  expect(log.unseen).toBe(0);
  // no log to read: what it named, and how many it can't show
  expect(sentPictures({ ...x, paths: ["/a/1.png"] }, null)).toEqual({ files: [{ name: "1.png", path: "/a/1.png" }], unseen: 1 });
  expect(imagesIn(JSON.stringify({ type: "user", message: { content: [{ type: "image", source: { type: "base64", media_type: "text/html", data: "PGI+" } }] } }))).toEqual([]);
});

test("a picture still in the CLI's queue keeps its line (it has no picture there yet)", async () => {
  const { chat, done } = await chatOf([user("u1", "hi", 0), reply("a1", "Hi.", 1),
    { type: "queue-operation", operation: "enqueue", timestamp: at(2), content: "[Image #4]look at this" }], new Compat() as any, "working");
  const q = chat.messages.filter((m: any) => m.waiting);
  expect(q.map((m: any) => m.text ?? m.images)).toEqual(["look at this", 1]);
  done();
});

// the seams this patch (#56) relies on: a sync that changes one of them fails here first
test("pins: the hooks and the reader sent-images uses", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (f: string) => readFileSync(join(import.meta.dir, f), "utf8");
  expect(src("compat.ts")).toContain("const pics = sentPictures(x, reader.path ?? null, sentCid ? sends.find((s) => s.cid === sentCid) : null);");
  expect(src("main.ts")).toMatch(/if \(LOG_IMAGE\.test\(want\)\) \{[^]*?readLogImage\(live\.chats\?\.reader\(a\), want\)/);
  const { ChatReader } = await import("../core/chat-reader.js");
  expect(typeof (ChatReader as any).prototype.run).toBe("function");
  // a person's message is u<its line's byte offset>, with how many images it had
  expect(src("../core/chat-log.js")).toContain("if (u) this.user(`u${off}`, { ...u, at: time(a.timestamp ?? l.timestamp) });");
  expect(src("../core/chat-log.js")).toContain("images: u.images || 0 });");
});
