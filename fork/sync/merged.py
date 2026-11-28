"""Installing our own merges (fork/specs/sync-pipeline.md, "Installing our own merges").

- `settle`: what this run installs: origin/main's tip, fetched now and pinned by SHA. No quiet wait, no gap between
  installs, no cap: each install takes whatever main holds when it starts, so merges that land during an install go
  in together with the next one, which starts right after it. One install at a time is the lease's job.
- Our merges' own install policy (phase `settled`): no trial and no wait on main's checks, since this space's merges
  go in before CI reports. What stays: the rehearsal gate when the pipeline's own code changed, the hooks check, the
  hold patch, health (which now also reads the web app and herdr-task, what the trial covered) and the rollback.
- Pending merges: a run that finds the lease taken records its merge in `pending` and ends quietly. A pin clears the
  merges recorded before it (main held them by then), and `finish` won't let go of the lease while one is left, so
  the owner goes again until main is installed.
- The skip list: a tip whose every path changed since the baseline installs nothing (`installs_nothing`) ends there,
  and the baseline stays. `fork/tests/test_merged.py` pins the list against the installer's own `share_items` and
  `source_items`, so a new shipped folder breaks the test.
- Quarantine without a trial: a tip whose shipped files are the same as a quarantined commit's stays out (a docs-only
  merge on top doesn't clear it); a shipped change does.
- CI after the install: `ci` reads main's `check` and `fork-check` workflows for each install of ours: the newest
  finished run covering that commit, on it or a later commit of main that contains it (cancelled and skipped runs
  don't count; CI cancels older main runs when main moves). One GitHub call a minute reads main's runs for every
  install at once. Each install waits from its own install time: 30 minutes, an hour while a check that would cover
  it still runs. A red or missing result is told once (finish puts it in its --told words, for the Assistant to open
  a fix task), in plain words that name the fixes by title, never a commit's hash; nothing rolls back on it. The
  newest install whose CI passed is kept as the recovery point."""
import fcntl
import json
import os
import re
import time

from . import gate, install, release, state
from .release import git, is_ancestor, rev
from .state import Refused

PATH = "install-merged"
# Paths that install nothing: the fork's own files, docs, the agents' skills and settings, CI, upstream's tests, and a
# Markdown file at the root. Anything else may be shipped, so it installs.
SKIP_DIRS = ("fork/", "docs/", ".agents/", ".claude/", ".github/", "test/")
PENDING_KEEP = 20                     # the newest merged tasks' titles a pending record keeps

CI_NAMES = ("check", "fork-check")
CI_RED = ("failure", "timed_out", "startup_failure", "action_required")
CI_UNFINISHED = ("cancelled", "skipped", "stale")     # a run that ended without a verdict: an older or newer one counts
CI_MISSED_AFTER_S = 2 * 3600          # no finished run covers an install this long after it: told as missing
CI_LATE_S = 24 * 3600                 # a missing verdict is read again this long, so a later pass still counts
CI_KEEP = 50


def installs_nothing(path):
    return path.startswith(SKIP_DIRS) or ("/" not in path and path.lower().endswith(".md"))


def changed_paths(repo, a, b):
    """The paths changed between two commits, or None when git can't say."""
    ok, out, _ = git(repo, "diff", "--name-only", "--no-renames", a, b)
    return [f for f in out.splitlines() if f] if ok else None


def same_shipped(repo, a, b):
    """Whether two commits ship the same files: every path that differs installs nothing."""
    changed = changed_paths(repo, a, b)
    return changed is not None and all(installs_nothing(f) for f in changed)


def quarantined_like(st, repo, sha):
    """The quarantine record that keeps this commit out: its own, or one whose shipped files are the same."""
    exact = state.quarantined(st, sha)
    if exact:
        return exact
    for q in reversed(st.get("quarantine") or []):
        if state.SHA.match(q.get("sha") or "") and same_shipped(repo, q["sha"], sha):
            return dict(q, like=q["sha"])
    return None


def now_ms(now=None):
    return int((time.time() if now is None else now) * 1000)


# --- pending merges ---

