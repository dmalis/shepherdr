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
  made    right before its agent starts (launch.launch()), or when the web app opens the task's terminal first
          (`herdr-task _task-tmp`), and recorded on the task as "tmp". The web app's terminal for the task starts
          its shell there too, and marks the folder in use while that shell lives (SHELL_MARK).
  gone    never while something uses it (in_use(): a live terminal of the task, its agents' helpers among them, or
          a web-app shell started there). Then once the task is Done and its agents ended (tick.end_done()), when
          it is removed (herdr-task rm), and by the sweep (sweep()): the scheduler's first round after it starts,
          then every SWEEP_EVERY_S, removes any folder here whose task is Done with nothing left running, and any
          other one left untouched for STALE_S: a task's that is gone, or one whose agent crashed or ended without
          the task being Done (its next start makes a fresh one). A start on its way to recording its folder has
          just made it, so it is never stale.

Only TMPDIR, TMP and TEMP in the agent's environment change: never an agent's own settings."""

import hashlib
import os
import re
import shutil
import subprocess
import time

from .base import hc_json, STORE, WHERE

VARS = ("TMPDIR", "TMP", "TEMP")
SWEEP_EVERY_S = 600
STALE_S = 3600
# service/shells.ts's TMP_SHELL writes .shell-<its pid> here before it becomes the shell (exec keeps the pid)
SHELL_MARK = ".shell-"
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
        os.utime(p)  # just made or started again: never stale (sweep()) while its agent starts
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


def _boot_time():
    """When this machine started (seconds), 0 when unknown: a shell mark from before it names a pid reused since."""
    try:
        with open("/proc/stat") as f:
            for line in f:
                if line.startswith("btime "):
                    return float(line.split()[1])
    except (OSError, ValueError):
        pass
    try:  # macOS
        out = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True, timeout=5).stdout
        m = re.search(r"sec = (\d+)", out)
        return float(m.group(1)) if m else 0.0
    except Exception:
        return 0.0


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:  # someone else's: alive
        return True
    return True


def shells_in(p):
    """How many web-app shells started in the folder still live: their mark's pid runs, marked since this boot."""
    try:
        marks = [f for f in os.listdir(p) if f.startswith(SHELL_MARK) and f[len(SHELL_MARK):].isdigit()]
    except OSError:
        return 0
    boot = _boot_time() if marks else 0.0
    n = 0
    for f in marks:
        try:
            fresh = os.lstat(os.path.join(p, f)).st_mtime >= boot - 1
        except OSError:
            continue
        n += bool(fresh and _alive(int(f[len(SHELL_MARK):])))
    return n


def in_use(key, p):
    """Whether something still uses the folder: a web-app shell started there, or any live terminal of the task (its
    agents, their helpers, a detached action's caller). When herdr-core can't say, it is in use."""
    if shells_in(p):
        return True
    if not key:
        return False
    d = hc_json("ls", "--label", f"herdr.task={key}")
    if d is None:
        return True
    return any(k.get("state") == "live" for k in d.get("terminals") or [])


def remove(s, task):
    """Removes the task's temp folder (its record too), unless something still uses it (in_use(): the sweep takes it
    once nothing does). True when it is gone."""
    p = task.get("tmp")
    if not p:
        return True
    if os.path.lexists(p) and _ours(p):
        if in_use(s.key(task), p):
            return False
        shutil.rmtree(p, ignore_errors=True)
    if os.path.lexists(p) and _ours(p):
        return False
    task.pop("tmp", None)
    s.dirty = True
    return True


def _ended(t):
    """Done, and its agents ended (tick.end_done sets ended_at)."""
    return t.get("state") == "done" and (t.get("ended_at") or 0) > (t.get("done_at") or 1)


def sweep(report=None, force=False):
    """Removes this machine's task temp folders that nothing needs now (module docstring). Cheap: one folder listing
    and the task lists, at most every SWEEP_EVERY_S unless forced, and herdr-core asked only about a folder that may
    go. Returns the names removed."""
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
    rec = {}  # folder name: (its task's key, whether that task is Done with its agents ended)
    try:
        lists = [os.path.join(STORE, f) for f in os.listdir(STORE) if f.endswith(".json")]
    except OSError:
        return []
    for p in lists:
        d = read_list(p)
        if d is None:
            return []  # a list that can't be read now: nothing is known for sure, try again later
        if not isinstance(d, dict):
            continue
        slug = d.get("slug") or os.path.basename(p)[:-5]
        for t in d.get("tasks") or []:
            if isinstance(t, dict) and t.get("tmp"):
                rec[os.path.basename(t["tmp"])] = (f"{slug}#{t.get('id')}", _ended(t))
    gone = []
    for n in names:
        p = os.path.join(base, n)
        if not _ours(p):
            continue
        key, ended = rec.get(n, (None, False))
        if not ended:
            # a task still on, or a folder no task records: only once untouched that long
            try:
                if time.time() - os.lstat(p).st_mtime < STALE_S:
                    continue
            except OSError:
                continue
        if in_use(key, p):
            continue
        shutil.rmtree(p, ignore_errors=True)
        if not os.path.lexists(p):
            gone.append(n)
    if gone and report is not None:
        report.setdefault("tmp_removed", []).extend(gone)
    return gone


def cmd_task_tmp(args):
    """`herdr-task _task-tmp <id>`: the task's temp folder, made and recorded now, as JSON ({"tmp": path or null}).
    The web app asks when the person opens a task's terminal before its agent started (service/shells.ts)."""
    import json
    from .store import locate, Store
    with Store(locate(args.folder)) as s:
        print(json.dumps({"tmp": ensure(s, s.find(args.id))}))
    return 0
