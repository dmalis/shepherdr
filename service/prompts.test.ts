import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANSWERED_SHOW_MS, allowWhat, answerOf, answeredLine, firstSentence, holdForPrompts, justAnswered, markAnswered, promptNeeds, screenReason, whenWhyFound, whyHeld } from "./prompts.ts";
import { ANSWERED_SHOW_MS as WEB_SHOW_MS, answeredWords } from "../web/shared/answered.ts";
import { needsCount, nowGroups, taskLine } from "../web/shared/view.ts";
import { needsYou } from "../web/shared/needs-you.ts";
import { waiting } from "../web/shared/alerts.ts";
import type { AskEnd } from "./asks.ts";

// fork #45 (dmalis/shepherdr): a task's waiting prompt (a permission, a guard's confirmation, a Codex approval) counts
// everywhere Needs you counts, and its answer shows: a line in its chat, a word on its row, a news line to its
// Assistant (test/test_herdr_task.py PromptAnswered). A failure in the last test means upstream changed a seam the patch
// relies on.
const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

const ask = (id: string, task: string, at = 1000, extra: any = {}) =>
  ({ id, chat: `${task}/worker`, place: "sp", task, at, question: { id, title: "Run a command", choices: [] }, ...extra }) as any;
const task = (id: string, state = "working", extra: any = {}) =>
  ({ id, name: id, status: state === "working" ? "work" : state === "needs" ? "need" : state, state, place: "sp", report: { msg: "Reading the code", progress: 40 }, agent: { status: "work" }, ...extra }) as any;
const end = (how: string, extra: Partial<AskEnd> = {}): AskEnd => ({ id: "t3.1.2", terminal: "t3", title: "Run: cd /work/shop && npm test", how, at: 1000, kind: "permission", done: 5000, ...extra });

test("#45: each task's oldest open hook ask holds it; a queued question, an Assistant's wait or a closed ask doesn't", () => {
  const needs = [ask("t3.2.1", "A", 2000), ask("t3.1.1", "A", 1000), ask("t4.1.1", "B"), ask("q1", "C", 1, { question: { id: "q1", title: "Q", choices: [], queued: true } }),
    { id: "attention", chat: "D/worker", task: "D", place: "sp", at: 1, assistantFirst: true }, ask("t9.1.1", "E")];
  expect(promptNeeds(needs, ["t3.2.1", "t3.1.1", "t4.1.1", "q1", "attention"]).map((n) => n.id)).toEqual(["t3.1.1", "t4.1.1"]);
});

test("#45: a Codex task whose hook waits (its agent says working) is Needs you everywhere, and clears with it", () => {
  const tasks = [task("A"), task("B")];
  const needs = [ask("t3.1.1", "A", 1500)];
  holdForPrompts(tasks, needs, new Map([["t3.1.1", { words: { kind: "permission", title: "Run: cd /work/shop && npm test" } }]]));
  expect(tasks[0]).toMatchObject({ state: "needs", status: "need", sub: "Wants to run npm test", needsAt: 1500, report: { msg: "Wants to run npm test", paused: true }, agent: { status: "need" } });
  expect(tasks[1]).toMatchObject({ state: "working", status: "work" });
  const snap: any = { places: [{ id: "sp", name: "shop", chat: "p:sp" }], tasks, needs, machines: [], alerts: [] };
  // the sidebar's row, the Tasks button, the Tasks pane, the Needs you list and the app badge all say one
  expect(needsCount(snap, "sp")).toBe(1);
  expect(needsCount(snap)).toBe(1);
  expect(nowGroups(tasks).find((g) => g.name === "Needs you")!.tasks.map((t) => t.id)).toEqual(["A"]);
  expect(needsYou(snap).map((w) => w.task)).toEqual(["A"]);
  expect(waiting(snap).count).toBe(1);
  // answered: nothing holds it any more
  const after = [task("A"), task("B")];
  holdForPrompts(after, [], new Map());
  const snap2: any = { ...snap, tasks: after, needs: [] };
  expect([needsCount(snap2, "sp"), needsCount(snap2), needsYou(snap2).length, waiting(snap2).count]).toEqual([0, 0, 0, 0]);
});

