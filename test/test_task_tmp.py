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


def held_by(p, *argv):
    """A process holding the folder's lock as a task's agent does (task_tmp.take_argv), ended when the test ends."""
    proc = subprocess.Popen(task_tmp.take_argv(p, list(argv or ("sleep", "60"))), stdin=subprocess.DEVNULL)
    for _ in range(100):  # until its lock is taken
        if not lockable(p):
            return proc
        time.sleep(0.02)
    proc.kill()
    raise AssertionError("the lock was never taken")


def lockable(p):
    """Whether this process can take the folder's lock exclusively now, as _drop() does."""
    import fcntl
    fd = os.open(p, os.O_RDONLY)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False
    finally:
        os.close(fd)


def end(proc):
    proc.kill()
    proc.wait()


class TaskTmp(unittest.TestCase):
    """The folder: who may enter, its record on the task, its lock, its removal and the sweep. Real folders in a
    throwaway store (HERDR_TASK_STORE: <store>/.tmp), herdr-core faked."""

    def setUp(self):
        self.store = tempfile.mkdtemp(prefix="tasktmp-store-")
        self.addCleanup(shutil.rmtree, self.store, True)
        # herdr-core, faked: the keys (herdr.task labels) with a live terminal
        self.live, self.asked = set(), []
        p = [mock.patch.dict(os.environ, {"HERDR_TASK_STORE": self.store}), mock.patch.object(task_tmp, "STORE", self.store),
             mock.patch.object(task_tmp, "hc_json", self.hc_json), mock.patch.object(task_tmp, "_pressed", 0.0)]
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

    def age(self, p, by=2 * task_tmp.GRACE_S):
        old = time.time() - by
        os.utime(p, (old, old))

    def write_list(self, tasks, slug="home-dev-shop"):
        with open(os.path.join(self.store, slug + ".json"), "w") as f:
            json.dump({"folder": "/nowhere", "tasks": tasks}, f)

    def test_a_task_gets_a_private_short_folder(self):
        t = {"id": 254}
        p = task_tmp.ensure(self.s, t)
        self.assertEqual(os.path.dirname(p), os.path.join(self.store, ".tmp"))
        self.assertRegex(os.path.basename(p), r"^[0-9a-z]{6}$")
        for x in (p, os.path.dirname(p)):
            self.assertEqual(stat.S_IMODE(os.stat(x).st_mode), 0o700, x)
        self.assertEqual(t["tmp"], p)
        self.assertTrue(self.s.dirty)
        self.assertEqual(task_tmp.ensure(self.s, t), p)  # its next start keeps it
        self.assertNotEqual(p, task_tmp.ensure(self.s, {"id": 255}))

    def test_owner_only_whatever_the_umask(self):
        was = os.umask(0)
        try:
            p = task_tmp.ensure(self.s, {"id": 1})
        finally:
            os.umask(was)
        self.assertEqual(stat.S_IMODE(os.stat(p).st_mode), 0o700)

    def test_its_variables(self):
        self.assertEqual(task_tmp.env_for("/x/t"), ["TMPDIR=/x/t", "TMP=/x/t", "TEMP=/x/t"])
        self.assertEqual(task_tmp.env_for(None), [])
        self.assertEqual(task_tmp.take_argv(None, ["claude"]), ["claude"])

    def test_a_folder_that_cant_be_made_never_stops_a_start(self):
        with open(os.path.join(self.store, ".tmp"), "w") as f:
            f.write("not a folder")
        t = {"id": 3}
        self.assertIsNone(task_tmp.ensure(self.s, t))
        self.assertNotIn("tmp", t)

    def test_allocation_never_shares_a_folder_between_racing_starts(self):
        """Eight processes making 40 folders each in one root at once: mkdir makes each or fails, never one twice."""
        r = os.path.join(self.store, ".tmp")
        os.makedirs(r)
        code = (f"import sys; sys.path.insert(0, {BIN!r}); from herdr_task import task_tmp\n"
                "for _ in range(40): print(task_tmp._new(sys.argv[1]))")
        procs = [subprocess.Popen([sys.executable, "-c", code, r], stdout=subprocess.PIPE, text=True) for _ in range(8)]
        made = [ln for proc in procs for ln in proc.communicate(timeout=60)[0].split()]
        self.assertEqual(len(made), 320)
        self.assertEqual(len(set(made)), 320)
        self.assertEqual(len(os.listdir(r)), 320)

    def test_a_start_never_takes_a_folder_being_removed(self):
        """_drop() holds the lock exclusively while it removes: a start meanwhile gets a new folder instead."""
        import fcntl
        t = {"id": 4}
        p = task_tmp.ensure(self.s, t)
        fd = os.open(p, os.O_RDONLY)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        q = task_tmp.ensure(self.s, t)
        self.assertNotEqual(q, p)
        self.assertEqual(t["tmp"], q)

    def test_a_start_touches_its_folder_so_the_sweep_leaves_it(self):
        t = {"id": 5, "state": "done", "done_at": 1}
        p = task_tmp.ensure(self.s, t)
        self.age(p)
        self.write_list([t])
        self.assertEqual(task_tmp.ensure(self.s, t), p)  # started again, its lock not taken yet
        self.assertEqual(task_tmp.sweep(force=True), [])

    def test_the_lock_keeps_it_while_its_agent_and_shell_run(self):
        t = {"id": 6, "state": "done", "done_at": 1}
        p = task_tmp.ensure(self.s, t)
        self.age(p)
        self.write_list([t])
        agent = held_by(p)
        self.assertFalse(task_tmp.remove(self.s, t))
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.assertEqual(t["tmp"], p)
        self.assertTrue(os.path.isdir(p))
        end(agent)
        self.assertTrue(task_tmp.remove(self.s, t))
        self.assertFalse(os.path.lexists(p))
        self.assertNotIn("tmp", t)

    def test_a_restarted_scheduler_sees_the_lock_without_taking_it_again(self):
        """The lock is its users', not the scheduler's: a new scheduler process (a restart) refuses a held folder,
        and takes it once its holder ends. A folder no task records and with no key, so only the lock decides: the
        new process never asks herdr-core (it isn't faked there)."""
        p = task_tmp.ensure(self.s, {"id": 7})
        os.remove(os.path.join(p, task_tmp.KEY_FILE))
        self.age(p)
        self.write_list([])
        agent = held_by(p)
        code = (f"import sys, json; sys.path.insert(0, {BIN!r}); from herdr_task import task_tmp\n"
                "print(json.dumps(task_tmp.sweep(force=True)))")
        sweep = lambda: json.loads(subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                                                  timeout=60, env=dict(os.environ, HERDR_TASK_STORE=self.store)).stdout)
        self.assertEqual(sweep(), [])
        self.assertEqual(sweep(), [])  # and again: nothing it does takes the lock from its holder
        end(agent)
        self.assertEqual(sweep(), [os.path.basename(p)])

    def test_a_detached_action_holds_it_while_it_runs(self):
        """link.py's job started from a task's terminal (TMPDIR the task's folder) holds the lock until it ends."""
        from herdr_task import link
        p = task_tmp.ensure(self.s, {"id": 8})
        slow = os.path.join(self.store, "slow")
        with open(slow, "w") as f:
            f.write("#!/bin/sh\nsleep 1.5\necho '{}'\n")
        os.chmod(slow, 0o755)
        with mock.patch.dict(os.environ, {"TMPDIR": p}):
            self.assertIsNone(link.local_start("job1", ["accept", "8"], slow))
        rc = os.path.join(p, f"herdr-task-jobs-{os.getuid()}", "job1.rc")
        time.sleep(0.5)
        self.assertFalse(lockable(p))
        self.assertFalse(task_tmp.remove(self.s, {"id": 8, "tmp": p}))
        for _ in range(100):
            if os.path.exists(rc):
                break
            time.sleep(0.05)
        time.sleep(0.1)
        self.assertTrue(lockable(p))

    def test_remove_never_follows_a_link_or_leaves_its_folder(self):
        keep = tempfile.mkdtemp(prefix="tasktmp-keep-")
        self.addCleanup(shutil.rmtree, keep, True)
        open(os.path.join(keep, "x"), "w").close()
        os.makedirs(task_tmp.root())
        link = os.path.join(task_tmp.root(), "abc123")
        os.symlink(keep, link)
        self.write_list([])
        self.assertEqual(task_tmp.sweep(force=True), [])
        task_tmp.remove(self.s, {"id": 9, "tmp": link})
        task_tmp.remove(self.s, {"id": 9, "tmp": keep})  # a record pointing elsewhere: only forgotten
        self.assertTrue(os.path.exists(os.path.join(keep, "x")))

    def test_the_sweep_takes_only_done_or_gone_tasks_folders_that_nothing_uses(self):
        mk = lambda n: task_tmp.ensure(self.s, {"id": n})
        running, ready, done, fresh_done, busy_done, gone, fresh_gone = (mk(n) for n in range(1, 8))
        other = os.path.join(task_tmp.root(), "Not Ours")
        os.makedirs(other)
        for p in (running, ready, done, busy_done, gone, other):
            self.age(p)
        now_ms = int(time.time() * 1000)
        self.write_list([{"id": 1, "state": "running", "tmp": running}, {"id": 2, "state": "ready", "tmp": ready},
                         {"id": 3, "state": "done", "done_at": 1, "tmp": done},
                         {"id": 4, "state": "done", "done_at": now_ms, "tmp": fresh_done},
                         {"id": 5, "state": "done", "done_at": 1, "tmp": busy_done}])
        self.live.add("home-dev-shop#5")  # a reviewer of it still runs, without the lock
        gone_names = task_tmp.sweep(force=True)
        self.assertEqual(sorted(gone_names), sorted(os.path.basename(p) for p in (done, gone)))
        for p in (running, ready, fresh_done, busy_done, fresh_gone, other):
            self.assertTrue(os.path.isdir(p), p)
        # herdr-core asked only about the Done or gone ones past their grace
        self.assertEqual(sorted(a[2] for a in self.asked), ["herdr.task=home-dev-shop#3", "herdr.task=home-dev-shop#5",
                                                            "herdr.task=home-dev-shop#6"])  # gone: its key from its folder

    def test_when_herdr_core_cant_say_the_folder_stays(self):
        t = {"id": 11, "state": "done"}
        p = task_tmp.ensure(self.s, t)
        with mock.patch.object(task_tmp, "hc_json", lambda *a: None):
            self.assertFalse(task_tmp.remove(self.s, t))
        self.assertTrue(os.path.isdir(p))

    def test_sweep_waits_when_a_list_cant_be_read(self):
        p = task_tmp.ensure(self.s, {"id": 12})
        self.age(p)
        with open(os.path.join(self.store, "broken.json"), "w") as f:
            f.write("{not json")
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.assertTrue(os.path.isdir(p))
        # a Done task's folder, recorded in a list that reads, still goes: only the unrecorded ones wait
        t = {"id": 13, "state": "done", "done_at": 1}
        q = task_tmp.ensure(self.s, t)
        self.age(q)
        self.write_list([t])
        with open(os.path.join(self.store, ".restarts.json"), "w") as f:
            f.write('{"half')  # a sidecar caught mid-write
        self.assertEqual(task_tmp.sweep(force=True), [os.path.basename(q)])
        self.assertTrue(os.path.isdir(p))

    def test_a_removed_tasks_folder_stays_while_its_helper_runs(self):
        """A removed task's record is gone, but its folder keeps its key: a reviewer or helper still running (hc run
        gives it no lock of its own) keeps it; the sweep takes it once that ends."""
        p = task_tmp.ensure(self.s, {"id": 14})
        self.age(p)
        self.write_list([])
        self.live.add("home-dev-shop#14")
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.live.clear()
        self.assertEqual(task_tmp.sweep(force=True), [os.path.basename(p)])

    def test_a_launch_that_cant_take_the_lock_never_uses_the_folder(self):
        """A folder being removed (_drop() holds it exclusively): what the launch starts gets the machine's own temp
        folder, as the web app's shell does (the same TAKE)."""
        import fcntl
        p = task_tmp.ensure(self.s, {"id": 15})
        fd = os.open(p, os.O_RDONLY)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        show = ["sh", "-c", 'echo "${TMPDIR-unset} ${TMP-unset} ${TEMP-unset}"; ls /proc/self/fd/9 2>/dev/null || echo no9']
        env = dict(os.environ, **dict(v.split("=", 1) for v in task_tmp.env_for(p)))
        got = subprocess.run(task_tmp.take_argv(p, show), env=env, capture_output=True, text=True, timeout=30).stdout
        self.assertEqual(got.split(), ["unset", "unset", "unset", "no9"])
        fcntl.flock(fd, fcntl.LOCK_UN)
        got = subprocess.run(task_tmp.take_argv(p, show[:2] + ['echo "$TMPDIR"']), env=env, capture_output=True,
                             text=True, timeout=30).stdout
        self.assertEqual(got.strip(), p)

    def test_a_detached_action_never_uses_a_folder_being_removed(self):
        import fcntl
        from herdr_task import link
        p = task_tmp.ensure(self.s, {"id": 16})
        fd = os.open(p, os.O_RDONLY)
        self.addCleanup(os.close, fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        seen = {}
        with mock.patch.dict(os.environ, {"TMPDIR": p, "TMP": p, "TEMP": p}), \
                mock.patch.object(link.subprocess, "Popen", lambda argv, **k: seen.update(k)):
            link.local_start("job2", ["accept", "16"], "/bin/true")
        self.assertFalse({"TMPDIR", "TMP", "TEMP"} & set(seen["env"]))

    def test_sweep_runs_at_once_then_every_ten_minutes(self):
        p = task_tmp.ensure(self.s, {"id": 13})
        self.age(p)
        self.write_list([])
        with mock.patch.object(task_tmp, "_swept", 0.0):
            self.assertEqual(task_tmp.sweep(), [os.path.basename(p)])
            q = task_tmp.ensure(self.s, {"id": 14})
            self.age(q)
            self.assertEqual(task_tmp.sweep(), [])
            self.assertTrue(os.path.isdir(q))

    def test_a_start_held_on_a_full_disk_sweeps_once_then_waits_five_minutes(self):
        self.write_list([])
        p = task_tmp.ensure(self.s, {"id": 15})
        self.age(p)
        self.assertEqual(task_tmp.pressed(), [os.path.basename(p)])
        q = task_tmp.ensure(self.s, {"id": 16})
        self.age(q)
        self.assertEqual(task_tmp.pressed(), [])  # rate-limited, across processes too (a stamp beside the lists)
        self.age(os.path.join(self.store, ".tmp-swept"), task_tmp.PRESSED_EVERY_S + 1)
        task_tmp._pressed = 0.0  # another process
        self.assertEqual(task_tmp.pressed(), [os.path.basename(q)])

    def test_a_disk_too_full_for_the_stamp_still_sweeps_once(self):
        self.write_list([])
        p = task_tmp.ensure(self.s, {"id": 17})
        self.age(p)
        real_open = open

        def full(f, mode="r", *a, **k):
            if str(f).endswith(".tmp-swept"):
                raise OSError(28, "No space left on device")
            return real_open(f, mode, *a, **k)
        with mock.patch("builtins.open", full):
            self.assertEqual(task_tmp.pressed(), [os.path.basename(p)])
            q = task_tmp.ensure(self.s, {"id": 18})
            self.age(q)
            self.assertEqual(task_tmp.pressed(), [])  # this process's own stamp: still rate-limited
        self.assertTrue(os.path.isdir(q))

    def test_a_done_task_loses_its_folder_once_its_agents_ended(self):
        from herdr_task import tick
        t = {"id": 17, "state": "done", "done_at": 1}
        p = task_tmp.ensure(self.s, t)
        with mock.patch.object(tick, "live_agents", lambda key: []):
            tick.end_done(self.s, t, {})
        self.assertFalse(os.path.lexists(p))
        self.assertGreater(t["ended_at"], t["done_at"])

    def test_the_web_apps_terminal_can_have_it_made_before_the_agent_starts(self):
        """`herdr-task _task-tmp <id>`: what service/shells.ts taskTmp() asks when the person opens a task's terminal."""
        repo = tempfile.mkdtemp(prefix="tasktmp-repo-")
        self.addCleanup(shutil.rmtree, repo, True)
        env = dict(os.environ, HERDR_TASK_STORE=self.store, HERDR_TASK_SETTINGS=os.path.join(self.store, "settings.json"),
                   SHEPHERDR_NO_MIGRATE="1", PYTHONDONTWRITEBYTECODE="1")
        cli = [sys.executable, os.path.join(BIN, "herdr-task")]
        r = subprocess.run([*cli, "add", "Early terminal", "--folder", repo, "--json"], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        got = []
        for _ in range(2):
            r = subprocess.run([*cli, "_task-tmp", "1", "--folder", repo], env=env, capture_output=True, text=True, timeout=60)
            self.assertEqual(r.returncode, 0, r.stderr)
            got.append(json.loads(r.stdout)["tmp"])
        p = got[0]
        self.assertEqual(got, [p, p])  # asked again (a second terminal): the same one
        self.assertTrue(os.path.isdir(p))
        self.assertEqual(os.path.dirname(p), os.path.join(self.store, ".tmp"))
        lists = [json.load(open(os.path.join(self.store, f))) for f in os.listdir(self.store) if f.endswith(".json")]
        self.assertEqual([x.get("tmp") for d in lists for x in d.get("tasks") or []], [p])  # recorded on the task


LOCAL_DISK = task_tmp._local_disk  # the real one: WhereTaskTmp stands in for it
# the longest home ~/.shep-tmp is kept short for, made up: macOS's Users folder and a 19-letter name, Linux's home and 20
LONGEST_HOME = {"darwin": os.path.join(os.sep, "Users", "abcdefghijklmnopqrs"), "linux": os.path.join(os.sep, "home", "abcdefghijklmnopqrst")}


class WhereTaskTmp(unittest.TestCase):
    """Where the folders go: SCRATCH on Linux's disk, ~/.shep-tmp on macOS or where /var/tmp isn't a local disk, and
    older copies' places drained where they are. A throwaway home playing the real one, SCRATCH a scratch folder,
    no HERDR_TASK_STORE, hc faked."""

    def setUp(self):
        from herdr_task import layout
        self.home = os.path.realpath(tempfile.mkdtemp(prefix="tasktmp-home-"))
        self.addCleanup(shutil.rmtree, self.home, True)
        self.scratch = os.path.join(self.home, "var-tmp", "shepherdr")
        os.makedirs(os.path.dirname(self.scratch))
        self.store = os.path.join(self.home, "store")
        os.makedirs(self.store)
        self.live = set()
        env = {k: v for k, v in os.environ.items() if k != "HERDR_TASK_STORE"}
        for p in (mock.patch.dict(os.environ, env, clear=True), mock.patch.object(task_tmp, "STORE", self.store),
                  mock.patch.object(task_tmp, "WHERE", layout.Where(home=self.home, env={}, mac=False)),
                  mock.patch.object(task_tmp, "SCRATCH", self.scratch), mock.patch.object(task_tmp, "_local", {}),
                  mock.patch.object(task_tmp, "real_home", lambda: self.home), mock.patch.object(task_tmp.sys, "platform", "linux"),
                  mock.patch.object(task_tmp, "_local_disk", lambda p: True), mock.patch.object(task_tmp, "hc_json", self.hc_json)):
            p.start()
            self.addCleanup(p.stop)
        self.s = FakeStore()
        self.shep = os.path.join(self.home, ".shep-tmp")
        self.cache = os.path.join(self.home, ".cache", "shepherdr", "tmp")

    def hc_json(self, *args):
        return {"terminals": [{"state": "live"}] if args[2].split("=", 1)[1] in self.live else []}

    def old(self, *parts):
        p = os.path.join(self.home, *parts)
        os.makedirs(p)
        then = time.time() - 2 * task_tmp.GRACE_S
        os.utime(p, (then, then))
        return p

    def write_list(self, tasks):
        with open(os.path.join(self.store, "home-dev-shop.json"), "w") as f:
            json.dump({"folder": "/nowhere", "tasks": tasks}, f)

    def test_linux_puts_them_on_disk_owner_only_and_tagged(self):
        self.assertEqual(task_tmp.root(), self.scratch)
        p = task_tmp.ensure(self.s, {"id": 1})
        self.assertEqual(os.path.dirname(p), self.scratch)
        self.assertEqual(stat.S_IMODE(os.stat(self.scratch).st_mode), 0o700)
        with open(os.path.join(self.scratch, "CACHEDIR.TAG")) as f:
            self.assertTrue(f.read().startswith("Signature: 8a477f597d28d172789f06886806bc55"))

    def test_macos_a_non_local_var_tmp_or_a_test_home_keep_the_homes_folder(self):
        with mock.patch.object(task_tmp.sys, "platform", "darwin"):
            self.assertEqual(task_tmp.root(), self.shep)
        with mock.patch.object(task_tmp, "_local_disk", lambda p: False):
            self.assertEqual(task_tmp.root(), self.shep)
        with mock.patch.object(task_tmp, "real_home", lambda: "/home/someone-else"):
            self.assertEqual(task_tmp.root(), self.shep)

    def test_a_scratch_folder_someone_else_made_is_never_used(self):
        """/var/tmp is everyone's: a link (or another user's folder) there in its name means the home's own."""
        os.symlink(self.home, self.scratch)
        self.assertEqual(task_tmp.root(), self.shep)
        p = task_tmp.ensure(self.s, {"id": 1})
        self.assertEqual(os.path.dirname(p), self.shep)

    def test_local_disk_reads_the_last_mount_over_the_path(self):
        mounts = os.path.join(self.home, "mounts")
        with open(mounts, "w") as f:
            f.write("/dev/sda1 / ext4 rw 0 0\ntmpfs /tmp tmpfs rw 0 0\nserver:/x /mnt/net nfs4 rw 0 0\n"
                    "tmpfs /var/tmp tmpfs rw 0 0\n/dev/sdb1 /var/tmp ext4 rw 0 0\n/dev/sdc1 /mnt/my\\040disk xfs rw 0 0\n")
        with mock.patch.object(task_tmp, "MOUNTS", mounts):
            got = {p: LOCAL_DISK(p) for p in ("/", "/tmp", "/tmp/x", "/mnt/net/y", "/var/tmp", "/mnt/my disk", "/home/x")}
        self.assertEqual(got, {"/": True, "/tmp": False, "/tmp/x": False, "/mnt/net/y": False, "/var/tmp": True,
                               "/mnt/my disk": True, "/home/x": True})

    def test_the_folder_leaves_room_for_a_socket(self):
        """On disk, and in the longest home on macOS: TMPDIR and SOCKET_ROOM more bytes stay under each OS's socket
        limit; the cache folder older copies used did not."""
        p = os.path.join("/var/tmp/shepherdr", "abc123")
        self.assertLessEqual(len(p) + task_tmp.SOCKET_ROOM, task_tmp.SOCKET_MAX["linux"], p)
        for os_name, home in LONGEST_HOME.items():
            self.assertEqual(len(home), task_tmp.MAX_HOME)
            p = os.path.join(home, task_tmp.ROOT_NAME, "abc123")
            self.assertLessEqual(len(p) + task_tmp.SOCKET_ROOM, task_tmp.SOCKET_MAX[os_name], p)
            old = os.path.join(home, "Library", "Caches", "shepherdr", "tmp", "longprefix-123456-abcd")
            self.assertGreater(len(old) + task_tmp.SOCKET_ROOM, task_tmp.SOCKET_MAX[os_name], old)

    def test_a_socket_binds_in_a_folder_as_long_as_the_longest(self):
        """For real on this machine: a socket SOCKET_ROOM bytes past a TMPDIR as long as the longest one made."""
        import socket
        if not hasattr(socket, "AF_UNIX"):
            self.skipTest("no Unix sockets")
        longest = max(len(os.path.join(LONGEST_HOME["darwin"], task_tmp.ROOT_NAME, "abc123")), len("/var/tmp/shepherdr/abc123"))
        base = os.path.realpath(tempfile.mkdtemp(prefix="s", dir="/tmp" if os.path.isdir("/tmp") else None))
        self.addCleanup(shutil.rmtree, base, True)
        if len(base) + 2 > longest:
            self.skipTest("the machine's temp folder is already longer than that")
        tmpdir = os.path.join(base, "x" * (longest - len(base) - 1))
        os.makedirs(tmpdir)
        self.assertEqual(len(tmpdir), longest)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as srv:
            srv.bind(os.path.join(tmpdir, "s" * (task_tmp.SOCKET_ROOM - 1)))

    def test_an_install_of_its_own_keeps_them_in_its_folder(self):
        from herdr_task import layout
        one = os.path.join(self.home, "own")
        with mock.patch.object(task_tmp, "WHERE", layout.Where(home=self.home, env={"SHEPHERDR_HOME": one}, mac=False)):
            self.assertEqual(task_tmp.root(), os.path.join(one, ".shep-tmp"))
            self.assertEqual(task_tmp.roots(), [os.path.join(one, ".shep-tmp"), os.path.join(one, "cache", "tmp")])

    def test_an_install_of_its_own_in_the_home_never_sweeps_the_persons_own_folders(self):
        """SHEPHERDR_HOME=$HOME: its old place is ~/cache/tmp, maybe the person's own: only a folder a task records
        goes from there."""
        from herdr_task import layout
        mine = [self.old(*p) for p in (("cache", "tmp", "notes-2024"), ("cache", "tmp", "photos"), (".shep-tmp", "My Notes"))]
        recorded = self.old("cache", "tmp", "shop-1-abcd")
        self.write_list([{"id": 1, "state": "done", "tmp": recorded}])
        with mock.patch.object(task_tmp, "WHERE", layout.Where(home=self.home, env={"SHEPHERDR_HOME": self.home}, mac=False)):
            self.assertEqual(task_tmp.root(), self.shep)
            self.assertEqual(task_tmp.sweep(force=True), ["shop-1-abcd"])
        for p in mine:
            self.assertTrue(os.path.isdir(p), p)

    def test_an_older_copys_folder_moves_at_its_next_start_and_drains_once_unused(self):
        """A task recorded in ~/.shep-tmp (or the cache folder): its next start gets one on disk, and its old one is
        kept as tmp_old while anything of the task runs (an older reviewer may still use it), then goes."""
        old = self.old(".shep-tmp", "k3x9q2")
        t = {"id": 4, "state": "running", "tmp": old}
        new = task_tmp.ensure(self.s, t)
        self.assertEqual(os.path.dirname(new), self.scratch)
        self.assertEqual((t["tmp"], t["tmp_old"]), (new, old))
        self.write_list([t])
        self.live.add("home-dev-shop#4")
        self.assertEqual(task_tmp.sweep(force=True), [])
        self.live.clear()
        self.assertEqual(task_tmp.sweep(force=True), ["k3x9q2"])  # its new one stays: the task isn't Done
        self.assertTrue(os.path.isdir(new))
        self.assertTrue(task_tmp.remove(self.s, t))  # removed: both records go
        self.assertNotIn("tmp_old", t)

    def test_older_copies_folders_drain_by_the_same_rules(self):
        done = self.old(".cache", "shepherdr", "tmp", "shop-2-abcd")
        stray = self.old(".shep-tmp", "zz00zz")
        fresh = os.path.join(self.shep, "zz11zz")
        os.makedirs(fresh)
        shell = self.old(".shep-tmp", "zz22zz")
        open(os.path.join(shell, f"{task_tmp.SHELL_MARK}{os.getpid()}"), "w").close()  # an older web-app shell, live
        dead = self.old(".shep-tmp", "zz33zz")
        open(os.path.join(dead, f"{task_tmp.SHELL_MARK}999999999"), "w").close()
        for p in (shell, dead):
            os.utime(p, (time.time() - 2 * task_tmp.GRACE_S,) * 2)
        not_ours = self.old(".cache", "shepherdr", "tmp", "photos")
        self.write_list([{"id": 2, "state": "done", "done_at": 1, "tmp": done}])
        self.assertEqual(sorted(task_tmp.sweep(force=True)), ["shop-2-abcd", "zz00zz", "zz33zz"])
        for p in (fresh, shell, not_ours):
            self.assertTrue(os.path.isdir(p), p)
        with mock.patch.object(task_tmp, "_boot_time", lambda: time.time() + 60):  # marked before a reboot: a reused pid
            self.assertEqual(task_tmp.sweep(force=True), ["zz22zz"])


class RealScratchOutOfReach(unittest.TestCase):
    def test_a_test_run_never_reaches_the_real_scratch_folder(self):
        """This run's HOME is home_guard's throwaway one: the real SCRATCH is never the root, and the guard refuses
        it but for a run's own folder."""
        with mock.patch.dict(os.environ):
            os.environ.pop("HERDR_TASK_STORE", None)
            self.assertEqual(task_tmp.root(), os.path.join(task_tmp.WHERE.home, ".shep-tmp"))
        self.assertTrue(home_guard.touches("/var/tmp/shepherdr/abc123/x"))


class SharedWords(unittest.TestCase):
    def test_the_web_apps_shell_takes_the_lock_with_the_same_words(self):
        with open(os.path.join(ROOT, "service", "shells.ts")) as f:
            self.assertIn(f"export const TAKE = '{task_tmp.TAKE}';", f.read())


class CodexSandboxWrites(unittest.TestCase):
    """For real: a Codex workspace-write sandbox (what a worker's commands run in) writes in a TMPDIR on /var/tmp,
    as it does in /tmp: $TMPDIR is one of its own writable roots. A scratch folder beside SCRATCH, never in it."""

    def test_a_sandboxed_command_writes_in_its_tmpdir_on_disk(self):
        codex = shutil.which("codex")
        if not codex or not os.path.isdir("/var/tmp"):
            self.skipTest("no codex here")
        d = tempfile.mkdtemp(prefix="shep-sandbox-", dir="/var/tmp")  # the task's temp folder
        work = tempfile.mkdtemp(prefix="shep-work-")  # the worktree: another folder, writable on its own account
        for x in (d, work):
            self.addCleanup(shutil.rmtree, x, True)
        sandboxed = lambda tmpdir: subprocess.run(
            [codex, "sandbox", "-c", 'sandbox_mode="workspace-write"', "--", "sh", "-c",
             f'echo ok > "{d}/f" && echo wrote || echo refused'],
            env=dict(os.environ, TMPDIR=tmpdir), capture_output=True, text=True, timeout=120, cwd=work)
        r = sandboxed(work)  # the folder isn't its TMPDIR: refused, so the write below is TMPDIR's doing
        self.assertEqual(r.stdout.split()[-1:], ["refused"], r.stderr)
        r = sandboxed(d)
        self.assertEqual(r.stdout.split()[-1:], ["wrote"], r.stderr)
        with open(os.path.join(d, "f")) as f:
            self.assertEqual(f.read(), "ok\n")


class SystemdTmpfiles(unittest.TestCase):
    """For real: systemd-tmpfiles' aging, as the machine's own `q /var/tmp 30d` rule runs it, skips a task's folder
    while it is held and everything in it, and ages the rest. A scratch root and a 1-hour rule, no sudo. (A rule
    aimed at the task folders themselves, `e /var/tmp/shepherdr/*`, ages a held folder's contents: never add one.)"""

    def test_aging_skips_a_held_folder(self):
        tool = shutil.which("systemd-tmpfiles")
        if not tool:
            self.skipTest("no systemd-tmpfiles here")
        base = tempfile.mkdtemp(prefix="tasktmp-tmpfiles-")
        self.addCleanup(shutil.rmtree, base, True)
        var_tmp = os.path.join(base, "var-tmp")
        held, free = (os.path.join(var_tmp, "shepherdr", n, "sub") for n in ("abc123", "def456"))
        then = time.time() - 2 * 86400
        for d in (held, free):
            os.makedirs(d)
            with open(os.path.join(d, "old"), "w") as f:
                f.write("x")
            os.utime(os.path.join(d, "old"), (then, then))
        conf = os.path.join(base, "test.conf")
        with open(conf, "w") as f:
            f.write(f"q {var_tmp} 1777 - - m:1h\n")
        agent = held_by(os.path.dirname(held))
        try:
            r = subprocess.run([tool, "--clean", conf], capture_output=True, text=True, timeout=60)
        finally:
            end(agent)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(os.path.join(held, "old")))
        self.assertFalse(os.path.exists(os.path.join(free, "old")))


class TaskAgentEnv(unittest.TestCase):
    """The task's agent starts with its temp folder as TMPDIR, TMP and TEMP: launch()'s own argv runs for real, `env`
    as its agent (hc is never run)."""

    def test_the_agent_sees_its_temp_folder(self):
        task, env = self.launched(["env"])
        self.assertEqual(task["tmp"], os.path.join(self.store, ".tmp", os.path.basename(task["tmp"])))
        for v in ("TMPDIR", "TMP", "TEMP"):
            self.assertEqual(env.get(v), task["tmp"], v)

    def test_the_agent_holds_its_folders_lock_while_it_runs(self):
        probe = ("import fcntl, os\nfd = os.open(os.environ['TMPDIR'], os.O_RDONLY)\n"
                 "try:\n    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); print('HELD=no')\nexcept OSError:\n    print('HELD=yes')")
        task, env = self.launched([sys.executable, "-c", probe])
        self.assertEqual(env.get("HELD"), "yes")
        self.assertTrue(lockable(task["tmp"]))  # it ended: so did its lock

    def launched(self, agent):
        """launch()'s own argv for `agent`, run for real: (the task, what the agent printed as VAR=value)."""
        import herdr_task.launch as L
        self.store = store = tempfile.mkdtemp(prefix="tasktmp-store-")
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
            L.launch(s, task, agent, "sp1")
        hc = ran[0]
        out = subprocess.run(hc[hc.index("--") + 1:], env={"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], "TMPDIR": "/tmp"},
                             capture_output=True, text=True, timeout=20)
        return task, dict(l.split("=", 1) for l in out.stdout.splitlines() if "=" in l)

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

    def test_a_run_in_a_short_task_folder_opens_its_own_and_nothing_beside(self):
        """Today's task folders are in ~/.shep-tmp: the same rules as in the cache folder older copies used."""
        tempfile.tempdir = shared = os.path.join(self.home, ".shep-tmp", "k3x9q2")
        os.makedirs(shared)
        run = home_guard.start_run()
        self.assertEqual(os.path.dirname(run), shared)
        self.write(os.path.join(run, "tmp", "a"))
        self.write(os.path.join(shared, "beside"))
        for p in (".shep-tmp/zz00zz/x", ".shep-tmp/x", ".cache/shepherdr/tmp/sd-2-efgh/x"):
            with self.subTest(p=p):
                self.assertRefused(os.path.join(self.home, p))
        home_guard.OWN.clear()
        home_guard.own(shared=os.path.join(self.home, ".shep-tmp"))  # the whole folder is never one task's
        self.assertEqual(home_guard.OWN, [])

    def test_a_run_in_a_task_folder_on_disk_opens_its_own_and_nothing_beside(self):
        """Linux's task folders are in SCRATCH, outside the home and guarded all the same: a run started in one opens
        its own folders, never another task's or SCRATCH itself."""
        scratch = os.path.join(self.home, "var-tmp-shepherdr")
        tempfile.tempdir = shared = os.path.join(scratch, "k3x9q2")
        os.makedirs(shared)
        with mock.patch.object(home_guard, "SCRATCH", scratch):
            run = home_guard.start_run()
            self.write(os.path.join(run, "tmp", "a"))
            self.write(os.path.join(shared, "beside"))
            for p in ("zz00zz/x", "x"):
                with self.subTest(p=p):
                    self.assertRefused(os.path.join(scratch, p))
            home_guard.OWN.clear()
            home_guard.own(shared=scratch)  # the whole folder is never one task's
            self.assertEqual(home_guard.OWN, [])

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
