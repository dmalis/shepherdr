"""What stands between a due schedule and its run (dmalis/shepherdr#229): a check first, and one run at a time.

- **A check** (`auto add|edit --check "<command>"`): when the schedule is due, the scheduler runs the command before it
  adds a task, as systemd's ExecCondition does: exit 0, there is work (the run starts, the command's output in its
  brief); 1 to 125, nothing to do (no task, no agent, no news: the run is recorded as checked); anything else (126 or
  127, can't run or not found; a signal; the time limit; it can't start) is a failed check. A failed check is said,
  never silent: the first one after a check that worked starts the run anyway, with the failure in its brief, so its
  agent does the run and says it; the ones after it in a row start nothing and are the schedule's error until a check
  works again. It runs in a thread of the scheduler, outside every lock, with what set it off in its environment;
  meanwhile the schedule is `checking`, and what sets it off joins that check (one task at most).
- **One run at a time** (`--fold`): while the schedule's last run is open (its task queued, scheduled or running),
  what sets it off is kept (`folded`); one run starts when that run ends, naming every reason (GitHub Actions'
  concurrency, Jenkins' queue). The first one starts at once.

Both are kept in the list, so a scheduler that re-execs keeps them: a `checking` schedule no thread here runs is
checked again with the same reasons. Run now goes around both: the person asked for a run.
"""

import datetime
import os
import signal
import subprocess
import threading

from .base import Fail, now

CHECK_TIMEOUT_S = 120
OUTPUT_KEPT = 4000
OPEN = ("working", "queued")    # run_ended() of a run whose task is still open
_running = set()                # (folder, schedule id) whose check a thread of this scheduler runs now
_lock = threading.Lock()


def set_fields(a, args):
    """--check and --fold, at add or edit (automations.set_auto_fields)."""
    check = getattr(args, "check", None)
    if check is not None:
        if check.strip():
            a["check"] = check.strip()
        else:
            # what waits on a check (`checking`) stays: the next round starts it without one (gate)
            for k in ("check", "check_failing"):
                a.pop(k, None)
            if (a.get("last_error") or {}).get("kind") == "check":
                a.pop("last_error")
    fold = getattr(args, "fold", None)
    if fold is not None:
        if fold:
            a["fold"] = True
        else:
            a.pop("fold", None)  # what was folded stays: the next round starts it (gate)
    if (a.get("check") or a.get("fold")) and (a.get("every") or {}).get("kind") == "once" and not a.get("on"):
        raise Fail("A one-off runs once: --check and --fold are for schedules that repeat or hear events.")


def words(a):
    """Its line's extra words in auto show / list."""
    out = []
    if a.get("check"):
        out.append("checks first")
    if a.get("fold"):
        out.append("one run at a time")
    if a.get("checking"):
        out.append("checking now")
    n = len((a.get("folded") or {}).get("whys") or [])
    if n:
        out.append(f"{n} waiting for its run to end")
    last = next((r for r in reversed(a.get("runs") or []) if r.get("nothing") == "check"), None)
    if last and last is (a.get("runs") or [None])[-1]:
        out.append(f"last checked {datetime.datetime.fromtimestamp(last['at'] / 1000):%H:%M}: nothing to do")
    return out


def run_open(s, a):
    """Whether this schedule's last run that added a task is still open."""
    from .automations import run_ended
    r = next((r for r in reversed(a.get("runs") or []) if r.get("task") and not r.get("error")), None)
    return bool(r) and run_ended(s, r) in OPEN


