// A Ready task waiting on its pull request's checks (dmalis/shepherdr#42): what it waits for, in words, from the checks'
// real state, never "Merging" while nothing merges. herdr-task's tick keeps each check on the task (task.pr.runs: its
// name, state, when it started and ended, and typ: how long the same check took on this repo's earlier pull requests,
// herdr_task/checkwait.py); this reads them. The same words as checkwait.py's line() (core/checks-wait.cases.json).
//
// As GitHub's merge box and Vercel's deployments: "1 of 2 passed", the time left where it's known, a check that failed
// or runs far past its usual time named, and what happens once they're done.

const MIN = 60000;
// a check this far past its usual time (or this long with no usual time known) is slow, and named
const SLOW_OVER = 10 * MIN;
const SLOW_NONE = 30 * MIN;
const STATES = ["passed", "failed", "running", "queued", "skipped"];
// what herdr-task's tick says a Ready task's pull request waits on (task.pr.wait, github.py pr_wait): only these are
// the checks' (a check that never started stops being waited on, and the task is the person's)
const WAITS = "Checks running";
const BACK = "Back to its agent to fix";
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** Its pull request's checks while a Ready task waits on them: { state, line, next, passed, total, ...the facts
 *  waitWords() takes }, or null when it doesn't (no pull request, merged, its merge asked for or in GitHub's queue,
 *  herdr-task's tick not waiting on its checks). now: ms. */
export function checksWait(task, now = Date.now()) {
  const pr = task?.pr;
  if (!pr || task.merged || task.merge_requested || task.merge_queued || task.state !== "ready") return null;
  if (!(pr.wait === WAITS || (pr.wait === BACK && pr.checks === "failed"))) return null;
  const runs = (Array.isArray(pr.runs) ? pr.runs : []).filter((r) => r && typeof r.n === "string").map((r) => ({
    name: r.n, state: STATES.includes(r.s) ? r.s : "running", at: num(r.at), end: num(r.end),
    typical: num(r.typ), ...(typeof r.u === "string" && r.u ? { url: r.u } : {}),
  }));
  const c = pr.runs_cut && typeof pr.runs_cut === "object" ? pr.runs_cut : {};
  return waitWords({ runs, more: !!pr.runs_more, auto: !!task.auto_merge, back: pr.wait === BACK,
    failed: pr.checks === "failed", cut: { p: num(c.p), o: num(c.o), f: num(c.f) }, approval: !!pr.needs_approval,
    held: !!pr.runs_held, base: task.base || "main" }, now);
}

/** The words for checks as checksWait() keeps them, at a time: the page asks again, with the same facts, as the minutes
 *  pass. runs: the rows kept; cut: how many past them passed, are open, failed ({ p, o, f }); back: the tick sent it
 *  back to its agent (a failure counts only then: a new hand-in's rows of the commit before are gone); failed: GitHub
 *  says one failed; held: its base fails them too, so its agent isn't asked; approval: a review still needed. */
export function waitWords(facts, now = Date.now()) {
  const { runs, more, auto, back = false, failed: anyFailed = false, cut = {}, approval = false, held = false, base: on = "main" } = facts;
  const cp = num(cut.p), co = num(cut.o), cf = num(cut.f);
  const counted = runs.filter((r) => r.state !== "skipped");
  const passed = counted.filter((r) => r.state === "passed").length + cp;
  const failed = counted.filter((r) => r.state === "failed");
  const open = counted.filter((r) => r.state === "running" || r.state === "queued");
  const base = { ...facts, passed, total: counted.length + cp + co + cf, more: !!more, auto: !!auto, runs };
  if (back && (failed.length || cf || anyFailed)) {
    const others = failed.length ? failed.length - 1 + cf : cf - 1;
    const which = `${failed.length ? `“${failed[0].name}” failed` : "A check failed"}${others > 0 ? ` and ${others} more` : ""}`;
    if (held) return { ...base, state: "failed", line: `${which} · on ${on} too, waits for it to be fixed`,
      next: `The same check fails on ${on}, so its agent isn't asked to fix it. Herdr goes on once ${on} is green again.` };
    return { ...base, state: "failed", line: `${which} · back to its agent to fix`,
      next: "Its agent gets the failure to fix, then hands it in again." };
  }
  const slow = open.find((r) => r.state === "running" && r.at && now - r.at > (r.typical ? Math.max(2 * r.typical, r.typical + SLOW_OVER) : SLOW_NONE));
  if (slow) {
    const ran = Math.round((now - slow.at) / MIN);
    return { ...base, state: "slow", line: `“${slow.name}” is taking longer than usual · ${ran} min so far${slow.typical ? `, usually ${Math.max(1, Math.round(slow.typical / MIN))}` : ""}`,
      next: "Herdr keeps waiting for it. GitHub shows why it's slow." };
  }
  const next = auto ? (approval ? "It merges by itself once they pass and it's approved." : "It merges by itself once they pass.") : "Once they pass, it's yours to merge.";
  if (!base.total) return { ...base, state: "running", line: "Waiting for GitHub's checks", next };
  const count = more || !(open.length || co) ? `${passed} passed, more to come` : `${passed} of ${base.total} passed`;
  const left = co ? "" : leftOf(open, now);
  return { ...base, state: "running", line: `Waiting for GitHub's checks · ${count}${left ? ` · ${left}` : ""}`, next };
}

/** about how long the checks still running take, from their usual times ("about 8 min", "almost done"), or "" when
 *  one of them has no usual time (nobody knows) */
function leftOf(open, now) {
  // a running check with no start time: nobody knows how far it is
  if (!open.length || open.some((r) => !r.typical || (r.state === "running" && !r.at))) return "";
  const ms = Math.max(...open.map((r) => r.typical - (r.state === "running" ? now - r.at : 0)));
  return ms <= MIN ? "almost done" : `about ${Math.ceil(ms / MIN)} min`;
}

/** one check's state in a few words, for its row: "passed · 2 min", "running · 4 min of about 9", "queued" */
export function runWords(r, now = Date.now()) {
  const took = (ms) => `${Math.max(1, Math.round(ms / MIN))} min`;
  if (r.state === "passed" || r.state === "failed") return r.at && r.end > r.at ? `${r.state} · ${took(r.end - r.at)}` : r.state;
  if (r.state === "skipped") return "skipped";
  if (r.state === "queued") return r.typical ? `queued · usually ${took(r.typical)}` : "queued";
  if (!r.at) return r.typical ? `running · usually ${took(r.typical)}` : "running";
  const ran = now - r.at;
  return r.typical ? `running · ${took(ran)} of about ${Math.max(1, Math.round(r.typical / MIN))}` : `running · ${took(ran)}`;
}
