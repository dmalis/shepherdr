// The Feedback page's data and the person's calls on it (friction loop, slice 2, #94: fork/specs/friction-loop.md).
// What this machine kept of problems in Shepherdr itself is herdr-task's record (`herdr-task feedback --list --all
// --json`, read only): read when the record's file changes, at most every few seconds, and after each call. A read
// that fails keeps the last list. The person's calls (Not now, Never, Undo, the box's report) run herdr-task's
// person-only commands, outside any agent's terminal. Nothing here posts anywhere: the decisions stay on this machine.
import { statSync } from "node:fs";
import { join } from "node:path";
import type { FeedbackList, FeedbackMatch, FeedbackRow } from "../web/shared/types.ts";
import { where } from "./paths.ts";
import { pluginOn } from "./next.ts";
import { readSettings } from "./settings.ts";
import { spawn } from "./spawn.ts";

type Ran = { code: number; stdout: string; stderr: string };
export type Runner = (args: string[]) => Promise<Ran>;

const KEY = /^[A-Za-z0-9][\w-]{0,39}$/;
const SPACE = /^(?:[\w.][\w.-]{0,79}\/)?[\w.~][\w.~-]{0,79}$/;
const WHEN = new Set(["tomorrow", "week", "again"]);
const EXPECT = new Set(["later", "declined", "following"]);
const REASONS = new Set(["completed", "not_planned", "duplicate"]);
const VERSION = /^\d+\.\d+\.\d+$/;
const LINE_MAX = 160;
const TEXT_MAX = 4000;
const FIELDS = ["bug", "confusing", "workaround", "manual", "miss"] as const;

/** herdr-task, as the service runs it, never with an agent's terminal id: the person's calls are refused there */
export const herdrTask: Runner = async (args) => {
  const env = { ...process.env };
  delete env.HC_TERMINAL_ID;
  delete env.HC_TERMINAL_SOCKET;
  const p = spawn([process.env.SHEPHERDR_HERDR_TASK || "herdr-task", "feedback", ...args], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const kill = setTimeout(() => p.kill(), 20_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, stdout, stderr };
  } finally { clearTimeout(kill); }
};

/** the last JSON line herdr-task printed, else null */
function answer(out: string): any {
  for (const l of out.trim().split("\n").reverse()) { try { return JSON.parse(l); } catch {} }
  return null;
}

/** an issue or pull request on GitHub, the only link a filed row shows as "On GitHub": its canonical form, else null */
export function githubUrl(u: unknown): string | null {
  if (typeof u !== "string" || !u.startsWith("https://")) return null;
  try {
    const x = new URL(u);
    const ok = x.protocol === "https:" && x.hostname === "github.com" && !x.port && !x.username && !x.password && /^\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+\/?$/.test(x.pathname);
    return ok ? x.href : null;
  } catch { return null; }
}

/** each row whose origin has no chat running (`chats`: the spaces that have one) says so; unknown: left as it is */
export function withChats(l: FeedbackList, chats?: Set<string>): FeedbackList {
  if (!chats) return l;
  return { ...l, rows: l.rows.map((r) => (r.space && !chats.has(r.space) ? { ...r, noChat: true } : r)) };
}

/** Feedback offers in a space: its own, else Everywhere's, else on (herdr-task's feedback_on) */
export function offersOn(d: any, space?: string | null): boolean {
  const own = space ? d?.spaces?.[space.split("/").pop()!]?.agents?.feedback : undefined;
  if (typeof own === "boolean") return own;
  const all = d?.everywhere?.agents?.feedback;
  return typeof all === "boolean" ? all : true;
}

/** where a kept problem goes on the page, by its state and the person's decision, as of `now` */
export function sectionOf(p: any, now: number): FeedbackRow["section"] {
  if (p.state === "filed" || p.state === "filing" || p.url || p.decision === "following") return "filed";
  if (p.state === "declined" || p.decision === "declined") return "declined";
  if (p.decision === "later" && (p.until == null || p.until > now)) return "later";
  return "found";
}

/** one issue a check found, as the page draws it (a duplicate as the issue GitHub says it duplicates), else null */
export function matchOf(m: any, makers: boolean): FeedbackMatch | null {
  const x = m?.canonical && typeof m.canonical === "object" ? m.canonical : m;
  const url = githubUrl(x?.url);
  if (!url || !/\/issues\/\d+\/?$/.test(url) || typeof x.title !== "string" || typeof x.repo !== "string" || !Number.isInteger(x.number)) return null;
  return { repo: x.repo, number: x.number, title: x.title, url, state: x.state === "closed" ? "closed" : "open",
    ...(x.state === "closed" && REASONS.has(x.reason) ? { reason: x.reason } : {}), ...(makers ? { makers: true as const } : {}) };
}

