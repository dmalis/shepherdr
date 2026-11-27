"""Install, health and rollback (fork/specs/sync-pipeline.md, "Install and rollback").

- `baseline`: reads what is installed (`installed.json`, the install folder's HEAD and its VERSION) and proves it
  matches the state's baseline; `--capture` writes it the first time.
- `install`: the checks before anything moves, the before-pictures for health, the run's own sync hold, then the
  install folder moved to the candidate and the update asked for (`herdr-task update-shepherdr`, with the hold
  patch's variable), its outcome read from its JSON state, never from an exit code.
- `health`: every line must hold, `shepherdr doctor` last. A pass makes the candidate the baseline.
- `rollback`: the install step aimed at the baseline, with its own checks first, then health against the baseline.
  Only that health passing is "rolled back"; anything else is "broken".

The phase is written before each step acts, so a call that dies is resumed by the next one, never repeated blindly.
The installer's output and its log stay private: only fixed words from the state's fields leave here.

`live` is the real home (no `--root`): the Assistants, the scheduler and the installed CLI on the runner's PATH are
read only there. A scratch root (the rehearsal, tests) has none of them."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

from . import gate, patches, state
from .release import git, is_ancestor, rev, tree
from .state import Refused

SHARE = os.path.join(".local", "share", "shepherdr")
RECORD = os.path.join(SHARE, "installed.json")
HOOK_FILES = (".claude/settings.json", ".codex/hooks.json")
HOOK_NAMES = {".claude/settings.json": "Claude Code's settings", ".codex/hooks.json": "Codex's hooks file"}
HOLD_PATCH_TEST = "test_hold_patch.py"          # the hold patch's test, named in its patch list file (build task 5)
# The run's own sync hold (Narrow exceptions, "Propagation to other machines"): no "install at <stamp>:", so
# herdr-task's base.sync_held never clears it; only `shepherdr doctor` without HOLD_VAR lets go of it.
HOLD_LINE = "held by the fork's sync until its health check passes: run shepherdr doctor"
HOLD_VAR = "SHEPHERDR_KEEP_SYNC_HOLD"            # on the update only: the hold patch keeps the installer off the hold
PIPELINE_CODE = ("fork/bin", "fork/sync")        # what a rehearsal covers
UNKNOWN_AFTER_S = 40 * 60                         # an update still running this long after it began: unknown
# The rehearsal's test flag (fork/bin/rehearse, its forced failure): health on a candidate fails before its doctor, so
# the rollback runs. Only on a scratch root: the real home never reads it.
FORCE_HEALTH_FAIL = "FORK_SYNC_FORCE_HEALTH_FAIL"
BUILT = ("web/dist/",)                            # installed files built, not tracked: health line 2 skips them
VERSION_LINE = re.compile(r'^VERSION = "([^"]+)"', re.M)


def update_poll_s():
    return float(os.environ.get("FORK_SYNC_UPDATE_POLL_S", "10"))


def health_wait_s():
    """How long health waits for the Assistants, and for a scheduler that isn't running to come back."""
    return float(os.environ.get("FORK_SYNC_HEALTH_WAIT_S", "30"))


def scheduler_wait_s():
    """The scheduler line's ceiling while the scheduler runs: it re-execs only between its rounds (after a round and
    its 15 s nap), and a round that starts and checks tasks can outlast 30 s by minutes."""
    return float(os.environ.get("FORK_SYNC_SCHEDULER_WAIT_S", str(5 * 60)))


clock = time.monotonic                            # the waits' clock (the tests' fake time moves it)


# --- where things are ---

class Site:
    """The paths one call works with: the home (or scratch root), Shepherdr's own folder, the install folder."""

    def __init__(self, p, cfg, live):
        self.p, self.cfg, self.live = p, cfg, live
        self.home = os.path.realpath(p.home)
        self.share = os.path.join(self.home, SHARE)
        self.record = os.path.join(self.home, RECORD)
        self.folder = os.path.realpath(os.path.expanduser(cfg["install_folder"]))
        self.tasks_bin = os.path.join(self.share, "mods", "tasks", "bin")


def site(p, live, hostname=None):
    cfg = state.config(p)
    state.check_machine(cfg, hostname)
    return Site(p, cfg, live)


def run(argv, env=None, timeout=120, cwd=None):
    """(exit code, stdout, stderr); never raises for the program's own failures."""
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=env, cwd=cwd,
                           stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, "", type(e).__name__
    return r.returncode, r.stdout, r.stderr


def json_line(out):
    """The last line of a program's output that is JSON, or None."""
    for line in reversed((out or "").strip().splitlines()):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return None


def record(s):
    """installed.json, or None when it isn't there or can't be read."""
    try:
        with open(s.record, encoding="utf-8") as f:
            rec = json.load(f)
    except (OSError, ValueError):
        return None
    return rec if isinstance(rec, dict) else None


def version_at(repo, sha):
    """The VERSION in bin/shepherdr at that commit, or None."""
    ok, text, _ = git(repo, "show", f"{sha}:bin/shepherdr")
    m = VERSION_LINE.search(text) if ok else None
    return m.group(1) if m else None


def same_path(a, b):
    return bool(a and b) and os.path.realpath(os.path.expanduser(str(a))) == os.path.realpath(os.path.expanduser(str(b)))


def folder_head(s):
    """(HEAD's SHA, its branch or None, clean) of the install folder."""
    head = rev(s.folder, "HEAD")
    ok, branch, _ = git(s.folder, "symbolic-ref", "--quiet", "--short", "HEAD")
    ok2, porcelain, _ = git(s.folder, "status", "--porcelain")
    return head, (branch if ok else None), (ok2 and not porcelain)


def stamp_epoch(at):
    """installed.json's `at` (the installer's local time, %Y%m%d-%H%M%S, maybe with -n) as seconds, or None."""
    m = re.match(r"^(\d{8}-\d{6})", str(at or ""))
    if not m:
        return None
    try:
        return time.mktime(time.strptime(m.group(1), "%Y%m%d-%H%M%S"))
    except (ValueError, OverflowError):
        return None


# --- the installed herdr-task, asked for what only it knows ---

PROBE = r'''
import json, os, sys
sys.path.insert(0, sys.argv[1])
if sys.argv[2] == "path":
    from herdr_task import self_update
    print(json.dumps({"path": self_update.clean_env(dict(os.environ)).get("PATH", "")}))
elif sys.argv[2] == "holds":
    from herdr_task import layout
    home = sys.argv[3]
    w = layout.Where(home=home, env=None if sys.argv[4] == "live" else {})
    print(json.dumps({"paths": [os.path.join(home, ".herdr", "sync-hold"), os.path.join(w.roots["state"], "sync-hold")]}))
elif sys.argv[2] == "service":
    from herdr_task import layout
    w = layout.Where(home=sys.argv[3], env=None if sys.argv[4] == "live" else {})
    print(json.dumps({"dir": w.path("service")}))
else:
    from herdr_task import base, scheduler
    print(json.dumps({"hash": scheduler.script_hash(), "store": base.STORE}))
'''


def probe(s, what, *args):
    code, out, _ = run([sys.executable, "-c", PROBE, s.tasks_bin, what, *args], timeout=60)
    v = json_line(out) if code == 0 else None
    return v if isinstance(v, dict) else None


