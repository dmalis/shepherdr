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

/** Its pull request's checks while a Ready task waits on them: { state, line, next, passed, total, more, auto, runs },
 *  or null when it doesn't (no pull request, merged, its merge asked for or in GitHub's queue, its checks passed or
 *  never read). now: ms. */
export function checksWait(task, now = Date.now()) {
  const pr = task?.pr;
  if (!pr || task.merged || task.merge_requested || task.merge_queued || task.state !== "ready") return null;
  if (!(pr.checks === "running" || pr.checks === "failed" || pr.wait === "Checks running")) return null;
  const runs = (Array.isArray(pr.runs) ? pr.runs : []).filter((r) => r && typeof r.n === "string").map((r) => ({
    name: r.n, state: STATES.includes(r.s) ? r.s : "running", at: Number(r.at) || 0, end: Number(r.end) || 0,
    typical: Number(r.typ) || 0, ...(typeof r.u === "string" && r.u ? { url: r.u } : {}),
  }));
  return waitWords({ runs, more: !!pr.runs_more, auto: !!task.auto_merge }, now);
}

/** The words for checks as checksWait() keeps them ({ runs, more, auto }), at a time: the page asks again as the
 *  minutes pass. */
export function waitWords({ runs, more, auto }, now = Date.now()) {
  const counted = runs.filter((r) => r.state !== "skipped");
  const passed = counted.filter((r) => r.state === "passed").length;
  const failed = counted.filter((r) => r.state === "failed");
  const open = counted.filter((r) => r.state === "running" || r.state === "queued");
  const base = { passed, total: counted.length, more: !!more, auto: !!auto, runs };
  if (failed.length) {
    return { ...base, state: "failed", line: `“${failed[0].name}” failed${failed.length > 1 ? ` and ${failed.length - 1} more` : ""} · back to its agent to fix`,
      next: "Its agent gets the failure to fix, then hands it in again." };
  }
  const slow = open.find((r) => r.state === "running" && r.at && now - r.at > (r.typical ? Math.max(2 * r.typical, r.typical + SLOW_OVER) : SLOW_NONE));
  if (slow) {
    const ran = Math.round((now - slow.at) / MIN);
    return { ...base, state: "slow", line: `“${slow.name}” is taking longer than usual · ${ran} min so far${slow.typical ? `, usually ${Math.max(1, Math.round(slow.typical / MIN))}` : ""}`,
      next: "Herdr keeps waiting for it. GitHub shows why it's slow." };
  }
  const next = auto ? "It merges by itself once they pass." : "Once they pass, it's yours to merge.";
  if (!counted.length) return { ...base, state: "running", line: "Waiting for GitHub's checks", next };
  const count = more || !open.length ? `${passed} passed, more to come` : `${passed} of ${counted.length} passed`;
  const left = leftOf(open, now);
  return { ...base, state: "running", line: `Waiting for GitHub's checks · ${count}${left ? ` · ${left}` : ""}`, next };
}

/** about how long the checks still running take, from their usual times ("about 8 min", "almost done"), or "" when
 *  one of them has no usual time (nobody knows) */
function leftOf(open, now) {
  if (!open.length || open.some((r) => !r.typical)) return "";
  const ms = Math.max(...open.map((r) => r.typical - (r.state === "running" && r.at ? now - r.at : 0)));
  return ms <= MIN ? "almost done" : `about ${Math.ceil(ms / MIN)} min`;
}

/** one check's state in a few words, for its row: "passed · 2 min", "running · 4 min of about 9", "queued" */
export function runWords(r, now = Date.now()) {
  const took = (ms) => `${Math.max(1, Math.round(ms / MIN))} min`;
  if (r.state === "passed" || r.state === "failed") return r.at && r.end > r.at ? `${r.state} · ${took(r.end - r.at)}` : r.state;
  if (r.state === "skipped") return "skipped";
  if (r.state === "queued" || !r.at) return r.typical ? `queued · usually ${took(r.typical)}` : "queued";
  const ran = now - r.at;
  return r.typical ? `running · ${took(ran)} of about ${Math.max(1, Math.round(r.typical / MIN))}` : `running · ${took(ran)}`;
}
