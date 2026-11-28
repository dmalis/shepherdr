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
import shutil
import sys
import tempfile

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
    return _inside(path, REAL_DIRS) and not _inside(path, [os.path.realpath(ROOT)])


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
# Like pytest's basetemp or Bazel's TEST_TMPDIR: one folder per run, removed at its end. Then the shared temp folder is
# checked: a shep-* entry the run added there (a test that wrote past TMPDIR) fails it, by name. Entries that were
# there before, and other runs' own folders (RUN_FOLDERS), never count.
RUN_PREFIX = "shep-run-"
# what a run's own setup makes, in any version (test/preload.ts's RUN_FOLDERS): another run's, never a test's leftover
RUN_FOLDERS = (RUN_PREFIX, "shep-test-home-", "shep-data-", "shep-settings-", "shep-app-", "shep-hc-")
TEMP_VARS = ("TMPDIR", "TMP", "TEMP")


def shep_entries(folder):
    """The shep-* names in a temp folder, other runs' own folders (RUN_FOLDERS) left out."""
    try:
        return {n for n in os.listdir(folder) if n.startswith("shep-") and not n.startswith(RUN_FOLDERS)}
    except OSError:
        return set()


def start_run():
    """Makes this run's folder (HOME and TMPDIR inside it) and removes it when the run ends. Returns it."""
    shared = tempfile.gettempdir()
    before = shep_entries(shared)
    run = tempfile.mkdtemp(prefix=RUN_PREFIX)
    home, tmp = os.path.join(run, "home"), os.path.join(run, "tmp")
    os.mkdir(home, 0o700)
    os.mkdir(tmp, 0o700)
    os.environ["HOME"] = home
    for v in TEMP_VARS:
        os.environ[v] = tmp
    tempfile.tempdir = None  # gettempdir() reads TMPDIR again
    atexit.register(end_run, run, shared, before, os.getpid())
    return run


def end_run(run, shared, before, pid, exit=os._exit):
    """At the run's end (only in the process that made it): its folder goes, then a shep-* entry it left in the
    shared temp folder fails the run."""
    if os.getpid() != pid:
        return None
    shutil.rmtree(run, ignore_errors=True)
    left = sorted(shep_entries(shared) - before)
    if left:
        sys.stdout.flush()
        sys.stderr.write(f"\nThis test run left {len(left)} folder(s) in {shared}: {', '.join(left[:10])}"
                         f"{' …' if len(left) > 10 else ''}. Make them under the run's own TMPDIR, or remove them when "
                         "the test ends (test/home_guard.py).\n")
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
if os.path.realpath(os.environ.get("HOME") or REAL) == REAL:
    # dmalis/shepherdr#216: the run's throwaway HOME and its temp folder (TMPDIR, TMP, TEMP) in one folder of its
    # own, removed when the run ends, so the many folders its tests make never pile up in the shared temp folder
    # (they once filled a tmpfs's inodes). The programs a test starts inherit both. A run that is killed leaves this
    # one folder; inside a task it goes with the task's own temp folder.
    start_run()
# git commits in throwaway repos need a name; the real ~/.gitconfig is out of reach now
for k, v in (("GIT_AUTHOR_NAME", "Test"), ("GIT_AUTHOR_EMAIL", "test@example.invalid"),
             ("GIT_COMMITTER_NAME", "Test"), ("GIT_COMMITTER_EMAIL", "test@example.invalid")):
    os.environ.setdefault(k, v)
sys.addaudithook(_audit)
