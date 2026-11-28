"""Each task's own temporary folder (dmalis/shepherdr#216).

A task's agent starts with TMPDIR, TMP and TEMP (only those; never an agent's settings) set to a folder only that task
uses, so what its tests and tools leave behind goes with the task, not into the machine's /tmp (like RUNNER_TEMP).

  where   SCRATCH/<6 letters and digits>, on disk (systemd's place for long-lived temporary files; /tmp may be a
          tmpfs). On macOS, a /var/tmp that isn't a local disk, or a HOME not the account's own: ~/.shep-tmp/<id>;
          <SHEPHERDR_HOME>/.shep-tmp for an install of its own; <HERDR_TASK_STORE>/.tmp for a throwaway store.
          Owner-only, made with mkdir (fails rather than share), short enough to leave SOCKET_ROOM bytes for a
          tool's Unix socket. Made on the task's machine when its agent starts or its terminal opens, recorded as "tmp".
  held    everything run for the task holds a shared flock on it, inherited on descriptor 9 (TAKE): its agent and the
          shell its terminal keeps, its web-app terminal (service/shells.ts), a detached action (link.py). The lock
          is theirs, so a scheduler restart changes nothing. systemd-tmpfiles' aging skips a locked folder.
  gone    only by Shepherdr, never while in use (_drop(): the lock taken exclusively, no live terminal of the task):
          at its end or removal, and by the sweep (scheduler start, every SWEEP_EVERY_S) once its task is Done or gone,
          GRACE_S after its last start or Done. When that can't be told, it stays. A start held on a full disk sweeps
          at once (pressed()).
  before  older copies' folders (~/.shep-tmp, the cache folder) drain in place by the same rules; an older web-app
          shell's .shell-<pid> mark counts as a user. A task's next start records its old one as "tmp_old"."""

import fcntl
import os
import re
import secrets
import shutil
import stat
import sys
import time

from .base import hc_json, real_home, STORE, WHERE

VARS = ("TMPDIR", "TMP", "TEMP")
SCRATCH = "/var/tmp/shepherdr"
ROOT_NAME = ".shep-tmp"  # in the home, or SHEPHERDR_HOME
SWEEP_EVERY_S, PRESSED_EVERY_S, GRACE_S = 600, 300, 3600
NAME = re.compile(r"^[0-9a-z]{6}$")
OLD_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}-[0-9a-f]{4}$")  # the cache folder's (sd-254-9f3a), before #236
SHELL_MARK = ".shell-"  # what older web-app shells wrote there: .shell-<pid>
# The longest home ~/.shep-tmp stays short enough for (/Users/ and a 19-letter name, /home/ and 20), the room left
# for a tool's socket, and each OS's longest socket path (sun_path, less its closing zero): test_task_tmp.py's sums.
MAX_HOME, SOCKET_ROOM, SOCKET_MAX = 26, 60, {"darwin": 103, "linux": 107}
MOUNTS = "/proc/self/mounts"
NOT_LOCAL = re.compile(r"^(tmpfs|ramfs|nfs4?|cifs|smb3?|9p|afs|ceph|glusterfs|virtiofs|fuse\..*)$")
# sh words that lock the folder "$1" names on descriptor 9, shared and never waiting, for what runs after: util-linux's
# flock, else Python's (macOS has no flock command). A lock belongs to the open descriptor: every process that inherits
# 9 holds it, and it ends when the last one closes. Not held (gone, or being removed): what runs gets the machine's own
# temp folder, never this one. service/shells.ts's TMP_SHELL has the same words.
TAKE = ('[ -d "$1" ] && command exec 9<"$1" && { flock -s -n 9 || python3 -c "import fcntl; '
        'fcntl.flock(9, fcntl.LOCK_SH | fcntl.LOCK_NB)"; } 2>/dev/null || { command exec 9<&-; unset TMPDIR TMP TEMP; }')
