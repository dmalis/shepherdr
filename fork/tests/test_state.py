"""The sync's state (fork/sync/state.py) and fork/bin/sync's state-only steps (fork/specs/sync-pipeline.md, build
task 1): atomic writes, the flock, the lease and the phases. Two writers never lose an update, a crash between phases
is resumed where it stopped, and a lease is taken over only from a done or missing owner."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import json  # noqa: E402
import shutil  # noqa: E402
import signal  # noqa: E402
import socket  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import state  # noqa: E402
from sync.state import Refused  # noqa: E402

SYNC = os.path.join(ROOT, "fork", "bin", "sync")
A_SHA = "a" * 40
B_SHA = "b" * 40

# A child process that works on the state the way a fork/bin/sync call does; argv: fork dir, root, then the job.
CHILD = r"""
import os, signal, sys
sys.path.insert(0, sys.argv[1])
from sync import state
p = state.Paths(sys.argv[2])
job = sys.argv[3]
if job == "count":
    for _ in range(int(sys.argv[4])):
        with state.locked(p) as st:
            n = st.get("test_count", 0)
            st["test_count"] = n + 1
elif job == "hold-lock":
    with state.locked(p) as st:
        open(sys.argv[4], "w").close()
        import time; time.sleep(float(sys.argv[5]))
elif job == "die-between-phases":
    # run A takes the lease and gets to installing, then dies inside its next step, before it is saved
    with state.locked(p) as st:
        state.take_lease(st, "RUN-A", "/space")
        for ph in ("selected", "tried", "installing"):
            state.set_phase(st, ph)
    with state.locked(p) as st:
        state.set_phase(st, "installed")
        os.kill(os.getpid(), signal.SIGKILL)
elif job == "die-mid-write":
    with state.locked(p) as st:
        state.set_phase(st, "selected")
    def killed(*a):
        os.kill(os.getpid(), signal.SIGKILL)
    os.replace = killed
    with state.locked(p) as st:
        state.set_phase(st, "tried")
