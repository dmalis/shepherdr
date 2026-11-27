"""A throwaway world for install, health and rollback (imported after home_guard by the tests that use it).

- A bare repo stands in for the fork on GitHub (reached by its real URL through an `insteadOf` rule). Its main holds
  the baseline B (version 3.2.21) and the candidate C (3.2.22) on top. Both carry a small Shepherdr: upstream's real
  `bin/shepherdr` (its real VERSION line rewritten, its real set_hooks and HOOKS kept, its `main` swapped for a fake
  doctor), a tiny herdr_task package (base.STORE, scheduler.script_hash, self_update.clean_env, the real layout),
  fork/patches.json.
- A scratch root is the home: Shepherdr is installed under it from the install folder (a clone at B), with the
  agents' hook files written by the real set_hooks, a `.local/bin/shepherdr` link and a scheduler file.
- A fake `herdr-task` first on PATH answers show, auto show, assistants and update-shepherdr. Its update does what
  `shepherdr update` does to what health reads: copies the install folder's HEAD into Shepherdr's folder, writes
  installed.json and the scheduler's hash, as the test asks (ok, failed, landed-then-failed, still running).

Nothing reaches GitHub, hc, the live install or the real home."""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import install, state  # noqa: E402

SYNC = os.path.join(ROOT, "fork", "bin", "sync")
FORK_URL = "https://github.com/dmalis/shepherdr.git"
IDENT = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "T",
         "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}
os.environ.update(IDENT)
SHARE = os.path.join(".local", "share", "shepherdr")

FAKE_DOCTOR = r'''
def main(argv):
    import json as _j, os as _o
    cfg = _j.load(open(_o.environ["FAKE_IW"]))
    with open(cfg["log"], "a") as f:
        f.write(_j.dumps(["doctor", argv, _o.environ.get("SHEPHERDR_KEEP_SYNC_HOLD")]) + "\n")
    return 1 if cfg.get("doctor_fails") else 0


'''

BASE_PY = "import os\nSTORE = os.environ['HERDR_TASK_STORE']\n"
SCHEDULER_PY = ("import hashlib, os\n# version {v}\n\n\ndef script_hash():\n"
                "    return hashlib.sha1(open(os.path.join(os.path.dirname(os.path.realpath(__file__)), "
                "'scheduler.py'), 'rb').read()).hexdigest()\n")
SELF_UPDATE_PY = '''import os


def clean_env(env, store=None):
    e = {k: v for k, v in env.items() if k != "HERDR_GUARD_SESSION"}
    e["PATH"] = ":".join(d for d in (env.get("PATH") or "").split(":") if d and not d.rstrip("/").endswith(".guard/bin"))
    return e
'''

