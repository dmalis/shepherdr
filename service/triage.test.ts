// Triage (#235): the service's part. The app's yes is kept only here, bound to the draft's exact text and the same hash
// herdr-task computes; another machine's Post it is fenced off once Triage files the repo; the publisher's tick runs at
// most every 10 minutes, only while its plugin is on. A throwaway store; made-up names only.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Feedback, type Runner } from "./feedback.ts";
import { answerBatch, answerCard, batchHash, CHANGED, itemId, PASS_S, destination, fenced, followLevel, keepYes, legacyFenced, PUBLISH_EVERY, Publisher, shown, TriageView, triageWhy, viewOf, yesHash } from "./triage.ts";

const REPO = "acme/shepherdr";
const SETTINGS = { everywhere: { agents: { feedback_repo: REPO } } };
const BODY = "## What happened\n\nNo quote.";
const MARK = "<!-- shepherdr-feedback a1 rev 2 0123456789abcdef -->";

function store(opts: { fenced?: boolean; draft?: Record<string, unknown> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "triage-"));
  const draft = { rev: 2, target: { repo: REPO, action: "create" }, title: "Reply bubble hides its message", body: `${BODY}\n\n${MARK}`, by: "triage", ...opts.draft };
  writeFileSync(join(dir, ".feedback.json"), JSON.stringify({ problems: { a1: { id: "a1", line: "x", state: "found", draft } } }));
  if (opts.fenced !== false) writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 } } } }));
  return dir;
}
const yeses = (dir: string) => JSON.parse(readFileSync(join(dir, ".triage-yes.json"), "utf8")).yes;

test("the hash is herdr-task's own (triage.yes_hash), on the text as the person read it", () => {
  // the same inputs as herdr-task gives: ec01… and 6d1a… (test/test_triage.py's yes_hash)
  expect(yesHash({ repo: "Acme/Shepherdr", action: "create" }, "Reply bubble hides its message", shown(`${BODY}\n\n${MARK}`)))
    .toBe("ec01686c7549df6c9ef12deadafa123229241953efeca6b981a9b25fab9b21d0");
  expect(yesHash({ repo: REPO, action: "comment", issue: 12 }, "", "Same here.")).toBe("6d1a2908fd9be018beb9b9e7209f4483e72dc6522e67ccd1d93c3733cacd84ae");
});

test("the destination fails closed: upstream, a bad value or none is no destination", () => {
  expect(destination(SETTINGS)).toBe(REPO);
  expect(destination({ everywhere: { agents: { feedback_repo: `https://github.com/${REPO}` } } })).toBe(REPO);
  for (const v of [undefined, "", "eliasstravik/shepherdr", "EliasStravik/Shepherdr", "not a repo", 5])
    expect(destination({ everywhere: { agents: { feedback_repo: v } } })).toBeNull();
});

test("the app's yes is kept owner-only for the draft's revision and exact text, once, and only for a repo Triage files", () => {
  const dir = store();
  expect(keepYes("a1", 2, dir, SETTINGS, 5)).toBe(true);
  const [y] = yeses(dir);
  expect(y).toEqual({ kind: "draft", repo: REPO, key: "a1", rev: 2, hash: yesHash({ repo: REPO, action: "create" }, "Reply bubble hides its message", BODY), at: 5, by: "app", from: "card" });
  expect(statSync(join(dir, ".triage-yes.json")).mode & 0o777).toBe(0o600);
  expect(keepYes("a1", 2, dir, SETTINGS, 9)).toBe(true);
  expect(yeses(dir)).toHaveLength(1);
  expect(keepYes("a1", 3, dir, SETTINGS)).toBe(false);                          // not the stored revision
  expect(keepYes("../x", 2, dir, SETTINGS)).toBe(false);
  expect(keepYes("a1", 2, store({ fenced: false }), SETTINGS)).toBe(false);     // Triage doesn't file it: the old way
  expect(keepYes("a1", 2, store({ draft: { target: { repo: "eliasstravik/shepherdr", action: "create" } } }), SETTINGS)).toBe(false);
  expect(keepYes("a1", 2, store(), {})).toBe(false);                            // no destination
});

test("a record that can't be read counts as fenced", () => {
  const dir = store({ fenced: false });
  expect(fenced(REPO, dir)).toBe(false);
  writeFileSync(join(dir, ".triage.json"), "{not json");
  expect(fenced(REPO, dir)).toBe(true);
  expect(fenced(null, dir)).toBe(false);
});

