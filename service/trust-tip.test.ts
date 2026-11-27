// The trust card's per-repo tip (fork patch, dmalis/shepherdr#62): a task's agent or reviewer at its CLI's
// folder-trust screen gets, on its card, the command that trusts the repo's main checkout once, for each CLI, on the
// task's machine, and it shows once per repo. Fake data, made-up paths.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import { addDirFolder, markSeen, SEEN_KEY, shellWord, tipCopied, tipFolder, trustTip } from "./trust-tip.ts";
import { readScreen, screenText, trustOf } from "../core/screens.js";

const ROOT = join(import.meta.dir, "..");
const WT = "/home/me/.local/share/shepherdr/worktrees/shop/fix-the-cart";
const row = { ref: "SHOP-1", slug: "dev-shop", id: 1, title: "Fix the cart", section: "needs", needs: "asks", sub: "Asks to trust this folder",
  machine: null as string | null, folder: "/home/me/dev/shop", worktree: WT, list: "shop", kind: "repo", space: "sp1", worker: "t7", started: 500 };
// a card as the service's screen watch makes it from the terminal's text
const fromScreen = (text: string, cli: string, id = "scr-t7-1", addr = "t7") => ({ id, addr, cli, state: "open", opened: 1000, ...readScreen(text), all: screenText(text) });
// the CLIs' own screens (their words; the folders made up)
const CLAUDE = (folder: string) => [" Accessing workspace:", "", ` ${folder}`, "",
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team).",
  "", " ❯ 1. Yes, I trust this folder", "   2. No, exit", "", " Enter to confirm · Esc to cancel"].join("\n");
// Codex 0.172.0's onboarding (codex-rs/tui/src/onboarding/trust_directory.rs)
const CODEX = (folder: string, root: string) => ["  Folder access", `  ${folder}`, "",
  "  Note: You’re in a subdirectory of a Git project. Trusting will apply to the repository root:", `  ${root}`, "",
  "  Trust this folder? Codex can read, edit, and run files here, subject to your permission settings. Folder settings can run code automatically,",
  "  even without a model request. Continue only if you trust these files. Your trust decision will be saved.", "",
  "› 1. Trust and continue", "  2. Quit", "", "  enter continue · esc back"].join("\n");
// Claude Code 2.1.332's --add-dir screen, a reviewer's: `lines` is the folder as the terminal shows it (wrapped or not)
const ADD_DIR = (lines: string[], ask = [" This session hasn't worked here before. Is this a directory you created or one you trust?"]) => [
  " Adding a new directory:", ...lines.map((l) => ` ${l}`), "", ...ask,
  " Claude Code'll be able to read, edit, and execute files here. Your answer holds for this session. Starting Claude Code in this directory and trusting it there lasts, and covers its whole repository or everything below it.",
  "", " ❯ 1. No, exit", "   2. Yes, add it", "", " Enter to confirm · Esc to cancel"].join("\n");
const TPL = "/home/me/.config/herdr-core/templates";

const snapOf = (o: { rows?: any[]; cards?: any[]; terms?: any[]; shared?: Record<string, any>; machines?: any[] } = {}) => {
  const c = new Compat() as any;
  const terms = o.terms ?? [];
  c.terminalsOf = (a: string) => terms.find((k: any) => k.address === a) ?? null;
  c.terminalsAll = () => terms;
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  c.watch = { openCards: () => o.cards ?? [fromScreen(CLAUDE(WT), "Claude Code")], openCard: () => null, cardsOf: () => [] };
  const store = { ...(o.shared ?? {}) };
  c.shared = { value: (k: string) => store[k], set: async (k: string, v: unknown) => { store[k] = v; } };
  const spaces = [{ id: "sp1", name: "shop", folder: "/home/me/dev/shop", machine: null, assistant: null }];
  return { c, store, snap: c.snapshot({ host: "mini", user: "me", machines: o.machines ?? [], spaces, sections: [], rows: o.rows ?? [row] }) };
};
const reviewer = { address: "t9", parent: "t7", labels: { "herdr.role": "reviewer" }, state: "live" };
const tipOn = (card: any, terms: any[] = []) => snapOf({ terms, cards: [card] }).snap.needs[0]?.question;

test("Claude Code in a task worktree: trust the repo's main checkout, on this machine", () => {
  const t = tipOn(fromScreen(CLAUDE(WT), "Claude Code")).trust.tip;
  expect(t).toMatchObject({ key: "mini:claude:/home/me/dev/shop", machine: "mini", folder: "/home/me/dev/shop", command: "cd /home/me/dev/shop && claude",
    lead: "Trust this repo once, so its next tasks don't ask:", then: "answer “Yes, I trust this folder”, then type /exit." });
  expect(t.covers).toContain("worktrees");
});

