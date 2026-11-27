"""The sync PR's gates, its one merge route, the reviewer's inputs, main's checks and the run's completion command
(fork/specs/sync-pipeline.md, "Merge and finish").

- `review_inputs`: the reviewer's three diffs for the sync branch, written to files in the run's worktree's git dir;
  the head they cover becomes the state's expected head.
- `merge`: the only way a sync PR merges. Its gates (the pull request, the review round on the exact head, up to
  date, the release's ancestry, the head's checks, the trial) pass or the run is held; then a merge commit pinned to
  the head, verified after, and main's checks on it.
- `main_checks`: `fork-check` always, `check` when upstream's push trigger would run it, on the exact SHA.
- `finish`: the exact `herdr-task ready` command for the run's outcome, after checking the branch is in a state that
  command accepts.

A failed ancestry check says only what it found, never a guess at why. Nothing here repairs main by force."""
import json
import os
import re
import shlex
import subprocess
import time

from . import public, release, state
from .release import git, is_ancestor, rev
from .state import Refused

CHECKS = ("check", "fork-check")       # the check runs a sync PR's head needs
CHECKS_WAIT_S = 30 * 60                 # how long a gate waits on checks still running, from when it first saw them
CHECK_YML = ".github/workflows/check.yml"
WALK = 30                               # how far back main's checks look for the last commit whose `check` passed
REVIEW_DIR = "sync-review"


def poll_s():
    return float(os.environ.get("FORK_SYNC_POLL_S", "20"))


def call_wait_s():
    """How long one call waits before it hands back ("wait": call again): a shell call's limit is about 10 minutes."""
    return float(os.environ.get("FORK_SYNC_CALL_WAIT_S", str(9 * 60)))


# --- GitHub, always dmalis/shepherdr ---

def gh(*args, timeout=120):
    try:
        r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, "", type(e).__name__
    return r.returncode == 0, r.stdout.strip(), r.stderr.strip()


def gh_json(*args):
    ok, out, _ = gh(*args)
    if not ok:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


PR_FIELDS = "number,state,isDraft,baseRefName,headRefName,headRefOid,isCrossRepository,headRepository,mergeCommit"


def pr_view(pr):
    v = gh_json("pr", "view", str(pr), "-R", state.REPO, "--json", PR_FIELDS)
    if not isinstance(v, dict):
        raise Refused(f"pull request #{pr} can't be read", outcome="stop")
    return v


def check_runs(sha):
    """The check runs GitHub has for exactly this commit, or None when they can't be read."""
    v = gh_json("api", f"repos/{state.REPO}/commits/{sha}/check-runs?per_page=100")
    if not isinstance(v, dict) or not isinstance(v.get("check_runs"), list):
        return None
    return [r for r in v["check_runs"] if isinstance(r, dict)]


def runs_state(runs, names):
    """{name: "success" | "running" | "missing" | "failed: <conclusion>"} for each needed name."""
    out = {}
    for n in names:
        mine = [r for r in runs if r.get("name") == n]
        if not mine:
            out[n] = "missing"
        elif any(r.get("status") == "completed" and r.get("conclusion") != "success" for r in mine):
            bad = next(r for r in mine if r.get("status") == "completed" and r.get("conclusion") != "success")
            out[n] = f"failed: {bad.get('conclusion') or 'no conclusion'}"
        elif any(r.get("status") != "completed" for r in mine):
            out[n] = "running"
        else:
            out[n] = "success"
    return out


def wait_checks(sha, names, first_seen, now=time.time, sleep=time.sleep):
    """Reads the commit's checks until they all passed, one failed, they waited CHECKS_WAIT_S since `first_seen`, or
    this call waited its share. Returns ("pass" | "failed" | "timeout" | "wait" | "unread", {name: state})."""
    began = now()
    while True:
        runs = check_runs(sha)
        if runs is None:
            return "unread", {}
        got = runs_state(runs, names)
        if all(v == "success" for v in got.values()):
            return "pass", got
        if any(v.startswith("failed") for v in got.values()):
            return "failed", got
        if now() - first_seen >= CHECKS_WAIT_S:
            return "timeout", got
        if now() - began >= call_wait_s():
            return "wait", got
        sleep(max(0.0, poll_s()))