KEY_FILE = ".shep-task"  # in each folder: its task's key, so a removed task's folder still finds its live helpers
_B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
_swept = _pressed = 0.0
_local = {}


def _local_disk(path):
    """Whether path is on a local disk (the last mount over it in /proc/self/mounts is neither memory nor a network
    one); False where that can't be told."""
    if path not in _local:
        real, best, kind = os.path.realpath(path), "", None
        try:
            with open(MOUNTS) as f:
                for line in f:
                    w = line.split()
                    mnt = w[1].replace("\\040", " ") if len(w) > 2 else ""
                    if mnt and (real == mnt or real.startswith(mnt.rstrip("/") + "/")) and len(mnt) >= len(best):
                        best, kind = mnt, w[2]
        except OSError:
            pass
        _local[path] = bool(kind) and not NOT_LOCAL.match(kind)
    return _local[path]


def _own_install():
    one = WHERE.env.get("SHEPHERDR_HOME")
    return one if one and os.path.isabs(one) and WHERE.roots["cache"] == os.path.join(one, "cache") else None


def _scratch_ok():
    """SCRATCH may be the root: not macOS, the account's own HOME, /var/tmp on a local disk, and SCRATCH not there yet
    or a real folder of this user's (/var/tmp is everyone's: never one someone else made)."""
    if sys.platform == "darwin" or os.path.realpath(WHERE.home) != os.path.realpath(real_home()) \
            or not _local_disk(os.path.dirname(SCRATCH)):
        return False
    try:
        st = os.lstat(SCRATCH)
    except OSError as e:
        return isinstance(e, FileNotFoundError)
    return stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid()


def root():
    """Where this machine's task temp folders are made (the module's docstring)."""
    if os.environ.get("HERDR_TASK_STORE"):
        return os.path.join(STORE, ".tmp")
    one = _own_install()
    if one:
        return os.path.join(one, ROOT_NAME)
    return SCRATCH if _scratch_ok() else os.path.join(WHERE.home, ROOT_NAME)


def _roots():
    """[(folder, the names made there, whether one no task records may go)]: root(), then where older copies made
    them. One no task records goes only from a folder Shepherdr names, never from an install of its own's
    <SHEPHERDR_HOME>/cache/tmp, which could be someone's ~/cache/tmp."""
    out = [(root(), NAME, True)]
    if os.environ.get("HERDR_TASK_STORE"):
        return out
    cache = os.path.join(WHERE.roots["cache"], "tmp")
    old = [] if _own_install() else [(os.path.join(WHERE.home, ROOT_NAME), NAME, True)]
    old.append((cache, OLD_NAME, os.path.basename(os.path.dirname(cache)) == "shepherdr"))
    return out + [o for o in old if all(os.path.abspath(o[0]) != os.path.abspath(b) for b, _, _ in out)]


def roots():
    """The folders task temp folders are in (review_sandbox.py's)."""
    return [b for b, _, _ in _roots()]


def _ours(p):
    """Only a real folder right inside one of _roots(), with a name made there, is ever locked for removal or removed:
    never a link, never anything a task record points elsewhere."""
    if not p or os.path.islink(p) or not os.path.isdir(p):
        return False
    d, n = os.path.split(os.path.abspath(p))
    return any(d == os.path.abspath(b) and name.match(n) and os.path.dirname(os.path.realpath(p)) == os.path.realpath(b)
               for b, name, _ in _roots())


def _make_root(r):
    """The root, owner-only and this user's; a new one tagged so backup tools skip it, as layout.py tags the cache."""
    os.makedirs(os.path.dirname(r), exist_ok=True)
    try:
        os.mkdir(r, 0o700)
        with open(os.path.join(r, "CACHEDIR.TAG"), "w") as f:
            f.write("Signature: 8a477f597d28d172789f06886806bc55\n"
                    "# Shepherdr's task temp folders: Shepherdr removes them, backups skip them.\n")
    except FileExistsError:
        pass
    st = os.lstat(r)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
        raise OSError(f"{r} isn't this user's own folder")
    if stat.S_IMODE(st.st_mode) != 0o700:
        os.chmod(r, 0o700)


