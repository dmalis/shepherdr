"""A Ready task waiting on its pull request's checks (dmalis/shepherdr#42): the tick keeps each check on the task
(keep(): pr["runs"], each with how long the same check took on this repo's earlier pull requests), and line() says
what it waits for in a few words, never "Merging" while nothing merges. The same words as core/checks-wait.js
(core/checks-wait.cases.json), which the web app reads."""

import datetime

from .base import now

MIN = 60000
SLOW_OVER = 10 * MIN   # a check this far past its usual time is slow, and named
SLOW_NONE = 30 * MIN   # or this long with no usual time known
MOST = 30              # checks kept on a task
USUAL_FROM = 7         # earlier pull requests whose times make a check's usual time

BAD = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"}
QUEUED = {"QUEUED", "WAITING", "PENDING", "REQUESTED", "EXPECTED"}


def _ms(stamp):
    """An ISO time from GitHub in ms; 0 for none (GitHub's 0001-01-01 for a check not started)."""
    try:
        t = int(datetime.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).timestamp() * 1000)
    except (TypeError, ValueError, OverflowError):
        return 0
    return t if t > 0 else 0


def _state(c):
    word = (c.get("conclusion") or "").upper()
    st = (c.get("status") or c.get("state") or "").upper()
    if word in BAD or st in ("FAILURE", "ERROR"):
        return "failed"
    if word == "SKIPPED":
        return "skipped"
    if word in ("SUCCESS", "NEUTRAL") or st == "SUCCESS":
        return "passed"
    if st in QUEUED and not _ms(c.get("startedAt")):
        return "queued"
    return "running"


def runs_of(v):
    """Its checks as the task keeps them: [{n: name, s: state, at, end (ms), u: link}], from gh pr view's rows."""
    out = []
    for c in (v.get("statusCheckRollup") or [])[:MOST]:
        if not isinstance(c, dict) or not (c.get("name") or c.get("context")):
            continue
        r = {"n": c.get("name") or c.get("context"), "s": _state(c)}
        at, end = _ms(c.get("startedAt")), _ms(c.get("completedAt"))
        if at:
            r["at"] = at
        if end and r["s"] in ("passed", "failed", "skipped"):
            r["end"] = end
        if c.get("detailsUrl") or c.get("targetUrl"):
            r["u"] = c.get("detailsUrl") or c.get("targetUrl")
        out.append(r)
    return out


def usual(s, task):
    """How long each check took on this repo's earlier pull requests (ms, the middle of the last USUAL_FROM), from the
    checks other tasks on this list kept: {name: ms}."""
    repo = (task.get("pr") or {}).get("repo")
    times = {}
    others = sorted((t for t in s.data.get("tasks") or [] if t is not task and (t.get("pr") or {}).get("repo") == repo),
                    key=lambda t: t.get("ready_at") or 0, reverse=True)
    for t in others:
        for r in t["pr"].get("runs") or []:
            if r.get("s") == "passed" and r.get("at") and (r.get("end") or 0) > r["at"]:
                got = times.setdefault(r["n"], [])
                if len(got) < USUAL_FROM:
                    got.append(r["end"] - r["at"])
    return {n: sorted(ms)[len(ms) // 2] for n, ms in times.items()}


def keep(s, task, v, missing=False):
    """The tick's look at its pull request (v: pr_view's answer, a merge's own checks only): each check kept on the
    task, with its usual time, and runs_more while more will come (a workflow not started, checks expected)."""
    pr = task["pr"]
    runs = runs_of(v)
    typ = usual(s, task) if runs else {}
    for r in runs:
        if typ.get(r["n"]):
            r["typ"] = typ[r["n"]]
    more = bool(v.get("runs_pending") or missing)
    if runs != pr.get("runs") or more != bool(pr.get("runs_more")):
        if runs:
            pr["runs"] = runs
        else:
            pr.pop("runs", None)
        if more:
            pr["runs_more"] = True
        else:
            pr.pop("runs_more", None)
        s.dirty = True


def line(task, now_=None):
    """What a Ready task waits on while its checks run, in a few words, or None when it doesn't wait on them. As
    core/checks-wait.js checksWait()'s line."""
    pr = task.get("pr")
    if not pr or task.get("merged") or task.get("merge_requested") or task.get("merge_queued") or task.get("state") != "ready":
        return None
    if not (pr.get("checks") in ("running", "failed") or pr.get("wait") == "Checks running"):
        return None
    t = now() if now_ is None else now_
    runs = [{"name": r["n"], "state": r.get("s") if r.get("s") in ("passed", "failed", "running", "queued", "skipped") else "running",
             "at": r.get("at") or 0, "typical": r.get("typ") or 0}
            for r in pr.get("runs") or [] if isinstance(r, dict) and isinstance(r.get("n"), str)]
    counted = [r for r in runs if r["state"] != "skipped"]
    passed = sum(1 for r in counted if r["state"] == "passed")
    failed = [r for r in counted if r["state"] == "failed"]
    open_ = [r for r in counted if r["state"] in ("running", "queued")]
    if failed:
        return f"“{failed[0]['name']}” failed" + (f" and {len(failed) - 1} more" if len(failed) > 1 else "") + " · back to its agent to fix"
    for r in open_:
        if r["state"] == "running" and r["at"] and t - r["at"] > (max(2 * r["typical"], r["typical"] + SLOW_OVER) if r["typical"] else SLOW_NONE):
            ran = round((t - r["at"]) / MIN)
            return f"“{r['name']}” is taking longer than usual · {ran} min so far" + \
                (f", usually {max(1, round(r['typical'] / MIN))}" if r["typical"] else "")
    if not counted:
        return "Waiting for GitHub's checks"
    count = f"{passed} passed, more to come" if pr.get("runs_more") or not open_ else f"{passed} of {len(counted)} passed"
    left = ""
    if open_ and all(r["typical"] for r in open_):
        ms = max(r["typical"] - (t - r["at"] if r["state"] == "running" and r["at"] else 0) for r in open_)
        left = "almost done" if ms <= MIN else f"about {-(-ms // MIN)} min"
    return f"Waiting for GitHub's checks · {count}" + (f" · {left}" if left else "")