test("#45: a done or archived task is never held; a question card keeps its own title", () => {
  const tasks = [task("A", "done"), task("B", "working", { archived: 1 }), task("C")];
  const needs = [ask("a", "A"), ask("b", "B"), ask("c", "C", 1, { question: { id: "c", title: "Which colour?", choices: [] } })];
  holdForPrompts(tasks, needs, new Map([["a", {}], ["b", {}], ["c", { words: { kind: "questions", title: "Which colour?" } }]]));
  expect(tasks.map((t) => t.status)).toEqual(["done", "work", "need"]);
  expect(tasks[2].sub).toBe("Which colour?");
});

test("#45: what a permission asked, in plain words", () => {
  expect(allowWhat("Run: cd /work/shop && npm test")).toBe("running npm test");
  expect(allowWhat("Run: cd '/a b'; cd c && git push origin main", true)).toBe("run git push origin main");
  expect(allowWhat("Run: cd /work")).toBe("running cd /work");
  expect(allowWhat("Edit src/app.ts")).toBe("editing src/app.ts");
  expect(allowWhat("Edit src/app.ts", true)).toBe("edit src/app.ts");
  expect(allowWhat("Search the web: bun test", true)).toBe("search the web for bun test");
  expect(allowWhat("Use Linear")).toBe("using Linear");
  expect(allowWhat(`Run: ${"x".repeat(200)}`).length).toBeLessThanOrEqual(68);
});

test("#45: how a prompt closed: Yes or No and where, or nobody answered", () => {
  expect(answerOf("Allowed on the web")).toEqual({ yes: true, where: "on the web" });
  // its log showed the tool ran: Yes; answered there, but the hook couldn't read which way: no Yes or No
  expect(answerOf("Allowed in the terminal")).toEqual({ yes: true, where: "in the terminal" });
  expect(answerOf("Answered in the terminal")).toEqual({ where: "in the terminal" });
  expect(answerOf("Denied in the chat")).toEqual({ yes: false, where: "in the chat" });
  // an Esc as much as a No: no choice claimed
  expect(answerOf("Declined or interrupted in the terminal")).toEqual({ where: "in the terminal" });
  expect(answerOf("Dismissed on the web")).toEqual({ yes: false, where: "on the web" });
  for (const how of ["Agent stopped", "No longer waiting", "No answer here in 30 minutes; it waits in the terminal",
    "No Shepherdr window or web page showed this card, so Codex asks in its terminal"]) expect(answerOf(how)).toBeNull();
});

test("#45: a closed permission's one line in its chat; other asks keep theirs", () => {
  expect(answeredLine(end("Allowed on the web"))).toEqual({ id: "ae:t3.1.2", who: "agent", at: 1000, ended: "Asked to allow running npm test: answered Yes on the web", endedAt: 5000 });
  expect(answeredLine(end("Declined or interrupted in the terminal"), "Fix login · ")!.ended).toBe("Fix login · Asked to allow running npm test: declined or interrupted in the terminal");
  expect(justAnswered([end("Declined or interrupted in the terminal", { done: 5000 })], 5000)).toEqual({ at: 5000 });
  expect(answeredLine(end("No answer here in 30 minutes; it waits in the terminal"))).toEqual({ id: "ae:t3.1.2", who: "agent", at: 1000, ended: "Asked to allow running npm test: no answer here in 30 minutes; it waits in the terminal", endedWaits: true });
  expect(answeredLine(end("Agent stopped"))!.endedWaits).toBeUndefined();
  expect(answeredLine(end("Answered in the terminal"))!.ended).toBe("Asked to allow running npm test: answered in the terminal");
  expect(justAnswered([end("Answered in the terminal", { done: 5000 })], 5000)).toEqual({ at: 5000 });
  // an answer from before the line kept when it closed says no time
  expect(answeredLine(end("Allowed on the web", { done: undefined }))!.endedAt).toBeUndefined();
  expect(answeredLine(end("Approved on the web", { kind: "plan", title: "Plan to approve" }))).toBeNull();
  expect(answeredLine(end("Answered on the web", { kind: "questions" }))).toBeNull();
});