def _new(r):
    """A new folder in r with a random name: mkdir either makes it or fails, so two starts never share one."""
    for _ in range(100):
        p = os.path.join(r, "".join(secrets.choice(_B36) for _ in range(6)))
        try:
            os.mkdir(p, 0o700)
        except FileExistsError:
            continue
        os.chmod(p, 0o700)
        return p
    raise OSError(f"no free name in {r}")


def hold(p):
    """An open descriptor holding the folder's shared lock, for what a process starts to inherit (link.py's jobs), or
    None: not a task's folder (_ours()), or being removed (_drop() holds it)."""
    if not _ours(p):
        return None
    try:
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
    except OSError:
        return None
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        return fd
    except OSError:
        os.close(fd)
        return None


def _claim(p):
    """Whether the task's recorded folder can be its folder again: not being removed, still the same folder, and
    touched now, so the sweep's grace keeps it until what starts takes its own lock."""
    fd = hold(p)
    if fd is None:
        return False
    try:
        if not os.path.samestat(os.fstat(fd), os.stat(p)):
            return False
        os.utime(p)
        return True
    except OSError:
        return False
    finally:
        os.close(fd)


def ensure(s, task):
    """The task's temp folder, made or kept, and recorded on it. None when it can't be made: the agent then starts
    with the machine's own temp folder, as before (a temp folder never stops a start)."""
    try:
        r, p = root(), task.get("tmp")
        if not (p and os.path.dirname(p) == r and _ours(p) and _claim(p)):
            if p and os.path.dirname(p) != r and _ours(p):
                task["tmp_old"] = p  # an older copy's place: drained there once nothing uses it
                s.dirty = True
            _make_root(r)
            p = _new(r)
            with open(os.path.join(p, KEY_FILE), "w") as f:
                f.write(s.key(task))
    except Exception:
        return None
    if task.get("tmp") != p:
        task["tmp"] = p
        s.dirty = True
    return p


def env_for(path):
    """VAR=value words for `env`: the folder as TMPDIR, TMP and TEMP."""
    return [f"{v}={path}" for v in VARS] if path else []


def take_argv(path, argv):
    """argv run holding the folder's lock (TAKE), for as long as it, or anything it starts that keeps descriptor 9,
    runs."""
    return ["sh", "-c", TAKE + '; shift; exec "$@"', "herdr-tmp", path, *argv] if path else argv


def _boot_time():
    """When this machine started (Linux), 0 when unknown: an older shell's mark from before it names a reused pid."""
    try:
        with open("/proc/stat") as f:
            return float(next((ln.split()[1] for ln in f if ln.startswith("btime ")), 0))
    except (OSError, ValueError):
        return 0.0


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:  # someone else's: alive
        pass
    return True


def _marked(p):
    """An older web-app shell still lives there: its .shell-<pid> mark, made since this boot, names a live process."""
    try:
        pids = {n: int(n[len(SHELL_MARK):]) for n in os.listdir(p) if re.match(r"\.shell-\d+$", n)}
        boot = _boot_time() if pids else 0
        return any(os.lstat(os.path.join(p, n)).st_mtime >= boot - 1 and _alive(pid) for n, pid in pids.items())
    except OSError:
        return True  # can't be told: in use


def in_use(key, p):
    """Whether something that may not hold the lock uses the folder: an older web-app shell's mark, or a live terminal
    of the task (its agents, their helpers). When herdr-core can't say, it is in use."""
    if _marked(p):
        return True
    if not key:
        return False
    d = hc_json("ls", "--label", f"herdr.task={key}")
    return d is None or any(k.get("state") == "live" for k in d.get("terminals") or [])