def record_pending(st, title, now=None, cfg_hostname=None):
    """A merge that came while another run owned the lease (or the pipeline was broken): its time and the merged
    task's title. The owner picks it up: `finish` won't let go of the lease while it is there. A title that carries
    anything that mustn't go public (a home path, a machine's name) is kept as "a merged task": titles reach the
    JSON lines and the person's words."""
    from . import public
    cur = st.get("pending") or {}
    title = " ".join(str(title or "").split())[:200]
    if not title or public.problems(title, cfg_hostname):
        title = "a merged task"
    titles = [t for t in cur.get("titles") or [] if t != title] + [title]
    st["pending"] = {"at": state.stamp(now), "ms": now_ms(now), "titles": titles[-PENDING_KEEP:]}
    return st["pending"]


def clear_pending(st, pinned_ms):
    """A pin taken after the pending merges were recorded holds them (each was on main before its run recorded it):
    clears them and returns their titles. One recorded at or after the pin stays, for the next round."""
    cur = st.get("pending")
    if cur and isinstance(cur.get("ms"), int) and cur["ms"] < pinned_ms:
        st["pending"] = None
        return list(cur.get("titles") or [])
    return []


def held_at(st, sha):
    """A held record of this path on that exact commit, other than the update permission (which may be on now)."""
    return next((h for h in st.get("held") or [] if str(h.get("blocker") or "").startswith(state.MAIN_BLOCKER)
                 and h.get("head") == sha and h.get("kind") != "permission"), None)


# --- settle ---

def settle(p, run, folder, repo, now=time.time):
    """origin/main's tip, pinned, and this run's path: "nothing" (main is installed, or its tip is quarantined or held
    already), "skip" (it changed only paths that install nothing) or "install-merged" (phase settled: install it). A
    run that went before settles again here, and keeps what it did as a round for finish's words."""
    with state.locked(p) as st:
        state.owns_lease(st, run, folder)
        phase = st.get("phase")
        if phase in state.MOVING:
            raise Refused(f"the phase is {phase}: finish that first (preflight says where to resume)", outcome="stop")
        r = st.get("run") if (st.get("run") or {}).get("key") == run else None
        if r and r.get("path") in gate.SYNCED and state.resume_point(st):
            raise Refused(f"this run's {r['path']} hasn't ended (phase {phase}): finish it first", outcome="stop")
        baseline = (st.get("baseline") or {}).get("sha")
        if not (baseline and state.SHA.match(baseline)):
            raise Refused("there is no baseline yet: run baseline first", outcome="stop")
    pinned = now_ms(now())
    tip = release.fetch_main(repo)
    rels = release.releases(repo)
    in_main = next((x for x in rels if is_ancestor(repo, x["sha"], tip)), None)
    if not in_main:
        raise Refused("no upstream release is an ancestor of origin/main", outcome="held", kind="pipeline")
    start = rev(repo, "HEAD")
    out = {"main": tip, "release": in_main, "baseline": baseline, "candidate": None, "rehearse": False}
    with state.locked(p) as st:
        state.owns_lease(st, run, folder)
        if st.get("phase") != phase or (st.get("baseline") or {}).get("sha") != baseline:
            raise Refused("the state moved meanwhile: settle again", outcome="stop")
        q = None if is_ancestor(repo, tip, baseline) else quarantined_like(st, repo, tip)
        if is_ancestor(repo, tip, baseline):
            path, why = "nothing", "main is installed"
        elif q:
            path, why = "nothing", (f"main's tip {tip[:12]} is quarantined" if not q.get("like") else
                                    f"main's tip {tip[:12]} ships the same files as the quarantined {q['like'][:12]}")
            out["quarantined"] = q.get("like") or tip
        elif held_at(st, tip):
            path, why = "nothing", f"main's tip {tip[:12]} is held already ({held_at(st, tip)['blocker']})"
        else:
            changed = changed_paths(repo, baseline, tip)
            if changed is None:
                raise Refused(f"the paths changed since the baseline {baseline[:12]} can't be listed", outcome="stop")
            out["changed"] = len(changed)
            if all(installs_nothing(f) for f in changed):
                path, why = "skip", "every path changed since the baseline installs nothing"
            else:
                path, why = PATH, None
        rounds = list((r or {}).get("rounds") or [])
        if r and not state.resume_point(st) and r.get("path") in gate.WENT:
            rounds.append(round_record(st, r))      # what this run already did: finish tells it with the rest
        keep = {k: r[k] for k in ("merged", "took_from", "synced_at") if r and r.get(k)}
        if r and r.get("path") in gate.SYNCED and not keep.get("synced_at"):
            keep["synced_at"] = r.get("at")         # the release sync's own start, for the issue cursor
        st["run"] = {"key": run, "folder": folder, "path": path, "start": (r or {}).get("start") or start,
                     "at": state.stamp(pinned / 1000), "pinned_ms": pinned, **keep,
                     **({"rounds": rounds} if rounds else {})}
        st["main"], st["in_main"] = tip, in_main
        came = (r or {}).get("settled_from") if phase == "settled" else phase
        if path == PATH:
            state.set_phase(st, "settled")
            st["run"]["settled_from"] = came
            st["release"], st["candidate"], st["sync"] = dict(in_main), tip, None
            out["candidate"] = tip
            out["rehearse"] = not state.rehearsal_passed(st, install.pipeline_hash(repo, tip))
        elif phase == "settled":
            # a settled run that stopped, then found nothing to install on its resume (main moved back): nothing was
            # installed, so the state goes back to the finished phase it settled from, and finish can end the run
            st["phase"], st["phase_at"], st["candidate"] = came, state.stamp(), None
        out["pending_cleared"] = clear_pending(st, pinned)
        out["pending"] = bool(st.get("pending"))
    out["path"] = path
    if why:
        out["why"] = why
    return out


