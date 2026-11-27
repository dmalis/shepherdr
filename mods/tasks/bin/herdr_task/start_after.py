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

from .base import STORE, now
from .settings import check_automatic_agent, worker_argv
from .store import Store, locate, read_list, store_files

# In the task lists' folder, as its .tick.lock (not a .json, so never read as a list): one wake per store.
WAKE = os.path.join(STORE, ".queue-wake")
NAP_STEP = 0.5  # how often a sleeping scheduler looks for a wake (s)


def queue_at_add(s, t, space):
    """add --after: queued now, to start by itself once what it comes after is done. Its agent is worked out
    when it starts (a later edit --agent or --model still counts); its parent is then its space's Assistant."""
    if t["state"] != "todo":
        return
    check_automatic_agent(worker_argv(s, t, space))
    t["state"], t["queued_at"] = "queued", now()
    # added: queued by add, not by a start, so its first start still waits for a busy machine as a To do one's
    # would (cmd_start). A start replaces the plan, so a second start goes past it, as a queued task started again.
    t["queue"] = {"space": space, "parent": None, "added": True}
    s.dirty = True


def first_start(t):
    """Whether a start on it is its first: To do, or queued by add --after and not started since."""
    return t["state"] != "queued" or bool((t.get("queue") or {}).get("added"))


def follow_move(old, new, here, there):
    """A task moved from folder `here` (old: its prefix and id) to `there` (new: its ref, prefix and id): what waits
    for it in every other folder on this machine waits for it there, never for a task that is gone (move_task
    retargets only the folder it left). In `there` itself it becomes a plain --after."""
    for p in store_files():
        d = read_list(p) or {}
        folder = d.get("folder")
        if not folder or not os.path.isdir(folder) or os.path.realpath(folder) == os.path.realpath(here):
            continue
        if not any(points_at(x, old) for t in d.get("tasks") or [] for x in t.get("after_ext") or []):
            continue
        with Store(locate(folder)) as s:
            same = os.path.realpath(folder) == os.path.realpath(there)
            for t in s.data["tasks"]:
                ext = t.get("after_ext") or []
                if not any(points_at(x, old) for x in ext):
                    continue
                t["after_ext"] = [x for x in ext if not points_at(x, old)]
                if same:
                    t["after"] = [*(t.get("after") or []), new["id"]]
                else:
                    t["after_ext"].append({"ref": new["ref"], "machine": None, "prefix": new["prefix"], "id": new["id"],
                                           "state": "todo", "checked": 0})
                if not t["after_ext"]:
                    t.pop("after_ext")
                s.dirty = True


def moved_to(s, old_id, new_ref, folder):
    """The list a task moved out of keeps where it went (data "moved": its old id to its new ref and folder), so a
    lookup by its old key, here or from another machine, finds it there instead of taking it as removed."""
    s.data.setdefault("moved", {})[str(old_id)] = {"ref": new_ref, "folder": folder}


def moved_here(data, task_id):
    """Where a task that was in this list (data) moved to, or None."""
    mv = ((data or {}).get("moved") or {}).get(str(task_id))
    return mv if isinstance(mv, dict) and mv.get("ref") and mv.get("folder") else None


def follow(x, data):
    """An after_ext entry `x` of this machine whose task left `data`'s list by a move: x now names it where it went.
    Whether it did."""
    mv = moved_here(data, x.get("id"))
    if not mv:
        return False
    pre, n = mv["ref"].rsplit("-", 1)
    x.update(ref=mv["ref"], prefix=pre, id=int(n))
    return True


def show_moved(args):
    """show <an old key>: the task where it moved to (a dependent on another machine asks by the key it knew)."""
    from .base import Fail
    from .store import open_store, parse_ref
    for _ in range(5):
        try:
            with open_store(args, write=False) as s:
                try:
                    s.find(args.id)
                    return
                except Fail:
                    try:
                        n = parse_ref(args.id)[1]
                    except Fail:
                        return
                    mv = moved_here(s.data, n)
        except Fail:
            return
        if not mv:
            return
        args.folder, args.id = mv["folder"], mv["ref"]


def points_at(x, old):
    return not x.get("machine") and x.get("prefix") == old["prefix"] and x.get("id") == old["id"]


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