def installed_cli(s):
    """Where `shepherdr` resolves for the runner, or a Refused. Live: on the run's PATH with the guard's folder taken
    out by the installed herdr-task's own self_update.clean_env (the run's own PATH finds the guard's first). A
    scratch root: its own .local/bin/shepherdr."""
    if s.live:
        v = probe(s, "path")
        if not v:
            raise Refused("the installed herdr-task can't say the runner's PATH", outcome="held", kind="install",
                          gate="cli")
        found = shutil.which("shepherdr", path=v["path"])
    else:
        found = os.path.join(s.home, ".local", "bin", "shepherdr")
    real = os.path.realpath(found) if found and os.path.exists(found) else None
    if not real or not real.startswith(os.path.join(s.share, "bin") + os.sep):
        raise Refused("the shepherdr the update would run isn't the installed one under "
                      f"{s.p.show(os.path.join(s.share, 'bin'))}", outcome="held", kind="install", gate="cli")
    return real


def recorded_source(s):
    """installed.json's source is the config's install folder and its root is the home: `shepherdr update` installs
    from exactly that folder (cmd_install, hand_over)."""
    rec = record(s)
    if rec is None:
        raise Refused(f"{s.p.show(s.record)} can't be read", outcome="held", kind="install", gate="source")
    if not same_path(rec.get("source"), s.folder):
        raise Refused("Shepherdr was last installed from another folder than the config's install folder",
                      outcome="held", kind="install", gate="source")
    if not same_path(rec.get("root"), s.home):
        raise Refused("Shepherdr was last installed under another root than this home", outcome="held",
                      kind="install", gate="source")
    return rec


# --- the pipeline's own code, and the hold patch ---

def pipeline_hash(repo, sha):
    """The hash a rehearsal is recorded under: the trees of fork/bin and fork/sync at that commit."""
    parts = []
    for d in PIPELINE_CODE:
        ok, t, _ = git(repo, "rev-parse", "--verify", "--quiet", f"{sha}:{d}")
        parts.append(f"{d} {t if ok else '-'}")
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def patch_list_at(repo, sha):
    """(lines, why): the patch list at that commit, fork/patches/<issue>.json or the old fork/patches.json of a commit
    from before (patches.read reads either). `why` says what is wrong (None when nothing is): unreadable, or laid out
    wrong, such as the old list kept beside the new folder by a rebase, which could hide a patch the folder lost."""
    try:
        lines, layout = patches.read(repo, at=sha)
    except (OSError, ValueError, KeyError, TypeError) as e:
        return [], f"its patch list can't be read ({type(e).__name__})"
    if layout:
        return lines, "its patch list is laid out wrong: " + "; ".join(layout)
    return lines, None


def carries_hold_patch(repo, sha):
    """The patch list at that commit, read and laid out right, names the hold patch's test."""
    data, why = patch_list_at(repo, sha)
    if why:
        return False

    def walk(v):
        if isinstance(v, str):
            return os.path.basename(v) == HOLD_PATCH_TEST
        if isinstance(v, dict):
            return any(walk(x) for x in v.values())
        if isinstance(v, list):
            return any(walk(x) for x in v)
        return False
    return walk(data)


def hold_paths(s):
    """The two files that hold the sync to other machines, where the installed herdr-task's base.sync_held reads
    them and `shepherdr doctor` takes them away (bin/shepherdr's hold_paths without HOLD_VAR): ~/.herdr/sync-hold
    and Shepherdr's state folder's sync-hold. A scratch root's, like the installer's --root, ignores SHEPHERDR_HOME
    and XDG_*. Refused (nothing moved) when the installed layout can't say."""
    v = probe(s, "holds", s.home, "live" if s.live else "root")
    paths = v.get("paths") if v else None
    if not (isinstance(paths, list) and len(paths) == 2 and all(isinstance(x, str) and os.path.isabs(x) for x in paths)):
        raise Refused("the installed herdr-task can't say where the sync hold goes; nothing moved", outcome="held",
                      kind="install", gate="hold")
    return paths


def hold_sync(s):
    """The run's own hold, in both files, before the install folder moves: the sync to other machines waits until
    health's doctor lets go of it, whatever the update does meanwhile (the hold patch keeps the installer off it).
    Shepherdr's own state, not an agent's. Refused when a file can't be written."""
    for path in hold_paths(s):
        tmp = None
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            fd, tmp = tempfile.mkstemp(prefix=".fork-sync-", dir=os.path.dirname(path))
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(HOLD_LINE + "\n")
            os.replace(tmp, path)
        except OSError as e:
            if tmp and os.path.exists(tmp):
                os.remove(tmp)
            raise Refused(f"the sync hold can't be written ({e.strerror or type(e).__name__}); nothing moved",
                          outcome="held", kind="install", gate="hold")


# --- the agents' hook files: read, never written ---

SIMULATE = r'''
import json, os, sys, types
cand, share, copies = sys.argv[1:4]
mod = types.ModuleType("candidate_shepherdr")
mod.__file__ = cand
with open(cand, encoding="utf-8") as f:
    exec(compile(f.read(), cand, "exec"), mod.__dict__)


class R:
    """The installer's Run, with the agents' files at the copies and Shepherdr's own folder at the real path."""
    dry = False

    def __init__(self):
        self.notes = []

    def p(self, rel):
        return share if rel == mod.SHARE else os.path.join(copies, rel)

    def backup(self, rel, move=False):
        return None


mod.set_hooks(R(), {}, True)
print(json.dumps({"ok": True}))
'''


def hook_shas(s):
    """{file: sha256 or None} of the two agent hook files, read only."""
    out = {}
    for f in HOOK_FILES:
        try:
            with open(os.path.join(s.home, f), "rb") as h:
                out[f] = hashlib.sha256(h.read()).hexdigest()
        except FileNotFoundError:
            out[f] = None
        except OSError:
            out[f] = "unreadable"
    return out


def hooks_would_change(s, repo, sha):
    """The candidate's own rule, run on copies: [the files its update would write]. Raises Refused when it can't
    be told (the safe side)."""
    ok, text, _ = git(repo, "show", f"{sha}:bin/shepherdr")
    if not ok:
        raise Refused(f"bin/shepherdr can't be read at {sha[:12]}", outcome="held", kind="hooks", gate="hooks")
    scratch = tempfile.mkdtemp(prefix="fork-sync-hooks-")
    try:
        cand = os.path.join(scratch, "shepherdr.py")
        with open(cand, "w", encoding="utf-8") as f:
            f.write(text)
        copies = os.path.join(scratch, "home")
        before = {}
        for rel in HOOK_FILES:
            real = os.path.join(s.home, rel)
            dest = os.path.join(copies, rel)
            if os.path.isdir(os.path.dirname(real)):
                os.makedirs(os.path.dirname(dest), exist_ok=True)
            try:
                with open(real, "rb") as h:
                    data = h.read()
            except FileNotFoundError:
                data = None
            except OSError:
                raise Refused(f"{HOOK_NAMES[rel]} can't be read", outcome="held", kind="hooks", gate="hooks")
            if data is not None:
                with open(dest, "wb") as h:
                    h.write(data)
            before[rel] = data
        code, out, _ = run([sys.executable, "-I", "-c", SIMULATE, cand, s.share, copies], timeout=120, cwd=scratch)
        if code != 0 or not json_line(out):
            raise Refused("the candidate's hook rule can't be run on copies", outcome="held", kind="hooks",
                          gate="hooks")
        changed = []
        for rel in HOOK_FILES:
            try:
                with open(os.path.join(copies, rel), "rb") as h:
                    after = h.read()
            except FileNotFoundError:
                after = None
            if after != before[rel]:
                changed.append(rel)
        return changed
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


