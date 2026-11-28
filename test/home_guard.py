"""Every test runs on a throwaway home, never the person's (SHEP-147). Each test file imports this first.

On import: HOME is a throwaway folder for the whole run (so `~` in a test, a program it runs, or the herdr-task it
starts lands there), and the agent's own terminal and chat (HC_TERMINAL_*, HERDR_BROWSER_TASK and the rest) are
dropped, so nothing reaches the real herdr-core, the real chat's question hook (~/.local/share/herdr/ask/ask-hook.sh)
or its cards. herdr-task itself refuses hc and herdr-app on a changed HOME (base.not_real).

Then a Python audit hook fails a test at once, with what it touched, when it opens a file in the real home's Herdr
folders, or starts a program with the real HOME (or none, which falls back to it)."""
import atexit
import os
import pwd
import re
import shutil
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _real_home():
    try:
        return pwd.getpwuid(os.getuid()).pw_dir
    except KeyError:
        return os.path.expanduser("~")


REAL = os.path.realpath(_real_home())
# The person's Herdr and Shepherdr state: data, settings, the synced question hook, chat cards, agents' own configs.
REAL_DIRS = [os.path.join(REAL, p) for p in (
    ".herdr", ".config/herdr-app", ".config/herdr-core", ".config/shepherdr", ".local/share/herdr",
    ".local/share/shepherdr", ".local/state/herdr-core", ".local/state/shepherdr", ".cache/shepherdr", ".claude", ".codex")]
# What the person's environment points at its own terminal, chat and agent with.
DROP = ("HC_TERMINAL_SOCKET", "HC_TERMINAL_ID", "HC_SCOPE", "HC_SOCKET", "HC_SESSION", "HERDR_BROWSER_TASK",
        "HERDR_ASK_CHAINED", "HERDR_APP_HOME", "SHEPHERDR_HOME", "SHEPHERDR_DATA", "HERDR_TASK_STORE",
        "HERDR_TASK_SETTINGS", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME",
        "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN")


class RealHome(AssertionError):
    pass


def _inside(path, dirs):
    p = os.path.realpath(path)
    return any(p == d or p.startswith(d + os.sep) for d in dirs)


def touches(path):
    """Whether opening this path reaches the person's real Herdr state (this repo's own files don't count: a worktree
    lives under ~/.local/share/shepherdr)."""
    if not isinstance(path, (str, bytes, os.PathLike)):
        return False
    path = os.fsdecode(path)
    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)
    return _inside(path, REAL_DIRS) and not _inside(path, [os.path.realpath(ROOT)] + OWN)


# The run's own temp folders, the only other real-home paths a test may open. A task's TMPDIR is its own folder under
# ~/.cache/shepherdr/tmp (#216), so a run in a task makes its shep-run-* folder inside a guarded folder. Kept here:
# the temp folder the run started from, only when it is one task's folder (where its links lead: right inside
# ~/.cache/shepherdr/tmp, never that folder, another guarded one or the home), and the shep-run-* folder the run made
# (where its links lead), named in RUN_VAR for the programs it starts.
OWN = []
CACHE = os.path.join(".cache", "shepherdr")  # task_tmp.root(): the cache root's tmp/<task>


def own(shared=None, run=None):
    if shared:
        p = os.path.realpath(shared)
        tasks = [os.path.join(d, "tmp") for d in REAL_DIRS if d.endswith(os.sep + CACHE)]
        if os.path.dirname(p) in tasks:
            OWN.append(p)
    if run:
        p = os.path.realpath(run)
        if os.path.basename(p).startswith(RUN_PREFIX):
            OWN.append(p)


# The person's installed commands (herdr-task's zipapp and the links beside it): a test may read them, never write
# them. One once replaced the real ~/.local/bin/herdr-task (SHEP-227), and a copy changed under running herdr-tasks
# broke their imports (SHEP-259).
REAL_BIN = [os.path.join(REAL, ".local", "bin")]
_WRITES = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND


def writes_bin(path):
    if not isinstance(path, (str, bytes, os.PathLike)):
        return False
    path = os.fsdecode(path)
    if not os.path.isabs(path):
        path = os.path.join(os.getcwd(), path)
    # the folder itself, not where a link in it leads: ~/.local/bin/herdr-task may lead into this repo
    d, base = os.path.split(path)
    return _inside(os.path.join(os.path.realpath(d), base), REAL_BIN) or _inside(d, REAL_BIN)


# ---- the run's own temp folder (dmalis/shepherdr#216) ------------------------------------------------------------
# Like pytest's basetemp or Bazel's TEST_TMPDIR: one folder per run (shep-run-<pid>-*), removed at its end, and one a
# killed run left (its process gone, untouched an hour) removed when the next run starts. Then the shared temp folder
# is checked: a shep-* entry the run added there (a test that wrote past TMPDIR) fails it, by name. When another run
# shared the temp folder meanwhile (a live shep-run-*, or an older checkout's run, which made OLD_RUN_FOLDERS there),
# whose entry it is can't be told: the check only warns. test/preload.ts does the same for the Bun tests.
RUN_PREFIX = "shep-run-"
RUN_VAR = "SHEPHERDR_TEST_RUN"  # set in a run: a program it starts that imports this again keeps the run's folders
# what only a run's own setup made in the shared temp folder before #216: an older checkout's run is live beside this one
OLD_RUN_FOLDERS = ("shep-test-home-", "shep-data-", "shep-app-", "shep-hc-")
STALE_RUN_S = 3600
TEMP_VARS = ("TMPDIR", "TMP", "TEMP")
_RUN_NAME = re.compile(r"^shep-run-(\d+)-")


def shep_entries(folder):
    """The shep-* names in a temp folder, runs' own folders (shep-run-*) left out."""
    try:
        return {n for n in os.listdir(folder) if n.startswith("shep-") and not n.startswith(RUN_PREFIX)}
    except OSError:
        return set()


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:  # someone else's: alive
        return True
    return True


def _touched(p):
    """When a run's folder last changed: its tmp/ changes with every folder a test makes there."""
    return max((os.stat(x).st_mtime for x in (p, os.path.join(p, "tmp")) if os.path.exists(x)), default=0)


def other_runs(folder, me):
    """The other runs whose folders are in `folder` and whose process still runs (or, unnamed, changed lately)."""
    out = []
    try:
        names = [n for n in os.listdir(folder) if n.startswith(RUN_PREFIX)]
    except OSError:
        return out
    for n in names:
        m = _RUN_NAME.match(n)
        pid = int(m.group(1)) if m else None
        if pid == me:
            continue
        try:
            live = _alive(pid) if pid else time.time() - _touched(os.path.join(folder, n)) < STALE_RUN_S
        except OSError:
            continue
        if live:
            out.append(n)
    return out


def clean_stale_runs(folder, me):
    """Removes the folders of runs that were killed before their end: their process is gone and they haven't changed
    for STALE_RUN_S (a live run in another pid namespace, a sandbox's, still changes)."""
    gone = []
    try:
        names = [n for n in os.listdir(folder) if n.startswith(RUN_PREFIX)]
    except OSError:
        return gone
    for n in names:
        p = os.path.join(folder, n)
        m = _RUN_NAME.match(n)
        pid = int(m.group(1)) if m else None
        try:
            if pid == me or (pid and _alive(pid)) or time.time() - _touched(p) < STALE_RUN_S or os.path.islink(p):
                continue
        except OSError:
            continue
        shutil.rmtree(p, ignore_errors=True)
        gone.append(n)
    return gone


