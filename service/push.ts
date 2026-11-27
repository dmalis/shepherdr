// Push alerts to phones and browsers that asked for them (2.1's alerts: the service worker web/public/sw.js shows
// them). Web Push with nothing but WebCrypto: a VAPID key pair kept owner-only in the service's folder (vapid.json), each
// alert encrypted for its subscription (RFC 8291, aes128gcm) and signed (RFC 8292, ES256). Subscriptions are kept in
// push.json. A device whose app is on screen gets none (the page says so over its socket).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, where } from "./paths.ts";
import * as T from "../core/toasts.js";
import { alertUrl, ACCEPT, RESTART_ALL, choiceButtons, DEFAULT_TOPICS, notifies, notifyOf, pushTopics, REPLY, taskWho, WATCH_BODY, WATCH_TITLE, watchTitle, type PushAction, type PushTopic } from "../web/shared/alerts.ts";
import { readyWords } from "../web/shared/ready-words.ts";
import { fitWho } from "../web/shared/kinds.ts";
import { excerpt } from "../web/shared/excerpt.ts";
import { unread } from "../web/shared/needs-you.ts";
import { PUSH_TTL_S } from "../web/shared/reach.ts";

/** a push alert; its buttons (SHEP-243) and what each does: answer a card, accept a task, reply in its chat */
type Out = {
  title: string; body: string; tag: string; topic: PushTopic; place?: string; waits?: true; url?: string;
  actions?: PushAction[]; answer?: { chat: string; question: string }; accept?: { task: string }; reply?: { chat: string; to?: string };
  /** #1545: Restart all, for the Assistants a restart of their machine left stopped (that alert's id) */
  restart?: { alert: string };
  /** fork #37: its words before the watch's cut, for the alerts list only (never sent) */
  full?: { title: string; body: string };
  /** fork Needs you 3/6: from a space whose alerts are muted (its Notify Off): kept in the bell, sent to no device */
  muted?: true;
};

/**
 * What each push alert says, as the window's toasts (core/toasts.js): an agent that needs you, "Fix login · Needs you" (a task by its title, SHEP-322) or
 * "tt-repo Assistant · Needs you", why under it (an Assistant only by its space's Notify); a task whose agent finished,
 * ready to accept, "Fix login · Finished", a tap opening its Accept card; a task done; an Assistant's new
 * message ("New message").
 * Keyed so each goes once; each with its topic and space, which every device chooses by (Settings › Notifications).
 */
/** a need's alert key: one per card or wait */
export const needKey = (n: any) => `need:${n.chat}:${n.id}`;

/** what a need's alert says (whether it is sent or not: its space's Notify decides), in words that fit a watch */
/** whole (fork #37): its words uncut, as alertsOf cuts them at the end and keeps them for the alerts list */
export function needAlert(snap: any, n: any, whole = false): Out {
  const who = n.task ? taskWho(snap, n.task) : T.assistantWho(snap.places?.find((p: any) => p.id === n.place)?.name);
  const go = alertUrl({ place: n.place, ...(n.task ? { task: n.task } : {}), ...(n.question?.id ? { focus: n.question.id } : {}) });
  // its card's choices as buttons; a question with none a button may send opens the app; no card: a reply
  const buttons = n.question ? choiceButtons(n.question) : [];
  const acts = n.question ? (buttons.length ? { actions: buttons, answer: { chat: n.chat, question: n.question.id } } : {})
    : n.secret || n.hands ? {} : { actions: [REPLY], reply: { chat: n.chat, ...(n.reply ? { to: n.reply } : {}) } };
  const title = T.toastTitle(who, n.question?.queued ? "Asked a question" : T.NEEDS_YOU), body = T.needReason(n);
  return { title: whole ? title : watchTitle(title), body: whole ? body : excerpt(body, WATCH_BODY), tag: n.task ?? n.chat, topic: "needs", place: n.place, waits: true, url: go, ...acts };
}

