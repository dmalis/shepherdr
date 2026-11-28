// Shepherdr's plain asks (dmalis/shepherdr, "Shepherdr's asks in Needs you"): each space's Shepherdr chat whose turn
// ended is read once a turn, off its own log as its chat shows it (service/chats.ts, the shared core's ChatReader:
// Shepherdr's own chat data, nothing of the agent's interface), and its newest words are kept on the space as `asks`
// (web/shared/plain-ask.ts plainAskOf). web/shared/attention.ts says whether they wait on the person.
//
// A read is a short follow of its chat (a few seconds, then let go), as main.ts's unread news, so no chat stays
// followed for this. Words are kept with the turn they were read at, and a space whose chat has moved on to another
// turn shows none until it is read again: a reply the person sent never leaves an old ask standing.
import { plainAskOf, type LastWords, type PlainAsk } from "../web/shared/plain-ask.ts";
import type { Watcher } from "./chats.ts";

/** how long a read follows its chat for the words of its newest turn */
const FOLLOW_MS = 4_000;

type Chats = { watch(addr: string, w: Watcher): void; unwatch(addr: string, w: Watcher): void };

export class PlainAsks {
  private seen = new Map<string, { turn: number; ask: PlainAsk | null }>();

  constructor(
    private chats: () => Chats | null | undefined,
    private addrOf: (chat: string) => string | null,
    private words: (chat: string) => LastWords | null,
    private changed: () => void,
    private follow = FOLLOW_MS,
  ) {}

  /** puts each space's kept words on it (its chat's newest turn's only), and reads the ones whose turn is new */
  stamp(snap: { places?: any[]; last?: Record<string, number> }) {
    const here = new Set<string>();
    for (const p of snap.places ?? []) {
      if (!p?.chat) continue;
      here.add(p.chat);
      delete p.asks;
      // a chat at work, at a prompt, stopped or never started asks nothing in words now (its card or state says it)
      if (p.shepherdr === "stopped" || p.shepherdr === "none" || p.status === "work" || p.status === "need") continue;
      const turn = Number(snap.last?.[p.chat]) || 0;
      const s = this.seen.get(p.chat);
      if (s?.turn === turn) { if (s.ask) p.asks = s.ask; continue; }
      this.read(p.chat, turn);
    }
    for (const k of this.seen.keys()) if (!here.has(k)) this.seen.delete(k);
  }

  private read(chat: string, turn: number) {
    const addr = this.addrOf(chat), chats = this.chats();
    // nothing to read it with: tried again at the next snapshot
    if (!addr || !chats) return;
    const entry = { turn, ask: null as PlainAsk | null };
    this.seen.set(chat, entry);
    const w: Watcher = () => {
      if (this.seen.get(chat) !== entry) return;
      const ask = plainAskOf(this.words(chat), turn);
      if (JSON.stringify(ask) === JSON.stringify(entry.ask)) return;
      entry.ask = ask;
      this.changed();
    };
    chats.watch(addr, w);
    setTimeout(() => chats.unwatch(addr, w), this.follow);
  }
}