/** what a problem's last check found (herdr-task feedback --check), for the page: none when it was never checked */
export function checkOf(p: any): FeedbackRow["check"] | undefined {
  const c = p.checked && typeof p.checked === "object" ? p.checked : null;
  if (!c && !p.check_error) return undefined;
  const of = (l: unknown, makers: boolean) => (Array.isArray(l) ? l : []).map((m) => matchOf(m, makers)).filter((m): m is FeedbackMatch => !!m);
  return {
    matches: [...of(c?.dupes, false), ...of(c?.upstream, true)],
    ...(VERSION.test(c?.newest ?? "") ? { newest: c.newest } : {}),
    ...(VERSION.test(c?.installed ?? "") ? { installed: c.installed } : {}),
    ...(p.check_error ? { failed: true as const } : {}),
  };
}

/** herdr-task's rows as the page shows them: only what it draws (no report text), newest first */
export function rowsOf(list: unknown, settings: any, now = Date.now()): FeedbackList {
  const rows: FeedbackRow[] = [];
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== "object" || typeof p.line !== "string") continue;
    const id = String(p.id ?? p.key ?? "");
    if (!KEY.test(id)) continue;
    const reports = (Array.isArray(p.reports) ? p.reports : []).filter((r: any) => r && typeof r === "object");
    const first = reports[0]?.from;
    const from = first && typeof first === "object" ? {
      ...(typeof first.task === "string" ? { task: first.task } : {}), ...(first.chat ? { chat: true as const } : {}),
      ...(first.person ? { person: true as const } : {}), ...(typeof first.action === "string" ? { action: first.action } : {}),
      ...(first.agent ? { agent: true as const } : {}),
    } : undefined;
    const at = Math.max(Number(p.at) || 0, ...reports.map((r: any) => Number(r.at) || 0));
    const section = sectionOf(p, now);
    rows.push({
      id, line: p.line, section, state: String(p.state ?? "found"), count: Math.max(Number(p.count) || 0, reports.length, 1), at,
      ...(typeof p.fix === "string" && p.fix ? { fix: p.fix } : {}),
      ...(FIELDS.includes(p.kind) ? { kind: p.kind } : {}),
      ...(typeof p.space === "string" && p.space ? { space: p.space } : {}),
      ...(from && Object.keys(from).length ? { from } : {}),
      ...(section === "later" ? { until: typeof p.until === "number" ? p.until : null } : {}),
      ...((u) => (u ? { url: u } : {}))(githubUrl(p.url) ?? (p.decision === "following" ? githubUrl(p.outcome?.url) : null)),
      ...((c) => (c ? { check: c } : {}))(checkOf(p)),
      ...(p.decision === "following" && githubUrl(p.outcome?.url) ? { following: { title: String(p.outcome.title || p.outcome.issue || ""), url: githubUrl(p.outcome.url)! } } : {}),
      ...(!offersOn(settings, p.space) ? { off: true } : {}),
    });
  }
  rows.sort((a, b) => b.at - a.at);
  return { rows, found: rows.filter((r) => r.section === "found").length, off: settings?.everywhere?.agents?.feedback === false };
}

const settingsNow = () => { try { return readSettings(); } catch { return {}; } };

export class Feedback {
  private last: unknown[] | null = null;
  private error = "";
  private seen = "";
  private reading: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** the snapshot is built again (main.ts: model.rebuild) */
  changed: () => void = () => {};

  constructor(private run: Runner = herdrTask, private file = () => join(process.env.HERDR_TASK_STORE || where().tasks, ".feedback.json"),
    private settings: () => any = settingsNow, private on: () => boolean = () => pluginOn("feedback")) {}