test("the old posting stays fenced whatever the destination: Triage on anywhere, or any repo its record fenced", () => {
  const off = store({ fenced: false });
  expect(legacyFenced({}, off)).toBe(false);
  expect(legacyFenced({ repos: { "vm-a:/srv/x": { triage: { level: "score" } } } }, off)).toBe(true);  // a linked machine's
  expect(legacyFenced({ repos: { "/srv/x": { triage: { level: "off" } } } }, off)).toBe(false);
  expect(legacyFenced({ everywhere: { agents: {} } }, store())).toBe(true);                            // destination cleared
  writeFileSync(join(off, ".triage.json"), "{not json");
  expect(legacyFenced({}, off)).toBe(true);
});

test("the Feedback page: Post it keeps the app's yes here, and another machine's Post it is fenced off", async () => {
  const dir = store();
  const calls: string[][] = [];
  const run: Runner = async (args) => { calls.push(args); return { code: 0, stdout: args.includes("--approve") ? JSON.stringify({ key: "a1", approved: 2, changed: true }) : "[]", stderr: "" }; };
  const fb = new Feedback(run, () => join(dir, ".feedback.json"), () => SETTINGS, () => true);
  let kept = 0;
  fb.yesKept = () => { kept++; };
  expect(await fb.act({ do: "approve", key: "a1", rev: 2 })).toMatchObject({ ok: true });
  expect(kept).toBe(1);
  expect(yeses(dir)[0].rev).toBe(2);
  const there = await fb.act({ do: "approve", key: "b1", rev: 1, machine: "vm-b" });
  expect(there).toEqual({ ok: false, error: "Triage files this repo's findings." });
  expect(calls.filter((c) => c.includes("b1"))).toEqual([]);
});

test("the publisher runs at most every 10 minutes, soon after a yes, never while its plugin is off, with the other machines' lists", async () => {
  const dir = mkdtempSync(join(tmpdir(), "triage-pub-"));
  const calls: string[][] = [];
  let on = true;
  const p = new Publisher(async (args) => { calls.push(args); return { code: 0, stdout: "{}", stderr: "" }; },
    () => ({ "vm-b": [{ id: "b1", line: "Search misses archived spaces" }] }), () => on, () => join(dir, "there.json"));
  expect(await p.tick(1_000_000)).toBe(true);
  expect(calls[0]).toEqual(["triage", "publish", "--there", join(dir, "there.json"), "--for", String(PASS_S), "--json"]);
  expect(JSON.parse(readFileSync(join(dir, "there.json"), "utf8"))["vm-b"][0].id).toBe("b1");
  expect(await p.tick(1_000_000 + PUBLISH_EVERY - 1)).toBe(false);
  expect(await p.tick(1_000_000 + 60_000, true)).toBe(true);
  on = false;
  expect(await p.tick(1_000_000 + 10 * PUBLISH_EVERY, true)).toBe(false);
  expect(calls).toHaveLength(2);
});

/* ---------- the yes cards (Needs you) ---------- */

const HASH = () => yesHash({ repo: REPO, action: "create" }, "Reply bubble hides its message", BODY);

test("a card's Yes or No is kept here only, for the exact text it showed; a changed text keeps nothing and asks again", () => {
  const dir = store();
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "no" }, dir, SETTINGS, 7)).toEqual({ ok: true });
  expect(yeses(dir)).toEqual([{ kind: "draft", repo: REPO, key: "a1", rev: 2, hash: HASH(), at: 7, by: "app", from: "card", answer: "no" }]);
  expect(statSync(join(dir, ".triage-yes.json")).mode & 0o777).toBe(0o600);
  // the text changed after the card was drawn: the card's hash no longer matches
  const old = store();
  const r = answerCard({ kind: "draft", key: "a1", rev: 2, hash: yesHash({ repo: REPO, action: "create" }, "An older title", BODY), answer: "yes" }, old, SETTINGS);
  expect(r).toEqual({ ok: false, error: CHANGED, changed: true });
  expect(answerCard({ kind: "draft", key: "a1", rev: 1, hash: HASH(), answer: "yes" }, old, SETTINGS)).toMatchObject({ changed: true });
  expect(() => readFileSync(join(old, ".triage-yes.json"))).toThrow();
});