export function alertsOf(snap: any, said: (chat: string) => string | undefined = () => undefined): Map<string, Out> {
  const now = new Map<string, Out>();
  for (const n of snap.needs ?? []) {
    if (n.assistantFirst) continue;
    // fork Needs you 3/6: a muted space's (Notify Off) stays in the bell, quiet
    const quiet = snap.settings && !notifies(snap, { go: { place: n.place }, task: n.task ? true : undefined });
    now.set(needKey(n), { ...needAlert(snap, n, true), ...(quiet ? { muted: true as const } : {}) });
  }
  // a task ready for the person's Accept (Ready is only that: one Settings merge by itself shows Working meanwhile,
  // core/tasks.js readyWait), the same Accept as the Tasks panel's
  for (const t of snap.tasks ?? []) if (t.status === "ready" && !t.archived)
    now.set(`ready:${t.id}`, { title: T.toastTitle(taskWho(snap, t.id), T.FINISHED), body: t.summary || "Tap to look at it.", tag: t.id, topic: "ready", place: t.place, waits: true, url: alertUrl({ place: t.place, task: t.id }),
      // the card's own button, saying what it does (web/shared/ready-words.ts, dmalis/shepherdr#29): Close, Merge into main
      actions: [{ ...ACCEPT, title: readyWords(t).go }], accept: { task: t.id } });
  // a finished task ("Everything" on a device adds these); a schedule's run that found nothing to do sends none
  // nor one its Merge setting closed with nothing to merge (its line stays in the chat)
  for (const t of snap.tasks ?? []) if (t.status === "done" && !t.archived && t.quiet !== "nothing" && !t.closedAlone)
    now.set(`done:${t.id}`, { title: T.toastTitle(taskWho(snap, t.id), t.merged ? "Done and merged" : "Done"), body: t.summary || "", tag: t.id, topic: "done", place: t.place, url: alertUrl({ place: t.place, task: t.id }) });
  // an Assistant's new message (its chat's last moved on, not yet read), unless its space's Notify is Off. Its topic,
  // "assistant", reaches no device (fork Needs you 3/6, web/shared/reach.ts): it stays in the bell, silent
  for (const p of snap.places ?? []) {
    // unread as everywhere else (web/shared/needs-you.ts: Needs you lists it until read)
    if (!unread(snap, p.chat)) continue;
    const last = Number(snap.last[p.chat]);
    // its question already says so (Needs you)
    if ((snap.needs ?? []).some((n: any) => n.chat === p.chat)) continue;
    const quiet = snap.settings && notifyOf(snap, p.id) === "Off";
    now.set(`msg:${p.chat}:${last}`, { title: T.toastTitle(T.assistantWho(p.name), "New message"), body: said(p.chat) || "Tap to read it.", tag: `msg:${p.chat}`, topic: "assistant", place: p.id, url: alertUrl({ place: p.id }), actions: [REPLY], reply: { chat: p.chat },
      ...(quiet ? { muted: true as const } : {}) });
  }
  // an agent's own alert (herdr-task alert), as its toast: a task's always, an Assistant's by its space's Notify
  // fork Needs you 3/6: a machine's own (memory, a restart, a provider cutting off) is a warning: the bell only
  // (one from a muted space too, kept quiet: its notify is false)
  for (const a of snap.alerts ?? []) now.set(`alert:${a.id}`, { title: a.title, body: a.body, tag: `alert:${a.id}`, topic: a.ops ? "ops" : "needs", ...(a.place ? { place: a.place, url: alertUrl({ place: a.place, task: a.task }) } : {}),
    ...(a.restart ? { actions: [RESTART_ALL], restart: { alert: a.id } } : {}), ...(a.notify ? {} : { muted: true as const }) });
  // fork Needs you 3/6: a schedule whose run failed (its row in Schedules says so, as the glance feed's events): the bell only
  for (const s of schedulesFailed(snap)) now.set(s.key, { title: s.title, body: s.body, tag: s.key, topic: "ops", place: s.place, url: alertUrl({ place: s.place }), ...(s.muted ? { muted: true as const } : {}) });
  // short enough for a watch: its title on one line, its body in two
  for (const a of now.values()) {
    const title = watchTitle(a.title), body = excerpt(a.body, WATCH_BODY);
    if (title !== a.title || body !== a.body) a.full = { title: a.title, body: a.body };
    a.title = title; a.body = body;
  }
  return now;
}