"""


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fork-state-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        os.makedirs(self.root)
        self.p = state.Paths(self.root)
        self.child_py = os.path.join(self.tmp, "child.py")
        with open(self.child_py, "w") as f:
            f.write(CHILD)

    def child(self, *args, wait=True):
        argv = [sys.executable, self.child_py, os.path.join(ROOT, "fork"), self.root, *map(str, args)]
        if wait:
            return subprocess.run(argv, capture_output=True, text=True, timeout=60)
        return subprocess.Popen(argv)

    def write(self, data):
        state.save(self.p, data)


class AtomicWrites(Base):
    def test_fresh_state_until_written(self):
        self.assertFalse(os.path.exists(self.p.state))
        self.assertEqual(state.load(self.p), state.fresh())
        with state.locked(self.p):
            pass
        self.assertFalse(os.path.exists(self.p.state), "a call that changes nothing writes nothing")

    def test_saved_whole_and_private(self):
        with state.locked(self.p) as st:
            state.set_phase(st, "selected", now=0)
        with open(self.p.state) as f:
            self.assertEqual(json.load(f)["phase"], "selected")
        self.assertEqual(os.stat(self.p.state).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(self.p.dir).st_mode & 0o777, 0o700)

    def test_failed_step_writes_nothing(self):
        with state.locked(self.p) as st:
            state.set_phase(st, "selected")
        with self.assertRaises(Refused):
            with state.locked(self.p) as st:
                state.set_phase(st, "tried")
                raise Refused("the step failed")
        self.assertEqual(state.load(self.p)["phase"], "selected")

    def test_failed_rename_keeps_the_old_state(self):
        with state.locked(self.p) as st:
            state.set_phase(st, "selected")
        with mock.patch("os.replace", side_effect=OSError("disk full")), self.assertRaises(OSError):
            with state.locked(self.p) as st:
                state.set_phase(st, "tried")
        self.assertEqual(state.load(self.p)["phase"], "selected")
        self.assertEqual([f for f in os.listdir(self.p.dir) if f.endswith(".tmp")], [], "its temp file is removed")

    def test_unreadable_state_is_a_stop_never_overwritten(self):
        os.makedirs(self.p.dir)
        with open(self.p.state, "w") as f:
            f.write('{"phase": "install')
        with self.assertRaises(Refused) as e:
            with state.locked(self.p) as st:
                state.set_phase(st, "selected")
        self.assertEqual(e.exception.fields["outcome"], "stop")
        self.assertNotIn(self.root, e.exception.why, "no home path in the words")
        with open(self.p.state) as f:
            self.assertEqual(f.read(), '{"phase": "install')

    def test_newer_state_is_a_stop(self):
        self.write(dict(state.fresh(), version=state.VERSION + 1))
        with self.assertRaises(Refused):
            state.load(self.p)

    def test_older_state_gains_new_keys_and_keeps_unknown_ones(self):
        self.write({"version": 1, "phase": "healthy", "later_key": 3})
        st = state.load(self.p)
        self.assertEqual((st["phase"], st["later_key"], st["quarantine"]), ("healthy", 3, []))


class TwoWriters(Base):
    def test_no_update_is_lost(self):
        """Two calls doing read-modify-write at once: every increment lands."""
        procs = [self.child("count", 150, wait=False) for _ in range(2)]
        for pr in procs:
            self.assertEqual(pr.wait(timeout=120), 0)
        self.assertEqual(state.load(self.p)["test_count"], 300)

    def test_second_writer_waits_for_the_first(self):
        flag = os.path.join(self.tmp, "holding")
        holder = self.child("hold-lock", flag, 1.5, wait=False)
        self.addCleanup(holder.kill)
        deadline = time.time() + 30
        while not os.path.exists(flag) and time.time() < deadline:
            time.sleep(0.02)
        with self.assertRaises(Refused) as e:
            with state.locked(self.p, wait=0.2):
                pass
        self.assertIn("locked", e.exception.why)
        t0 = time.monotonic()
        with state.locked(self.p, wait=30) as st:
            st["after"] = True
        self.assertGreater(time.monotonic() - t0, 0.5, "it waited for the holder")
        self.assertEqual(holder.wait(timeout=30), 0)
        self.assertTrue(state.load(self.p)["after"])


class CrashBetweenPhases(Base):
    def test_killed_inside_a_step_keeps_the_last_phase_and_frees_the_lock(self):
        r = self.child("die-between-phases")
        self.assertEqual(r.returncode, -signal.SIGKILL, r.stderr)
        st = state.load(self.p)
        self.assertEqual(st["phase"], "installing", "the unsaved installed never landed")
        self.assertEqual(st["lease"]["run"], "RUN-A")
        with state.locked(self.p, wait=2):   # the kernel let go of the dead run's flock
            pass

    def test_killed_mid_write_leaves_the_last_whole_state(self):
        r = self.child("die-mid-write")
        self.assertEqual(r.returncode, -signal.SIGKILL, r.stderr)
        self.assertEqual(state.load(self.p)["phase"], "selected")
        with state.locked(self.p, wait=2) as st:
            state.set_phase(st, "tried")
        self.assertEqual(state.load(self.p)["phase"], "tried")

    def test_next_run_resumes_where_the_dead_one_stopped(self):
        self.child("die-between-phases")
        seen = []
        with state.locked(self.p) as st:
            took = state.take_lease(st, "RUN-B", "/space", owner=lambda r, f: seen.append((r, f)) or "done")
            self.assertEqual(seen, [("RUN-A", "/space")])
            self.assertEqual(took, {"run": "RUN-A", "was": "done"})
            self.assertEqual(state.resume_point(st), "installing")
            with self.assertRaises(Refused):
                state.set_phase(st, "selected")   # never a new selection while the install may have moved
            state.set_phase(st, "installed")
        st = state.load(self.p)
        self.assertEqual((st["lease"]["run"], st["phase"]), ("RUN-B", "installed"))


class Phases(unittest.TestCase):
    def go(self, *phases, start=None):
        st = dict(state.fresh(), phase=start)
        for ph in phases:
            state.set_phase(st, ph)
        return st

    def test_the_paths(self):
        self.go("selected", "branch-pushed", "tried", "merged", "installing", "installed", "healthy", "selected")
        self.go("selected", "tried", "installing", "rolling-back", "rolled-back", "selected")   # main beyond baseline
        self.go("selected", "tried", "merged", "held", "selected")
        self.go("held")   # a stop before selection, e.g. a baseline mismatch
        self.go("installing", "installed", "rolling-back", "broken", start="tried")
        self.go("selected", "selected")   # writing the phase a run is in is a resume

    def test_refused(self):
        for start, to in (("selected", "installing"), ("installing", "selected"), ("installing", "held"),
                          ("installed", "selected"), ("rolling-back", "healthy"), ("broken", "selected"),
                          ("broken", "rolled-back"), (None, "tried"), ("healthy", "installing"), ("merged", "tried")):
            with self.subTest(start=start, to=to), self.assertRaises(Refused):
                self.go(to, start=start)
        with self.assertRaises(ValueError):
            self.go("done")

    def test_resume_point(self):
        for ph in state.PHASES:
            st = dict(state.fresh(), phase=ph)
            self.assertEqual(state.resume_point(st), None if ph in ("healthy", "rolled-back", "held") else ph)
        self.assertIsNone(state.resume_point(state.fresh()))

    def test_every_phase_has_its_rule(self):
        self.assertEqual(set(state.AFTER), set(state.PHASES))


class Lease(unittest.TestCase):
    def owner(self, answer):
        calls = []

        def look(run, folder):
            calls.append(run)
            return answer
        return look, calls

    def leased(self, phase=None):
        return dict(state.fresh(), phase=phase, lease={"run": "RUN-A", "folder": "/space", "at": state.stamp(0)})

    def test_free_lease_is_taken_without_asking(self):
        st = state.fresh()
        look, calls = self.owner("open")
        self.assertIsNone(state.take_lease(st, "RUN-B", "/space", owner=look, now=60))
        self.assertEqual(st["lease"], {"run": "RUN-B", "folder": "/space", "at": "1970-01-01T00:01:00Z"})
        self.assertEqual(calls, [])

    def test_open_owner_keeps_it(self):
        for answer in ("open", "unknown"):
            with self.subTest(answer=answer):
                st = self.leased("installing")
                look, calls = self.owner(answer)
                with self.assertRaises(Refused) as e:
                    state.take_lease(st, "RUN-B", "/space", owner=look)
                self.assertEqual(e.exception.fields["outcome"], "nothing")
                self.assertEqual(st["lease"]["run"], "RUN-A")
                self.assertEqual(calls, ["RUN-A"])

    def test_only_a_done_or_missing_owner_is_taken_over(self):
        for answer in ("done", "missing"):
            for phase in (None, "healthy", "tried", "installing", "rolling-back"):
                with self.subTest(answer=answer, phase=phase):
                    st = self.leased(phase)
                    look, _ = self.owner(answer)
                    took = state.take_lease(st, "RUN-B", "/space", owner=look)
                    self.assertEqual(took, {"run": "RUN-A", "was": answer})
                    self.assertEqual(st["lease"]["run"], "RUN-B")
                    self.assertEqual(state.resume_point(st), phase if phase not in (None, "healthy") else None)

    def test_same_run_again_keeps_its_lease(self):
        st = self.leased("tried")
        look, calls = self.owner("open")
        self.assertIsNone(state.take_lease(st, "RUN-A", "/space", owner=look, now=999))
        self.assertEqual((st["lease"]["at"], calls), ("1970-01-01T00:00:00Z", []))

    def test_same_key_in_another_space_is_another_run(self):
        st = self.leased()
        look, calls = self.owner("open")
        with self.assertRaises(Refused):
            state.take_lease(st, "RUN-A", "/other", owner=look)

    def test_let_go_only_on_a_final_phase(self):
        for phase in ("installing", "rolling-back", "broken", "tried"):
            with self.subTest(phase=phase), self.assertRaises(Refused):
                state.release_lease(self.leased(phase), "RUN-A", "/space")
        for phase in ("healthy", "rolled-back", "held", None):
            st = self.leased(phase)
            state.release_lease(st, "RUN-A", "/space")
            self.assertIsNone(st["lease"])
        with self.assertRaises(Refused):
            state.release_lease(self.leased("healthy"), "RUN-B", "/space")


class OwnerFromHerdrTask(unittest.TestCase):
    """take_lease's default reads the owner with `herdr-task show <key> --folder <space> --json` (a fake here)."""

    def setUp(self):
        self.bin = tempfile.mkdtemp(prefix="fork-bin-")
        self.addCleanup(shutil.rmtree, self.bin, True)

    def fake(self, script):
        p = os.path.join(self.bin, "herdr-task")
        with open(p, "w") as f:
            f.write("#!/bin/sh\n" + script + "\n")
        os.chmod(p, 0o755)
        return mock.patch.dict(os.environ, {"PATH": self.bin + os.pathsep + os.environ["PATH"]})

    def test_states(self):
        for script, want in (
                ('echo \'{"id": 3, "state": "done"}\'', "done"),
                ('echo \'{"id": 3, "state": "running"}\'', "open"),
                ('echo \'{"id": 3, "state": "todo"}\'', "open"),
                ('echo "No task \\"RUN-A\\" in ~/space." >&2; exit 1', "missing"),
                ('echo "herdr-task broke" >&2; exit 1', "unknown"),
                ('echo "not json"', "unknown"),
                ('echo "{}"', "unknown")):
            with self.subTest(want=want), self.fake(script):
                self.assertEqual(state.task_state("RUN-A", "/space"), want)

    def test_asks_by_key_and_folder(self):
        log = os.path.join(self.bin, "log")
        with self.fake(f'echo "$@" > {log}; echo \'{{"state": "done"}}\''):
            state.task_state("RUN-A", "/space")
        with open(log) as f:
            self.assertEqual(f.read().split(), ["show", "RUN-A", "--folder", "/space", "--json"])


