// Triage (#235): the service's part. The app's yes is kept only here, bound to the draft's exact text and the same hash
// herdr-task computes; another machine's Post it is fenced off once Triage files the repo; the publisher's tick runs at
// most every 10 minutes, only while its plugin is on. A throwaway store; made-up names only.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Feedback, type Runner } from "./feedback.ts";
import { destination, fenced, keepYes, legacyFenced, PUBLISH_EVERY, Publisher, shown, yesHash } from "./triage.ts";

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
  expect(y).toEqual({ kind: "draft", repo: REPO, key: "a1", rev: 2, hash: yesHash({ repo: REPO, action: "create" }, "Reply bubble hides its message", BODY), at: 5, by: "app" });
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
  expect(calls[0]).toEqual(["triage", "publish", "--there", join(dir, "there.json"), "--json"]);
  expect(JSON.parse(readFileSync(join(dir, "there.json"), "utf8"))["vm-b"][0].id).toBe("b1");
  expect(await p.tick(1_000_000 + PUBLISH_EVERY - 1)).toBe(false);
  expect(await p.tick(1_000_000 + 60_000, true)).toBe(true);
  on = false;
  expect(await p.tick(1_000_000 + 10 * PUBLISH_EVERY, true)).toBe(false);
  expect(calls).toHaveLength(2);
});
