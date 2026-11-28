import { expect, test } from "bun:test";
import { argvFor, compactArgs, compactDefault, compactName, compactOf, compactRecommended, compactSizes, current, extraFlags, forkArgv, menuFor, resumeArgv, windowOf } from "./agents.js";

// fork #219: Compact at, said with each CLI's documented per-run switch: Claude Code's --autocompact <tokens>, Codex's
// -c model_auto_compact_token_limit=<n>. Nothing writes an agent's own settings file or types /compact.

test("a size is a whole number of tokens from 100k, typed as 300000, 300k or 1m; anything else is no size", () => {
  expect(compactOf(300000)).toBe(300000);
  expect(compactOf("300k")).toBe(300000);
  expect(compactOf("1M")).toBe(1000000);
  for (const bad of [null, undefined, 0, 5000, "big", -300000, 300000.5, "1e9", 20000000]) expect(compactOf(bad)).toBeNull();
  expect(compactName(300000)).toBe("300k");
  expect(compactName(1000000)).toBe("1M");
  expect(compactName(null)).toBeNull();
});

test("each CLI's own switch, and nothing for no size or another agent", () => {
  expect(compactArgs("claude", 300000)).toEqual(["--autocompact", "300000"]);
  expect(compactArgs("codex", 300000)).toEqual(["-c", "model_auto_compact_token_limit=300000"]);
  expect(compactArgs("claude", null)).toEqual([]);
  expect(compactArgs("opencode", 300000)).toEqual([]);
});

test("the sizes offered sit below the CLI's own point; 300k is recommended on a 1M window, the CLI's own below it", () => {
  expect(compactSizes("claude", 1000000)).toEqual([200000, 300000, 400000, 500000]);
  expect(compactSizes("codex", 500000)).toEqual([150000, 200000, 300000, 400000]);
  expect(compactSizes("codex", 272000)).toEqual([150000, 200000]);
  expect(compactRecommended("claude", 1000000)).toBe(300000);
  expect(compactRecommended("codex", 500000)).toBeNull();
  expect(compactDefault("codex", 500000)).toBe(450000);
  expect(windowOf("claude", undefined)).toBe(1000000);
  expect(windowOf("codex", undefined)).toBe(272000);
  expect(menuFor("claude", {}).models.every((m) => m.window === 1000000)).toBe(true);
});

test("a chat's start and restart say it, read it back, and drop it when set back to Default", () => {
  const c = argvFor({ agent: "claude", model: "opus", effort: "high", compact: 300000 }, { agent: "claude" }).argv;
  expect(c.slice(0, 7)).toEqual(["claude", "--model", "opus", "--effort", "high", "--autocompact", "300000"]);
  expect(current("claude", c).compact).toBe(300000);
  // the next restart without it leaves none behind, and never twice
  const again = argvFor({ agent: "claude", model: "opus", compact: 400000 }, { agent: "claude", argv: c }).argv;
  expect(again.filter((a) => a === "--autocompact").length).toBe(1);
  expect(again).toContain("400000");
  expect(argvFor({ agent: "claude", model: "opus" }, { agent: "claude", argv: c }).argv).not.toContain("--autocompact");
  expect(extraFlags("claude", c)).toEqual([]);

  const x = argvFor({ agent: "codex", model: "gpt-6.2-sol", effort: "high", compact: 300000 }, { agent: "codex" }).argv;
  expect(x).toContain("model_auto_compact_token_limit=300000");
  expect(current("codex", x).compact).toBe(300000);
  const x2 = argvFor({ agent: "codex", model: "gpt-6.2-sol", compact: null }, { agent: "codex", argv: x }).argv;
  expect(x2.join(" ")).not.toContain("model_auto_compact_token_limit");
  expect(extraFlags("codex", x)).toEqual([]);
});

test("only plain digits are a size (no hex, exponent or spaces inside)", () => {
  for (const bad of ["0x186A0", "1e6", "3 00000", "300000.0", " k"]) expect(compactOf(bad)).toBeNull();
});

test("a size in the person's own flags is said once: replaced by a pick's, kept when untouched, theirs when Shepherdr can't say it", () => {
  // two spellings each CLI takes, from the person's extra flags
  const c = ["claude", "--autocompact=200000", "--verbose", "--model", "opus"];
  const set = argvFor({ agent: "claude", model: "opus", compact: 400000 }, { agent: "claude", argv: c }).argv;
  expect(set.filter((a) => a.startsWith("--autocompact")).length).toBe(1);
  expect(set).toContain("400000");
  // untouched: its own size reads back and is said again, once
  const was = current("claude", c).compact;
  expect(was).toBe(200000);
  const same = argvFor({ agent: "claude", model: "sonnet", compact: was }, { agent: "claude", argv: c }).argv;
  expect(same.filter((a) => a.startsWith("--autocompact")).length).toBe(1);
  // a form Shepherdr doesn't say (auto, a small count) stays the person's own through a model change
  for (const own of ["--autocompact=auto", "--autocompact=200"]) {
    const a = argvFor({ agent: "claude", model: "sonnet" }, { agent: "claude", argv: ["claude", own] }).argv;
    expect(a).toContain(own);
  }
  const x = ["codex", "--config=model_auto_compact_token_limit=200000", "-m", "gpt-6.2-sol"];
  expect(current("codex", x).compact).toBe(200000);
  const reset = argvFor({ agent: "codex", model: "gpt-6.2-sol", compact: null }, { agent: "codex", argv: x }).argv;
  expect(reset.join(" ")).not.toContain("model_auto_compact_token_limit");
  const again = argvFor({ agent: "codex", model: "gpt-6.2-sol", compact: 300000 }, { agent: "codex", argv: ["codex", "-c", "model_auto_compact_token_limit=200000"] }).argv;
  expect(again.filter((a) => a.includes("model_auto_compact_token_limit")).length).toBe(1);
  expect(again).toContain("model_auto_compact_token_limit=300000");
  // a fork keeps the person's own form once, and a size once
  expect(forkArgv("claude", ["claude", "--autocompact=auto"], "s1").filter((a) => a.startsWith("--autocompact"))).toEqual(["--autocompact=auto"]);
});

test("an agent switch carries the size in the new CLI's words", () => {
  const c = argvFor({ agent: "claude", compact: 300000 }, { agent: "claude" }).argv;
  const x = argvFor({ agent: "codex", compact: 300000 }, { agent: "claude", argv: c }).argv;
  expect(x).toContain("model_auto_compact_token_limit=300000");
  expect(x).not.toContain("--autocompact");
});

test("a resume and a fork keep it", () => {
  const c = ["claude", "--model", "opus", "--autocompact", "300000"];
  expect(resumeArgv("claude", c, "s1")).toEqual(["claude", "--model", "opus", "--autocompact", "300000", "--resume", "s1"]);
  expect(forkArgv("claude", c, "s1")).toEqual(["claude", "--model", "opus", "--autocompact", "300000", "--resume", "s1", "--fork-session"]);
  const x = ["codex", "--no-daemon", "-m", "gpt-6.2-sol", "-c", "model_auto_compact_token_limit=300000"];
  expect(resumeArgv("codex", x, "s1")).toContain("model_auto_compact_token_limit=300000");
  const f = forkArgv("codex", x, "s1");
  expect(f.filter((a) => a === "model_auto_compact_token_limit=300000").length).toBe(1);
});
