// The Feedback page's data and the person's calls on it (friction loop, slice 2, #94: fork/specs/friction-loop.md).
// What this machine kept of problems in Shepherdr itself is herdr-task's record (`herdr-task feedback --list --all
// --json`, read only): read when the record's file changes, at most every few seconds, and after each call. A read
// that fails keeps the last list. The person's calls (Not now, Never, Undo, the box's report) run herdr-task's
// person-only commands, outside any agent's terminal. Nothing here posts anywhere: the decisions stay on this machine.
// Post it (slice 4) keeps the person's yes to one draft revision; the post itself is the Assistant's (herdr-task
// feedback --file --rev), and Check again only reads GitHub. Slice 6: a fix's release and whether this machine has it
// (herdr-task's read, `ship`), the person's Works and Still broken, and a problem that came back.
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
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
// a failed action's label from the app's fixed list (slice 7: its error's Report), as herdr-task takes it: plain words only
const ACTION = /^[A-Z][a-z]*(?: [a-z-]+){0,4}$/;
const EXPECT = new Set(["later", "declined", "following"]);
const REASONS = new Set(["completed", "not_planned", "duplicate"]);
const VERSION = /^\d+\.\d+\.\d+$/;
const LINE_MAX = 160;
const TEXT_MAX = 4000;
const FIELDS = ["bug", "confusing", "workaround", "manual", "miss"] as const;
const DAY = 24 * 3600_000;
const TRY_MAX = 200;

/** herdr-task, as the service runs it, never with an agent's terminal id: the person's calls are refused there */
export const herdrTask: Runner = async (args) => {
  const env = { ...process.env };
  delete env.HC_TERMINAL_ID;
  delete env.HC_TERMINAL_SOCKET;
  const p = spawn([process.env.SHEPHERDR_HERDR_TASK || "herdr-task", "feedback", ...args], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  // --track reads one issue after another on GitHub: it may take longer (each one read is kept as it goes)
  const kill = setTimeout(() => p.kill(), args.includes("--track") ? 300_000 : 20_000);
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
  // Works, a day ago or more (slice 6): folded under Fixed, as history; one that came back is under Found again
  if (!p.back && p.tried?.result === "works" && Number(p.tried.at) > 0 && now - p.tried.at >= DAY) return "fixed";
  if (p.state === "filed" || p.state === "filing" || p.url || p.decision === "following") return "filed";
  if (p.state === "declined" || p.decision === "declined") return "declined";
  // the person's yes to a draft (slice 4): under Filed, each step of its post said there
  if (p.decision === "approved" || postOf(p, now)) return "filed";
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
    // an issue and a duplicate that points to it are one match: the first one found
    matches: [...of(c?.dupes, false), ...of(c?.upstream, true)].filter((m, i, all) => all.findIndex((x) => x.url === m.url) === i),
    ...(VERSION.test(c?.newest ?? "") ? { newest: c.newest } : {}),
    ...(VERSION.test(c?.installed ?? "") ? { installed: c.installed } : {}),
    ...(p.check_error ? { failed: true as const } : {}),
  };
}

// Slice 4: a draft, the person's yes to one revision, and its post (herdr-task's feedback_post.py).
const POSTS = new Set(["waiting", "posting", "posted", "refused", "unsure"]);
const REPO = /^[\w.-]+\/[\w.-]+$/;
const MARK = /\n*<!-- shepherdr-feedback [0-9A-Za-z_-]+ rev \d+(?: [0-9a-f]{8,32})? -->\s*$/;
/** herdr-task's FILING_MS: a post marked posting this long ago never came back, so it may have gone out */
export const POSTING_MS = 10 * 60_000;

