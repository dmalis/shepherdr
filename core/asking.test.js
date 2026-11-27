// dmalis/shepherdr#59: a message sent while its agent asks something (a question, a permission, a plan) is never
// refused for good: hc's refusal is marked asking, no key is pressed, and the service holds it until the answer. The
// words say where it is answered, the same everywhere. These pin the seams the patch relies on.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AFTER, AFTER_TERMINAL, ASKING, ASKING_TERMINAL, WAITS_ANSWER, afterWords, askingWords } from "./asking.js";
import { ASKING as SEND_ASKING, sendBody } from "./send.js";

const blocked = (card) => {
  const calls = [];
  const io = {
    sleep: async () => {},
    status: () => "blocked",
    ...(card === undefined ? {} : { card: () => card }),
    hc: async (args) => {
      calls.push(args.join(" "));
      if (args[0] === "send") return { code: 1, stdout: "", stderr: JSON.stringify({ error: { kind: "blocked", message: "blocked" } }) };
      return { code: 0, stdout: args[0] === "read" ? "● Run a command?\n  1. Allow once\n  2. Decline" : "" };
    },
  };
  return { io, calls };
};

test("the words: the card above when a card answers it, its terminal only when none can", () => {
  expect(AFTER).toBe("Sends after you answer the card above.");
  expect(afterWords(true)).toBe(AFTER);
  expect(afterWords(false)).toBe(AFTER_TERMINAL);
  expect(askingWords(true)).toBe(ASKING);
  expect(askingWords(false)).toBe(ASKING_TERMINAL);
  for (const w of [AFTER_TERMINAL, ASKING_TERMINAL]) expect(w).toContain("terminal");
  for (const w of [AFTER, ASKING]) expect(w).not.toContain("terminal");
  // core/send.js gives the same words, never its own
  expect(SEND_ASKING).toBe(ASKING);
  expect(WAITS_ANSWER).toBe("answer");
});

test("hc refusing a send while it asks: marked asking, no key pressed", async () => {
  for (const kind of ["claude", "codex"]) {
    const { io, calls } = blocked(true);
    const r = await sendBody(io, `ta-${kind}`, kind, "explain each, in plain words");
    expect(r).toEqual({ code: 1, stdout: "", stderr: ASKING, asking: true });
    expect(calls.filter((c) => c.startsWith("keys"))).toEqual([]);
  }
  for (const card of [false, undefined]) {
    const { io } = blocked(card);
    const r = await sendBody(io, `tt-${String(card)}`, "claude", "hello");
    expect(r.stderr).toBe(ASKING_TERMINAL);
    expect(r.asking).toBe(true);
  }
});

test("it began to ask while the send waited its turn: nothing is sent, marked asking", async () => {
  const calls = [];
  const io = { sleep: async () => {}, status: () => "working", card: () => true, asking: () => true, hc: async (args) => (calls.push(args[0]), { code: 0, stdout: "" }) };
  const r = await sendBody(io, "tq", "codex", "hello");
  expect(r).toEqual({ code: 1, stdout: "", stderr: ASKING, asking: true });
  expect(calls).toEqual([]);
});

test("it began to ask while Claude Code's box was read: nothing is typed", async () => {
  const calls = [];
  let looks = 0;
  const io = { sleep: async () => {}, status: () => "working", card: () => true, asking: () => looks++ > 0, hc: async (args) => (calls.push(args[0]), { code: 0, stdout: "" }) };
  const r = await sendBody(io, "tr", "claude", "hello");
  expect(r.asking).toBe(true);
  expect(calls.filter((c) => c === "send" || c === "keys")).toEqual([]);
});

test("a send that went in is not marked asking", async () => {
  const io = { sleep: async () => {}, status: () => "idle", card: () => true, hc: async (args) => (args[0] === "send" ? { code: 0, stdout: '{"started":true}', stderr: "" } : { code: 0, stdout: "" }) };
  const r = await sendBody(io, "tok", "codex", "hello");
  expect(r.code).toBe(0);
  expect(r.asking).toBeUndefined();
});

// the service's seams: a send while it asks waits for the answer (never thrown), a reaction says the same words
test("service seams use core/asking.js", () => {
  const actions = readFileSync(new URL("../service/actions.ts", import.meta.url), "utf8");
  expect(actions).toContain("if (asks() || held.some((h) => h.addr === a && h.answer) || inFlight.has(a)) return afterAnswer();");
  expect(actions).toContain("if (r.code !== 0 && r.asking) return afterAnswer();");
  expect(actions).toContain("waitsFor: WAITS_ANSWER");
  expect(actions).toContain("throw new Error(askingWords(carded(compat, a)))");
  expect(actions).not.toContain("answer that first.");
});
