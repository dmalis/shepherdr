// The trust card's per-repo tip (fork patch, dmalis/shepherdr#62): a task's agent or reviewer at its CLI's
// folder-trust screen gets, on its card, the command that trusts the repo's main checkout once, for each CLI, on the
// task's machine, and it shows once per repo. Fake data, made-up paths.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import { markSeen, SEEN_KEY, shellWord, tipCopied, tipFolder, trustTip } from "./trust-tip.ts";
import { trustOf } from "../core/screens.js";

const ROOT = join(import.meta.dir, "..");
const WT = "/home/me/.local/share/shepherdr/worktrees/shop/fix-the-cart";
const row = { ref: "SHOP-1", slug: "dev-shop", id: 1, title: "Fix the cart", section: "needs", needs: "asks", sub: "Asks to trust this folder",
  machine: null as string | null, folder: "/home/me/dev/shop", worktree: WT, list: "shop", kind: "repo", space: "sp1", worker: "t7", started: 500 };
const screen = (folder: string, cli = "Claude Code") => ({ id: "scr-t7-1", addr: "t7", cli, state: "open", opened: 1000, words: "Quick safety check",
  all: `${folder}\n\nQuick safety check: Is this a project you created or one you trust?\n\n   1. Yes, I trust this folder\n   2. No, exit`,
  choices: [{ label: "Yes, I trust this folder" }, { label: "No, exit" }], at: 0 });
const snapOf = (o: { rows?: any[]; cards?: any[]; terms?: any[]; shared?: Record<string, any>; machines?: any[] } = {}) => {
  const c = new Compat() as any;
  const terms = o.terms ?? [];
  c.terminalsOf = (a: string) => terms.find((k: any) => k.address === a) ?? null;
  c.terminalsAll = () => terms;
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  c.watch = { openCards: () => o.cards ?? [screen(WT)], openCard: () => null, cardsOf: () => [] };
  const store = { ...(o.shared ?? {}) };
  c.shared = { value: (k: string) => store[k], set: async (k: string, v: unknown) => { store[k] = v; } };
  const spaces = [{ id: "sp1", name: "shop", folder: "/home/me/dev/shop", machine: null, assistant: null }];
  return { c, store, snap: c.snapshot({ host: "mini", user: "me", machines: o.machines ?? [], spaces, sections: [], rows: o.rows ?? [row] }) };
};

test("Claude Code in a task worktree: trust the repo's main checkout, on this machine", () => {
  const t = trustTip({ cli: "Claude Code", screen: WT, row, here: "mini", card: "c1" })!;
  expect(t).toMatchObject({ key: "mini:/home/me/dev/shop", machine: "mini", folder: "/home/me/dev/shop", command: "cd /home/me/dev/shop && claude",
    lead: "Trust this repo once, so its next tasks don't ask:", then: "answer “Yes, I trust this folder”, then type /exit." });
  expect(t.covers).toContain("worktrees");
});

test("Codex: its own command, the same folder (it applies a worktree's trust to the main repository's root)", () => {
  expect(trustTip({ cli: "Codex", screen: WT, row, here: "mini", card: "c1" })).toMatchObject({ command: "cd /home/me/dev/shop && codex", then: "choose to trust it, then type /exit." });
});

test("a task on another machine: that machine's name and paths", () => {
  const far = { ...row, machine: "vm", folder: "/srv/me/shop", worktree: "/srv/me/.local/share/shepherdr/worktrees/shop/fix" };
  expect(trustTip({ cli: "Claude Code", screen: far.worktree, row: far, here: "mini", card: "c1" })).toMatchObject({ key: "vm:/srv/me/shop", machine: "vm", command: "cd /srv/me/shop && claude" });
});

