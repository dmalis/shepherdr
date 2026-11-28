// Needs you 4/6, exact links (dmalis/shepherdr; the design: fork/specs/needs-you.md). What the service remembers about
// its alerts, on disk (alerted.json, owner-only, in the service's folder), so a restart or a reconnect never sends one
// again and a late tap can say what came of it:
// - sent: every alert as last made (service/push.ts alertsOf), written before any of them is sent. One that went away
//   stays 10 minutes more, so an alert that blinks out and back (a card read again, a machine's link coming back) is
//   the same alert, not a new one. One about a new round of the same thing (a task Ready again) names a new action.
// - actions: each of the person's open actions (web/shared/attention.ts) and, once it closed, how: answered (the person
//   answered its card, wrote in its chat or accepted its task, anywhere in Shepherdr) or moved on by itself. Kept 7 days.
// An alert sent goes one way to each device: to its app on screen as a notice of its own (eventOf, over the page's
// socket), else as a push.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import type { Attention } from "../web/shared/attention.ts";
import type { Outcome } from "../web/shared/action-link.ts";
import type { AlertEvent } from "../web/shared/types.ts";

/** an alert gone this long is gone: a new one under its key is new */
export const GONE_GRACE_MS = 10 * 60_000;
/** a closed action's outcome is kept this long, at most this many */
export const KEEP_MS = 7 * 24 * 3600_000;
export const KEEP_MAX = 500;
/** an action away this long is closed */
export const CLOSE_AFTER_MS = 20_000;

/** what is kept of an alert: whether it was quiet (muted, its machine out of reach) or sent, its action, and since when
 *  it is gone (none: made now) */
export type Kept = { action?: string; muted?: true; stale?: true; sent?: true; gone?: number };
/** an action of the person's: what it was, since when this service knows it, and, once gone, since when and how */
type Rec = { what: string; kind?: string; task?: string; place?: string; chat?: string; card: string | null; seen: number; missing?: number; closed?: number; outcome?: Outcome["outcome"] };
type File = { v: 1; sent: Record<string, Kept>; actions: Record<string, Rec>; touched: Record<string, number> };

/** a made alert as push.ts alertsOf has it (only what is kept) */
type Made = { action?: string; muted?: true; stale?: true; sent?: true };

export class AlertLedger {
  private sent = new Map<string, Kept>();
  private actions = new Map<string, Rec>();
  /** a chat or a task the person acted on, and when (an answer, a message, an accept) */
  private touched = new Map<string, number>();
  /** read from disk: false on the very first run (nothing is new then: what waits was there before) */
  readonly known: boolean;
  /** made once this run: from then on, what is new is new */
  private primed = false;
  private dirty = false;

  constructor(private file = join(DATA, "alerted.json"), private clock: () => number = Date.now) {
    let f: Partial<File> | null = null;
    try { f = JSON.parse(readFileSync(this.file, "utf8")); } catch {}
    this.known = !!f && f.v === 1;
    if (!this.known) return;
    // one already gone keeps its time; one open at the stop is open until the first snapshot says otherwise
    for (const [k, v] of Object.entries(f!.sent ?? {})) if (v && typeof v === "object") this.sent.set(k, v);
    for (const [k, v] of Object.entries(f!.actions ?? {})) if (v && typeof v === "object" && typeof v.seen === "number") this.actions.set(k, v);
    for (const [k, v] of Object.entries(f!.touched ?? {})) if (typeof v === "number") this.touched.set(k, v);
  }

  /** the alerts before this snapshot's, as push.ts pushChanges and the bell compare: the ones made last (or kept from
   *  before a restart) and the ones gone less than 10 minutes, or longer while their action isn't known to be closed (a
   *  machine away for long, read again with the same question: not new), less any whose key now names another action
   *  (a new round). null: the first run ever, nothing is new. */
  prior(now: Map<string, Made>): Map<string, Kept> | null {
    if (!this.known && !this.primed) return null;
    const out = new Map<string, Kept>();
    for (const [k, v] of this.sent) {
      if (this.expired(v)) continue;
      const a = now.get(k)?.action;
      if (a && v.action && a !== v.action) continue;
      out.set(k, v);
    }
    return out;
  }

  /** the alerts made now, kept (before any is sent): each with what pushChanges set on it; one gone since keeps
   *  10 minutes */
  keep(now: Map<string, Made>) {
    const at = this.clock();
    for (const [k, v] of this.sent) if (!now.has(k)) {
      if (!v.gone) { this.sent.set(k, { ...v, gone: at }); this.dirty = true; }
      else if (this.expired(v)) { this.sent.delete(k); this.dirty = true; }
    }
    for (const [k, a] of now) {
      const v: Kept = { ...(a.action ? { action: a.action } : {}), ...(a.muted ? { muted: true as const } : {}), ...(a.stale ? { stale: true as const } : {}), ...(a.sent ? { sent: true as const } : {}) };
      const was = this.sent.get(k);
      if (!was || was.gone || was.action !== v.action || !!was.muted !== !!v.muted || !!was.stale !== !!v.stale || !!was.sent !== !!v.sent) { this.sent.set(k, v); this.dirty = true; }
    }
    if (!this.known && !this.primed) this.dirty = true;
    this.primed = true;
  }