export const waitingTags = (alerts: Map<string, Out>) => [...new Set([...alerts.values()].filter((a) => a.waits).map((a) => a.tag))];

/** Tell devices about new alerts. fork Needs you 3/6: nothing is pushed for one that stopped waiting (no "No longer
 *  waiting"): the next push's open tags, and the app when it opens (/api/waiting), close it on each device. */
export function pushChanges(before: Map<string, Out>, now: Map<string, Out>, badge: number, open = waitingTags(now)) {
  return [...now].filter(([k, a]) => !before.has(k) && !a.muted).map(([, a]) => ({ ...a, badge, open }));
}

/** fork Needs you 3/6: the schedules whose last run failed, as the glance feed's events (glance.ts eventsOf); muted:
 *  their space's Notify is Off */
export function schedulesFailed(snap: any): { key: string; title: string; body: string; place: string; muted?: true }[] {
  const out: { key: string; title: string; body: string; place: string; muted?: true }[] = [];
  const seen = new Set<string>();
  for (const [place, list] of Object.entries((snap.automations ?? {}) as Record<string, any[]>)) for (const a of list ?? []) {
    if (!a?.failed || !a.error) continue;
    const key = `schedule:${a.machine ?? ""}:${a.id ?? a.name}:${a.failed}`;
    const where = a.place ?? place;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: `${a.name} · Schedule failed`, body: String(a.error), place: where, ...(snap.settings && notifyOf(snap, where) === "Off" ? { muted: true as const } : {}) });
  }
  return out;
}

/**
 * The agents' own alerts (`herdr-task alert "<title>" --body "<why>"`: the core label herdr.alert = { id, at, title,
 * body, task?, about? } on the agent's terminal), as the window's toasts say them (lib/inbox.js agentAlerts): "<who> ·
 * <title>" (60 characters at most) over its body (300), the chat it is from, and whether it reaches the person (a
 * task's agent or an alert about a task always; an Assistant's by its space's Notify). chatOf: a terminal's chat key.
 */
