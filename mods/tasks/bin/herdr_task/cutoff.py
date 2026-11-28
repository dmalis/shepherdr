"""A check cut off at its time limit is not a failed check (dmalis/shepherdr: Needs you only when it's yours).

GitHub ends a job that runs past its timeout-minutes as CANCELLED, with an annotation that says it "has exceeded the
maximum execution time". A newest run of a check that ended so (a newer run of the same check supersedes it:
github.latest_checks()) read as "Checks failing", which set the task's attention, while its agent never heard of it
(ghnews.pr_news() leaves CANCELLED out): only the person could settle it. Now such a check, from a GitHub Actions run,
is run again by itself, once per run at the pull request's head (`gh run rerun`), and reads as running meanwhile. Cut
off again (or GitHub refusing the rerun each time), it is its agent's to fix like any failed check: it reads TIMED_OUT,
with cut_off set, so its news and its card say so.

Only a time limit counts: a run someone cancelled, or one GitHub cancelled for a newer one, is never run again (its
annotation says otherwise, or can't be read: it reads as before). A rerun waits until its whole run has ended (GitHub
refuses one while a sibling job still runs), and a refusal is tried again a few times, later (an hour's request limit
spent, a blip); one GitHub never takes stands, with its reason."""

import re

from . import checkwait, github
from .base import now

CUT = {"CANCELLED", "TIMED_OUT"}
TIME_LIMIT = "exceeded the maximum execution time"  # GitHub's annotation on a job ended at its timeout-minutes
RERUN_WAIT_MS = 10 * 60000  # GitHub shows the rerun's new attempt within this; past it, the old row stands again
RETRY_MS = 5 * 60000  # a refused rerun is tried again this much later ...
TRIES = 3  # ... this many times in all


def run_of(c):
    """The GitHub Actions run a check row belongs to (from its link), or None (a commit status, another CI)."""
    m = re.search(r"/actions/runs/(\d+)", c.get("detailsUrl") or c.get("targetUrl") or "")
    return m.group(1) if m else None


def job_of(c):
    """Its job's id (an Actions job is a check run of that id), or None."""
    m = re.search(r"/actions/runs/\d+/job/(\d+)", c.get("detailsUrl") or c.get("targetUrl") or "")
    return m.group(1) if m else None


def ended_so(c):
    """A row that ended CANCELLED or TIMED_OUT in an Actions run: its run, else None."""
    return run_of(c) if (c.get("conclusion") or "").upper() in CUT else None


def again(c):
    return {**c, "status": "QUEUED", "conclusion": "", "startedAt": "", "completedAt": ""}


def stands(c, why=None):
    return {**c, "status": "COMPLETED", "conclusion": "TIMED_OUT", "cut_off": True, **({"rerun_refused": why} if why else {})}


def said(c):
    """How a failed check's news line says it ended: failed, or cut off at its time limit (and why it wasn't rerun)."""
    if not c.get("cut_off"):
        return "failed"
    if c.get("rerun_refused"):
        return f"was cut off at its time limit, and GitHub refused to run it again ({c['rerun_refused']})"
    return "was cut off at its time limit, again after Herdr ran it once more"


def timed_out(repo, c, rec):
    """Whether its job was cut off at its time limit: TIMED_OUT, or CANCELLED with GitHub's annotation saying so (read
    once per job, kept in rec["why"]). Unreadable: None, asked again next time."""
    if (c.get("conclusion") or "").upper() == "TIMED_OUT":
        return True
    job = job_of(c)
    if not job:
        return False
    why = rec.setdefault("why", {})
    if job not in why:
        ok, out, _ = github.gh("api", f"repos/{repo}/check-runs/{job}/annotations", "-q", "[.[].message]")
        if not ok:
            return None
        why[job] = TIME_LIMIT in out
    return why[job]


def read(s, t, v, rerun=False, report=None):
    """v (pr_view's answer) as its task should read it: a row cut off at its time limit read as queued while it runs
    again (rerun: the tick runs it again here, once per run at this head), or as TIMED_OUT and cut_off once it was cut
    off again. Keeps pr["rerun"] = {head, why: {job: cut at its time limit}, runs: {run: when it was run again},
    tries: {run: [times refused, last try]}, failed: {run: why}} on the task."""
    rows = v.get("statusCheckRollup") or []
    if not any(ended_so(c) for c in rows):
        return v
    pr = t.setdefault("pr", {})
    repo, head = pr.get("repo") or "", v.get("headRefOid") or ""
    old = pr.get("rerun") or {}
    rec = old if old.get("head") == head else {"head": head}
    before = repr(rec)
    cut = {}  # row index: its run, for the rows cut off at their time limit
    for i, c in enumerate(rows):
        rid = ended_so(c)
        if rid and timed_out(repo, c, rec):
            cut[i] = rid
    # GitHub reruns a run only once all of it ended: a sibling job still running holds it
    busy = {run_of(c) for c in rows if run_of(c) and (c.get("status") or "").upper() != "COMPLETED"}
    runs, failed, tries = rec.get("runs") or {}, rec.get("failed") or {}, rec.get("tries") or {}
    fresh = sorted(set(cut.values()) - set(runs) - set(failed) - busy)
    if rerun:
        for rid in fresh:
            n, last = tries.get(rid) or (0, 0)
            if n and now() - last < RETRY_MS:
                continue
            ok, _, err = github.gh("run", "rerun", rid, "--repo", repo)
            if ok:
                rec.setdefault("runs", {})[rid] = now()
                rec.get("tries", {}).pop(rid, None)
                if report is not None:
                    report.setdefault("rerun", []).append({"task": s.ref(t), "run": rid})
            elif github.ghbudget.limited(err):
                rec.setdefault("tries", {})[rid] = [n, now()]  # no request went out, or the hour's limit: not a try
            elif n + 1 >= TRIES:
                rec.setdefault("failed", {})[rid] = (err or "GitHub refused").strip()[:200]
                rec.get("tries", {}).pop(rid, None)
            else:
                rec.setdefault("tries", {})[rid] = [n + 1, now()]
    if repr(rec) != before or pr.get("rerun") is not rec:
        pr["rerun"] = rec
        s.dirty = True
    runs, failed = rec.get("runs") or {}, rec.get("failed") or {}
    out = []
    for i, c in enumerate(rows):
        rid = cut.get(i)
        if not rid:
            out.append(c)
        elif rid in failed:
            out.append(stands(c, failed[rid]))
        elif rid in runs:
            ended, at = checkwait._ms(c.get("completedAt")), runs[rid] or 0
            # the old attempt GitHub still shows, a moment after its rerun (longer while Actions says a run is on its way)
            waiting = bool(ended) and ended < at and (now() - at < RERUN_WAIT_MS or bool(v.get("runs_pending")))
            out.append(again(c) if waiting else stands(c))  # cut off again: its agent's to fix
        else:
            out.append(again(c))  # runs again at the tick's next look (a merge by hand never reruns it)
    return {**v, "statusCheckRollup": out}
