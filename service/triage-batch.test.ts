// Triage's batch yes (#235, "The backlog"): one Yes in the app for the drafts the batch card lists, bound to the hash of
// their exact drafts and revisions. Unticked drafts keep waiting, a draft changed since drops out, the drafts the privacy
// check held back are never in the batch, and the publisher's tick keeps going while a batch has more. A throwaway
// store; made-up names only.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerBatch, answerCard, batchHash, itemId, PASS_S, Publisher, viewOf, yesHash } from "./triage.ts";

const REPO = "acme/shepherdr";
const SETTINGS = { everywhere: { agents: { feedback_repo: REPO } } };
const T = { repo: REPO, action: "create" };
const MARK = (k: string, rev: number) => `<!-- shepherdr-feedback ${k} rev ${rev} 0123456789abcdef -->`;

/** n findings with Triage drafts, this machine's, and one copy of another machine's */
function store(n: number) {
  const dir = mkdtempSync(join(tmpdir(), "triage-batch-"));
  const problems: Record<string, unknown> = {};
  for (let i = 1; i <= n; i++) problems[`k${i}`] = { id: `k${i}`, line: `Problem ${i}`, state: "told", draft: { rev: 1, target: T, title: `Problem ${i}`, body: `Body ${i}\n\n${MARK(`k${i}`, 1)}`, by: "triage" } };
  writeFileSync(join(dir, ".feedback.json"), JSON.stringify({ problems }));
  writeFileSync(join(dir, ".triage.json"), JSON.stringify({ repos: { [REPO]: { fenced: { at: 1 } } },
    copies: { "vm-b:c1": { id: "vm-b:c1", line: "Copied", _copy: true, draft: { rev: 1, target: T, title: "Copied", body: "Copied body", by: "triage" } } } }));
  return dir;
}
/** herdr-task's view of those drafts: all in the batch but the ones named private */
const drafts = (n: number, priv: string[] = []) => [
  ...Array.from({ length: n }, (_, i) => ({ key: `k${i + 1}`, copy: false, rev: 1, title: `Problem ${i + 1}`, body: `Body ${i + 1}`, target: T, kind: i % 2 ? "manual" : "bug",
    hash: yesHash(T, `Problem ${i + 1}`, `Body ${i + 1}`), at: i + 1, why: "unknown",
    ...(priv.includes(`k${i + 1}`) ? { found: ["an IP address, line 2"], batch: false } : { batch: true }) })),
  { key: "vm-b:c1", copy: true, rev: 1, title: "Copied", body: "Copied body", target: T, hash: yesHash(T, "Copied", "Copied body"), at: 0, why: "machine", batch: true }];
const yeses = (dir: string) => JSON.parse(readFileSync(join(dir, ".triage-yes.json"), "utf8")).yes;

test("150 waiting drafts are one batch card, never 150; the privacy check's held-back ones keep their own", () => {
  const v = viewOf({ files: REPO, drafts: drafts(150, ["k7", "k9"]) });
  const batch = v.cards.filter((c) => c.kind === "batch");
  expect(batch).toHaveLength(1);
  expect(batch[0]!.items).toHaveLength(149);
  expect(batch[0]!.items!.some((x) => x.key === "k7" || x.key === "k9")).toBe(false);
  expect(v.cards.filter((c) => c.kind === "draft").map((c) => c.key)).toEqual(["k7", "k9"]);
  expect(batch[0]!.hash).toBe(batchHash(REPO, batch[0]!.items!));
});

test("the batch hash is bound to every draft's finding, revision and text, in any order", () => {
  const v = viewOf({ files: REPO, drafts: drafts(3) });
  const items = v.cards[0]!.items!;
  expect(batchHash(REPO, [...items].reverse())).toBe(batchHash(REPO, items));
  expect(batchHash(REPO, items.map((x, i) => (i ? x : { ...x, rev: 2 })))).not.toBe(batchHash(REPO, items));
  expect(batchHash(REPO, items.map((x, i) => (i ? x : { ...x, hash: "e".repeat(64) })))).not.toBe(batchHash(REPO, items));
  expect(batchHash(REPO, items.slice(1))).not.toBe(batchHash(REPO, items));
  // a draft whose words the check held back never joins, whatever herdr-task said of it
  const odd = viewOf({ files: REPO, drafts: [{ ...drafts(1)[0]!, found: ["a home path, line 1"], batch: true }] });
  expect(odd.cards.map((c) => c.kind)).toEqual(["draft"]);
});

