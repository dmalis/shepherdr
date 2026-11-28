// Shepherdr's plain asks (dmalis/shepherdr, "Shepherdr's asks in Needs you"): each space's Shepherdr chat whose turn
// ended is read off its own log (the shared core's ChatReader, as the chat reads it: Shepherdr's own chat data), and
// its newest words are kept on the space as `asks` when they wait on the person (web/shared/plain-ask.ts plainAskOf).
// web/shared/attention.ts makes that one of the person's actions.
//
// Only the log: no terminal stream, no screen, nothing sent to the agent (docs/agents-and-terms.md). A reader is kept
// per chat (each read takes only what the log gained), and what it found holds only while Shepherdr stays done:
// - each time its turn ends (back from work, from a prompt, a new turn), what it said before is let go and its chat is
//   read again, at once and a little later (the log can land a moment after the turn ends);
// - while an ask shows, its chat is read again now and then, so a reply it missed never leaves the ask standing;
// - the words are always the log's newest: the person's message after them, and there is no ask.
import { ChatReader } from "../core/chat-reader.js";
import { saidToPerson } from "./glance.ts";
import { idleShepherdr, plainAskOf, type LastWords, type PlainAsk } from "../web/shared/plain-ask.ts";

/** after a turn ends, read again this long after (ms) */
const AGAIN_MS = [2_000, 6_000];
/** while an ask shows, its chat is read again at most this often (ms) */
const RECHECK_MS = 30_000;

/** a chat's newest message with words, the person's or its agent's, as the chat lists them (main.ts lastWords) */
export function wordsOf(items: any[] | null | undefined): LastWords | null {
  const m = (items ?? []).findLast(saidToPerson);
  return m ? { who: m.kind === "user" ? "you" : "agent", text: m.text as string } : null;
}

type Reader = Pick<ChatReader, "locate" | "pull"> & { conv?: { items?: any[] } | null };
type Chat = { addr: string; reader: Reader; turn: number; done: boolean; epoch: number; ask: PlainAsk | null;
  read: number; timers: ReturnType<typeof setTimeout>[]; queue: Promise<void> };

export class PlainAsks {
  private chats = new Map<string, Chat>();

  constructor(
    private addrOf: (chat: string) => string | null,
    /** its terminal as herdr-core has it, with its foreground program (chats.ts withForeground) */
    private terminal: (addr: string) => Promise<any>,
    private readerOf: (addr: string) => Reader,
    private changed: () => void,
    private times = { again: AGAIN_MS, recheck: RECHECK_MS },
    private now = () => Date.now(),
  ) {}

  /** puts each space's ask on it (only while its Shepherdr stays done), and reads the chats whose turn just ended */
  stamp(snap: { places?: any[]; last?: Record<string, number> }) {
    const here = new Set<string>();
    for (const p of snap.places ?? []) {
      if (!p?.chat) continue;
      delete p.asks;
      const addr = this.addrOf(p.chat);
      if (!addr) continue;
      here.add(p.chat);
      let c = this.chats.get(p.chat);
      if (!c || c.addr !== addr) {
        if (c) this.stop(c, true);
        c = { addr, reader: this.readerOf(addr), turn: -1, done: false, epoch: 0, ask: null, read: 0, timers: [], queue: Promise.resolve() };
        this.chats.set(p.chat, c);
      }
      // at work, at a prompt (its card says it), stopped or never started: what it said before says nothing of now
      if (p.archived || !idleShepherdr(p)) {
        if (c.done) { c.done = false; c.ask = null; c.epoch++; this.stop(c); }
        continue;
      }
      const turn = Number(snap.last?.[p.chat]) || 0;
      if (!c.done || c.turn !== turn) {
        // its turn just ended: read it now and a little later
        Object.assign(c, { done: true, turn, ask: null, epoch: c.epoch + 1 });
        this.stop(c);
        this.read(c);
        for (const ms of this.times.again) c.timers.push(setTimeout(() => this.read(c!), ms));
      } else if (c.ask && this.now() - c.read >= this.times.recheck) this.read(c);
      if (c.ask) p.asks = c.ask;
    }
    for (const [k, c] of this.chats) if (!here.has(k)) { this.stop(c, true); this.chats.delete(k); }
  }

  private stop(c: Chat, gone = false) {
    if (gone) c.epoch++;
    for (const t of c.timers) clearTimeout(t);
    c.timers = [];
  }

  /** one read of its log, after the one before it; kept only if Shepherdr is still in the same done turn */
  private read(c: Chat) {
    const epoch = c.epoch;
    c.read = this.now();
    c.queue = c.queue.then(async () => {
      if (c.epoch !== epoch) return;
      try {
        await c.reader.locate(await this.terminal(c.addr));
        await c.reader.pull();
      } catch { return; }
      if (c.epoch !== epoch || !c.done) return;
      const ask = plainAskOf(wordsOf(c.reader.conv?.items), c.turn);
      c.read = this.now();
      if (JSON.stringify(ask) === JSON.stringify(c.ask)) return;
      c.ask = ask;
      this.changed();
    });
  }
}