  /** an alert gone 10 minutes is gone, unless its action is still open: not seen closed (its machine away) */
  private expired(v: Kept) {
    if (!v.gone || this.clock() - v.gone < GONE_GRACE_MS) return false;
    const r = v.action ? this.actions.get(v.action) : undefined;
    return !r || !!r.missing || !!r.closed;
  }

  /** alerts made but not kept (the file couldn't be written): none of them went, so they are new next time */
  unsend(keys: string[]) {
    for (const k of keys) this.sent.delete(k);
    this.dirty = true;
  }

  /** the person acted on a chat or a task (POST /api/action: an answer, a message, an accept), or on one card of a
   *  chat (`<chat>#<card>`: its answer, its secret filled in) */
  touch(keys: (string | null | undefined)[]) {
    const at = this.clock();
    for (const k of keys) if (k) { this.touched.set(k, at); this.dirty = true; }
  }

  /** the open actions now: a new one is kept; one no longer open is missing from now, and closed once it stays away
   *  20 seconds (a snapshot read while machines are still coming back can lack it a moment). How it ended is judged as
   *  it goes: answered if the person acted on its chat or task since it was first seen, else moved on. A machine that
   *  can't be read keeps its actions (Needs you 5/6's keepLast), so they don't close. */
  track(att: Attention, away: (r: { task?: string; place?: string }) => boolean = () => false) {
    const at = this.clock();
    const open = new Set<string>();
    for (const a of att.actions) {
      if (a.owner !== "you") continue;
      open.add(a.id);
      const was = this.actions.get(a.id);
      const rec: Rec = { what: a.what, kind: a.kind, ...(a.task ? { task: a.task } : {}), ...(a.place ? { place: a.place } : {}), ...(a.chat ? { chat: a.chat } : {}), card: a.card, seen: was && !was.closed ? was.seen : at };
      if (!was || was.closed || was.missing || was.what !== rec.what || was.card !== rec.card || was.chat !== rec.chat) { this.actions.set(a.id, rec); this.dirty = true; }
    }
    for (const [id, r] of this.actions) {
      if (r.closed || open.has(id)) continue;
      if (!r.missing) {
        // its machine can't say now (away, still coming back): not gone, only unread
        if (away(r)) continue;
        // a card (a question, a permission) was answered on it, or by a message or keys in its chat; anything else of a
        // task's by its chat or the task itself (an accept, a resume)
        const card = r.kind === "prompt" || r.kind === "question";
        const keys = card ? [r.chat && r.card ? `${r.chat}#${r.card}` : null, r.chat] : [r.chat, r.task];
        const acted = keys.some((k) => k && (this.touched.get(k) ?? 0) >= r.seen);
        this.actions.set(id, { ...r, missing: at, outcome: acted ? "answered" : "moved" });
      } else if (at - r.missing >= CLOSE_AFTER_MS) this.actions.set(id, { ...r, closed: r.missing });
      else continue;
      this.dirty = true;
    }
    // closed ones older than a week, the oldest past 500, and touches older than a week: gone
    const closed = [...this.actions].filter(([, r]) => r.closed).sort((x, y) => y[1].closed! - x[1].closed!);
    for (const [i, [id, r]] of closed.entries()) if (i >= KEEP_MAX || at - r.closed! > KEEP_MS) { this.actions.delete(id); this.dirty = true; }
    for (const [k, t] of this.touched) if (at - t > KEEP_MS) { this.touched.delete(k); this.dirty = true; }
  }

  /** how an action ended (GET /api/outcome), from the moment it went: null while it is open, or unknown */
  outcome(id: string): Outcome | null {
    const r = this.actions.get(id);
    const at = r?.closed ?? r?.missing;
    if (!r || !at || !r.outcome) return null;
    return { id, outcome: r.outcome, at, what: r.what, ...(r.task ? { task: r.task } : {}), ...(r.place ? { place: r.place } : {}), ...(r.chat ? { chat: r.chat } : {}), card: r.card };
  }

  /** written only when something changed. False: it couldn't be; nothing may be sent then (it would go again) */
  save(): boolean {
    if (!this.dirty) return true;
    const f: File = { v: 1, sent: Object.fromEntries(this.sent), actions: Object.fromEntries(this.actions), touched: Object.fromEntries(this.touched) };
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(f), { mode: 0o600 });
      renameSync(tmp, this.file);
      this.dirty = false;
      return true;
    } catch (err) {
      console.error(`alerts: couldn't keep what was sent: ${(err as Error).message}`);
      return false;
    }
  }
}

/** an alert sent, as the app on screen says it (its words uncut): its key, its action, its link, and whether it stays
 *  until closed (an agent's own alert, #1561: a guard's approval code must reach the person) */
export function eventOf(key: string, a: { title: string; body: string; topic?: string; url?: string; place?: string; action?: string; full?: { title: string; body: string } }, at = Date.now()): AlertEvent {
  const task = taskOfUrl(a.url);
  return { key, ...(a.action ? { action: a.action } : {}), at, title: a.full?.title ?? a.title, body: a.full?.body ?? a.body, topic: String(a.topic ?? ""),
    ...(a.url ? { url: a.url } : {}), ...(a.place ? { place: a.place } : {}), ...(task ? { task } : {}), ...(key.startsWith("alert:") ? { sticky: true as const } : {}) };
}

/** an alert link's task (none: a space's chat, found by its space) */
function taskOfUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(url, "http://x/").searchParams.get("task") ?? undefined; } catch { return undefined; }
}
