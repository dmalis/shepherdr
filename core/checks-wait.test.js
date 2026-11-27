// dmalis/shepherdr#42: what a Ready task waits for while its checks run. The cases are shared with herdr-task's
// checkwait.py (test/test_herdr_task.py ChecksWait), so both say the same words.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checksWait, runWords, waitWords } from "./checks-wait.js";
import { readyWait } from "./tasks.js";
import { plainSuggests } from "./plain-suggests.js";

const MIN = 60000;
const { cases } = JSON.parse(readFileSync(new URL("./checks-wait.cases.json", import.meta.url), "utf8"));
// the cases' times are minutes (kept as text too: then text in ms)
const scale = (v) => (typeof v === "string" ? (Number.isFinite(Number(v)) ? String(Number(v) * MIN) : v) : v * MIN);
const inMs = (task) => ({ ...task, pr: { ...task.pr, ...(task.pr.runs ? { runs: task.pr.runs.map((r) => ({ ...r,
  ...(r.at ? { at: scale(r.at) } : {}), ...(r.end ? { end: scale(r.end) } : {}), ...(r.typ ? { typ: scale(r.typ) } : {}) })) } : {}) } });

for (const c of cases) {
  test(`checks wait: ${c.name}`, () => {
    expect(checksWait(inMs(c.task), c.now * MIN)?.line ?? null).toBe(c.line);
  });
}

test("what happens next: merges by itself, yours to merge, its agent fixes it", () => {
  const run = [{ name: "check", state: "running", at: 0, end: 0, typical: 0 }];
  expect(waitWords({ runs: run, more: false, auto: true }, MIN).next).toBe("It merges by itself once they pass.");
  expect(waitWords({ runs: run, more: false, auto: false }, MIN).next).toBe("Once they pass, it's yours to merge.");
  expect(waitWords({ runs: [{ ...run[0], state: "failed" }], more: false, auto: true }).state).toBe("failed");
  expect(waitWords({ runs: run, more: false, auto: true, approval: true }, MIN).next).toBe("It merges by itself once they pass and it's approved.");
});

test("one check's words", () => {
  expect(runWords({ state: "passed", at: MIN, end: 3 * MIN }, 9 * MIN)).toBe("passed · 2 min");
  expect(runWords({ state: "running", at: MIN, typical: 9 * MIN }, 5 * MIN)).toBe("running · 4 min of about 9");
  expect(runWords({ state: "running", at: MIN }, 5 * MIN)).toBe("running · 4 min");
  expect(runWords({ state: "queued", typical: 9 * MIN })).toBe("queued · usually 9 min");
  expect(runWords({ state: "running", at: 0, typical: 9 * MIN })).toBe("running · usually 9 min"); // no start time: not queued
  expect(runWords({ state: "skipped" })).toBe("skipped");
});

// the seam in core/tasks.js: a Ready task merging on its own whose checks run says what it waits for, never "Merging"
test("readyWait says what it waits for before Merging", () => {
  const t = { state: "ready", auto_merge: "auto", pr: { number: 3, checks: "running", wait: "Checks running", runs: [{ n: "check", s: "running", at: Date.now() - MIN, typ: 9 * MIN }] } };
  expect(readyWait(t)).toBe("Waiting for GitHub's checks · 0 of 1 passed · about 8 min");
  expect(readyWait({ ...t, merge_requested: true })).toBe("Merging");
});

test("a plain Suggested replies list last in a message is read as suggestions", () => {
  expect(plainSuggests('Done.\n\nSuggested replies:\n- "Merge it"\n- Show me the diff')).toEqual({ text: "Done.", suggests: ["Merge it", "Show me the diff"] });
  expect(plainSuggests("Done.\n\n**Suggested replies:**\n1. Yes\n2) No")).toEqual({ text: "Done.", suggests: ["Yes", "No"] });
  expect(plainSuggests('Done.\nSuggested replies: “Yes”, “Not yet”')).toEqual({ text: "Done.", suggests: ["Yes", "Not yet"] });
  // not last, a sentence about them, a code block, plain lists: words
  expect(plainSuggests("Suggested replies:\n- a\n\nThen more.")).toBeNull();
  expect(plainSuggests("Suggested replies are on for this space.")).toBeNull();
  expect(plainSuggests("```\nSuggested replies:\n- a\n```")).toBeNull();
  expect(plainSuggests("Changed:\n- a\n- b")).toBeNull();
  // a sentence with quotes in it, a list in a code block left open
  expect(plainSuggests('Done.\nSuggested replies: replace "Stop" with "Pause".')).toBeNull();
  expect(plainSuggests("Here:\n```\nSuggested replies:\n- a")).toBeNull();
  expect(plainSuggests('Done.\nSuggested replies: "Yes" or "No".')).toEqual({ text: "Done.", suggests: ["Yes", "No"] });
});