def round_record(st, r):
    """One finished round of this run, as finish tells it: its path and phase, the held record it made (kept here, as
    a later healthy install clears held records), the candidate, the quarantine and the baseline it went back to."""
    held_by = r.get("held") or {}
    return {"path": r.get("path"), "phase": st.get("phase"), "held": held_by or None,
            "held_record": state.held_record(st, held_by.get("blocker")) if held_by else None,
            "candidate": st.get("candidate"), "baseline": st.get("baseline"),
            "quarantined": (st.get("quarantine") or [{}])[-1] if st.get("phase") == "rolled-back" else None}


# --- CI on main after an install of ours ---

WORKFLOWS = {"check.yml": "check", "fork-check.yml": "fork-check"}   # main's workflow files, by the check they are


def ci_poll_s():
    """How often `ci` reads main's runs: a run takes minutes, so once a minute is plenty (one call each time)."""
    return float(os.environ.get("FORK_SYNC_CI_POLL_S", "60"))


def main_runs():
    """{commit: [{"name", "status", "conclusion"}]} for main's newest push runs of our two workflows, from ONE call
    (GitHub's workflow runs of main), or None when they can't be read. A workflow's own run, not its jobs' check
    runs, so a workflow that splits its job in parts still gives one verdict."""
    v = gate.gh_json("api", f"repos/{state.REPO}/actions/runs?branch=main&event=push&per_page=100")
    if not isinstance(v, dict) or not isinstance(v.get("workflow_runs"), list):
        return None
    out = {}
    for r in v["workflow_runs"]:
        if not isinstance(r, dict):
            continue
        name = WORKFLOWS.get(os.path.basename(str(r.get("path") or "").split("@")[0]))
        sha = str(r.get("head_sha") or "")
        if name and state.SHA.match(sha):
            out.setdefault(sha, []).append({"name": name, "status": r.get("status"),
                                            "conclusion": r.get("conclusion")})
    return out


def shared_runs(p, now=time.time):
    """main_runs(), shared by every `ci` reading at once (each install run calls its own): the last read, kept beside
    the sync state, serves them all for ci_poll_s(), so GitHub gets one call a minute however many runs wait. Taken
    under its own lock (never the state's: a GitHub call can take a while), so two can't both call."""
    path = os.path.join(p.dir, "main-runs.json")
    os.makedirs(p.dir, exist_ok=True)
    with open(os.path.join(p.dir, "main-runs.lock"), "a") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            with open(path, encoding="utf-8") as f:
                kept = json.load(f)
            if 0 <= now() - float(kept["at"]) < ci_poll_s() and isinstance(kept.get("runs"), dict):
                return kept["runs"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        runs = main_runs()
        if runs is not None:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"at": now(), "runs": runs}, f)
            os.replace(tmp, path)
        return runs