test("Codex 0.172's own trust screen (Trust and continue, Quit) is a trust card with Codex's command for the same folder", () => {
  const card = fromScreen(CODEX(WT, "/home/me/dev/shop"), "Codex");
  expect(trustOf(card)).toEqual({ yes: 0, no: 1, folder: WT });
  const q = tipOn(card);
  expect(q.title).toBe("Trust this folder?");
  expect(q.trust.tip).toMatchObject({ key: "mini:codex:/home/me/dev/shop", command: "cd /home/me/dev/shop && codex", then: "choose to trust it, then type /exit." });
  // the older screen still reads as one
  const old = fromScreen(["> You are in /home/me/dev/shop", "", "  Do you trust the contents of this directory?", "", "› 1. Yes, continue", "  2. No, quit"].join("\n"), "Codex");
  expect(trustOf(old)).toMatchObject({ yes: 0, no: 1 });
});

test("a task on another machine: that machine's name and paths", () => {
  const far = { ...row, machine: "vm", folder: "/srv/me/shop", worktree: "/srv/me/.local/share/shepherdr/worktrees/shop/fix" };
  expect(trustTip({ cli: "Claude Code", screen: far.worktree, row: far, here: "mini", card: "c1" })).toMatchObject({ key: "vm:claude:/srv/me/shop", machine: "vm", command: "cd /srv/me/shop && claude" });
});

test("a worktree path the terminal wrapped (cut on the screen) still gets the tip", () => {
  const cut = WT.slice(0, 40);
  expect(tipFolder(cut, row)).toEqual({ folder: "/home/me/dev/shop", extra: false });
  expect(tipFolder("/home", row)).toBeNull(); // too little to place
});

test("a Claude reviewer's --add-dir screen (it holds only for the session) is a trust card whose tip names that folder", () => {
  const card = fromScreen(ADD_DIR([TPL]), "Claude Code", "scr-t9-1", "t9");
  expect(trustOf(card)).toEqual({ yes: 1, no: 0, folder: TPL });
  const q = tipOn(card, [reviewer]);
  expect(q.title).toBe("Trust this folder?");
  expect(q.trust.tip).toMatchObject({ key: `mini:claude:${TPL}`, folder: TPL, command: `cd ${TPL} && claude`, lead: "Trust this added folder once, so later reviews don't ask:" });
  expect(q.trust.tip.covers).toBeUndefined();
});

test("the --add-dir screen wrapped, a folder with spaces, a folder of the person's own: its own folder, never the repo's", () => {
  // its question wrapped across two lines: still a trust card
  const wrapped = fromScreen(ADD_DIR([TPL], [" This session hasn't worked here before. Is this a directory you created", " or one you trust?"]), "Claude Code", "scr-t9-1", "t9");
  expect(trustOf(wrapped)).toMatchObject({ yes: 1, no: 0 });
  expect(tipOn(wrapped, [reviewer]).trust.tip.folder).toBe(TPL);
  // the folder wrapped where the terminal ended
  expect(addDirFolder(ADD_DIR(["/home/me/.config/herdr-co", "re/templates"]))).toBe(TPL);
  // a folder with spaces in it: the tip quotes it; the card itself can't read a folder with spaces (trustOf's folder)
  const spaced = fromScreen(ADD_DIR(["/config with spaces/herdr-core/templates"]), "Claude Code", "scr-t9-1", "t9");
  expect(tipOn(spaced, [reviewer]).trust.tip).toMatchObject({ folder: "/config with spaces/herdr-core/templates", command: "cd '/config with spaces/herdr-core/templates' && claude" });
  // a folder of the person's own (not the templates): named as it is
  expect(addDirFolder(ADD_DIR(["/home/me/notes"]))).toBe("/home/me/notes");
  // no folder to read: no tip at all, never the repo's command in its place
  const blank = fromScreen(ADD_DIR(["(somewhere)"]), "Claude Code", "scr-t9-1", "t9");
  expect(tipOn(blank, [reviewer]).trust.tip).toBeUndefined();
});

test("no tip where answering the screen already covers the next tasks, or for a folder it can't place", () => {
  expect(tipFolder("/home/me/dev/shop", { ...row, worktree: "/home/me/dev/shop" })).toBeNull(); // a task in the folder itself
  expect(tipFolder(WT, { ...row, kind: "folder" })).toBeNull();
  expect(tipFolder("/somewhere/else", row)).toBeNull();
  expect(tipFolder(null, null)).toBeNull(); // an Assistant's, not a task's
  expect(tipFolder(null, row)).toEqual({ folder: "/home/me/dev/shop", extra: false }); // a screen that names no folder
  expect(trustTip({ cli: "Cursor", screen: WT, row, here: "mini", card: "c1" })).toBeNull();
});

