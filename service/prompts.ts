// A task's waiting prompt and how it was answered (dmalis/shepherdr#45): a permission prompt, a guard's confirmation
// or a Codex approval, each a hook ask (service/asks.ts).
//
// - While one waits, its task is Needs you wherever Needs you counts: the sidebar's space row, its group and machine,
//   the Tasks pane and its button, the app badge and the push alert. Claude's own status says blocked only once its
//   prompt is on screen, and a Codex agent's says working the whole time its hook waits ("Running hook"), so the
//   task's status alone left the counts at 0 while the card stood in Needs you.
// - Once it closes, by anyone and anywhere, its task's chat says so in one line: "Asked to allow running npm test:
//   answered Yes on the web at 14:02". Where it was answered is said when known; who never is (Shepherdr can't tell).
// - Right after an answer, its task's row and header confirm it went through, whoever answered and wherever (a card, the
//   terminal pane): "Answered: Yes · back to work" (web/shared/answered.ts), without waiting on its Assistant.
// - A prompt a hook asked for (a guard's PreToolUse "ask") says why on its card, above the command, in the hook's own
//   first sentence: "The guard holds this command until a person answers: … (rule: git-push-rewrite)."
import type { Message, Need, Question, Task } from "../web/shared/types.ts";
import type { AskEnd } from "./asks.ts";

/** Why a hook held this request, as its card says it, by ask id. Claude writes a hook's reason to its log only once
 *  the prompt is answered, so while it waits the reason is read where Claude shows it, on its own screen (look:
 *  herdr-core's terminal.read, compat's questionScreen; read only, never a key), a few times while the dialog comes
 *  up, then kept. A reason found later tells found() (main.ts rebuilds the snapshot, so the card gets it). */
const reasons = new Map<string, { why: string; tries: number; next: number; busy?: boolean }>();
const found = new Set<() => void>();
export const whenWhyFound = (fn: () => void) => found.add(fn);
export function whyHeld(id: string, req: any, terminal?: string, look?: ((addr: string) => Promise<string | null>) | null, now = Date.now()): string {
  const had = reasons.get(id) ?? { why: "", tries: 0, next: 0 };
  reasons.set(id, had);
  if (reasons.size > 200) reasons.delete(reasons.keys().next().value!);
  if (had.why || had.busy || had.tries >= 8 || now < had.next) return had.why;
  if (!terminal || !look) return "";
  had.tries++;
  had.next = now + 1500;
  had.busy = true;
  void look(terminal).then((text) => {
    const why = text ? screenReason(text, String(req?.tool_name ?? ""), req?.tool_input?.command) : "";
    if (why) { had.why = why; for (const f of found) f(); }
  }).catch(() => {}).finally(() => { had.busy = false; });
  return "";
}

/** The reason Claude Code's permission dialog shows for a hook that asked ("Hook PreToolUse:Bash requires
 *  confirmation for this command:", then its reason on │ lines), its first sentence; "" when no hook asked, or when the
 *  screen isn't this request's dialog: it must still ask ("Do you want to proceed?") and, for a command, show its start. */
export function screenReason(screen: string, tool: string, command?: unknown): string {
  const lines = screen.split("\n");
  const at = lines.findLastIndex((l) => /Hook PreToolUse:(\S+) requires confirmation/.test(l) && (!tool || l.includes(`PreToolUse:${tool} `)));
  if (at < 0) return "";
  const rest = lines.slice(at + 1);
  if (!rest.some((l) => /Do you want to proceed\?/.test(l))) return "";
  const start = typeof command === "string" ? command.trim().split("\n")[0].slice(0, 20) : "";
  if (start && !lines.slice(0, at).some((l) => l.includes(start))) return "";
  const said: string[] = [];
  for (const l of rest) {
    const m = l.match(/^\s*│\s?(.*)$/);
    if (!m) break;
    said.push(m[1]);
  }
  return said.length ? firstSentence(said.join(" ")) : "";
}