# The fake herdr-task: answers from FAKE_IW's JSON, logs every call.
FAKE_HT = r'''
import json, os, subprocess, sys, time
sys.path.insert(0, os.environ["FAKE_IW_LIB"])
import installworld
path = os.environ["FAKE_IW"]
cfg = json.load(open(path))
a = sys.argv[1:]
with open(cfg["log"], "a") as f:
    f.write(json.dumps(["herdr-task"] + a) + "\n")


def save():
    json.dump(cfg, open(path, "w"))


if a[:1] == ["show"]:
    t = cfg["tasks"].get(a[1])
    if t is None:
        sys.exit("No task " + a[1])
    # the real shape: `key` is the store key, `<folder slug>#<id>` (a test's `"key": None` leaves it out)
    t = {"key": installworld.store_key(a[1]), **t}
    if t["key"] is None:
        del t["key"]
    print(json.dumps(t)); sys.exit(0)
if a[:2] == ["auto", "show"]:
    print(json.dumps(cfg["autos"].get(a[2], {}))); sys.exit(0)
if a[:1] == ["assistants"]:
    rows = cfg["assistants_after"] if "--refresh" in a and cfg.get("assistants_after") is not None else cfg["assistants"]
    print(json.dumps(rows)); sys.exit(0)
if a[:1] == ["update-shepherdr"]:
    key = a[1]
    if "--status" in a:
        if os.environ.get("SHEPHERDR_KEEP_SYNC_HOLD"):
            cfg["status_with_var"] = cfg.get("status_with_var", 0) + 1
            save()
        print(json.dumps(cfg["updates"].get(key) or {})); sys.exit(0)
    if cfg.get("refuse"):
        sys.exit("Refused: only a run of a schedule the person let update Shepherdr can ask for it")
    # what the ask carried and found: the hold variable, and the run's hold already in both files
    holds = [os.path.join(cfg["root"], ".herdr", "sync-hold"),
             os.path.join(cfg["root"], ".local", "state", "shepherdr", "sync-hold")]
    cfg.setdefault("asked_with", []).append({
        "var": os.environ.get("SHEPHERDR_KEEP_SYNC_HOLD"),
        "holds": [open(p).read() if os.path.exists(p) else None for p in holds],
        "head": subprocess.run(["git", "-C", cfg["folder"], "rev-parse", "HEAD"], capture_output=True,
                               text=True).stdout.strip()})
    plan = cfg["plan"].pop(0) if cfg["plan"] else "ok"
    now = int(time.time() * 1000)
    u = {"state": "running", "at": now}
    if plan in ("ok", "landed-failed"):
        installworld.fake_update(cfg)
    if plan == "ok":
        u.update(state="ok", done_at=now + 1, code=0, version=installworld.head_version(cfg["folder"]))
    elif plan in ("failed", "landed-failed"):
        u.update(state="failed", done_at=now + 1, code=1, tail="  NOT DONE: the install isn't whole")
    cfg["updates"][key] = u
    save()
    print("Shepherdr update: " + u["state"]); sys.exit(75 if u["state"] == "running" else 0 if u["state"] == "ok" else 1)
sys.exit("fake herdr-task: no " + " ".join(a))
'''


def git(cwd, *args, ok=True):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)
    if ok and r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {r.stderr}")
    return r.stdout.strip()


def head_version(folder):
    text = git(folder, "show", "HEAD:bin/shepherdr")
    return re.search(r'^VERSION = "([^"]+)"', text, re.M).group(1)


# The toy's own herdr-task: `list --json` answers as the real one does (health's tasks line runs it in a scratch store)
TOY_HT = """#!/usr/bin/env python3
import json, os, sys
if sys.argv[1:2] == ["list"] and os.environ.get("HERDR_TASK_STORE") and not os.environ.get("FAKE_HT_BROKEN"):
    print(json.dumps({"folder": "f", "kind": "folder", "tasks": [], "archived": 0}))
"""