test("a held draft's own Yes in the backlog's review says so (it posts at the batch's pace); its card elsewhere doesn't", () => {
  const dir = store();
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes", from: "backlog" }, dir, SETTINGS, 7)).toEqual({ ok: true });
  expect(yeses(dir)).toEqual([{ kind: "draft", repo: REPO, key: "a1", rev: 2, hash: HASH(), at: 7, by: "app", from: "backlog" }]);
  // the same draft's own card in Needs you, or anything else the page sends: the everyday pace
  for (const from of [undefined, "card", "batch", 1]) {
    const d = store();
    expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes", from }, d, SETTINGS, 7).ok).toBe(true);
    expect(yeses(d)[0]).toMatchObject({ from: "card" });
    expect(yeses(d)[0].batch).toBeUndefined();
  }
  // a comment has no pace of its own to take: never marked as the backlog's
  const T = { repo: REPO, action: "comment", issue: 12 };
  const c = store({ draft: { target: T } });
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: yesHash(T, "Reply bubble hides its message", BODY), answer: "yes", from: "backlog" }, c, SETTINGS).ok).toBe(true);
  expect(yeses(c)[0]).toMatchObject({ from: "card" });
});

test("a card's answer is refused when it isn't Triage's to keep", () => {
  for (const b of [{}, { kind: "draft", key: "a1", rev: 2, hash: "x", answer: "yes" }, { kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "maybe" },
    { kind: "draft", key: "../a1", rev: 2, hash: HASH(), answer: "yes" }, { kind: "other", hash: HASH(), answer: "yes" }])
    expect(answerCard(b, store(), SETTINGS).ok).toBe(false);
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes" }, store({ fenced: false }), SETTINGS).ok).toBe(false);
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes" }, store(), {}).ok).toBe(false);
});

test("another machine's held draft is answered on Triage's copy of it", () => {
  const dir = store();
  writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 } } },
    copies: { "vm-b:b1": { id: "b1", draft: { rev: 1, target: { repo: REPO, action: "create" }, title: "T", body: "B" } } } }));
  const hash = yesHash({ repo: REPO, action: "create" }, "T", "B");
  expect(answerCard({ kind: "draft", key: "vm-b:b1", copy: true, rev: 1, hash, answer: "yes" }, dir, SETTINGS, 3).ok).toBe(true);
  expect(yeses(dir)[0]).toMatchObject({ key: "vm-b:b1", rev: 1, hash });
  expect(answerCard({ kind: "draft", key: "vm-b:b1", rev: 1, hash, answer: "yes" }, dir, SETTINGS).ok).toBe(false); // not a copy: no such finding
});

test("an outside issue's Start a fix is kept for its title and body as Triage asked it", () => {
  const dir = store();
  writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 }, asks: { "12": { title: "Search misses archived", body: "Steps", at: 4 } } } } }));
  const hash = yesHash({ repo: REPO, action: "start", issue: 12 }, "Search misses archived", "Steps");
  expect(answerCard({ kind: "start", issue: 12, hash, answer: "yes" }, dir, SETTINGS, 5)).toEqual({ ok: true });
  expect(yeses(dir)).toEqual([{ kind: "start", repo: REPO, issue: 12, hash, at: 5, by: "app", answer: "yes" }]);
  expect(answerCard({ kind: "start", issue: 12, hash: yesHash({ repo: REPO, action: "start", issue: 12 }, "Search misses archived", "Steps, edited"), answer: "yes" }, dir, SETTINGS)).toMatchObject({ changed: true });
  expect(answerCard({ kind: "start", issue: 13, hash, answer: "yes" }, dir, SETTINGS).ok).toBe(false);
});

