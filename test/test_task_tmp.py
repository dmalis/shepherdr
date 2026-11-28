"""dmalis/shepherdr#216: each task's own temp folder (herdr_task/task_tmp.py), and test runs that clean up after
themselves (test/home_guard.py, test/preload.ts). Real folders in a throwaway task store; hc is never run."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, BIN)

from herdr_task import task_tmp  # noqa: E402


class FakeStore:
    """Enough of a Store: its slug, a task's key and ref, and dirty."""

    def __init__(self, slug="home-dev-shop", prefix="SHOP"):
        self.slug, self.prefix, self.dirty = slug, prefix, False

    def key(self, t):
        return f"{self.slug}#{t['id']}"

    def ref(self, t):
        return f"{self.prefix}-{t['id']}"


class TaskTmp(unittest.TestCase):
    """The folder: where it is, who may enter, its record on the task, its removal and the sweep."""

    def setUp(self):
        self.store = tempfile.mkdtemp(prefix="tasktmp-store-")
        self.addCleanup(shutil.rmtree, self.store, True)
        p = [mock.patch.dict(os.environ, {"HERDR_TASK_STORE": self.store}), mock.patch.object(task_tmp, "STORE", self.store)]
        for x in p:
            x.start()
            self.addCleanup(x.stop)
        self.s = FakeStore()

    def write_list(self, tasks, slug="home-dev-shop"):
        with open(os.path.join(self.store, slug + ".json"), "w") as f:
            json.dump({"folder": "/nowhere", "tasks": tasks}, f)

    def test_a_task_gets_a_private_short_folder_beside_a_throwaway_store(self):
        t = {"id": 254}
        p = task_tmp.ensure(self.s, t)
        self.assertEqual(os.path.dirname(p), os.path.join(self.store, ".tmp"))
        self.assertRegex(os.path.basename(p), r"^shop-254-[0-9a-f]{4}$")
        self.assertTrue(os.path.isdir(p))
        self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o700)
        self.assertEqual(t["tmp"], p)
        self.assertTrue(self.s.dirty)
        # the same task, again: the same folder, nothing new to save
        self.s.dirty = False
        self.assertEqual(task_tmp.ensure(self.s, t), p)
        self.assertFalse(self.s.dirty)
        # two lists with the same prefix never share one
        self.assertNotEqual(p, task_tmp.ensure(FakeStore(slug="home-other-shop"), {"id": 254}))

    def test_shepherdrs_cache_folder_without_a_throwaway_store(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HERDR_TASK_STORE")
            self.assertEqual(task_tmp.root(), os.path.join(task_tmp.WHERE.roots["cache"], "tmp"))

    def test_its_variables(self):
        self.assertEqual(task_tmp.env_for("/x/t"), ["TMPDIR=/x/t", "TMP=/x/t", "TEMP=/x/t"])
        self.assertEqual(task_tmp.env_for(None), [])

    def test_a_folder_that_cant_be_made_never_stops_a_start(self):
        with open(os.path.join(self.store, ".tmp"), "w") as f:
            f.write("not a folder")
        t = {"id": 1}
        self.assertIsNone(task_tmp.ensure(self.s, t))
        self.assertNotIn("tmp", t)
        self.assertIsNone(task_tmp.ensure(SimpleNamespace(key=lambda t: "x#1", dirty=False), t))  # not a Store

    def test_remove_takes_the_folder_and_its_record(self):
        t = {"id": 3}
        p = task_tmp.ensure(self.s, t)
        os.makedirs(os.path.join(p, "deep", "er"))
        open(os.path.join(p, "deep", "er", "f"), "w").close()
        self.assertTrue(task_tmp.remove(self.s, t))
        self.assertFalse(os.path.lexists(p))
        self.assertNotIn("tmp", t)
        self.assertTrue(task_tmp.remove(self.s, {"id": 4}))  # none: nothing to do

    def test_remove_never_follows_a_link_or_leaves_its_folder(self):
        keep = tempfile.mkdtemp(prefix="tasktmp-keep-")
        self.addCleanup(shutil.rmtree, keep, True)
        open(os.path.join(keep, "precious"), "w").close()
        os.makedirs(task_tmp.root())
        link = os.path.join(task_tmp.root(), "shop-9-abcd")
        os.symlink(keep, link)
        task_tmp.remove(self.s, {"id": 9, "tmp": link})
        task_tmp.remove(self.s, {"id": 9, "tmp": keep})  # a record pointing elsewhere
        self.assertTrue(os.path.exists(os.path.join(keep, "precious")))

    def test_sweep_keeps_what_is_in_use_and_takes_the_rest(self):
        mk = lambda n: task_tmp.ensure(self.s, {"id": n})
        working, ending, ended, removed = mk(1), mk(2), mk(3), mk(4)
        stray_new = os.path.join(task_tmp.root(), "shop-8-0000")
        stray_old = os.path.join(task_tmp.root(), "shop-9-0000")
        os.makedirs(stray_new)
        os.makedirs(stray_old)
        old = time.time() - 2 * task_tmp.UNKNOWN_AGE_S
        os.utime(stray_old, (old, old))
        os.utime(removed, (old, old))  # a removed task's folder, untouched for over an hour (herdr-task rm takes it at once)
        other = os.path.join(task_tmp.root(), "Not Ours")
        os.makedirs(other)
        t0 = int(time.time() * 1000)
        self.write_list([{"id": 1, "state": "running", "tmp": working},
                         {"id": 2, "state": "done", "done_at": t0, "tmp": ending},
                         {"id": 3, "state": "done", "done_at": t0 - 5, "ended_at": t0, "tmp": ended}])
        # task 4 was removed: no list names it any more
        gone = task_tmp.sweep(force=True)
        self.assertEqual(sorted(gone), sorted(os.path.basename(p) for p in (ended, removed, stray_old)))
        for p in (working, ending, stray_new, other):
            self.assertTrue(os.path.isdir(p), p)
        for p in (ended, removed, stray_old):
            self.assertFalse(os.path.lexists(p), p)

    def test_sweep_waits_when_a_list_cant_be_read(self):
        p = task_tmp.ensure(self.s, {"id": 5})
        with open(os.path.join(self.store, "half.json"), "w") as f:
            f.write("{not json")
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.assertTrue(os.path.isdir(p))

    def test_sweep_runs_at_once_then_every_ten_minutes(self):
        """The scheduler's first round after it starts sweeps (a crashed task's folder goes), then not again soon."""
        p = task_tmp.ensure(self.s, {"id": 6})
        self.write_list([])
        old = time.time() - 2 * task_tmp.UNKNOWN_AGE_S
        os.utime(p, (old, old))
        with mock.patch.object(task_tmp, "_swept", 0.0):
            self.assertEqual(task_tmp.sweep(), [os.path.basename(p)])
            q = task_tmp.ensure(self.s, {"id": 7})
            os.utime(q, (old, old))
            self.assertEqual(task_tmp.sweep(), [])
            self.assertTrue(os.path.isdir(q))

    def test_a_done_task_loses_its_folder_once_its_agents_ended(self):
        from herdr_task import tick
        t = {"id": 11, "state": "done", "done_at": 1}
        p = task_tmp.ensure(self.s, t)
        with mock.patch.object(tick, "live_agents", lambda key: []):
            tick.end_done(self.s, t, {})
        self.assertFalse(os.path.lexists(p))
        self.assertGreater(t["ended_at"], t["done_at"])


class TaskAgentEnv(unittest.TestCase):
    """The task's agent starts with its temp folder as TMPDIR, TMP and TEMP: launch()'s own argv runs for real, `env`
    as its agent (hc is never run)."""

    def test_the_agent_sees_its_temp_folder(self):
        import herdr_task.launch as L
        store = tempfile.mkdtemp(prefix="tasktmp-store-")
        self.addCleanup(shutil.rmtree, store, True)
        ran = []

        def run(argv, *a, **k):
            ran.append(argv)
            return subprocess.CompletedProcess(argv, 0, json.dumps({"address": "t9"}), "")
        s, task = FakeStore(), {"id": 6, "title": "fake", "agents": []}
        with mock.patch.dict(os.environ, {"HERDR_TASK_STORE": store}), mock.patch.object(task_tmp, "STORE", store), \
                mock.patch.object(L, "run", run), mock.patch.object(L, "folder_for", lambda s, t: store), \
                mock.patch.object(L, "agent_name", lambda *a: "shop-6-fake"), mock.patch.object(L, "track", lambda *a: None), \
                mock.patch.object(L, "coordinator_tab", lambda a: None), mock.patch.object(L, "own_argv", lambda a, *_: a), \
                mock.patch.object(L, "in_shell", lambda a: a), mock.patch.object(L, "low_priority", lambda a, n: a):
            L.launch(s, task, ["env"], "sp1")
        hc = ran[0]
        out = subprocess.run(hc[hc.index("--") + 1:], env={"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], "TMPDIR": "/tmp"},
                             capture_output=True, text=True, timeout=20)
        env = dict(l.split("=", 1) for l in out.stdout.splitlines() if "=" in l)
        self.assertEqual(task["tmp"], os.path.join(store, ".tmp", os.path.basename(task["tmp"])))
        for v in ("TMPDIR", "TMP", "TEMP"):
            self.assertEqual(env.get(v), task["tmp"], v)

    def test_a_detached_action_from_a_task_finds_its_own_job(self):
        """link.py keeps a detached action's files in $TMPDIR/herdr-task-jobs-<uid>: a task's agent that starts one
        with its own TMPDIR follows it there too (DetachedActions' slow stand-in for herdr-task)."""
        d = tempfile.mkdtemp(prefix="tasktmp-")
        self.addCleanup(shutil.rmtree, d, True)
        own = os.path.join(d, ".tmp", "shop-1-abcd")
        os.makedirs(own)
        slow = os.path.join(d, "slow")
        with open(slow, "w") as f:
            f.write('#!/bin/sh\nsleep 1\necho "{\\"state\\": \\"done\\"}"\n')
        os.chmod(slow, 0o755)
        env = dict(os.environ, TMPDIR=own, HERDR_TASK_ACTION_WAIT="0.3", PYTHONDONTWRITEBYTECODE="1")
        code = f"import sys; sys.path.insert(0, {BIN!r}); from herdr_task import link; r = link.local_action(['accept', '1', '--json'], sys.argv[1]); print(r.returncode); print(r.stdout, end='')"
        r = subprocess.run([sys.executable, "-c", code, slow], env=env, capture_output=True, text=True, timeout=30)
        rc, _, out = r.stdout.partition("\n")
        self.assertEqual(int(rc), 75, r.stderr)
        job = json.loads(out)["pending"]
        self.assertTrue(os.path.isdir(os.path.join(own, f"herdr-task-jobs-{os.getuid()}")))
        env["HERDR_TASK_ACTION_WAIT"] = "10"
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "_job", job, "--json"], env=env,
                           capture_output=True, text=True, timeout=30)
        self.assertEqual(json.loads(r.stdout), {"state": "done"}, r.stderr)


