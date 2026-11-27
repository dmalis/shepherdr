"""Urgent tasks (dmalis/shepherdr#119, fork/specs/urgent-tasks.md): the person marks a task urgent, "this one first".

One field on the task, `urgent`: when it was marked (ms), removed by `edit --urgent off`. A task is urgent while that is
set, it is open, it isn't archived and it hasn't been done since it was marked (urgent_now: the one reader here, as
web/shared/urgent.ts isUrgent is the service's). So Done by any path ends it, and nothing that reopens a task brings it
back. Only the person marks one, through the app or by asking Shepherdr: a task's own agents are refused (a guard
against mistakes, not against an agent set on getting round it).

What it changes here: `show` and `list --json` say so, a task's news line to its space's Shepherdr carries
urgent="yes" (read again when the message goes) and comes first in its message, and Shepherdr's settings note has a
row that says what it means. It never changes review, merge, start order, the brief, notifications or a running agent."""

import hashlib
import os

from .base import Fail, now, run

OPEN = ("todo", "scheduled", "queued", "running", "ready")
REFUSED = "Only the person marks a task urgent."
ATTR = ' urgent="yes"'

# The settings note's row: what urgent means, for every Shepherdr chat (assistant_settings.rows).
KEY, LABEL = "urgent", "Urgent tasks"
TEXT = ("the person marks a task urgent (`urgent: true` in `herdr-task list --json`; `urgent=\"yes\"` on its news). Handle its "
        "news before other tasks', and hand it to the person as soon as only they can settle it. Mark or unmark one only when "
        "the person asks (`herdr-task edit <id> --urgent` / `--urgent off`).")
NOTICE = f"New in Shepherdr: {LABEL}: {TEXT}"


def urgent_now(t):
    """THE rule: marked, open, not archived, and not done since it was marked."""
    at = t.get("urgent")
    if isinstance(at, bool) or not isinstance(at, (int, float)) or at <= 0:
        return False
    done = t.get("done_at")
    return t.get("state") in OPEN and not t.get("archived") and at > (done if isinstance(done, (int, float)) else 0)


# ---- the flag -------------------------------------------------------------------------------

def flag(c, edit=False):
    """`add --urgent`; `edit --urgent [on|off]`."""
    if edit:
        c.add_argument("--urgent", nargs="?", const="on", choices=("on", "off"),
                       help="mark it urgent (\"this one first\"), or --urgent off; only when the person asks, and only an open task")
    else:
        c.add_argument("--urgent", action="store_const", const="on", help="mark it urgent (\"this one first\"); only when the person asks")


def _asks(argv):
    """Whether this command line is add or edit with --urgent (also abbreviated, as argparse takes it), past any
    --detach or --on <machine> in front."""
    rest = list(argv)
    while rest[:1] == ["--detach"] or (rest[:1] == ["--on"] and len(rest) > 1):
        rest = rest[1:] if rest[0] == "--detach" else rest[2:]
    if rest[:1] not in (["add"], ["edit"]):
        return False
    opts = rest[1:rest.index("--")] if "--" in rest else rest[1:]  # after a bare --, words only (a title)
    return any(len(o) > 2 and "--urgent".startswith(o) for o in (a.split("=", 1)[0] for a in opts if a.startswith("--")))


def task_agent():
    """A task's own agent (its worker, its reviewer, their helpers): its shell carries HERDR_BROWSER_TASK
    (browsers.browser_env), or its terminal is labelled herdr.task."""
    if os.environ.get("HERDR_BROWSER_TASK"):
        return True
    from .launch import caller_labels
    return bool(caller_labels().get("herdr.task"))


def refusal(argv):
    """cli.main's check, before anything is sent to another machine or run as a job: the words, or None."""
    return REFUSED if _asks(argv) and task_agent() else None


# ---- the mark on a task ---------------------------------------------------------------------

def _can(s, t):
    if t.get("archived"):
        raise Fail(f"{s.name(t)} is archived: only an open task can be urgent.")
    if t.get("state") not in OPEN:
        raise Fail(f"{s.name(t)} is done: only an open task can be urgent.")