def gate(s, a, whys, report):
    """This round's reasons to run [(why, brief)] for schedule `a`, through its fold and its check. Fires what may run
    now; keeps the rest on the schedule. Without --check or --fold it fires each, as before."""
    from .automations import auto_ref, fire
    whys = [tuple(w) for w in whys]
    if a.get("checking") and not a.get("check"):
        # its check was taken away while reasons waited on it: they go on as if it never had one
        whys = [tuple(w) for w in a.pop("checking")["whys"]] + whys
        s.dirty = True
    if a.get("checking"):
        if whys:
            a["checking"]["whys"] = a["checking"]["whys"] + [list(w) for w in whys]
            s.dirty = True
        job(s, a, report)  # a check this scheduler doesn't run (it re-exec'd), or reasons it didn't see: asked again
        return
    if a.get("folded") and not a.get("fold"):
        whys = [tuple(w) for w in a.pop("folded")["whys"]] + whys  # --no-fold: what was folded goes on now
        s.dirty = True
    if a.get("fold"):
        if run_open(s, a):
            if whys:
                f = a.setdefault("folded", {"since": now(), "whys": []})
                f["whys"] = f["whys"] + [list(w) for w in whys]
                s.dirty = True
            return
        if a.get("folded"):
            whys = [tuple(w) for w in a.pop("folded")["whys"]] + whys
            s.dirty = True
    if not whys:
        return
    if a.get("check"):
        a["checking"] = {"since": now(), "whys": [list(w) for w in whys]}
        s.dirty = True
        job(s, a, report)
        return
    for why, brief in ([joined(whys)] if a.get("fold") else whys):
        t = fire(s, a, why, brief)
        report["fired"].append({"folder": s.loc["folder"], "automation": auto_ref(s, a), "task": s.ref(t), "why": why})


def joined(whys):
    """One run's (why, brief) for several reasons: each why, and each brief on its own line."""
    seen, ws, bs = set(), [], []
    for why, brief in whys:
        if why not in seen:
            seen.add(why)
            ws.append(why)
        if brief and brief not in bs:
            bs.append(brief)
    return "; ".join(ws), "\n".join(bs) or None


def job(s, a, report):
    """Asks for this schedule's check to run after the round (cmd_scheduler starts the threads), unless one runs."""
    key = (s.loc["folder"], a["id"])
    with _lock:
        if key in _running:
            return
    from .automations import auto_ref
    report.setdefault("checks", []).append({"folder": s.loc["folder"], "id": a["id"], "ref": auto_ref(s, a), "command": a["check"],
                                            "why": [w[0] for w in a["checking"]["whys"]], "last_run": a.get("last_run")})


def start_checks(report, wait=False):
    """The round's checks, each in a thread of its own (outside every lock). wait: until they are done (--once)."""
    threads = []
    for j in report.get("checks") or []:
        key = (j["folder"], j["id"])
        with _lock:
            if key in _running:
                continue
            _running.add(key)
        t = threading.Thread(target=check_then_run, args=(j, report), daemon=True)
        t.start()
        threads.append(t)
    if wait:
        for t in threads:
            t.join()
    return threads


def busy():
    """Whether a check of this scheduler runs or settles now (it re-execs only once none does)."""
    with _lock:
        return bool(_running)