test("one Yes keeps the ticked drafts, each bound to its revision, text and the batch; an unticked one keeps waiting", () => {
  const dir = store(4);
  const v = viewOf({ files: REPO, drafts: drafts(4) });
  const c = v.cards[0]!;
  const out = answerBatch({ answer: "yes", hash: c.hash, skip: ["f:k2"] }, v, dir, SETTINGS, 50);
  expect(out).toEqual({ ok: true, kept: 4, changed: 0 });
  const rows = yeses(dir);
  expect(rows.map((y: any) => y.key).sort()).toEqual(["k1", "k3", "k4", "vm-b:c1"]);
  for (const y of rows) expect(y).toMatchObject({ kind: "draft", repo: REPO, rev: 1, by: "app", batch: c.hash, at: 50 });
  expect(rows.find((y: any) => y.key === "k3").hash).toBe(yesHash(T, "Problem 3", "Body 3"));
  // nothing ticked: nothing kept
  expect(answerBatch({ answer: "yes", hash: c.hash, skip: c.items!.map(itemId) }, v, store(4), SETTINGS).ok).toBe(false);
});

test("a draft changed since the card was read drops out and waits again; a new list asks again", () => {
  const dir = store(3);
  const v = viewOf({ files: REPO, drafts: drafts(3) });
  const fb = JSON.parse(readFileSync(join(dir, ".feedback.json"), "utf8"));
  fb.problems.k2.draft = { ...fb.problems.k2.draft, rev: 2, body: "Body 2, said again" };
  writeFileSync(join(dir, ".feedback.json"), JSON.stringify(fb));
  const out = answerBatch({ answer: "yes", hash: v.cards[0]!.hash }, v, dir, SETTINGS, 5);
  expect(out).toEqual({ ok: true, kept: 3, changed: 1 });
  expect(yeses(dir).map((y: any) => y.key)).not.toContain("k2");
  // the card the person read isn't the one shown now: nothing is kept
  const other = viewOf({ files: REPO, drafts: drafts(2) });
  expect(answerBatch({ answer: "yes", hash: v.cards[0]!.hash }, other, store(3), SETTINGS)).toMatchObject({ ok: false, changed: true });
});

test("the batch takes only what Triage may post: a draft held by the privacy check, a No, a posted one, upstream", () => {
  const dir = store(3);
  const v = viewOf({ files: REPO, drafts: drafts(3, ["k3"]) });
  const c = v.cards.find((x) => x.kind === "batch")!;
  // an item the card never listed (k3, held back) can't be smuggled in: only the card's own items are read
  expect(answerBatch({ answer: "yes", hash: c.hash, items: [{ key: "k3", copy: false, rev: 1 }] }, v, dir, SETTINGS).ok).toBe(true);
  expect(yeses(dir).map((y: any) => y.key)).not.toContain("k3");
  // a No kept for one's text stays a No
  const d2 = store(3);
  writeFileSync(join(d2, ".triage-yes.json"), JSON.stringify({ yes: [{ kind: "draft", repo: REPO, key: "k1", rev: 1, hash: yesHash(T, "Problem 1", "Body 1"), at: 3, by: "app", answer: "no" }] }));
  expect(answerBatch({ answer: "yes", hash: c.hash }, v, d2, SETTINGS, 9)).toEqual({ ok: true, kept: 2, changed: 1 });
  expect(yeses(d2).find((y: any) => y.key === "k1").answer).toBe("no");
  // posting already: never a second yes
  const d3 = store(3);
  const fb = JSON.parse(readFileSync(join(d3, ".feedback.json"), "utf8"));
  fb.problems.k1.post = { state: "posting", rev: 1 };
  writeFileSync(join(d3, ".feedback.json"), JSON.stringify(fb));
  expect(answerBatch({ answer: "yes", hash: c.hash }, v, d3, SETTINGS).kept).toBe(2);
  // only a Yes, only to the repo Triage files
  expect(answerBatch({ answer: "no", hash: c.hash }, v, store(3), SETTINGS).ok).toBe(false);
  expect(answerBatch({ answer: "yes", hash: c.hash }, v, store(3), { everywhere: { agents: { feedback_repo: "eliasstravik/shepherdr" } } }).ok).toBe(false);
});