/** the draft as File it… shows it: where it goes, its title, and its body as posted without the hidden line */
export function draftOf(p: any): FeedbackRow["draft"] | undefined {
  const d = p?.draft, t = d?.target;
  if (!d || !Number.isInteger(d.rev) || d.rev < 1 || typeof d.title !== "string" || typeof d.body !== "string") return undefined;
  if (!t || !REPO.test(String(t.repo)) || (t.action !== "create" && t.action !== "comment")) return undefined;
  if (t.action === "comment" && !Number.isInteger(t.issue)) return undefined;
  const dupe = (Array.isArray(p.checked?.dupes) ? p.checked.dupes : []).find((m: any) => m?.number === t.issue && m?.repo === t.repo);
  return { rev: d.rev, title: d.title, body: d.body.replace(MARK, ""),
    target: { repo: t.repo, action: t.action, ...(t.action === "comment" ? { issue: t.issue } : {}),
      ...(t.action === "comment" && typeof dupe?.title === "string" ? { title: dupe.title } : {}) } };
}

/** its post's step, as of now: a posting that never came back reads as unsure (herdr-task writes it so on its next look) */
export function postOf(p: any, now: number): FeedbackRow["post"] | undefined {
  const x = p?.post;
  if (!x || !POSTS.has(x.state) || !Number.isInteger(x.rev)) return undefined;
  const state = x.state === "posting" && now - (Number(x.started) || 0) > POSTING_MS ? "unsure" : x.state;
  const why = typeof x.why === "string" && x.why ? x.why.split("\n")[0].slice(0, 200) : "";
  return { state, rev: x.rev, ...(why && state === "refused" ? { why } : {}) };
}

// Slice 5: GitHub's side of a filed or followed problem's issue (herdr-task feedback --track, feedback_track.py).
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;

/** what GitHub said of its issue last, for the page: open, closed and why, and a duplicate's canonical issue */
export function outcomeOf(p: any): FeedbackRow["outcome"] | undefined {
  const o = p?.outcome;
  // a read of GitHub names its issue ("repo#n"); an older post's placeholder ({url, state: open}) is no read
  if (!o || typeof o !== "object" || typeof o.issue !== "string" || (o.state !== "open" && o.state !== "closed")) return undefined;
  const c = o.state === "closed" && o.reason === "duplicate" ? matchOf(o.canonical, false) : null;
  return { state: o.state, ...(o.state === "closed" && REASONS.has(o.reason) ? { reason: o.reason } : {}),
    ...(c ? { canonical: { title: c.title, url: c.url, state: c.state, ...(c.reason ? { reason: c.reason } : {}) } } : {}),
    ...(Number.isFinite(o.checked_at) && o.checked_at > 0 ? { at: o.checked_at } : {}),
    ...(p.track_error ? { failed: true as const } : {}) };
}

const older = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

/** its fix as the page shows it (slice 6), from herdr-task's read: the outcome's fix (its closing commit, the first
 *  release with it), `shipped` (herdr-task lists it only for the build installed now) and `here` (this machine's version
 *  and build). None until its issue closed as fixed, or while it came back. */
export function shipOf(p: any): FeedbackRow["ship"] | undefined {
  if (!p || typeof p !== "object" || p.back) return undefined;
  const o = p.outcome, c = o?.canonical;
  const fixed = o?.state === "closed" && (o.reason === "completed" || (o.reason === "duplicate" && c?.state === "closed" && c?.reason === "completed"));
  const s = p.shipped && typeof p.shipped === "object" && typeof p.shipped.build === "string" ? p.shipped : null;
  if (!fixed && !s) return undefined;
  const release = VERSION.test(o?.fix?.release ?? "") ? o.fix.release : VERSION.test(s?.release ?? "") ? s.release : undefined;
  const version = VERSION.test(p.here?.version ?? "") ? p.here.version : undefined;
  const known = typeof p.here?.build === "string" && p.here.build.length > 0;
  const tryIt = typeof s?.try === "string" && s.try.trim() ? s.try.trim().slice(0, TRY_MAX) : undefined;
  return { ...(release ? { release } : {}), ...(s ? { here: true as const } : {}), ...(tryIt ? { tryIt } : {}),
    ...(!s && release && version && older(version, release) ? { update: true as const } : {}),
    ...(!s && !known && fixed ? { unknown: true as const } : {}) };
}

