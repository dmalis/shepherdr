// The Feedback page's service side (friction loop, slice 2, #94): the list read from herdr-task, a failed read keeping
// the last list, the person's calls as herdr-task's arguments, and none of them running from an agent's terminal.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argsOf, Feedback, herdrTask, rowsOf, sectionOf, type Runner } from "./feedback.ts";

const NOW = Date.UTC(2026, 10, 27, 12);
const H = 3600_000;
const row = (x: Record<string, unknown>) => {
  const at = (x.at as number) ?? NOW - H;
  return { key: "a1", id: "a1", line: "The reply bubble doesn't show which message it answers", state: "found", count: 1, at, space: "sp1", reports: [{ at, from: { task: "Sticker book" }, space: "sp1", details: "secret-ish details" }], ...x };
};

test("the list: each problem's section, newest first, with only what the page draws", () => {
  const l = rowsOf([
    row({ id: "a1", key: "a1", at: NOW - 3 * H }),
    row({ id: "b2", key: "b2", state: "filed", url: "https://github.com/example/shepherdr/issues/9", at: NOW - 2 * H }),
    row({ id: "c3", key: "c3", decision: "later", until: NOW + H, at: NOW - H }),
    row({ id: "d4", key: "d4", state: "declined", decision: "declined", at: NOW - 4 * H }),
    row({ id: "e5", key: "e5", decision: "later", until: NOW - 1, at: NOW - 5 * H }),
    row({ id: "f6", key: "f6", decision: "later", until: null, at: NOW - 6 * H }),
  ], {}, NOW);
  expect(l.rows.map((r) => [r.id, r.section])).toEqual([["c3", "later"], ["b2", "filed"], ["a1", "found"], ["d4", "declined"], ["e5", "found"], ["f6", "later"]]);
  expect(l.found).toBe(2);
  expect(l.off).toBe(false);
  expect(l.rows.find((r) => r.id === "f6")!.until).toBeNull();
  expect(l.rows.find((r) => r.id === "a1")!.from).toEqual({ task: "Sticker book" });
  // a report's details never reach the page
  expect(JSON.stringify(l)).not.toContain("secret-ish");
});

test("sections: filing and a link are Filed; the person's no is Said no; Not now ends at its time", () => {
  expect(sectionOf({ state: "filing" }, NOW)).toBe("filed");
  expect(sectionOf({ state: "found", url: "https://x" }, NOW)).toBe("filed");
  expect(sectionOf({ state: "told", decision: "declined" }, NOW)).toBe("declined");
  expect(sectionOf({ state: "told", decision: "later", until: NOW }, NOW)).toBe("found");
  expect(sectionOf({ state: "told" }, NOW)).toBe("found");
});

test("offers off: a row whose origin is off says so; the top line only when Everywhere's is off", () => {
  const off = rowsOf([row({ space: "vm/sp1" })], { spaces: { sp1: { agents: { feedback: false } } } }, NOW);
  expect(off.rows[0].off).toBe(true);
  expect(off.off).toBe(false);
  const all = rowsOf([row({})], { everywhere: { agents: { feedback: false } }, spaces: { sp1: { agents: { feedback: true } } } }, NOW);
  expect(all.rows[0].off).toBeUndefined();
  expect(all.off).toBe(true);
});

test("rows the page can't trust are left out: no line, a strange key, a link that isn't https", () => {
  const l = rowsOf([{ id: "x", state: "found" }, row({ id: "../../x" }), row({ id: "ok1", url: "javascript:alert(1)" }), null, 3], {}, NOW);
  expect(l.rows.map((r) => r.id)).toEqual(["ok1"]);
  expect(l.rows[0].url).toBeUndefined();
});

const fake = (answers: (Partial<{ code: number; stdout: string; stderr: string }> | Error)[]) => {
  const calls: string[][] = [];
  const run: Runner = async (args) => {
    calls.push(args);
    const a = answers.shift() ?? { code: 0, stdout: "[]" };
    if (a instanceof Error) throw a;
    return { code: 0, stdout: "", stderr: "", ...a };
  };
  return { run, calls };
};

test("a read that fails keeps the last list, and says so; the next good read clears it", async () => {
  const f = fake([{ stdout: JSON.stringify([row({})]) }, { code: 1, stderr: "Traceback\nboom" }, new Error("spawn failed"), { stdout: "[]" }]);
  let changed = 0;
  const fb = new Feedback(f.run, () => "/nonexistent/.feedback.json", () => ({}), () => true);
  fb.changed = () => changed++;
  expect(fb.list(NOW)).toBeNull();
  await fb.read();
  expect(fb.list(NOW)!.rows.length).toBe(1);
  await fb.read();
  const kept = fb.list(NOW)!;
  expect(kept.rows.length).toBe(1);
  expect(kept.error).toContain("showing the last one");
  await fb.read();
  expect(fb.list(NOW)!.rows.length).toBe(1);
  await fb.read();
  expect(fb.list(NOW)!.rows.length).toBe(0);
  expect(fb.list(NOW)!.error).toBeUndefined();
  expect(f.calls.every((c) => c.join(" ") === "--list --all --json")).toBe(true);
  // the snapshot is built again only when what it shows changed
  expect(changed).toBe(4);
});