test("the publisher's pass has its time, and a batch with more runs the next pass a minute on", async () => {
  const calls: string[][] = [];
  let more = true;
  const p = new Publisher(async (args) => { calls.push(args); return { code: 0, stdout: JSON.stringify({ posted: 40, more }), stderr: "" }; },
    () => ({}), () => true, () => join(tmpdir(), "unused.json"));
  expect(await p.tick(1_000_000)).toBe(true);
  expect(calls[0]).toEqual(["triage", "publish", "--for", String(PASS_S), "--json"]);
  expect(await p.tick(1_060_000)).toBe(true); // more: not ten minutes on
  more = false;
  expect(await p.tick(1_120_000)).toBe(true);
  expect(await p.tick(1_180_000)).toBe(false); // done: back to every ten minutes
});

test("a draft back on its own card after a batch yes takes its own No, or its own Yes, in the batch's place", () => {
  for (const answer of ["no", "yes"] as const) {
    const dir = store(2);
    const v = viewOf({ files: REPO, drafts: drafts(2) });
    expect(answerBatch({ answer: "yes", hash: v.cards[0]!.hash }, v, dir, SETTINGS, 5).ok).toBe(true);
    // the privacy check held k1 back since: its own card answers it, and its batch yes goes
    const out = answerCard({ answer, kind: "draft", key: "k1", copy: false, rev: 1, hash: yesHash(T, "Problem 1", "Body 1") }, dir, SETTINGS, 9);
    expect(out).toEqual({ ok: true });
    const k1 = yeses(dir).filter((y: any) => y.key === "k1");
    expect(k1).toHaveLength(1);
    expect(k1[0].batch).toBeUndefined();
    expect(k1[0].answer ?? "yes").toBe(answer);
  }
});

test("trimming the answers keeps every one in force, a No above all; a filed finding's yes is retired first", () => {
  const dir = store(1);
  const fb = JSON.parse(readFileSync(join(dir, ".feedback.json"), "utf8"));
  const old: any[] = [];
  for (let i = 0; i < 999; i++) {
    fb.problems[`f${i}`] = { id: `f${i}`, line: "Filed", state: "filed", draft: { rev: 1, target: T, title: "Filed", body: "B", by: "triage" } };
    old.push({ kind: "draft", repo: REPO, key: `f${i}`, rev: 1, hash: "e".repeat(64), at: 10 + i, by: "app" });
  }
  writeFileSync(join(dir, ".feedback.json"), JSON.stringify(fb));
  // k1's No, the oldest row of all, then 999 filed yeses
  writeFileSync(join(dir, ".triage-yes.json"), JSON.stringify({ yes: [{ kind: "draft", repo: REPO, key: "k1", rev: 1, hash: yesHash(T, "Problem 1", "Body 1"), at: 1, by: "app", answer: "no" }, ...old] }));
  const v = viewOf({ files: REPO, drafts: [drafts(1).at(-1)!] }); // the copy only
  expect(answerBatch({ answer: "yes", hash: v.cards[0]!.hash }, v, dir, SETTINGS, 5000)).toMatchObject({ ok: true, kept: 1 });
  const rows = yeses(dir);
  expect(rows.length).toBeLessThanOrEqual(1000);
  expect(rows.find((y: any) => y.key === "k1")).toMatchObject({ answer: "no" });
  expect(rows.find((y: any) => y.key === "vm-b:c1")).toBeTruthy();
});
