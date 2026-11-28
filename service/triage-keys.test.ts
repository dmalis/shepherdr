// Settings › Triage's keys (#235): checked as herdr-task checks them, a repo's own over Everywhere's (never the level),
// Reset back to Everywhere's, and only this machine's repos. Made-up folders only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { setTriage, TRIAGE_DEFAULTS, triageConfig, triageOf, triageRead, triageValue } from "./triage-keys.ts";

test("each key takes only what herdr-task takes", () => {
  expect(triageValue("level", "score")).toBe("score");
  expect(() => triageValue("level", "fix")).toThrow(/later step/);
  expect(() => triageValue("level", "on")).toThrow();
  expect(triageValue("fix_from", 5)).toBe(5);
  for (const v of [2, 6, 4.5, "4"]) expect(() => triageValue("fix_from", v)).toThrow();
  for (const v of [0, 11, "3"]) expect(() => triageValue("fixes_per_day", v)).toThrow();
  expect(() => triageValue("ask_merge", "yes")).toThrow();
  expect(() => triageValue("rules", [])).toThrow();
});

test("a repo's own value wins, else Everywhere's, never Everywhere's level; a bad value counts as unset", () => {
  const f = { everywhere: { triage: { level: "score", fix_from: 5, fixes_per_day: 99 } }, repos: { "/r": { triage: { fixes_per_day: 2, ask_merge: "x" } } } };
  expect(triageOf(f, "/r")).toEqual({ ...TRIAGE_DEFAULTS, fix_from: 5, fixes_per_day: 2, own: ["fixes_per_day"] });
  expect(triageOf(f, "/other").level).toBe("off");
  const c = triageConfig(f, [{ key: "/r", machine: null }, { key: "vm-b:/s", machine: "vm-b" }]);
  expect(Object.keys(c.repos)).toEqual(["/r"]);
  expect(c.all.fix_from).toBe(5);
});

test("saving: the level only for one repo, only this machine's, and Reset takes the repo's own value away", () => {
  const next: any = { repos: {} };
  setTriage(next, "repo:/r", "triage.level", "score");
  setTriage(next, "repo:/r", "triage.fix_from", 3);
  expect(next.repos["/r"].triage).toEqual({ level: "score", fix_from: 3 });
  setTriage(next, "repo:/r", "triage.fix_from", null);
  expect(next.repos["/r"].triage).toEqual({ level: "score" });
  setTriage(next, "all", "triage.ask_merge", true);
  expect(next.everywhere.triage).toEqual({ ask_merge: true });
  expect(() => setTriage(next, "all", "triage.level", "score")).toThrow(/one repo at a time/);
  expect(() => setTriage(next, "repo:vm-b:/s", "triage.level", "score")).toThrow(/this machine/);
  expect(() => setTriage(next, "repo:/r", "triage.level", "fix")).toThrow();
  expect(() => setTriage(next, "repo:/r", "triage.rules", [])).toThrow();
  expect(() => setTriage(next, "sp1", "triage.fix_from", 4)).toThrow();
  expect(next.repos["/r"].triage).toEqual({ level: "score" });
});

test("a value already in the file is read as herdr-task reads it (value_of), so the page shows what Triage does", () => {
  const f = { everywhere: { triage: { ask_merge: "off", fixes_per_day: "5" } }, repos: { "/r": { triage: { level: " Score ", fix_from: "3", ask_merge: "maybe" } } } };
  expect(triageOf(f, "/r")).toEqual({ level: "score", fix_from: 3, fixes_per_day: 5, ask_merge: false, own: ["level", "fix_from"] });
  expect(triageRead("fixes_per_day", "11")).toBeUndefined();
  expect(triageRead("fix_from", true)).toBeUndefined();
  expect(triageRead("ask_merge", 1)).toBeUndefined(); // herdr-task: a number isn't on or off
  // the page still saves only strict values
  expect(() => triageValue("ask_merge", "off")).toThrow();
});

test("Everywhere's defaults: Off, fix from 4, 3 a day, and Ask me before merging on, the same as herdr-task's", () => {
  expect(TRIAGE_DEFAULTS).toEqual({ level: "off", fix_from: 4, fixes_per_day: 3, ask_merge: true });
  const py = readFileSync(new URL("../mods/tasks/bin/herdr_task/triage.py", import.meta.url), "utf8");
  expect(py).toContain('DEFAULTS = {"level": "off", "fix_from": 4, "fixes_per_day": 3, "ask_merge": True}');
  // a repo with only its level set (ours) takes Everywhere's for the rest
  expect(triageOf({ repos: { "/r": { triage: { level: "score" } } } }, "/r")).toEqual({ ...TRIAGE_DEFAULTS, level: "score", own: ["level"] });
});