# --- Assistants and the scheduler (live only) ---

def assistants(refresh=False):
    """This machine's live Assistants' targets, or None when they can't be read. Other machines' aren't touched by
    an install here, so a link that drops meanwhile doesn't fail it."""
    code, out, _ = run(["herdr-task", "assistants", "--json"] + (["--refresh"] if refresh else []), timeout=120)
    rows = json_line(out) if code == 0 else None
    if not isinstance(rows, list):
        return None
    return sorted({r["target"] for r in rows if isinstance(r, dict) and r.get("target") and not r.get("route")})


def scheduler_now(path):
    """What the scheduler's .scheduler.json says ({"hash", "pid", "mtime"}; empty when it can't be read), and
    whether that pid is a running scheduler. herdr-task's scheduler writes the file once as it starts, so a re-exec
    (os.execv: the same pid) rewrites it and nothing else does."""
    try:
        with open(path, encoding="utf-8") as f:
            rec = json.load(f)
        mtime = os.stat(path).st_mtime
    except (OSError, ValueError):
        rec, mtime = {}, None
    rec = rec if isinstance(rec, dict) else {}
    pid = rec.get("pid")
    return {"hash": rec.get("hash"), "pid": pid, "mtime": mtime, "alive": scheduler_alive(pid)}


def scheduler_alive(pid):
    """Whether pid is a running herdr-task scheduler: its command line's words hold `scheduler` (it runs as
    `<python> <herdr-task> scheduler`). `ps -o command= -p` reads it the same on Linux and macOS."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    code, out, _ = run(["ps", "-o", "command=", "-p", str(pid)], timeout=10)
    return code == 0 and "scheduler" in out.split()


def scheduler_line(s, since=None, sleep=time.sleep):
    """None once the scheduler runs the installed herdr-task (.scheduler.json's hash is its script_hash()), else
    why not, in fixed words. The scheduler re-execs only between rounds, after its round and a 15 s nap, so while it
    is running it is waited for up to scheduler_wait_s(): a long round (it starts and checks tasks) is still on the
    old code, not a failure. One that isn't running fails after health_wait_s() instead (time for it to come back,
    never the whole ceiling). `since` (epoch seconds, the update's start) tells a re-exec from the old code."""
    want, store = None, None
    start = clock()
    first, was_alive, dead_since = None, False, None
    while True:
        if want is None:
            v = probe(s, "scheduler")
            if v and v.get("hash") and v.get("store"):
                want, store = v["hash"], v["store"]
        now_ = scheduler_now(os.path.join(store, ".scheduler.json")) if store else None
        if now_ and now_["hash"] == want:
            return None
        t = clock()
        if now_ is not None:
            first = now_ if first is None else first
            if now_["alive"]:
                was_alive, dead_since = True, None
            elif dead_since is None:
                dead_since = t
        if want is None and t - start >= health_wait_s():
            return "the installed herdr-task can't say its code's hash"
        if dead_since is not None and t - dead_since >= health_wait_s():
            if was_alive:
                return "it ended instead of re-execing onto the installed herdr-task"
            return "not running" + ("" if (first or {}).get("pid") else " (its .scheduler.json can't be read)")
        if dead_since is None and want is not None and t - start >= scheduler_wait_s():
            rewritten = (now_["hash"] != first["hash"] or
                         (since is not None and now_["mtime"] is not None and now_["mtime"] >= since))
            mins = f"{scheduler_wait_s() / 60:g} min"
            if rewritten:
                return f"it re-execed, but onto other code than the installed herdr-task (waited {mins})"
            return f"still on the old herdr-task after {mins}, though running: one long round, or stuck"
        sleep(min(2.0, max(0.05, max(health_wait_s(), scheduler_wait_s()) / 15)))


WEB_INDEX = os.path.join("web", "dist", "index.html")
NO_BUILD = "FORK_REHEARSE_NO_BUILD"                # the rehearsal installed without a build: no web app to read


def web_served(s, timeout=5):
    """The installed web app: its built page is in Shepherdr's folder and (live) the running service serves it, not
    its "isn't built" page. The service is asked on 127.0.0.1 with its own token, as the CLI asks it. None, or why
    not."""
    if s.live or os.environ.get(NO_BUILD) != "1":
        if not os.path.isfile(os.path.join(s.share, WEB_INDEX)):
            return "the built web app isn't installed (web/dist/index.html)"
    return service_page(s, timeout) if s.live else None


def service_page(s, timeout=5):
    """The running service serves the built page at / (live only). None, or why not."""
    v = probe(s, "service", s.home, "live")
    if not v or not v.get("dir"):
        return "the installed herdr-task can't say where the service's files are"
    try:
        with open(os.path.join(v["dir"], "service.json"), encoding="utf-8") as f:
            info = json.load(f)
        port, sid = int(info["port"]), info["id"]
        with open(os.path.join(v["dir"], "token"), encoding="utf-8") as f:
            token = f.read().strip()
    except (OSError, ValueError, KeyError, TypeError):
        return "the service's port or token can't be read"
    import urllib.request
    auth = {"Authorization": f"Bearer {token}"}

    def get(path):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", headers=auth)
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read(200_000)
    try:
        _, body = get("/api/health")
        if (json.loads(body) or {}).get("id") != sid:
            return f"another app answers on port {port}, not the Shepherdr service"
        code, page = get("/")
    except (OSError, ValueError, AttributeError) as e:
        if hasattr(e, "close"):
            e.close()                   # an HTTPError holds its response open
        return f"the service doesn't serve the web app ({type(e).__name__})"
    if code != 200 or b"<html" not in page[:4000].lower():
        return "the service doesn't serve the built web app"
    return None


def tasks_answer(s, timeout=30):
    """The installed herdr-task answers: `herdr-task list` in a scratch store and folder of its own (what the trial
    covered for our merges, which skip it). Never the person's task lists, never hc. None, or why not."""
    entry = os.path.join(s.tasks_bin, "herdr-task")
    if not os.path.isfile(entry):
        return "the installed herdr-task isn't there"
    scratch = tempfile.mkdtemp(prefix="fork-sync-tasks-")
    try:
        folder = os.path.join(scratch, "folder")
        os.makedirs(folder)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("HERDR_TASK_", "HC_"))}
        env.update(HERDR_TASK_STORE=os.path.join(scratch, "store"),
                   HERDR_TASK_SETTINGS=os.path.join(scratch, "settings.json"), SHEPHERDR_NO_MIGRATE="1")
        code, out, _ = run([sys.executable, entry, "list", "--folder", folder, "--json"], env=env, timeout=timeout,
                           cwd=scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    v = json_line(out) if code == 0 else None
    if not isinstance(v, dict) or not isinstance(v.get("tasks"), list):
        return f"herdr-task list didn't answer (exit {code})"
    return None


SCHEDULER_STEPS = (("not running", "not running"), ("it ended", "ended instead of re-execing"),
                   ("it re-execed", "re-execed onto other code"), ("still on the old", "still on the old code"),
                   ("the installed herdr-task", "code hash unread"))


def step_words(name, why):
    """A failed health line as the step the quarantine and the person's words name: `scheduler: <which>` says
    which of the scheduler's cases it was (scheduler_line), every other line its name."""
    if name == "scheduler":
        which = next((short for start, short in SCHEDULER_STEPS if (why or "").startswith(start)), None)
        return f"scheduler: {which}" if which else name
    return name


def until(check, wait, sleep=time.sleep):
    """Calls check() until it is truthy or `wait` seconds passed. Returns its last value."""
    deadline = clock() + wait
    while True:
        got = check()
        if got or clock() >= deadline:
            return got
        sleep(min(2.0, max(0.0, wait / 15)))


# --- asking for the update, and reading how it went ---

def task_json(run_key, folder):
    code, out, _ = run(["herdr-task", "show", run_key, "--folder", folder, "--json"], timeout=60)
    v = json_line(out) if code == 0 else None
    return v if isinstance(v, dict) else None


def may_ask(run_key, folder, env=None):
    """Whether update-shepherdr would take this run's ask: its terminal, open, and a run of a schedule the person let
    update. Checked before anything moves, so a refused ask never leaves the folder moved with nothing installed.
    The terminal check compares with the task's store key from `show --json` (`<folder slug>#<id>`), which herdr-task
    puts in a task's terminal as HERDR_BROWSER_TASK and compares with itself (`self_update.py`), never the short key."""
    env = os.environ if env is None else env
    t = task_json(run_key, folder)
    if not t:
        return f"run {run_key} can't be read with herdr-task show"
    key = t.get("key")
    if not isinstance(key, str) or not key:
        return f"run {run_key}'s key can't be read with herdr-task show, so its terminal can't be checked"
    if env.get("HERDR_BROWSER_TASK") != key:
        return f"only run {run_key}'s own terminal can ask for the update"
    if t.get("state") == "done":
        return f"run {run_key} is done"
    if not t.get("automation"):
        return f"{run_key} isn't a schedule's run"
    code, out, _ = run(["herdr-task", "auto", "show", str(t["automation"]), "--folder", folder, "--json"], timeout=60)
    a = json_line(out) if code == 0 else None
    if not isinstance(a, dict) or not a.get("may_update"):
        return "the schedule may not update Shepherdr yet"
    return None


def updater(s):
    """What asks for the update. The real home: herdr-task. A scratch root never asks herdr-task (its runner updates
    this home's Shepherdr, whatever the root): it names its own updater with that CLI's update-shepherdr
    (FORK_SYNC_SCRATCH_UPDATER: the rehearsal's direct path, build task 6, or a test's fake), else nothing moves."""
    if s.live:
        return "herdr-task"
    u = os.environ.get("FORK_SYNC_SCRATCH_UPDATER")
    if not u:
        raise Refused("a scratch root never asks herdr-task for the update (that would update this home's Shepherdr): "
                      "name its updater in FORK_SYNC_SCRATCH_UPDATER; nothing moved", outcome="held",
                      kind="pipeline", gate="updater")
    return u


def ask_update(s, run_key, folder):
    """`herdr-task update-shepherdr <run> --folder <space> --no-wait`, from the run's own terminal, with HOLD_VAR:
    the runner (self_update.clean_env) and the installer's hand_over keep it, so the hold patch keeps the update off
    the run's hold. Only this call sets it. Its exit code says little: the outcome is read from its state
    (read_outcome)."""
    run([updater(s), "update-shepherdr", run_key, "--folder", folder, "--no-wait"], timeout=120,
        env=dict(os.environ, **{HOLD_VAR: "1"}))


def update_status(s, task, folder):
    """The task's shepherdr_update ({state, at, done_at, ...}), or None when it can't be read."""
    code, out, _ = run([updater(s), "update-shepherdr", task, "--folder", folder, "--status", "--json"], timeout=60)
    v = json_line(out) if code == 0 else None
    return v if isinstance(v, dict) else None


def read_outcome(s, ask, now=time.time, sleep=time.sleep):
    """Polls the asking task's update state (Reading the outcome). -> ("ok" | "failed" | "unknown" | "wait",
    {state, at, done_at}). An update whose `at` is before the ask isn't this one: the ask was refused, so it failed.
    Running 40 minutes after its `at`: unknown. One call waits at most a shell call's share, then "wait"."""
    began = now()
    while True:
        u = update_status(s, ask["task"], ask["folder"])
        if u is None:
            return "unknown", {}
        seen = {k: u.get(k) for k in ("state", "at", "done_at", "version") if u.get(k) is not None}
        at = u.get("at")
        if not isinstance(at, (int, float)) or at < ask["asked"]:
            return "failed", dict(seen, state="not started")
        if u.get("state") in ("ok", "failed"):
            return u["state"], seen
        if u.get("state") != "running":
            return "unknown", seen
        if now() * 1000 - at >= UNKNOWN_AFTER_S * 1000:
            return "unknown", seen
        if now() - began >= gate.call_wait_s():
            return "wait", seen
        sleep(max(0.0, update_poll_s()))


# --- moving the install folder ---

def fetch_candidate(s, sha):
    """The fork's main fetched into the install folder (its remote `fork` added the first time) and the commit
    there. Moves nothing."""
    ok, url, _ = git(s.folder, "config", "--get", "remote.fork.url")
    if not ok:
        git(s.folder, "remote", "add", "fork", f"https://github.com/{state.REPO}.git")
    elif not re.match(rf"^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/){re.escape(state.REPO)}"
                      r"(?:\.git)?/?$", url):
        raise Refused(f"the install folder's remote fork isn't {state.REPO}", outcome="held", kind="install",
                      gate="folder")
    git(s.folder, "fetch", "--no-tags", "fork", "main", timeout=600)
    if not git(s.folder, "cat-file", "-e", f"{sha}^{{commit}}")[0]:
        raise Refused(f"{sha[:12]} isn't in the install folder after fetching the fork's main", outcome="held",
                      kind="install", gate="folder")


def checkout(s, sha):
    ok, _, _ = git(s.folder, "checkout", "--quiet", "--detach", sha)
    return ok and rev(s.folder, "HEAD") == sha


# --- baseline ---

def read_baseline(s):
    """What is installed and where the install folder is, proven to agree, or a Refused hold (kind pipeline):
    installed.json's source is the install folder and its root the home, it is whole, the folder is clean and its
    HEAD's VERSION is the installed version."""
    rec = record(s)
    if rec is None:
        raise Refused(f"{s.p.show(s.record)} can't be read: is Shepherdr installed here?", outcome="held",
                      kind="pipeline", gate="baseline")
    head, branch, clean = folder_head(s)
    if not head:
        raise Refused("the install folder isn't a git checkout", outcome="held", kind="pipeline", gate="baseline")
    seen = {"sha": head, "branch": branch, "version": rec.get("version"), "source": s.p.show(s.folder),
            "at": rec.get("at"), "whole": rec.get("whole")}
    why = None
    if not same_path(rec.get("source"), s.folder):
        why = "Shepherdr was last installed from another folder than the config's install folder"
    elif not same_path(rec.get("root"), s.home):
        why = "Shepherdr was last installed under another root than this home"
    elif rec.get("whole") is not True:
        why = "the last install isn't whole"
    elif not clean:
        why = "the install folder has uncommitted changes"
    elif version_at(s.folder, head) != rec.get("version"):
        why = (f"the install folder's HEAD is version {version_at(s.folder, head) or 'unknown'}, but "
               f"{rec.get('version') or 'no version'} is installed: it moved after its last install")
    if why:
        raise Refused(why, outcome="held", kind="pipeline", gate="baseline", seen=seen)
    return seen


def baseline(p, run_key, folder, capture=False, live=True, hostname=None):
    s = site(p, live, hostname)
    with state.locked(p) as st:
        state.owns_lease(st, run_key, folder)
        phase, have = st.get("phase"), st.get("baseline")
    if phase in state.MOVING:
        raise Refused(f"the phase is {phase}: the install folder may have moved; resume that first", outcome="stop")
    seen = read_baseline(s)
    if not have:
        if not capture:
            raise Refused("no baseline is recorded yet: the first run captures it (baseline --capture)",
                          outcome="stop")
        with state.locked(p) as st:
            state.owns_lease(st, run_key, folder)
            if st.get("baseline"):
                raise Refused("a baseline was recorded meanwhile", outcome="stop")
            st["baseline"] = dict(seen, captured=state.stamp())
        return {"baseline": seen, "captured": True}
    if have.get("sha") != seen["sha"] or have.get("version") != seen["version"]:
        raise Refused(f"the install folder is at {seen['sha'][:12]} ({seen['version']}), not the baseline "
                      f"{str(have.get('sha'))[:12]} ({have.get('version')}): someone installed by hand",
                      outcome="held", kind="pipeline", gate="baseline", seen=seen)
    return {"baseline": seen, "captured": False}


# --- install ---

OURS = "install-merged"     # Installing our own merges (fork/sync/merged.py)


def policy(st, run_key):
    """The install policy this run's state asks for: "ours" (Installing our own merges: settle pinned main's tip,
    phase settled; no trial, no wait on main's checks, since this space's merges go in before CI reports) or
    "release" (a release sync: phase tried or merged, its trial and main's checks on that exact SHA). None: neither,
    nothing installs."""
    r = st.get("run") or {}
    if r.get("key") != run_key:
        return None
    if r.get("path") == OURS:
        return "ours" if st.get("phase") == "settled" else None
    return "release" if st.get("phase") in ("tried", "merged") else None


def before_checks(s, st, repo, sha, run_key, folder, env=None, ours=False):
    """Install's checks, in order (Before anything moves). Each one that fails stops with nothing changed. Returns
    the before-pictures for health. `ours`: our merges' policy, which has no trial and no main's checks gate; a
    commit whose shipped files are a quarantined one's stays out like that one."""
    # 1 the machine: site() checked it
    updater(s)                                                    # a scratch root names its own updater, or stops
    installed_cli(s)                                                                                  # 2
    recorded_source(s)                                                                                  # 3
    base = (st.get("baseline") or {}).get("sha")
    head, _, clean = folder_head(s)                                                                     # 4
    if not clean:
        raise Refused("the install folder has uncommitted changes", outcome="held", kind="install", gate="folder")
    if not base or head != base:
        raise Refused(f"the install folder is at {str(head)[:12]}, not the baseline {str(base)[:12]}",
                      outcome="held", kind="install", gate="folder")
    q = state.quarantined(st, sha)                                                                      # 5
    if not q and ours:
        from . import merged
        q = merged.quarantined_like(st, repo, sha)
    if q:
        like = f" ships the same files as {q['like'][:12]}, which" if q.get("like") else ""
        raise Refused(f"{sha[:12]}{like} is quarantined (it failed at {q.get('step')})", outcome="held",
                      kind="install", gate="quarantine")
    if not ours:
        t = tree(repo, sha)
        if not t or not any(x.get("tree") == t for x in st.get("trials") or []):
            raise Refused(f"no trial passed on {sha[:12]}'s tree", outcome="held", kind="install", gate="trial")
    rel = (st.get("release") or {}).get("sha")
    if not rel or not is_ancestor(repo, rel, sha):
        raise Refused(f"{rel or 'the release'} is not an ancestor of {sha}", outcome="held", kind="install",
                      gate="ancestry")
    if not ours and not state.checks_passed(st, sha):
        raise Refused(f"main's checks haven't passed on {sha[:12]}", outcome="held", kind="install", gate="checks")
    h = pipeline_hash(repo, sha)                                          # the rehearsal gate (Installing our merges)
    if not state.rehearsal_passed(st, h):
        raise Refused(f"no rehearsal passed for the pipeline's code at {sha[:12]}", outcome="held", kind="install",
                      gate="rehearsal")
    changed = hooks_would_change(s, repo, sha)                                                          # 6
    if changed:
        raise Refused("the update would write " + " and ".join(HOOK_NAMES[f] for f in changed) +
                      ": the person runs that update themselves", outcome="held", kind="hooks", gate="hooks",
                      files=changed)
    _, why = patch_list_at(repo, sha)                                                                   # 7
    if why:
        raise Refused(f"{sha[:12]} doesn't carry the hold patch: {why}", outcome="held", kind="install",
                      gate="hold-patch")
    if not carries_hold_patch(repo, sha):
        raise Refused(f"{sha[:12]} doesn't carry the hold patch (its patch list names no {HOLD_PATCH_TEST})",
                      outcome="held", kind="install", gate="hold-patch")
    if s.live:
        why = may_ask(run_key, folder, env)
        if why:
            raise Refused(why, outcome="held", kind="permission", gate="permission")
    before = {"hooks": hook_shas(s)}                                                                    # 8
    if s.live:
        found = assistants()
        if found is None:
            raise Refused("the Assistants can't be read for health's before-picture", outcome="held",
                          kind="install", gate="assistants")
        before["assistants"] = found
    return before


def ensure_checks(p, repo, sha, now=time.time, sleep=time.sleep):
    """Main's checks on a candidate that no merge checked (main's tip): its push is what its first parent didn't
    have. Returns None once they passed, else the words of a wait (call again)."""
    with state.locked(p) as st:
        if state.checks_passed(st, sha):
            return None
    parent = rev(repo, f"{sha}^")
    result, got = gate.main_checks(p, repo, sha, parent, now=now, sleep=sleep)
    if result == "wait":
        return f"main's checks on {sha[:12]} are still running ({gate.checks_words(got)}): call install again"
    return None


def install(p, run_key, folder, repo, sha, live=True, hostname=None, env=None, now=time.time, sleep=time.sleep):
    """`install <sha>`: the checks, then the folder moved and the update asked for, then its outcome. Called again
    (phase installing) it reads the outcome of the update already asked for, never asking twice."""
    if not state.SHA.match(sha or ""):
        raise Refused("the candidate is named by its full SHA", outcome="stop")
    s = site(p, live, hostname)
    with state.locked(p) as st:
        state.owns_lease(st, run_key, folder)
        phase, cand, ins = st.get("phase"), st.get("candidate"), dict(st.get("install") or {})
        r = st.get("run") or {}
        how = policy(st, run_key)
    if phase == "installing":
        if ins.get("sha") != sha:
            raise Refused(f"the install under way is {str(ins.get('sha'))[:12]}, not {sha[:12]}", outcome="stop")
        if not ins.get("ask"):
            # a run died before its ask: whoever had the folder since, the checks that guard it run again
            why = resume_checks(s, ins, repo, run_key, folder, env)
            if why:
                raise Refused(f"the install stopped before its update was asked for, and now {why}: nothing was "
                              "asked; the person looks", outcome="unknown", gate="resume")
            try:
                hold_sync(s)                      # written before the phase was; written again before the folder moves
            except Refused as e:
                raise Refused(f"the install stopped before its update was asked for, and now {e.why}: nothing was "
                              "asked; the person looks", outcome="unknown", gate="resume")
            return move_and_ask(p, s, run_key, folder, sha, base=ins.get("baseline"), now=now, sleep=sleep)
        return outcome(p, s, ins["ask"], now=now, sleep=sleep)
    if phase == "installed":
        raise Refused("the update already ended: run health", outcome="stop")
    if r.get("key") == run_key and r.get("path") == OURS and phase != "settled":
        raise Refused(f"the phase is {phase or 'none'}: our merges install from settle (phase settled)",
                      outcome="stop")
    if how is None:
        raise Refused(f"the phase is {phase or 'none'}: a candidate installs after its trial (and its merge)",
                      outcome="stop")
    if cand != sha:
        raise Refused(f"this run's candidate is {str(cand)[:12]}, not {sha[:12]}", outcome="stop")
    if how == "release":
        waiting = ensure_checks(p, repo, sha, now=now, sleep=sleep)
        if waiting:
            raise Refused(waiting, outcome="wait")
    with state.locked(p) as st:
        snap = json.loads(json.dumps(st))
    before = before_checks(s, snap, repo, sha, run_key, folder, env, ours=how == "ours")
    fetch_candidate(s, sha)
    with state.locked(p) as st:
        state.owns_lease(st, run_key, folder)
        if st.get("phase") != phase or st.get("candidate") != sha:
            raise Refused("the state moved meanwhile", outcome="stop")
        hold_sync(s)          # the run's own hold, before the phase says the folder may move: refused, nothing moved
        base = dict(st.get("baseline") or {})
        state.set_phase(st, "installing")
        st["install"] = {"sha": sha, "version": version_at(repo, sha), "baseline": base.get("sha"),
                         "base_version": base.get("version"), "at": state.stamp(), "before": before, "ask": None,
                         "update": None, "health": None}
        st["rollback"] = None
    return move_and_ask(p, s, run_key, folder, sha, base=before_base(snap), now=now, sleep=sleep)


def before_base(st):
    return (st.get("baseline") or {}).get("sha")


def folder_at(s, *shas):
    """The install folder clean, its HEAD one of these SHAs (a checkout with changes would carry them along)."""
    head, _, clean = folder_head(s)
    return bool(clean and head and head in [x for x in shas if x])


def resume_checks(s, ins, repo, run_key, folder, env=None):
    """Before a resumed install moves the folder: the updater, the CLI, the source, the folder clean at the
    baseline (or already at the candidate), the agents' hook files as install found them and still not ones the
    update would write, and (live) the ask allowed. None, or why not."""
    try:
        updater(s)
        installed_cli(s)
        recorded_source(s)
    except Refused as e:
        return e.why
    if not folder_at(s, ins.get("baseline"), ins.get("sha")):
        return "the install folder is at neither the baseline nor the candidate, or has changes"
    was = (ins.get("before") or {}).get("hooks")
    if not was or hook_shas(s) != was:
        return "an agent's hook file changed since the install's checks"
    try:
        changed = hooks_would_change(s, repo, ins.get("sha"))
    except Refused as e:
        return e.why
    if changed:
        return "the update would write " + " and ".join(HOOK_NAMES[f] for f in changed)
    if s.live:
        return may_ask(run_key, folder, env)
    return None


def move_and_ask(p, s, run_key, folder, sha, base=None, now=time.time, sleep=time.sleep):
    """Phase installing, nothing asked yet: the folder to the candidate, then the ask, recorded at once."""
    if not folder_at(s, base, sha):
        raise Refused("the install folder changed before it moved (someone else's change): nothing was asked; the "
                      "person looks", outcome="unknown", gate="folder")
    if not checkout(s, sha):
        # HEAD may not have moved: the update wasn't asked for; the rollback finds HEAD at either SHA
        with state.locked(p) as st:
            st["install"] = dict(st.get("install") or {}, update={"state": "not started"}, failed="the checkout")
            state.set_phase(st, "installed")
        raise Refused(f"the install folder can't be checked out at {sha[:12]}: roll back", outcome="failed",
                      next="rollback")
    # recorded before it is made: a call that dies in between reads an update older than the ask as not started
    ask = {"task": run_key, "folder": folder, "asked": int(time.time() * 1000)}
    with state.locked(p) as st:
        st["install"] = dict(st.get("install") or {}, ask=ask)
    ask_update(s, run_key, folder)
    return outcome(p, s, ask, now=now, sleep=sleep)


def outcome(p, s, ask, now=time.time, sleep=time.sleep):
    got, seen = read_outcome(s, ask, now=now, sleep=sleep)
    if got == "wait":
        raise Refused("the update is still running: call install again", outcome="wait", update=seen)
    if got == "unknown":
        with state.locked(p) as st:
            st["install"] = dict(st.get("install") or {}, update=seen)
        raise Refused("the update's outcome can't be read, or it still runs 40 minutes after it began",
                      outcome="unknown", update=seen)
    with state.locked(p) as st:
        ins = dict(st.get("install") or {}, update=seen)
        if got == "failed":
            ins["failed"] = "the update"
        st["install"] = ins
        state.set_phase(st, "installed")
    if got == "failed":
        raise Refused("the update failed: health still runs (it may have half-landed), then rollback",
                      outcome="failed", next="health", update=seen)
    return {"update": "ok", "next": "health", "seen": seen}


# --- health ---

def health_lines(s, repo_folder, sha, ins, update, candidate=True, sleep=time.sleep):
    """[(line, ok, why)] for each health line, doctor last; it stops at the first that fails (doctor never runs on
    an install another line failed, nor on one whose update said it failed, so it can't let go of the sync hold).
    On the candidate the hooks line comes first: a changed hook file is the person's to look at, whatever else
    failed."""
    out = []

    def line(name, why):
        out.append((name, why is None, why))
        return why is None

    if candidate:
        was = ins.get("before", {}).get("hooks") or {}
        now_h = hook_shas(s)
        changed = [f for f in HOOK_FILES if now_h.get(f) != was.get(f)]
        if not line("hooks", ("changed: " + ", ".join(HOOK_NAMES[f] for f in changed)) if changed else None):
            return out
    rec = record(s) or {}
    want = version_at(repo_folder, sha)
    at, started = stamp_epoch(rec.get("at")), (update or {}).get("at")
    why = None
    if not rec:
        why = "installed.json can't be read"
    elif rec.get("version") != want:
        why = f"installed version {rec.get('version')}, not {want}"
    elif not same_path(rec.get("source"), s.folder):
        why = "installed from another folder"
    elif not isinstance(started, (int, float)) or at is None or at < int(started / 1000):
        why = "installed.json isn't from this update"
    elif rec.get("whole") is not True:
        why = "the install isn't whole"
    if not line("record", why):
        return out
    if not line("files", installed_files_differ(s, repo_folder, sha, rec)):
        return out
    # what the trial covered, read in seconds (our merges skip the trial): the web app built and served, herdr-task
    if not line("web", web_served(s)):
        return out
    if not line("tasks", tasks_answer(s)):
        return out
    if s.live:
        had = ins.get("before", {}).get("assistants") or []

        def all_there():
            now_ = assistants(refresh=True)
            return now_ is not None and not (set(had) - set(now_))
        if not line("assistants", None if until(all_there, health_wait_s(), sleep) else
                    "an Assistant that ran before the update isn't listed"):
            return out
        since = started / 1000 if isinstance(started, (int, float)) else None
        if not line("scheduler", scheduler_line(s, since, sleep)):
            return out
    if candidate and not s.live and os.environ.get(FORCE_HEALTH_FAIL) == "1":
        line("forced", "told to fail (the rehearsal's test flag)")
        return out
    if candidate and ins.get("failed"):
        line("doctor", f"not run: {ins['failed']} failed")
        return out
    line("doctor", doctor(s))
    return out


def installed_files_differ(s, repo_folder, sha, rec):
    """Each file installed.json lists under Shepherdr's folder that comes from a tracked file has that file's content
    at the SHA (compared as git blob hashes). Built files are skipped. None, or why not."""
    ok, out, _ = git(repo_folder, "ls-tree", "-r", "-z", "--full-tree", sha)
    if not ok:
        return f"{sha[:12]}'s files can't be listed"
    blobs = {}
    for entry in out.split("\0"):
        meta, _, path = entry.partition("\t")
        parts = meta.split()
        if len(parts) == 3 and parts[1] == "blob":
            blobs[path] = parts[2]
    prefix = SHARE + "/"
    n = 0
    for rel in sorted((rec.get("files") or {})):
        if not rel.startswith(prefix):
            continue
        path = rel[len(prefix):]
        if path.startswith(BUILT) or path not in blobs:
            continue
        try:
            with open(os.path.join(s.home, rel), "rb") as f:
                data = f.read()
        except OSError:
            return f"{path} is missing"
        algo = hashlib.sha1 if len(blobs[path]) == 40 else hashlib.sha256
        if algo(b"blob %d\0" % len(data) + data).hexdigest() != blobs[path]:
            return f"{path} isn't {sha[:12]}'s"
        n += 1
    return None if n else "installed.json lists none of the commit's files"


def doctor(s):
    """`shepherdr doctor` (the installed one), without the hold variable: it lets go of the sync hold once the install
    is whole. Its words stay private: only whether it passed comes back."""
    cli = os.path.join(s.share, "bin", "shepherdr")
    env = {k: v for k, v in os.environ.items() if k != "SHEPHERDR_KEEP_SYNC_HOLD"}
    argv = [cli, "doctor"] + ([] if s.live else ["--root", s.home])
    code, _, _ = run(argv, env=env, timeout=600)
    return None if code == 0 else "shepherdr doctor didn't pass"


def health(p, run_key, folder, repo, sha, live=True, hostname=None, tag=None, sleep=time.sleep):
    """`health <sha>` on the candidate. Pass: the candidate is the baseline, its install is counted, and (live) its
    tag is pushed. Fail: roll back. The agent hook files changed: broken, both kept for the person."""
    s = site(p, live, hostname)
    with state.locked(p) as st:
        state.owns_lease(st, run_key, folder)
        phase, ins = st.get("phase"), dict(st.get("install") or {})
    if phase != "installed" or ins.get("sha") != sha:
        raise Refused(f"health runs on the installed candidate (phase {phase or 'none'}, "
                      f"candidate {str(ins.get('sha'))[:12]})", outcome="stop")
    if ins.get("passed"):
        # health passed and only its tag is pending: never the lines (or doctor) again
        return passed(p, s, run_key, folder, repo, sha, ins.get("health") or [], live if tag is None else tag)
    lines = health_lines(s, s.folder, sha, ins, ins.get("update"), candidate=True, sleep=sleep)
    failed = next(((n, w) for n, ok, w in lines if not ok), None)
    words = [{"line": n, "ok": ok, **({"why": w} if w else {})} for n, ok, w in lines]
    if failed and failed[0] == "hooks":
        with state.locked(p) as st:
            st["install"] = dict(st.get("install") or {}, health=words, broken="hooks")
            state.quarantine(st, sha, "health: an agent's hook file changed")
            state.set_phase(st, "broken")
        raise Refused(f"an agent's hook file changed during the install ({failed[1]}): nothing undoes it; the person "
                      "looks", outcome="unknown", kind="hooks", alert=f"{failed[1]} during the Shepherdr install",
                      lines=words)
    if failed:
        with state.locked(p) as st:
            st["install"] = dict(st.get("install") or {}, health=words,
                                 failed=st.get("install", {}).get("failed") or f"health ({step_words(*failed)})")
        raise Refused(f"health failed at {failed[0]}: {failed[1]}", outcome="rollback", next="rollback", lines=words)
    with state.locked(p) as st:
        st["install"] = dict(st.get("install") or {}, health=words, passed=True)
    return passed(p, s, run_key, folder, repo, sha, words, live if tag is None else tag)


def passed(p, s, run_key, folder, repo, sha, words, want_tag):
    """Health passed: the tag (live), then the candidate is the baseline. A tag that can't be pushed keeps the phase
    installed with the pass recorded, so the next health call (or run) retries only the tag."""
    rec = record(s) or {}
    pushed = None
    if want_tag:
        pushed = push_tag(repo, sha, rec.get("version"))
        if not pushed:
            raise Refused(f"health passed, but the tag ours-{rec.get('version')}-<n> couldn't be pushed: call health "
                          "again (it retries only the tag)", outcome="wait", next="health", lines=words)
    with state.locked(p) as st:
        held = [dict(h) for h in st.get("held") or []]
    # a held record whose release this healthy install carries is over: no 24-hour question about it any more
    over = [h.get("blocker") for h in held
            if state.SHA.match((h.get("release") or {}).get("sha") or "") and is_ancestor(repo, h["release"]["sha"], sha)]
    with state.locked(p) as st:
        state.owns_lease(st, run_key, folder)
        for blocker in over:
            state.clear_held(st, blocker)
        st["install"] = dict(st.get("install") or {}, health=words, tag=pushed)
        st["baseline"] = {"sha": sha, "branch": None, "version": rec.get("version"), "source": s.p.show(s.folder),
                          "at": rec.get("at"), "whole": rec.get("whole"), "installed": state.stamp(), "tag": pushed}
        r = st.get("run") or {}
        st["installs"] = (st.get("installs") or [])[-(state.KEEP - 1):] + [
            {"sha": sha, "version": rec.get("version"), "at": state.stamp(), "tag": pushed,
             "run": r.get("key"), "path": r.get("path")}]
        if r.get("path") == OURS:
            from . import merged
            merged.track(st, sha, rec.get("version"), pushed, r.get("key"))     # CI on main reports after it
        else:
            # a release sync's install passed main's checks before it went in: a point the person can go back to
            st["recovery"] = {"sha": sha, "version": rec.get("version"), "tag": pushed, "at": state.stamp()}
        state.set_phase(st, "healthy")
    return {"outcome": "installed", "version": rec.get("version"), "tag": pushed, "lines": words, "held_over": over}


def push_tag(repo, sha, version):
    """`ours-<version>-<n>` on that commit, pushed to the fork: n is one more than the highest the fork has for that
    version, or the fork's existing one on this commit (a push that landed but said it failed). Only after health
    passed. None when it couldn't be pushed."""
    if not version:
        return None
    ok, out, _ = git(repo, "ls-remote", "--tags", "origin", f"refs/tags/ours-{version}-*", timeout=120)
    if not ok:
        return None
    tags = [(m.group(1), int(m.group(2))) for m in
            re.finditer(rf"^([0-9a-f]+)\trefs/tags/ours-{re.escape(version)}-(\d+)$", out, re.M)]
    mine = sorted(n for at, n in tags if at == sha)
    if mine:
        return f"ours-{version}-{mine[0]}"
    name = f"ours-{version}-{max((n for _, n in tags), default=0) + 1}"
    ok, _, _ = git(repo, "push", "--quiet", "origin", f"{sha}:refs/tags/{name}", timeout=300)
    return name if ok else None


# --- rollback ---

def rollback(p, run_key, folder, live=True, hostname=None, env=None, now=time.time, sleep=time.sleep):
    """`rollback`: back to the baseline, verified by health on it. Called again (phase rolling-back) it resumes: the
    checkout, the ask or the outcome, whichever comes next."""
    s = site(p, live, hostname)
    with state.locked(p) as st:
        state.owns_lease(st, run_key, folder)
        phase, ins, rb = st.get("phase"), dict(st.get("install") or {}), dict(st.get("rollback") or {})
        cand, base = st.get("candidate"), dict(st.get("baseline") or {})
    if phase not in ("installing", "installed", "rolling-back") or not ins.get("sha") or ins.get("sha") != cand:
        raise Refused(f"nothing to roll back (phase {phase or 'none'})", outcome="stop")
    base_sha = ins.get("baseline") or base.get("sha")
    if phase != "rolling-back":
        if ins.get("passed"):
            raise Refused("health passed on the candidate (its tag is pending): run health, not rollback",
                          outcome="stop")
        if phase == "installing" and ins.get("ask"):
            u = update_status(s, ins["ask"]["task"], ins["ask"]["folder"])
            if u is None or (u.get("state") == "running" and (u.get("at") or 0) >= ins["ask"]["asked"]):
                raise Refused("the candidate's update may still be running: install reads its outcome first",
                              outcome="stop")
        why = rollback_checks(s, run_key, folder, cand, base_sha, env)
        if why:
            broken(p, cand, base_sha, f"rollback refused: {why}")
            raise Refused(f"the rollback can't start: {why}; nothing moved", outcome="broken")
        with state.locked(p) as st:
            state.set_phase(st, "rolling-back")
            st["rollback"] = rb = {"sha": base_sha, "from": cand, "at": state.stamp(), "ask": None, "update": None}
    if not rb.get("ask"):
        if not folder_at(s, cand, base_sha):
            broken(p, cand, base_sha, "the install folder changed during the rollback")
            raise Refused("the install folder is at neither the candidate nor the baseline, or has changes: "
                          "someone else's change; nothing moved", outcome="broken")
        try:
            hold_sync(s)    # the install's hold stays through the rollback: the healthy baseline's doctor lets go
        except Refused:
            pass            # it is already there; never a reason to leave the failed candidate installed
        if not checkout(s, base_sha):
            broken(p, cand, base_sha, "the rollback's checkout")
            raise Refused(f"the install folder can't be checked out at the baseline {base_sha[:12]}",
                          outcome="broken")
        ask = {"task": run_key, "folder": folder, "asked": int(time.time() * 1000)}
        with state.locked(p) as st:
            st["rollback"] = rb = dict(st.get("rollback") or {}, ask=ask)
        ask_update(s, run_key, folder)
    got, seen = read_outcome(s, rb["ask"], now=now, sleep=sleep)
    if got == "wait":
        raise Refused("the rollback's update is still running: call rollback again", outcome="wait", update=seen)
    with state.locked(p) as st:
        st["rollback"] = dict(st.get("rollback") or {}, update=seen)
    if got != "ok":
        broken(p, cand, base_sha, "the rollback's update")
        raise Refused(f"the rollback's update {'failed' if got == 'failed' else 'has no outcome'}", outcome="broken",
                      update=seen)
    lines = health_lines(s, s.folder, base_sha, ins, seen, candidate=False, sleep=sleep)
    failed = next(((n, w) for n, ok, w in lines if not ok), None)
    words = [{"line": n, "ok": ok, **({"why": w} if w else {})} for n, ok, w in lines]
    if failed:
        broken(p, cand, base_sha, f"health on the baseline ({step_words(*failed)})", health=words)
        raise Refused(f"health on the baseline failed at {failed[0]}: {failed[1]}", outcome="broken", lines=words)
    with state.locked(p) as st:
        step = (st.get("install") or {}).get("failed") or "health"
        st["rollback"] = dict(st.get("rollback") or {}, health=words)
        state.quarantine(st, cand, step)
        state.set_phase(st, "rolled-back")
    return {"outcome": "rolled-back", "baseline": base_sha, "quarantined": cand, "lines": words,
            "report": report(ins, base, step)}


def rollback_checks(s, run_key, folder, cand, base_sha, env=None):
    """Rollback's own checks before it moves anything: None, or why not."""
    try:
        updater(s)
        installed_cli(s)
        recorded_source(s)
    except Refused as e:
        return e.why
    if not folder_at(s, cand, base_sha):
        return "the install folder is at neither the candidate nor the baseline, or has changes"
    if not base_sha or not git(s.folder, "cat-file", "-e", f"{base_sha}^{{commit}}")[0]:
        return "the baseline commit isn't in the install folder"
    if s.live:
        why = may_ask(run_key, folder, env)
        if why:
            return why
    return None


def broken(p, cand, base_sha, step, health=None):
    """Unknown: rollback failed. Both SHAs quarantined; the lease stays; only the person clears the phase."""
    with state.locked(p) as st:
        if cand:
            state.quarantine(st, cand, (st.get("install") or {}).get("failed") or step)
        if base_sha:
            state.quarantine(st, base_sha, step)
        st["rollback"] = dict(st.get("rollback") or {}, failed=step, **({"health": health} if health else {}))
        state.set_phase(st, "broken")


def report(ins, base, step):
    """The pipeline issue's comment, in fixed words from the state (public-check still runs on it)."""
    return (f"The install of {ins.get('version') or 'the candidate'} ({str(ins.get('sha'))[:12]}) failed at {step}. "
            f"Rolled back to {ins.get('base_version') or base.get('version') or 'the baseline'} "
            f"({str(ins.get('baseline') or base.get('sha'))[:12]}), verified healthy. The failed commit is "
            "quarantined.")
