// Triage, the issue loop (dmalis/shepherdr#235, fork/specs/issue-loop.md): the service's part. The engine is
// herdr-task's (mods/tasks/bin/herdr_task/triage*.py); here are only what must come from the person's signed-in app:
//
// - **The app's yes** (`<store>/.triage-yes.json`): written only here, from the person's own call on the Feedback page
//   (Post it on a row whose repo Triage files). It names the finding, its draft's revision and the hash of the exact
//   text the person read. No herdr-task command writes it, and a yes in chat (`--by chat`) doesn't count.
// - **The fence** read back: once Triage files a repo (`.triage.json`, `repos[<repo>].fenced`), the Feedback page's
//   calls that would post another machine's row refuse ("Triage files this repo's findings").
// - **The publisher's tick:** `herdr-task triage publish` at most every 10 minutes while the plugin is on, with the
//   other machines' lists the Feedback page read (one publisher machine: this one).
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { where } from "./paths.ts";
import { pluginOn } from "./next.ts";
import { readSettings } from "./settings.ts";
import { spawn } from "./spawn.ts";

export const FENCED = "Triage files this repo's findings";
const UPSTREAM = "eliasstravik/shepherdr";
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const KEY = /^[0-9A-Za-z_-]{1,80}$/;
const YES_KEPT = 200;
export const PUBLISH_EVERY = 10 * 60_000;

const store = () => process.env.HERDR_TASK_STORE || where().tasks;
const readJson = (path: string): any => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