def start_run(own_home=True):
    """Makes this run's folder (TMPDIR inside it, and HOME when own_home) and removes it when the run ends."""
    shared = tempfile.gettempdir()
    me = os.getpid()
    own(shared=shared)
    clean_stale_runs(shared, me)
    before = shep_entries(shared)
    shared_with = bool(other_runs(shared, me))
    run = tempfile.mkdtemp(prefix=f"{RUN_PREFIX}{me}-")
    own(run=run)
    home, tmp = os.path.join(run, "home"), os.path.join(run, "tmp")
    os.mkdir(home, 0o700)
    os.mkdir(tmp, 0o700)
    if own_home:
        os.environ["HOME"] = home
    for v in TEMP_VARS:
        os.environ[v] = tmp
    os.environ[RUN_VAR] = run
    tempfile.tempdir = None  # gettempdir() reads TMPDIR again
    atexit.register(end_run, run, shared, before, me, shared_with=shared_with)
    return run


def end_run(run, shared, before, pid, exit=os._exit, shared_with=False):
    """At the run's end (only in the process that made it): its folder goes, then a shep-* entry it left in the
    shared temp folder fails the run, or only warns when another run shared that folder meanwhile."""
    if os.getpid() != pid:
        return None
    shutil.rmtree(run, ignore_errors=True)
    left = sorted(shep_entries(shared) - before)
    if not left:
        return left
    shared_with = shared_with or bool(other_runs(shared, pid)) or any(n.startswith(OLD_RUN_FOLDERS) for n in left)
    sys.stdout.flush()
    names = f"{', '.join(left[:10])}{' …' if len(left) > 10 else ''}"
    if shared_with:
        sys.stderr.write(f"\nNew in {shared} during this test run, with another run beside it, so maybe not this "
                         f"run's: {names} (test/home_guard.py).\n")
        sys.stderr.flush()
        return left
    sys.stderr.write(f"\nThis test run left {len(left)} folder(s) in {shared}: {names}. Make them under the run's "
                     "own TMPDIR, or remove them when the test ends (test/home_guard.py).\n")
    sys.stderr.flush()
    exit(1)
    return left


def _audit(event, args):
    if event == "open":
        if touches(args[0]):
            raise RealHome(f"a test opened {args[0]} in the real home: use a throwaway folder (test/home_guard.py)")
        flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
        if flags & _WRITES and writes_bin(args[0]):
            raise RealHome(f"a test wrote {args[0]}, the person's installed command: use a throwaway folder "
                           "(test/home_guard.py)")
    elif event in ("os.rename", "os.remove", "os.symlink", "os.chmod", "os.truncate", "os.link", "os.unlink"):
        # a link's or a hard link's target (its first argument) is only read
        for p in (args[1:2] if event in ("os.symlink", "os.link") else args[:2]):
            if writes_bin(p):
                raise RealHome(f"a test changed {p}, the person's installed command ({event}): use a throwaway folder "
                               "(test/home_guard.py)")
    elif event == "subprocess.Popen":
        env = args[3] if len(args) > 3 and args[3] is not None else os.environ
        home = env.get("HOME") if hasattr(env, "get") else None
        if home is None:
            home = env.get(b"HOME") if hasattr(env, "get") else None
        if not home or os.path.realpath(os.fsdecode(home)) == REAL:
            raise RealHome(f"a test ran {args[1]!r} with {'the real' if home else 'no'} HOME: give it a throwaway "
                           "HOME (test/home_guard.py)")


for k in DROP:
    os.environ.pop(k, None)
if not os.environ.get(RUN_VAR):
    # dmalis/shepherdr#216: the run's temp folder (TMPDIR, TMP, TEMP), and its throwaway HOME unless the caller gave
    # one, in one folder of its own, removed when the run ends, so the many folders its tests make never pile up in
    # the shared temp folder (they once filled a tmpfs's inodes). The programs a test starts inherit both.
    start_run(own_home=os.path.realpath(os.environ.get("HOME") or REAL) == REAL)
else:
    own(run=os.environ[RUN_VAR])
# git commits in throwaway repos need a name; the real ~/.gitconfig is out of reach now
for k, v in (("GIT_AUTHOR_NAME", "Test"), ("GIT_AUTHOR_EMAIL", "test@example.invalid"),
             ("GIT_COMMITTER_NAME", "Test"), ("GIT_COMMITTER_EMAIL", "test@example.invalid")):
    os.environ.setdefault(k, v)
sys.addaudithook(_audit)