def ci_verdict(repo, sha, tip, runs_of=None):
    """("green" | "red" | "pending", {name: {"state", "by", "running"}}): for each of main's checks, the newest finished
    run that covers `sha`: on it or a later commit of main's first-parent line (a later commit contains it, so its
    pass covers every install before it), or, for `check` when its push trigger skips `sha`'s own push
    (paths-ignore), on an older commit whose code is the same. `running`: a run that would cover it hasn't finished
    yet. `runs_of(commit)` gives that commit's runs ([] for none, None when they can't be read)."""
    runs_of = runs_of or gate.check_runs
    line = [sha]
    if is_ancestor(repo, sha, tip):
        ok, out, _ = git(repo, "rev-list", "--first-parent", f"{sha}..{tip}")
        line = (out.splitlines() if ok else []) + [sha]          # newest first
    expected, pats = gate.check_expected(repo, sha, rev(repo, f"{sha}^"))
    older = []
    if not expected and pats is not None:
        ok, out, _ = git(repo, "rev-list", "--first-parent", f"--max-count={gate.WALK}", f"{sha}^")
        for c in out.splitlines() if ok else []:
            if not gate.only_ignored(repo, c, sha, pats):
                break
            older.append(c)
    cache = {}

    def runs(c):
        if c not in cache:
            cache[c] = runs_of(c)
        return cache[c]

    got = {}
    for name in CI_NAMES:
        got[name] = {"state": "pending", "by": None, "running": False}
        for c in line + (older if name == "check" else []):
            rs = runs(c)
            if rs is None:
                break                           # can't be read now: pending, read again later
            mine = [x for x in rs if x.get("name") == name]
            if any(x.get("status") != "completed" for x in mine):
                got[name]["running"] = True
            done = [x for x in mine if x.get("status") == "completed" and x.get("conclusion") not in CI_UNFINISHED]
            if done:
                red = any(x.get("conclusion") in CI_RED for x in done)
                got[name] = {"state": "red" if red else "green", "by": c, "running": False}
                break
    states = [g["state"] for g in got.values()]
    verdict = "red" if "red" in states else "green" if all(s == "green" for s in states) else "pending"
    return verdict, got


FINAL_VERDICTS = ("green", "red", "missed")
TITLES_KEEP = 20


def subject(repo, sha):
    """A commit's title as the person knows it: its subject without the pull request's number ("UI 15: the review
    card says what happens (#188)" is "UI 15: the review card says what happens")."""
    ok, out, _ = git(repo, "log", "-1", "--format=%s", sha)
    return re.sub(r"\s*\(#\d+\)\s*$", "", out.strip()) if ok and out.strip() else None


def install_titles(repo, sha, since):
    """The titles of the merges an install brought (main's first-parent line since the install before), newest
    first; its own title when there is no install before it."""
    titles = []
    if since and state.SHA.match(since) and is_ancestor(repo, since, sha):
        ok, out, _ = git(repo, "log", "--first-parent", "--format=%H", f"{since}..{sha}")
        titles = [subject(repo, c) for c in out.splitlines()] if ok else []
    if not titles:
        titles = [subject(repo, sha)]
    return [t for t in titles if t][:TITLES_KEEP]


def track(st, sha, version, tag, run, titles=None):
    """An install of ours, recorded in `ci` as pending when it goes in: its CI is read from here, so it is never lost
    when the installs history (KEEP entries) moves on before CI answers. `titles`: what it brought, for the words."""
    ci = st.setdefault("ci", {})
    ci[sha] = {"verdict": "pending", "names": {}, "version": version, "tag": tag, "installed": state.stamp(),
               "run": run, "told": False, "titles": list(titles or [])}


def tracked(st):
    """[{sha, at, version, tag, run}] of every install of ours the state knows, oldest first: those in `ci` (each
    pending one stays there until its verdict is final) and those in the installs history."""
    out, seen = [], set()
    for sha, v in (st.get("ci") or {}).items():
        if v.get("installed") and state.SHA.match(sha):
            out.append({"sha": sha, "at": v["installed"], "version": v.get("version"), "tag": v.get("tag"),
                        "run": v.get("run")})
            seen.add(sha)
    for i in st.get("installs") or []:
        if i.get("path") == PATH and state.SHA.match(i.get("sha") or "") and i["sha"] not in seen:
            out.append({k: i.get(k) for k in ("sha", "at", "version", "tag", "run")})
            seen.add(i["sha"])
    return sorted(out, key=lambda i: str(i.get("at") or ""))


def ci_unresolved(st):
    """The installs of ours whose CI verdict isn't final yet, however many came after. Each one is final at the
    latest CI_MISSED_AFTER_S after its install (missed), so the list stays short."""
    ci = st.get("ci") or {}
    return [i["sha"] for i in tracked(st) if (ci.get(i["sha"]) or {}).get("verdict") not in FINAL_VERDICTS]