class TestRunTemp(unittest.TestCase):
    """A test run's own temp folder: HOME and TMPDIR inside it, gone at the run's end, and a shep-* folder the run
    left in the shared temp folder fails it. In this process, its environment and tempfile's cache put back after."""

    def setUp(self):
        self.shared = tempfile.mkdtemp(prefix="tasktmp-shared-")
        self.addCleanup(shutil.rmtree, self.shared, True)
        for p in (mock.patch.dict(os.environ), mock.patch.object(tempfile, "tempdir", self.shared)):
            p.start()
            self.addCleanup(p.stop)
        reg = mock.patch.object(home_guard.atexit, "register")
        self.register = reg.start()
        self.addCleanup(reg.stop)

    def end(self):
        """What runs at the run's end, with exit() caught: (exit's calls, what it wrote)."""
        fn, *args = self.register.call_args[0]
        exit = mock.Mock()
        with mock.patch.object(home_guard.sys, "stderr", new_callable=io.StringIO) as err:
            fn(*args, exit=exit)
        return exit.call_args_list, err.getvalue()

    def test_the_run_folder_goes_at_the_end(self):
        run = home_guard.start_run()
        self.assertEqual(os.path.dirname(run), self.shared)
        self.assertTrue(os.path.basename(run).startswith(home_guard.RUN_PREFIX))
        self.assertEqual(os.environ["HOME"], os.path.join(run, "home"))
        for v in ("TMPDIR", "TMP", "TEMP"):
            self.assertEqual(os.environ[v], os.path.join(run, "tmp"))
        made = tempfile.mkdtemp(prefix="shep-asks-")
        self.assertEqual(os.path.dirname(made), os.path.join(run, "tmp"))
        self.assertEqual(self.end(), ([], ""))
        self.assertEqual(os.listdir(self.shared), [])

    def test_a_folder_left_in_the_shared_temp_folder_fails_the_run(self):
        os.mkdir(os.path.join(self.shared, "shep-was-there"))
        home_guard.start_run()
        for n in ("shep-diff-x", "shep-run-other", "shep-test-home-other", "not-ours"):
            os.mkdir(os.path.join(self.shared, n))
        calls, err = self.end()
        self.assertEqual(calls, [mock.call(1)])
        self.assertIn("left 1 folder(s)", err)
        self.assertIn("shep-diff-x", err)
        for n in ("shep-was-there", "shep-run-other", "shep-test-home-other"):
            self.assertNotIn(n, err)

    def test_bun_and_python_ignore_the_same_run_folders(self):
        with open(os.path.join(ROOT, "test", "preload.ts")) as f:
            m = re.search(r"export const RUN_FOLDERS = \[RUN_PREFIX, (.*)\];", f.read())
        self.assertEqual(tuple(json.loads(f"[{m.group(1)}]")), home_guard.RUN_FOLDERS[1:])


if __name__ == "__main__":
    unittest.main()