  /** read the record when its file changed (and once a minute regardless), until stop() */
  start(every = 3000) {
    if (this.timer) return;
    let ticks = 0;
    // once a minute the snapshot is built again too: a Not now whose time came shows under Found
    this.timer = setInterval(() => {
      // switched off in Settings › Plugins: nothing read; switched on again, the next tick reads (seen is cleared)
      if (!this.on()) { this.seen = ""; return; }
      if (++ticks % 20 === 0) void this.read().then(() => this.changed());
      else if (this.stamp() !== this.seen) void this.read();
    }, every);
    if (this.on()) void this.read();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private stamp() {
    try { const s = statSync(this.file()); return `${s.mtimeMs}:${s.size}`; } catch { return "none"; }
  }

  /** herdr-task's list, read again; one that fails keeps the last, with why */
  read(): Promise<void> {
    if (this.reading) return this.reading;
    const stamp = this.stamp();
    this.reading = (async () => {
      const before = JSON.stringify([this.last, this.error]);
      try {
        const r = await this.run(["--list", "--all", "--json"]);
        const out = answer(r.stdout);
        if (r.code !== 0 || !Array.isArray(out)) throw new Error(out?.error || r.stderr.trim().split("\n").pop() || "herdr-task didn't answer.");
        this.last = out;
        this.error = "";
        this.seen = stamp;
      } catch (e) {
        this.error = (e as Error).message || "The feedback record couldn't be read.";
      } finally {
        this.reading = null;
        if (JSON.stringify([this.last, this.error]) !== before) this.changed();
      }
    })();
    return this.reading;
  }

  /** what the page shows (null until the first read answered or failed) */
  list(now = Date.now(), chats?: Set<string>): FeedbackList | null {
    if (this.last === null && !this.error) return null;
    const out = withChats(rowsOf(this.last ?? [], this.settings(), now), chats);
    return this.error ? { ...out, error: "Couldn't read the newest list just now: showing the last one." } : out;
  }

  /** One of the person's calls from the page: report (the box), later, no, undo, follow. -> {ok, ...} or {ok: false, error} */
  async act(b: any): Promise<{ ok: boolean; error?: string; off?: boolean; key?: string; changed?: boolean }> {
    if (!this.on()) return { ok: false, error: "Feedback is switched off in Settings › Plugins." };
    let args: string[];
    try { args = argsOf(b); } catch (e) { return { ok: false, error: (e as Error).message }; }
    const r = await this.run(args);
    const out = answer(r.stdout);
    // a poll that started before the call can't answer for it: wait for it, then read again
    if (this.reading) await this.reading;
    await this.read();
    if (r.code !== 0 || !out || out.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "That didn't work." };
    // a decision already made (another device, a list that was old): said as it is, no Undo that would reverse theirs
    if (b.do !== "report" && out.changed === false) return { ok: false, error: "That was already decided: the list shows it as it is now." };
    if (b.do === "report" && out.why === "off") return { ok: false, off: true, error: "Feedback offers are off in that space, so nothing was kept. Settings › Agents › Feedback offers turns them on." };
    return { ok: true, key: out.key, changed: out.changed };
  }
}

/** the person's call as herdr-task's arguments; anything else is refused */
export function argsOf(b: any): string[] {
  const key = () => {
    if (typeof b?.key !== "string" || !KEY.test(b.key)) throw new Error("That problem isn't here any more.");
    return b.key;
  };
  switch (b?.do) {
    case "report": {
      const text = typeof b.text === "string" ? b.text.slice(0, TEXT_MAX).trim() : "";
      if (!text) throw new Error("Write what should be better first.");
      if (typeof b.space !== "string" || !SPACE.test(b.space)) throw new Error("That space isn't here any more.");
      const long = text.length > LINE_MAX || text.includes("\n");
      // the line last, after --: one that starts like a flag is still the line
      return ["--person", "--space", b.space, ...(long ? [`--details=${text}`] : []), "--json", "--", text];
    }
    case "later":
      if (!WHEN.has(b.when)) throw new Error("Not now is tomorrow, next week or when it happens again.");
      return ["--key", key(), "--later", b.when, "--json"];
    case "no": return ["--key", key(), "--no", "--person", "--json"];
    case "undo": {
      // the decision this Undo is for (its toast's, its row's): one made since, by another device, is left alone
      if (b.expect !== undefined && !EXPECT.has(b.expect)) throw new Error("Undo is for a Not now, a Said no or a Follow.");
      return ["--key", key(), "--undo", ...(b.expect ? ["--expect", b.expect] : []), "--json"];
    }
    case "follow": {
      // Follow this one (slice 3): an issue the check found; herdr-task takes only one of those, and posts nothing
      const url = githubUrl(b.url);
      if (!url || !/\/issues\/\d+\/?$/.test(url)) throw new Error("That isn't an issue on GitHub.");
      return ["--key", key(), "--follow", url, "--json"];
    }
  }
  throw new Error("Shepherdr can't do that yet.");
}

/** this service's one (main.ts starts it while the plugin is on; actions.ts runs the page's calls) */
export const feedback = new Feedback();
