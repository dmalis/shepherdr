"""The sync run's private record on the serving machine (fork/specs/sync-pipeline.md, "Where things live").

- `state.json` in `~/.local/state/shepherdr-fork/sync/`, written atomically: a temp file beside it, fsynced, then
  renamed over it. A run that dies mid-write leaves the last whole state, never half of one.
- One `flock` on the `lock` file beside it around every read and write (`locked()`), so two runs never interleave.
- The lease: which run owns the pipeline. Another run's lease holds while `herdr-task show <its key> --json` says
  that task isn't done; a done or missing owner is taken over.
- The phase, written before each step acts, so a run that dies is resumed there, never repeated blindly.
- The held records, one per blocker, and the quarantine.

The pipeline config (`~/.config/shepherdr-fork/sync.json`, written once by the person's Assistant) holds facts about
the machine: `hostname`, `install_folder`, `time_zone`. Neither file ever goes in the repo.

Every path hangs off one root, the home unless `--root` names a scratch one (the rehearsal and tests)."""
import contextlib
import json
import os
import re
import socket
import subprocess
import tempfile
import time

VERSION = 1
REPO = "dmalis/shepherdr"
LOCK_WAIT_S = 60

# selected → branch-pushed → tried → merged → installing → installed → healthy, with side exits held,
# rolling-back → rolled-back, and broken. A run ends on a final phase; any other is resumed by the next run.
PHASES = ("selected", "branch-pushed", "tried", "merged", "installing", "installed", "healthy",
          "held", "rolling-back", "rolled-back", "broken")
FINAL = ("healthy", "rolled-back", "held")
# Once the install folder may have moved, the run must finish what it began: no new selection, no hold.
MOVING = ("installing", "installed", "rolling-back", "broken")
_BEFORE_MOVING = (None, "selected", "branch-pushed", "tried", "merged", "healthy", "held", "rolled-back")
# Which phases each phase may follow. Writing the phase a run is already in is always allowed (a resume).
AFTER = {
    "selected": _BEFORE_MOVING,
    "held": _BEFORE_MOVING,
    "branch-pushed": ("selected",),
    "tried": ("selected", "branch-pushed"),
    "merged": ("tried",),
    "installing": ("tried", "merged"),
    "installed": ("installing",),
    "healthy": ("installed",),
    "rolling-back": ("installing", "installed"),
    "rolled-back": ("rolling-back",),
    "broken": ("installing", "installed", "rolling-back"),
}

HELD_KINDS = ("conflict", "draft", "trial", "gate", "install", "hooks", "permission", "pipeline")
QUESTION_AFTER_S = 24 * 3600
QUESTION_ASKS = 2   # asked once, and once more if the asking run ended without an answer, never more

TAG = re.compile(r"^v\d+\.\d+\.\d+$")
SHA = re.compile(r"^[0-9a-f]{40}$")


class Refused(Exception):
    """A step that can't pass. `fields` go into its JSON line (an `outcome`, a `kind`)."""

    def __init__(self, why, **fields):
        super().__init__(why)
        self.why = why
        self.fields = fields


class Paths:
    def __init__(self, root=None):
        self.home = os.path.abspath(os.path.expanduser(root or "~"))
        self.config = os.path.join(self.home, ".config", "shepherdr-fork", "sync.json")
        self.dir = os.path.join(self.home, ".local", "state", "shepherdr-fork", "sync")
        self.state = os.path.join(self.dir, "state.json")
        self.lock = os.path.join(self.dir, "lock")

    def show(self, path):
        """A path as a person reads it: `~/…` for one in the home, so no home path reaches a message."""
        rel = os.path.relpath(path, self.home)
        return path if rel.startswith("..") else "~/" + rel


def stamp(now=None):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() if now is None else now))


def parse_stamp(s):
    import calendar
    return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ"))


def fresh():
    return {
        "version": VERSION,
        "phase": None, "phase_at": None,
        "lease": None,            # {run, folder, at}
        "baseline": None,         # the last commit proven healthy here: {sha, version, source, ...}
        "candidate": None,        # the exact SHA this run tries and installs
        "release": None,          # {tag, sha} the run is taking
        "quarantine": [],         # [{sha, step, at}]
        "held": [],               # one record per blocker (fork/specs/sync-pipeline.md, "Held runs")
        "issue_cursor": None,
        "rehearsals": [],
        "pending": None,
        "installs": [],
        # build task 3 (fork/sync/release.py, gate.py):
        "run": None,              # this run's own record: {key, folder, path, start, at, merged, held, finished}
        "main": None,             # origin/main's SHA, pinned when the run selected
        "in_main": None,          # {tag, sha}: the newest release origin/main holds, proven its ancestor
        "sync": None,             # the sync branch: {branch, head, merge, at, main_before, pr}
        "trials": [],             # [{sha, tree, at}]: fork/bin/trial passed on that commit
        "checks": [],             # [{sha, at}]: main's checks passed on that commit (fork/sync/gate.py)
        "waits": {},              # {what: stamp}: when a gate first waited on checks still running
        # build task 4 (fork/sync/install.py):
        "install": None,          # the install under way: {sha, version, baseline, before, ask, update, health, ...}
        "rollback": None,         # the rollback under way: {sha, from, ask, update, health, failed}
    }