export function agentAlerts(terminals: Iterable<any>, snap: any, chatOf: (address: string) => string | null, home: string) {
  const out: { id: string; at: number; title: string; what?: string; body: string; chat?: string; task?: string; place?: string; notify: boolean; ended?: true; machine?: string | null; memory?: true; restart?: true; ops?: true }[] = [];
  const all = [...terminals];
  for (const k of all) {
    let a: any = null;
    try { a = JSON.parse(k?.labels?.["herdr.alert"] ?? "null"); } catch {}
    if (!a?.id) continue;
    const chat = chatOf(k.address) ?? undefined;
    const task = chat?.includes("/") ? snap.tasks?.find((t: any) => t.id === chat.slice(0, chat.lastIndexOf("/"))) : null;
    const coord = !task && chat ? snap.places?.find((p: any) => p.chat === chat) : null;
    // its task's key: the one it names (herdr-task alert --task), else its helper's name's ("<key>-review")
    const key = a.task ?? (task ? null : k.labels?.["herdr.task"] ? (/^([a-z][a-z0-9]*-\d+)/.exec(k.name ?? "")?.[1] ?? "").toUpperCase() : "");
    // SHEP-255: the task it is about, so Tasks shows it on that task's row: its chat's task, else its herdr.task
    // label's (a task's own helper, by its name "<ref>-…" on its machine: a task here is "<ref>", elsewhere "<machine>:<ref>"); none: no task's, Chat and notifications only
    const machineOf = String(k.address ?? "").includes("/") ? String(k.address).slice(0, String(k.address).indexOf("/")) : null;
    const labelled = key ? snap.tasks?.find((t: any) => t.id === (machineOf ? `${machineOf}:${key}` : key)) : null;
    const of = labelled ?? task;
    // SHEP-322: a task's agent by its task's title, never its key
    // #1545: the Assistants a restart of a machine left stopped (herdr-task revive.py cut_alert_pass), from that machine
    const restart = Array.isArray(a.restart) && a.restart.length > 0;
    const who = (of ? taskWho(snap, of.id) : "") || (restart ? String(a.task || "This computer") : k.labels?.["herdr.role"] === "coordinator" || coord ? T.assistantWho(coord?.name) : k.program?.name ?? "Agent");
    const place = of?.place ?? coord?.id;
    const notify = Boolean(a.about || task || k.labels?.["herdr.task"] || !place || notifies(snap, { go: { place } }));
    // SHEP-246: what the glance feed needs to keep only what is still true: its terminal finished, its machine, and a
    // memory guard's alert (herdr-task tick memory_guard: a machine's state, over once memory is back under)
    const ended = k.state !== undefined && k.state !== "live";
    const machine = String(k.address ?? "").includes("/") ? String(k.address).slice(0, String(k.address).indexOf("/")) : null;
    const memory = a.about && /^Memory at \d+%/.test(String(a.title ?? ""));
    out.push({ id: String(a.id), at: Number(a.at) || 0, title: T.clip(fitWho(who, String(a.title ?? ""), 60), 60), what: T.clip(String(a.title ?? ""), 120), body: T.clip(String(a.body ?? ""), 300), ...(chat ? { chat } : {}), ...(of ? { task: of.id } : {}), ...(place ? { place } : {}), notify,
      ...(ended ? { ended: true as const } : {}), ...(machine ? { machine } : {}), ...(memory ? { memory: true as const } : {}), ...(restart ? { restart: true as const } : {}),
      // fork Needs you 3/6: a machine's warning (memory, a restart), the bell only
      ...(memory || restart ? { ops: true as const } : {}) });
  }
  // Assistants here that their model's provider kept cutting off (herdr-task tick's .retries.json), once per cut, as
  // the window's (lib/inbox.js readRetries): "<who> · <why>", "Write to it to carry on, or restart it."
  let rows: Record<string, any> = {};
  try { rows = JSON.parse(readFileSync(join(where(home).tasks, ".retries.json"), "utf8")) ?? {}; } catch {}
  const live = new Map([...all].map((k) => [k.address, k]));
  for (const r of Object.values(rows)) {
    if (r?.role !== "coordinator" || !r.over || !r.reason || r.stale || live.get(r.address)?.state !== "live") continue;
    const chat = chatOf(r.address) ?? undefined;
    const coord = chat ? snap.places?.find((p: any) => p.chat === chat) : null;
    out.push({ id: `provider:${r.address}:${r.cut}`, at: Number(r.at) || 0, title: T.toastTitle(T.assistantWho(coord?.name), String(r.reason)), body: PROVIDER_BODY, ...(chat ? { chat } : {}), ...(coord ? { place: coord.id } : {}), notify: true, ops: true });
  }
  return out;
}
export const PROVIDER_BODY = "Write to it to carry on, or restart it.";

/** a device's subscription: what it is told about (none kept: what it got before it could choose) and the spaces it hears
 *  nothing from */
type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; device?: string; at: number; topics?: PushTopic[]; muted?: string[];
  /** the tailnet device it is on (main.ts deviceFrom): a device whose phone app shows its own alerts gets none (SHEP-246) */
  node?: string;
  /** fork #37 (Settings › Notifications' device list): when its app was last on screen, and its last alert's answer
   *  from its push service (0: not reached) */
  seen?: number; last?: { at: number; status: number } };

/** does a device want this alert: its topic chosen, its space not muted; an alert with no topic (a test) always */
export function wants(s: Pick<Sub, "topics" | "muted">, a: { topic?: string; place?: string }) {
  if (!a.topic) return true;
  if (!pushTopics(s.topics).includes(a.topic as PushTopic)) return false;
  return !(a.place && s.muted?.includes(a.place));
}

const b64u = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const enc = (s: string) => new TextEncoder().encode(s);
// WebCrypto as untyped: its buffer types reject plain Uint8Arrays this file builds byte by byte
const subtle = crypto.subtle as any;

async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