class Held(unittest.TestCase):
    def test_one_record_per_blocker_moving_with_the_release(self):
        st = state.fresh()
        rec, new = state.hold(st, "v3.2.22", A_SHA, "conflict", "7", "a patch doesn't fit", now=0, files=["bin/x"])
        self.assertTrue(new)
        state.ask(st, "7", "RUN-A", "/space", now=state.QUESTION_AFTER_S + 100)
        rec2, new = state.hold(st, "v3.2.23", B_SHA, "draft", "7", "still", now=5000, branch="sync/v3.2.23",
                               head=B_SHA, pr=12)
        self.assertFalse(new)
        self.assertIs(rec2, rec)
        self.assertEqual(rec["release"], {"tag": "v3.2.23", "sha": B_SHA})
        self.assertEqual(rec["first_seen"], state.stamp(0))
        self.assertEqual(rec["question"]["asked_at"], state.stamp(state.QUESTION_AFTER_S + 100))
        self.assertIsNone(rec["files"])
        _, new = state.hold(st, "v3.2.23", B_SHA, "gate", "check", now=6000)
        self.assertTrue(new)
        self.assertEqual([h["blocker"] for h in st["held"]], ["7", "check"])
        state.clear_held(st, "7")
        self.assertEqual([h["blocker"] for h in st["held"]], ["check"])

    def test_refused(self):
        for args, extra in ((("3.2.22", A_SHA, "gate", "x"), {}), (("v3.2.22", "abc", "gate", "x"), {}),
                            (("v3.2.22", A_SHA, "other", "x"), {}), (("v3.2.22", A_SHA, "gate", ""), {}),
                            (("v3.2.22", A_SHA, "draft", "x"), {"branch": "sync/v3.2.22"}),
                            (("v3.2.22", A_SHA, "conflict", "x"), {})):
            with self.subTest(args=args), self.assertRaises(Refused):
                state.hold(state.fresh(), *args, **extra)

    def test_the_24_hour_question(self):
        st = state.fresh()
        rec, _ = state.hold(st, "v3.2.22", A_SHA, "trial", "trial", now=0)
        day = state.QUESTION_AFTER_S
        is_open, done = (lambda r, f: "open"), (lambda r, f: "done")
        self.assertFalse(state.question_due(rec, now=day - 1))
        with self.assertRaises(Refused):
            state.ask(st, "trial", "RUN-A", "/space", now=day - 1)   # not yet 24 hours
        self.assertIsNone(rec["question"])
        self.assertTrue(state.question_due(rec, now=day + 1))
        state.ask(st, "trial", "RUN-A", "/space", now=day + 1)
        self.assertFalse(state.question_due(rec, now=day * 2, owner=is_open), "the asking run waits")
        with self.assertRaises(Refused):
            state.ask(st, "trial", "RUN-B", "/space", now=day * 2, owner=is_open)   # not while the asker is open
        self.assertTrue(state.question_due(rec, now=day * 2, owner=done), "asked once more")
        state.ask(st, "trial", "RUN-B", "/space", now=day * 2, owner=done)
        self.assertEqual(rec["question"]["asks"], 2)
        self.assertFalse(state.question_due(rec, now=day * 3, owner=done), "never a third time")
        with self.assertRaises(Refused):
            state.ask(st, "trial", "RUN-C", "/space", now=day * 3, owner=done)
        state.answer(st, "trial", "wait")
        self.assertFalse(state.question_due(rec, now=day * 9, owner=done))

    def test_asking_again_from_the_same_run_keeps_the_retry(self):
        st = state.fresh()
        rec, _ = state.hold(st, "v3.2.22", A_SHA, "trial", "trial", now=0)
        day = state.QUESTION_AFTER_S
        state.ask(st, "trial", "RUN-A", "/space", now=day + 1)
        for _ in range(3):
            state.ask(st, "trial", "RUN-A", "/space", now=day + 50, owner=lambda r, f: self.fail("no lookup"))
        self.assertEqual((rec["question"]["asks"], rec["question"]["asked_at"]), (1, state.stamp(day + 1)))
        self.assertTrue(state.question_due(rec, now=day * 2, owner=lambda r, f: "done"), "its successor asks once more")
        state.ask(st, "trial", "RUN-B", "/space", now=day * 2, owner=lambda r, f: "done")
        self.assertEqual(rec["question"]["run"], "RUN-B")

    def test_answered_is_kept(self):
        st = state.fresh()
        state.hold(st, "v3.2.22", A_SHA, "trial", "trial", now=0)
        state.ask(st, "trial", "RUN-A", "/space", now=state.QUESTION_AFTER_S + 1)
        state.answer(st, "trial", "wait")
        rec, _ = state.hold(st, "v3.2.23", B_SHA, "trial", "trial")
        self.assertEqual(rec["question"]["answer"], "wait")
        with self.assertRaises(Refused):
            state.ask(st, "trial", "RUN-B", "/space")


