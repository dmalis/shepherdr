"""A Ready task waiting on its pull request's checks (dmalis/shepherdr#42): the tick keeps each check on the task
(keep(): pr["runs"], each with how long the same check took on this repo's earlier pull requests), and line() says
what it waits for in a few words, never "Merging" while nothing merges. The same words as core/checks-wait.js
(core/checks-wait.cases.json), which the web app reads."""

import datetime
import math

from .base import now
from .github import BACK_TO_AGENT, CHECKS_RUNNING

MIN = 60000


def _round(x):
    """JS Math.round (half up), not Python's half to even: the same words as checks-wait.js"""
    return int(math.floor(x + 0.5))

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


# kept first when there are more than MOST: what blocks the merge, then what still runs
ORDER = {"failed": 0, "running": 1, "queued": 2, "passed": 3, "skipped": 4}


def runs_of(v):
    """Its checks as the task keeps them: [{n: name, s: state, at, end (ms), u: link}], from gh pr view's rows, at most
    MOST of them, failed and open ones first; and how many of each didn't fit ({p: passed, o: open, f: failed}), so
    the count and the time left stay those of all of them."""
    out = []
    for c in v.get("statusCheckRollup") or []:
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
    if len(out) <= MOST:
        return out, {}
    out.sort(key=lambda r: ORDER[r["s"]])  # stable: GitHub's order within each
    rest = out[MOST:]
    cut = {"p": sum(r["s"] == "passed" for r in rest), "o": sum(r["s"] in ("running", "queued") for r in rest),
           "f": sum(r["s"] == "failed" for r in rest)}
    return out[:MOST], {k: n for k, n in cut.items() if n}


def usual(s, task):
    """How long each check took on this repo's earlier, merged pull requests (ms, the middle of the last USUAL_FROM),
    from the checks those tasks kept: {name: ms}. Worked out once per repo for the store's life (a tick)."""
    repo = (task.get("pr") or {}).get("repo")
    cache = s.__dict__.setdefault("_usual_checks", {})
    if repo in cache:
        return cache[repo]
    times = {}
    done = sorted((t for t in s.data.get("tasks") or [] if t.get("merged") and (t.get("pr") or {}).get("repo") == repo
                   and (t.get("pr") or {}).get("runs")), key=lambda t: t.get("ready_at") or 0, reverse=True)
    for t in done:
        for r in t["pr"]["runs"]:
            at, end = _num(r.get("at")), _num(r.get("end"))
            if r.get("s") == "passed" and at and end > at:
                got = times.setdefault(r["n"], [])
                if len(got) < USUAL_FROM:
                    got.append(int(end - at))
    cache[repo] = {n: sorted(ms)[len(ms) // 2] for n, ms in times.items()}
    return cache[repo]


def keep(s, task, v, missing=False, held=False):
    """The tick's look at its pull request (v: pr_view's answer, a merge's own checks only): each check kept on the
    task, with its usual time, and runs_more while more will come (a workflow not started, checks expected). held:
    its failed checks fail its base too (ghnews.held_by_base): its agent isn't asked to fix them."""
    pr = task["pr"]
    if bool(held) != bool(pr.get("runs_held")):
        if held:
            pr["runs_held"] = True
        else:
            pr.pop("runs_held", None)
        s.dirty = True
    runs, cut = runs_of(v)
    typ = usual(s, task) if runs else {}
    for r in runs:
        if typ.get(r["n"]):
            r["typ"] = typ[r["n"]]
    more = bool(v.get("runs_pending") or missing)
    if cut != (pr.get("runs_cut") or {}):
        if cut:
            pr["runs_cut"] = cut
        else:
            pr.pop("runs_cut", None)
        s.dirty = True
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


def fresh(pr):
    """A new hand-in on the same pull request: the checks kept from the commit before are no longer what it waits on."""
    for k in ("runs", "runs_cut", "runs_more", "runs_held"):
        pr.pop(k, None)


def _num(x):
    """A kept time as a number, as JS Number(): text that reads as one too, anything else 0."""
    if isinstance(x, bool):
        return int(x)
    try:
        v = float(x)
    except (TypeError, ValueError):
        return 0
    return v if math.isfinite(v) else 0


def line(task, now_=None):
    """What a Ready task waits on while its checks run, in a few words, or None when it doesn't wait on them. As
    core/checks-wait.js checksWait()'s line. Only while the tick says it waits on them (pr["wait"]): a check that
    never started stops being waited on, and the task is the person's."""
    pr = task.get("pr")
    if not pr or task.get("merged") or task.get("merge_requested") or task.get("merge_queued") or task.get("state") != "ready":
        return None
    if not (pr.get("wait") == CHECKS_RUNNING or (pr.get("wait") == BACK_TO_AGENT and pr.get("checks") == "failed")):
        return None
    t = now() if now_ is None else now_
    runs = [{"name": r["n"], "state": r.get("s") if r.get("s") in ("passed", "failed", "running", "queued", "skipped") else "running",
             "at": _num(r.get("at")), "typical": _num(r.get("typ"))}
            for r in pr.get("runs") or [] if isinstance(r, dict) and isinstance(r.get("n"), str)]
    c = pr.get("runs_cut") if isinstance(pr.get("runs_cut"), dict) else {}
    cp, co, cf = _num(c.get("p")), _num(c.get("o")), _num(c.get("f"))
    counted = [r for r in runs if r["state"] != "skipped"]
    passed = sum(1 for r in counted if r["state"] == "passed") + cp
    total = len(counted) + cp + co + cf
    failed = [r for r in counted if r["state"] == "failed"]
    open_ = [r for r in counted if r["state"] in ("running", "queued")]
    # failed only while the tick sent it back for that (a new hand-in's rows from the commit before were cleared: fresh())
    if pr.get("wait") == BACK_TO_AGENT and (failed or cf or pr.get("checks") == "failed"):
        more = len(failed) - 1 + cf if failed else cf - 1
        which = (f"“{failed[0]['name']}” failed" if failed else "A check failed") + (f" and {_int(more)} more" if more > 0 else "")
        if pr.get("runs_held"):
            return which + f" · on {task.get('base') or 'main'} too, waits for it to be fixed"
        return which + " · back to its agent to fix"
    for r in open_:
        if r["state"] == "running" and r["at"] and t - r["at"] > (max(2 * r["typical"], r["typical"] + SLOW_OVER) if r["typical"] else SLOW_NONE):
            ran = _round((t - r["at"]) / MIN)
            return f"“{r['name']}” is taking longer than usual · {ran} min so far" + \
                (f", usually {max(1, _round(r['typical'] / MIN))}" if r["typical"] else "")
    if not total:
        return "Waiting for GitHub's checks"
    count = f"{_int(passed)} passed, more to come" if pr.get("runs_more") or not (open_ or co) else f"{_int(passed)} of {_int(total)} passed"
    left = ""
    if open_ and not co and all(r["typical"] and not (r["state"] == "running" and not r["at"]) for r in open_):
        ms = max(r["typical"] - (t - r["at"] if r["state"] == "running" else 0) for r in open_)
        left = "almost done" if ms <= MIN else f"about {math.ceil(ms / MIN)} min"
    return f"Waiting for GitHub's checks · {count}" + (f" · {left}" if left else "")


def _int(x):
    return int(x) if float(x).is_integer() else x