/** RFC 8291: the payload encrypted for one subscription, as the aes128gcm body. */
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const uaKey = await subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const prkKey = await hmac(secret, shared);
  const ikm = await hmac(prkKey, cat(enc("WebPush: info\0"), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return cat(head, asPub, sealed);
}

/** a subscription's endpoint, hashed: what is kept of a removed one (fork #96) */
const hashOf = (endpoint: string) => new Bun.CryptoHasher("sha256").update(endpoint).digest("hex");
/** a device's id in Settings › Notifications' list (fork #37): never its endpoint */
const idOf = (endpoint: string) => hashOf(endpoint).slice(0, 12);

export class Push {
  private subs: Sub[] = [];
  private sending = new Map<string, Promise<number>>();
  private vapid: { publicKey: string; privateJwk: JsonWebKey } | null = null;
  /** endpoints of devices whose app is on screen now (their pages say so) */
  visible = new Set<string>();
  /** a tailnet device whose own app shows the alerts now (the glance feed's native stream, SHEP-246): no web push */
  quiet: (node: string | undefined) => boolean = () => false;
  /** a tailnet device with the app on screen now, whichever of its pages (live.ts looking, SHEP-338): no web push */
  looking: (node: string | undefined) => boolean = () => false;
  /** fork Needs you 3/6: the spaces a tailnet device hears nothing from (muted on all its subscriptions), for its phone
   *  app's glance feed; none when it has no subscription here */
  mutedOn(node: string | null | undefined): string[] {
    const mine = node ? this.subs.filter((s) => s.node === node) : [];
    return mine.length ? (mine[0].muted ?? []).filter((m) => mine.every((s) => s.muted?.includes(m))) : [];
  }

  /** fork #96: the devices removed from another one's list (each its endpoint's sha256, never the endpoint): a page there
   *  that still holds its subscription doesn't sign it up again on its own (alerts/device.ts readNow) */
  private removed: string[] = [];
  private get removedFile() { return this.file.replace(/(\.json)?$/, "-removed.json"); }

  constructor(private subject: () => string, private file = join(DATA, "push.json")) {
    try { this.subs = JSON.parse(readFileSync(this.file, "utf8")); } catch {}
    try { this.removed = JSON.parse(readFileSync(this.removedFile, "utf8")); } catch {}
    try { this.offNodes = JSON.parse(readFileSync(this.offFile, "utf8")); } catch {}
  }

  private save() { writeFileSync(this.file, JSON.stringify(this.subs), { mode: 0o600 }); }

  async key() {
    if (this.vapid) return this.vapid.publicKey;
    const file = join(DATA, "vapid.json");
    if (existsSync(file)) { this.vapid = JSON.parse(readFileSync(file, "utf8")); return this.vapid!.publicKey; }
    const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    this.vapid = { publicKey: b64u(await subtle.exportKey("raw", pair.publicKey)), privateJwk: await subtle.exportKey("jwk", pair.privateKey) };
    writeFileSync(file, JSON.stringify(this.vapid), { mode: 0o600 });
    return this.vapid.publicKey;
  }

  /** a device turned on (or again, with a new subscription: from: the one it had); it keeps what it chose. turnOn
   *  (fork #96): the person turned alerts on there; without it (a page giving back a subscription it holds, any build)
   *  a device removed from another one's list stays off */
  subscribe(sub: any, device?: string, from?: string, node?: string | null, turnOn = false) {
    if (typeof sub?.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || typeof sub?.keys?.p256dh !== "string" || typeof sub?.keys?.auth !== "string") throw new Error("Not a push subscription.");
    if (!turnOn && this.removed.includes(hashOf(sub.endpoint))) throw new Error("This device was removed from the list of devices that get alerts. Turn alerts on here to get them again.");
    const had = this.subs.find((s) => s.endpoint === sub.endpoint) ?? (from ? this.subs.find((s) => s.endpoint === from) : undefined);
    const chose = had ? { topics: pushTopics(had.topics), ...(had.muted?.length ? { muted: had.muted } : {}) } : { topics: [...DEFAULT_TOPICS] };
    this.keepRemoved(this.removed.filter((h) => h !== hashOf(sub.endpoint)));
    // fork Needs you 3/6: alerts on there again
    const on = node ?? had?.node;
    if (on) this.keepOff(this.offNodes.filter((n) => n !== on));
    this.subs = [...this.subs.filter((s) => s.endpoint !== sub.endpoint && s !== had), { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, device: String(device ?? "").slice(0, 200), at: Date.now(), ...chose,
      ...(node ? { node } : had?.node ? { node: had.node } : {}) }].slice(-20);
    this.save();
  }

  /** the tailnet device a subscription is on, told by its page's socket (one subscribed before SHEP-246 had none) */
  nodeOf(endpoint: string, node: string | null | undefined) {
    const s = node ? this.subs.find((x) => x.endpoint === endpoint) : undefined;
    if (!s || s.node === node) return;
    s.node = node!;
    this.save();
  }

  /** a device turned off: it gets nothing more */
  unsubscribe(endpoint: string) {
    const n = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== endpoint);
    if (this.subs.length !== n) this.save();
  }

  /** fork #96: a device removed from Settings › Notifications' list, on any device, by its row's id (never by an
   *  endpoint a page sends): it gets nothing more, as if it turned alerts off itself. An unknown id changes nothing. */
  remove(id: string) {
    const s = id ? this.subs.find((x) => idOf(x.endpoint) === id) : undefined;
    if (!s) return false;
    this.unsubscribe(s.endpoint);
    const h = hashOf(s.endpoint);
    this.keepRemoved([...this.removed.filter((x) => x !== h), h].slice(-50));
    return true;
  }

  /** fork #96: the removed list, written only when it changed; a failed write never fails a remove or a turn on */
  /** fork Needs you 3/6: the tailnet devices whose page chose Off (its own alerts off there), kept so their phone app's
   *  glance feed notifies nothing either; a subscription there again takes it off */
  private offNodes: string[] = [];
  private get offFile() { return this.file.replace(/(\.json)?$/, "-off.json"); }
  private keepOff(next: string[]) {
    if (next.length === this.offNodes.length && next.every((h, i) => h === this.offNodes[i])) return;
    this.offNodes = next;
    try { writeFileSync(this.offFile, JSON.stringify(next), { mode: 0o600 }); } catch {}
  }
  /** fork Needs you 3/6: the page's Off: this subscription goes, and its device is kept as off */
  turnOff(endpoint: string) {
    const node = this.subs.find((s) => s.endpoint === endpoint)?.node;
    this.unsubscribe(endpoint);
    if (node && !this.subs.some((s) => s.node === node)) this.keepOff([...this.offNodes.filter((n) => n !== node), node].slice(-50));
  }
  /** fork Needs you 3/6: a tailnet device turned Off on Settings › Notifications, with no subscription since */
  offOn(node: string | null | undefined): boolean {
    return !!node && this.offNodes.includes(node) && !this.subs.some((s) => s.node === node);
  }

  private keepRemoved(next: string[]) {
    if (next.length === this.removed.length && next.every((h, i) => h === this.removed[i])) return;
    this.removed = next;
    try { writeFileSync(this.removedFile, JSON.stringify(next), { mode: 0o600 }); } catch {}
  }

  /** what the server keeps for a device: whether it is on, what it hears about, and how many devices are on; removed
   *  (fork #96): taken off another device's list, so its page shows alerts off until they are turned on there again */
  state(endpoint: string) {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    return { on: !!s, topics: pushTopics(s?.topics ?? DEFAULT_TOPICS), muted: s?.muted ?? [], devices: this.subs.length,
      ...(!s && endpoint && this.removed.includes(hashOf(endpoint)) ? { removed: true as const } : {}) };
  }

  /** a device's choice (all: every device's), what it hears about and the spaces it mutes */
  choose(endpoint: string, c: { topics?: unknown; muted?: unknown }, all = false) {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    if (!s) throw new Error("Alerts are off for this device.");
    const topics = c.topics === undefined ? pushTopics(s.topics) : pushTopics(c.topics);
    const muted = Array.isArray(c.muted) ? c.muted.filter((m): m is string => typeof m === "string").slice(0, 200) : s.muted ?? [];
    for (const x of all ? this.subs : [s]) { x.topics = [...topics]; x.muted = [...muted]; }
    this.save();
    return this.state(endpoint);
  }

  private async jwt(aud: string) {
    await this.key();
    const k = await subtle.importKey("jwk", this.vapid!.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const head = b64u(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const body = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: this.subject() })));
    const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, enc(`${head}.${body}`));
    return `${head}.${body}.${b64u(sig)}`;
  }

  /** one alert to one device: the push service's answer (0: it couldn't be reached); a gone subscription is dropped */
  private async deliver(s: Sub, payload: Uint8Array) {
    try {
      const body = await encrypt(payload, s.keys.p256dh, s.keys.auth);
      const r = await fetch(s.endpoint, { method: "POST", body, signal: AbortSignal.timeout(10_000), headers: {
        // fork Needs you 3/6: an hour, not a day: what waited longer is stale (the app shows what still waits)
        "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String(PUSH_TTL_S), urgency: "high",
        authorization: `vapid t=${await this.jwt(new URL(s.endpoint).origin)}, k=${await this.key()}`,
      } });
      if (r.status === 404 || r.status === 410) this.unsubscribe(s.endpoint);
      else this.delivered(s, r.status);
      return r.status;
    } catch { this.delivered(s, 0); return 0; }
  }

  /** fork #37: how a device's last alert went, kept for its row in Settings › Notifications */
  private delivered(s: Sub, status: number) {
    s.last = { at: Date.now(), status };
    // a note for Settings only: a failed write never fails the delivery or holds up the next one
    try { this.save(); } catch {}
  }

  /** fork #37: when each device's last seen was last written (its time on disk), so steady use still saves it */
  private seenSaved = new Map<string, number>();

  /** fork #37: the devices whose app is on screen now (their pages say so): last seen now, kept every 10 minutes */
  saw(endpoints: Iterable<string>, now = Date.now()) {
    let keep = false;
    for (const e of endpoints) {
      const s = this.subs.find((x) => x.endpoint === e);
      if (!s) continue;
      const saved = this.seenSaved.get(e) ?? s.seen ?? 0;
      if (now - saved > 10 * 60_000) { keep = true; this.seenSaved.set(e, now); }
      s.seen = now;
    }
    if (keep) try { this.save(); } catch {}
  }

  /** fork #37: every device that gets alerts, for Settings › Notifications: its browser, when it was turned on and last
   *  seen, its last alert, and which is the asking one (mine). Never an endpoint: each is named by a short hash. */
  devices(mine: string) {
    return this.subs.map((s) => ({ id: idOf(s.endpoint), device: s.device ?? "", at: s.at,
      ...(s.seen ? { seen: s.seen } : {}), ...(s.last ? { last: s.last } : {}), topics: pushTopics(s.topics), ...(s.endpoint === mine ? { mine: true as const } : {}) }));
  }

  /** Sends an alert to every subscribed device whose app isn't on screen, whose phone app doesn't show it natively, and
   *  that wants it (its topic, its space). */
  async send({ full: _full, ...alert }: Record<string, unknown> & { topic?: string; place?: string }) {
    const payload = enc(JSON.stringify(alert));
    await Promise.all(this.subs.map(async (s) => {
      if (this.visible.has(s.endpoint) || this.looking(s.node) || this.quiet(s.node) || !wants(s, alert)) return;
      // one device's alerts reach its push service in the order they were made
      const sent = (this.sending.get(s.endpoint) ?? Promise.resolve()).then(() => this.deliver(s, payload)).catch(() => 0);
      this.sending.set(s.endpoint, sent);
      await sent;
      if (this.sending.get(s.endpoint) === sent) this.sending.delete(s.endpoint);
    }));
  }

  /** a test alert to one device, on screen or not: what to say of it */
  async test(endpoint: string) {
    const s = this.subs.find((x) => x.endpoint === endpoint);
    if (!s) return { ok: false, said: "Alerts are off for this device." };
    const status = await this.deliver(s, enc(JSON.stringify({ title: "Shepherdr · Test", body: "Alerts reach this device.", tag: "test", test: true })));
    if (status >= 200 && status < 300) return { ok: true, said: "Sent. It should show in a few seconds." };
    // fork #37: gone tells the page to renew this browser's subscription (Settings › Notifications does, then tests again)
    if (status === 404 || status === 410) return { ok: false, gone: true, said: "This device's subscription is gone. Turn alerts on again." };
    return { ok: false, said: status ? `The push service refused it (${status}).` : "The push service couldn't be reached." };
  }
}
