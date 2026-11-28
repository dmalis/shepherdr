// The alerts list (the bell, web/plugins/inbox): one record of each push alert the service made, newest first, so an
// alert that is gone from a phone, or never reached a device, still has a trace. Slack's Activity, Linear's Inbox and
// GitHub's notifications are the pattern: unread until opened or marked read, and kept here, on the machine that sends
// the alerts, so reading one on the phone reads it on the Mac too. Kept 7 days, at most 200, in inbox.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./paths.ts";
import type { InboxItem } from "../web/shared/types.ts";

export const KEEP_MS = 7 * 24 * 3600_000;
export const KEEP_MAX = 200;

/** what an alert (service/push.ts alertsOf) gives its record */
export type Made = { title: string; body: string; tag: string; topic: string; place?: string; url?: string; waits?: true; action?: string; full?: { title: string; body: string } };

/** the task an alert opens: its link's task= */
function taskOf(url: string | undefined) {
  if (!url) return undefined;
  try { return new URL(url, "http://x/").searchParams.get("task") ?? undefined; } catch { return undefined; }
}

export class Inbox {
  private items: InboxItem[] = [];
  /** told when the list changed (the snapshot is built again) */
  onChange: (() => void) | null = null;

  constructor(private file = join(DATA, "inbox.json"), private clock = () => Date.now()) {
    try {
      const v = JSON.parse(readFileSync(this.file, "utf8"));
      if (Array.isArray(v)) this.items = v.filter((x) => x && typeof x.id === "string" && typeof x.at === "number");
    } catch {}
    this.prune();
  }

  private save() { try { writeFileSync(this.file, JSON.stringify(this.items), { mode: 0o600 }); } catch {} }

  /** older than 7 days, or past the newest 200: gone */
  private prune() {
    const since = this.clock() - KEEP_MS;
    const kept = this.items.filter((x) => x.at >= since).slice(0, KEEP_MAX);
    const changed = kept.length !== this.items.length;
    this.items = kept;
    return changed;
  }

  /** The alerts made now (before: the last ones, null when the service just started and nothing is new). A new alert
   *  is a new record on top, with its own id (a task Ready again is a new unread row; the one it resolved stays); an
   *  Assistant's new message takes its chat's last one's place, as its push does on a phone. One that waited on you is
   *  marked resolved once it no longer does, unless held says its machine can't be asked (it stays open until then). */
  record(before: Map<string, Made> | null, now: Map<string, Made>, held: (x: InboxItem) => boolean = () => false): boolean {
    let changed = this.prune();
    const at = this.clock();
    if (before) for (const [id, a] of now) {
      // fork Needs you 4/6: the same key about another action (a new round) is new
      if (before.has(id) && (!a.action || !before.get(id)!.action || before.get(id)!.action === a.action)) continue;
      // still open from before (its machine was away a moment): the same alert, not a new one. fork Needs you 4/6: one
      // about another action under the same key (a task Ready again) closes the old row, and is a new one
      const open = this.items.find((x) => (x.key ?? x.id) === id && x.waits && !x.closed);
      if (open && (!open.action || !a.action || open.action === a.action)) continue;
      if (open) open.closed = at;
      const task = taskOf(a.url);
      if (a.topic === "assistant") this.items = this.items.filter((x) => !(x.topic === "assistant" && x.tag === a.tag));
      let row = `${id}@${at}`;
      for (let n = 2; this.items.some((x) => x.id === row); n++) row = `${id}@${at}.${n}`;
      this.items.unshift({ id: row, key: id, at, title: a.full?.title ?? a.title, body: a.full?.body ?? a.body, topic: a.topic, tag: a.tag, ...(a.place ? { place: a.place } : {}), ...(task ? { task } : {}),
        ...(a.url ? { url: a.url } : {}), ...(a.waits ? { waits: true as const } : {}), ...(a.action ? { action: a.action } : {}) });
      changed = true;
    }
    for (const x of this.items) {
      if (!x.waits || x.closed) continue;
      if (now.has(x.key ?? x.id) || held(x)) continue;
      x.closed = at;
      changed = true;
    }
    if (this.items.length > KEEP_MAX) this.items = this.items.slice(0, KEEP_MAX);
    if (changed) this.save();
    return changed;
  }

  /** read on any device: these, or every one */
  read(ids: string[] | "all"): boolean {
    let changed = false;
    for (const x of this.items) if (!x.read && (ids === "all" || ids.includes(x.id))) { x.read = true; changed = true; }
    if (changed) { this.save(); this.onChange?.(); }
    return changed;
  }

  /** newest first, for the snapshot */
  list(): InboxItem[] { return this.items; }

  unread() { return this.items.filter((x) => !x.read).length; }
}