def fake_update(cfg):
    """What `shepherdr update` does to what health reads: Shepherdr's folder replaced with the install folder's HEAD,
    installed.json written whole, the scheduler re-execed on the new code (unless the test keeps it stale), and the
    agents' hook files touched when the test asks."""
    root, folder = cfg["root"], cfg["folder"]
    share = os.path.join(root, SHARE)
    files = {}
    keep = {"installed.json"}
    if os.path.isdir(share):
        for name in os.listdir(share):
            if name not in keep:
                p = os.path.join(share, name)
                shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)
    out = subprocess.run(["git", "-C", folder, "ls-files", "-z"], capture_output=True, text=True, check=True).stdout
    for rel in [x for x in out.split("\0") if x]:
        if rel.startswith("fork/"):
            continue
        data = subprocess.run(["git", "-C", folder, "show", f"HEAD:{rel}"], capture_output=True, check=True).stdout
        dest = os.path.join(share, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        os.chmod(dest, 0o755 if rel.startswith("bin/") else 0o644)
        files[f"{SHARE}/{rel}"] = "x"
    # a built file, not tracked: health skips it
    os.makedirs(os.path.join(share, "web", "dist"), exist_ok=True)
    with open(os.path.join(share, "web", "dist", "index.html"), "w") as f:
        f.write("<html></html>\n")
    files[f"{SHARE}/web/dist/index.html"] = "x"
    files[".config/herdr-core/templates/worker.md"] = "x"
    rec = {"version": head_version(folder), "source": folder, "at": time.strftime("%Y%m%d-%H%M%S"), "root": root,
           "whole": not cfg.get("not_whole"), "files": files, "hooks": [], "links": {}}
    with open(os.path.join(share, "installed.json"), "w") as f:
        json.dump(rec, f)
    if not cfg.get("stale_scheduler"):
        write_scheduler(cfg)
    if cfg.get("touch_hooks"):
        with open(os.path.join(root, ".claude", "settings.json"), "a") as f:
            f.write("\n")


def write_scheduler(cfg):
    share = os.path.join(cfg["root"], SHARE)
    with open(os.path.join(share, "mods", "tasks", "bin", "herdr_task", "scheduler.py"), "rb") as f:
        data = f.read()
    import hashlib
    os.makedirs(cfg["store"], exist_ok=True)
    with open(os.path.join(cfg["store"], ".scheduler.json"), "w") as f:
        json.dump({"pid": 1, "hash": hashlib.sha1(data).hexdigest(), "at": 0}, f)


def toy_shepherdr(version, hook_script="session-note.sh"):
    """Upstream's real installer with its VERSION set and its main a fake doctor: its set_hooks and HOOKS stay real."""
    with open(os.path.join(ROOT, "bin", "shepherdr"), encoding="utf-8") as f:
        text = f.read()
    text = re.sub(r'^VERSION = "[^"]+"', f'VERSION = "{version}"', text, count=1, flags=re.M)
    text = text.replace("hooks/session-note.sh", f"hooks/{hook_script}")
    guard = 'if __name__ == "__main__":'
    assert guard in text
    return text.replace(guard, FAKE_DOCTOR + guard)


def store_key(run):
    """A run's store key, as `herdr-task show --json` gives it and herdr-task sets HERDR_BROWSER_TASK in its terminal:
    `<folder slug>#<id>` (store.py's key()), never the short key (SYNC-1)."""
    return "tmp-fork-install-space#" + run.rsplit("-", 1)[-1]


class World(unittest.TestCase):
    RUN = "SYNC-1"

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fork-install-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        self.p = state.Paths(self.root)
        self.share = os.path.join(self.root, SHARE)
        self.store = os.path.join(self.tmp, "store")
        self.space = os.path.join(self.tmp, "space")
        os.makedirs(self.space)
        self.origin = os.path.join(self.tmp, "origin.git")
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", self.origin], check=True)
        self.dev = os.path.join(self.tmp, "dev")
        subprocess.run(["git", "init", "-q", "-b", "main", self.dev], check=True)
        git(self.dev, "remote", "add", "origin", self.origin)
        self.B = self.toy_commit("3.2.21")
        self.C = self.toy_commit("3.2.22")
        git(self.dev, "push", "-q", "origin", "main")
        # the install folder, in the home: a clone at B on its main branch, as the first run finds it
        self.folder = os.path.join(self.root, "dev", "shepherdr")
        self.clone(self.folder)
        git(self.folder, "checkout", "-q", "-B", "main", self.B)
        # the run's worktree: where the candidate's commits are read, and the tag is pushed from
        self.wt = os.path.join(self.tmp, "wt")
        self.clone(self.wt)
        # fakes
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        self.guard = os.path.join(self.store, ".guard", "bin")
        os.makedirs(self.guard)
        for d, name in ((self.guard, "shepherdr"), (self.bin, "herdr-task")):
            with open(os.path.join(d, name), "w") as f:
                f.write("#!" + sys.executable + "\n" + (FAKE_HT if name == "herdr-task" else "raise SystemExit(9)\n"))
            os.chmod(os.path.join(d, name), 0o755)
        self.iw = os.path.join(self.tmp, "iw.json")
        self.log = os.path.join(self.tmp, "iw.log")
        self.cfg = {"root": self.root, "folder": self.folder, "store": self.store, "log": self.log,
                    "tasks": {self.RUN: {"state": "running", "automation": 7}}, "autos": {"7": {"may_update": True}},
                    "assistants": [{"target": "t1", "route": ""}, {"target": "far/t2", "route": "far"}],
                    "assistants_after": None, "updates": {}, "plan": []}
        self.save_cfg()
        # Shepherdr installed under the root from the install folder at B
        fake_update(self.cfg)
        os.makedirs(os.path.join(self.root, ".local", "bin"), exist_ok=True)
        os.symlink(os.path.join(self.share, "bin", "shepherdr"), os.path.join(self.root, ".local", "bin", "shepherdr"))
        self.write_hooks()
        self.hooks_before = self.read_hooks()
        os.makedirs(os.path.dirname(self.p.config), exist_ok=True)
        with open(self.p.config, "w") as f:
            json.dump({"hostname": socket.gethostname(), "install_folder": self.folder, "time_zone": "UTC"}, f)
        self.env = mock.patch.dict(os.environ, {
            "PATH": os.pathsep.join([self.guard, self.bin, os.path.join(self.root, ".local", "bin"),
                                     os.environ["PATH"]]),
            "FAKE_IW": self.iw, "FAKE_IW_LIB": os.path.dirname(os.path.abspath(__file__)),
            "HERDR_TASK_STORE": self.store, "HERDR_BROWSER_TASK": store_key(self.RUN),
            "FORK_SYNC_SCRATCH_UPDATER": os.path.join(self.bin, "herdr-task"),
            "FORK_SYNC_POLL_S": "0", "FORK_SYNC_CALL_WAIT_S": "0", "FORK_SYNC_UPDATE_POLL_S": "0",
            "FORK_SYNC_HEALTH_WAIT_S": "0"})
        self.env.start()
        self.addCleanup(self.env.stop)
        # the live service's page: no service runs here (test_merged reads the real check against a page of its own)
        self.page = mock.patch.object(install, "service_page", side_effect=lambda s, timeout=5: self.cfg.get("page"))
        self.page.start()
        self.addCleanup(self.page.stop)
        with state.locked(self.p) as st:
            state.take_lease(st, self.RUN, self.space, owner=lambda *a: "done")

    # --- the toy repo ---
    def toy_commit(self, version, hook_script="session-note.sh", patches=True, pipeline=None):
        w = self.dev
        self.put(w, "bin/shepherdr", toy_shepherdr(version, hook_script), 0o755)
        self.put(w, "install.sh", "#!/bin/sh\n")
        self.put(w, "service/main.ts", f"// {version}\n")
        self.put(w, "hooks/session-note.sh", "#!/bin/sh\n")
        pkg = "mods/tasks/bin/herdr_task"
        self.put(w, "mods/tasks/bin/herdr-task", TOY_HT)
        self.put(w, f"{pkg}/__init__.py", "")
        self.put(w, f"{pkg}/base.py", BASE_PY)
        self.put(w, f"{pkg}/scheduler.py", SCHEDULER_PY.format(v=version))
        self.put(w, f"{pkg}/self_update.py", SELF_UPDATE_PY)
        with open(os.path.join(ROOT, pkg, "layout.py"), encoding="utf-8") as f:
            self.put(w, f"{pkg}/layout.py", f.read())       # the real one: where the sync hold goes
        self.put(w, "fork/bin/sync", f"# pipeline {pipeline or 1}\n")
        self.put(w, "fork/sync/state.py", "# state\n")
        if patches:
            self.put(w, "fork/patches.json", json.dumps({"patches": [
                {"issue": 1, "files": ["bin/shepherdr"], "tests": ["fork/tests/test_hold_patch.py"]}]}))
        elif os.path.exists(os.path.join(w, "fork/patches.json")):
            git(w, "rm", "-q", "fork/patches.json")
        git(w, "commit", "-q", "--allow-empty", "-m", version)
        return git(w, "rev-parse", "HEAD")

    def put(self, repo, rel, text, mode=0o644):
        full = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)
        os.chmod(full, mode)
        git(repo, "add", rel)

    def put_share(self, rel, text):
        """A file of the installed Shepherdr changed in place (a spoiled install)."""
        with open(os.path.join(self.share, rel), "w") as f:
            f.write(text)

    def clone(self, dest):
        subprocess.run(["git", "clone", "-q", self.origin, dest], check=True, capture_output=True)
        git(dest, "remote", "set-url", "origin", FORK_URL)
        git(dest, "config", f"url.{self.origin}.insteadOf", FORK_URL)

    def new_candidate(self, version="3.2.23", **kw):
        """Another commit on the fork's main after C."""
        sha = self.toy_commit(version, **kw)
        git(self.dev, "push", "-q", "origin", "main")
        git(self.wt, "fetch", "-q", "origin")
        return sha

    # --- the agents' hook files, written by the real rule ---
    def write_hooks(self):
        for d in (".claude", ".codex"):
            os.makedirs(os.path.join(self.root, d), exist_ok=True)
        mod = types.ModuleType("toy_shepherdr")
        exec(compile(toy_shepherdr("3.2.21"), "toy", "exec"), mod.__dict__)
        root, share = self.root, self.share

        class R:
            dry, notes = False, []

            def p(self, rel):
                return share if rel == mod.SHARE else os.path.join(root, rel)

            def backup(self, rel, move=False):
                return None
        mod.set_hooks(R(), {}, True)

    def read_hooks(self):
        out = {}
        for f in install.HOOK_FILES:
            try:
                with open(os.path.join(self.root, f), "rb") as h:
                    out[f] = h.read()
            except FileNotFoundError:
                out[f] = None
        return out

    # --- the fakes' config ---
    def save_cfg(self):
        with open(self.iw, "w") as f:
            json.dump(self.cfg, f)

    def load_cfg(self):
        with open(self.iw) as f:
            self.cfg = json.load(f)
        return self.cfg

    def set(self, **kw):
        self.load_cfg()
        self.cfg.update(kw)
        self.save_cfg()

    def calls(self, *prefix):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as f:
            rows = [json.loads(x) for x in f]
        return [r for r in rows if r[:len(prefix)] == list(prefix)]

    def asks(self):
        return [c for c in self.calls("herdr-task", "update-shepherdr") if "--status" not in c]

    def holds(self):
        """The two sync hold files' contents (None: not there): ~/.herdr's and the state folder's."""
        out = []
        for p in (os.path.join(self.root, ".herdr", "sync-hold"),
                  os.path.join(self.root, ".local", "state", "shepherdr", "sync-hold")):
            try:
                with open(p) as f:
                    out.append(f.read())
            except OSError:
                out.append(None)
        return out

    # --- state ---
    def ready_to_install(self, sha=None, phase="merged"):
        """The state a run is in once its candidate is tried, merged and main's checks passed, with the baseline
        captured and a rehearsal recorded for the candidate's pipeline code."""
        sha = sha or self.C
        with state.locked(self.p) as st:
            st.update(phase=phase, candidate=sha, release={"tag": "v3.2.21", "sha": self.B},
                      run={"key": self.RUN, "folder": self.space, "path": "take", "start": self.B, "merged": True},
                      baseline={"sha": self.B, "version": "3.2.21"})
            state.record_trial(st, sha, git(self.wt, "rev-parse", f"{sha}^{{tree}}"))
            state.record_checks(st, sha)
            state.record_rehearsal(st, sha, install.pipeline_hash(self.wt, sha))

    def st(self):
        return state.load(self.p)

    def head(self):
        return git(self.folder, "rev-parse", "HEAD")

    # --- calls ---
    def install(self, sha=None, live=True, **kw):
        return install.install(self.p, self.RUN, self.space, self.wt, sha or self.C, live=live, **kw)

    def health(self, sha=None, live=True, **kw):
        return install.health(self.p, self.RUN, self.space, self.wt, sha or self.C, live=live, **kw)

    def rollback(self, live=True, **kw):
        return install.rollback(self.p, self.RUN, self.space, live=live, **kw)

    def baseline(self, capture=False, live=True):
        return install.baseline(self.p, self.RUN, self.space, capture=capture, live=live)

    def sync(self, *args, run=None):
        """fork/bin/sync as a subprocess, with --root (a scratch root: not live). Returns (code, its JSON line)."""
        argv = [sys.executable, SYNC, *args, "--root", self.root, "--run", run or self.RUN, "--folder", self.space]
        r = subprocess.run(argv, capture_output=True, text=True, env=dict(os.environ), cwd=self.wt, timeout=120)
        lines = r.stdout.splitlines()
        self.assertEqual(len(lines), 1, f"one JSON line: {r.stdout!r} {r.stderr!r}")
        out = json.loads(lines[0])
        self.assertEqual(out["ok"], r.returncode == 0, out)
        self.assertNotIn(self.tmp, lines[0], "no scratch (home) path in the line")
        return r.returncode, out
