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
        # herdr-core, faked: the keys (herdr.task labels) with a live terminal
        self.live, self.asked = set(), []
        p = [mock.patch.dict(os.environ, {"HERDR_TASK_STORE": self.store}), mock.patch.object(task_tmp, "STORE", self.store),
             mock.patch.object(task_tmp, "hc_json", self.hc_json)]
        for x in p:
            x.start()
            self.addCleanup(x.stop)
        self.s = FakeStore()

    def hc_json(self, *args):
        self.asked.append(args)
        if args[:2] == ("ls", "--label") and args[2].startswith("herdr.task="):
            key = args[2].split("=", 1)[1]
            return {"terminals": [{"address": "t1", "state": "live"}] if key in self.live else []}
        return None

    def age(self, p, by=2 * task_tmp.STALE_S):
        old = time.time() - by
        os.utime(p, (old, old))

    def shell_in(self, p, pid=None):
        """A web-app shell's mark (service/shells.ts TMP_SHELL), of a live process unless another pid is given."""
        open(os.path.join(p, f"{task_tmp.SHELL_MARK}{pid or os.getpid()}"), "w").close()

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
        working, ending, ended, removed, crashed, idle_ready = mk(1), mk(2), mk(3), mk(4), mk(5), mk(6)
        stray_new = os.path.join(task_tmp.root(), "shop-8-0000")
        stray_old = os.path.join(task_tmp.root(), "shop-9-0000")
        os.makedirs(stray_new)
        os.makedirs(stray_old)
        # untouched for over an hour: a removed task's (herdr-task rm takes it at once when it can), a stray one, a
        # running task's whose agent is gone (a crash), and a Ready one whose agent still runs
        for p in (stray_old, removed, crashed, working, idle_ready):
            self.age(p)
        other = os.path.join(task_tmp.root(), "Not Ours")
        os.makedirs(other)
        t0 = int(time.time() * 1000)
        self.write_list([{"id": 1, "state": "running", "tmp": working},
                         {"id": 2, "state": "done", "done_at": t0, "tmp": ending},
                         {"id": 3, "state": "done", "done_at": t0 - 5, "ended_at": t0, "tmp": ended},
                         {"id": 5, "state": "running", "stopped_by": "error", "tmp": crashed},
                         {"id": 6, "state": "ready", "tmp": idle_ready}])
        self.live = {"home-dev-shop#1", "home-dev-shop#2", "home-dev-shop#6"}
        # task 4 was removed: no list names it any more
        gone = task_tmp.sweep(force=True)
        self.assertEqual(sorted(gone), sorted(os.path.basename(p) for p in (ended, removed, stray_old, crashed)))
        for p in (working, ending, idle_ready, stray_new, other):
            self.assertTrue(os.path.isdir(p), p)
        for p in (ended, removed, stray_old, crashed):
            self.assertFalse(os.path.lexists(p), p)
        # herdr-core was asked only about the folders that could go
        self.assertEqual(sorted(a[2] for a in self.asked), sorted(f"herdr.task=home-dev-shop#{n}" for n in (1, 3, 5, 6)))

    def test_a_folder_in_use_stays_until_nothing_uses_it(self):
        """A web-app shell or any live terminal of the task (a detached action's caller among them) keeps it; the
        sweep takes it once they are gone."""
        t = {"id": 12, "state": "done", "done_at": 1, "ended_at": 2}
        p = task_tmp.ensure(self.s, t)
        self.write_list([t])
        self.shell_in(p)
        self.assertFalse(task_tmp.remove(self.s, t))
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.assertTrue(os.path.isdir(p))
        self.assertEqual(t["tmp"], p)
        os.unlink(os.path.join(p, f"{task_tmp.SHELL_MARK}{os.getpid()}"))
        self.live = {self.s.key(t)}
        self.assertFalse(task_tmp.remove(self.s, t))
        self.assertTrue(os.path.isdir(p))
        self.live = set()
        self.assertEqual(task_tmp.sweep(force=True), [os.path.basename(p)])
        self.assertFalse(os.path.lexists(p))

    def test_a_shells_mark_counts_only_while_its_process_runs_since_this_boot(self):
        p = task_tmp.ensure(self.s, {"id": 13})
        dead = subprocess.Popen(["true"])
        dead.wait()
        self.shell_in(p, dead.pid)
        self.assertEqual(task_tmp.shells_in(p), 0)
        self.shell_in(p)
        self.assertEqual(task_tmp.shells_in(p), 1)
        with mock.patch.object(task_tmp, "_boot_time", lambda: time.time() + 60):  # marked before a reboot: a reused pid
            self.assertEqual(task_tmp.shells_in(p), 0)

    def test_when_herdr_core_cant_say_the_folder_stays(self):
        t = {"id": 14}
        p = task_tmp.ensure(self.s, t)
        with mock.patch.object(task_tmp, "hc_json", lambda *a: None):
            self.assertFalse(task_tmp.remove(self.s, t))
        self.assertTrue(os.path.isdir(p))

    def test_a_start_touches_its_folder_so_the_sweep_leaves_it(self):
        t = {"id": 15, "state": "running"}
        p = task_tmp.ensure(self.s, t)
        self.age(p)
        self.write_list([t])
        task_tmp.ensure(self.s, t)  # its agent starts again, not yet listed by herdr-core
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.assertTrue(os.path.isdir(p))

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
        self.age(p)
        with mock.patch.object(task_tmp, "_swept", 0.0):
            self.assertEqual(task_tmp.sweep(), [os.path.basename(p)])
            q = task_tmp.ensure(self.s, {"id": 7})
            self.age(q)
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

    def test_the_web_apps_terminal_can_have_it_made_before_the_agent_starts(self):
        """`herdr-task _task-tmp <id>`: what service/shells.ts taskTmp() asks when a task has no folder yet."""
        repo = tempfile.mkdtemp(prefix="tasktmp-repo-")
        self.addCleanup(shutil.rmtree, repo, True)
        env = dict(os.environ, HERDR_TASK_STORE=self.store, HERDR_TASK_SETTINGS=os.path.join(self.store, "settings.json"),
                   SHEPHERDR_NO_MIGRATE="1", PYTHONDONTWRITEBYTECODE="1")
        cli = [sys.executable, os.path.join(BIN, "herdr-task")]
        r = subprocess.run([*cli, "add", "Early terminal", "--folder", repo, "--json"], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = subprocess.run([*cli, "_task-tmp", "1", "--folder", repo], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        p = json.loads(r.stdout)["tmp"]
        self.assertTrue(os.path.isdir(p))
        self.assertEqual(os.path.dirname(p), os.path.join(self.store, ".tmp"))
        lists = [json.load(open(os.path.join(self.store, f))) for f in os.listdir(self.store) if f.endswith(".json")]
        self.assertEqual([x.get("tmp") for d in lists for x in d.get("tasks") or []], [p])  # recorded on the task


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


class ReviewerTmp(unittest.TestCase):
    """A reviewer the worker starts with hc run (which sets no variable for it) gets the task's temp folder from the
    Reviewer line's own words, expanded by the worker's shell; nothing when the worker has no TMPDIR."""

    def env_of(self, who, tmpdir):
        from herdr_task.settings import reviewer_command
        cmd = reviewer_command(who, folder=tempfile.gettempdir())
        head = cmd.split(f" {who} ")[0]  # everything before the CLI: env and its words
        env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"]}
        if tmpdir:
            env["TMPDIR"] = tmpdir
        for sh in ("sh", "bash"):
            out = subprocess.run([sh, "-c", head + " env"], env=env, capture_output=True, text=True, timeout=20)
            got = dict(l.split("=", 1) for l in out.stdout.splitlines() if "=" in l)
            yield sh, got

    def test_the_reviewer_gets_the_workers_temp_folder(self):
        for who in ("codex", "claude"):
            for sh, got in self.env_of(who, "/c/tmp/shop-1-abcd"):
                with self.subTest(who=who, sh=sh):
                    self.assertEqual([got.get(v) for v in ("TMPDIR", "TMP", "TEMP")], ["/c/tmp/shop-1-abcd"] * 3)
            for sh, got in self.env_of(who, None):
                with self.subTest(who=who, sh=sh, tmpdir=None):
                    self.assertNotIn("TMP", got)
                    self.assertNotIn("TEMP", got)

    def test_the_worker_template_says_to_pass_it_to_other_helpers(self):
        with open(os.path.join(ROOT, "templates", "worker.md")) as f:
            w = f.read()
        self.assertIn('env "TMPDIR=$TMPDIR" "TMP=$TMPDIR" "TEMP=$TMPDIR"', w)


class TestRunTemp(unittest.TestCase):
    """A test run's own temp folder: HOME and TMPDIR inside it, gone at the run's end (a killed run's at the next
    start), and a shep-* folder the run left in the shared temp folder fails it, unless another run shared that folder
    meanwhile. In this process, its environment and tempfile's cache put back after."""

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
            fn(*args, exit=exit, **self.register.call_args[1])
        return exit.call_args_list, err.getvalue()

    def dead_pid(self):
        p = subprocess.Popen(["true"])
        p.wait()
        return p.pid

    def old_run(self, name, by=2 * home_guard.STALE_RUN_S):
        p = os.path.join(self.shared, name)
        os.makedirs(os.path.join(p, "tmp", "shep-asks-x"))
        old = time.time() - by
        for x in (p, os.path.join(p, "tmp")):
            os.utime(x, (old, old))
        return p

    def test_the_run_folder_goes_at_the_end(self):
        run = home_guard.start_run()
        self.assertEqual(os.path.dirname(run), self.shared)
        self.assertTrue(os.path.basename(run).startswith(f"{home_guard.RUN_PREFIX}{os.getpid()}-"))
        self.assertEqual(os.environ["HOME"], os.path.join(run, "home"))
        self.assertEqual(os.environ[home_guard.RUN_VAR], run)
        for v in ("TMPDIR", "TMP", "TEMP"):
            self.assertEqual(os.environ[v], os.path.join(run, "tmp"))
        made = tempfile.mkdtemp(prefix="shep-asks-")
        self.assertEqual(os.path.dirname(made), os.path.join(run, "tmp"))
        self.assertEqual(self.end(), ([], ""))
        self.assertEqual(os.listdir(self.shared), [])

    def test_a_home_the_caller_gave_stays_and_the_temp_folder_is_still_the_runs(self):
        os.environ["HOME"] = given = os.path.join(self.shared, "given-home")
        run = home_guard.start_run(own_home=False)
        self.assertEqual(os.environ["HOME"], given)
        self.assertEqual(os.environ["TMPDIR"], os.path.join(run, "tmp"))

    def test_a_folder_left_in_the_shared_temp_folder_fails_the_run(self):
        os.mkdir(os.path.join(self.shared, "shep-was-there"))
        home_guard.start_run()
        for n in ("shep-diff-x", "shep-settings-x", "not-ours"):
            os.mkdir(os.path.join(self.shared, n))
        calls, err = self.end()
        self.assertEqual(calls, [mock.call(1)])
        self.assertIn("left 2 folder(s)", err)
        self.assertIn("shep-diff-x", err)
        self.assertIn("shep-settings-x", err)  # a settings test's leak counts too
        self.assertNotIn("shep-was-there", err)

    def test_with_another_run_beside_it_a_new_folder_only_warns(self):
        """Whose it is can't be told: a live run's folder (this process stands in), or an older checkout's run setup."""
        for beside in (f"shep-run-{os.getppid()}-abc", "shep-test-home-old"):
            with self.subTest(beside=beside):
                shared = os.path.join(self.shared, beside.split("-")[2])
                os.mkdir(shared)
                tempfile.tempdir = shared
                home_guard.start_run()
                os.mkdir(os.path.join(shared, beside))
                os.mkdir(os.path.join(shared, "shep-asks-m3-x"))
                calls, err = self.end()
                self.assertEqual(calls, [])
                self.assertIn("maybe not this run's", err)
                self.assertIn("shep-asks-m3-x", err)

    def test_a_killed_runs_folder_goes_when_the_next_run_starts(self):
        killed = self.old_run(f"shep-run-{self.dead_pid()}-k1")
        live = self.old_run(f"shep-run-{os.getppid()}-l1")  # its process still runs (a long, quiet run)
        recent = self.old_run(f"shep-run-{self.dead_pid()}-r1", by=60)  # still changing: another pid namespace's
        home_guard.start_run()
        self.assertFalse(os.path.lexists(killed))
        self.assertTrue(os.path.isdir(live))
        self.assertTrue(os.path.isdir(recent))

    def test_bun_and_python_tell_old_runs_the_same_way(self):
        with open(os.path.join(ROOT, "test", "preload.ts")) as f:
            src = f.read()
        m = re.search(r"export const OLD_RUN_FOLDERS = \[(.*)\];", src)
        self.assertEqual(tuple(json.loads(f"[{m.group(1)}]")), home_guard.OLD_RUN_FOLDERS)
        self.assertIn(f'export const RUN_PREFIX = "{home_guard.RUN_PREFIX}";', src)
        self.assertIn(f"const STALE_RUN_MS = {home_guard.STALE_RUN_S}_000;", src)
        self.assertIn(f"process.env.{home_guard.RUN_VAR} = run;", src)


class RunInATasksTemp(unittest.TestCase):
    """A run started in a task, whose TMPDIR is its own folder under ~/.cache/shepherdr/tmp, a folder the guard
    keeps tests out of: the run may open its own temp folders and nothing else there. The guard's idea of the real
    home is a fake one here, and every open goes through its real audit hook."""

    def setUp(self):
        self.home = os.path.realpath(tempfile.mkdtemp(prefix="tasktmp-realhome-"))
        self.addCleanup(shutil.rmtree, self.home, True)
        self.shared = os.path.join(self.home, ".cache", "shepherdr", "tmp", "sd-1-abcd")
        os.makedirs(self.shared)
        fake = [os.path.join(self.home, os.path.relpath(d, home_guard.REAL)) for d in home_guard.REAL_DIRS]
        for p in (mock.patch.dict(os.environ), mock.patch.object(tempfile, "tempdir", self.shared),
                  mock.patch.object(home_guard, "REAL_DIRS", fake),
                  mock.patch.object(home_guard, "OWN", [])):  # the real run's own lie around this fake home
            p.start()
            self.addCleanup(p.stop)
        reg = mock.patch.object(home_guard.atexit, "register")
        self.register = reg.start()
        self.addCleanup(reg.stop)

    def write(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write("x")

    def assertRefused(self, path):
        with self.assertRaises(home_guard.RealHome):
            self.write(path)

    def test_the_run_opens_its_own_folders_and_ends_clean(self):
        run = home_guard.start_run()
        self.assertEqual(os.path.dirname(run), self.shared)
        self.write(os.path.join(run, "tmp", "shep-asks-x", "a.json"))
        self.write(os.path.join(tempfile.mkdtemp(prefix="shep-diff-"), "b"))
        self.write(os.path.join(run, "home", ".config", "shepherdr", "settings.json"))  # its throwaway HOME
        self.write(os.path.join(self.shared, "beside"))  # the temp folder it started from
        fn, *args = self.register.call_args[0]
        exit = mock.Mock()
        fn(*args, exit=exit, **self.register.call_args[1])  # its end removes its folder through the guard
        self.assertEqual(exit.call_args_list, [])
        self.assertFalse(os.path.exists(run))

    def test_every_other_real_home_path_still_fails(self):
        run = home_guard.start_run()
        for p in (".config/shepherdr/settings.json", ".cache/shepherdr/tmp/sd-2-efgh/x", ".cache/shepherdr/x",
                  ".local/share/herdr/ask/ask-hook.sh", ".claude/settings.json"):
            with self.subTest(p=p):
                self.assertRefused(os.path.join(self.home, p))
        link = os.path.join(run, "tmp", "settings")
        os.makedirs(os.path.join(self.home, ".config", "shepherdr"), exist_ok=True)
        os.symlink(os.path.join(self.home, ".config", "shepherdr"), link)
        self.assertRefused(os.path.join(link, "settings.json"))  # a link out of the run's folder leads where it lands

    def test_a_whole_guarded_folder_as_tmpdir_stays_guarded(self):
        tempfile.tempdir = shared = os.path.join(self.home, ".cache", "shepherdr")
        run = home_guard.start_run()
        self.write(os.path.join(run, "tmp", "a"))
        self.assertRefused(os.path.join(shared, "other", "x"))

    def test_only_one_tasks_temp_folder_or_a_runs_own_counts(self):
        h = self.home
        service = os.path.join(h, ".local", "state", "shepherdr", "service")
        os.makedirs(service)
        link = os.path.join(h, ".cache", "shepherdr", "tmp", "sd-3-link")  # a task-looking name that leads to state
        os.symlink(service, link)
        forged = os.path.join(self.shared, f"{home_guard.RUN_PREFIX}9-forged")  # a run's name that leads to the home
        os.symlink(h, forged)
        for shared in (h, os.path.join(h, ".cache"), os.path.join(h, ".cache", "shepherdr"),
                       os.path.join(h, ".cache", "shepherdr", "tmp"), os.path.join(h, ".config", "shepherdr"),
                       service, link):
            home_guard.own(shared=shared)
        for run in (os.path.join(h, ".config", "shepherdr"), forged):  # not a run's folder where it leads
            home_guard.own(run=run)
        self.assertEqual(home_guard.OWN, [])
        for p in (".config/shepherdr/settings.json", ".cache/shepherdr/tmp/sd-2-efgh/x",
                  ".local/state/shepherdr/service/token"):
            with self.subTest(p=p):
                self.assertRefused(os.path.join(h, p))

    def test_a_program_the_run_starts_keeps_its_run_folder(self):
        """A program a test starts imports the guard again with RUN_VAR set: that run's folder is its own too."""
        run = os.path.join(self.shared, f"{home_guard.RUN_PREFIX}1-abc")
        home_guard.own(run=run)
        self.write(os.path.join(run, "tmp", "a"))
        self.assertRefused(os.path.join(self.shared, "x"))  # the shared temp folder is the starting run's, not its


if __name__ == "__main__":
    unittest.main()