def age_s(at, now):
    try:
        return max(0.0, now - state.parse_stamp(at))
    except (TypeError, ValueError):
        return None


def late(st, now):
    """Installs told as missing within CI_LATE_S: read again, so a pass that comes later still moves the recovery
    point (and a failure that comes later is told)."""
    ci = st.get("ci") or {}
    out = []
    for i in tracked(st):
        if (ci.get(i["sha"]) or {}).get("verdict") == "missed":
            age = age_s(i.get("at"), now)
            if age is not None and age < CI_LATE_S:
                out.append(i["sha"])
    return out


def ci_read(p, repo, now=time.time, runs_of=None, busy=None):
    """Reads CI for each install of ours whose verdict isn't final yet (and each missing one of the last day),
    records it, and the recovery point. One read of main's runs (one GitHub call) serves every install. Returns
    {sha: "running" | "pending"} for those still without a verdict. "running": a run that covers it is on its way,
    or GitHub is still running something on main (its own run may wait in line behind it). An install becomes
    "missed" only once its runs were read, nothing is running, and CI_MISSED_AFTER_S has passed; a fetch or a read
    that fails leaves them for later."""
    with state.locked(p) as st:
        unresolved = set(ci_unresolved(st))
        again = set(late(st, now()))
        todo = [i for i in tracked(st) if i["sha"] in unresolved | again]
    if not todo:
        return {}
    try:
        tip = release.fetch_main(repo)
    except Refused:
        return {i["sha"]: "pending" for i in todo if i["sha"] in unresolved}
    read = True
    if runs_of is None:
        snap = shared_runs(p, now)
        read = snap is not None
        runs_of = (lambda c: None) if snap is None else (lambda c: snap.get(c, []))
        if busy is None:
            busy = any(r.get("status") != "completed" for rs in (snap or {}).values() for r in rs)
    seen, left = {}, {}
    for i in todo:
        verdict, names = ci_verdict(repo, i["sha"], tip, runs_of)
        for g in names.values():
            if g.get("state") == "red" and g.get("by"):
                g["title"] = subject(repo, g["by"])
        if i["sha"] in again:
            if verdict != "pending":
                seen[i["sha"]] = {"verdict": verdict, "names": names, "at": state.stamp(now()), "late": True}
            continue
        if verdict == "pending":
            running = bool(busy) or any(g.get("running") for g in names.values())
            age = age_s(i.get("at"), now())
            if read and not running and age is not None and age > CI_MISSED_AFTER_S:
                verdict = "missed"
            else:
                left[i["sha"]] = "running" if running else "pending"
        seen[i["sha"]] = {"verdict": verdict, "names": names, "version": i.get("version"), "tag": i.get("tag"),
                          "at": state.stamp(now())}
    with state.locked(p) as st:
        ci = st.setdefault("ci", {})
        for sha, v in seen.items():
            was, is_late = (ci.get(sha) or {}).get("verdict"), v.pop("late", False)
            if was in FINAL_VERDICTS and not (was == "missed" and is_late):
                continue                    # another read settled it meanwhile: never back to pending
            # a late verdict on a missing one: told again only when it failed (a pass just moves the recovery point)
            told = bool((ci.get(sha) or {}).get("told")) and not (was == "missed" and v["verdict"] == "red")
            ci[sha] = dict(ci.get(sha) or {}, **v, told=told)
        final = [sha for sha, v in ci.items() if v.get("verdict") in FINAL_VERDICTS]
        for sha in final[:-CI_KEEP] if len(final) > CI_KEEP else []:
            ci.pop(sha, None)               # only final ones go: a pending one stays until it is read
        st["recovery"] = recovery(st)
    return left


def recovery(st):
    """The newest install whose CI on main passed: a release sync's (its checks passed before it installed) or one of
    ours that CI has since passed. The person can ask to go back to it."""
    ci = st.get("ci") or {}
    for i in reversed(st.get("installs") or []):
        if i.get("path") != PATH or (ci.get(i.get("sha")) or {}).get("verdict") == "green":
            return {k: i.get(k) for k in ("sha", "version", "tag", "at")}
    return st.get("recovery")


# --- the words the person reads: plain, the fixes by their titles, never a commit's hash ---

CHECK_WORDS = {"check": "GitHub's Check", "fork-check": "the fork check"}
NAMED = 3                 # titles named in one sentence; the rest are "and n more"


