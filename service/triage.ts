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
const YES_KEPT = 1000; // room for the backlog's batch (a hundred or more answers at once) and every answer in force
/** GitHub's own limits on an issue's title and body: a card carries its text whole up to them */
const TITLE_MAX = 300, BODY_MAX = 65_536;
export const PUBLISH_EVERY = 10 * 60_000;
/** one publisher pass's time (s), well under triageRun's 5-minute limit */
export const PASS_S = 200;

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
function rowOf(dir: string, key: string, copy: boolean): any {
  const rows = copy ? readJson(join(dir, ".triage.json"))?.copies : readJson(join(dir, ".feedback.json"))?.problems;
  const p = rows && typeof rows === "object" ? rows[key] : null;
  return p && typeof p === "object" ? p : null;
}
function draftOf(dir: string, key: string, copy: boolean): any {
  const p = rowOf(dir, key, copy);
  return p?.draft && typeof p.draft === "object" ? p.draft : null;
}

/** whether an answer row still speaks for its card: its draft is there at that revision (a start: its ask is there).
 *  Others are retired, and go first when the file is trimmed, so an answer in force (a No above all) stays.
 *  Both records are read once per trim. */
function inForceOf(dir: string): (y: any) => boolean {
  const tri = readJson(join(dir, ".triage.json")), fb = readJson(join(dir, ".feedback.json"));
  return (y: any) => {
    if (y.kind === "start") return !!tri?.repos?.[String(y.repo ?? "").toLowerCase()]?.asks?.[String(y.issue)];
    const key = String(y.key ?? "");
    const p = (key.includes(":") ? tri?.copies : fb?.problems)?.[key];
    return !!p && typeof p === "object" && p.draft?.rev === y.rev;
  };
}

/** one answer row in the app's file, in place of that card's earlier one: owner-only, whole and atomic */
function keepRow(dir: string, row: Record<string, unknown>, same: (y: any) => boolean) {
  keepRows(dir, [row], (y) => same(y));
}

/** answer rows in the app's file in one write, each in place of its card's earlier one (`same(y, row)`) */
function keepRows(dir: string, add: Record<string, unknown>[], same: (y: any, row: Record<string, unknown>) => boolean) {
  const path = join(dir, ".triage-yes.json");
  const old = readJson(path);
  const rows: any[] = Array.isArray(old?.yes) ? old.yes.filter((y: any) => y && typeof y === "object") : [];
  let next = [...rows.filter((y) => !add.some((row) => same(y, row))), ...add];
  if (next.length > YES_KEPT) {
    const inForce = inForceOf(dir);
    const live = next.filter((y) => add.includes(y) || inForce(y));
    const room = Math.max(0, YES_KEPT - live.length);
    next = [...(room ? next.filter((y) => !live.includes(y)).slice(-room) : []), ...live].slice(-YES_KEPT);
    next.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  }
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
const ANSWERED: Record<string, string> = { yes: "You already said Yes to this text, on another screen.", no: "You already said No to this text, on another screen: it stays private." };

/** the answer already kept for a card's exact text (the newest such row), or null */
function said(dir: string, match: (y: any) => boolean): "yes" | "no" | null {
  const all = readJson(join(dir, ".triage-yes.json"))?.yes;
  const y = (Array.isArray(all) ? all : []).filter((y: any) => y && typeof y === "object" && match(y)).pop();
  return y ? ((y.answer ?? "yes") === "no" ? "no" : "yes") : null;
}

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
    const p = key ? rowOf(dir, key, copy) : null;
    const dr = p?.draft && typeof p.draft === "object" ? p.draft : null;
    if (!key || !dr) return { ok: false, error: "That finding isn't here any more." };
    // only a finding that still waits (herdr-task's eligible): not posted or filed, not decided, its copy not done there
    const post = p.post && typeof p.post === "object" ? p.post : {};
    if (p.there_done || p.joined || ["filed", "declined"].includes(p.state) || ["posted", "posting", "unsure"].includes(post.state) || ["declined", "following"].includes(p.decision))
      return { ok: false, error: "That finding doesn't wait for you any more." };
    if (String(dr.target?.repo ?? "").toLowerCase() !== repo.toLowerCase()) return { ok: false, error: "Where it goes changed in Settings: nothing was kept." };
    if (dr.rev !== b.rev || yesHash(dr.target, dr.title, shown(dr.body)) !== b.hash) return { ok: false, error: CHANGED, changed: true };
    // a card is answered once for its text: the same answer again (another device) changes nothing; the other one,
    // from a card left open elsewhere, doesn't overturn it (a Not now or Never since takes the earlier one back)
    const was = said(dir, (y) => y.kind === "draft" && y.key === key && y.rev === dr.rev && y.hash === b.hash && (Number(y.at) || 0) > (Number(p.unyes) || 0));
    if (was) return was === answer ? { ok: true } : { ok: false, error: ANSWERED[was] };
    keepRow(dir, { kind: "draft", repo, key, rev: dr.rev, hash: b.hash, at, by: "app", ...(answer === "no" ? { answer } : {}) }, (y) => y.kind === "draft" && y.key === key);
    return { ok: true };
  }
  if (b.kind === "start") {
    const issue = Number.isInteger(b.issue) && b.issue > 0 ? b.issue : null;
    const ask = issue ? readJson(join(dir, ".triage.json"))?.repos?.[repo.toLowerCase()]?.asks?.[String(issue)] : null;
    if (!issue || !ask || typeof ask !== "object") return { ok: false, error: "That issue doesn't wait for you any more." };
    if (yesHash({ repo, action: "start", issue }, ask.title, ask.body) !== b.hash) return { ok: false, error: CHANGED, changed: true };
    const same = (y: any) => y.kind === "start" && y.issue === issue && String(y.repo ?? "").toLowerCase() === repo.toLowerCase();
    const was = said(dir, (y) => same(y) && y.hash === b.hash);
    if (was) return was === answer ? { ok: true } : { ok: false, error: ANSWERED[was] };
    keepRow(dir, { kind: "start", repo, issue, hash: b.hash, at, by: "app", answer }, same);
    return { ok: true };
  }
  return { ok: false, error: "That card isn't one Shepherdr knows." };
}