# --- reading and writing ---

def load(p):
    """The state, or a fresh one when there is none yet. One that can't be read is a stop: never overwritten."""
    try:
        with open(p.state, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return fresh()
    except (OSError, ValueError) as e:
        raise Refused(f"the sync state ({p.show(p.state)}) can't be read ({type(e).__name__}); nothing was changed",
                      outcome="stop")
    if not isinstance(data, dict):
        raise Refused(f"the sync state ({p.show(p.state)}) isn't a JSON object; nothing was changed", outcome="stop")
    if int(data.get("version") or 0) > VERSION:
        raise Refused(f"the sync state was written by a newer pipeline (version {data.get('version')}); "
                      "nothing was changed", outcome="stop")
    for k, v in fresh().items():
        data.setdefault(k, v)
    return data


def save(p, data):
    """Atomically: a temp file in the same folder, flushed to disk, then renamed over state.json."""
    os.makedirs(p.dir, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.dir, prefix=".state.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, sort_keys=True)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, p.state)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    with contextlib.suppress(OSError):
        d = os.open(p.dir, os.O_RDONLY)
        try:
            os.fsync(d)
        finally:
            os.close(d)


@contextlib.contextmanager
def locked(p, wait=LOCK_WAIT_S):
    """Holds the flock while the caller reads and changes the state; saves it on a clean exit if it changed. An
    exception leaves the state as it was: a step that fails writes nothing it didn't save itself."""
    import fcntl
    os.makedirs(p.dir, mode=0o700, exist_ok=True)
    fd = os.open(p.lock, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        deadline = time.monotonic() + wait
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Refused(f"another sync call kept the state locked for {wait} s; try again", outcome="stop")
                time.sleep(0.05)
        data = load(p)
        before = json.dumps(data, sort_keys=True)
        yield data
        if json.dumps(data, sort_keys=True) != before:
            save(p, data)
    finally:
        os.close(fd)   # lets go of the flock


def config(p):
    try:
        with open(p.config, encoding="utf-8") as f:
            cfg = json.load(f)
    except FileNotFoundError:
        raise Refused(f"no pipeline config at {p.show(p.config)}: the person's Assistant writes it once", outcome="stop")
    except (OSError, ValueError) as e:
        raise Refused(f"the pipeline config ({p.show(p.config)}) can't be read ({type(e).__name__})", outcome="stop")
    missing = [k for k in ("hostname", "install_folder", "time_zone") if not (isinstance(cfg, dict) and cfg.get(k))]
    if missing:
        raise Refused(f"the pipeline config lacks {', '.join(missing)}", outcome="stop")
    return cfg


def check_machine(cfg, hostname=None):
    """This machine is the config's machine (its hostname). The words never name either host."""
    if (hostname or socket.gethostname()) != cfg["hostname"]:
        raise Refused("this isn't the machine the pipeline config names; nothing was written", outcome="stop")


# --- phases ---

def set_phase(st, phase, now=None):
    if phase not in PHASES:
        raise ValueError(f"no phase {phase!r}")
    cur = st.get("phase")
    if phase != cur and cur not in AFTER[phase]:
        raise Refused(f"phase {cur or 'none'} can't go to {phase}", outcome="stop")
    st["phase"] = phase
    st["phase_at"] = stamp(now)


def resume_point(st):
    """The phase a run picks up at, or None when the last run finished."""
    ph = st.get("phase")
    return ph if ph and ph not in FINAL else None


# --- the lease ---

def task_state(run, folder):
    """'open', 'done', 'missing' or 'unknown', from `herdr-task show <run> --folder <folder> --json`."""
    try:
        r = subprocess.run(["herdr-task", "show", run, "--folder", folder, "--json"],
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    if r.returncode != 0:
        return "missing" if "No task" in (r.stdout + r.stderr) else "unknown"
    try:
        t = json.loads(r.stdout)
    except ValueError:
        return "unknown"
    if not isinstance(t, dict) or not t.get("state"):
        return "unknown"
    return "done" if t["state"] == "done" else "open"


def take_lease(st, run, folder, owner=task_state, now=None):
    """The run takes the lease. Another run's holds while that task is open (or can't be read: never a guess);
    a done or missing owner is taken over, and the caller resumes its unfinished phase. Returns who was taken over
    from, or None."""
    if not run or not folder:
        raise Refused("a run is named by its task key and space folder", outcome="stop")
    cur = st.get("lease")
    took = None
    if cur and (cur.get("run"), cur.get("folder")) != (run, folder):
        seen = owner(cur.get("run"), cur.get("folder"))
        if seen == "open":
            raise Refused(f"run {cur.get('run')} owns the lease and is still open", outcome="nothing")
        if seen not in ("done", "missing"):
            raise Refused(f"run {cur.get('run')} owns the lease and whether it is done can't be read", outcome="nothing")
        took = {"run": cur.get("run"), "was": seen}
    if not cur or took:
        st["lease"] = {"run": run, "folder": folder, "at": stamp(now)}
    return took


def adopt_run(st, run, folder, start=None):
    """A run that took the lease over resumes the selection it found there (Serialised runs): from now on the run
    record is this run's, with this run's own worktree start. What the earlier run recorded stays (its path, merge,
    sync branch and the run whose review rounds cover the head). A finished phase has nothing to resume."""
    r = st.get("run")
    if not r or r.get("key") == run or not resume_point(st):
        return None
    st["run"] = {**{k: v for k, v in r.items() if k != "finished"}, "key": run, "folder": folder, "start": start,
                 "took_from": r.get("key")}
    return r.get("key")


def owns_lease(st, run, folder):
    cur = st.get("lease") or {}
    if (cur.get("run"), cur.get("folder")) != (run, folder):
        raise Refused(f"run {run} doesn't own the lease" + (f" ({cur.get('run')} does)" if cur.get("run") else ""),
                      outcome="stop")


def release_lease(st, run, folder):
    """At the end of a run whose phase is final. Never on installing, rolling-back or broken."""
    owns_lease(st, run, folder)
    if resume_point(st):
        raise Refused(f"the lease stays while the phase is {st['phase']}", outcome="stop")
    st["lease"] = None


# --- quarantine ---

def quarantined(st, sha):
    return next((q for q in st.get("quarantine") or [] if q.get("sha") == sha), None)


def quarantine(st, sha, step, now=None):
    if not SHA.match(sha or ""):
        raise Refused("a quarantined commit is named by its full SHA", outcome="stop")
    if not quarantined(st, sha):
        st.setdefault("quarantine", []).append({"sha": sha, "step": step, "at": stamp(now)})


# --- what passed on which commit ---

KEEP = 50   # the newest records of each kind


def record_trial(st, sha, tree, now=None):
    """fork/bin/trial passed on this commit, whose tree is `tree`. Only the trial writes this. When the commit is
    the one the run is trying (its sync head, or its candidate), the run's phase moves on to `tried`."""
    if not SHA.match(sha or "") or not SHA.match(tree or ""):
        raise Refused("a trial is recorded by its commit's and tree's full SHAs", outcome="stop")
    st["trials"] = [t for t in st.get("trials") or [] if t.get("sha") != sha][-(KEEP - 1):] + [
        {"sha": sha, "tree": tree, "at": stamp(now)}]
    sync = st.get("sync") or {}
    if st.get("phase") in ("selected", "branch-pushed") and sha in (sync.get("head"), st.get("candidate")):
        set_phase(st, "tried", now)


def trial_passed(st, sha):
    return next((t for t in st.get("trials") or [] if t.get("sha") == sha), None)


def record_checks(st, sha, now=None):
    if not checks_passed(st, sha):
        st["checks"] = (st.get("checks") or [])[-(KEEP - 1):] + [{"sha": sha, "at": stamp(now)}]


def checks_passed(st, sha):
    return next((c for c in st.get("checks") or [] if c.get("sha") == sha), None)


def record_rehearsal(st, sha, code_hash, now=None):
    """fork/bin/rehearse passed on this commit, whose pipeline code (fork/bin and fork/sync) hashes to `code_hash`
    (install.pipeline_hash). Only the rehearsal writes this."""
    if not SHA.match(sha or "") or not re.match(r"^[0-9a-f]{64}$", code_hash or ""):
        raise Refused("a rehearsal is recorded by its commit's full SHA and its pipeline code's hash", outcome="stop")
    st["rehearsals"] = [r for r in st.get("rehearsals") or [] if r.get("hash") != code_hash][-(KEEP - 1):] + [
        {"sha": sha, "hash": code_hash, "at": stamp(now)}]


def rehearsal_passed(st, code_hash):
    """A passing rehearsal for this pipeline code: install refuses a candidate without one."""
    return next((r for r in st.get("rehearsals") or [] if r.get("hash") == code_hash), None)


# --- held records ---

def held_record(st, blocker):
    return next((h for h in st.get("held") or [] if h.get("blocker") == blocker), None)


def hold(st, tag, sha, kind, blocker, line="", now=None, **extra):
    """Writes the held record for this blocker. The same blocker holding a newer release moves its record there,
    keeping first_seen and question. Returns (record, new): new is True only the first time this blocker holds."""
    if not TAG.match(tag or "") or not SHA.match(sha or ""):
        raise Refused("a held release is named by its tag vX.Y.Z and full SHA", outcome="stop")
    if kind not in HELD_KINDS:
        raise Refused(f"no held kind {kind!r} (one of {', '.join(HELD_KINDS)})", outcome="stop")
    if not blocker:
        raise Refused("a held record names its blocker (a patch's issue number or a gate's name)", outcome="stop")
    if kind == "draft" and not (extra.get("branch") and extra.get("head")):
        raise Refused("a draft hold names its branch and head", outcome="stop")
    if kind == "conflict" and not extra.get("files"):
        raise Refused("a conflict hold names its conflicted files", outcome="stop")
    rec = held_record(st, blocker)
    new = rec is None
    if new:
        rec = {"blocker": blocker, "first_seen": stamp(now), "question": None, "issue": None}
        st.setdefault("held", []).append(rec)
    rec.update(release={"tag": tag, "sha": sha}, kind=kind, line=line or "",
               branch=extra.get("branch"), pr=extra.get("pr"), head=extra.get("head"),
               files=list(extra.get("files") or []) or None)
    if extra.get("issue") is not None:
        rec["issue"] = extra["issue"]
    return rec, new


def clear_held(st, blocker):
    st["held"] = [h for h in st.get("held") or [] if h.get("blocker") != blocker]


def ask(st, blocker, run, folder, now=None, owner=task_state):
    """Records that this run asks the 24-hour question, before it asks. Only when it is due (question_due); the run
    that asked already asking again changes nothing, so a repeated call never uses up the one retry."""
    rec = held_record(st, blocker)
    if not rec:
        raise Refused(f"no held record for {blocker}", outcome="stop")
    q = rec.get("question") or {}
    if q.get("answer") is not None:
        raise Refused(f"the question for {blocker} was answered already", outcome="stop")
    if q and (q.get("run"), q.get("folder")) == (run, folder):
        return rec
    if not question_due(rec, now=now, owner=owner):
        raise Refused(f"the question for {blocker} isn't due" + (
            f" (asked {q.get('asks')} times already)" if int(q.get("asks") or 0) >= QUESTION_ASKS else ""),
            outcome="stop")
    rec["question"] = {"asked_at": stamp(now), "run": run, "folder": folder, "answer": None,
                       "asks": int(q.get("asks") or 0) + 1}
    return rec


def answer(st, blocker, words):
    rec = held_record(st, blocker)
    if not rec or not rec.get("question"):
        raise Refused(f"no question was asked for {blocker}", outcome="stop")
    rec["question"]["answer"] = words
    return rec


def question_due(rec, now=None, owner=task_state):
    """Whether a run should ask the 24-hour question for this record now: after 24 hours held with none asked, or
    once more when the asking run ended without an answer. Never once answered."""
    q = rec.get("question")
    if q and q.get("answer") is not None:
        return False
    if not q:
        return (time.time() if now is None else now) - parse_stamp(rec["first_seen"]) > QUESTION_AFTER_S
    if int(q.get("asks") or 0) >= QUESTION_ASKS:
        return False
    return owner(q.get("run"), q.get("folder")) in ("done", "missing")


# --- the broken phase ---

def clear_broken(st, env=None):
    """The person's only: clears a `broken` phase and its lease. Refused in a task's terminal (the guard's
    HERDR_GUARD_SESSION is set there), the way `--may-update-shepherdr` is."""
    if (env if env is not None else os.environ).get("HERDR_GUARD_SESSION"):
        raise Refused("only the person can clear a broken sync, from their own terminal: a task's agent can't",
                      outcome="stop")
    if st.get("phase") != "broken":
        raise Refused(f"the phase is {st.get('phase') or 'none'}, not broken: nothing to clear", outcome="stop")
    st["phase"] = None
    st["phase_at"] = stamp()
    st["lease"] = None