def quoted(titles):
    titles = list(dict.fromkeys(t for t in titles if t))
    if not titles:
        return None
    named = ", ".join(f"“{t}”" for t in titles[:NAMED])
    return named + (f" and {len(titles) - NAMED} more" if len(titles) > NAMED else "")


def what_of(installs):
    """The installs, by the titles of the fixes they brought ("the install of “A”, “B” and 2 more"), else by version
    ("the install of 3.2.22", "5 installs of 3.2.22")."""
    titles = [t for _, v in installs for t in v.get("titles") or []]
    q = quoted(titles)
    if q:
        return f"the install of {q}"
    versions = list(dict.fromkeys(v.get("version") or "our merged work" for _, v in installs))
    return ("the install" if len(installs) == 1 else f"{len(installs)} installs") + f" of {', '.join(versions)}"


def back_words(rec):
    tag = (rec or {}).get("tag")
    return f" The last install CI passed is {tag}." if tag else ""


def missed_words(installs, rec):
    """One sentence for every install whose CI never gave a verdict, said once."""
    return (f"CI on main never gave a verdict on {what_of(installs)} within {CI_MISSED_AFTER_S // 3600} hours: "
            "nothing was rolled back.")


def failures(v):
    """The red checks of a verdict, as (check name, the commit its failed run was on): the failure itself, the same
    for every install whose verdict that one run decided (ci_verdict reads a later commit's run too)."""
    return tuple(sorted((n, str(g.get("by") or "")) for n, g in (v.get("names") or {}).items()
                        if g.get("state") == "red"))


def red_words(fails, installs, rec):
    """One sentence for one failure, however many of our installs it covers: which check failed and on which merge,
    by its title. CI never rolls anything back, whatever an install's health did earlier."""
    titles = {}
    for _, v in installs:
        for n, g in (v.get("names") or {}).items():
            if g.get("state") == "red" and g.get("by"):
                titles[(n, str(g["by"]))] = g.get("title")
    said = ", ".join(f"{CHECK_WORDS.get(n, n)} failed on “{titles[(n, by)]}”" if titles.get((n, by))
                     else f"{CHECK_WORDS.get(n, n)} failed" for n, by in fails) or "a check failed"
    return (f"CI on main failed after {what_of(installs)}: {said}. Nothing was rolled back: open a "
            "task to fix it.")


def ci_untold(st, mark=True, only=None):
    """[(sha, words or None)]: the red or missing CI results nobody was told of yet (of `only`'s shas, when given).
    A failure (one check, the commit its run failed on) is told once: every install it covers shares its sentence,
    on the first of them (the rest carry None; an install with two failures is in both), and a failure another
    install's words told already is said no more (its installs carry None, and are marked told with the rest). Every
    missing verdict not told yet shares one sentence. `mark`: each is marked told now; finish marks them in the same
    lock that lets go of the lease."""
    ci = st.get("ci") or {}
    told = {f for v in ci.values() if v.get("told") and v.get("verdict") == "red" for f in failures(v)}
    out, groups, missed = [], {}, []
    for sha, v in sorted(ci.items(), key=lambda kv: str(kv[1].get("installed") or "")):     # oldest install first
        if v.get("verdict") not in ("red", "missed") or v.get("told") or (only is not None and sha not in only):
            continue
        if v.get("verdict") == "missed":
            missed.append((sha, v))
            continue
        fails = [f for f in failures(v) if f not in told] if failures(v) else [None]   # None: red, no check named
        if not fails:
            out.append((sha, None))                      # told already, on another install's words
        for f in fails:
            groups.setdefault(f, []).append((sha, v))
    for f, installs in groups.items():
        out.append((installs[0][0], red_words((f,) if f else (), installs, st.get("recovery"))))
        out.extend((sha, None) for sha, _ in installs[1:])
    if missed:
        out.append((missed[0][0], missed_words(missed, st.get("recovery"))))
        out.extend((sha, None) for sha, _ in missed[1:])
    if mark:
        mark_told(st, [sha for sha, _ in out])
    return out


def mark_told(st, shas):
    for sha in shas:
        if sha in (st.get("ci") or {}):
            st["ci"][sha]["told"] = True


def run_installs(st, run):
    """The commits this run installed by our merges' policy, oldest first."""
    return [i["sha"] for i in tracked(st) if i.get("run") == run]


