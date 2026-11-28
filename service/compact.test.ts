import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configOf, scheduleAgentArgs, setConfig } from "./next.ts";

// fork #219: Compact at, a field of each role's agent pick (coordinator, worker, reviewer) in the settings file, saved
// by Settings › Agents and by the older role setter, as herdr-task reads it. No new key; none set: the CLI's own.
const dir = mkdtempSync(join(tmpdir(), "compact-"));
const file = join(dir, "settings.json");
const pick = { agent: "claude", model: null, effort: null, fast: false, perm: null };
const repo = { key: "/r/shop", folder: "/r/shop", machine: null, name: "shop", spaces: [], tasks: 1 };
const read = () => JSON.parse(readFileSync(file, "utf8"));
const config = () => configOf({ defaults: { Chats: pick, Tasks: pick, Reviews: pick } as any, spaces: [], secrets: [], plans: [], repos: [repo] });
const withFile = (fn: () => void | Promise<void>) => async () => {
  const was = process.env.HERDR_TASK_SETTINGS;
  process.env.HERDR_TASK_SETTINGS = file;
  try { await fn(); } finally { if (was === undefined) delete process.env.HERDR_TASK_SETTINGS; else process.env.HERDR_TASK_SETTINGS = was; }
};

test("none set by default: each role leaves it to its CLI", withFile(() => {
  writeFileSync(file, JSON.stringify({ everywhere: { worker: { agent: "claude", model: "opus" } } }));
  const all = config().all;
  expect(all.agents.Tasks.compact).toBeUndefined();
  expect(all.agents.Chats.compact).toBeUndefined();
}));

test("Settings › Agents saves it with the rest of the pick, a repo's own too, and Default drops it", withFile(() => {
  writeFileSync(file, JSON.stringify({ everywhere: { tasks: { merge: "checks" } } }));
  setConfig("all", "agents.Tasks", { agent: "claude", model: "opus", effort: "high", fast: true, perm: null, compact: 300000 });
  expect(read().everywhere.worker).toEqual({ agent: "claude", model: "opus", effort: "high", fast: true, perm: null, compact: 300000 });
  expect(read().everywhere.tasks).toEqual({ merge: "checks" });
  expect(config().all.agents.Tasks.compact).toBe(300000);
  setConfig("repo:/r/shop", "agents.Reviews", { agent: "codex", model: "gpt-6.2-sol", effort: "high", fast: false, perm: null, compact: 200000 });
  expect(read().repos["/r/shop"].reviewer.compact).toBe(200000);
  expect(config().repos![0].agents.Reviews.compact).toBe(200000);
  setConfig("all", "agents.Tasks", { agent: "claude", model: "opus", effort: "high", fast: true, perm: null, compact: null });
  expect("compact" in read().everywhere.worker).toBe(false);
}));

test("Default on a repo is the CLI's own (0), over Everywhere's size; the window reads it as Default", withFile(() => {
  writeFileSync(file, JSON.stringify({ everywhere: { worker: { agent: "claude", compact: 300000 } } }));
  setConfig("repo:/r/shop", "agents.Tasks", { agent: "codex", model: "gpt-6.2-sol", effort: null, fast: false, perm: null, compact: null });
  expect(read().repos["/r/shop"].worker.compact).toBe(0);
  expect(config().repos![0].agents.Tasks.compact).toBeUndefined();
  expect(config().all.agents.Tasks.compact).toBe(300000);
}));

test("a schedule's agent settings say its Compact at, Default as the CLI's own", () => {
  expect(scheduleAgentArgs({ agent: "claude", fast: false, compact: 300000 })).toContain("compact=300000");
  expect(scheduleAgentArgs({ agent: "claude", fast: false, compact: null })).toContain("compact=0");
  expect(() => scheduleAgentArgs({ agent: "claude", compact: "0x186A0" })).toThrow("Compact at takes a size of 100k tokens or more.");
});

test("only a size of 100k tokens or more is saved", withFile(() => {
  writeFileSync(file, "{}");
  for (const bad of [5000, "huge", -1, 1.5])
    expect(() => setConfig("all", "agents.Chats", { ...pick, compact: bad })).toThrow("Compact at takes a size of 100k tokens or more.");
  expect(read()).toEqual({});
  // a size written by hand as "300k" reads as tokens
  writeFileSync(file, JSON.stringify({ everywhere: { coordinator: { agent: "claude", compact: "300k" } } }));
  expect(config().all.agents.Chats.compact).toBe(300000);
}));

test("the older role setter keeps it the same way", withFile(async () => {
  writeFileSync(file, "{}");
  const { Settings } = await import("./settings.ts");
  const s = new Settings();
  s.start();
  s.set("role.worker", JSON.stringify({ agent: "codex", model: "gpt-6.2-sol", effort: "high", compact: 400000 }));
  expect(read().everywhere.worker).toEqual({ agent: "codex", model: "gpt-6.2-sol", effort: "high", fast: false, perm: null, compact: 400000 });
  expect(() => s.set("role.worker", JSON.stringify({ agent: "codex", compact: 10 }))).toThrow("Compact at takes a size of 100k tokens or more.");
}));