test("a folder with spaces or quotes stays one shell word", () => {
  expect(shellWord("/home/me/dev/my shop")).toBe("'/home/me/dev/my shop'");
  expect(shellWord("/home/me/dev/sam's")).toBe(`'/home/me/dev/sam'\\''s'`);
  expect(trustTip({ cli: "Claude Code", screen: null, row: { ...row, folder: "/home/me/dev/my shop" }, here: "mini", card: "c1" })!.command).toBe("cd '/home/me/dev/my shop' && claude");
});

test("once per repo and CLI: copied on one card, that card keeps it and the repo's later cards leave it out", () => {
  const key = "mini:claude:/home/me/dev/shop";
  const seen = markSeen(undefined, key, "c1", 5);
  expect(seen).toEqual({ [key]: { at: 5, card: "c1" } });
  expect(markSeen(seen, key, "c2", 9)).toEqual(seen); // the first copy is the one kept
  expect(trustTip({ cli: "Claude Code", screen: WT, row, here: "mini", card: "c1", seen })).not.toBeNull();
  expect(trustTip({ cli: "Claude Code", screen: WT, row, here: "mini", card: "c2", seen })).toBeNull();
  // Codex keeps its own trust: its tip for the same repo still shows
  expect(trustTip({ cli: "Codex", screen: WT, row, here: "mini", card: "c2", seen })).not.toBeNull();
  // another repo, or the same folder on another machine, still gets its own
  expect(trustTip({ cli: "Claude Code", screen: null, row: { ...row, folder: "/home/me/dev/blog" }, here: "mini", card: "c2", seen })).not.toBeNull();
  expect(trustTip({ cli: "Claude Code", screen: null, row: { ...row, machine: "vm" }, here: "mini", card: "c2", seen })).not.toBeNull();
});

test("it keeps the newest few hundred", () => {
  let seen: any = {};
  for (let i = 0; i < 205; i++) seen = markSeen(seen, `mini:claude:/r${i}`, `c${i}`, i);
  expect(Object.keys(seen)).toHaveLength(200);
  expect(seen["mini:claude:/r0"]).toBeUndefined();
  expect(seen["mini:claude:/r204"]).toBeDefined();
});

test("the task's Needs you card carries the tip; copying it (the action) hides it on the repo's next card", async () => {
  const { snap, c, store } = snapOf();
  const tip = snap.needs[0].question.trust!.tip!;
  expect(tip).toMatchObject({ key: "mini:claude:/home/me/dev/shop", command: "cd /home/me/dev/shop && claude" });
  expect(await tipCopied(c.shared, { type: "trust-tip", key: tip.key, card: "scr-t7-1" })).toEqual({ ok: true });
  expect(Object.keys(store[SEEN_KEY])).toEqual(["mini:claude:/home/me/dev/shop"]);
  expect(snapOf({ shared: store }).snap.needs[0].question.trust!.tip).toBeDefined(); // the same card still shows it
  const wt2 = WT.replace("fix-the-cart", "add-search");
  const next = snapOf({ shared: store, cards: [fromScreen(CLAUDE(wt2), "Claude Code", "scr-t8-1", "t8")], rows: [{ ...row, ref: "SHOP-2", id: 2, worker: "t8", worktree: wt2 }] });
  expect(next.snap.needs[0].question.trust).toBeDefined();
  expect(next.snap.needs[0].question.trust!.tip).toBeUndefined();
  await expect(tipCopied(c.shared, { type: "trust-tip" })).rejects.toThrow("Not a tip.");
});

test("its Codex reviewer's screen is its task's repo too", () => {
  const q = tipOn(fromScreen(CODEX(WT, "/home/me/dev/shop"), "Codex", "scr-t9-1", "t9"), [reviewer]);
  expect(q.trust.tip).toMatchObject({ command: "cd /home/me/dev/shop && codex" });
});

// Pins: what the tip relies on in upstream's code. If one fails, upstream changed it: adapt service/trust-tip.ts.
test("pins: the trust screen's folder, the reviewer's --add-dir and the worktree layout", () => {
  expect(trustOf(fromScreen(CLAUDE(WT), "Claude Code"))).toMatchObject({ folder: WT });
  const settings = readFileSync(join(ROOT, "mods/tasks/bin/herdr_task/settings.py"), "utf8");
  expect(settings).toContain(`a += ["--add-dir=" + TEMPLATES]`);
  // a task's worktree is a git worktree of its list's folder (the main checkout), under the worktree root
  const launch = readFileSync(join(ROOT, "mods/tasks/bin/herdr_task/launch.py"), "utf8");
  expect(launch).toContain("path = os.path.join(root, os.path.basename(main), ");
  const compat = readFileSync(join(ROOT, "service/compat.ts"), "utf8");
  expect(compat).toContain("allows: TRUST.allows, ...this.trustTipOf(c, trust.folder) }");
});