def mark(s, t, how):
    """--urgent on|off on task t (refused on a Done or archived one). Marked again, it keeps its first time."""
    if how == "on":
        _can(s, t)
        if not urgent_now(t):
            t["urgent"] = now()
            s.dirty = True
    elif how == "off" and "urgent" in t:
        t.pop("urgent")
        s.dirty = True


def check_before_move(args):
    """edit --urgent with --move-to: checked under the source list's lock before anything moves."""
    if getattr(args, "urgent", None) != "on" or not getattr(args, "move_to", None):
        return
    from .store import open_store
    with open_store(args) as s:
        _can(s, s.find(args.id))


def shown(v, t):
    """A task's view (output.view): `urgent: true` only while urgent_now, never the raw time."""
    v.pop("urgent", None)
    if urgent_now(t):
        v["urgent"] = True


# ---- news -----------------------------------------------------------------------------------

def attr(t):
    """The news tag's attribute for task t (news.news_line)."""
    return ATTR if urgent_now(t) else ""


def tagged(text, on):
    """A queued news line with its tag's urgent attribute as it is now."""
    head, gt, rest = text.partition(">")
    if not gt:
        return text
    head = head.replace(ATTR, "")
    return head + (ATTR if on else "") + gt + rest


def running(k):
    """Its agent is in front now (news_send would start a chat with a shell in front again: the mark never goes that
    way, its next start's settings note says what urgent means and `list` which tasks are)."""
    from .agents import front
    return front(k) == "agent"


def first(batch, marks, k):
    """One message's lines for chat k: each one's mark read again from its task (marks: key -> urgent_now, for every list
    this pass read; an entry from a list it didn't read keeps what was noted when it was queued), urgent ones first, in
    their order; marked on the tag only for a chat whose agent is running. The entries are updated in place (the outbox
    holds them; each send renders the tag again from the note)."""
    on = running(k)
    for x in batch:
        if x.get("key") in marks:
            x["urgent"] = marks[x["key"]]
        x["text"] = tagged(x["text"], on and bool(x.get("urgent")))
    return sorted(batch, key=lambda x: not x.get("urgent"))


def _hash():
    return hashlib.sha1(TEXT.encode()).hexdigest()[:6]


def lead(k, batch):
    """The settings notice a message with an urgent line starts with, for a running Shepherdr chat whose settings label
    doesn't have this row yet (meaning before mark): (notice, its new label), else None. Never for a chat whose agent
    isn't in front (a shell: its next start's note says it), nor one just started (its hook is telling it). One never
    labelled (started before settings were told) gets it too, its label left for settings_pass's whole block."""
    from .assistant_settings import LABEL as SETTINGS, notice, parse
    if not any(x.get("urgent") for x in batch) or not running(k):
        return None
    had = parse((k.get("labels") or {}).get(SETTINGS))
    if (had is None and not k.get("turn")) or (had or {}).get(KEY) == _hash():
        return None
    label = None if had is None else ",".join(f"{a}:{b}" for a, b in {**had, KEY: _hash()}.items())
    return notice([{"key": KEY, "label": LABEL, "text": TEXT, "value": "on", "by": None, "scope": "everywhere"}]), label


def told(to, lead_):
    """After the message went: its chat's settings label has this row now, so settings_pass doesn't say it again."""
    if lead_ and lead_[1]:
        from .assistant_settings import LABEL as SETTINGS
        run(["hc", "label", to, f"{SETTINGS}={lead_[1]}"])


def for_running(changed, k):
    """settings_pass: this row goes only to a chat whose agent is running now, never to one a shell is in front of
    (sending would start it again). The other rows as they are (changed ones, or the whole block's); None when nothing
    is left to send now."""
    if running(k) or not any(r.get("key") == KEY for r in changed):
        return changed
    rest = [r for r in changed if r.get("key") != KEY]
    return rest or None


def row():
    """assistant_settings.rows' line: (key, label, text, value, parts). No setting sets it."""
    return (KEY, LABEL, TEXT, "on", [])
