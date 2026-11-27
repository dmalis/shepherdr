"""fork/bin/rehearse's own tests (Part of #2): the whole rehearsal on a scratch space made from this checkout (the
real installer, the real fork/bin/sync, on throwaway roots), a failure's cleanup, the stand-in updater against the
runner it stands in for, the children's environment, which pipeline code a pass is recorded for, and health's test
flag, which only a scratch root obeys. Nothing reaches the real home, hc, GitHub or the live install."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import importlib.machinery  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import signal  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import install, state  # noqa: E402

REHEARSE = os.path.join(ROOT, "fork", "bin", "rehearse")
IDENT = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "T",
         "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}


def load():
    loader = importlib.machinery.SourceFileLoader("fork_rehearse", REHEARSE)
    spec = importlib.util.spec_from_loader("fork_rehearse", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


rehearse = load()


def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env=dict(os.environ, **IDENT))
    if r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {r.stderr}")
    return r.stdout.strip()


def set_version(folder, version):
    path = os.path.join(folder, "bin", "shepherdr")
    with open(path, encoding="utf-8") as f:
        text = f.read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(re.sub(r'^VERSION = "[^"]+"', f'VERSION = "{version}"', text, count=1, flags=re.M))


class Space:
    """A scratch space: this checkout's files as two commits, the baseline 3.2.20 (tagged v3.2.20) and the candidate
    3.2.21 on top (untagged, like main's tip)."""

    def __init__(self, top, candidate_edit=None):
        self.folder = os.path.join(top, "space")
        shutil.copytree(ROOT, self.folder, ignore=shutil.ignore_patterns(
            ".git", "node_modules", "__pycache__", "dist", ".private", "generated"))
        git(top, "init", "-q", "-b", "main", self.folder)
        set_version(self.folder, "3.2.20")
        git(self.folder, "add", "-A")
        git(self.folder, "commit", "-q", "-m", "baseline")
        git(self.folder, "tag", "v3.2.20")
        self.base = git(self.folder, "rev-parse", "HEAD")
        set_version(self.folder, "3.2.21")
        if candidate_edit:
            candidate_edit(self.folder)
        git(self.folder, "add", "-A")
        git(self.folder, "commit", "-q", "-m", "candidate")
        self.cand = git(self.folder, "rev-parse", "HEAD")


class Run(unittest.TestCase):
    """The real rehearsal, as a program, on a scratch space."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fork-rehearse-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.scratch_tmp = os.path.join(self.tmp, "tmp")
        self.state_root = os.path.join(self.tmp, "state-home")
        os.makedirs(self.scratch_tmp)

    def rehearse(self, space, *extra):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "FORK_"))}
        env.update(TMPDIR=self.scratch_tmp, HC_SESSION="shepherdr", HERDR_BROWSER_TASK="X-1",
                   SHEPHERDR_KEEP_SYNC_HOLD="1", FORK_SYNC_FORCE_HEALTH_FAIL="1")   # the caller's: none may leak
        p = subprocess.run([sys.executable, REHEARSE, space.cand, "--repo", space.folder, "--no-build",
                            "--root", self.state_root, *extra], capture_output=True, text=True, env=env,
                           stdin=subprocess.DEVNULL, timeout=600)
        return p

    def st(self):
        return state.load(state.Paths(self.state_root))

    def test_it_passes_on_a_good_candidate_and_leaves_nothing(self):
        space = Space(self.tmp)
        p = self.rehearse(space)
        lines = p.stdout.strip().splitlines()
        self.assertEqual(lines[-1], "PASS", p.stdout + p.stderr)
        self.assertEqual(p.returncode, 0)
        steps = [ln.split(":")[1].strip() for ln in lines[:-1] if ln.startswith("ok: ")]
        self.assertEqual(steps, ["commit", "clone", "install baseline", "forced failure", "failed update", "install",
                                 "hold", "hooks", "health", "cleanup", "record"])
        self.assertIn(f"{space.cand[:12]} over the baseline {space.base[:12]}", p.stdout)
        self.assertIn("the release in it v3.2.20", p.stdout)
        self.assertIn("health told to fail, rolled back to 3.2.20", p.stdout)
        self.assertRegex(p.stdout, r"the update read as (ok|failed), health failed at \w+, rolled back to 3\.2\.20")
        self.assertEqual(os.listdir(self.scratch_tmp), [], "the scratch folder is gone")
        # the pass, recorded for the pipeline code that ran, when it is committed
        code = rehearse.code_hash()
        recs = self.st()["rehearsals"]
        if code:
            self.assertEqual([(r["sha"], r["hash"]) for r in recs], [(space.cand, code)])
            self.assertIn("recorded in the sync state", p.stdout)
        else:
            self.assertEqual(recs, [])
            self.assertIn("not recorded: the pipeline code here has uncommitted changes", p.stdout)
        # nothing in the space moved: its HEAD, its branch, no new refs
        self.assertEqual(git(space.folder, "rev-parse", "HEAD"), space.cand)
        self.assertEqual(git(space.folder, "status", "--porcelain"), "")
        self.assertEqual(git(space.folder, "for-each-ref", "--format=%(refname)").split(),
                         ["refs/heads/main", "refs/tags/v3.2.20"])

    def test_a_candidate_install_refuses_fails_and_is_cleaned_up(self):
        def no_hold_patch(folder):
            shutil.rmtree(os.path.join(folder, "fork", "patches"))
        space = Space(self.tmp, candidate_edit=no_hold_patch)
        p = self.rehearse(space)
        last = p.stdout.strip().splitlines()[-1]
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertTrue(last.startswith("FAIL: forced failure: the install ended held: "), last)
        self.assertIn("hold patch", last)
        self.assertEqual(os.listdir(self.scratch_tmp), [], "cleaned up after the failure")
        self.assertEqual(self.st()["rehearsals"], [], "a failure records nothing")

    def test_ctrl_c_during_the_update_stops_it_and_cleans_up(self):
        """The update runs in its own process session, out of Ctrl-C's reach: cleanup stops it, with what it runs,
        before the scratch folder goes."""
        mark = os.path.join(self.tmp, "update-started")

        def slow_update(folder):
            path = os.path.join(folder, "bin", "shepherdr")
            with open(path, encoding="utf-8") as f:
                text = f.read()
            head = "def cmd_install(a, update=False):\n"
            self.assertIn(head, text)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text.replace(head, head + f"    if update:\n        open({mark!r}, 'w').close()\n"
                                                  "        time.sleep(300)\n", 1))
        space = Space(self.tmp, candidate_edit=slow_update)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_", "FORK_"))}
        env.update(TMPDIR=self.scratch_tmp)
        p = subprocess.Popen([sys.executable, REHEARSE, space.cand, "--repo", space.folder, "--no-build",
                              "--root", self.state_root], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             env=env, stdin=subprocess.DEVNULL)
        self.addCleanup(self.stop_strays)      # a failed assertion still stops what the rehearsal started
        out = err = ""
        try:
            deadline = time.time() + 180
            while not os.path.exists(mark) and time.time() < deadline and p.poll() is None:
                time.sleep(0.2)
            self.assertTrue(os.path.exists(mark), "the candidate's update never began")
            self.assertTrue(self.procs(), "the update runs under the scratch folder")
        finally:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)   # the rehearsal's own cleanup, also when the test failed above
                try:
                    out, err = p.communicate(timeout=120)
                except subprocess.TimeoutExpired:
                    p.kill()
                    out, err = p.communicate()
        self.assertEqual(out.strip().splitlines()[-1], "FAIL: interrupted: SIGINT", out + err)
        self.assertEqual(os.listdir(self.scratch_tmp), [], "the scratch folder is gone")
        self.assertEqual(self.procs(), [], "nothing the rehearsal started still runs")
        self.assertEqual(self.st()["rehearsals"], [])

    def procs(self):
        """Processes whose command line names this test's scratch folder, from `ps` (Linux and macOS alike)."""
        r = subprocess.run(["ps", "-A", "-o", "pid=,command="], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = []
        for line in r.stdout.splitlines():
            pid, _, cmd = line.strip().partition(" ")
            if self.scratch_tmp in cmd and pid.isdigit() and int(pid) != os.getpid():
                out.append((int(pid), cmd[:120]))
        return out

    def stop_strays(self):
        for pid, _ in self.procs():
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    def test_cleanup_keeps_the_scratch_folder_while_an_update_still_runs(self):
        r = rehearse.Rehearsal("HEAD", ROOT, state_root=self.state_root)
        r.scratch = tempfile.mkdtemp(prefix="fork-rehearse-kept-", dir=self.scratch_tmp)
        with mock.patch.object(rehearse.Rehearsal, "stop_runners", return_value=[4242]):
            problems = r.cleanup()
        self.assertEqual(problems, ["an update the rehearsal started wouldn't stop, so its scratch folder was kept"])
        self.assertTrue(os.path.isdir(r.scratch))

    def test_a_baseline_that_is_the_commit_is_refused(self):
        space = Space(self.tmp)
        p = self.rehearse(space, "--baseline", space.cand)
        self.assertEqual(p.stdout.strip().splitlines()[-1],
                         "FAIL: commit: the baseline is the commit itself: nothing to rehearse")
        self.assertEqual(os.listdir(self.scratch_tmp), [])


class Updater(unittest.TestCase):
    """The stand-in for `herdr-task update-shepherdr`, as install.py reads it."""

    def setUp(self):
        self.scratch = tempfile.mkdtemp(prefix="fork-rehearse-upd-")
        self.addCleanup(shutil.rmtree, self.scratch, True)
        bin_ = os.path.join(self.scratch, "root", ".local", "bin")
        os.makedirs(bin_)
        self.cli = os.path.join(bin_, "shepherdr")
        self.seen = os.path.join(self.scratch, "seen")

    def fake_cli(self, code):
        with open(self.cli, "w") as f:
            f.write(f'#!/bin/sh\necho "$* hold=$SHEPHERDR_KEEP_SYNC_HOLD" > "{self.seen}"\n'
                    f'echo "Shepherdr 9.9.{code} update from somewhere"\nexit {code}\n')
        os.chmod(self.cli, 0o755)

    def call(self, *args, env=None):
        return subprocess.run([sys.executable, REHEARSE, "--updater", self.scratch, "update-shepherdr", "R-1",
                               "--folder", "/f", *args], capture_output=True, text=True,
                              env=dict(os.environ, **(env or {})), timeout=60)

    def outcome(self, asked):
        site = types.SimpleNamespace(live=False)
        with mock.patch.dict(os.environ, FORK_SYNC_SCRATCH_UPDATER=os.path.join(self.scratch, "u"),
                             FORK_SYNC_UPDATE_POLL_S="0.1"):
            with open(os.path.join(self.scratch, "u"), "w") as f:
                f.write(f'#!/bin/sh\nexec "{sys.executable}" "{REHEARSE}" --updater "{self.scratch}" "$@"\n')
            os.chmod(os.path.join(self.scratch, "u"), 0o755)
            return install.read_outcome(site, {"task": "R-1", "folder": "/f", "asked": asked})

    def test_an_ask_runs_the_installed_update_in_the_background_with_the_hold_variable(self):
        self.fake_cli(0)
        asked = rehearse.now_ms()
        p = self.call("--no-wait", env={install.HOLD_VAR: "1"})
        self.assertEqual(p.returncode, 75, "running, as herdr-task says it")
        self.assertEqual(json.loads(p.stdout)["state"], "running")
        got, seen = self.outcome(asked)
        self.assertEqual(got, "ok")
        self.assertEqual(seen["version"], "9.9.0")
        root = os.path.join(self.scratch, "root")
        with open(self.seen) as f:
            self.assertEqual(f.read().strip(), f"update --root {root} hold=1")
        st = json.loads(self.call("--status", "--json").stdout)
        self.assertEqual((st["state"], st["code"]), ("ok", 0))
        self.assertGreaterEqual(st["at"], asked)

    def test_a_nonzero_exit_is_failed(self):
        self.fake_cli(1)
        asked = rehearse.now_ms()
        self.call("--no-wait")
        got, _ = self.outcome(asked)
        self.assertEqual(got, "failed")

    def test_no_update_yet_reads_as_not_started(self):
        got, seen = self.outcome(rehearse.now_ms())
        self.assertEqual((got, seen.get("state")), ("failed", "not started"))

    def test_cleanup_stops_a_running_update_and_what_it_runs(self):
        """Also where there is no /proc (macOS): the runner is found by `ps`, its whole group stopped and waited for."""
        child = os.path.join(self.scratch, "child")
        with open(self.cli, "w") as f:
            f.write(f'#!/bin/sh\nsleep 300 &\necho $! > "{child}"\nwait\n')
        os.chmod(self.cli, 0o755)
        for proc in ("/proc", os.path.join(self.scratch, "no-proc")):
            with self.subTest(proc=proc):
                shutil.rmtree(rehearse.updates_dir(self.scratch), True)
                if os.path.exists(child):
                    os.remove(child)
                self.call("--no-wait")
                deadline = time.time() + 30
                while not os.path.exists(child) and time.time() < deadline:
                    time.sleep(0.1)
                with open(child) as f:
                    sleeper = int(f.read().strip())
                pid = json.loads(self.call("--status", "--json").stdout)["pid"]
                r = types.SimpleNamespace(scratch=self.scratch)
                real = rehearse.cmdline
                with mock.patch.object(rehearse, "cmdline", lambda p: real(p, proc=proc)):
                    left = rehearse.Rehearsal.stop_runners(r, wait=5)
                self.assertEqual(left, [])
                self.assertFalse(rehearse.with_group(pid, 0), "the runner's group is gone")
                self.assertIsNone(real(sleeper), "the update's own child is gone too")

    def test_a_runner_left_after_cleanup_writes_nothing(self):
        path = rehearse.status_path(self.scratch, "R-1")
        self.assertIsNone(rehearse.merge_status(path, pid=1))
        self.assertEqual(rehearse.updater_run(self.scratch, "R-1"), 0)
        self.assertFalse(os.path.exists(os.path.dirname(path)), "it never makes its folder again")

    def test_it_stands_in_for_the_real_runner(self):
        """Pins self_update's runner: `shepherdr update [--root]`, ok only on exit 0, the version from its output."""
        with open(os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task", "self_update.py"), encoding="utf-8") as f:
            text = f.read()
        self.assertIn('argv = ["shepherdr", "update"] + (["--root", root] if root else [])', text)
        self.assertIn('state="ok" if code == 0 else "failed"', text)
        self.assertIn(r're.findall(r"Shepherdr (\d+\.\d+\.\d+)", tail)', text)
        self.assertIn("start_new_session=True", text)


class Environment(unittest.TestCase):
    def test_a_child_gets_none_of_the_callers_terminal_session_agent_or_knobs(self):
        caller = {"HOME": "/h", "PATH": "/usr/bin", "TERM": "xterm", "HC_SESSION": "shepherdr", "HC_SOCKET": "/s",
                  "HERDR_BROWSER_TASK": "X-1", "HERDR_GUARD_SESSION": "shepherdr", "CLAUDE_CODE_X": "1",
                  "CODEX_HOME": "/c", "SHEPHERDR_KEEP_SYNC_HOLD": "1", "SHEPHERDR_HANDED_OVER": "1",
                  "FORK_SYNC_FORCE_HEALTH_FAIL": "1", "GIT_DIR": "/g", "XDG_RUNTIME_DIR": "/run/user/1"}
        env = rehearse.clean_env(caller, "/scratch", "fork-rehearse-ab12cd34")
        for k in env:
            if k in ("HC_SESSION", "SHEPHERDR_SESSION"):
                self.assertEqual(env[k], "fork-rehearse-ab12cd34", "its own session's name, never the live one")
            elif k not in ("GIT_TERMINAL_PROMPT", "GIT_CONFIG_NOSYSTEM"):
                self.assertFalse(k.startswith(rehearse.DROP_PREFIXES), k)
        self.assertEqual((env["HOME"], env["TMPDIR"], env["XDG_RUNTIME_DIR"]), ("/h", "/scratch/tmp", "/run/user/1"))

    def test_path_leaves_out_the_guard_and_the_live_helpers(self):
        top = tempfile.mkdtemp(prefix="fork-rehearse-path-")
        self.addCleanup(shutil.rmtree, top, True)
        dirs = {}
        for name, holds in (("guard", "guard.sh"), ("live", "herdr-task"), ("cli", "shepherdr"), ("tools", "git")):
            dirs[name] = os.path.join(top, name)
            os.makedirs(dirs[name])
            open(os.path.join(dirs[name], holds), "w").close()
        path = rehearse.tool_path(os.pathsep.join(dirs[n] for n in ("guard", "live", "tools", "cli", "tools")))
        self.assertEqual(path.split(os.pathsep), [dirs["tools"], "/usr/bin", "/bin"])


class CodeHash(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp(prefix="fork-rehearse-code-")
        self.addCleanup(shutil.rmtree, self.repo, True)
        git(self.repo, "init", "-q")
        for d in install.PIPELINE_CODE:
            os.makedirs(os.path.join(self.repo, d))
            with open(os.path.join(self.repo, d, "x.py"), "w") as f:
                f.write("x = 1\n")
        with open(os.path.join(self.repo, "README.md"), "w") as f:
            f.write("hi\n")
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "c")

    def test_committed_code_is_its_pipeline_hash(self):
        self.assertEqual(rehearse.code_hash(self.repo), install.pipeline_hash(self.repo, "HEAD"))

    def test_other_changes_dont_count(self):
        with open(os.path.join(self.repo, "README.md"), "a") as f:
            f.write("more\n")
        self.assertEqual(rehearse.code_hash(self.repo), install.pipeline_hash(self.repo, "HEAD"))

    def test_uncommitted_pipeline_code_is_never_recorded(self):
        for change in ("fork/sync/x.py", "fork/bin/new"):
            with self.subTest(change=change):
                with open(os.path.join(self.repo, change), "a") as f:
                    f.write("y = 2\n")
                self.assertIsNone(rehearse.code_hash(self.repo))
                git(self.repo, "checkout", "-q", "--", ".")
                git(self.repo, "clean", "-qfd")

    def test_not_a_checkout(self):
        self.assertIsNone(rehearse.code_hash(os.path.join(self.repo, "fork")))


class ForcedFailure(unittest.TestCase):
    """health's test flag: the rehearsal's forced failure. A scratch root obeys it, before doctor; the real home never
    reads it."""

    def lines(self, live):
        s = types.SimpleNamespace(live=live, folder="/f", home="/h")
        ins = {"before": {"hooks": {}, "assistants": []}}
        with mock.patch.object(install, "hook_shas", return_value={}), \
                mock.patch.object(install, "record", return_value={"version": "1", "source": "/f", "at": "20990101-000000",
                                                                    "whole": True}), \
                mock.patch.object(install, "version_at", return_value="1"), \
                mock.patch.object(install, "same_path", return_value=True), \
                mock.patch.object(install, "installed_files_differ", return_value=None), \
                mock.patch.object(install, "web_served", return_value=None), \
                mock.patch.object(install, "tasks_answer", return_value=None), \
                mock.patch.object(install, "assistants", return_value=[]), \
                mock.patch.object(install, "scheduler_runs_new_code", return_value=True), \
                mock.patch.object(install, "doctor", return_value=None) as doctor, \
                mock.patch.dict(os.environ, {install.FORCE_HEALTH_FAIL: "1"}):
            out = install.health_lines(s, "/f", "a" * 40, ins, {"at": 1000}, candidate=True, sleep=lambda _: None)
        return out, doctor

    def test_a_scratch_root_fails_before_doctor(self):
        out, doctor = self.lines(live=False)
        self.assertEqual(out[-1][:2], ("forced", False))
        doctor.assert_not_called()

    def test_the_real_home_ignores_it(self):
        out, doctor = self.lines(live=True)
        self.assertNotIn("forced", [n for n, _, _ in out])
        self.assertEqual(out[-1][:2], ("doctor", True))
        doctor.assert_called_once()


if __name__ == "__main__":
    unittest.main()