test("the person's calls, as herdr-task's arguments", () => {
  expect(argsOf({ do: "later", key: "a1", when: "week" })).toEqual(["--key", "a1", "--later", "week", "--json"]);
  expect(argsOf({ do: "no", key: "a1" })).toEqual(["--key", "a1", "--no", "--person", "--json"]);
  expect(argsOf({ do: "undo", key: "a1" })).toEqual(["--key", "a1", "--undo", "--json"]);
  expect(argsOf({ do: "report", text: "  Ready refused a reviewed commit ", space: "sp1" })).toEqual(["--person", "--space", "sp1", "--json", "--", "Ready refused a reviewed commit"]);
  // a line that starts like a flag is still the line
  expect(argsOf({ do: "report", text: "--file is broken", space: "sp1" }).slice(-2)).toEqual(["--", "--file is broken"]);
  const long = "x".repeat(200);
  expect(argsOf({ do: "report", text: long, space: "vm/sp1" })).toEqual(["--person", "--space", "vm/sp1", `--details=${long}`, "--json", "--", long]);
  expect(() => argsOf({ do: "later", key: "a1", when: "never" })).toThrow();
  expect(() => argsOf({ do: "no", key: "--all" })).toThrow();
  expect(() => argsOf({ do: "report", text: "x", space: "--key" })).toThrow();
  expect(() => argsOf({ do: "report", text: "x", space: "-x/sp1" })).toThrow();
  expect(() => argsOf({ do: "report", text: "   ", space: "sp1" })).toThrow();
  expect(() => argsOf({ do: "file", key: "a1" })).toThrow();
});

test("a call reads the list again, and passes herdr-task's own no", async () => {
  const f = fake([{ stdout: JSON.stringify({ key: "a1", changed: true }) }, { stdout: "[]" }, { code: 1, stdout: JSON.stringify({ error: "No problem with that key is kept here." }) }, { stdout: "[]" }, { stdout: JSON.stringify({ key: "z", sent: false, why: "off" }) }, { stdout: "[]" }]);
  const fb = new Feedback(f.run, () => "/nonexistent", () => ({}), () => true);
  expect(await fb.act({ do: "later", key: "a1", when: "tomorrow" })).toEqual({ ok: true, key: "a1", changed: true });
  expect(f.calls[1]).toEqual(["--list", "--all", "--json"]);
  expect(await fb.act({ do: "undo", key: "zz" })).toEqual({ ok: false, error: "No problem with that key is kept here." });
  const off = await fb.act({ do: "report", text: "x", space: "sp9" });
  expect(off.ok).toBe(false);
  expect(off.off).toBe(true);
  // refused before herdr-task runs: a bad call, or the plugin switched off
  expect((await fb.act({ do: "file", key: "a1" })).ok).toBe(false);
  const offPlugin = new Feedback(f.run, () => "/nonexistent", () => ({}), () => false);
  const n = f.calls.length;
  expect((await offPlugin.act({ do: "no", key: "a1" })).error).toContain("Settings › Plugins");
  expect(f.calls.length).toBe(n);
});

test("herdr-task runs outside any agent's terminal: its terminal id never reaches the person's calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-"));
  const bin = join(dir, "herdr-task");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s' "\${HC_TERMINAL_ID:-none}" > "${dir}/seen"\necho '[]'\n`);
  chmodSync(bin, 0o755);
  const was = { id: process.env.HC_TERMINAL_ID, bin: process.env.SHEPHERDR_HERDR_TASK };
  process.env.HC_TERMINAL_ID = "t-agent";
  process.env.SHEPHERDR_HERDR_TASK = bin;
  try {
    const r = await herdrTask(["--list", "--all", "--json"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "seen"), "utf8")).toBe("none");
  } finally {
    if (was.id === undefined) delete process.env.HC_TERMINAL_ID; else process.env.HC_TERMINAL_ID = was.id;
    if (was.bin === undefined) delete process.env.SHEPHERDR_HERDR_TASK; else process.env.SHEPHERDR_HERDR_TASK = was.bin;
  }
});

test("pins: the action's case and the snapshot's field are where the page needs them", () => {
  const actions = readFileSync(join(import.meta.dir, "actions.ts"), "utf8");
  expect(actions).toContain('case "feedback": return feedback.act(b);');
  const main = readFileSync(join(import.meta.dir, "main.ts"), "utf8");
  expect(main).toContain("live.setSnapshot(withFeedback(");
  const next = readFileSync(join(import.meta.dir, "next.ts"), "utf8");
  expect(next).toContain('{ id: "feedback", name: "Feedback" }');
});