test("the view reads herdr-task's only while the plugin is on, and keeps only what the page shows", async () => {
  const calls: string[][] = [];
  let on = true;
  const out = { on: true, destination: REPO, files: REPO, repos: [{ folder: "/r", repo: REPO, stopped: null, schedule: { id: "|/r|a1", auto: "a1", paused: false, space: "sp1", by: null } }],
    drafts: [{ key: "a1", copy: false, rev: 2, title: "T", body: "B", target: { repo: REPO }, hash: "h".repeat(64), at: 9, why: "space", secret: "never shown" }],
    starts: [{ issue: 12, title: "S", body: "Steps", at: 3, hash: "s".repeat(64) }] };
  const v = new TriageView(async (args) => { calls.push(args); return { code: 0, stdout: JSON.stringify(out), stderr: "" }; }, () => ["/r"], () => on);
  let changed = 0;
  v.changed = () => changed++;
  await v.read();
  expect(calls[0]).toEqual(["triage", "view", "--json", "--folder", "/r"]);
  expect(v.last?.files).toBe(REPO);
  expect(v.last?.repos["/r"]?.schedule).toEqual({ id: "|/r|a1", paused: false, space: "sp1", by: null });
  expect(v.last?.cards.map((c) => c.id)).toEqual(["start:12", "draft:f:a1"]);
  expect(JSON.stringify(v.last)).not.toContain("never shown");
  expect(changed).toBe(1);
  on = false;
  await v.read();
  expect(calls).toHaveLength(1);
  expect(v.last).toBeNull();
  expect(viewOf({ drafts: [{ key: 5 }], starts: [{ issue: "x" }], repos: "no" }).cards).toEqual([]);
});

test("the schedule follows the level saved, its space herdr-task's own pick (as a plain terminal's)", async () => {
  const calls: string[][] = [];
  const ok = await followLevel("/r", async (args) => { calls.push(args); return { code: 0, stdout: '{"ok": true}', stderr: "" }; });
  expect(ok).toEqual({ ok: true });
  expect(calls[0]).toEqual(["triage", "schedule", "--folder", "/r", "--json"]);
  const no = await followLevel("/r", async () => ({ code: 1, stdout: "", stderr: "herdr-task: No space sits on this checkout's folder" }));
  expect(no).toEqual({ ok: false, error: "Saved, but its schedule wasn't made: No space sits on this checkout's folder" });
  expect((await followLevel("vm-b:/r")).ok).toBe(false);
});

test("a level is saved only for a listed checkout of the repo Triage files, as its view knows it", () => {
  const view = { destination: REPO, files: REPO, cards: [], repos: { "/r": { repo: "Acme/Shepherdr", stopped: null, schedule: null },
    "/plain": { repo: null, stopped: null, schedule: null }, "/other": { repo: "acme/site", stopped: null, schedule: null } } };
  const here = ["/r", "/plain", "/other", "/new"];
  expect(triageWhy("/r", here, view)).toBeNull();
  expect(triageWhy("/plain", here, view)).toContain("no GitHub remote");
  expect(triageWhy("/other", here, view)).toContain("only in acme/shepherdr");
  expect(triageWhy("/new", here, view)).toContain("still reading");
  expect(triageWhy("/r", here, null)).toContain("still reading");
  expect(triageWhy("/elsewhere", here, view)).toContain("this machine's repos");
  expect(triageWhy("vm-b:/r", ["vm-b:/r"], view)).toContain("this machine's repos");
  expect(triageWhy("/r", here, { ...view, destination: null })).toContain("nowhere to go");
});

test("a card is answered once for its text: the same answer again changes nothing, the other one is refused", () => {
  const dir = store();
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "no" }, dir, SETTINGS, 7)).toEqual({ ok: true });
  // another screen still showed the card: its Yes doesn't overturn the No
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes" }, dir, SETTINGS, 8)).toMatchObject({ ok: false, error: expect.stringContaining("already said No") });
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "no" }, dir, SETTINGS, 9)).toEqual({ ok: true });
  expect(yeses(dir)).toEqual([{ kind: "draft", repo: REPO, key: "a1", rev: 2, hash: HASH(), at: 7, by: "app", from: "card", answer: "no" }]);
  // a Not now or Never since (unyes) takes the earlier answer back: the card may be answered again
  const p = JSON.parse(readFileSync(join(dir, ".feedback.json"), "utf8"));
  p.problems.a1.unyes = 10;
  writeFileSync(join(dir, ".feedback.json"), JSON.stringify(p));
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes" }, dir, SETTINGS, 11).ok).toBe(true);
  // a start card too
  writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 }, asks: { "12": { title: "S", body: "B", at: 4 } } } } }));
  const h = yesHash({ repo: REPO, action: "start", issue: 12 }, "S", "B");
  expect(answerCard({ kind: "start", issue: 12, hash: h, answer: "yes" }, dir, SETTINGS, 12).ok).toBe(true);
  expect(answerCard({ kind: "start", issue: 12, hash: h, answer: "no" }, dir, SETTINGS, 13)).toMatchObject({ ok: false, error: expect.stringContaining("already said Yes") });
});