/** the person's Works or Still broken, when it was for the build installed now (a newer build is tried again) */
export function triedOf(p: any): FeedbackRow["tried"] | undefined {
  const t = p?.tried;
  if (!t || (t.result !== "works" && t.result !== "broken") || !(Number(t.at) > 0)) return undefined;
  // Works stays said: a newer build doesn't undo it (herdr-task stops following it)
  if (t.result === "broken" && (t.build ?? null) !== (p.here?.build ?? null)) return undefined;
  return { result: t.result, at: Number(t.at) };
}

/** it came back (Still broken, or reported again after Works or with its fix here): why, and its issue */
export function backOf(p: any): FeedbackRow["back"] | undefined {
  const b = p?.back;
  if (!b || typeof b !== "object" || (b.why !== "broken" && b.why !== "reported")) return undefined;
  const issue = githubUrl(b.issue);
  return { why: b.why, ...(issue ? { issue } : {}) };
}

/** whether herdr-task follows this problem's issue (feedback_track.followed): filed or the person's Follow, its origin's
 *  offers on, not yet said to work */
export function followed(p: any, settings: any): boolean {
  if (!p || typeof p !== "object") return false;
  if (!ISSUE_URL.test(String(p.outcome?.url ?? "")) && !ISSUE_URL.test(String(p.url ?? ""))) return false;
  const filed = p.state === "filed" || p.decision === "following" || p.post?.state === "posted";
  return filed && p.decision !== "declined" && p.tried?.result !== "works" && offersOn(settings, p.space);
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
      ...((d) => (d ? { draft: d } : {}))(draftOf(p)),
      ...(p.decision === "approved" && Number.isInteger(p.approval?.rev) ? { approved: p.approval.rev } : {}),
      ...((x) => (x ? { post: x } : {}))(postOf(p, now)),
      ...((o) => (o && (section === "filed" || section === "fixed") ? { outcome: o } : {}))(outcomeOf(p)),
      ...((x) => (x ? { ship: x } : {}))(shipOf(p)),
      ...((x) => (x ? { tried: x } : {}))(triedOf(p)),
      ...((x) => (x ? { back: x } : {}))(backOf(p)),
    });
  }
  rows.sort((a, b) => b.at - a.at);
  const note = settings?.everywhere?.agents?.feedback_note;
  // the count: what waits under Found, and each fix on this machine the person hasn't tried yet (no push: slice 6)
  const waiting = rows.filter((r) => r.section === "found" || (r.section === "filed" && r.ship?.here && !r.tried)).length;
  return { rows, found: waiting, off: settings?.everywhere?.agents?.feedback === false,
    ...(typeof note === "string" && note.trim() ? { note: note.trim().slice(0, 300) } : {}) };
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
    private settings: () => any = settingsNow, private on: () => boolean = () => pluginOn("feedback"),
    private installed = () => join(process.env.SHEPHERDR_SHARE || join(import.meta.dir, ".."), "installed.json")) {}

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

  /** the record, what the install said it carries beside it, and the install record (slice 6: a new or rolled-back
   *  build changes what On this machine shows, so its read is fresh within a tick) */
  private stamp() {
    const f = this.file();
    return [f, join(dirname(f), ".feedback-installed.json"), this.installed()].map((p) => {
      try { const s = statSync(p); return `${s.mtimeMs}:${s.size}`; } catch { return "none"; }
    }).join("|");
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

  /** Each followed issue's state on GitHub, read again (herdr-task feedback --track, read only; it reads each at most
   *  once an hour): only while the plugin is on and something is followed. -> whether it ran */
  async track(): Promise<boolean> {
    if (!this.on()) return false;
    if (this.last === null) await this.read();
    if (!(this.last ?? []).some((p) => followed(p, this.settings()))) return false;
    await this.run(["--track", "--json"]);
    if (this.reading) await this.reading;
    await this.read();
    return true;
  }

  /** One of the person's calls from the page: report (the box), later, no, undo, follow. -> {ok, ...} or {ok: false, error} */
  async act(b: any): Promise<{ ok: boolean; error?: string; off?: boolean; key?: string; changed?: boolean; filed?: boolean }> {
    if (!this.on()) return { ok: false, error: "Feedback is switched off in Settings › Plugins." };
    let args: string[];
    try { args = argsOf(b); } catch (e) { return { ok: false, error: (e as Error).message }; }
    const r = await this.run(args);
    const out = answer(r.stdout);
    // a poll that started before the call can't answer for it: wait for it, then read again
    if (this.reading) await this.reading;
    await this.read();
    if (r.code !== 0 || !out || out.error) return { ok: false, error: out?.error || r.stderr.trim().split("\n").pop() || "That didn't work." };
    // Post it (slice 4): the yes is kept, or was already (a second tap, another device): either way the chat is told
    if (b.do === "approve") return out.approved === b.rev ? { ok: true, key: out.key, changed: out.changed } : { ok: false, error: NO_POST[out.why] ?? NO_POST.changed };
    // Check again: found on GitHub (filed), or still not known (and never posted again)
    if (b.do === "reconcile") return out.filed ? { ok: true, key: out.key, filed: true } : { ok: false, error: out.why === "unsure" ? STILL_UNSURE : "Nothing to look for: the list shows it as it is now." };
    // a decision already made (another device, a list that was old): said as it is, no Undo that would reverse theirs
    if (b.do !== "report" && b.do !== "works" && b.do !== "broken" && out.changed === false) return { ok: false, error: "That was already decided: the list shows it as it is now." };
    if ((b.do === "works" || b.do === "broken") && out.changed === false) return { ok: false, error: NO_TRY[out.why] ?? NO_TRY.said };
    if (b.do === "report" && out.why === "off") return { ok: false, off: true, error: "Feedback offers are off in that space, so nothing was kept. Settings › Agents › Feedback offers turns them on." };
    return { ok: true, key: out.key, changed: out.changed };
  }
}

