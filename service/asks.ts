// Questions, permissions and plans an agent asks through Claude Code's PermissionRequest hook (mods/chat/ask-hook.sh):
// each request waits in data/chat-asks/req/<id>.json until an answer lands in ans/<id>.json, from the window's card or
// from here. The words and the answers are the shared core's (core/asks.js), so a card says and does the same on both;
// whichever answers first wins (the hook reads one answer, then the card closes everywhere). Another machine's agents
// (the web served from a machine other than theirs) ask in that machine's data/chat-asks: read and answered through
// herdr-core's link.
import { watch, readdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA, appHome, writable } from "./paths.ts";
import * as A from "../core/asks.js";
import type { Hub } from "./hub.ts";
import { SEEN, MACHINE, parseList, connected, run, each } from "./asks-there.ts";

const { words, allow, deny, answers, annotationsOf, howAnswered, release, chatAbout, dismiss, stepWords } = A as any;
const dir = () => join(appHome(), "data", "chat-asks");
const ID = /^[\w.-]+$/;
// On another machine (its folder by its own home): each request still waiting, one line each ("req", its id, its JSON;
// marked seen/<id> only once a card here shows it: asks-there.ts SEEN), then how each id given has ended ("end", its
// id, the hook's or a card's words).
const THERE = 'd="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/chat-asks"';
export const LIST = `${THERE}
for f in "$d"/req/*.json; do [ -f "$f" ] || continue; n=\${f##*/}; n=\${n%.json}; [ -f "$d/ans/$n.json" ] && continue
  printf 'req\\t%s\\t' "$n"; tr '\\n\\t' '  ' < "$f"; echo; done
for n in "$@"; do [ -f "$d/end/$n" ] && printf 'end\\t%s\\t%s\\n' "$n" "$(head -n 1 "$d/end/$n")"; done; exit 0`;
// An answer there, as answer() writes one here: how it went (end/<id>), then the answer (stdin) in place at once.
const ANSWER = `${THERE}; mkdir -p "$d/ans" "$d/end"; [ -f "$d/req/$1.json" ] || exit 3
[ -z "$2" ] || printf '%s\\n' "$2" > "$d/end/$1"
cat > "$d/ans/$1.json.tmp" && mv "$d/ans/$1.json.tmp" "$d/ans/$1.json"`;

/** machine and local: another machine's ask, by that machine's name and its own id there (its id here: <machine>/<local>) */
export type Ask = { id: string; terminal: string; at: number; req: any; words: any; machine?: string; local?: string };

/** An ask that closed, as the window's chat keeps it for its quiet line ("✓ Run: npm test · Allowed in the chat"):
 *  what it asked and how it went (the hook's end/<id>, else "No longer waiting"), at its moment. */
export type AskEnd = { id: string; terminal: string; title: string; how: string; at: number; kind: string; /** when it closed (dmalis/shepherdr#45) */ done?: number };
const ENDS = join(DATA, "ask-ends.json");
// When an ask was made: its id is <terminal>.<seconds>.<pid> (ask-hook.sh), at the end of that second (the window's askAt)
const askAt = (id: string) => { const p = id.split("."); const s = Number(p[p.length - 2]); return Number.isFinite(s) && s > 1e9 ? s * 1000 + 999 : Date.now(); };

export class Asks {
  open = new Map<string, Ask>();
  /** closed asks, newest last, the last 200 (kept across restarts in the service's data) */
  ends: AskEnd[] = (() => { try { return JSON.parse(readFileSync(ENDS, "utf8")) ?? []; } catch { return []; } })();
  private listeners = new Set<() => void>();
  private hub: Hub | null = null;
  private watched: () => string[] = () => [];
  private polling = false;
  /** dmalis/shepherdr#108: whether an agent's ask has somewhere to show (its chat here: Compat's), set by main. Its
   *  seen/<id> waits for one, so a Codex ask no card shows goes back to Codex's terminal; unset, every ask has one. */
  destination: ((terminal: string) => boolean) | null = null;
  /** the asks marked seen/<id>, here or there */
  private marked = new Set<string>();
  /** every connected machine (machine.list), read with no page open: as last known */
  private linked: string[] = [];
  private ticks = 0;
  private shown = (a: Ask) => !this.destination || this.destination(a.terminal);

  /** The closed asks of an agent, for its chat's quiet lines. */
  endsOf(terminal: string) { return this.ends.filter((e) => e.terminal === terminal); }

  private ended(a: Ask, known?: string) {
    if (this.ends.some((e) => e.id === a.id)) return;
    let how = known ?? "";
    if (!a.machine) try { how = readFileSync(join(dir(), "end", a.id), "utf8").trim(); } catch {}
    this.ends = [...this.ends, { id: a.id, terminal: a.terminal, title: a.words?.title ?? "", how: how || "No longer waiting", at: askAt(a.id), kind: a.words?.kind ?? "", done: Date.now() }].slice(-200);
    try { writeFileSync(`${ENDS}.tmp`, JSON.stringify(this.ends)); renameSync(`${ENDS}.tmp`, ENDS); } catch {}
  }