def _drop(key, p, grace=0, since=0):
    """Removes a folder of ours that nothing uses: its lock taken exclusively (no holder, and no start can take it
    meanwhile), nothing of the task live, and untouched for grace seconds since its last start (or since). True when
    it is gone, or not ours to remove (a record pointing elsewhere: only forgotten)."""
    if not os.path.lexists(p) or not _ours(p):
        return True
    try:
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if time.time() - max(os.fstat(fd).st_mtime, since) < grace or in_use(key, p):
            return False
        shutil.rmtree(p, ignore_errors=True)
    except OSError:
        return False
    finally:
        os.close(fd)
    return not os.path.lexists(p)


def remove(s, task):
    """Removes the task's temp folders (its records too), unless something still uses them: the sweep takes them once
    nothing does. True when they are gone."""
    key, left = s.key(task), False
    for f in ("tmp", "tmp_old"):
        if task.get(f) and _drop(key, task[f]):
            task.pop(f)
            s.dirty = True
        left = left or bool(task.get(f))
    return not left


def sweep(report=None, force=False):
    """Removes this machine's task temp folders whose task is Done or gone and that nothing uses (module docstring).
    Cheap: a listing of each root and the task lists, at most every SWEEP_EVERY_S unless forced, and herdr-core asked
    only about a folder that may go. Returns the names removed."""
    global _swept
    if not force and time.time() - _swept < SWEEP_EVERY_S:
        return []
    _swept = time.time()
    found = []
    for base, name, strays in _roots():
        try:
            found += [(os.path.join(base, n), strays) for n in os.listdir(base) if name.match(n)]
        except OSError:
            continue
    if not found:
        return []
    from .store import read_list
    rec, unsure = {}, False  # folder: (its task's key, whether it may go, since when)
    try:
        lists = [os.path.join(STORE, f) for f in os.listdir(STORE) if f.endswith(".json")]
    except OSError:
        return []
    for p in lists:
        d = read_list(p)
        unsure = unsure or d is None  # a file that can't be read now (a list, or a sidecar): could record any folder
        if not isinstance(d, dict):
            continue
        slug = d.get("slug") or os.path.basename(p)[:-5]
        for t in d.get("tasks") or []:
            if isinstance(t, dict):
                key = f"{slug}#{t.get('id')}"
                if t.get("tmp"):
                    rec[os.path.abspath(t["tmp"])] = (key, t.get("state") == "done", (t.get("done_at") or 0) / 1000)
                if t.get("tmp_old"):
                    rec[os.path.abspath(t["tmp_old"])] = (key, True, 0)
    gone = []
    for p, strays in found:
        key, may, since = rec.get(os.path.abspath(p), (None, strays and not unsure, 0))
        if key is None:
            try:
                with open(os.path.join(p, KEY_FILE)) as f:
                    key = f.read(200).strip() or None
            except OSError:
                pass
        if may and _ours(p) and _drop(key, p, GRACE_S, since):
            gone.append(os.path.basename(p))
    if gone and report is not None:
        report.setdefault("tmp_removed", []).extend(gone)
    return gone


def pressed():
    """A sweep now for a start held on a full disk (queues.machine_hold()), at most every PRESSED_EVERY_S on this
    machine (a stamp beside the task lists, and this process's own when a full disk can't take the stamp): the names
    removed."""
    global _pressed
    stamp = os.path.join(STORE, ".tmp-swept")
    try:
        last = os.path.getmtime(stamp)
    except OSError:
        last = 0
    if time.time() - max(last, _pressed) < PRESSED_EVERY_S:
        return []
    _pressed = time.time()
    try:
        open(stamp, "a").close()
        os.utime(stamp)
    except OSError:
        pass
    return sweep(force=True)


def cmd_task_tmp(args):
    """`herdr-task _task-tmp <id>`: the task's temp folder, made and recorded now, as JSON ({"tmp": path or null}).
    The web app asks when the person opens a task's terminal (service/shells.ts)."""
    import json
    from .store import locate, Store
    with Store(locate(args.folder)) as s:
        print(json.dumps({"tmp": ensure(s, s.find(args.id))}))
    return 0
