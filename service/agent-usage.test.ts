// Usage notes: Claude Code's and Codex's plan usage is never read, so no machine card or voice answer repeats a note per
// machine; Settings › Usage and the voice say once where to see it (core/agent-usage.js). Pins the seams it relies on:
// machine.py's note per CLI, its keys and state, and the call sites in Settings and the voice tools. Fork patch #33.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AGENT_USAGE, notRead } from "../core/agent-usage.js";
import { noPlanWords } from "../core/machines.js";
import { planWords, voiceTool, type VoiceIO, type Where } from "./voice-tools.ts";

const root = new URL("..", import.meta.url).pathname;
const src = (p: string) => readFileSync(root + p, "utf8");
const now = Date.now();
const note = (why: string) => ({ state: "no-access", why, at: now });
const stats = {
  at: now, limitsAt: now, health: { cpu: 10, load: 0.2, cores: 4, memory: 40, mem_used: 2 ** 32, mem_total: 2 ** 34, disk: 20, disks: [] },
  limits: {
    claude: note("Shepherdr doesn't read Claude plan usage. Open Claude Code and run /usage."),
    codex: note("Shepherdr doesn't read Codex plan usage. Open Codex and run /status."),
    elevenlabs: { state: "ok", plan: "creator", at: now, windows: [{ name: "Credits", used: 25 }] },
  },
};

test("one line names both agents' own commands", () => {
  expect(AGENT_USAGE).toContain("Claude Code");
  expect(AGENT_USAGE).toContain("/usage");
  expect(AGENT_USAGE).toContain("Codex");
  expect(AGENT_USAGE).toContain("/status");
  expect(notRead("claude") && notRead("codex")).toBe(true);
  expect(notRead("elevenlabs")).toBe(false);
  expect(noPlanWords({})).not.toMatch(/plan usage/i);
});

test("machine.py still sends a no-access note per agent CLI under these keys (what the filter drops)", () => {
  const py = src("mods/tasks/bin/herdr_task/machine.py");
  expect(py).toMatch(/NO_USAGE = \{"claude": /);
  expect(py).toMatch(/"codex": /);
  expect(py).toContain('"state": "no-access"');
});

test("the voice's machine answer has no agent usage note; ElevenLabs' plan stays", () => {
  const w = planWords(stats, now);
  expect(w).not.toMatch(/plan usage|\/usage|\/status/);
  expect(w).toContain("ElevenLabs (creator) plan: Credits 75% left");
});

test("the voice's Usage setting says once where to look, with or without a plan read", async () => {
  const snap: any = {
    host: "box", name: "Shepherdr", user: "You", everything: "home", places: [{ id: "home", name: "home", home: true, machine: "box", chat: "p:home", level: 0, status: "idle" }],
    machines: [{ id: "m:box", machine: "box", name: "box", status: "idle", here: true, stats }, { id: "m:vm", machine: "vm", name: "vm", status: "idle", stats }],
    tasks: [], needs: [], automations: {}, artifacts: [], settings: [], asks: {},
    config: { all: { agents: {}, review: false, merge: "done", proof: false }, spaces: {}, secrets: [], plugins: [], plans: [] },
  };
  const io: VoiceIO = { snap: () => snap, chat: async () => null, send: async () => {}, action: async () => ({ ok: true }) } as any;
  const where: Where = { client: "web", device: "phone", place: "home" };
  const usage = async () => (await voiceTool("look", { what: "settings", query: "usage" }, where, io)).result;
  expect(await usage()).toContain(`Usage: ${AGENT_USAGE}`);
  expect(await usage()).not.toContain("no plan usage read yet");
  snap.config.plans = [{ name: "ElevenLabs creator", windows: [{ name: "Credits", used: 25 }] }];
  expect(await usage()).toContain(`Usage: ElevenLabs creator: Credits 25% used. ${AGENT_USAGE}`);
  const machines = (await voiceTool("look", { what: "machines" }, where, io)).result;
  expect(machines).not.toMatch(/plan usage|\/usage|\/status/);
});

test("Settings: machine cards show no usage note, Usage shows the one line", () => {
  const tsx = src("web/src/settings.tsx");
  const machines = tsx.slice(tsx.indexOf("function Machines("), tsx.indexOf("function noUsageOf("));
  expect(machines).not.toContain("noUsage");
  expect(machines).not.toContain("m.limits");
  const usage = tsx.slice(tsx.indexOf("function Usage("), tsx.indexOf("function Plugins("));
  expect(usage).toContain("{AGENT_USAGE}");
  expect(tsx).toContain("!notRead(k)");
  expect(tsx).not.toContain("USAGE_NAMES");
});
