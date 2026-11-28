"""dmalis/shepherdr#250: a Codex reviewer reads everything and writes only its own temp folder
(herdr_task/review_sandbox.py), so it can run the task's tests and still can't change the worktree.

The launch line's words and the Codex worker's allow-list run anywhere. The real check runs the same words in Codex's
own sandbox (`codex sandbox`, no agent and no sign-in), when codex is on PATH and its sandbox starts here."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, BIN)

from herdr_task import launch, review_sandbox, settings  # noqa: E402


def profile(argv):
    """The -c overrides in a Codex command line, as {key: TOML value}."""
    out = {}
    for i, a in enumerate(argv[:-1]):
        if a == "-c":
            key, _, value = argv[i + 1].partition("=")
            out[key] = tomllib.loads(f"v = {value}")["v"]
    return out


class LaunchLine(unittest.TestCase):
    """The reviewer's line: a writable temp folder, and still no write to the worktree."""

    def argv(self, *a, **k):
        return shlex.split(settings.reviewer_command("codex", *a, **k))

    def test_it_writes_only_its_own_temp_folder(self):
        for argv in (self.argv(), self.argv("gpt-6.2-sol", "high", fast=False, compact=300000)):
            c = profile(argv)
            self.assertEqual(c["default_permissions"], "shepherdr-reviewer")
            # reads everything, as read-only did; writes only $TMPDIR: not the worktree, /tmp or anything else
            self.assertEqual(c["permissions.shepherdr-reviewer.filesystem"], {":root": "read", ":tmpdir": "write"})
            # a Codex without profiles stays read-only
            self.assertEqual(c["sandbox_mode"], "read-only")
            # no flag that wins over the profile, nor one that widens it
            for flag in ("--sandbox", "-s", "--add-dir", "--full-auto", "--dangerously-bypass-approvals-and-sandbox"):
                self.assertNotIn(flag, argv)
            self.assertFalse([k for k in c if k.startswith(("sandbox_workspace_write", "sandbox_permissions"))])
            self.assertEqual(argv[argv.index("--ask-for-approval") + 1], "never")

    def test_its_temp_folder_is_the_tasks(self):
        # the worker's shell expands it to the task's TMPDIR (task_tmp.py), nothing when it has none
        cmd = settings.reviewer_command("codex")
        self.assertIn(settings.TASK_TMP, cmd)
        out = subprocess.run(["sh", "-c", cmd.split(" codex ")[0] + " sh -c 'echo $TMPDIR'"],
                             env={"PATH": "/usr/bin:/bin", "HOME": os.environ["HOME"], "TMPDIR": "/var/tmp/shepherdr/k3x9q2"},
                             capture_output=True, text=True).stdout
        self.assertEqual(out.strip(), "/var/tmp/shepherdr/k3x9q2")


class WorkerAllowlist(unittest.TestCase):
    """A Codex worker starts its reviewer from the brief without a permission card, the old line too, and nothing wider."""

    def own(self, cmd):
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "demo#1"}):
            return launch.own_command("/x/herdr-task", f"hc run --bg --name demo-1-review -- {cmd} 'review'", True)

    def test_the_new_line_and_the_old_one(self):
        self.assertTrue(self.own(settings.reviewer_command("codex", "gpt-6.2-sol", "high", fast=False)))
        self.assertTrue(self.own("codex --no-daemon --sandbox read-only --ask-for-approval never --disable hooks -m gpt-6.2-sol"))

    def test_nothing_wider(self):
        line = shlex.join(["codex", "--no-daemon", *review_sandbox.ARGS, "--ask-for-approval", "never"])
        wider = ['-c \'sandbox_mode="workspace-write"\'', "-c 'default_permissions=\":workspace\"'",
                 "-c 'permissions.shepherdr-reviewer.filesystem={\":root\"=\"write\"}'",
                 "-c 'sandbox_workspace_write.writable_roots=[\"/\"]'", "--add-dir /", "--sandbox workspace-write"]
        for bad in wider:
            self.assertFalse(self.own(f"{line} {bad}"), bad)
        # the profile's own words changed in place
        for old, new in ((':tmpdir"="write', ':root"="write'), ('"read-only"', '"workspace-write"'), ("default_permissions=\"shepherdr-reviewer", "default_permissions=\":workspace")):
            self.assertFalse(self.own(line.replace(old, new, 1)), new)