/** a reason's first sentence (what follows is usually for the agent), on one line, at most 300 characters */
export function firstSentence(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  const m = one.match(/^.*?[.!?](?=\s+[A-Z"“(]|$)/);
  const first = m ? m[0] : one;
  return first.length > 300 ? `${first.slice(0, 299).trimEnd()}…` : first;
}

/** how long a task's row says its prompt was just answered */
export const ANSWERED_SHOW_MS = 2 * 60_000;

/** The answer a task's agent just got (its newest closed ask, answered here or in its terminal, under
 *  ANSWERED_SHOW_MS ago), as its row says it: Yes or No for a permission, nothing more for a question or plan. */
export function justAnswered(ends: AskEnd[], now = Date.now()): Task["answered"] | undefined {
  const e = [...ends].filter((x) => x.done).sort((a, b) => b.done! - a.done!)[0];
  if (!e || now - e.done! > ANSWERED_SHOW_MS) return undefined;
  const a = answerOf(e.how);
  if (!a) return undefined;
  return { ...(e.kind === "permission" && a.yes !== undefined ? { choice: a.yes ? "Yes" as const : "No" as const } : {}), at: e.done! };
}

/** Each live task's just-answered mark (compat.ts's hook point): its worker's closed asks by its address. */
export function markAnswered(tasks: Task[], endsOf: (task: Task) => AskEnd[], now = Date.now()) {
  for (const t of tasks) {
    if (t.archived || t.status === "done") continue;
    const a = justAnswered(endsOf(t), now);
    if (a) t.answered = a;
  }
}

/** The hook asks among a snapshot's needs, one per task (its oldest): each holds its task under Needs you. open: the
 *  ids of the asks still waiting. */
export function promptNeeds(needs: Need[], open: Iterable<string>): (Need & { task: string; question: Question })[] {
  const ids = new Set(open);
  const out = new Map<string, Need & { task: string; question: Question }>();
  for (const n of [...needs].sort((a, b) => a.at - b.at)) {
    if (!n.task || !n.question || n.question.queued || n.assistantFirst || !ids.has(n.id) || out.has(n.task)) continue;
    out.set(n.task, n as Need & { task: string; question: Question });
  }
  return [...out.values()];
}

/** Holds each task whose agent waits on a hook ask under Needs you, as compat.ts holds one at a start screen: its
 *  status, its row's words (what the prompt asks: "Wants to run git push origin main") and since when it waits. A start
 *  screen of the same task, held after this, wins. open: the asks still waiting, by id. */
export function holdForPrompts(tasks: Task[], needs: Need[], open: Map<string, { words?: { kind?: string; title?: string } }>) {
  for (const n of promptNeeds(needs, open.keys())) {
    const task = tasks.find((t) => t.id === n.task);
    if (!task || task.archived || !["working", "ready", "needs"].includes(task.state ?? "")) continue;
    const w = open.get(n.id)?.words;
    const sub = w?.kind === "permission" && w.title ? `Wants to ${allowWhat(w.title, true)}` : n.question.title;
    task.state = "needs";
    task.status = "need";
    task.sub = sub;
    task.needsAt = n.at;
    delete task.left;
    if (task.report) task.report = { msg: sub, progress: task.report.progress, paused: true };
    else task.report = { msg: sub, paused: true };
    if (task.agent) task.agent.status = "need";
  }
}

// a permission card's title (core/asks.js words()) as what it asks: [its start, after "Asked to allow", after "Wants to"]
const VERBS: [RegExp, string, string][] = [
  [/^Write\s+/, "writing ", "write "], [/^Edit\s+/, "editing ", "edit "], [/^Read\s+/, "reading ", "read "],
  [/^Fetch\s+/, "fetching ", "fetch "], [/^Search the web:\s*/, "a web search for ", "search the web for "],
  [/^Search for\s+/, "a search for ", "search for "], [/^Use\s+/, "using ", "use "],
];

/** What a permission's card asked, as a few words after "Asked to allow" ("running npm test"), or after "Wants to"
 *  ("run npm test") with wants. */
export function allowWhat(title: string, wants = false): string {
  const t = title.trim();
  const run = t.match(/^Run:\s*(.*)$/s);
  if (run) {
    // a command that only moves into its folder first says what it runs there
    const cmd = run[1].replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/, "").trim();
    return `${wants ? "run" : "running"} ${clip(cmd || run[1].trim(), 60)}`;
  }
  for (const [re, allow, want] of VERBS) if (re.test(t)) return clip((wants ? want : allow) + t.replace(re, ""), 70);
  return clip(t ? (wants ? `use ${t}` : t[0].toLowerCase() + t.slice(1)) : "a tool", 70);
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
};

/** How a closed ask went, from its end words (core/asks.js howAnswered, hooks/ask-hook.sh): answered Yes or No, and
 *  where when that is known; null when nobody answered it here (its agent stopped, it went back to its terminal).
 *  "Answered" alone says it was answered, not which way (a question's answer, or a terminal answer the hook couldn't
 *  read off Claude's log), and "Declined or interrupted" may be an Esc rather than a No: no Yes or No then, and the
 *  chat line keeps the hook's own words. */
export function answerOf(how: string): { yes?: boolean; where: string } | null {
  const m = how.trim().match(/^(Allowed|Approved|Answered|Denied|Dismissed|Declined(?: or interrupted)?)\b\s*(.*)$/i);
  if (!m) return null;
  return { ...(/^(answered|declined or interrupted)$/i.test(m[1]) ? {} : { yes: /^(allowed|approved)$/i.test(m[1]) }), where: m[2].trim() };
}

/** A closed permission's line in its chat: "Asked to allow <what>: answered Yes on the web" with when it closed (the
 *  page adds the time, in the reader's own clock), or "Asked to allow <what>: <how it went>" when nobody answered it
 *  here; null for any other kind of ask (a question, a plan), which keeps its own line. */
export function answeredLine(e: AskEnd, prefix = ""): Message | null {
  if (e.kind !== "permission") return null;
  const what = allowWhat(e.title);
  const a = answerOf(e.how);
  const words = a && a.yes !== undefined ? `answered ${a.yes ? "Yes" : "No"}${a.where ? ` ${a.where}` : ""}` : lower(e.how || "No longer waiting");
  return {
    id: `ae:${e.id}`, who: "agent", at: e.at, ended: `${prefix}Asked to allow ${what}: ${words}`,
    ...(a && e.done ? { endedAt: e.done } : {}),
    // nobody answered it here, so it may still wait in its terminal
    ...(!a && /terminal/i.test(e.how) ? { endedWaits: true as const } : {}),
  };
}

const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
