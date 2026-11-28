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

`herdr-task alert --task <task> --settled` takes a hand-up back (Shepherdr got its answer, or the person picked a choice
on its card): the wait is Shepherdr's again, quiet, and its deadline no longer hands it up.
"""

from .base import now
from . import wait_record

MAX_CHOICES = 4
CHOICE_MAX = 60


def choices_of(raw):
    """The card's choices, cleaned: each a short line, at most four, no repeats."""
    out = []
    for c in raw or []:
        c = " ".join(str(c or "").split())[:CHOICE_MAX]
        if c and c not in out:
            out.append(c)
    return out[:MAX_CHOICES]


def mark(tasks, alert_id, what, why="", choices=(), wait=None, at=None, lead=None):
    """Hand up the open waits of these tasks as one question. tasks: the task dicts, in the order named. wait: the wait
    id (or ids) the caller saw (news' wait="…"): only those are handed up, and a hand-up for a wait no longer open is late.
    lead: the question's lead wait, when an earlier list already handed up its first one. Returns the ids of the waits
    handed up (none: nothing was written)."""
    at = at or now()
    open_ = [w for w in (wait_record.open_wait(t) for t in tasks) if w]
    if wait:
        waits = {wait} if isinstance(wait, str) else set(wait)
        open_ = [w for w in open_ if w["id"] in waits]
    if not open_:
        return []
    lead = lead or open_[0]["id"]
    up = {"at": at, "what": " ".join(str(what or "").split())[:120], "lead": lead, "alert": alert_id}
    why = " ".join(str(why or "").split())[:300]
    if why:
        up["why"] = why
    picks = choices_of(choices)
    if picks:
        up["choices"] = picks
    for w in open_:
        # a second hand-up of the same wait keeps its lead, so it stays the same one action (no second alert)
        had = w.get("up") or {}
        w["up"] = {**up, "lead": had.get("lead") or lead, "at": had.get("at") or at} if had and not had.get("settled") else dict(up)
    return [w["id"] for w in open_]


def settle(tasks, at=None):
    """Take back the hand-up of these tasks' open waits. Returns the ids settled."""
    at = at or now()
    out = []
    for t in tasks:
        w = wait_record.open_wait(t)
        if w and isinstance(w.get("up"), dict) and not w["up"].get("settled"):
            w["up"]["settled"] = at
            out.append(w["id"])
    return out
