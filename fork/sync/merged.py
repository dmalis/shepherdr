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
- CI after the install: `ci` reads main's `check` and `fork-check` for each install of ours: the newest finished run
  covering that commit (cancelled and skipped runs don't count; CI cancels older main runs when main moves). A red
  or missing result is told once per commit (finish puts it in its --told words, for the Assistant to open a fix
  task); nothing rolls back on it. The newest install whose CI passed is kept as the recovery point."""
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

def ci_verdict(repo, sha, tip, runs_of=None):
    """("green" | "red" | "pending", {name: {"state", "by"}}): for each of main's checks, the newest finished run that
    covers `sha`: on it or a later commit of main's first-parent line, or, for `check` when its push trigger skips
    `sha`'s own push (paths-ignore), on an older commit whose code is the same."""
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
        got[name] = {"state": "pending", "by": None}
        for c in line + (older if name == "check" else []):
            rs = runs(c)
            if rs is None:
                break                           # can't be read now: pending, read again later
            done = [x for x in rs if x.get("name") == name and x.get("status") == "completed"
                    and x.get("conclusion") not in CI_UNFINISHED]
            if done:
                red = any(x.get("conclusion") in CI_RED for x in done)
                got[name] = {"state": "red" if red else "green", "by": c}
                break
    states = [g["state"] for g in got.values()]
    verdict = "red" if "red" in states else "green" if all(s == "green" for s in states) else "pending"
    return verdict, got


FINAL_VERDICTS = ("green", "red", "missed")


def track(st, sha, version, tag, run):
    """An install of ours, recorded in `ci` as pending when it goes in: its CI is read from here, so it is never lost
    when the installs history (KEEP entries) moves on before CI answers."""
    ci = st.setdefault("ci", {})
    ci[sha] = {"verdict": "pending", "names": {}, "version": version, "tag": tag, "installed": state.stamp(),
               "run": run, "told": False}


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


def ci_read(p, repo, now=time.time, runs_of=None):
    """Reads CI for each install of ours whose verdict isn't final yet, records it, and the recovery point. Returns
    the shas still pending. Nothing when there is nothing to read; a fetch that fails leaves them for later."""
    with state.locked(p) as st:
        todo = [i for i in tracked(st) if i["sha"] in ci_unresolved(st)]
    if not todo:
        return []
    try:
        tip = release.fetch_main(repo)
    except Refused:
        return [i["sha"] for i in todo]
    seen = {}
    for i in todo:
        verdict, names = ci_verdict(repo, i["sha"], tip, runs_of)
        if verdict == "pending":
            try:
                age = now() - state.parse_stamp(i.get("at"))
            except (TypeError, ValueError):
                age = 0
            if age > CI_MISSED_AFTER_S:
                verdict = "missed"
        seen[i["sha"]] = {"verdict": verdict, "names": names, "version": i.get("version"), "tag": i.get("tag"),
                          "at": state.stamp(now())}
    with state.locked(p) as st:
        ci = st.setdefault("ci", {})
        for sha, v in seen.items():
            if (ci.get(sha) or {}).get("verdict") in FINAL_VERDICTS:
                continue                    # another read settled it meanwhile: never back to pending
            ci[sha] = dict(ci.get(sha) or {}, **v, told=bool((ci.get(sha) or {}).get("told")))
        final = [sha for sha, v in ci.items() if v.get("verdict") in FINAL_VERDICTS]
        for sha in final[:-CI_KEEP] if len(final) > CI_KEEP else []:
            ci.pop(sha, None)               # only final ones go: a pending one stays until it is read
        st["recovery"] = recovery(st)
    return [sha for sha, v in seen.items() if v["verdict"] == "pending"]


def recovery(st):
    """The newest install whose CI on main passed: a release sync's (its checks passed before it installed) or one of
    ours that CI has since passed. The person can ask to go back to it."""
    ci = st.get("ci") or {}
    for i in reversed(st.get("installs") or []):
        if i.get("path") != PATH or (ci.get(i.get("sha")) or {}).get("verdict") == "green":
            return {k: i.get(k) for k in ("sha", "version", "tag", "at")}
    return st.get("recovery")


def ci_words(v, sha, rec):
    what = f"the install of {v.get('version') or 'our merged work'} ({sha[:12]})"
    back = f" The last install CI passed is {rec.get('tag') or str(rec.get('sha'))[:12]}." if rec else ""
    if v.get("verdict") == "missed":
        return f"CI on main never reported on {what} within {CI_MISSED_AFTER_S // 3600} hours.{back}"
    return red_words(failures(v), [(sha, v)], rec)


def failures(v):
    """The red checks of a verdict, as (check name, the commit its failed run was on): the failure itself, the same
    for every install whose verdict that one run decided (ci_verdict reads a later commit's run too)."""
    return tuple(sorted((n, str(g.get("by") or "")) for n, g in (v.get("names") or {}).items()
                        if g.get("state") == "red"))


def red_words(fails, installs, rec):
    """One sentence for one failure, however many of our installs it covers: the check and the commit it failed on.
    CI never rolls anything back, whatever an install's health did earlier."""
    back = f" The last install CI passed is {rec.get('tag') or str(rec.get('sha'))[:12]}." if rec else ""
    if len(installs) == 1:
        sha, v = installs[0]
        what = f"the install of {v.get('version') or 'our merged work'} ({sha[:12]})"
    else:
        versions = list(dict.fromkeys(v.get("version") or "our merged work" for _, v in installs))
        what = f"{len(installs)} installs of {', '.join(versions)} (the newest {installs[-1][0][:12]})"
    said = ", ".join(f"{n} failed on {by[:12]}" for n, by in fails) or "a check failed"
    return f"CI on main failed after {what}: {said}. CI never rolls back: open a task to fix it.{back}"




def ci_untold(st, mark=True, only=None):
    """[(sha, words or None)]: the red or missing CI results nobody was told of yet (of `only`'s shas, when given).
    A failure is told once: the installs one failed run covers share one sentence, on the first of them (the rest
    carry None), and a failure another install's words told already is said no more (its installs carry None, and
    are marked told with the rest). `mark`: each is marked told now; finish marks them in the same lock that lets go
    of the lease."""
    ci = st.get("ci") or {}
    told = {f for v in ci.values() if v.get("told") and v.get("verdict") == "red" for f in failures(v)}
    out, groups = [], {}
    for sha, v in ci.items():
        if v.get("verdict") not in ("red", "missed") or v.get("told") or (only is not None and sha not in only):
            continue
        if v.get("verdict") == "missed":
            out.append((sha, ci_words(v, sha, st.get("recovery"))))
            continue
        fails = tuple(f for f in failures(v) if f not in told) if failures(v) else ()
        if failures(v) and not fails:
            out.append((sha, None))                      # told already, on another install's words
            continue
        groups.setdefault(fails, []).append((sha, v))
    for fails, installs in groups.items():
        out.append((installs[0][0], red_words(fails, installs, st.get("recovery"))))
        out.extend((sha, None) for sha, _ in installs[1:])
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


CI_WAIT_S = 30 * 60      # a run waits this long after its install for CI's verdict; a later run tells what comes after




def with_ci_words(told, outcome, words):
    """A run's --told words with CI's results added; a run that had nothing to say then reports them."""
    words = [w for w in words if w]                # an install whose failure another's words tell: None
    if not words:
        return told, outcome
    return " ".join(([told] if told else []) + list(words)), ("reported" if outcome == "nothing" else outcome)


def still_untold(st, said):
    """Of [(sha, words)] read earlier, the ones nobody marked told since (another run's `ci` or finish may have), with
    their words made again under this lock: a failure another run told meanwhile is said no more."""
    return ci_untold(st, mark=False, only={sha for sha, _ in said})


def ci_step(p, run, folder, repo, cfg_hostname=None, now=time.time, sleep=time.sleep):
    """`ci`, after finish said next: ci. Reads CI for every install of ours whose verdict isn't final, with the lease
    let go (the next install never waits for it), waiting for this run's own installs up to CI_WAIT_S after the last
    one; then the run's exact completion command: finish's words, plus a red or missing result not told yet. A verdict
    that comes later is left for a later run to tell."""
    with state.locked(p) as st:
        rep = dict((st.get("reports") or {}).get(run) or {})
    if not rep or rep.get("folder") != folder:
        raise Refused("finish didn't hand this run to ci: run finish", outcome="stop")
    shas = list(rep.get("ci") or [])
    with state.locked(p) as st:
        ats = [i.get("at") for i in tracked(st) if i["sha"] in shas]
    try:
        newest = max(state.parse_stamp(a) for a in ats)        # the last install of this run's
    except (TypeError, ValueError):
        newest = 0
    began = now()
    while True:
        left = set(ci_read(p, repo, now=now)) & set(shas)
        if not left or now() - newest >= CI_WAIT_S:
            break
        if now() - began >= gate.call_wait_s():
            raise Refused(f"CI on main hasn't reported on {', '.join(s[:12] for s in sorted(left))} yet: call ci again",
                          outcome="wait", pending=sorted(left))
        sleep(max(0.0, gate.poll_s()))
    late = [f"CI on main hadn't reported on {sha[:12]} {CI_WAIT_S // 60} minutes after its install: a later run "
            "tells its result." for sha in sorted(left)]
    with state.locked(p) as st:
        said = ci_untold(st, mark=False)
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
        told, outcome = with_ci_words(rep.get("told"), rep.get("outcome"), [w for _, w in kept] + late)
        (st.get("reports") or {}).pop(run, None)
        ci = {sha: ((st.get("ci") or {}).get(sha) or {}).get("verdict") or "pending" for sha in shas}
        rec = st.get("recovery")
    return {"outcome": outcome, "ci": ci, "recovery": rec, "before": [],
            "command": gate.ready_cmd(run, folder, told), **({"told": told} if told else {})}