/** Everywhere's agents.feedback_repo when it is a valid owner/name that isn't upstream's, else null (fails closed) */
export function destination(settings: any): string | null {
  const raw = settings?.everywhere?.agents?.feedback_repo;
  if (typeof raw !== "string") return null;
  const m = /^(?:https:\/\/github\.com\/)?([^/\s]+\/[^/\s#?]+?)(?:\.git)?\/?$/.exec(raw.trim());
  const repo = m && REPO.test(m[1]) ? m[1] : null;
  return repo && repo.toLowerCase() !== UPSTREAM ? repo : null;
}

/** whether Triage files this repo's findings (its record says it fenced the old posting off). A record that can't be
 *  read counts as yes: the old posting stays fenced rather than post twice. */
export function fenced(repo: string | null, dir = store()): boolean {
  if (!repo) return false;
  const path = join(dir, ".triage.json");
  if (!existsSync(path)) return false;
  const d = readJson(path);
  if (!d || typeof d !== "object") return true;
  return !!d.repos?.[repo.toLowerCase()]?.fenced;
}

/** whether the old posting is fenced off here, whatever its target (herdr-task triage.legacy_fenced): Triage is on for
 *  any repo in the settings file (kept in step on every machine, sync.ts), or its record fenced one. Once Triage files
 *  findings the old way never posts again, so clearing or changing agents.feedback_repo can't reopen it (to upstream's
 *  fallback either). An unreadable record counts as fenced. */
export function legacyFenced(settings: any, dir = store()): boolean {
  const repos = settings?.repos && typeof settings.repos === "object" ? settings.repos : {};
  for (const r of Object.values<any>(repos)) {
    const level = r?.triage?.level;
    if (level != null && level !== "off") return true;
  }
  const path = join(dir, ".triage.json");
  if (!existsSync(path)) return false;
  const d = readJson(path);
  if (!d || typeof d !== "object") return true;
  return Object.values<any>(d.repos ?? {}).some((r) => !!r?.fenced);
}

/** a draft's body as the person reads it: without its hidden marker (herdr-task feedback_post.shown) */
export const shown = (body: unknown) =>
  String(body ?? "").replace(/\n*<!-- shepherdr-feedback [0-9A-Za-z_-]+ rev \d+(?: [0-9a-f]{8,32})? -->\s*$/, "").replace(/\s+$/, "");

/** the hash the yes is bound to (herdr-task triage.yes_hash): the whole target, the title and the body as shown */
export function yesHash(target: any, title: unknown, body: unknown): string {
  const t = target ?? {};
  const s = [String(t.repo ?? "").toLowerCase(), String(t.action ?? ""), String(t.issue ?? ""), String(title ?? ""), String(body ?? "")].join("\n");
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** a draft as it is stored now: this machine's finding (.feedback.json), or Triage's copy of another machine's
 *  (.triage.json copies, keyed "<machine>:<id>") */
function draftOf(dir: string, key: string, copy: boolean): any {
  const rows = copy ? readJson(join(dir, ".triage.json"))?.copies : readJson(join(dir, ".feedback.json"))?.problems;
  const p = rows && typeof rows === "object" ? rows[key] : null;
  return p && typeof p === "object" && p.draft && typeof p.draft === "object" ? p.draft : null;
}

/** one answer row in the app's file, in place of that card's earlier one: owner-only, whole and atomic */
function keepRow(dir: string, row: Record<string, unknown>, same: (y: any) => boolean) {
  const path = join(dir, ".triage-yes.json");
  const old = readJson(path);
  const rows: any[] = Array.isArray(old?.yes) ? old.yes.filter((y: any) => y && typeof y === "object") : [];
  const next = [...rows.filter((y) => !same(y)), row].slice(-YES_KEPT);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ yes: next }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** The person's yes, kept for Triage: the finding's stored draft at this revision, its exact text hashed, when its repo
 *  is one Triage files. Owner-only, whole and atomic; a yes for the same revision again changes nothing.
 *  -> whether a yes is kept now (false: not Triage's to post) */
export function keepYes(key: string, rev: number, dir = store(), settings: any = readSettings(), at = Date.now()): boolean {
  if (!KEY.test(key) || !Number.isInteger(rev) || rev < 1) return false;
  const dr = draftOf(dir, key, false);
  const repo = destination(settings);
  if (!dr || dr.rev !== rev || !repo || String(dr.target?.repo ?? "").toLowerCase() !== repo.toLowerCase() || !fenced(repo, dir)) return false;
  const hash = yesHash(dr.target, dr.title, shown(dr.body));
  const old = readJson(join(dir, ".triage-yes.json"));
  if ((Array.isArray(old?.yes) ? old.yes : []).some((y: any) => y?.kind === "draft" && y.key === key && y.rev === rev && y.hash === hash && (y.answer ?? "yes") === "yes")) return true;
  keepRow(dir, { kind: "draft", repo, key, rev, hash, at, by: "app" }, (y) => y.kind === "draft" && y.key === key);
  return true;
}

/* ---------- the yes cards (Needs you): the person's Yes or No, from the app only ---------- */

const COPY_KEY = /^[\w.-]{1,80}:[0-9A-Za-z_-]{1,80}$/;
export const CHANGED = "The text changed since you read it: read it again.";

/** One card's answer, as the person tapped it on the exact text the card showed (its hash): a held draft (post it, or
 *  keep it private) or an outside issue (start a fix, or not). The text is read again here and hashed as herdr-task
 *  hashes it; a text that changed since keeps nothing (the card asks again). No herdr-task command writes this file.
 *  -> {ok: true} or {ok: false, error, changed?} */
export function answerCard(b: any, dir = store(), settings: any = readSettings(), at = Date.now()): { ok: boolean; error?: string; changed?: boolean } {
  const answer = b?.answer === "yes" ? "yes" : b?.answer === "no" ? "no" : null;
  if (!answer || typeof b?.hash !== "string" || !/^[0-9a-f]{64}$/.test(b.hash)) return { ok: false, error: "That card isn't one Shepherdr knows." };
  const repo = destination(settings);
  if (!repo || !fenced(repo, dir)) return { ok: false, error: "Triage doesn't file this repo's findings now." };
  if (b.kind === "draft") {
    const copy = b.copy === true;
    const key = typeof b.key === "string" && (copy ? COPY_KEY : KEY).test(b.key) ? b.key : null;
    const dr = key ? draftOf(dir, key, copy) : null;
    if (!key || !dr) return { ok: false, error: "That finding isn't here any more." };
    if (String(dr.target?.repo ?? "").toLowerCase() !== repo.toLowerCase()) return { ok: false, error: "Where it goes changed in Settings: nothing was kept." };
    if (dr.rev !== b.rev || yesHash(dr.target, dr.title, shown(dr.body)) !== b.hash) return { ok: false, error: CHANGED, changed: true };
    keepRow(dir, { kind: "draft", repo, key, rev: dr.rev, hash: b.hash, at, by: "app", ...(answer === "no" ? { answer } : {}) }, (y) => y.kind === "draft" && y.key === key);
    return { ok: true };
  }
  if (b.kind === "start") {
    const issue = Number.isInteger(b.issue) && b.issue > 0 ? b.issue : null;
    const ask = issue ? readJson(join(dir, ".triage.json"))?.repos?.[repo.toLowerCase()]?.asks?.[String(issue)] : null;
    if (!issue || !ask || typeof ask !== "object") return { ok: false, error: "That issue doesn't wait for you any more." };
    if (yesHash({ repo, action: "start", issue }, ask.title, ask.body) !== b.hash) return { ok: false, error: CHANGED, changed: true };
    keepRow(dir, { kind: "start", repo, issue, hash: b.hash, at, by: "app", answer }, (y) => y.kind === "start" && y.issue === issue && String(y.repo ?? "").toLowerCase() === repo.toLowerCase());
    return { ok: true };
  }
  return { ok: false, error: "That card isn't one Shepherdr knows." };
}

/** what Settings › Triage and the cards show (web/shared/types.ts TriageView): `herdr-task triage view`, read again
 *  every 2 minutes while the plugin is on and right after the person's own calls. Off: nothing, and nothing read. */
export class TriageView {
  last: TriageViewOf | null = null;
  private reading: Promise<void> | null = null;
  /** the snapshot is built again (main.ts) */
  changed: () => void = () => {};
  constructor(private run: Run = triageRun, private folders: () => string[] = () => [], private on = () => pluginOn("triage")) {}

  read(): Promise<void> {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      const before = JSON.stringify(this.last);
      try {
        if (!this.on()) { this.last = null; return; }
        const r = await this.run(["triage", "view", "--json", ...this.folders().flatMap((f) => ["--folder", f])]);
        let out: any = null;
        try { out = JSON.parse(r.stdout); } catch {}
        if (r.code === 0 && out && typeof out === "object" && !out.error) this.last = viewOf(out);
      } finally {
        this.reading = null;
        if (JSON.stringify(this.last) !== before) this.changed();
      }
    })();
    return this.reading;
  }
}

export type TriageViewOf = import("../web/shared/types.ts").TriageView;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** herdr-task's view as the page gets it: only the fields it shows */
export function viewOf(out: any): TriageViewOf {
  const cards: TriageViewOf["cards"] = [];
  for (const d of Array.isArray(out.drafts) ? out.drafts : []) {
    if (!d || typeof d.key !== "string" || typeof d.hash !== "string") continue;
    cards.push({ id: `draft:${d.copy ? "c" : "f"}:${d.key}`, kind: "draft", key: d.key, copy: !!d.copy, rev: Number(d.rev) || 0, repo: str(d.target?.repo, 140), title: str(d.title, 300), body: str(d.body, 20_000), hash: d.hash, at: Number(d.at) || 0,
      why: str(d.why, 20) || "unknown", ...(Array.isArray(d.found) && d.found.length ? { found: d.found.slice(0, 6).map((x: unknown) => str(x, 80)) } : {}) });
  }
  for (const s of Array.isArray(out.starts) ? out.starts : []) {
    if (!s || !Number.isInteger(s.issue) || typeof s.hash !== "string") continue;
    cards.push({ id: `start:${s.issue}`, kind: "start", issue: s.issue, repo: str(out.files, 140), title: str(s.title, 300), body: str(s.body, 20_000), hash: s.hash, at: Number(s.at) || 0 });
  }
  const repos: TriageViewOf["repos"] = {};
  for (const r of Array.isArray(out.repos) ? out.repos : []) {
    if (!r || typeof r.folder !== "string") continue;
    const s = r.schedule && typeof r.schedule === "object" ? r.schedule : null;
    repos[r.folder] = { repo: typeof r.repo === "string" ? r.repo : null, stopped: typeof r.stopped === "string" ? r.stopped : null,
      schedule: s ? { id: str(s.id, 400), paused: !!s.paused, space: typeof s.space === "string" ? s.space : null, by: typeof s.by === "string" ? s.by : null } : null };
  }
  return { destination: typeof out.destination === "string" ? out.destination : null, files: typeof out.files === "string" ? out.files : null, repos, cards: cards.sort((a, b) => a.at - b.at) };
}

/** the space a repo's Triage schedule runs in, as the service picks it for `triage schedule --space`: of the spaces on
 *  it, one whose folder is the checkout itself, else the first (by id); none: herdr-task finds it (checkout_space) */
export function spaceFor(folder: string, spaces: { id: string; folder?: string; machine?: string | null; repo?: string | null }[]): string | null {
  const on = spaces.filter((s) => !s.machine && (s.repo === folder || s.folder === folder)).sort((a, b) => a.id.localeCompare(b.id));
  return (on.find((s) => s.folder === folder) ?? on[0])?.id ?? null;
}

/** the repo's schedule made to follow its level (`herdr-task triage schedule`): after the person saves the level, and
 *  from the page's Make it when a save couldn't make it. -> {ok} or {ok: false, error} */
export async function followLevel(folder: string, space: string | null, run: Run = triageRun): Promise<{ ok: boolean; error?: string }> {
  if (!folder.startsWith("/")) return { ok: false, error: "Triage works only on this machine's repos for now." };
  const r = await run(["triage", "schedule", "--folder", folder, ...(space ? ["--space", space] : []), "--json"]);
  let out: any = null;
  try { out = JSON.parse(r.stdout); } catch {}
  if (r.code !== 0 || !out || out.error) return { ok: false, error: `Saved, but its schedule wasn't made: ${(out?.error || r.stderr.trim().split("\n").pop() || "herdr-task didn't answer").replace(/^herdr-task: /, "")}` };
  return { ok: true };
}

type Run = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

/** the publisher's tick: `herdr-task triage publish`, with the other machines' lists the Feedback page read */
export class Publisher {
  private last = 0;
  private busy = false;
  constructor(private run: Run, private lists: () => Record<string, unknown[]>, private on = () => pluginOn("triage"),
    private tmp = () => join(store(), ".triage-there.json")) {}

  /** one pass when it's due (every 10 minutes, or now: soon after a yes) -> whether it ran */
  async tick(now = Date.now(), soon = false): Promise<boolean> {
    if (this.busy || !this.on() || (!soon && now - this.last < PUBLISH_EVERY)) return false;
    this.busy = true;
    this.last = now;
    try {
      const there = this.lists();
      const args = ["triage", "publish", "--json"];
      if (Object.keys(there).length) {
        const path = this.tmp();
        writeFileSync(path, JSON.stringify(there), { mode: 0o600 });
        args.splice(2, 0, "--there", path);
      }
      await this.run(args);
      return true;
    } finally {
      this.busy = false;
    }
  }
}

/** herdr-task itself, as the service runs it for Triage (never with an agent's terminal id) */
export const triageRun: Run = async (args) => {
  const env = { ...process.env };
  delete env.HC_TERMINAL_ID;
  delete env.HC_TERMINAL_SOCKET;
  const p = spawn([process.env.SHEPHERDR_HERDR_TASK || "herdr-task", ...args], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const kill = setTimeout(() => p.kill(), 300_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, stdout, stderr };
  } finally { clearTimeout(kill); }
};
