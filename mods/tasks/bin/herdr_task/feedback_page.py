"""The person's own calls on a kept problem, from the Feedback page (friction loop, slice 2, #94:
fork/specs/friction-loop.md): Not now (`--later tomorrow|week|again`), Never (`--no --person`), Undo or Restore
(`--undo`), and what they write in the page's box (`--person "<line>" --space <id>`, plus `--action "<label>"` when the
box was opened from a failed action's Report, slice 7). Each is refused in an agent's terminal: only the service runs
them, for the person's tap. Nothing here posts anything; the decision stays local.

A problem keeps upstream's `state`; the person's decision is kept beside it, in `decision` ("later" with `until`, a
time in ms or None for "when it happens again"; "declined"), with `was` holding what Undo puts back. Not now ends on
its own: at its time (read as found from then on, nothing rewritten) or when it's reported again (feedback.add_report)."""

import os
import re

from .base import Fail, now
from .feedback import problems

DAY_MS = 24 * 3600000
LATER = {"tomorrow": DAY_MS, "week": 7 * DAY_MS, "again": None}
KEPT = ("state", "decision", "until")
# a failed action's label, from the app's fixed list ("Mark as done", "Start", "Send"): a few plain words, never the
# error's own text (slice 7)
ACTION = re.compile(r"[A-Z][a-z]*(?: [a-z-]+){0,4}")


def in_agent_terminal(env=None):
    """An agent's terminal (any herdr-core terminal has HC_TERMINAL_ID): the person's calls are refused there. Agents
    run as the same user, so this stops mistakes, not a determined agent; their instructions forbid it too."""
    if env is None:
        from . import base  # base drops another core session's terminal id (FOREIGN_TERMINAL): still an agent's
        env = os.environ if not getattr(base, "FOREIGN_TERMINAL", False) else {"HC_TERMINAL_ID": "another session's"}
    return bool(env.get("HC_TERMINAL_ID") or env.get("HC_TERMINAL_SOCKET"))


def person_from(args):
    """Who a report from the app is from: the person, or the person reporting a failed action by its label."""
    a = getattr(args, "action", None)
    return {"action": a} if a else {"person": True}


def person_call(args):
    """Whether these arguments are the person's own call (refused in an agent's terminal)."""
    return bool(getattr(args, "person", False) or getattr(args, "later", None) or getattr(args, "undo", False))


def later_until(when, at=None):
    """Not now's end in ms (None: when it happens again)."""
    if when not in LATER:
        raise Fail("Not now is tomorrow, week or again.")
    ms = LATER[when]
    return None if ms is None else (now() if at is None else at) + ms


def comes_back(p, at=None):
    """A Not now whose time came: read as found again (nothing rewritten)."""
    u = p.get("until")
    return p.get("decision") == "later" and isinstance(u, (int, float)) and u <= (now() if at is None else at)


def snoozed(p, at=None):
    """The person's Not now, still running: the problem isn't listed or offered in chat until it comes back."""
    return p.get("decision") == "later" and not comes_back(p, at)


def decide(args):
    """The person's Not now, Never or Undo on one problem, under the record's lock: True once said. None when these
    arguments aren't one of them (a report from the box goes on as any report, marked from the person)."""
    from .output import say
    a = getattr(args, "action", None)
    if a is not None and not (getattr(args, "person", False) and len(a) <= 40 and ACTION.fullmatch(a)):
        raise Fail("--action is the label of the app's action that failed, with --person: --action \"Mark as done\".")
    if not person_call(args):
        return None
    if in_agent_terminal():
        raise Fail("Only the person decides this, on the Feedback page: an agent can't. Report a problem with "
                   "herdr-task feedback \"<one line>\" --details \"…\" and carry on.")
    later, undo, no = getattr(args, "later", None), getattr(args, "undo", False), getattr(args, "no", False)
    if not (later or undo or no):
        if not args.line or args.key or args.list or args.file:
            raise Fail("--person is the person's report from the app: herdr-task feedback \"<one line>\" --person --space <id>")
        if not getattr(args, "space", None):
            raise Fail("Name the space the report comes from: --space <id>.")
        return None
    if not args.key:
        raise Fail("Which problem? Pass --key <its id>, as --list --all gives it.")
    with problems() as ps:
        p = ps.get(args.key)
        if not isinstance(p, dict):
            raise Fail("No problem with that key is kept here.")
        said = change(ps, args.key, p, later, undo, no, getattr(args, "expect", None))
    say(args, {"key": args.key, **said[0]}, said[1])
    return True


def change(ps, key, p, later, undo, no, expect=None):
    """One decision on problem p (under the lock): ({changed, ...}, words). Two devices tapping at once: the second
    finds it already so and says so."""
    if p.get("state") in ("filed", "filing"):
        return {"changed": False, "why": "filed"}, "It's filed already: nothing to decide here."
    if undo:
        # the page's Undo names the decision it is for: one made since (another device) is left alone
        now_is = "declined" if p.get("state") == "declined" or p.get("decision") == "declined" else p.get("decision")
        if expect and now_is != expect:
            return {"changed": False}, "That was decided again since: nothing undone."
        was = p.get("was")
        if not isinstance(was, dict) and p.get("state") != "declined" and p.get("decision") is None:
            return {"changed": False}, "Nothing to undo."
        back = {k: v for k, v in (was or {}).items() if k in KEPT and v is not None}
        back.setdefault("state", "found" if p.get("state") == "declined" else p.get("state") or "found")
        rest = {k: v for k, v in p.items() if k not in (*KEPT, "was", "decided")}
        if p.get("decision") == "following":  # Follow this one undone (feedback_check.follow): its issue link goes too
            url = (rest.pop("outcome", None) or {}).get("url")
            rest["related"] = [x for x in rest.get("related") or [] if not (isinstance(x, dict) and x.get("url") == url)]
            if not rest["related"]:
                rest.pop("related")
        ps[key] = {**rest, **back}
        return {"changed": True, "state": back["state"]}, "Back as it was."
    if p.get("decision") == "following":
        return {"changed": False, "why": "following"}, "It follows an issue: Undo that first."
    from .feedback_post import cleared, stale  # Not now and Never take back a yes to post it (slice 4)
    post = p.get("post") or {}
    if post.get("state") == "posting" and not stale(post):
        return {"changed": False, "why": "posting"}, "It's being posted right now: nothing changed."
    if post.get("state") == "unsure" and not no:
        return {"changed": False, "why": "unsure"}, "It may have been posted: only Never is left for it."
    p = cleared(p)
    was = {k: (None if k == "decision" and p.get(k) == "approved" else p.get(k)) for k in KEPT}
    if no:
        if p.get("decision") == "declined":
            return {"changed": False, "state": "declined"}, "Already said no."
        ps[key] = {**p, "state": "declined", "decision": "declined", "until": None, "was": was, "decided": {"at": now(), "by": "page"},
                   "unyes": now()}  # Triage's yes (the app's, #235) made before this no longer counts, Undo or not
        return {"changed": True, "state": "declined"}, "Said no: it won't be offered again."
    until = later_until(later)
    if p.get("state") == "declined":
        return {"changed": False, "state": "declined"}, "The person said no to this one: Undo first."
    ps[key] = {**p, "decision": "later", "until": until, "was": p.get("was") if p.get("decision") == "later" else was,
               "decided": {"at": now(), "by": "page"}, "unyes": now()}
    return {"changed": True, "until": until}, "Not now: it comes back " + ("when it happens again." if until is None else "on its own.")
