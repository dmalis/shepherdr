import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configOf, setConfig } from "./next.ts";

// fork "Needs you 6b": Ask me after (tasks.ask_after, minutes) for Everything and each repo, through the window's config
// path, as herdr-task reads it (mods/tasks/bin/herdr_task/wait_record.py ask_after_ms). Throwaway settings file.
const file = join(mkdtempSync(join(tmpdir(), "ask-after-")), "settings.json");
const pick = { agent: "claude", model: null, effort: null, fast: false, perm: null };
const repo = { key: "/r/shop", folder: "/r/shop", machine: null, name: "shop", spaces: [], tasks: 1 };
const read = () => JSON.parse(readFileSync(file, "utf8"));
const config = () => configOf({ defaults: { Chats: pick, Tasks: pick, Reviews: pick } as any, spaces: [], secrets: [], plans: [], repos: [repo] });

test("Ask me after: 5 minutes by default, set and Reset for Everything and a repo, only its own choices", () => {
  const was = process.env.HERDR_TASK_SETTINGS;
  process.env.HERDR_TASK_SETTINGS = file;
  try {
    writeFileSync(file, JSON.stringify({ everywhere: { tasks: { merge: "checks" } } }));
    expect(config().all.askAfter).toBe(5);
    setConfig("all", "ask_after", 0);
    expect(read().everywhere.tasks).toEqual({ merge: "checks", ask_after: 0 });
    expect(config().all.askAfter).toBe(0);
    // a repo follows Everything until it sets its own
    expect(config().repos![0]).toMatchObject({ askAfter: 0, own: [] });
    setConfig("repo:/r/shop", "ask_after", 15);
    expect(read().repos["/r/shop"].tasks).toEqual({ ask_after: 15 });
    expect(config().repos![0]).toMatchObject({ askAfter: 15, own: ["ask_after"] });
    setConfig("repo:/r/shop", "ask_after", null);
    expect(config().repos![0]).toMatchObject({ askAfter: 0, own: [] });
    expect(() => setConfig("all", "ask_after", 7)).toThrow();
    expect(() => setConfig("all", "ask_after", "5")).toThrow();
    // a word herdr-task also takes, written by hand
    writeFileSync(file, JSON.stringify({ everywhere: { tasks: { ask_after: "now" } } }));
    expect(config().all.askAfter).toBe(0);
  } finally {
    if (was === undefined) delete process.env.HERDR_TASK_SETTINGS;
    else process.env.HERDR_TASK_SETTINGS = was;
  }
});

test("the rows' seams: Notifications draws Everything's, a repo's Tasks page its own", () => {
  const page = readFileSync(join(import.meta.dir, "../web/plugins/alerts/page.tsx"), "utf8");
  expect(page).toContain('<AskAfterRow snap={snap} place="all" />');
  const tsx = readFileSync(join(import.meta.dir, "../web/src/settings.tsx"), "utf8");
  expect(tsx).toContain("{place.startsWith('repo:') && <AskAfterRow snap={snap} place={place} />}");
});
