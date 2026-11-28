"""Shepherdr hands a wait up to the person (dmalis/shepherdr "Needs you 6b: hand-up"; the design: fork/specs/needs-you.md).

An inferred wait (wait_record.py) is Shepherdr's first, quiet. It becomes the person's (red, one alert) once:
- at its deadline, when it is still open (the service reads the clock: web/shared/attention.ts);
- at once when Shepherdr hands it up: `herdr-task alert "<what>" --task <task> [--task <task>] [--choice "<a>" ...]`.
  This writes the hand-up onto each named task's open wait, inside the task list's lock, so it never races the news
  pass that keeps the record:

    wait["up"] = {"at": <ms>, "what": "<the one-line ask>", "why": "<a line more>", "choices": ["<a>", "<b>"],
                  "lead": "<the first named wait's id>", "alert": "<the alert's id>"}   # + "settled": <ms> once answered

  One question over several tasks shares its lead, so it is one action, one card and one alert. A hand-up for a wait
  that is over or was replaced by a new question is late: nothing is written or sent.
- at once when no Shepherdr chat runs in the task's space (a fresh read: the service's).

`herdr-task alert --task <task> --settled [--wait <id>]` takes a hand-up back (Shepherdr got its answer, or the person picked a choice
on its card): the wait is Shepherdr's again, quiet, and its deadline no longer hands it up.
"""

from .base import now
from . import wait_record

MAX_CHOICES = 4
CHOICE_MAX = 40  # a chip that still fits a phone-wide card


def choices_of(raw):
    """The card's choices, cleaned: each a short line, at most four, no repeats."""
    out = []
    for c in raw or []:
        c = " ".join(str(c or "").split())[:CHOICE_MAX]
        if c and c not in out:
            out.append(c)
    return out[:MAX_CHOICES]


def waits_of(raw):
    """--wait as given: one id, or several (one per task); none: any open wait."""
    if not raw:
        return None
    return {raw} if isinstance(raw, str) else {str(w) for w in raw if w}


def handable(t, wait=None):
    """The task's open wait this hand-up may write: open, the one named (when --wait names any), and not answered
    already (a settled hand-up is final for that wait: a retry after it is late, not a new alert)."""
    w = wait_record.open_wait(t)
    waits = waits_of(wait)
    if not w or (waits is not None and w["id"] not in waits):
        return None
    up = w.get("up")
    return None if isinstance(up, dict) and up.get("settled") else w


def lead_of(waits):
    """One question's lead wait, the same whichever order its tasks were named in, or by whom: one it already has
    (a hand-up standing on any of them), else the smallest id."""
    had = sorted(w["up"]["lead"] for w in waits if isinstance(w.get("up"), dict) and w["up"].get("lead"))
    return had[0] if had else min(w["id"] for w in waits)


def mark(tasks, alert_id, what, why="", choices=(), wait=None, at=None, lead=None):
    """Hand up the open waits of these tasks as one question. tasks: the task dicts. wait: the wait id (or ids) the
    caller saw (news' wait="…"): only those are handed up, and a hand-up for a wait no longer open, replaced or
    already answered is late. lead: the question's lead wait (lead_of), when the waits were read apart. Returns
    (the ids of the waits handed up, the ids of those that were not handed up before): none handed: nothing was written."""
    at = at or now()
    open_ = [w for w in (handable(t, wait) for t in tasks) if w]
    if not open_:
        return [], []
    lead = lead or lead_of(open_)
    up = {"at": at, "what": " ".join(str(what or "").split())[:120], "lead": lead, "alert": alert_id}
    why = " ".join(str(why or "").split())[:300]
    if why:
        up["why"] = why
    picks = choices_of(choices)
    if picks:
        up["choices"] = picks
    fresh = []
    for w in open_:
        # a second hand-up of the same wait keeps its lead, time and alert: the same one action, no second alert
        had = w.get("up") if isinstance(w.get("up"), dict) else None
        if had:
            w["up"] = {**up, "lead": had.get("lead") or lead, "at": had.get("at") or at, "alert": had.get("alert") or alert_id}
        else:
            w["up"] = dict(up)
            fresh.append(w["id"])
    return [w["id"] for w in open_], fresh


def settle(tasks, at=None, wait=None):
    """Take back the hand-up of these tasks' open waits (only the ones named, when --wait names any: an old card never
    settles a newer question; a wait named by its own id or by its question's lead). Returns the ids settled."""
    at = at or now()
    waits = waits_of(wait)
    out = []
    for t in tasks:
        w = wait_record.open_wait(t)
        up = w.get("up") if w else None
        if isinstance(up, dict) and not up.get("settled") and (waits is None or w["id"] in waits or up.get("lead") in waits):
            w["up"]["settled"] = at
            out.append(w["id"])
    return out
