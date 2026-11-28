"""Each task's own temporary folder (dmalis/shepherdr#216).

A task's agent starts with TMPDIR, TMP and TEMP set to a folder only that task uses, so what its tests, builds and
tools leave behind (pytest, Node, Python's tempfile, mktemp, Go, Rust all follow TMPDIR) goes with the task instead of
filling the machine's /tmp. Like GitHub Actions' RUNNER_TEMP or Bazel's TEST_TMPDIR, the one who starts the work
owns the folder and removes it:

  where   Shepherdr's cache folder: ~/.cache/shepherdr/tmp/<task> (macOS: ~/Library/Caches/shepherdr/tmp/<task>),
          or <HERDR_TASK_STORE>/.tmp/<task> for a throwaway task store, so a test's or a try's scheduler only ever
          sweeps its own. Outside the worktree on purpose: nothing there shows in git status or a commit, and a task
          working in the folder itself (no worktree) has one too. The name is short (sd-254-9f3a: its key and a bit
          of its list's name), as Unix sockets made inside it must stay under the OS's path limit.
  made    right before its agent starts (launch.launch()), and recorded on the task as "tmp", which the web app's
          terminal for the task reads to start its shell there too.
  gone    once the task is Done and its agents ended (tick.end_done()), when it is removed (herdr-task rm), and by
          the sweep (sweep()): the scheduler's first round after it starts, then every SWEEP_EVERY_S, removes any
          folder here whose task is Done with nothing left running, or gone, or that no task has recorded (an
          hour after it was last changed: a start may be on its way to recording it). A crashed task's folder goes
          that way.

Only TMPDIR, TMP and TEMP in the agent's environment change: never an agent's own settings."""

import hashlib
import os
import re
import shutil
import time

from .base import STORE, WHERE

VARS = ("TMPDIR", "TMP", "TEMP")
SWEEP_EVERY_S = 600
UNKNOWN_AGE_S = 3600
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
_swept = 0.0


def root():
    """Where this machine's task temp folders are: beside a throwaway task store, else in Shepherdr's cache."""
    if os.environ.get("HERDR_TASK_STORE"):
        return os.path.join(STORE, ".tmp")
    return os.path.join(WHERE.roots["cache"], "tmp")


def name_for(slug, ref):
    """sd-254-9f3a: the task's key, lower case, and 4 hex of its list's slug (two lists may share a prefix)."""
    base = re.sub(r"[^a-z0-9-]+", "-", str(ref).lower()).strip("-")[:32] or "task"
    return f"{base}-{hashlib.sha1(str(slug).encode()).hexdigest()[:4]}"


def path_for(s, task):
    return os.path.join(root(), name_for(s.slug, s.ref(task)))


def ensure(s, task):
    """The task's temp folder, made (only its owner may enter) and recorded on it. None when it can't be made:
    the agent then starts with the machine's own temp folder, as before (a temp folder never stops a start)."""
    try:
        p = path_for(s, task)
        os.makedirs(root(), mode=0o700, exist_ok=True)
        os.makedirs(p, mode=0o700, exist_ok=True)
        os.chmod(p, 0o700)
    except Exception:
        return None
    if task.get("tmp") != p:
        task["tmp"] = p
        s.dirty = True
    return p


def env_for(path):
    """VAR=value words for `env`: the folder as TMPDIR, TMP and TEMP."""
    return [f"{v}={path}" for v in VARS] if path else []


def _ours(p):
    """Only a real folder right inside root(), with a name we give, is ever removed: never a link, never anything
    a task record points elsewhere."""
    r = os.path.realpath(root())
    return (os.path.dirname(os.path.abspath(p)) == os.path.abspath(root()) and NAME.match(os.path.basename(p))
            and not os.path.islink(p) and os.path.isdir(p) and os.path.dirname(os.path.realpath(p)) == r)


def remove(s, task):
    """Removes the task's temp folder (its record too). True when it is gone."""
    p = task.get("tmp")
    if not p:
        return True
    if os.path.lexists(p) and _ours(p):
        shutil.rmtree(p, ignore_errors=True)
    if os.path.lexists(p) and _ours(p):
        return False
    task.pop("tmp", None)
    s.dirty = True
    return True


def _keep(t):
    """A task whose folder stays: not Done, or Done with its agents not ended yet (tick.end_done sets ended_at)."""
    if t.get("state") != "done":
        return True
    return (t.get("ended_at") or 0) <= (t.get("done_at") or 1)


def sweep(report=None, force=False):
    """Removes this machine's task temp folders that nothing needs now (module docstring). Cheap: one folder listing
    and the task lists, at most every SWEEP_EVERY_S unless forced. Returns the names removed."""
    global _swept
    if not force and time.time() - _swept < SWEEP_EVERY_S:
        return []
    _swept = time.time()
    base = root()
    try:
        names = [n for n in os.listdir(base) if NAME.match(n)]
    except OSError:
        return []
    if not names:
        return []
    from .store import read_list
    keep, known = set(), set()
    try:
        lists = [os.path.join(STORE, f) for f in os.listdir(STORE) if f.endswith(".json")]
    except OSError:
        return []
    for p in lists:
        d = read_list(p)
        if d is None:
            return []  # a list that can't be read now: nothing is known for sure, try again later
        for t in (d.get("tasks") if isinstance(d, dict) else None) or []:
            if not isinstance(t, dict):
                continue
            got = t.get("tmp")
            if not got:
                continue
            n = os.path.basename(got)
            known.add(n)
            if _keep(t):
                keep.add(n)
    gone = []
    for n in names:
        p = os.path.join(base, n)
        if n in keep or not _ours(p):
            continue
        if n not in known:
            try:
                if time.time() - os.lstat(p).st_mtime < UNKNOWN_AGE_S:
                    continue
            except OSError:
                continue
        shutil.rmtree(p, ignore_errors=True)
        if not os.path.lexists(p):
            gone.append(n)
    if gone and report is not None:
        report.setdefault("tmp_removed", []).extend(gone)
    return gone
