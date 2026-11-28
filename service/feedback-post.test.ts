// Friction loop, slice 4 (#94): the Feedback page's File it… and Post it. The service shows the draft whole (without its
// hidden line), each step of its post, and runs only the person's yes and a read of GitHub; the post is the Assistant's.
// The send's hidden line goes through actions.ts. Made-up names only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { argsOf, draftOf, Feedback, POSTING_MS, postOf, rowsOf, sectionOf, type Runner } from "./feedback.ts";

const NOW = Date.UTC(2026, 10, 27, 12);
const BODY = "## Goal\n\nSee what a reply answers.\n\n## What happened\n\nNo quote.";
const draft = (x: Record<string, unknown> = {}) => ({ rev: 2, target: { repo: "eliasstravik/shepherdr", action: "create" }, title: "Reply bubble hides its message",
  body: `${BODY}\n\n<!-- shepherdr-feedback a1 rev 2 -->`, ...x });
const row = (x: Record<string, unknown>) => ({ id: "a1", line: "The reply bubble doesn't show which message it answers", state: "told", count: 1,
  at: NOW - 60_000, space: "sp1", reports: [], ...x });
const fake = (answers: { code?: number; stdout?: string }[]) => {
  const calls: string[][] = [];
  const run: Runner = async (args) => { calls.push(args); return { code: 0, stdout: "[]", stderr: "", ...(answers.shift() ?? {}) }; };
  return { run, calls };
};

test("the draft reaches the row as it will be posted, its hidden line left out, and where it goes", () => {
  const [r] = rowsOf([row({ draft: draft() })], {}, NOW).rows;
  expect(r.section).toBe("found");
  expect(r.draft).toEqual({ rev: 2, title: "Reply bubble hides its message", body: BODY, target: { repo: "eliasstravik/shepherdr", action: "create" } });
  // a comment names its issue, and its title when a check found it
  const c = draftOf({ draft: draft({ target: { repo: "acme/shepherdr", action: "comment", issue: 12 } }),
    checked: { dupes: [{ repo: "acme/shepherdr", number: 12, title: "Replies lose their quote" }, { repo: "eliasstravik/shepherdr", number: 12, title: "Other" }] } });
  expect(c?.target).toEqual({ repo: "acme/shepherdr", action: "comment", issue: 12, title: "Replies lose their quote" });
  // one the page can't trust is left out
  for (const bad of [{ rev: 0 }, { target: { repo: "not a repo", action: "create" } }, { target: { repo: "a/b", action: "comment" } }, { body: 5 }])
    expect(draftOf({ draft: draft(bad) })).toBeUndefined();
});

test("each step of a post: under Filed, a posting that never came back reads as unsure, and a refusal says why", () => {
  const at = (post: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    rowsOf([row({ draft: draft(), decision: "approved", approval: { rev: 2 }, post: { rev: 2, ...post }, ...extra })], {}, NOW).rows[0];
  expect(at({ state: "waiting" })).toMatchObject({ section: "filed", approved: 2, post: { state: "waiting", rev: 2 } });
  expect(at({ state: "posting", started: NOW - 1000 }).post?.state).toBe("posting");
  expect(at({ state: "posting", started: NOW - POSTING_MS - 1 }).post?.state).toBe("unsure");
  expect(at({ state: "refused", why: "HTTP 403: Resource not accessible\nmore" }).post).toEqual({ state: "refused", rev: 2, why: "HTTP 403: Resource not accessible" });
  expect(at({ state: "unsure", why: "not found on GitHub" }).post).toEqual({ state: "unsure", rev: 2 });
  // Never after a post in doubt: Said no, its step still known
  expect(sectionOf({ state: "declined", decision: "declined", post: { state: "unsure", rev: 2 } }, NOW)).toBe("declined");
  expect(postOf({ post: { state: "lost", rev: 1 } }, NOW)).toBeUndefined();
});

test("the settings note reaches the page, only when set", () => {
  expect(rowsOf([], {}, NOW).note).toBeUndefined();
  expect(rowsOf([], { everywhere: { agents: { feedback_note: "  Posting also starts a fix here. " } } }, NOW).note).toBe("Posting also starts a fix here.");
});

test("Post it and Check again, as herdr-task's arguments; nothing else posts", () => {
  expect(argsOf({ do: "approve", key: "a1", rev: 2 })).toEqual(["--key", "a1", "--approve", "2", "--json"]);
  expect(argsOf({ do: "reconcile", key: "a1" })).toEqual(["--key", "a1", "--reconcile", "--json"]);
  for (const rev of [0, -1, 1.5, "2", null, 10_000]) expect(() => argsOf({ do: "approve", key: "a1", rev })).toThrow();
  expect(() => argsOf({ do: "file", key: "a1", rev: 2 })).toThrow("Shepherdr can't do that yet.");
  expect(() => argsOf({ do: "post", key: "a1" })).toThrow();
});

test("Post it: a yes kept, or kept already, is ok; one herdr-task refuses says why in the person's words", async () => {
  const f = fake([{ stdout: JSON.stringify({ key: "a1", changed: true, approved: 2 }) }, {},
    { stdout: JSON.stringify({ key: "a1", changed: false, approved: 2 }) }, {},
    { stdout: JSON.stringify({ key: "a1", changed: false, approved: false, why: "changed" }) }, {},
    { stdout: JSON.stringify({ key: "a1", changed: false, approved: false, why: "unsure" }) }, {}]);
  const fb = new Feedback(f.run, () => "/nonexistent", () => ({}), () => true);
  expect(await fb.act({ do: "approve", key: "a1", rev: 2 })).toEqual({ ok: true, key: "a1", changed: true });
  expect((await fb.act({ do: "approve", key: "a1", rev: 2 })).ok).toBe(true);
  expect((await fb.act({ do: "approve", key: "a1", rev: 2 })).error).toContain("The draft changed");
  expect((await fb.act({ do: "approve", key: "a1", rev: 2 })).error).toContain("never posted again");
  expect(f.calls.filter((c) => c[0] !== "--list").every((c) => !c.includes("--file"))).toBe(true);
});

test("Check again: found is filed; not found says it isn't posted again", async () => {
  const f = fake([{ stdout: JSON.stringify({ key: "a1", filed: true, url: "https://github.com/acme/shepherdr/issues/40" }) }, {},
    { stdout: JSON.stringify({ key: "a1", filed: false, why: "unsure", unsure: true }) }, {}]);
  const fb = new Feedback(f.run, () => "/nonexistent", () => ({}), () => true);
  expect(await fb.act({ do: "reconcile", key: "a1" })).toEqual({ ok: true, key: "a1", filed: true });
  expect((await fb.act({ do: "reconcile", key: "a1" })).error).toContain("isn't posted again");
});

test("pins: the send passes the hidden line through messageBody, which checks it", () => {
  const actions = readFileSync(join(import.meta.dir, "actions.ts"), "utf8");
  expect(actions).toContain("feedback: b.feedback ?? null })");
  const send = readFileSync(join(import.meta.dir, "..", "core", "send.js"), "utf8");
  expect(send).toContain("return reply + tags + feedbackLine(feedback) + text;");
  // herdr-task's own wait for a posting that never came back
  expect(readFileSync(join(import.meta.dir, "..", "mods", "tasks", "bin", "herdr_task", "feedback.py"), "utf8")).toContain("FILING_MS = 10 * 60000");
});