/** why a Post it wasn't kept (herdr-task feedback_post.refusal's why), as the person reads it */
const NO_POST: Record<string, string> = {
  changed: "The draft changed since you opened it: open File it… again to see the new one.",
  "no-draft": "There's no draft for this one yet: Write it up first.",
  target: "Where it goes changed in Settings: Write it up again for the new place.",
  filed: "It's already filed: the list shows it.",
  following: "It already follows an issue on GitHub.",
  posting: "It's being posted right now.",
  unsure: "It may have been posted already, so it's never posted again: Check on GitHub.",
  declined: "You said no to this one: Undo first.",
  later: "It's put off: Restore it first.",
  off: "Feedback offers are off in its space: nothing is posted from there.",
};
/** why a Works or Still broken wasn't kept (herdr-task feedback_ship.tried's why) */
const NO_TRY: Record<string, string> = {
  said: "Already said: the list shows it.",
  "not-here": "Its fix isn't on this machine yet: nothing to try.",
  back: "It came back already: it waits under Found.",
  off: "Feedback offers are off in its space: nothing more happens to it.",
};
const STILL_UNSURE = "Still not found on GitHub, and it isn't posted again. Check on GitHub: if it isn't there, Never on this row and a new report start over.";
const REV_MAX = 9999;

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
      if (b.action !== undefined && (typeof b.action !== "string" || b.action.length > 40 || !ACTION.test(b.action))) throw new Error("That action isn't one the app knows.");
      const from = typeof b.action === "string" ? ["--action", b.action] : [];
      return ["--person", ...from, "--space", b.space, ...(long ? [`--details=${text}`] : []), "--json", "--", text];
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
    case "approve": {
      // Post it (slice 4): the person's yes to the one revision File it… showed; the post is the Assistant's
      if (!Number.isInteger(b.rev) || b.rev < 1 || b.rev > REV_MAX) throw new Error(NO_POST.changed);
      return ["--key", key(), "--approve", String(b.rev), "--json"];
    }
    // Check again on a post that may have gone out: herdr-task reads GitHub for its hidden line, and posts nothing
    case "reconcile": return ["--key", key(), "--reconcile", "--json"];
    // the person's Works and Still broken (slice 6): kept for the build installed now; Still broken drafts a comment
    case "works": return ["--key", key(), "--works", "--json"];
    case "broken": return ["--key", key(), "--broken", "--json"];
  }
  throw new Error("Shepherdr can't do that yet.");
}

/** this service's one (main.ts starts it while the plugin is on; actions.ts runs the page's calls) */
export const feedback = new Feedback();
