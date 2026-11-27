import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// fork #11 (dmalis/shepherdr): Review rounds and Must fix are back in the web app's Settings › Tasks, for Everything and
// each repo. The rows show and change what upstream's service and herdr-task already keep: tasks.review_rounds and
// tasks.must_fix, with core/settings.js's words. A failure here means upstream changed a seam the patch relies on.
const file = join(mkdtempSync(join(tmpdir(), "fork-11-")), "settings.json");
process.env.HERDR_TASK_SETTINGS = file;
const { Settings } = await import("./settings.ts");
const { configOf, setConfig } = await import("./next.ts");
const CORE: any = await import("../core/settings.js");

const pick = { agent: "claude", model: null, effort: null, fast: false, perm: null };
const repo = { key: "/r/shop", folder: "/r/shop", machine: null, name: "shop", spaces: [], tasks: 1 };
const read = () => JSON.parse(readFileSync(file, "utf8"));
const config = () => configOf({ defaults: { Chats: pick, Tasks: pick, Reviews: pick } as any, spaces: [], secrets: [], plans: [], repos: [repo] });

test("#11: the service's own rows keep their keys, words and values", () => {
  expect(CORE.ROUNDS).toEqual([[0, "Off"], [1, "1 round"], [2, "2 rounds"], [3, "3 rounds"]]);
  expect(CORE.MUST_FIX).toEqual([["blocker", "Blockers"], ["major", "Major and up"], ["minor", "Everything"]]);
  expect(CORE.DEFAULTS.tasks).toMatchObject({ review_rounds: 0, must_fix: "major" });
  expect(CORE.TASK_ROWS.filter(([, f]: any) => f === "review_rounds" || f === "must_fix")).toEqual([
    ["tasks", "review_rounds", "Review", CORE.ROUNDS], ["tasks", "must_fix", "Must fix", CORE.MUST_FIX]]);
  // the settings snapshot still sends both, Must fix only while there is a review
  writeFileSync(file, JSON.stringify({ everywhere: { tasks: { review_rounds: 2 } } }));
  const s = new Settings();
  s.start();
  const rows = s.sections("https://box/shepherdr/").find((x) => x.name === "Tasks" && x.level === "all")!.rows;
  expect(rows.find((r) => r.key === "tasks.review_rounds")).toMatchObject({ value: "2 rounds", options: ["Off", "1 round", "2 rounds", "3 rounds"] });
  expect(rows.find((r) => r.key === "tasks.must_fix")).toMatchObject({ value: "Major and up", options: ["Blockers", "Major and up", "Everything"] });
});

test("#11: herdr-task still reads the same keys and values", () => {
  const py = readFileSync(join(import.meta.dir, "../mods/tasks/bin/herdr_task/settings.py"), "utf8");
  expect(py).toContain('LEVELS = ["blocker", "major", "minor"]');
  expect(py).toMatch(/"review_rounds": 0, "must_fix": "major"/);
  expect(py).toContain('int(k.get("review_rounds") or 0)');
});

test("#11: Everything's and a repo's rounds and Must fix, set and Reset through the window's config path", () => {
  writeFileSync(file, JSON.stringify({ everywhere: { tasks: { merge: "checks" } } }));
  expect(config().all).toMatchObject({ review: false, rounds: 0, mustFix: "major" });
  setConfig("all", "review_rounds", 2);
  setConfig("all", "must_fix", "blocker");
  expect(read().everywhere.tasks).toEqual({ merge: "checks", review_rounds: 2, must_fix: "blocker" });
  expect(config().all).toMatchObject({ review: true, rounds: 2, mustFix: "blocker" });
  // a repo follows Everything until it sets its own
  expect(config().repos![0]).toMatchObject({ rounds: 2, mustFix: "blocker", own: [] });
  setConfig("repo:/r/shop", "review_rounds", 3);
  setConfig("repo:/r/shop", "must_fix", "minor");
  expect(read().repos["/r/shop"].tasks).toEqual({ review_rounds: 3, must_fix: "minor" });
  expect(config().repos![0]).toMatchObject({ review: true, rounds: 3, mustFix: "minor", own: ["review", "must_fix"] });
  // the switch and the rounds are one key: turning it off is 0 rounds, on again is upstream's one round
  setConfig("repo:/r/shop", "review", false);
  expect(config().repos![0]).toMatchObject({ review: false, rounds: 0 });
  setConfig("repo:/r/shop", "review", true);
  expect(config().repos![0]).toMatchObject({ review: true, rounds: 1 });
  // Reset: back to Everything's
  setConfig("repo:/r/shop", "review_rounds", null);
  setConfig("repo:/r/shop", "must_fix", null);
  expect(read().repos?.["/r/shop"]?.tasks).toBeUndefined();
  expect(config().repos![0]).toMatchObject({ rounds: 2, mustFix: "blocker", own: [] });
  // only the rows' own choices
  expect(() => setConfig("all", "review_rounds", 7)).toThrow();
  expect(() => setConfig("all", "review_rounds", "2")).toThrow();
  expect(() => setConfig("all", "must_fix", "nits")).toThrow();
  expect(read().everywhere.tasks).toEqual({ merge: "checks", review_rounds: 2, must_fix: "blocker" });
});

test("#11: the Tasks page still draws the rows, under the review switch and before Merge", () => {
  // the patch's one call site in upstream's Settings page: a release that reworks TaskRows can drop it in a clean merge
  const tsx = readFileSync(join(import.meta.dir, "../web/src/settings.tsx"), "utf8");
  expect(tsx).toContain("import { ReviewRows } from './review-rows.tsx'");
  const start = tsx.indexOf("\nfunction TaskRows(");
  expect(start).toBeGreaterThan(-1);
  const body = tsx.slice(start, tsx.indexOf("\n}\n", start));
  const at = (s: string) => body.indexOf(s);
  expect(at("<ReviewRows place={place} lv={lv} own={own} />")).toBeGreaterThan(at('<Tgl label="Review by a second agent"'));
  expect(at('<Tgl label="Review by a second agent"')).toBeGreaterThan(-1);
  expect(at('<Seg label="Merge"')).toBeGreaterThan(at("<ReviewRows "));
});