test("#45: right after an answer its task's row says so, then what it does now", () => {
  const now = 100_000;
  expect(justAnswered([end("Allowed on the web", { done: now - 1000 }), end("Denied on the web", { done: now - 5000 })], now)).toEqual({ choice: "Yes", at: now - 1000 });
  expect(justAnswered([end("Answered on the web", { kind: "questions", done: now })], now)).toEqual({ at: now });
  expect(justAnswered([end("Allowed on the web", { done: now - ANSWERED_SHOW_MS - 1 })], now)).toBeUndefined();
  expect(justAnswered([end("Agent stopped", { done: now })], now)).toBeUndefined();
  expect(justAnswered([end("Allowed on the web", { done: undefined })], now)).toBeUndefined();
  const tasks = [task("A"), task("B", "done"), task("C")];
  markAnswered(tasks, (t) => (t.id === "C" ? [] : [end("Allowed on the web", { done: now })]), now);
  expect(tasks.map((t) => t.answered)).toEqual([{ choice: "Yes", at: now }, undefined, undefined]);
  // the row's words, as the Tasks pane and the task's header say them
  expect(WEB_SHOW_MS).toBe(ANSWERED_SHOW_MS);
  const at = Date.now();
  expect(taskLine({ ...task("A"), answered: { choice: "Yes", at } })).toBe("Answered: Yes · back to work");
  expect(taskLine({ ...task("A", "needs", { report: { msg: "Waits for your reply" } }), answered: { choice: "No", at } })).toBe("Answered: No · waits for your reply");
  expect(taskLine({ ...task("A", "ready"), answered: { at } })).toBe("Answered · ready for review");
  expect(taskLine({ ...task("A"), answered: { choice: "Yes", at: at - WEB_SHOW_MS - 1 } })).toBe("Reading the code");
  expect(answeredWords({ status: "done", answered: { choice: "Yes", at } }, "Done")).toBe("Done");
});

test("#45: a guard's reason is never read from a file the request names, only off the dialog", () => {
  // no look, no reason: transcript_path (any path a request carries) is never opened
  expect(whyHeld("t3.9.9", { tool_name: "Bash", transcript_path: "/dev/stdin" }, undefined, null, 10_000)).toBe("");
  expect(src("service/prompts.ts")).not.toMatch(/from "node:fs"/);
  expect(firstSentence(`${"a".repeat(400)}.`).length).toBe(300);
  expect(firstSentence("No full stop at all")).toBe("No full stop at all");
});

// Claude Code's dialog while a PreToolUse hook's "ask" waits, as herdr-core's terminal.read gave it (trimmed rules)
const SCREEN = [
  "──────────", " Bash command", " Force-push HEAD to side9 with lease", "╌╌╌╌╌╌", " rtk git push --force-with-lease origin HEAD:refs/heads/side9", "╌╌╌╌╌╌",
  " │ Hook PreToolUse:Bash requires confirmation for this command:",
  " │ The guard holds this command until a person answers: git push with --force, --force-with-lease, --mirror, --delete, --prune, a + refspec or a :ref rewrites or deletes remote history (rule:",
  " │ git-push-rewrite). Say yes only if you are sure.",
  " settings.json to update hooks", "", " Do you want to proceed?", " ❯ 1. Yes", "   2. No", "", " Esc to cancel · Tab to amend",
].join("\n");
const GUARD = "The guard holds this command until a person answers: git push with --force, --force-with-lease, --mirror, --delete, --prune, a + refspec or a :ref rewrites or deletes remote history (rule: git-push-rewrite).";