  on(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  start() {
    const req = join(dir(), "req");
    if (existsSync(req)) watch(req, () => this.read());
    setInterval(() => this.read(), 4000);
    this.read();
  }

  /** Also another machine's asks: of the agents whose chats pages show (watched: their addresses) and the machines with
   *  one open, every 3 s; of every connected machine, page or not, every 6 s (dmalis/shepherdr#108). */
  remote(hub: Hub, watched: () => string[]) {
    this.hub = hub;
    this.watched = watched;
    setInterval(() => void this.poll().catch(() => {}), 3000);
  }

  private async poll() {
    if (!this.hub || this.polling) return;
    this.polling = true;
    try {
      const recent = (e: AskEnd) => e.how === "No longer waiting" && e.id.includes("/") && Date.now() - e.at < 120_000;
      const machines = new Set(this.watched().filter((a) => a.includes("/")).map((a) => a.split("/")[0]));
      // one open from a machine no page shows any more still closes once it says so
      for (const a of this.open.values()) if (a.machine) machines.add(a.machine);
      for (const e of this.ends) if (recent(e)) machines.add(e.id.split("/")[0]);
      // dmalis/shepherdr#108: and every machine herdr-core reaches, so an ask there shows with no page open
      if (this.ticks++ % 2 === 0) this.linked = (await connected(this.hub)) ?? this.linked;
      for (const m of this.linked) machines.add(m);
      let changed = false;
      // a few machines at once, each read bounded: one out of reach never holds up the rest
      await each([...machines].filter((m) => MACHINE.test(m)), 4, async (m) => {
        const asked = [...this.open.values()].filter((a) => a.machine === m).map((a) => a.local!);
        const late = this.ends.filter((e) => recent(e) && e.id.startsWith(`${m}/`)).map((e) => e.id.slice(m.length + 1));
        const out = await run(this.hub!, m, LIST, [...asked, ...late]);
        // out of reach, or the read failed: what is open stays as it was
        if (out === null) return;
        const { reqs, ends } = parseList(out);
        for (const [local, body] of reqs) {
          const id = `${m}/${local}`;
          if (this.open.has(id)) continue;
          try {
            const req = JSON.parse(body);
            this.open.set(id, { id, terminal: `${m}/${local.split(".")[0]}`, at: askAt(local), req, words: words(req), machine: m, local });
            changed = true;
          } catch {}
        }
        for (const local of asked) if (!reqs.has(local)) {
          const a = this.open.get(`${m}/${local}`);
          if (!a) continue;
          this.open.delete(a.id);
          this.ended(a, ends.get(local));
          changed = true;
        }
        for (const e of this.ends) if (recent(e) && e.id.startsWith(`${m}/`) && ends.get(e.id.slice(m.length + 1))) { e.how = ends.get(e.id.slice(m.length + 1))!; changed = true; }
      });
      if (changed) for (const fn of this.listeners) fn();
      await this.markThere();
    } finally {
      this.polling = false;
    }
  }

  /** seen/<id> on its machine for each ask there that a card here shows now (dmalis/shepherdr#108); a mark that
   *  didn't reach it is tried again on the next poll. */
  private async markThere() {
    const due = new Map<string, string[]>();
    for (const a of this.open.values()) if (a.machine && !this.marked.has(a.id) && this.shown(a)) due.set(a.machine, [...(due.get(a.machine) ?? []), a.local!]);
    await each([...due], 4, async ([m, locals]) => {
      if (await run(this.hub!, m, SEEN, locals) !== null) for (const l of locals) this.marked.add(`${m}/${l}`);
    });
    for (const id of this.marked) if (!this.open.has(id)) this.marked.delete(id);
  }

  /** What waits now. The id is <terminal>.<seconds>.<pid> (ask-hook.sh). */
  private read() {
    // another machine's are poll()'s
    const next = new Map<string, Ask>([...this.open].filter(([, a]) => a.machine));
    let names: string[] = [];
    try { names = readdirSync(join(dir(), "req")).filter((n) => n.endsWith(".json")); } catch {}
    for (const n of names) {
      const id = n.slice(0, -5);
      if (!ID.test(id) || existsSync(join(dir(), "ans", n))) continue;
      const old = this.open.get(id);
      if (old) { next.set(id, old); continue; }
      try {
        const req = JSON.parse(readFileSync(join(dir(), "req", n), "utf8"));
        next.set(id, { id, terminal: id.split(".")[0], at: statSync(join(dir(), "req", n)).mtimeMs, req, words: words(req) });
      } catch {}
    }
    // seen/<id>: a card shows it, so a Codex hook keeps waiting for its answer (else Codex asks in its terminal); only
    // once it has a chat to show in (dmalis/shepherdr#108), never a 30-minute wait on a card nobody can see
    for (const a of next.values()) if (!a.machine && !this.marked.has(a.id) && this.shown(a)) {
      try { mkdirSync(join(dir(), "seen"), { recursive: true }); writeFileSync(writable(join(dir(), "seen", a.id)), ""); this.marked.add(a.id); } catch {}
    }
    const changed = next.size !== this.open.size || [...next.keys()].some((k) => !this.open.has(k));
    // gone: its quiet line, with how it went
    for (const [id, a] of this.open) if (!next.has(id)) this.ended(a);
    // the hook writes how a moment after the request goes: a line still saying "No longer waiting" learns it
    for (const e of this.ends) if (e.how === "No longer waiting" && Date.now() - e.at < 120_000) {
      try { const how = readFileSync(join(dir(), "end", e.id), "utf8").trim(); if (how) e.how = how; } catch {}
    }
    this.open = next;
    for (const id of this.marked) if (!next.has(id)) this.marked.delete(id);
    if (changed) for (const fn of this.listeners) fn();
  }

  of(terminal: string) { return [...this.open.values()].filter((a) => a.terminal === terminal); }

  /** Answers it as the window's card would: a permission or plan allowed or declined, a question's pick. */
  async answer(id: string, a: { choice?: number; choices?: number[]; note?: string; other?: string; answers?: unknown[]; terminal?: boolean; talk?: boolean; dismiss?: boolean }) {
    const ask = this.open.get(id);
    if (!ask) throw new Error("That question was answered already.");
    const w = ask.words;
    let out: string;
    // the window's card links: "Answer in terminal" (no decision: the CLI asks in its terminal) and a questions card's
    // "Chat about this" (Claude hears the person wants to talk it over first)
    if (a.terminal) out = release();
    // "Dismiss" (or Esc): closed without an answer; the agent hears it was declined and carries on
    else if (a.dismiss) out = dismiss(w.kind);
    else if (a.talk && w.kind === "questions") out = chatAbout();
    else if (w.kind === "questions" && w.questions.length > 1) {
      // the multi-step card: each question's answer in order, all of them
      const got = (a.answers ?? []).map((x, i) => stepWords(x, w.questions[i]?.options.map((o: any) => o.name)));
      if (got.length !== w.questions.length || got.some((x) => !x)) throw new Error("Answer every question first.");
      const map = Object.fromEntries(w.questions.map((q: any, i: number) => [q.text, got[i]]));
      out = answers(ask.req, map, annotationsOf(w, map, a.note));
    } else if (w.kind === "questions") {
      const q = w.questions[0];
      const picked = a.other ? [a.other] : (a.choices ?? (a.choice != null ? [a.choice] : [])).map((i) => q.options[i]?.name).filter(Boolean);
      if (!picked.length) throw new Error("Pick an answer first.");
      const map = { [q.text]: picked.join(", ") };
      // the picked option's preview and the person's note go with it, as Claude's prompt gives them (SHEP-139)
      out = answers(ask.req, map, annotationsOf(w, map, a.note));
    } else if (a.choice === 0) {
      // never allowed unseen: a request too long for the card is answered where it shows whole, the terminal
      if (w.cut) throw new Error("Too long to show here in full: answer it in the terminal.");
      out = allow();
    }
    else out = deny(a.note?.trim() || (w.kind === "plan" ? "The person didn't approve this plan yet. Ask them what to change." : undefined));
    // As the window's answerAsk(): first how it went (end/<id>, for every other copy of the card), then the answer.
    const how = howAnswered(ask, out, "on the web");
    if (ask.machine) {
      const r = await this.hub?.call<{ code: number }>("machine.exec", { on: ask.machine, argv: ["sh", "-c", ANSWER, "sh", ask.local!, how ?? ""], input: Buffer.from(out).toString("base64"), timeout: 10 }, 15_000).catch(() => null);
      if (r?.code === 3) { this.open.delete(id); this.ended(ask); for (const fn of this.listeners) fn(); throw new Error("That question was answered already."); }
      if (r?.code !== 0) throw new Error(`It didn't reach ${ask.machine}: try again.`);
      this.open.delete(id);
      this.ended(ask, how || undefined);
      for (const fn of this.listeners) fn();
      return;
    }
    if (how) writeFileSync(writable(join(dir(), "end", id)), `${how}\n`);
    const file = writable(join(dir(), "ans", `${id}.json`));
    writeFileSync(`${file}.tmp`, out);
    renameSync(`${file}.tmp`, file);
    this.open.delete(id);
    this.ended(ask);
    for (const fn of this.listeners) fn();
  }
}
