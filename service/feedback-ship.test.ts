// Friction loop, slice 6 (#94): on this machine. The page gets each fix's release and whether this machine has it
// (herdr-task lists `shipped` only for the build installed now), the person's Works and Still broken for that build, a
// row that came back, and the Fixed history. The count adds fixes here not tried yet. Made-up names only.
import { expect, test } from "bun:test";
import { argsOf, backOf, Feedback, rowsOf, sectionOf, shipOf, triedOf, type Runner } from "./feedback.ts";

const NOW = Date.UTC(2026, 10, 28, 12);
const DAY = 24 * 3600_000;
const URL = "https://github.com/acme/shep/issues/42";
const BUILD = "b".repeat(40);
const FIXED = { url: URL, issue: "acme/shep#42", state: "closed", reason: "completed", checked_at: NOW - 1000 };
const row = (x: Record<string, unknown>) => ({ id: "a1", line: "The reply bubble doesn't show which message it answers", state: "filed", count: 1,
  at: NOW - 60_000, space: "sp1", reports: [], url: URL, outcome: { ...FIXED, fix: { issue: "acme/shep#42", commit: "a".repeat(40), release: "3.2.23" } },
  here: { version: "3.2.22", build: BUILD }, ...x });
const shipped = { build: BUILD, machine: "vm-test", at: NOW - 5000, how: "release", release: "3.2.23" };

test("a fix on this machine: its release, On this machine, and what to try", () => {
  expect(shipOf(row({ shipped }))).toEqual({ release: "3.2.23", here: true });
  expect(shipOf(row({ shipped: { ...shipped, how: "install", try: "  Reply to a message: its first line shows above  " } })))
    .toEqual({ release: "3.2.23", here: true, tryIt: "Reply to a message: its first line shows above" });
});

test("a release with it that this machine is older than says update; a newer or equal one doesn't", () => {
  expect(shipOf(row({}))).toEqual({ release: "3.2.23", update: true });
  expect(shipOf(row({ here: { version: "3.2.23", build: "c".repeat(40) } }))).toEqual({ release: "3.2.23" });
  expect(shipOf(row({ here: { version: "3.10.0", build: "c".repeat(40) } }))).toEqual({ release: "3.2.23" });
});

test("no closing commit, or not closed as fixed: no ship; an unknown build lets only the person say", () => {
  expect(shipOf(row({ outcome: { ...FIXED, fix: { issue: "acme/shep#42", commit: null } }, here: { version: "3.2.22", build: BUILD } }))).toEqual({});
  expect(shipOf(row({ outcome: { ...FIXED, reason: "not_planned" } }))).toBeUndefined();
  expect(shipOf(row({ outcome: { url: URL, issue: "acme/shep#42", state: "open", checked_at: 1 } }))).toBeUndefined();
  expect(shipOf(row({ outcome: FIXED, here: { version: "3.2.22", build: null } }))).toEqual({ unknown: true });
  // a duplicate whose canonical issue closed as fixed is fixed
  const dupe = { ...FIXED, reason: "duplicate", canonical: { url: "https://github.com/acme/shep/issues/7", title: "x", repo: "acme/shep", number: 7, state: "closed", reason: "completed" } };
  expect(shipOf(row({ outcome: dupe, shipped }))?.here).toBe(true);
});

test("Works and Still broken count for the build installed now; Works stays said on a newer one", () => {
  expect(triedOf(row({ tried: { result: "works", build: BUILD, at: NOW - 5000 } }))).toEqual({ result: "works", at: NOW - 5000 });
  expect(triedOf(row({ tried: { result: "works", build: "c".repeat(40), at: NOW - 5000 } }))?.result).toBe("works");
  expect(triedOf(row({ tried: { result: "broken", build: "c".repeat(40), at: NOW - 5000 } }))).toBeUndefined();
  expect(triedOf(row({ tried: { result: "maybe", build: BUILD, at: 1 } }))).toBeUndefined();
});

