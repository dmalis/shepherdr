// Friction loop, slice 5 (#94): follow the issue. The page gets GitHub's side of each filed or followed issue (open,
// closed and why, a duplicate's canonical issue); the service runs herdr-task's read-only --track only while something
// is followed, and the jobs run it hourly. Made-up names only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Feedback, followed, outcomeOf, rowsOf, type Runner } from "./feedback.ts";

const NOW = Date.UTC(2026, 10, 28, 12);
const URL = "https://github.com/acme/shep/issues/42";
const row = (x: Record<string, unknown>) => ({ id: "a1", line: "The reply bubble doesn't show which message it answers", state: "filed", count: 1,
  at: NOW - 60_000, space: "sp1", reports: [], url: URL, outcome: { url: URL, issue: "acme/shep#42", state: "open", checked_at: NOW - 1000 }, ...x });
const fake = (lists: unknown[][]) => {
  const calls: string[][] = [];
  const run: Runner = async (args) => {
    calls.push(args);
    return { code: 0, stdout: args[0] === "--list" ? JSON.stringify(lists.shift() ?? []) : JSON.stringify({ tracked: [], failed: [] }), stderr: "" };
  };
  return { run, calls };
};
const tracks = (calls: string[][]) => calls.filter((c) => c[0] === "--track");

test("a filed row says what GitHub said of its issue: open, closed and why, a duplicate's canonical issue", () => {
  const of = (o: Record<string, unknown>, x: Record<string, unknown> = {}) => rowsOf([row({ outcome: { url: URL, issue: "acme/shep#42", checked_at: NOW - 5000, ...o }, ...x })], {}, NOW).rows[0].outcome;
  expect(of({ state: "open" })).toEqual({ state: "open", at: NOW - 5000 });
  expect(of({ state: "closed", reason: "completed" })).toEqual({ state: "closed", reason: "completed", at: NOW - 5000 });
  expect(of({ state: "closed", reason: "not_planned" })?.reason).toBe("not_planned");
  const c = { repo: "acme/shep", number: 7, title: "Reply context in chat", url: "https://github.com/acme/shep/issues/7", state: "closed", reason: "completed" };
  expect(of({ state: "closed", reason: "duplicate", canonical: c })?.canonical).toEqual({ title: "Reply context in chat", url: c.url, state: "closed", reason: "completed" });
  // a canonical the page can't trust is left out; the duplicate stays
  expect(of({ state: "closed", reason: "duplicate", canonical: { ...c, url: "javascript:alert(1)" } })).toEqual({ state: "closed", reason: "duplicate", at: NOW - 5000 });
  // GitHub couldn't be reached since: the last state, marked
  expect(of({ state: "closed", reason: "completed" }, { track_error: { at: NOW, why: "offline" } })?.failed).toBe(true);
  // nothing GitHub said, or something it couldn't have: none
  expect(of({ state: "weird" })).toBeUndefined();
  expect(outcomeOf({})).toBeUndefined();
  // a post notes only its issue, and an older post's {url, state: open} placeholder was never read: the row says Filed
  expect(outcomeOf({ outcome: { url: URL } })).toBeUndefined();
  expect(outcomeOf({ outcome: { url: URL, state: "open", checked_at: NOW } })).toBeUndefined();
  // only on a filed row: a found one's outcome (none yet in practice) isn't drawn
  expect(rowsOf([row({ state: "found", url: undefined })], {}, NOW).rows[0].outcome).toBeUndefined();
  // a followed one (the person's Follow this one) shows it too
  expect(rowsOf([row({ state: "told", url: undefined, decision: "following", outcome: { url: URL, issue: "acme/shep#42", state: "closed", reason: "completed", title: "x" } })], {}, NOW).rows[0].outcome?.reason).toBe("completed");
});

test("what is followed: filed or the person's Follow with an issue, offers on, not said to work", () => {
  expect(followed(row({}), {})).toBe(true);
  expect(followed(row({ state: "told", url: undefined, outcome: undefined, decision: "following" }), {})).toBe(false);
  expect(followed(row({ state: "told", url: undefined, decision: "following" }), {})).toBe(true);
  expect(followed(row({ state: "found", url: undefined, outcome: undefined }), {})).toBe(false);
  expect(followed(row({ state: "told", url: undefined, outcome: undefined, decision: "approved", post: { state: "waiting", rev: 1 } }), {})).toBe(false);
  expect(followed(row({ tried: { result: "works" } }), {})).toBe(false);
  expect(followed(row({ url: "https://github.com/acme/shep/pull/3", outcome: undefined }), {})).toBe(false);
  expect(followed(row({}), { spaces: { sp1: { agents: { feedback: false } } } })).toBe(false);
});

test("the job doesn't run with nothing followed, and runs --track once something is", async () => {
  const f = fake([[row({ state: "found", url: undefined, outcome: undefined })], [row({})], [row({})]]);
  const fb = new Feedback(f.run, () => "/nonexistent/.feedback.json", () => ({}), () => true);
  expect(await fb.track()).toBe(false);  // the first read, then nothing followed
  expect(tracks(f.calls)).toEqual([]);
  await fb.read();  // now one is filed
  expect(await fb.track()).toBe(true);
  expect(tracks(f.calls)).toEqual([["--track", "--json"]]);
  // and the list is read again after it, so the page shows what it found
  expect(f.calls.at(-1)).toEqual(["--list", "--all", "--json"]);
});

test("the job doesn't run with the plugin off, nor for a followed row whose space has offers off", async () => {
  const off = fake([[row({})]]);
  expect(await new Feedback(off.run, () => "/nonexistent", () => ({}), () => false).track()).toBe(false);
  expect(off.calls).toEqual([]);
  const quiet = fake([[row({})]]);
  expect(await new Feedback(quiet.run, () => "/nonexistent", () => ({ spaces: { sp1: { agents: { feedback: false } } } }), () => true).track()).toBe(false);
  expect(tracks(quiet.calls)).toEqual([]);
});

test("the jobs run it hourly (and once a minute after the start), with the background work", () => {
  const src = readFileSync(join(import.meta.dir, "jobs.ts"), "utf8");
  const start = src.slice(src.indexOf("  start() {"), src.indexOf("  private async tick("));
  expect(start.indexOf("SHEPHERDR_JOBS=off")).toBeLessThan(start.indexOf("feedback.track()"));
  expect(start).toContain("setInterval(track, 3_600_000)");
  expect(start).toContain("setTimeout(track, 60_000)");
});