/* ---------- the backlog's batch yes (#235, "The backlog"): one Yes for the ticked drafts, from the app only ---------- */

/** the id an item has on the batch card and in its skip list: f:<key> (this machine's finding) or c:<machine:id> */
export const itemId = (x: { key: string; copy: boolean }) => `${x.copy ? "c" : "f"}:${x.key}`;

/** the hash the batch card's yes is bound to: its repo, then every draft it lists (its finding, revision and text's
 *  hash), sorted, so the card the person read is the card answered */
export function batchHash(repo: string, items: { key: string; copy: boolean; rev: number; hash: string }[]): string {
  const lines = items.map((x) => `${itemId(x)} ${x.rev} ${x.hash}`).sort();
  return createHash("sha256").update([repo.toLowerCase(), ...lines].join("\n"), "utf8").digest("hex");
}

/** The person's Yes on the batch card, for every draft it listed but the ones they unticked (`skip`). The card must be
 *  the one the view shows now (its hash; a new or changed draft since makes it ask again), so a draft the privacy check
 *  held back is never in it. Each ticked draft is read again and must still wait at the revision and text the card
 *  showed; one that changed drops out and waits again. Each yes kept names its revision, its text's hash and the batch's
 *  hash, so a draft changed after the yes no longer has it. No herdr-task command writes this file.
 *  -> {ok: true, kept, changed} or {ok: false, error, changed?} */
