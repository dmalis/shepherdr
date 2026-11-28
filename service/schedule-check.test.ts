import { expect, test } from "bun:test";
import { lastWords, schedulesOf } from "./next.ts";

// dmalis/shepherdr#229: a run its check settled started no task; its words say so, in the row and its history
test("a run its check settled says so", () => {
  const now = new Date(2026, 10, 22, 10, 0).getTime();
  const at = new Date(2026, 10, 22, 9, 0).getTime();
  expect(lastWords({ runs: [{ at, why: "time", nothing: "check", said: "all quiet" }] }, now)).toBe("today 9:00 · checked, nothing to do");
  expect(lastWords({ runs: [{ at, why: "time", check_failed: "its command wasn't found (127)" }] }, now)).toBe("today 9:00 · its check failed");
  const [s] = schedulesOf([{ id: 1, title: "Watch", folder: "/a", every: { text: "hourly" }, last_error: { kind: "check", message: "Its check failed since 9:00: x" },
    runs: [{ at, why: "time", nothing: "check" }, { at: at + 1, why: "time", check_failed: "it took longer than 120 s" }, { at: at + 2, why: "time", task: "A-1" }] }],
  [], "ev", () => undefined).ev;
  expect(s.runs).toEqual([{ at, checked: true }, { at: at + 1, checkFailed: "it took longer than 120 s" }, { at: at + 2, task: "A-1" }]);
  expect(s.error).toBe("Its check failed since 9:00: x");
});