test("a finding that no longer waits takes no answer: posted, filed, done on its own machine", () => {
  for (const extra of [{ post: { state: "posted" } }, { state: "filed" }, { decision: "following" }, { joined: true }]) {
    const dir = store();
    const p = JSON.parse(readFileSync(join(dir, ".feedback.json"), "utf8"));
    Object.assign(p.problems.a1, extra);
    writeFileSync(join(dir, ".feedback.json"), JSON.stringify(p));
    expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "yes" }, dir, SETTINGS).ok).toBe(false);
  }
  const dir = store();
  writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 } } },
    copies: { "vm-b:b1": { id: "b1", there_done: true, draft: { rev: 1, target: { repo: REPO, action: "create" }, title: "T", body: "B" } } } }));
  expect(answerCard({ kind: "draft", key: "vm-b:b1", copy: true, rev: 1, hash: yesHash({ repo: REPO, action: "create" }, "T", "B"), answer: "yes" }, dir, SETTINGS).ok).toBe(false);
});

test("a full answer file drops retired rows first: a No still in force stays", () => {
  const dir = store();
  expect(answerCard({ kind: "draft", key: "a1", rev: 2, hash: HASH(), answer: "no" }, dir, SETTINGS, 1).ok).toBe(true);
  const old = Array.from({ length: 1060 }, (_, i) => ({ kind: "draft", repo: REPO, key: `gone${i}`, rev: 1, hash: "f".repeat(64), at: 2 + i, by: "app" }));
  writeFileSync(join(dir, ".triage-yes.json"), JSON.stringify({ yes: [...yeses(dir), ...old] }));
  writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 }, asks: { "12": { title: "S", body: "B", at: 4 } } } } }));
  expect(answerCard({ kind: "start", issue: 12, hash: yesHash({ repo: REPO, action: "start", issue: 12 }, "S", "B"), answer: "no" }, dir, SETTINGS, 9999).ok).toBe(true);
  const rows = yeses(dir);
  expect(rows).toHaveLength(1000);
  expect(rows[0]).toMatchObject({ key: "a1", answer: "no" });
  expect(rows[rows.length - 1]).toMatchObject({ kind: "start", issue: 12 });
});

test("the view: off then on reads again, and a read asked for during one follows it", async () => {
  let on = true, n = 0, release: () => void = () => {};
  const out = { on: true, destination: REPO, files: REPO, repos: [], drafts: [], starts: [] };
  const v = new TriageView(async () => { n++; if (n === 2) await new Promise<void>((r) => (release = r)); return { code: 0, stdout: JSON.stringify(out), stderr: "" }; }, () => [], () => on);
  on = false;
  await v.read();
  expect(n).toBe(0);
  on = true;
  await v.read();
  expect(n).toBe(1);
  expect(v.last?.files).toBe(REPO);
  // an answer's read while the 2-minute one runs: one more read after it, not lost
  const first = v.read();
  await Promise.resolve();
  const second = v.read();
  release();
  await Promise.all([first, second]);
  expect(n).toBe(3);
});

test("a card carries where it goes, and no Yes for words it couldn't carry whole", () => {
  const big = "x".repeat(70_000);
  const v = viewOf({ files: REPO, drafts: [
    { key: "a1", rev: 2, title: "T", body: "B", target: { repo: REPO, action: "comment", issue: 12 }, hash: yesHash({ repo: REPO, action: "comment", issue: 12 }, "T", "B"), at: 1 },
    { key: "a2", rev: 1, title: "T", body: big, target: { repo: REPO, action: "create" }, hash: yesHash({ repo: REPO, action: "create" }, "T", big), at: 2 },
    { key: "a3", rev: 1, title: "T", body: "B", target: { repo: REPO, action: "comment" }, hash: "c".repeat(64), at: 3 }],
    starts: [{ issue: 12, title: "S", body: "B", at: 4, hash: yesHash({ repo: REPO, action: "start", issue: 12 }, "S", "B") }] });
  expect(v.cards.map((c) => [c.id, c.action, c.issue, !!c.cut])).toEqual([["draft:f:a1", "comment", 12, false], ["draft:f:a2", "create", undefined, true], ["start:12", undefined, 12, false]]);
});
