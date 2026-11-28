"""A throwaway world for fork/bin/sync's git and GitHub steps (imported after home_guard by the tests that use it):
two bare repos standing in for upstream and the fork on GitHub, reached through their real github.com URLs by
`insteadOf` rules, a space clone with the run's worktree, and fakes for `gh` and `herdr-task` first on PATH.

The fake gh answers from a JSON file the test writes (pull requests, check runs) and logs every call; `pr merge`
really merges in the bare fork (a merge commit, or a squash when the test asks), so the verification runs on real
commits. Nothing reaches GitHub, hc or the live session."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import state  # noqa: E402

SYNC = os.path.join(ROOT, "fork", "bin", "sync")
FORK_URL = "https://github.com/dmalis/shepherdr.git"
UPSTREAM_URL = "https://github.com/eliasstravik/shepherdr.git"
IDENT = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "T",
         "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}
os.environ.update(IDENT)

FAKE_GH = r'''
import json, os, subprocess, sys, tempfile
cfg_path = os.environ["FAKE_GH"]
cfg = json.load(open(cfg_path))
a = sys.argv[1:]
with open(cfg["log"], "a") as f:
    f.write(json.dumps(a) + "\n")

def save():
    json.dump(cfg, open(cfg_path, "w"))

def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()

if a[:3] == ["repo", "set-default", "--view"]:
    print(cfg.get("default", "dmalis/shepherdr")); sys.exit(0)
if a[:2] == ["pr", "view"]:
    assert a[3] == "-R" and a[4] == "dmalis/shepherdr", a
    pr = cfg["prs"].get(a[2])
    if pr is None:
        sys.exit("no pull request")
    print(json.dumps(pr)); sys.exit(0)
if a[:2] == ["pr", "merge"]:
    assert a[3] == "-R" and a[4] == "dmalis/shepherdr" and "--merge" in a, a
    pr = cfg["prs"][a[2]]
    head = a[a.index("--match-head-commit") + 1]
    how = cfg.get("merge", "merge")
    if how == "fail" or head != pr["headRefOid"] or pr["state"] != "OPEN":
        sys.exit("refused")
    w = tempfile.mkdtemp()
    git("clone", "-q", cfg["origin"], w)
    git("checkout", "-q", "main", cwd=w)
    if how == "squash":
        git("merge", "-q", "--squash", head, cwd=w)
        git("commit", "-q", "-m", "squashed", cwd=w)
    else:
        git("merge", "-q", "--no-ff", "--no-edit", head, cwd=w)
    sha = git("rev-parse", "HEAD", cwd=w)
    git("push", "-q", "origin", "main", cwd=w)
    pr.update(state="MERGED", mergeCommit={"oid": sha})
    save(); sys.exit(0)
if a[:1] == ["api"] and a[1].startswith("repos/dmalis/shepherdr/actions/runs?"):
    # main's workflow runs, newest commit first, from the same `checks` the commits' check runs come from
    if cfg.get("checks_unread"):
        sys.exit("HTTP 502")
    if cfg.get("rate_limited"):
        sys.exit("HTTP 403: API rate limit exceeded for user ID 1.")
    checks = cfg.get("checks", {})
    commits = git("rev-list", "main", cwd=cfg["origin"]).split()
    files = {"check": ".github/workflows/check.yml", "fork-check": ".github/workflows/fork-check.yml"}
    out = []
    for sha in commits + [k for k in checks if k != "*" and k not in commits]:
        for r in checks.get(sha, checks.get("*", [])):
            if r.get("name") in files:
                out.append({"head_sha": sha, "path": files[r["name"]], "name": r["name"].title(),
                            "status": r.get("status"), "conclusion": r.get("conclusion")})
    print(json.dumps({"total_count": len(out), "workflow_runs": out[:100]})); sys.exit(0)
if a[:2] == ["api", "rate_limit"]:
    # free against the limit: when it resets
    print(json.dumps({"resources": {"core": {"remaining": 0, "reset": cfg.get("rate_limited") or 0}}})); sys.exit(0)
if a[:1] == ["api"]:
    path = a[1]
    prefix = "repos/dmalis/shepherdr/commits/"
    assert path.startswith(prefix), path
    sha = path[len(prefix):].split("/")[0]
    if cfg.get("checks_unread"):
        sys.exit("HTTP 502")
    if cfg.get("advance_on_checks") == sha:
        # another task's merge lands on main while these checks are read (once)
        w = tempfile.mkdtemp()
        git("clone", "-q", cfg["origin"], w)
        open(os.path.join(w, "moved.txt"), "w").write("moved\n")
        git("add", "moved.txt", cwd=w)
        git("commit", "-q", "-m", "another merge", cwd=w)
        git("push", "-q", "origin", "main", cwd=w)
        cfg["advance_on_checks"] = None
        save()
    runs = cfg.get("checks", {}).get(sha, cfg.get("checks", {}).get("*", []))
    print(json.dumps({"total_count": len(runs), "check_runs": runs})); sys.exit(0)
sys.exit("fake gh: no " + " ".join(a))
'''

FAKE_HERDR_TASK = r'''
import json, os, sys
a = sys.argv[1:]
tasks = json.load(open(os.environ["FAKE_HT"]))
if a[:1] == ["show"]:
    t = tasks.get(a[1])
    if t is None:
        sys.exit("No task " + a[1])
    print(json.dumps(t)); sys.exit(0)
sys.exit("fake herdr-task: no " + " ".join(a))
'''

GREEN = [{"name": "check", "status": "completed", "conclusion": "success"},
         {"name": "fork-check", "status": "completed", "conclusion": "success"}]


def git(cwd, *args, ok=True):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)
    if ok and r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {r.stderr}")
    return r.stdout.strip()


class World(unittest.TestCase):
    """Upstream with releases v3.2.20 and v3.2.21 (annotated) on its main; the fork's main is v3.2.21 plus one commit
    of ours; the space is a clone of the fork with both remotes named by their GitHub URLs; the run works in a
    worktree of it (`self.wt`) and owns the lease."""
    RUN = "SYNC-1"

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fork-world-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        os.makedirs(self.root)
        self.p = state.Paths(self.root)
        self.up = os.path.join(self.tmp, "upstream.git")
        self.origin = os.path.join(self.tmp, "origin.git")
        self.dev = os.path.join(self.tmp, "dev")       # where upstream's maintainer works
        for bare in (self.up, self.origin):
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", bare], check=True)
        subprocess.run(["git", "init", "-q", "-b", "main", self.dev], check=True)
        git(self.dev, "remote", "add", "origin", self.up)
        self.write(self.dev, "a.txt", "one\n")
        self.write(self.dev, "docs/guide.md", "guide\n")
        self.v20 = self.commit(self.dev, "3.2.20")
        git(self.dev, "tag", "-a", "-m", "v3.2.20", "v3.2.20")
        self.write(self.dev, "b.txt", "b\n")
        self.v21 = self.commit(self.dev, "3.2.21")
        git(self.dev, "tag", "-a", "-m", "v3.2.21", "v3.2.21")
        git(self.dev, "push", "-q", "origin", "main", "--tags")
        # the fork: v3.2.21 plus a patch of ours that changes the line upstream changes next
        self.ours = os.path.join(self.tmp, "ours")
        subprocess.run(["git", "clone", "-q", self.up, self.ours], check=True, capture_output=True)
        git(self.ours, "remote", "set-url", "origin", self.origin)
        self.write(self.ours, "a.txt", "one, ours\n")
        self.write(self.ours, "fork/ours.py", "print('ours')\n")
        self.main0 = self.commit(self.ours, "our patch")
        git(self.ours, "push", "-q", "origin", "main")
        # the space, as a sync run sees it
        self.space = os.path.join(self.tmp, "space")
        subprocess.run(["git", "clone", "-q", "--no-tags", self.origin, self.space], check=True, capture_output=True)
        git(self.space, "remote", "set-url", "origin", FORK_URL)
        git(self.space, "remote", "add", "upstream", UPSTREAM_URL)
        git(self.space, "config", f"url.{self.origin}.insteadOf", FORK_URL)
        git(self.space, "config", f"url.{self.up}.insteadOf", UPSTREAM_URL)
        self.wt = os.path.join(self.tmp, "wt")
        git(self.space, "worktree", "add", "-q", "-b", "task/sync-1", self.wt, "main")
        self.start = git(self.wt, "rev-parse", "HEAD")
        # fakes
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        self.gh_cfg = os.path.join(self.tmp, "gh.json")
        self.gh_log = os.path.join(self.tmp, "gh.log")
        self.ht = os.path.join(self.tmp, "ht.json")
        self.set_gh(prs={}, checks={"*": GREEN})
        self.set_ht({self.RUN: {"state": "running"}})
        self.fake("gh", FAKE_GH)
        self.fake("herdr-task", FAKE_HERDR_TASK)
        os.makedirs(os.path.dirname(self.p.config), exist_ok=True)
        with open(self.p.config, "w") as f:
            json.dump({"hostname": "box-under-test", "install_folder": "/nowhere", "time_zone": "UTC"}, f)
        with state.locked(self.p) as st:
            state.take_lease(st, self.RUN, self.space, owner=lambda *a: "done")
            st["baseline"] = {"sha": self.v21}

    # --- building history ---
    def write(self, repo, path, text):
        full = os.path.join(repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)
        git(repo, "add", path)

    def commit(self, repo, words):
        git(repo, "commit", "-q", "--allow-empty", "-m", words)
        return git(repo, "rev-parse", "HEAD")

    def upstream_release(self, tag, path="a.txt", text="two\n", annotated=True):
        self.write(self.dev, path, text)
        sha = self.commit(self.dev, tag)
        git(self.dev, "tag", *(["-a", "-m", tag] if annotated else []), tag)
        git(self.dev, "push", "-q", "origin", "main", tag)
        return sha

    def upstream_commit(self, words="unreleased"):
        self.write(self.dev, "c.txt", words + "\n")
        sha = self.commit(self.dev, words)
        git(self.dev, "push", "-q", "origin", "main")
        return sha

    def our_merge(self, path="fork/more.py", text="more\n"):
        """Another task merged into the fork's main."""
        git(self.ours, "pull", "-q", "--no-rebase", "origin", "main")
        self.write(self.ours, path, text)
        sha = self.commit(self.ours, "another patch")
        git(self.ours, "push", "-q", "origin", "main")
        return sha

    def sync_branch(self, tag, rel):
        """The run takes the release as the skill says: a merge from the pinned origin/main, its conflict resolved,
        an adaptation after it; pushed as sync/<tag>. Returns (merge commit, head)."""
        git(self.wt, "fetch", "-q", "origin")
        git(self.wt, "reset", "-q", "--hard", "origin/main")
        git(self.wt, "merge", "--no-ff", "--no-edit", rel, ok=False)    # conflicts in a.txt
        self.write(self.wt, "a.txt", "two, ours\n")
        git(self.wt, "commit", "-q", "--no-edit")
        merge = git(self.wt, "rev-parse", "HEAD")
        self.write(self.wt, "fork/ours.py", "print('ours, adapted')\n")
        head = self.commit(self.wt, "adapt our patch")
        git(self.wt, "push", "-q", "origin", f"HEAD:refs/heads/sync/{tag}")
        return merge, head

    # --- fakes ---
    def fake(self, name, body):
        path = os.path.join(self.bin, name)
        with open(path, "w") as f:
            f.write("#!" + sys.executable + "\n" + body)
        os.chmod(path, 0o755)

    def set_gh(self, **kw):
        cfg = self.gh() if os.path.exists(self.gh_cfg) else {"log": self.gh_log, "origin": self.origin}
        cfg.update(kw)
        with open(self.gh_cfg, "w") as f:
            json.dump(cfg, f)

    def gh(self):
        with open(self.gh_cfg) as f:
            return json.load(f)

    def gh_calls(self):
        if not os.path.exists(self.gh_log):
            return []
        with open(self.gh_log) as f:
            return [json.loads(x) for x in f]

    def set_ht(self, tasks):
        with open(self.ht, "w") as f:
            json.dump(tasks, f)

    def env(self, extra=None):
        e = {k: v for k, v in os.environ.items() if k != "HERDR_GUARD_SESSION"}
        e.update(PATH=self.bin + os.pathsep + e["PATH"], FAKE_GH=self.gh_cfg, FAKE_HT=self.ht,
                 FORK_SYNC_POLL_S="0", FORK_SYNC_CALL_WAIT_S="0", FORK_SYNC_CI_POLL_S="0")
        e.update(extra or {})
        return e

    def sync(self, *args, run=None, env=None, stdin=None, paths_ok=False):
        """fork/bin/sync as the run's agent calls it, from its worktree. Returns (exit code, its one JSON line).
        paths_ok: the line may name files in the scratch world (review-inputs' files, which a real run's home
        shows as ~/…)."""
        argv = [sys.executable, SYNC, *args, "--root", self.root]
        if args and args[0] in ("preflight", "select", "review-inputs", "merge", "finish", "settle", "ci"):
            argv += ["--run", run or self.RUN, "--folder", self.space]
        r = subprocess.run(argv, capture_output=True, text=True, env=self.env(env), cwd=self.wt, timeout=120,
                           input=stdin)
        lines = r.stdout.splitlines()
        self.assertEqual(len(lines), 1, f"one JSON line: {r.stdout!r} {r.stderr!r}")
        out = json.loads(lines[0])
        self.assertEqual(out["ok"], r.returncode == 0, out)
        if not paths_ok:
            self.assertNotIn(self.tmp, lines[0], "no scratch (home) path in the line")
        return r.returncode, out

    def st(self):
        return state.load(self.p)

    def edit(self, **kw):
        with state.locked(self.p) as st:
            st.update(kw)