def first_wait(p, key, now=None):
    """When a gate first waited on `key`'s checks (recorded the first time)."""
    with state.locked(p) as st:
        w = st.setdefault("waits", {})
        if not w.get(key):
            w[key] = state.stamp(now)
        return state.parse_stamp(w[key])


def done_waiting(p, key):
    with state.locked(p) as st:
        (st.get("waits") or {}).pop(key, None)


def checks_words(got):
    return ", ".join(f"{n} {v}" for n, v in got.items())


# --- main's checks: upstream's push trigger and its paths-ignore ---

def push_paths_ignore(text):
    """The `paths-ignore` patterns of a workflow's `on: push:` trigger, read without a YAML library; [] when push
    has none; None when it can't be read for sure (no push trigger, a `paths:` filter, a shape this doesn't know).
    None means a run is expected, the safe side."""
    lines = [ln.rstrip() for ln in (text or "").splitlines()]
    on = next((i for i, ln in enumerate(lines) if re.match(r"^(?:on|\"on\"|'on'|true):\s*$", ln)), None)
    if on is None:
        return None
    push = None
    for i in range(on + 1, len(lines)):
        ln = lines[i]
        if ln and not ln[0].isspace() and not ln.lstrip().startswith("#"):
            break
        m = re.match(r"^(\s+)push:\s*(.*)$", ln)
        if m:
            push = (i, len(m.group(1)), m.group(2).strip())
            break
    if push is None:
        return None
    i, indent, rest = push
    if rest and not rest.startswith("#"):
        return None     # `push: {…}` or the like: not a shape read here
    pats, key = [], None
    for ln in lines[i + 1:]:
        if not ln.strip() or ln.lstrip().startswith("#"):
            continue
        ind = len(ln) - len(ln.lstrip())
        if ind <= indent:
            break
        m = re.match(r"^\s+([\w-]+):\s*(.*)$", ln)
        if m and not ln.lstrip().startswith("-"):
            key, val = m.group(1), m.group(2).strip()
            if key == "paths":
                return None
            if key == "paths-ignore" and val:
                if not (val.startswith("[") and val.endswith("]")):
                    return None
                pats += [unquote(x) for x in val[1:-1].split(",") if x.strip()]
            continue
        m = re.match(r"^\s+-\s*(.+?)\s*(?:#.*)?$", ln)
        if m and key == "paths-ignore":
            pats.append(unquote(m.group(1)))
    return pats


def unquote(s):
    s = s.strip()
    return s[1:-1] if len(s) >= 2 and s[0] == s[-1] and s[0] in "'\"" else s


