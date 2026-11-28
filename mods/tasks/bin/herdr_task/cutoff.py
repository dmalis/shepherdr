"""A check cut off at its time limit is not a failed check (dmalis/shepherdr: Needs you only when it's yours).

GitHub ends a job that runs past its timeout-minutes as CANCELLED. A newest run of a check that ended so (a newer run
of the same check supersedes it: github.latest_checks()) read as "Checks failing", which set the task's attention,
while its agent never heard of it (ghnews.pr_news() leaves CANCELLED out): only the person could settle it. Now such a
check, from a GitHub Actions run, is run again by itself, once per run at the pull request's head (`gh run rerun`), and
reads as running meanwhile. Cut off again (or the rerun refused), it is its agent's to fix like any failed check: it
reads TIMED_OUT, with cut_off set, so its news and its card say it was cut off at its time limit."""

import re

from . import checkwait, github
from .base import now

CUT = {"CANCELLED", "TIMED_OUT"}
RERUN_WAIT_MS = 10 * 60000  # GitHub shows the rerun's new attempt within this; past it, the old row stands again


def run_of(c):
    """The GitHub Actions run a check row belongs to (from its link), or None (a commit status, another CI)."""
    m = re.search(r"/actions/runs/(\d+)", c.get("detailsUrl") or c.get("targetUrl") or "")
    return m.group(1) if m else None


def cut(c):
    """A row whose run was cut off (CANCELLED or TIMED_OUT) and can be run again: its run, else None."""
    return run_of(c) if (c.get("conclusion") or "").upper() in CUT else None


def again(c):
    return {**c, "status": "QUEUED", "conclusion": "", "startedAt": "", "completedAt": ""}


def stands(c):
    return {**c, "status": "COMPLETED", "conclusion": "TIMED_OUT", "cut_off": True}


def read(s, t, v, rerun=False, report=None):
    """v (pr_view's answer) as its task should read it: a cut-off row read as queued while it runs again (rerun: the
    tick runs it again here, once per run at this head), or as TIMED_OUT and cut_off once it was cut off again.
    Keeps pr["rerun"] = {head, runs: {run: when it was run again}, failed?: {run: why}} on the task."""
    rows = v.get("statusCheckRollup") or []
    if not any(cut(c) for c in rows):
        return v
    pr = t.get("pr") or {}
    head = v.get("headRefOid") or ""
    rec = pr.get("rerun") if (pr.get("rerun") or {}).get("head") == head else None
    fresh = sorted({cut(c) for c in rows if cut(c)} - set((rec or {}).get("runs") or {}) - set((rec or {}).get("failed") or {}))
    if fresh and rerun:
        rec = rec or {"head": head, "runs": {}}
        for rid in fresh:
            ok, _, err = github.gh("run", "rerun", rid, "--repo", pr.get("repo") or "")
            if ok:
                rec.setdefault("runs", {})[rid] = now()
                if report is not None:
                    report.setdefault("rerun", []).append({"task": s.ref(t), "run": rid})
            else:
                rec.setdefault("failed", {})[rid] = (err or "GitHub refused").strip()[:200]
        pr["rerun"] = rec
        s.dirty = True
    out = []
    for c in rows:
        rid = cut(c)
        if not rid:
            out.append(c)
        elif rid in ((rec or {}).get("failed") or {}):
            out.append(stands(c))
        elif rid in ((rec or {}).get("runs") or {}):
            ended, at = checkwait._ms(c.get("completedAt")), rec["runs"][rid] or 0
            waiting = bool(ended) and ended < at and now() - at < RERUN_WAIT_MS
            out.append(again(c) if waiting else stands(c))  # cut off again: its agent's to fix
        else:
            out.append(again(c))  # runs again at the tick's next look (a merge by hand never reruns it)
    return {**v, "statusCheckRollup": out}