export function answerBatch(b: any, view: TriageViewOf | null, dir = store(), settings: any = readSettings(), at = Date.now()): { ok: boolean; error?: string; changed?: boolean | number; kept?: number } {
  if (b?.answer !== "yes" || typeof b?.hash !== "string" || !/^[0-9a-f]{64}$/.test(b.hash)) return { ok: false, error: "That card isn't one Shepherdr knows." };
  const repo = destination(settings);
  if (!repo || !fenced(repo, dir)) return { ok: false, error: "Triage doesn't file this repo's findings now." };
  const card = view?.cards.find((c) => c.kind === "batch");
  if (!card?.items?.length || card.repo.toLowerCase() !== repo.toLowerCase()) return { ok: false, error: "No findings wait in a batch now." };
  if (card.hash !== b.hash || batchHash(card.repo, card.items) !== b.hash) return { ok: false, error: "The list changed since you opened it: look again.", changed: true };
  const skip = new Set(Array.isArray(b.skip) ? b.skip.filter((x: unknown) => typeof x === "string") : []);
  const ticked = card.items.filter((x) => !skip.has(itemId(x)));
  if (!ticked.length) return { ok: false, error: "Nothing is ticked, so nothing was posted." };
  const tri = readJson(join(dir, ".triage.json")), fb = readJson(join(dir, ".feedback.json"));
  const old = readJson(join(dir, ".triage-yes.json"));
  const answers: any[] = Array.isArray(old?.yes) ? old.yes.filter((y: any) => y && typeof y === "object") : [];
  const rows: Record<string, unknown>[] = [];
  let changed = 0;
  for (const x of ticked) {
    if (!(x.copy ? COPY_KEY : KEY).test(x.key)) { changed++; continue; }
    const p = (x.copy ? tri?.copies : fb?.problems)?.[x.key];
    const dr = p?.draft && typeof p.draft === "object" ? p.draft : null;
    const post = p?.post && typeof p.post === "object" ? p.post : {};
    // still waiting, still a new issue in this repo, at the revision and text the card showed
    if (!dr || p.there_done || p.joined || ["filed", "declined"].includes(p.state) || ["posted", "posting", "unsure"].includes(post.state) || ["declined", "following"].includes(p.decision)
      || dr.target?.action !== "create" || String(dr.target?.repo ?? "").toLowerCase() !== repo.toLowerCase()
      || dr.rev !== x.rev || yesHash(dr.target, dr.title, shown(dr.body)) !== x.hash) { changed++; continue; }
    // answered already for this very text (No on another screen stays No; Yes again changes nothing)
    const was = answers.filter((y) => y.kind === "draft" && y.key === x.key && y.rev === x.rev && y.hash === x.hash && (Number(y.at) || 0) > (Number(p.unyes) || 0)).pop();
    if (was) { if ((was.answer ?? "yes") !== "yes") changed++; continue; }
    rows.push({ kind: "draft", repo, key: x.key, rev: x.rev, hash: x.hash, at, by: "app", batch: b.hash });
  }
  if (rows.length) keepRows(dir, rows, (y, row) => y.kind === "draft" && y.key === row.key);
  return { ok: true, kept: rows.length, changed };
}

/** what Settings › Triage and the cards show (web/shared/types.ts TriageView): `herdr-task triage view`, read again
 *  every 2 minutes while the plugin is on and right after the person's own calls. Off: nothing, and nothing read. */
export class TriageView {
  last: TriageViewOf | null = null;
  private reading: Promise<void> | null = null;
  /** the snapshot is built again (main.ts) */
  changed: () => void = () => {};
  constructor(private run: Run = triageRun, private folders: () => string[] = () => [], private on = () => pluginOn("triage")) {}

  private again = false;

  /** a read now; one asked for while another runs (after a call that changed something) follows it, never lost */
  read(): Promise<void> {
    if (!this.on()) {
      // off: nothing kept and nothing read, and no promise held (switched on again, the next call reads)
      if (this.last !== null) { this.last = null; this.changed(); }
      return Promise.resolve();
    }
    if (this.reading) { this.again = true; return this.reading; } // its loop reads once more before it settles
    const go = async () => {
      const before = JSON.stringify(this.last);
      try {
        const r = await this.run(["triage", "view", "--json", ...this.folders().flatMap((f) => ["--folder", f])]);
        let out: any = null;
        try { out = JSON.parse(r.stdout); } catch {}
        if (!this.on()) this.last = null;
        else if (r.code === 0 && out && typeof out === "object" && !out.error) this.last = viewOf(out);
      } finally {
        if (JSON.stringify(this.last) !== before) this.changed();
      }
    };
    const p = (async () => {
      do { this.again = false; await go(); } while (this.again && this.on());
    })().finally(() => { this.reading = null; });
    this.reading = p;
    return p;
  }
}

