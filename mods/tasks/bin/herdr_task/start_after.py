"""Start after (dmalis/shepherdr#54): a task added --after others starts by itself once they are all done.

`add --after` queues it at once, with what a start would use, as dependent jobs do in CI and task runners
(GitHub Actions' needs:): no separate start is needed, and a start on it stays harmless (it keeps waiting). A
task that comes after others but waits for the person's Start is still made the old way: add, then edit --after.

The moment a task's done state is saved, whichever way it got there (a merge, Accept, Mark as done, nothing to
merge, ready --nothing / --told), a task here waiting for it wakes the scheduler: its next round, the queue's own
locked path (one_pass, under the tick's lock), runs within a second instead of up to 15 s later. The tick stays
the fallback, and a task starts once: the queue starts only tasks still queued, under their list's lock."""

import os
import time

from .base import now
from .queues import HOLD_FILE
from .settings import check_automatic_agent, worker_argv
from .store import read_list, store_files

# Beside the task lists (as machine-hold.json), never among them: the Tasks panel reads every file there.
WAKE = os.path.join(os.path.dirname(HOLD_FILE), "queue-wake")
NAP_STEP = 0.5  # how often a sleeping scheduler looks for a wake (s)


def queue_at_add(s, t, space):
    """add --after: queued now, to start by itself once what it comes after is done. Its agent is worked out
    when it starts (a later edit --agent or --model still counts); its parent is then its space's Assistant."""
    if t["state"] != "todo":
        return
    check_automatic_agent(worker_argv(s, t, space))
    t["state"], t["queued_at"] = "queued", now()
    t["queue"] = {"space": space, "parent": None}
    s.dirty = True


def saved(s, before):
    """The list was just saved: a task that became done there wakes the scheduler when a queued task on this
    machine waits for it (in this folder, or another folder's by its key). Never raises."""
    try:
        done = {i for i, t in ((t.get("id"), t) for t in s.data.get("tasks") or [] if isinstance(t, dict))
                if t.get("state") == "done" and i in before and (before[i] or {}).get("state") != "done"}
        if done and waits_for(s, done):
            wake()
    except Exception:
        pass


def waits_for(s, done):
    """Whether a queued task waits for one of `done` (this list's ids)."""
    if any(t.get("state") == "queued" and set(t.get("after") or []) & done for t in s.data.get("tasks") or []):
        return True
    prefix = s.data.get("prefix")
    for p in store_files():
        if os.path.realpath(p) == os.path.realpath(s.path):
            continue
        for t in (read_list(p) or {}).get("tasks") or []:
            if t.get("state") == "queued" and any(not x.get("machine") and x.get("prefix") == prefix and x.get("id") in done
                                                  for x in t.get("after_ext") or []):
                return True
    return False


def wake():
    """Asks the scheduler for its next round now."""
    try:
        os.makedirs(os.path.dirname(WAKE), exist_ok=True)
        with open(WAKE, "a"):
            pass
        os.utime(WAKE)
    except OSError:
        pass


def woken_since(t0):
    try:
        return os.path.getmtime(WAKE) >= t0
    except OSError:
        return False


def nap(seconds, since):
    """The scheduler's sleep between rounds: `seconds`, or less once a wake comes after `since` (its round's
    start, time.time()): a wake during a round brings the next one at once."""
    end = time.monotonic() + seconds
    while not woken_since(since):
        left = end - time.monotonic()
        if left <= 0:
            return False
        time.sleep(min(NAP_STEP, left))
    return True