def stop_group(p):
    """A check past its time: its whole process group (the shell and what it started) stopped, then reaped."""
    for sig, wait in ((signal.SIGTERM, 5), (signal.SIGKILL, 5)):
        try:
            os.killpg(p.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            return p.communicate(timeout=wait)
        except subprocess.TimeoutExpired:
            continue
    return None, None


def run_check(j):
    """(kind, words): ("work", its output), ("nothing", its first line) or ("failed", why)."""
    env = {**os.environ, "HERDR_TASK_SCHEDULE": str(j.get("ref") or j["id"]), "HERDR_TASK_WHY": "\n".join(j["why"]),
           "HERDR_TASK_LAST_RUN": str(j.get("last_run") or "")}
    try:
        p = subprocess.Popen(["sh", "-c", j["command"]], cwd=j["folder"], env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                             errors="replace", start_new_session=True)
    except OSError as e:
        return "failed", f"it couldn't start ({e.strerror or e})"
    try:
        stdout, stderr = p.communicate(timeout=CHECK_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        stop_group(p)
        return "failed", f"it took longer than {CHECK_TIMEOUT_S} s"
    out, code = (stdout or "").strip(), p.returncode
    if code == 0:
        return "work", out[-OUTPUT_KEPT:]
    if 1 <= code <= 125:
        return "nothing", (out.splitlines() or [""])[0][:200]
    last = ((stderr or "").strip().splitlines() or [""])[-1][:200]
    why = ("it couldn't run (126)" if code == 126 else "its command wasn't found (127)" if code == 127
           else f"it was stopped by signal {-code}" if code < 0 else f"it exited {code}")
    return "failed", why + (f": {last}" if last else "")


def check_then_run(j, report):
    key = (j["folder"], j["id"])
    try:
        kind, said = run_check(j)
        settle(j, kind, said, report)
    except Exception as e:  # one schedule's check never stops the scheduler
        print(f"check {j['folder']} {j['id']}: {e}", flush=True)
    finally:
        with _lock:
            _running.discard(key)


def settle(j, kind, said, report):
    """The check's answer, written to the schedule in its list (a run started, or recorded as checked)."""
    from .automations import RUNS_KEPT, auto_ref, fire, starts_runs
    from .store import Store, locate
    with Store(locate(j["folder"])) as s:
        a = next((x for x in s.data.get("automations") or [] if x.get("id") == j["id"]), None)
        if not a or not a.get("checking") or not a.get("check"):
            return  # gone, or its check was taken away meanwhile: the next round starts what waits without one
        if a.get("paused") or a.get("space_paused") or not starts_runs(s, a):
            a.pop("checking")  # paused, or Schedules off (Settings, Plugins): no run, as for a reason heard while off
            s.dirty = True
            return
        # only the reasons this check saw: one that came while it ran is checked again in the next round (gate, job)
        held = a["checking"]["whys"]
        seen, rest = held[:len(j["why"])], held[len(j["why"]):]
        if kind == "work" or (kind == "failed" and not a.get("check_failing")):
            seen, rest = held, []   # a run starts: it covers every reason that waits
        if rest:
            a["checking"] = {"since": now(), "whys": rest}
        else:
            a.pop("checking")
        s.dirty = True
        whys = [tuple(w) for w in seen]
        why, brief = joined(whys)
        # Triage's schedule (#235): a failed check alerts once and starts no run, its first failure too; a pause, the
        # plugin or the level switched off meanwhile starts none either
        from .triage import check_failed_alert, fire_refusal
        triage_said = fire_refusal(s, a) if isinstance(a.get("triage"), dict) else None
        if triage_said:
            a["runs"] = (a.get("runs") or [])[-(RUNS_KEPT - 1):] + [{"at": now(), "why": why, "nothing": "triage", "said": triage_said}]
            return
        if kind == "failed" and isinstance(a.get("triage"), dict) and not a.get("check_failing"):
            a["check_failing"] = {"since": now(), "message": said}
            check_failed_alert(a, said)
        if kind == "nothing" or (kind == "failed" and a.get("check_failing")):
            rec = {"at": now(), "why": why}
            if kind == "nothing":
                rec.update(nothing="check", **({"said": said} if said else {}))
                a.pop("check_failing", None)
                if (a.get("last_error") or {}).get("kind") == "check":
                    a.pop("last_error")
            else:
                rec["check_failed"] = said
                since = a["check_failing"]["since"]
                a["last_error"] = {"at": now(), "kind": "check", "message":
                                   f"Its check failed since {datetime.datetime.fromtimestamp(since / 1000):%H:%M}: {said}"}
            a["runs"] = (a.get("runs") or [])[-(RUNS_KEPT - 1):] + [rec]
            report.setdefault("checked", []).append({"folder": s.loc["folder"], "automation": auto_ref(s, a), "said": kind})
            return
        if kind == "work":
            a.pop("check_failing", None)
            note = "The schedule's check found:\n" + said if said else "The schedule's check found work."
        else:
            a["check_failing"] = {"since": now(), "message": said}
            note = (f"The schedule's check failed: {said}. So this run started anyway: do it as you would without the check, "
                    "and say in your finish that the check failed and why.")
        t = fire(s, a, why, f"{brief}\n\n{note}" if brief else note)
        if kind == "failed":
            a["last_error"] = {"at": now(), "kind": "check", "message": f"Its check failed: {said}"}
        elif (a.get("last_error") or {}).get("kind") == "check":
            a.pop("last_error")
        report["fired"].append({"folder": s.loc["folder"], "automation": auto_ref(s, a), "task": s.ref(t), "why": why})