export type TriageViewOf = import("../web/shared/types.ts").TriageView;
type TriageBatchItem = import("../web/shared/types.ts").TriageBatchItem;
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** herdr-task's view as the page gets it: only the fields it shows */
export function viewOf(out: any): TriageViewOf {
  const cards: TriageViewOf["cards"] = [];
  const batch: TriageBatchItem[] = [];
  // the card's Yes is bound to what it shows: the words it carries must hash to the card's hash (else, cut, No only)
  for (const d of Array.isArray(out.drafts) ? out.drafts : []) {
    if (!d || typeof d.key !== "string" || typeof d.hash !== "string") continue;
    const t = d.target && typeof d.target === "object" ? d.target : {};
    const action = t.action === "comment" ? "comment" : "create";
    const issue = action === "comment" && Number.isInteger(t.issue) && t.issue > 0 ? t.issue : undefined;
    if (action === "comment" && !issue) continue; // a comment with nowhere to go: never asked
    const title = str(d.title, TITLE_MAX), body = str(d.body, BODY_MAX);
    // the backlog's batch (#235): a new issue whose words passed the privacy check, carried whole, goes in the one
    // batch card instead of a card of its own; everything else keeps its own card
    if (d.batch === true && action === "create" && !d.found && yesHash(t, title, body) === d.hash && Number.isInteger(d.rev) && d.rev > 0) {
      batch.push({ key: d.key, copy: !!d.copy, rev: d.rev, hash: d.hash, title, body, kind: typeof d.kind === "string" ? str(d.kind, 20) : null, at: Number(d.at) || 0 });
      continue;
    }
    cards.push({ id: `draft:${d.copy ? "c" : "f"}:${d.key}`, kind: "draft", key: d.key, copy: !!d.copy, rev: Number(d.rev) || 0, repo: str(t.repo, 140), action, ...(issue ? { issue } : {}),
      title, body, hash: d.hash, ...(yesHash(t, title, body) === d.hash ? {} : { cut: true }), at: Number(d.at) || 0,
      why: str(d.why, 20) || "unknown", ...(Array.isArray(d.found) && d.found.length ? { found: d.found.slice(0, 6).map((x: unknown) => str(x, 80)) } : {}) });
  }
  for (const s of Array.isArray(out.starts) ? out.starts : []) {
    if (!s || !Number.isInteger(s.issue) || typeof s.hash !== "string") continue;
    const repo = str(out.files, 140), title = str(s.title, TITLE_MAX), body = str(s.body, BODY_MAX);
    cards.push({ id: `start:${s.issue}`, kind: "start", issue: s.issue, repo, title, body, hash: s.hash,
      ...(yesHash({ repo, action: "start", issue: s.issue }, title, body) === s.hash ? {} : { cut: true }), at: Number(s.at) || 0 });
  }
  // the batch card: every draft that can go in one Yes (the drafts it can't hold keep their own cards)
  const files = typeof out.files === "string" ? str(out.files, 140) : "";
  if (files && batch.length) {
    batch.sort((a, b) => a.at - b.at);
    const n = batch.length;
    cards.push({ id: "batch", kind: "batch", repo: files, title: `${n} finding${n === 1 ? "" : "s"}, each a new issue`, body: "",
      hash: batchHash(files, batch), items: batch, at: batch[0]!.at });
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

/** why Triage can't be switched on (or its schedule made) for this folder, or null: it must be one of this machine's
 *  repos the page lists, read by Triage's view, a checkout of the repo findings go to. Checked before anything is
 *  saved, so a plain folder or another repo never gets a level (which would fence off the old posting for nothing). */
export function triageWhy(folder: string, folders: string[], view: TriageViewOf | null): string | null {
  if (!folder.startsWith("/") || !folders.includes(folder)) return "Triage works only on this machine's repos for now.";
  const r = view?.repos[folder];
  if (!view || !r) return "Triage is still reading this repo: try again in a moment.";
  if (!view.destination) return "Findings have nowhere to go yet: set agents.feedback_repo in the settings file.";
  if (!r.repo) return "This folder has no GitHub remote (origin): Triage works on a GitHub repo.";
  if (r.repo.toLowerCase() !== view.destination.toLowerCase()) return `Triage files and scores only in ${view.destination} for now, and this repo isn’t it.`;
  return null;
}

/** the repo's schedule made to follow its level (`herdr-task triage schedule`): after the person saves the level, and
 *  from the page's Make it when a save couldn't make it. Its space is herdr-task's pick (triage.checkout_space), the
 *  same as a plain terminal's. -> {ok} or {ok: false, error} */
export async function followLevel(folder: string, run: Run = triageRun): Promise<{ ok: boolean; error?: string }> {
  if (!folder.startsWith("/")) return { ok: false, error: "Triage works only on this machine's repos for now." };
  const r = await run(["triage", "schedule", "--folder", folder, "--json"]);
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
    if (this.busy && soon) this.again = true; // a yes during a pass: the next tick runs another, never waits 10 minutes
    if (this.busy || !this.on() || (!soon && now - this.last < PUBLISH_EVERY)) return false;
    this.busy = true;
    this.again = false;
    this.last = now;
    try {
      const there = this.lists();
      // a pass ends within its time, under the call's own limit (triageRun's 5 minutes): a batch's rest waits for the
      // next one, a minute on (`more`)
      const args = ["triage", "publish", "--for", String(PASS_S), "--json"];
      if (Object.keys(there).length) {
        const path = this.tmp();
        writeFileSync(path, JSON.stringify(there), { mode: 0o600 });
        args.splice(2, 0, "--there", path);
      }
      const r = await this.run(args);
      let out: any = null;
      try { out = JSON.parse(r.stdout); } catch {}
      if (out?.more === true) this.again = true;
      return true;
    } finally {
      this.busy = false;
      if (this.again) this.last = 0;
    }
  }
  private again = false;
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
