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

/** The person's yes, kept for Triage: the finding's stored draft at this revision, its exact text hashed, when its repo
 *  is one Triage files. Owner-only, whole and atomic; a yes for the same revision again changes nothing.
 *  -> whether a yes is kept now (false: not Triage's to post) */
export function keepYes(key: string, rev: number, dir = store(), settings: any = readSettings(), at = Date.now()): boolean {
  if (!KEY.test(key) || !Number.isInteger(rev) || rev < 1) return false;
  const rec = readJson(join(dir, ".feedback.json"));
  const p = rec?.problems?.[key];
  const dr = p && typeof p.draft === "object" ? p.draft : null;
  const repo = destination(settings);
  if (!dr || dr.rev !== rev || !repo || String(dr.target?.repo ?? "").toLowerCase() !== repo.toLowerCase() || !fenced(repo, dir)) return false;
  const hash = yesHash(dr.target, dr.title, shown(dr.body));
  const path = join(dir, ".triage-yes.json");
  const old = readJson(path);
  const rows: any[] = Array.isArray(old?.yes) ? old.yes.filter((y: any) => y && typeof y === "object") : [];
  if (rows.some((y) => y.kind === "draft" && y.key === key && y.rev === rev && y.hash === hash)) return true;
  const next = [...rows.filter((y) => !(y.kind === "draft" && y.key === key)), { kind: "draft", repo, key, rev, hash, at, by: "app" }].slice(-YES_KEPT);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ yes: next }), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return true;
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