class Quarantine(unittest.TestCase):
    def test_once_per_sha(self):
        st = state.fresh()
        state.quarantine(st, A_SHA, "health", now=0)
        state.quarantine(st, A_SHA, "trial", now=1)
        self.assertEqual(st["quarantine"], [{"sha": A_SHA, "step": "health", "at": state.stamp(0)}])
        self.assertTrue(state.quarantined(st, A_SHA))
        self.assertIsNone(state.quarantined(st, B_SHA))
        with self.assertRaises(Refused):
            state.quarantine(st, "main", "trial")


class ClearBroken(unittest.TestCase):
    def test_person_only(self):
        st = dict(state.fresh(), phase="broken", lease={"run": "RUN-A", "folder": "/space", "at": state.stamp(0)})
        with self.assertRaises(Refused):
            state.clear_broken(st, env={"HERDR_GUARD_SESSION": "shepherdr"})
        self.assertEqual(st["phase"], "broken")
        state.clear_broken(st, env={})
        self.assertEqual((st["phase"], st["lease"]), (None, None))
        with self.assertRaises(Refused):
            state.clear_broken(st, env={})


class Machine(Base):
    def test_config(self):
        with self.assertRaises(Refused) as e:
            state.config(self.p)
        self.assertIn("~/.config/shepherdr-fork/sync.json", e.exception.why)
        os.makedirs(os.path.dirname(self.p.config))
        with open(self.p.config, "w") as f:
            json.dump({"hostname": "box"}, f)
        with self.assertRaises(Refused) as e:
            state.config(self.p)
        self.assertIn("install_folder", e.exception.why)
        cfg = {"hostname": "box", "install_folder": "/x", "time_zone": "UTC"}
        with open(self.p.config, "w") as f:
            json.dump(cfg, f)
        self.assertEqual(state.config(self.p), cfg)
        state.check_machine(cfg, hostname="box")
        with self.assertRaises(Refused) as e:
            state.check_machine(cfg, hostname="other")
        self.assertNotIn("box", e.exception.why)