test("came back: under Found, linked to its issue; Works a day ago folds under Fixed", () => {
  const back = row({ state: "found", url: undefined, back: { at: NOW, why: "broken", build: BUILD, issue: URL }, tried: { result: "broken", build: BUILD, at: NOW } });
  expect(sectionOf(back, NOW)).toBe("found");
  expect(backOf(back)).toEqual({ why: "broken", issue: URL });
  expect(backOf({ back: { why: "other" } })).toBeUndefined();
  expect(shipOf(back)).toBeUndefined();
  expect(sectionOf(row({ tried: { result: "works", build: BUILD, at: NOW - 2 * 3600_000 } }), NOW)).toBe("filed");
  expect(sectionOf(row({ tried: { result: "works", build: BUILD, at: NOW - DAY } }), NOW)).toBe("fixed");
  const list = rowsOf([row({ shipped, tried: { result: "works", build: BUILD, at: NOW - 2 * DAY } })], {}, NOW);
  expect(list.rows[0].section).toBe("fixed");
  expect(list.rows[0].outcome?.reason).toBe("completed");
});

test("the count adds fixes on this machine not tried yet; no more once tried", () => {
  const rows = [row({ id: "a1", shipped }), row({ id: "a2", shipped, tried: { result: "works", build: BUILD, at: NOW } }),
    row({ id: "a3", state: "found", url: undefined, outcome: undefined }), row({ id: "a4" })];
  expect(rowsOf(rows, {}, NOW).found).toBe(2);
});

test("Works and Still broken run herdr-task's person-only calls; a refusal says why", async () => {
  expect(argsOf({ do: "works", key: "a1" })).toEqual(["--key", "a1", "--works", "--json"]);
  expect(argsOf({ do: "broken", key: "a1" })).toEqual(["--key", "a1", "--broken", "--json"]);
  expect(() => argsOf({ do: "works", key: "../x" })).toThrow();
  const calls: string[][] = [];
  const answers = [{ key: "a1", changed: false, why: "not-here" }, { key: "a1", changed: true, tried: "broken", back: true, draft: true }];
  const run: Runner = async (args) => {
    calls.push(args);
    return { code: 0, stdout: JSON.stringify(args[0] === "--list" ? [] : answers.shift()), stderr: "" };
  };
  const f = new Feedback(run, () => "/nonexistent", () => ({}), () => true);
  expect(await f.act({ do: "works", key: "a1" })).toEqual({ ok: false, error: "Its fix isn't on this machine yet: nothing to try." });
  expect(await f.act({ do: "broken", key: "a1" })).toEqual({ ok: true, key: "a1", changed: true });
  expect(calls.filter((c) => c[0] === "--key").map((c) => c[2])).toEqual(["--works", "--broken"]);
});

test("a new install record (a new build, a rollback) makes the list read again within a tick", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const d = mkdtempSync(join(tmpdir(), "feedback-ship-"));
  writeFileSync(join(d, ".feedback.json"), "{}");
  writeFileSync(join(d, "installed.json"), JSON.stringify({ version: "3.2.22", build: "b".repeat(40) }));
  let reads = 0;
  const run: Runner = async () => { reads++; return { code: 0, stdout: "[]", stderr: "" }; };
  const f = new Feedback(run, () => join(d, ".feedback.json"), () => ({}), () => true, () => join(d, "installed.json"));
  try {
    f.start(20);
    await Bun.sleep(80);
    const was = reads;
    expect(was).toBe(1);
    writeFileSync(join(d, "installed.json"), JSON.stringify({ version: "3.2.22", build: "c".repeat(40), at: 1 }));
    await Bun.sleep(80);
    expect(reads).toBe(was + 1);
    writeFileSync(join(d, ".feedback-installed.json"), JSON.stringify({ build: "c".repeat(40), issues: {} }));
    await Bun.sleep(80);
    expect(reads).toBe(was + 2);
  } finally {
    f.stop();
    rmSync(d, { recursive: true, force: true });
  }
});