test("the reviewer's extra folder asks: the line names that folder", () => {
  const tpl = "/home/me/.config/herdr-core/templates";
  const t = trustTip({ cli: "Claude Code", screen: tpl, row, here: "mini", card: "c1" })!;
  expect(t).toMatchObject({ folder: tpl, command: `cd ${tpl} && claude`, lead: "Trust the reviewer's instructions folder once, so later reviews don't ask:" });
  expect(t.covers).toBeUndefined();
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

test("once per repo: copied on one card, that card keeps it and the repo's later cards leave it out", () => {
  const seen = markSeen(undefined, "mini:/home/me/dev/shop", "c1", 5);
  expect(seen).toEqual({ "mini:/home/me/dev/shop": { at: 5, card: "c1" } });
  expect(markSeen(seen, "mini:/home/me/dev/shop", "c2", 9)).toEqual(seen); // the first copy is the one kept
  expect(trustTip({ cli: "Claude Code", screen: WT, row, here: "mini", card: "c1", seen })).not.toBeNull();
  expect(trustTip({ cli: "Claude Code", screen: WT, row, here: "mini", card: "c2", seen })).toBeNull();
  // another repo, or the same folder on another machine, still gets its own
  expect(trustTip({ cli: "Claude Code", screen: null, row: { ...row, folder: "/home/me/dev/blog" }, here: "mini", card: "c2", seen })).not.toBeNull();
  expect(trustTip({ cli: "Claude Code", screen: null, row: { ...row, machine: "vm" }, here: "mini", card: "c2", seen })).not.toBeNull();
});

test("it keeps the newest few hundred", () => {
  let seen: any = {};
  for (let i = 0; i < 205; i++) seen = markSeen(seen, `mini:/r${i}`, `c${i}`, i);
  expect(Object.keys(seen)).toHaveLength(200);
  expect(seen["mini:/r0"]).toBeUndefined();
  expect(seen["mini:/r204"]).toBeDefined();
});

test("the task's Needs you card carries the tip; copying it (the action) hides it on the repo's next card", async () => {
  const { snap, c, store } = snapOf();
  const tip = snap.needs[0].question.trust!.tip!;
  expect(tip).toMatchObject({ key: "mini:/home/me/dev/shop", command: "cd /home/me/dev/shop && claude" });
  expect(await tipCopied(c.shared, { type: "trust-tip", key: tip.key, card: "scr-t7-1" })).toEqual({ ok: true });
  expect(Object.keys(store[SEEN_KEY])).toEqual(["mini:/home/me/dev/shop"]);
  expect(snapOf({ shared: store }).snap.needs[0].question.trust!.tip).toBeDefined(); // the same card still shows it
  const next = snapOf({ shared: store, cards: [{ ...screen(WT.replace("fix-the-cart", "add-search")), id: "scr-t8-1", addr: "t8" }],
    rows: [{ ...row, ref: "SHOP-2", id: 2, worker: "t8", worktree: WT.replace("fix-the-cart", "add-search") }] });
  expect(next.snap.needs[0].question.trust).toBeDefined();
  expect(next.snap.needs[0].question.trust!.tip).toBeUndefined();
  await expect(tipCopied(c.shared, { type: "trust-tip" })).rejects.toThrow("Not a tip.");
});

test("a Claude reviewer's --add-dir screen (it holds only for the session) is a trust card whose tip names the templates folder", () => {
  // Claude Code 2.1.332's words, the folder made up
  const tpl = "/home/me/.config/herdr-core/templates";
  const all = [" Adding a new directory:", ` ${tpl}`, " This session hasn't worked here before. Is this a directory you created or one you trust?",
    " Claude Code'll be able to read, edit, and execute files here. Your answer holds for this session. Starting Claude Code in this directory and trusting it there lasts, and covers its whole repository or everything below it.",
    " ❯ No, exit", "   Yes, add it"].join("\n");
  const card = { ...screen(WT), id: "scr-t9-1", addr: "t9", words: "Adding a new directory:", all, choices: [{ label: "No, exit" }, { label: "Yes, add it" }] };
  expect(trustOf(card)).toEqual({ yes: 1, no: 0, folder: tpl });
  const reviewer = { address: "t9", parent: "t7", labels: { "herdr.role": "reviewer" }, state: "live" };
  const q = snapOf({ terms: [reviewer], cards: [card] }).snap.needs[0].question;
  expect(q.title).toBe("Trust this folder?");
  expect(q.trust!.tip).toMatchObject({ folder: tpl, command: `cd ${tpl} && claude` });
});

test("its reviewer's screen is its task's repo too", () => {
  const reviewer = { address: "t9", parent: "t7", labels: { "herdr.role": "reviewer" }, state: "live" };
  const { snap } = snapOf({ terms: [reviewer], cards: [{ ...screen(WT, "Codex"), id: "scr-t9-1", addr: "t9" }] });
  expect(snap.needs[0].question.trust!.tip).toMatchObject({ command: "cd /home/me/dev/shop && codex" });
});

// Pins: what the tip relies on in upstream's code. If one fails, upstream changed it: adapt service/trust-tip.ts.
test("pins: the trust screen's folder, the reviewer's --add-dir templates folder and the worktree layout", () => {
  expect(trustOf(screen(WT))).toMatchObject({ folder: WT });
  const settings = readFileSync(join(ROOT, "mods/tasks/bin/herdr_task/settings.py"), "utf8");
  expect(settings).toContain(`"herdr-core", "templates")`);
  expect(settings).toContain(`a += ["--add-dir=" + TEMPLATES]`);
  // a task's worktree is a git worktree of its list's folder (the main checkout), under the worktree root
  const launch = readFileSync(join(ROOT, "mods/tasks/bin/herdr_task/launch.py"), "utf8");
  expect(launch).toContain("path = os.path.join(root, os.path.basename(main), ");
  const compat = readFileSync(join(ROOT, "service/compat.ts"), "utf8");
  expect(compat).toContain("allows: TRUST.allows, ...this.trustTipOf(c, trust.folder) }");
});
