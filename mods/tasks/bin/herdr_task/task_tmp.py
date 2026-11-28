"""Each task's own temporary folder (dmalis/shepherdr#216).

A task's agent starts with TMPDIR, TMP and TEMP set to a folder only that task uses, so what its tests, builds and
tools leave behind (pytest, Node, Python's tempfile, mktemp, Go, Rust all follow TMPDIR) goes with the task instead of
filling the machine's /tmp. Like GitHub Actions' RUNNER_TEMP or Bazel's TEST_TMPDIR, the one who starts the work
owns the folder and removes it:

  where   ~/.shepherdr-tmp/<task> (macOS too), <SHEPHERDR_HOME>/tmp/<task> for an install of its own, or
          <HERDR_TASK_STORE>/.tmp/<task> for a throwaway task store, so a test's or a try's scheduler only ever
          sweeps its own. Outside the worktree on purpose: nothing there shows in git status or a commit, and a task
          working in the folder itself (no worktree) has one too.
          Short on purpose: a Unix socket's path is at most 103 bytes on macOS and 107 on Linux, and tools make
          theirs in TMPDIR (tmux, ssh's ControlPath, language servers, test harnesses), so the folder leaves
          SOCKET_ROOM bytes for them with a home up to MAX_HOME long. Like Lima's ~/.lima, it is a short folder of
          its own in the home, owner-only and tagged for backups to skip, not Shepherdr's cache folder
          (~/Library/Caches/shepherdr/tmp alone is 30 bytes past the home); and the task's part is 8 hex of its
          list and key, like ssh's %C (~/.shepherdr-tmp/3f9a1c07: the home and 24 bytes, whatever the key).
          Older copies made them in the cache folder (~/.cache/shepherdr/tmp/sd-254-9f3a): remove() and the sweep
          still find those, and a task's next start moves it to the short one once nothing uses its old one.
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
ROOT_NAME = ".shepherdr-tmp"  # in the home: root()
# The longest home the folder stays short enough for (/Users/ and a 12-letter name, /home/ and 13), the room it
# leaves for a tool's socket, and each OS's longest socket path (sun_path is 104 bytes on macOS and 108 on Linux,
# each with its closing zero). test/test_task_tmp.py checks the sum.
MAX_HOME, SOCKET_ROOM, SOCKET_MAX = 19, 60, {"darwin": 103, "linux": 107}


def root():
    """Where this machine's task temp folders are made (the module's docstring)."""
    if os.environ.get("HERDR_TASK_STORE"):
        return os.path.join(STORE, ".tmp")
    one = WHERE.env.get("SHEPHERDR_HOME")
    if one and os.path.isabs(one) and WHERE.roots["cache"] == os.path.join(one, "cache"):
        return os.path.join(one, "tmp")
    return os.path.join(WHERE.home, ROOT_NAME)


def roots():
    """root(), then where older copies made them (the cache folder's tmp/): every place remove() and the sweep look."""
    out = [root()]
    if not os.environ.get("HERDR_TASK_STORE"):
        old = os.path.join(WHERE.roots["cache"], "tmp")
        if os.path.abspath(old) != os.path.abspath(out[0]):
            out.append(old)
    return out


def name_for(slug, ref):
    """3f9a1c07: 8 hex of the task's list (its slug: two lists may share a prefix) and key, 8 bytes whatever the key.
    Older copies' names (sd-254-9f3a) always have a dash, so the two never meet."""
    return hashlib.sha1(f"{slug}\0{ref}".encode()).hexdigest()[:8]


def path_for(s, task):
    return os.path.join(root(), name_for(s.slug, s.ref(task)))


def _make_root(r):
    """root(), owner-only; the home's own is tagged so backup tools skip it, as layout.py tags the cache."""
    if os.path.isdir(r):
        return
    os.makedirs(r, mode=0o700, exist_ok=True)
    if os.path.basename(r) == ROOT_NAME:
        with open(os.path.join(r, "CACHEDIR.TAG"), "w") as f:
            f.write("Signature: 8a477f597d28d172789f06886806bc55\n"
                    "# Shepherdr's task temp folders: safe to delete, skipped by backups.\n")


def ensure(s, task):
    """The task's temp folder, made (only its owner may enter) and recorded on it. None when it can't be made:
    the agent then starts with the machine's own temp folder, as before (a temp folder never stops a start)."""
    try:
        p = path_for(s, task)
        was = task.get("tmp")
        if was and was != p and os.path.lexists(was) and _ours(was):
            # an older copy's (a long name in the cache folder): kept while what started there still uses it
            if in_use(s.key(task), was):
                os.utime(was)
                return was
            shutil.rmtree(was, ignore_errors=True)
        _make_root(root())
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
    """Only a real folder right inside root() or an older copy's root (roots()), with a name we give, is ever
    removed: never a link, never anything a task record points elsewhere."""
    if not NAME.match(os.path.basename(p)) or os.path.islink(p) or not os.path.isdir(p):
        return False
    d = os.path.dirname(os.path.abspath(p))
    return any(d == os.path.abspath(r) and os.path.dirname(os.path.realpath(p)) == os.path.realpath(r)
               for r in roots())


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
    names = []  # (its root, its name): root()'s and older copies' (roots())
    for base in roots():
        try:
            names += [(base, n) for n in os.listdir(base) if NAME.match(n)]
        except OSError:
            continue
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
    for base, n in names:
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