def sandbox_works():
    if not shutil.which("codex"):
        return False
    try:
        r = subprocess.run(["codex", "sandbox", "-c", 'sandbox_mode="read-only"', "--", "true"],
                           capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0


PROBE = """import os, tempfile, unittest

class T(unittest.TestCase):
    def test_temp_file(self):
        with tempfile.NamedTemporaryFile() as f:
            f.write(b"ok")
        os.rmdir(tempfile.mkdtemp())

    def test_worktree_refused(self):
        with self.assertRaises(OSError):
            open(os.path.join(os.getcwd(), "written-by-reviewer"), "w")

    def test_slash_tmp_refused(self):
        with self.assertRaises(OSError):
            open("/tmp/written-by-reviewer-%d" % os.getpid(), "w")

unittest.main()
"""

PYTEST = """import os

def test_tmp_path(tmp_path):
    (tmp_path / "a").write_text("ok")
    assert (tmp_path / "a").read_text() == "ok"
"""


@unittest.skipUnless(sandbox_works(), "codex's sandbox isn't available here")
class RealSandbox(unittest.TestCase):
    """The reviewer's sandbox words in Codex's own sandbox: in a scratch worktree, a test's temp files work, writing
    the worktree is refused; read-only, the line before, has no temp folder at all."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.wt = os.path.join(self.dir, "worktree")
        os.makedirs(self.wt)
        subprocess.run(["git", "init", "-q", self.wt], check=True)
        with open(os.path.join(self.wt, "probe.py"), "w") as f:
            f.write(PROBE)
        with open(os.path.join(self.wt, "test_tmp_path.py"), "w") as f:
            f.write(PYTEST)

    def run_in(self, sandbox, cmd, tmp):
        env = dict(os.environ, TMPDIR=tmp, TMP=tmp, TEMP=tmp)
        return subprocess.run(["codex", "sandbox", *sandbox, "--", *cmd], cwd=self.wt, env=env, capture_output=True,
                              text=True, timeout=120)

    def tmp(self, base):
        t = tempfile.mkdtemp(dir=base)
        self.addCleanup(shutil.rmtree, t, True)
        return t

    def test_temp_files_work_and_the_worktree_is_refused(self):
        # the task's folder in the home, and under /var/tmp (where it may live on a machine of its own)
        for base in (self.dir, "/var/tmp"):
            if not os.access(base, os.W_OK):
                continue
            r = self.run_in(review_sandbox.ARGS, [sys.executable, "probe.py"], self.tmp(base))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("OK", r.stderr)
            g = self.run_in(review_sandbox.ARGS, ["git", "commit", "--allow-empty", "-q", "-m", "x"], self.tmp(base))
            self.assertNotEqual(g.returncode, 0)
        self.assertEqual(sorted(os.listdir(self.wt)), [".git", "probe.py", "test_tmp_path.py"])

    def test_pytest_tmp_path(self):
        try:
            import pytest  # noqa: F401
        except ImportError:
            self.skipTest("no pytest here")
        r = self.run_in(review_sandbox.ARGS, [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_tmp_path.py"],
                        self.tmp(self.dir))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("1 passed", r.stdout)

    def test_read_only_had_no_temp_folder(self):
        # the line before: a test's first temp file fails ("No usable temporary directory")
        r = self.run_in(["-c", 'sandbox_mode="read-only"'], [sys.executable, "probe.py"], self.tmp(self.dir))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("No usable temporary directory", r.stderr)


if __name__ == "__main__":
    unittest.main()