def glob_rx(pat):
    """GitHub's path filter glob as a regex: `**` crosses folders, `*` and `?` don't. None for what isn't read here
    (a `!` negation, a character class): the caller then expects a run."""
    if pat.startswith("!") or "[" in pat or "{" in pat:
        return None
    out, i = "", 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif pat.startswith("**", i):
            out, i = out + ".*", i + 2
        elif pat[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif pat[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(pat[i]), i + 1
    return re.compile("^" + out + "$")


def ignored(path, patterns):
    """Whether a changed path matches the push trigger's paths-ignore; None when a pattern can't be read."""
    rxs = [glob_rx(p) for p in patterns]
    if any(r is None for r in rxs):
        return None
    return any(r.match(path) for r in rxs)


def only_ignored(repo, a, b, patterns):
    """Whether every file changed between a and b matches the patterns (False when it can't be told)."""
    ok, out, _ = git(repo, "diff", "--name-only", "--no-renames", a, b)
    if not ok:
        return False
    return all(ignored(f, patterns) is True for f in out.splitlines() if f)


def check_expected(repo, sha, old):
    """Whether upstream's `check` runs on a push of `sha` over `old`: any file changed outside its push trigger's
    paths-ignore (read from the candidate's own check.yml) means a run comes. Returns (expected, patterns)."""
    ok, text, _ = git(repo, "show", f"{sha}:{CHECK_YML}")
    pats = push_paths_ignore(text) if ok else None
    if pats is None or not old:
        return True, pats
    return not only_ignored(repo, old, sha, pats), pats


def main_checks(p, repo, sha, old, known_passed=(), now=time.time, sleep=time.sleep):
    """Main's checks on a candidate (a sync's merge commit, or main's tip): "pass", or "wait" (call again), or a
    Refused hold (kind gate). `old` is main's tip before the candidate; `known_passed` are commits whose `check` is
    known to have passed (the sync PR's head)."""
    expected, pats = check_expected(repo, sha, old)
    names = ("check", "fork-check") if expected else ("fork-check",)
    key = f"main:{sha}"
    result, got = wait_checks(sha, names, first_wait(p, key), now=now, sleep=sleep)
    if result == "wait":
        return "wait", got
    if result != "pass":
        raise Refused(f"main's checks on {sha[:12]} " + {
            "unread": "can't be read", "failed": f"didn't pass ({checks_words(got)})",
            "timeout": f"didn't end within {CHECKS_WAIT_S // 60} minutes ({checks_words(got)})"}[result],
            outcome="held", kind="gate", gate="main-checks")
    if not expected:
        # no `check` run comes: the diff from the last commit whose `check` passed touches only ignored paths
        last = last_check_passed(repo, sha, known_passed)
        if not last or not only_ignored(repo, last, sha, pats):
            raise Refused(f"no check run comes for {sha[:12]}, and its diff from the last commit whose check passed "
                          "isn't only the paths that check skips", outcome="held", kind="gate", gate="main-checks")
    done_waiting(p, key)
    with state.locked(p) as st:
        state.record_checks(st, sha)
    return "pass", got


def last_check_passed(repo, sha, known_passed=()):
    ok, out, _ = git(repo, "rev-list", "--first-parent", f"--max-count={WALK}", f"{sha}^")
    for c in list(known_passed) + (out.splitlines() if ok else []):
        runs = check_runs(c)
        if runs is not None and runs_state(runs, ("check",))["check"] == "success":
            return c
    return None


# --- the reviewer's inputs ---

def sync_merge(repo, main, head, release_sha):
    """The sync's merge commit: on the head's first-parent line since main, the merge that brought the release in."""
    ok, out, _ = git(repo, "rev-list", "--first-parent", "--merges", "--parents", f"{main}..{head}")
    for line in out.splitlines() if ok else []:
        c, *parents = line.split()
        if release_sha in parents[1:]:
            return c
    return None


def pushed_head(repo, branch):
    ok, out, _ = git(repo, "ls-remote", "origin", f"refs/heads/{branch}", timeout=120)
    sha = out.split("\t")[0] if ok and out else None
    return sha if sha and state.SHA.match(sha) else None


def review_inputs(p, run, folder, repo):
    with state.locked(p) as st:
        state.owns_lease(st, run, folder)
        rel, main, old, r = st.get("release"), st.get("main"), st.get("in_main"), st.get("run") or {}
        if r.get("key") != run or r.get("path") != "take" or not (rel and main and old):
            raise Refused("this run isn't taking a release (select first)", outcome="stop")
        if st.get("phase") not in ("selected", "branch-pushed"):
            raise Refused(f"the phase is {st.get('phase')}: the reviewer's inputs come before the trial", outcome="stop")
    ok, ver, _ = git(repo, "version")
    m = re.search(r"(\d+)\.(\d+)", ver or "")
    if not m or (int(m.group(1)), int(m.group(2))) < (2, 36):
        raise Refused("git 2.36 or later is needed for the conflict resolutions (--remerge-diff)", outcome="stop")
    branch = f"sync/{rel['tag']}"
    head = pushed_head(repo, branch)
    if not head:
        raise Refused(f"{branch} isn't on origin: push it first", outcome="stop")
    if rev(repo, "HEAD") != head:
        raise Refused(f"this worktree's HEAD isn't {branch}'s pushed head {head[:12]}: the rounds are recorded on the "
                      "run's own branch, which holds the same commits", outcome="stop")
    if not is_ancestor(repo, rel["sha"], head):
        raise Refused(f"{rel['sha']} is not an ancestor of {head}", outcome="held", kind="gate", gate="ancestry")
    merge = sync_merge(repo, main, head, rel["sha"])
    if not merge:
        raise Refused(f"no merge of {rel['sha'][:12]} on {branch} since {main[:12]}", outcome="stop")
    ok, gitdir, _ = git(repo, "rev-parse", "--absolute-git-dir")
    out = os.path.join(gitdir, REVIEW_DIR)
    os.makedirs(out, exist_ok=True)
    files = {
        "footprint": ("footprint.diff", [["diff", "--no-color", f"{rel['sha']}..{head}"]]),
        "patches": ("patches.range-diff", [["range-diff", "--no-color", f"{old['sha']}..{main}",
                                            f"{rel['sha']}..{head}"]]),
        "resolutions": ("resolutions.diff", [["show", "--no-color", "--remerge-diff", merge],
                                             ["log", "-p", "--no-color", f"{merge}..{head}"]]),
    }
    written = {}
    for what, (name, cmds) in files.items():
        path = os.path.join(out, name)
        parts = []
        for i, cmd in enumerate(cmds):
            part = path + (f".{i}" if len(cmds) > 1 else "")
            ok, err = release.git_to(repo, part, *cmd)
            if not ok:
                raise Refused(f"git {cmd[0]} failed for the {what} file", outcome="stop")
            parts.append(part)
        if len(parts) > 1:
            with open(path, "w", encoding="utf-8") as f:
                for part in parts:
                    with open(part, encoding="utf-8") as g:
                        f.write(g.read())
                    os.unlink(part)
        written[what] = p.show(path)
    with state.locked(p) as st:
        state.owns_lease(st, run, folder)
        if st.get("phase") not in ("selected", "branch-pushed"):
            raise Refused(f"the phase moved to {st.get('phase')} meanwhile", outcome="stop")
        # a fix round's new head replaces the old one: the trial and the checks are read for this head
        # and the run whose review rounds cover this head: a run that takes the lease over later reads them there
        st["sync"] = {"branch": branch, "head": head, "merge": merge, "run": run, "folder": folder,
                      "at": state.stamp()}
        state.set_phase(st, "branch-pushed")
    return {"branch": branch, "head": head, "merge": merge, "release": rel, "old_release": old, "old_main": main,
            "files": written}


# --- the one merge route ---

def review_round(run, folder):
    """The head of the run's last recorded review round, from `herdr-task show --json`, or None."""
    try:
        r = subprocess.run(["herdr-task", "show", run, "--folder", folder, "--json"], capture_output=True, text=True,
                           timeout=60)
        v = json.loads(r.stdout) if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        v = None
    if not isinstance(v, dict):
        raise Refused(f"run {run} can't be read with herdr-task show", outcome="stop")
    return ((v.get("review_rounds") or {}).get("last") or {}).get("head")


def held(why, gate):
    return Refused(why, outcome="held", kind="gate", gate=gate)


def pr_gate(v, branch, head):
    if v.get("state") != "OPEN":
        raise held(f"pull request #{v.get('number')} is {str(v.get('state') or 'not open').lower()}", "pr")
    if v.get("isDraft"):
        raise held(f"pull request #{v.get('number')} is a draft", "pr")
    if v.get("baseRefName") != "main":
        raise held(f"pull request #{v.get('number')} goes into {v.get('baseRefName')}, not main", "pr")
    if v.get("headRefName") != branch or v.get("isCrossRepository"):
        raise held(f"pull request #{v.get('number')} isn't from {branch} in {state.REPO}", "pr")
    if v.get("headRefOid") != head:
        raise held(f"pull request #{v.get('number')}'s head is {str(v.get('headRefOid'))[:12]}, not the reviewed "
                   f"{head[:12]}", "pr")


def merge(p, run, folder, repo, pr, now=time.time, sleep=time.sleep):
    """`merge <pr>`: the gates, the merge, its verification and main's checks on the merge commit. Called again after
    a "wait" (checks still running) or a run that died mid-way, it picks up where the state says."""
    with state.locked(p) as st:
        state.owns_lease(st, run, folder)
        phase, sync, rel = st.get("phase"), dict(st.get("sync") or {}), st.get("release")
        r = st.get("run") or {}
        if r.get("key") != run or r.get("path") != "take" or not (sync.get("head") and rel):
            raise Refused("this run has no sync branch to merge (select, then review-inputs)", outcome="stop")
        if phase not in ("tried", "merged"):
            raise Refused(f"the phase is {phase}: a sync PR merges after its trial passed", outcome="stop")
        if sync.get("pr") not in (None, pr):
            raise Refused(f"this run's sync PR is #{sync['pr']}, not #{pr}", outcome="stop")
    head, branch = sync["head"], sync["branch"]
    if phase == "tried":
        v = pr_view(pr)
        if v.get("state") == "MERGED" and sync.get("main_before") and v.get("headRefOid") == head:
            pass        # merged by this route in a call that died before it was recorded: verified below
        else:
            reviewer = (sync.get("run") or run, sync.get("folder") or folder)
            waiting = gates(p, reviewer, repo, pr, v, branch, head, rel, now=now, sleep=sleep)
            if waiting:
                return {"merged": False, "wait": waiting}
            # gate 3 again, just before the merge: another merge may have moved main while the checks ran
            before = release.fetch_main(repo)
            if not is_ancestor(repo, before, head):
                raise held(f"{before} is not an ancestor of {head}", "up-to-date")
            with state.locked(p) as st:
                st["sync"] = dict(st.get("sync") or {}, pr=pr, main_before=before)
            sync.update(pr=pr, main_before=before)
            ok, _, _ = gh("pr", "merge", str(pr), "-R", state.REPO, "--merge", "--match-head-commit", head, timeout=300)
            if not ok:
                v = pr_view(pr)
                if v.get("state") != "MERGED":
                    raise held(f"gh pr merge didn't merge pull request #{pr}", "merge")
        mc = verify(p, repo, pr, head, sync["main_before"], rel["sha"])
        with state.locked(p) as st:
            st["candidate"] = mc
            st["release"] = dict(st.get("release") or {}, merged=True)
            st["sync"] = dict(st.get("sync") or {}, merge_commit=mc)
            st["run"] = dict(st.get("run") or {}, merged=True)
            state.set_phase(st, "merged")
    else:
        mc = sync.get("merge_commit")
        if not mc:
            raise Refused("the phase is merged but no merge commit is recorded", outcome="stop")
    result, got = main_checks(p, repo, mc, sync.get("main_before"), known_passed=(head,), now=now, sleep=sleep)
    out = {"merged": True, "candidate": mc, "checks": got}
    if result == "wait":
        out["wait"] = f"main's checks on {mc[:12]} are still running ({checks_words(got)}): call merge again"
    return out


def gates(p, reviewer, repo, pr, v, branch, head, rel, now=time.time, sleep=time.sleep):
    """Gates 1 to 6 of the merge route: None when they all pass, a line when the head's checks still run (call
    again), else a Refused hold naming the gate. `reviewer` is the (run, folder) whose rounds cover the head."""
    pr_gate(v, branch, head)                                                    # 1
    last = review_round(*reviewer)                                              # 2
    if last != head:
        raise held(f"the last review round is on {str(last)[:12] if last else 'no commit'}, not the head {head[:12]}",
                   "review")
    main = release.fetch_main(repo)                                             # 3
    if not is_ancestor(repo, main, head):
        raise held(f"{main} is not an ancestor of {head}", "up-to-date")
    if not is_ancestor(repo, rel["sha"], head):                                 # 4
        raise held(f"{rel['sha']} is not an ancestor of {head}", "ancestry")
    key = f"pr:{head}"                                                          # 5
    result, got = wait_checks(head, CHECKS, first_wait(p, key), now=now, sleep=sleep)
    if result == "wait":
        return f"the head's checks are still running ({checks_words(got)}): call merge again"
    if result != "pass":
        raise held(f"the head's checks " + {"unread": "can't be read", "failed": f"didn't pass ({checks_words(got)})",
                                           "timeout": f"didn't end within {CHECKS_WAIT_S // 60} minutes "
                                                      f"({checks_words(got)})"}[result], "checks")
    done_waiting(p, key)
    with state.locked(p) as st:                                                 # 6
        if not state.trial_passed(st, head):
            raise held(f"no trial pass is recorded for {head[:12]}", "trial")
    return None


def verify(p, repo, pr, head, before, release_sha):
    """After the merge: the PR's merge commit is on origin/main, its parents are the old tip and the head, its tree
    is the head's, and the release is its ancestor. Facts only."""
    v = pr_view(pr)
    mc = (v.get("mergeCommit") or {}).get("oid")
    if v.get("state") != "MERGED" or not mc:
        raise held(f"pull request #{pr} isn't merged", "verify")
    main = release.fetch_main(repo)
    if not is_ancestor(repo, mc, main):
        raise held(f"{mc} is not an ancestor of {main}", "verify")
    ok, out, _ = git(repo, "rev-list", "--parents", "-n", "1", mc)
    parents = out.split()[1:] if ok else []
    if parents != [before, head]:
        raise held(f"{mc}'s parents are {' '.join(x[:12] for x in parents) or 'unread'}, not {before[:12]} and "
                   f"{head[:12]}", "verify")
    if release.tree(repo, mc) != release.tree(repo, head):
        raise held(f"{mc}'s tree isn't {head}'s", "verify")
    if not is_ancestor(repo, release_sha, mc):
        raise held(f"{release_sha} is not an ancestor of {mc}", "verify")
    return mc


# --- finishing the run ---

def branch_problem(repo, start):
    """Why `ready --nothing` / `--told` would refuse this worktree, or None: a merge in progress, uncommitted
    changes, or commits origin/main (as fetched here) doesn't hold."""
    if git(repo, "rev-parse", "-q", "--verify", "MERGE_HEAD")[0]:
        raise Refused("a merge is in progress: git merge --abort, then reset to the run's start", outcome="stop")
    ok, out, _ = git(repo, "status", "--porcelain", "--untracked-files=no")
    if not ok or out:
        raise Refused("the worktree has uncommitted changes", outcome="stop")
    head = rev(repo, "HEAD")
    if not (head and (head == start or is_ancestor(repo, head, "refs/remotes/origin/main"))):
        raise Refused(f"the run's branch has commits origin/main doesn't hold: reset it to the run's start "
                      f"({(start or 'unknown')[:12]})", outcome="stop")


def ready_cmd(run, folder, told=None):
    base = ["herdr-task", "ready", run, "--folder", folder]
    return shlex.join(base + (["--told", told] if told is not None else ["--nothing"]))


def held_words(rec):
    rel = (rec.get("release") or {}).get("tag") or "the release"
    if rec.get("kind") == "permission":
        return f"{rel.lstrip('v')} is ready to install"
    blocker = str(rec.get("blocker") or "")
    by = f"patch #{blocker}" if blocker.isdigit() else f"the {blocker} gate"
    line = " ".join(str(rec.get("line") or "").split())
    return f"Held: {rel} waits on {by}" + (f": {line}" if line else ".")


def finish(p, run, folder, repo, says=None, cfg_hostname=None):
    """The exact completion command for the run's outcome (Completion commands), after checking the branch is in
    a state it accepts. Lets go of the lease when the phase is final."""
    with state.locked(p) as st:
        lease = st.get("lease") or {}
        mine = (lease.get("run"), lease.get("folder")) == (run, folder)
        r = st.get("run") if (st.get("run") or {}).get("key") == run else None
        phase = st.get("phase")
        snap = json.loads(json.dumps(st))
    if not mine:
        # another run owns the lease (preflight ended this one --nothing), or none does
        branch_problem(repo, None)
        return {"outcome": "nothing", "before": [], "command": ready_cmd(run, folder)}
    if phase in ("installing", "rolling-back", "broken"):
        # unknown: the lease and the phase stay, so the next run resumes (or, broken, waits for the person)
        what = "Rollback failed" if phase == "broken" else "Update outcome unknown"
        if phase == "broken" and (snap.get("install") or {}).get("broken") == "hooks":
            what = "An agent's hook file changed during the install"
        rel = ((snap.get("release") or {}).get("tag")) or "the candidate"
        told = f"{what}: {rel} ({(snap.get('candidate') or '')[:12]}). Nothing installs until it is looked at."
        # the same checks as every --told: a merged branch fetched, the worktree in a state the command accepts
        if (r or {}).get("merged"):
            fetch_for_finish(repo)
        branch_problem(repo, (r or {}).get("start"))
        found = public.problems(told, cfg_hostname)
        if found:
            raise Refused(f"the --told words carry {public.words(found)}", outcome="stop")
        return {"outcome": "unknown", "told": told, "keeps_lease": True,
                "before": [shlex.join(["herdr-task", "alert", what, "--body", told])],
                "command": ready_cmd(run, folder, told)}
    if phase == "installed":
        raise Refused("the phase is installed: run health first", outcome="stop")
    r = r or {}
    path, held_by = r.get("path"), r.get("held")
    went = path in ("take", "install-main")      # select set this run's phase; anything after it is this run's
    told = None
    if phase == "held" and held_by:
        rec = state.held_record(snap, held_by.get("blocker"))
        if not rec:
            raise Refused("the phase is held but this run's held record is gone", outcome="stop")
        if rec.get("kind") == "draft" and pushed_head(repo, rec.get("branch")) != rec.get("head"):
            raise Refused(f"the draft {rec.get('branch')} isn't pushed at {str(rec.get('head'))[:12]}", outcome="stop")
        if r.get("merged"):
            fetch_for_finish(repo)
        # the person hears of a held record once: the run that first holds it
        outcome, told = ("held", held_words(rec)) if held_by.get("new") else ("nothing", None)
    elif went and phase == "healthy":
        if not says:
            raise Refused("an install ends --told with what's new: finish --says \"<what's new>\"", outcome="stop")
        if r.get("merged"):
            fetch_for_finish(repo)
        outcome, told = "installed", " ".join(says.split())
    elif went and phase == "rolled-back":
        if r.get("merged"):
            fetch_for_finish(repo)
        q = (snap.get("quarantine") or [{}])[-1]
        base = snap.get("baseline") or {}
        outcome = "rolled-back"
        told = (f"Rolled back: the install of {str(q.get('sha') or snap.get('candidate') or '')[:12]} failed at "
                f"{q.get('step') or 'health'}; back on {base.get('version') or 'the last healthy install'}.")
        if says:
            told += " " + " ".join(says.split())
    elif not went:
        outcome = "nothing"
    else:
        raise Refused(f"the run took the {path} path and hasn't ended (phase {phase or 'none'})", outcome="stop")
    branch_problem(repo, r.get("start"))
    if told is not None:
        found = public.problems(told, cfg_hostname)
        if found:
            raise Refused(f"the --told words carry {public.words(found)}", outcome="stop")
    with state.locked(p) as st:
        if st.get("lease") and not state.resume_point(st):
            state.release_lease(st, run, folder)
        if (st.get("run") or {}).get("key") == run:
            st["run"] = dict(st["run"], finished=outcome)
            # the person's upstream issues are reported by an install's words: the cursor moves to the run's start
            # (its select) only then, so a run that told nothing never skips a reply (Patch inventory)
            if outcome == "installed" and st["run"].get("at"):
                st["issue_cursor"] = st["run"]["at"]
    return {"outcome": outcome, "before": [], "command": ready_cmd(run, folder, told),
            **({"told": told} if told else {})}


def fetch_for_finish(repo):
    """`git fetch origin main` in the run's worktree: its merged commits are then in origin/main, so `--told` takes
    the run as unchanged, the same way in every history (local main stale or not, own work recorded or not)."""
    ok, _, _ = git(repo, "fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main", timeout=600)
    if not ok:
        raise Refused("origin's main can't be fetched", outcome="stop")