CI_WAIT_S = 30 * 60      # `ci` waits this long after each install of this run's for CI's verdict...
CI_BUSY_S = CI_MISSED_AFTER_S   # ...and this long while GitHub is still running on main (a later read still counts)


def with_ci_words(told, outcome, words, back=None):
    """A run's --told words with CI's results added; a run that had nothing to say then reports them. `back`: the
    recovery point's sentence, said once at the end, made by the caller from the recovery point as it is when the
    words are final (never earlier: a green read in between moves it)."""
    words = [w for w in words if w] + ([back] if back else [])    # None: an install another's words tell
    if not words:
        return told, outcome
    return " ".join(([told] if told else []) + list(words)), ("reported" if outcome == "nothing" else outcome)


def back_line(rec, failed):
    """The recovery point's sentence when a failure or a missing verdict is told now, else None."""
    return (back_words(rec).strip() or None) if failed else None


def still_untold(st, said):
    """Of [(sha, words)] read earlier, the ones nobody marked told since (another run's `ci` or finish may have), with
    their words made again under this lock: a failure another run told meanwhile is said no more."""
    return ci_untold(st, mark=False, only={sha for sha, _ in said})


def still_running_words(st, shas):
    """One plain sentence for this run's installs whose checks haven't finished when `ci` stops waiting."""
    ci = st.get("ci") or {}
    installs = [(sha, ci.get(sha) or {}) for sha in shas]
    return (f"GitHub's checks on main haven't finished for {what_of(installs)} yet: a later install tells you if "
            "they fail.")


def ci_step(p, run, folder, repo, cfg_hostname=None, now=time.time, sleep=time.sleep):
    """`ci`, after finish said next: ci. Reads CI for every install of ours whose verdict isn't final, with the lease
    let go (the next install never waits for it), once a minute. It waits for this run's own installs, each from its
    own install time: up to CI_WAIT_S, and up to CI_BUSY_S while GitHub is still running on main. Then
    the run's exact completion command: finish's words, plus a red or missing result not told yet, and one line for
    this run's installs whose checks are still running. A verdict that comes later is left for a later run."""
    with state.locked(p) as st:
        rep = dict((st.get("reports") or {}).get(run) or {})
    if not rep or rep.get("folder") != folder:
        raise Refused("finish didn't hand this run to ci: run finish", outcome="stop")
    shas = list(rep.get("ci") or [])
    with state.locked(p) as st:
        ats = {i["sha"]: i.get("at") for i in tracked(st) if i["sha"] in shas}
    began = now()
    while True:
        left = {s: how for s, how in ci_read(p, repo, now=now).items() if s in shas}

        def waits(s):
            age = age_s(ats.get(s), now())
            return age is not None and age < (CI_BUSY_S if left[s] == "running" else CI_WAIT_S)
        if not any(waits(s) for s in left):
            break
        if now() - began >= gate.call_wait_s():
            raise Refused("GitHub's checks on main haven't finished on this run's installs yet: call ci again now. "
                          "It reads GitHub itself, one call a minute shared by every run: never read or watch "
                          "GitHub's runs yourself", outcome="wait", pending=len(left))
        sleep(max(0.0, ci_poll_s()))
    with state.locked(p) as st:
        said = ci_untold(st, mark=False)
        late = [still_running_words(st, sorted(left, key=lambda s: str(ats.get(s) or "")))] if left else []
    told, outcome = with_ci_words(rep.get("told"), rep.get("outcome"), [w for _, w in said] + late)
    if told:
        from . import public
        found = public.problems(told, cfg_hostname)
        if found:
            raise Refused(f"the --told words carry {public.words(found)}", outcome="stop")
    with state.locked(p) as st:
        # told once per commit: whatever another run told meanwhile drops out (the words are a subset of the checked)
        kept = still_untold(st, said)
        mark_told(st, [sha for sha, _ in kept])
        failed = bool(rep.get("ci_said")) or any(w for _, w in kept)
        told, outcome = with_ci_words(rep.get("told"), rep.get("outcome"), [w for _, w in kept] + late,
                                      back=back_line(st.get("recovery"), failed))
        (st.get("reports") or {}).pop(run, None)
        ci = {sha: ((st.get("ci") or {}).get(sha) or {}).get("verdict") or "pending" for sha in shas}
        rec = st.get("recovery")
    return {"outcome": outcome, "ci": ci, "recovery": rec, "before": [],
            "command": gate.ready_cmd(run, folder, told), **({"told": told} if told else {})}
