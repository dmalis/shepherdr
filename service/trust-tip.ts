// The trust card's per-repo tip (fork patch, dmalis/shepherdr#62): when a task's agent or reviewer stops on its
// CLI's folder-trust screen, the card also offers the command that trusts the repo once, for the person to run in their
// own terminal, so the repo's next tasks don't ask. Only a tip: Shepherdr never runs it, never answers the screen and
// never writes the CLI's settings (Nothing that risks a ban, docs/agents-and-terms.md).
//
// Which folder: a task worktree is a git worktree of the repo's main checkout, and both CLIs key a worktree's trust on
// that main checkout's root (Claude Code: code.claude.com/docs/en/permissions, "Project allow rules and workspace
// trust"; Codex 0.172: codex-rs/git-utils/src/trust.rs, and its screen's "Trusting will apply to the repository
// root"). Trusting the folder the worktrees sit in covers none of them (each is a git repository of its own). A
// reviewer's extra folder (Claude Code's --add-dir of the role templates) is trusted on its own.
//
// Once per repo: copying the command marks it seen for that machine and folder (the shared document's "trust.tips"),
// and later cards for that repo leave it out. Its tasks that stop asking show no card, so no tip either.
import type { TrustTip } from "../web/shared/types.ts";
export type { TrustTip };

export const SEEN_KEY = "trust.tips";
const KEEP = 200;

type Row = { machine?: string | null; folder?: string; worktree?: string; kind?: string };
type Seen = Record<string, { at: number; card: string }>;

const under = (path: string, dir: string) => path === dir || path.startsWith(dir.replace(/\/+$/, "") + "/");
const ADD_DIR = /Adding a new directory:/i;
const ADD_DIR_ASK = /Is this a directory you created or one you trust/i;

/** The folder Claude Code's --add-dir screen names (a reviewer's extra folder, the role templates, or one in the
 *  person's own flags): the lines under "Adding a new directory:" up to the next blank one, joined where the terminal
 *  wrapped it. Spaces in it stay. null when it isn't that screen or no folder can be read from it. */
export function addDirFolder(all: string | null | undefined): string | null {
  if (!all || !ADD_DIR.test(all) || !ADD_DIR_ASK.test(all.replace(/\s+/g, " "))) return null;
  const lines = all.split("\n");
  const i = lines.findIndex((l) => ADD_DIR.test(l));
  const after = lines[i].replace(/^.*Adding a new directory:/i, "").trim();
  const parts = after ? [after] : [];
  for (const l of lines.slice(i + 1)) {
    const t = l.trim();
    if (!t) { if (parts.length) break; continue; }
    if (ADD_DIR_ASK.test(t) || /^This session\b/i.test(t)) break;
    parts.push(t);
  }
  const folder = parts.join("").replace(/\/+$/, "");
  return /^(\/|~\/|[A-Z]:\\)/.test(folder) ? folder : null;
}

/** The folder to trust once, on the task's machine: the folder Claude Code's --add-dir screen names when that is what
 *  asks, else the repo's main checkout for a task in a worktree of it. null when answering the screen itself already
 *  covers the repo's next tasks (a task in the main checkout), when it isn't a task's repo (a folder, a plain chat), or
 *  when the screen's folder can't be read. `screen`: the folder the screen names (trustOf's: a long path the terminal
 *  wrapped is cut at the wrap); `all`: the screen's text. */
export function tipFolder(screen: string | null | undefined, row: Row | null | undefined, all?: string | null): { folder: string; extra: boolean } | null {
  if (all && ADD_DIR.test(all)) {
    const folder = addDirFolder(all);
    return folder ? { folder, extra: true } : null;
  }
  if (!row || row.kind !== "repo" || !row.folder || !row.worktree || row.worktree === row.folder) return null;
  // a screen that names another folder than this task's (its agent moved): no tip for a folder we can't place. A
  // path cut where the terminal wrapped it still counts when it is the start of the task's own.
  const cut = (p: string) => !!screen && screen.length >= 8 && p.startsWith(screen);
  if (screen && !under(screen, row.worktree) && !under(screen, row.folder) && !cut(row.worktree)) return null;
  return { folder: row.folder, extra: false };
}

/** A path as one shell word (single-quoted when it needs it). */
export function shellWord(s: string) {
  return /^[\w@%+=:,./~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

const BIN: Record<string, string> = { "Claude Code": "claude", Codex: "codex" };
/** what to answer on its screen, in the CLI's own words */
const ANSWER: Record<string, string> = { "Claude Code": "answer “Yes, I trust this folder”", Codex: "choose to trust it" };

/** The tip for a trust card, or null (another CLI, no folder to name, already seen for this repo on another card). */
export function trustTip(o: { cli: string; screen?: string | null; all?: string | null; row?: Row | null; here: string; card: string; seen?: unknown }): TrustTip | null {
  const bin = BIN[o.cli];
  const at = bin ? tipFolder(o.screen, o.row, o.all) : null;
  if (!bin || !at) return null;
  const machine = o.row?.machine || o.here;
  // each CLI keeps its own trust: copying Claude Code's command leaves Codex's still to show for the same repo
  const key = `${machine}:${bin}:${at.folder}`;
  const was = (o.seen && typeof o.seen === "object" ? (o.seen as Seen)[key] : undefined);
  if (was && was.card !== o.card) return null;
  return {
    key, machine, folder: at.folder,
    lead: at.extra ? "Trust this added folder once, so later reviews don't ask:" : "Trust this repo once, so its next tasks don't ask:",
    command: `cd ${shellWord(at.folder)} && ${bin}`,
    then: `${ANSWER[o.cli]}, then type /exit.`,
    ...(at.extra ? {} : { covers: "Its task folders are worktrees of it, so trusting it covers them." }),
  };
}

/** The shared document's "trust.tips" with this one marked seen on this card (the newest few hundred kept). */
export function markSeen(seen: unknown, key: string, card: string, now = Date.now()): Seen {
  const was: Seen = seen && typeof seen === "object" ? { ...(seen as Seen) } : {};
  if (was[key]) return was;
  was[key] = { at: now, card };
  return Object.fromEntries(Object.entries(was).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP));
}

/** The web app's "trust-tip" action: the person copied the command. */
export async function tipCopied(shared: { value(key: string): any; set(key: string, value: unknown): Promise<unknown> } | null, b: any) {
  if (!shared) throw new Error("Not ready yet.");
  const key = typeof b?.key === "string" ? b.key.slice(0, 1000) : "", card = typeof b?.card === "string" ? b.card.slice(0, 200) : "";
  if (!key || !card) throw new Error("Not a tip.");
  await shared.set(SEEN_KEY, markSeen(shared.value(SEEN_KEY), key, card));
  return { ok: true };
}