test("#45: while Claude waits, a guard's reason is read off its own dialog (never a key), then the card gets it", async () => {
  expect(screenReason(SCREEN, "Bash")).toBe(GUARD);
  expect(screenReason(SCREEN, "Write")).toBe("");
  // only this request's dialog, still asking: another command's, or one already answered, gives nothing
  expect(screenReason(SCREEN, "Bash", "rtk git push --force-with-lease origin HEAD:refs/heads/side9")).toBe(GUARD);
  expect(screenReason(SCREEN, "Bash", "rm -rf build")).toBe("");
  expect(screenReason(SCREEN.replace(" Do you want to proceed?", " ⎿ Done"), "Bash")).toBe("");
  // a plain permission prompt: no hook asked
  expect(screenReason(SCREEN.replace(/ │ .*\n/g, ""), "Bash")).toBe("");
  const req = { tool_name: "Bash", transcript_path: "/nowhere/s.jsonl" };
  const looked: string[] = [];
  let told = 0;
  whenWhyFound(() => told++);
  const look = async (addr: string) => { looked.push(addr); return SCREEN; };
  expect(whyHeld("t12.1.1", req, "t12", look, 50_000)).toBe("");
  await new Promise((r) => setTimeout(r, 0));
  expect(looked).toEqual(["t12"]);
  expect(told).toBe(1);
  expect(whyHeld("t12.1.1", req, "t12", look, 50_100)).toBe(GUARD);
  expect(looked).toEqual(["t12"]);
  // a dialog with no hook's reason: tried a few times while it comes up, then left alone
  const plain = async (addr: string) => { looked.push(addr); return SCREEN.replace(/ │ .*\n/g, ""); };
  for (let i = 0; i < 20; i++) { whyHeld("t13.1.1", req, "t13", plain, 60_000 + i * 2000); await new Promise((r) => setTimeout(r, 0)); }
  expect(looked.filter((a) => a === "t13").length).toBe(8);
});


test("#45: the seams the patch hangs on", () => {
  const compat = src("service/compat.ts");
  // hook asks are held before the start screens (which win), and answered marks set, where compat builds the needs
  expect(compat).toMatch(/const startup = new Map<string, Need & \{ question: Question \}>\(\);\n(?:\s*\/\/.*\n)*\s*holdForPrompts\(tasks, needs, this\.asks\?\.open \?\? new Map\(\)\);\n\s*markAnswered\(tasks,/);
  expect(compat).toContain("for (const card of (this as any).watch?.openCards?.() ?? []) {");
  expect(compat.match(/answeredLine\(e/g)?.length).toBe(2);
  // a guard's reason on the permission card, and the card's body
  expect(compat).toContain("...((why: string) => (why ? { why } : {}))(whyHeld(a.id, a.req, a.terminal, this.questionScreen)) };");
  expect(compat).toContain("questionScreen: ((addr: string) => Promise<string | null>) | null = null;");
  const main = src("service/main.ts");
  expect(main).toContain("whenWhyFound(() => { model.rebuild(); live.chats?.refreshAll(); });");
  expect(main).toContain("compat.questionScreen = async (a) => (await live.chats?.screen(a)) ?? null;");
  expect(src("web/plugins/chat/cards.tsx")).toContain("<PromptBody why={q.why} command={q.command}><Code text={q.command} /></PromptBody>");
  // a terminal answer is Allowed only when Claude's log shows the tool ran (hooks/ask-end.py)
  expect(src("hooks/ask-hook.sh")).toContain('[ "$r" = answered ] && { echo "Allowed in the terminal"; return; }');
  expect(src("hooks/ask-end.py")).toContain('print("declined" if refused else "answered")');
  expect(src("web/plugins/chat/client.tsx")).toContain("lastEnded = m.endedAt ? '' : m.ended ?? ''");
  // an ask's end keeps when it closed, with the hook's words (end/<id>)
  expect(src("service/asks.ts")).toContain('how: how || "No longer waiting", at: askAt(a.id), kind: a.words?.kind ?? "", done: Date.now() }');
  expect(src("core/asks.js")).toContain('return `${plan ? "Approved" : d.updatedInput ? "Answered" : "Allowed"} ${where}`;');
  const hook = src("hooks/ask-hook.sh");
  for (const how of ['declined) echo "Declined or interrupted in the terminal"', '*) echo "Answered in the terminal"']) expect(hook).toContain(how);
  // the page: the ended row shows when, and the row's words go through answeredWords
  // #85 draws the line through KindLine (a task's kind and name first); the time still follows it
  expect(src("web/plugins/chat/client.tsx")).toContain("<KindLine text={line} />{m.endedAt ? ` at ${clock(m.endedAt)}` : ''}");
  expect(src("web/shared/view.ts")).toContain("export const taskLine = (t: Task): string => answeredWords(t, rowLine(t))");
  // herdr-task's news pass tells the Assistant
  expect(src("mods/tasks/bin/herdr_task/news.py")).toContain('answered = prompt_answered(t, v, live)');
});