# --- fork/bin/sync, as the run's agent calls it ---

class SyncCommand(Base):
    """fork/bin/sync's state-only steps, end to end: a real scratch git repo for the space, fakes for gh and
    herdr-task first on PATH, and --root on a scratch folder."""

    def setUp(self):
        super().setUp()
        self.space = os.path.join(self.tmp, "space")
        self.git("init", "-q", "-b", "main", self.space, cwd=self.tmp)
        self.git("commit", "-q", "--allow-empty", "-m", "start")
        self.git("remote", "add", "origin", "https://github.com/dmalis/shepherdr.git")
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        self.tasks = os.path.join(self.tmp, "tasks.json")
        self.set_tasks({})
        self.fake("gh", 'echo "${FAKE_GH_DEFAULT-dmalis/shepherdr}"')
        # herdr-task show <key> --folder <space> --json: the state tasks.json gives the key, else "No task"
        self.fake("herdr-task", f"import json, sys\nt = json.load(open({self.tasks!r})).get(sys.argv[2])\n"
                                "if t is None:\n    sys.exit('No task ' + sys.argv[2])\n"
                                "print(json.dumps({'state': t}))", shebang="#!" + sys.executable)
        self.set_config(socket.gethostname())

    def git(self, *args, cwd=None):
        subprocess.run(["git", *args], cwd=cwd or self.space, check=True, capture_output=True)

    def fake(self, name, body, shebang="#!/bin/sh"):
        p = os.path.join(self.bin, name)
        with open(p, "w") as f:
            f.write(shebang + "\n" + body + "\n")
        os.chmod(p, 0o755)

    def set_tasks(self, tasks):
        with open(self.tasks, "w") as f:
            json.dump(tasks, f)

    def set_config(self, hostname):
        os.makedirs(os.path.dirname(self.p.config), exist_ok=True)
        with open(self.p.config, "w") as f:
            json.dump({"hostname": hostname, "install_folder": "/nowhere", "time_zone": "UTC"}, f)

    def sync(self, *args, env=None, run="RUN-B"):
        e = {k: v for k, v in os.environ.items() if k != "HERDR_GUARD_SESSION"}
        e["PATH"] = self.bin + os.pathsep + e["PATH"]
        e.update(env or {})
        argv = [sys.executable, SYNC, *args, "--root", self.root]
        if args and args[0] in ("preflight", "hold"):
            argv += ["--run", run, "--folder", self.space]
        r = subprocess.run(argv, capture_output=True, text=True, env=e, timeout=60)
        lines = r.stdout.splitlines()
        self.assertEqual(len(lines), 1, f"one JSON line: {r.stdout!r} {r.stderr!r}")
        out = json.loads(lines[0])
        self.assertEqual(out["ok"], r.returncode == 0, out)
        self.assertNotIn(self.root, lines[0], "no home path in the line")
        return r.returncode, out

    def test_preflight_takes_the_lease(self):
        code, out = self.sync("preflight")
        self.assertEqual(code, 0, out)
        self.assertEqual((out["step"], out["resume"], out["took_over"]), ("preflight", None, None))
        self.assertEqual(state.load(self.p)["lease"]["run"], "RUN-B")
        code, out = self.sync("preflight")
        self.assertEqual(code, 0, "the same run again")

    def test_preflight_waits_for_an_open_owner_then_resumes_a_done_one(self):
        st = dict(state.fresh(), phase="installing", lease={"run": "RUN-A", "folder": self.space, "at": state.stamp()})
        self.write(st)
        self.set_tasks({"RUN-A": "running"})
        code, out = self.sync("preflight")
        self.assertEqual((code, out["outcome"]), (1, "nothing"))
        self.assertEqual(state.load(self.p)["lease"]["run"], "RUN-A")
        self.set_tasks({"RUN-A": "done"})
        code, out = self.sync("preflight")
        self.assertEqual(code, 0, out)
        self.assertEqual((out["resume"], out["took_over"]), ("installing", {"run": "RUN-A", "was": "done"}))
        self.set_tasks({})
        code, out = self.sync("preflight", run="RUN-C")
        self.assertEqual((code, out["took_over"]), (0, {"run": "RUN-B", "was": "missing"}))

    def test_a_run_that_takes_over_adopts_the_selection_it_resumes(self):
        """Build task 3: the run record (path, merge, sync branch) becomes the new run's, with its own worktree's
        start, so select's successors (merge, finish) take it as theirs; a finished phase adopts nothing."""
        run = {"key": "RUN-A", "folder": self.space, "path": "take", "start": "a" * 40, "merged": True,
               "finished": "nothing"}
        self.write(dict(state.fresh(), phase="tried", run=run,
                        lease={"run": "RUN-A", "folder": self.space, "at": state.stamp()}))
        self.set_tasks({"RUN-A": "done"})
        code, out = self.sync("preflight", "--repo", self.space)
        self.assertEqual((code, out["took_over"]), (0, {"run": "RUN-A", "was": "done", "selection": "RUN-A"}), out)
        got = state.load(self.p)["run"]
        self.assertEqual(got, {"key": "RUN-B", "folder": self.space, "path": "take", "merged": True,
                               "start": subprocess.run(["git", "-C", self.space, "rev-parse", "HEAD"], capture_output=True,
                                                       text=True).stdout.strip(), "took_from": "RUN-A"})
        with state.locked(self.p) as st:
            st["phase"] = "healthy"
        code, out = self.sync("preflight", "--repo", self.space, run="RUN-C")
        self.assertEqual(out["took_over"], {"run": "RUN-B", "was": "missing"})
        self.assertEqual(state.load(self.p)["run"]["key"], "RUN-B", "nothing to resume: select writes the next")

    def test_preflight_names_what_it_resumes(self):
        """A run that picks up an unfinished phase learns, from preflight alone, the commit and the sync PR its next
        call names (install <sha>, health <sha>, merge <pr>); nothing to resume says None."""
        code, out = self.sync("preflight")
        self.assertEqual((code, out["resuming"], out["issue_cursor"]), (0, None, None))
        rel = {"tag": "v3.2.22", "sha": A_SHA}
        sync = {"branch": "sync/v3.2.22", "head": "b" * 40, "merge": "c" * 40, "run": "RUN-A", "folder": self.space,
                "at": state.stamp(), "pr": 12, "main_before": "d" * 40, "merge_commit": "e" * 40}
        self.write(dict(state.fresh(), phase="installing", release=rel, candidate="e" * 40, sync=sync,
                        run={"key": "RUN-A", "folder": self.space, "path": "take"},
                        lease={"run": "RUN-A", "folder": self.space, "at": state.stamp()}))
        self.set_tasks({"RUN-A": "done"})
        code, out = self.sync("preflight", "--repo", self.space)
        self.assertEqual(code, 0, out)
        self.assertEqual(out["resuming"], {"path": "take", "release": rel, "candidate": "e" * 40,
                                           "sync": {"branch": "sync/v3.2.22", "head": "b" * 40, "pr": 12,
                                                    "merge_commit": "e" * 40}})
        with state.locked(self.p) as st:
            st.update(phase="healthy", sync=None)
        code, out = self.sync("preflight", "--repo", self.space)
        self.assertEqual((code, out["resuming"]), (0, None), "a finished phase resumes nothing")

    def test_preflight_stops_with_nothing_written(self):
        cases = [
            ("gh's default", lambda: self.sync("preflight", env={"FAKE_GH_DEFAULT": "someone/shepherdr"}), "held"),
            ("origin", lambda: (self.git("remote", "set-url", "origin", "https://github.com/someone/shepherdr"),
                                self.sync("preflight"))[1], "held"),
            ("branch", lambda: (self.git("checkout", "-q", "-b", "other"), self.sync("preflight"))[1], "held"),
            ("machine", lambda: (self.set_config("not-" + socket.gethostname()), self.sync("preflight"))[1], "stop"),
            ("config", lambda: (os.remove(self.p.config), self.sync("preflight"))[1], "stop"),
        ]
        for name, go, outcome in cases:
            with self.subTest(name):
                code, out = go()
                self.assertEqual((code, out["outcome"]), (1, outcome), out)
                self.assertFalse(os.path.exists(self.p.state))
                self.setUp()

    def test_preflight_refuses_a_broken_phase(self):
        self.write(dict(state.fresh(), phase="broken", lease={"run": "RUN-A", "folder": self.space, "at": state.stamp()}))
        self.set_tasks({"RUN-A": "done"})
        code, out = self.sync("preflight")
        self.assertEqual((code, out["outcome"]), (1, "broken"))
        self.assertEqual(state.load(self.p)["lease"]["run"], "RUN-A")

    def test_hold_and_held(self):
        code, out = self.sync("hold", "--blocker", "7", "--tag", "v3.2.22", "--sha", A_SHA, "--kind", "trial")
        self.assertEqual((code, out["outcome"]), (1, "stop"), "only the lease's owner holds")
        self.sync("preflight")
        args = ("--blocker", "7", "--tag", "v3.2.22", "--sha", A_SHA, "--kind", "trial", "--line", "the trial failed")
        code, out = self.sync("hold", *args)
        self.assertEqual((code, out["new"]), (0, True), out)
        code, out = self.sync("hold", *args)
        self.assertEqual((code, out["new"]), (0, False))
        self.assertEqual(state.load(self.p)["phase"], "held")
        code, out = self.sync("held")
        self.assertEqual(code, 0)
        self.assertEqual([(h["blocker"], h["due"]) for h in out["held"]], [("7", False)])
        code, out = self.sync("hold", "--blocker", "7", "--asked")
        self.assertEqual((code, out["outcome"]), (1, "stop"), "not due within the first 24 hours")
        st = state.load(self.p)
        st["held"][0]["first_seen"] = state.stamp(time.time() - state.QUESTION_AFTER_S - 60)
        self.write(st)
        code, out = self.sync("held")
        self.assertEqual([(h["blocker"], h["due"]) for h in out["held"]], [("7", True)])
        for _ in range(2):
            code, out = self.sync("hold", "--blocker", "7", "--asked")
            self.assertEqual((code, out["held"]["question"]["run"], out["held"]["question"]["asks"]), (0, "RUN-B", 1))
        code, out = self.sync("hold", "--blocker", "7", "--answer", "wait")
        self.assertEqual(out["held"]["question"]["answer"], "wait")
        code, out = self.sync("hold", "--blocker", "8", "--tag", "v3.2.22", "--sha", A_SHA, "--kind", "draft")
        self.assertEqual(code, 1, "a draft names its branch and head")

    def test_clear_broken_only_outside_a_task(self):
        self.write(dict(state.fresh(), phase="broken"))
        code, out = self.sync("clear-broken", env={"HERDR_GUARD_SESSION": "shepherdr"})
        self.assertEqual(code, 1)
        self.assertEqual(state.load(self.p)["phase"], "broken")
        code, out = self.sync("clear-broken")
        self.assertEqual((code, out["phase"]), (0, None))
        self.assertIsNone(state.load(self.p)["phase"])

    def test_unknown_step(self):
        r = subprocess.run([sys.executable, SYNC, "nope"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
