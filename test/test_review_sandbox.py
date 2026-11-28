"""dmalis/shepherdr#250: a Codex reviewer reads everything and writes only its task's own temp folder
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

from herdr_task import launch, review_sandbox, settings, task_tmp  # noqa: E402


def overrides(argv):
    """The -c overrides in a Codex command line, as {key: TOML value}."""
    out = {}
    for i, a in enumerate(argv[:-1]):
        if a == "-c":
            key, _, value = argv[i + 1].partition("=")
            out[key] = tomllib.loads(f"v = {value}")["v"]
    return out


class Roots(unittest.TestCase):
    """A scratch root standing in for task_tmp's (~/.shep-tmp, or /var/tmp/shepherdr/ on a machine of its own)."""

    base = None

    def setUp(self):
        self.root = tempfile.mkdtemp(dir=self.base)
        self.addCleanup(shutil.rmtree, self.root, True)
        p = mock.patch.object(task_tmp, "roots", lambda: [self.root])
        p.start()
        self.addCleanup(p.stop)
        self.tmp = os.path.join(self.root, "k3x9q2")
        os.mkdir(self.tmp, 0o700)
        self.wt = os.path.join(tempfile.mkdtemp(), "worktree")
        self.addCleanup(shutil.rmtree, os.path.dirname(self.wt), True)
        os.makedirs(self.wt)


class LaunchLine(Roots):
    """The reviewer's line: its task's temp folder writable, and still no write to the worktree or anything else."""

    def argv(self, tmp, *a, **k):
        return shlex.split(settings.reviewer_command("codex", *a, folder=self.wt, tmp=tmp, **k))

    def test_it_writes_only_its_task_s_temp_folder(self):
        for argv in (self.argv(self.tmp), self.argv(self.tmp, "gpt-6.2-sol", "high", fast=False, compact=300000)):
            c = overrides(argv)
            self.assertEqual(c["default_permissions"], "shepherdr-reviewer")
            # reads everything, as read-only did; writes only that folder: not the worktree, /tmp or anything else
            self.assertEqual(c["permissions.shepherdr-reviewer.filesystem"], {":root": "read", self.tmp: "write"})
            # nothing that wins over the profile, widens it, or that Codex's docs say not to combine with it
            for flag in ("--sandbox", "-s", "--add-dir", "--full-auto", "--dangerously-bypass-approvals-and-sandbox"):
                self.assertNotIn(flag, argv)
            self.assertFalse([k for k in c if k.startswith(("sandbox_mode", "sandbox_workspace_write", "sandbox_permissions"))])
            self.assertEqual(argv[argv.index("--ask-for-approval") + 1], "never")

    def test_any_other_folder_stays_read_only(self):
        # none, the machine's temp folders, the home, the worktree, a folder holding it or inside it, another name
        inside = os.path.join(self.wt, "k3x9q2")
        for tmp in (None, "", "/tmp", "/var/tmp", os.path.expanduser("~"), self.wt, os.path.dirname(self.wt), inside,
                    os.path.join(self.root, "not-ours"), os.path.join(self.root, "k3x9q2", "..", ".."), "k3x9q2"):
            argv = self.argv(tmp)
            self.assertEqual(argv[argv.index("--no-daemon") + 1:argv.index("--no-daemon") + 3], ["--sandbox", "read-only"], tmp)
            self.assertNotIn("default_permissions", " ".join(argv), tmp)
        # a temp root inside the worktree: its folder is the worktree's too
        with mock.patch.object(task_tmp, "roots", lambda: [self.wt]):
            self.assertIsNone(review_sandbox.writable(inside, self.wt))

    def test_a_task_s_brief_names_the_folder_its_start_makes(self):
        # the brief is written before launch() makes the folder (task_tmp.ensure): the same path, by task_tmp's name
        class S:
            slug, loc = "home-dev-shop", {"folder": self.wt}

            def ref(self, t):
                return f"SHOP-{t['id']}"
        t = {"id": 7, "title": "x"}
        with mock.patch.object(task_tmp, "root", lambda: self.root):
            want = task_tmp.path_for(S(), t)
            self.assertEqual(review_sandbox.folder_of(S(), t, self.wt), want)
            t["tmp"] = self.tmp  # recorded on the task: that one
            self.assertEqual(review_sandbox.folder_of(S(), t, self.wt), self.tmp)
            t["tmp"] = "/tmp"
            self.assertIsNone(review_sandbox.folder_of(S(), t, self.wt))

    def test_its_temp_folder_is_still_the_worker_s_tmpdir(self):
        # the worker's shell expands TMPDIR, TMP and TEMP as before (task_tmp.py); a different one just stays read-only
        cmd = settings.reviewer_command("codex", folder=self.wt, tmp=self.tmp)
        self.assertIn(settings.TASK_TMP, cmd)


class WorkerAllowlist(Roots):
    """A Codex worker starts its reviewer from the brief without a permission card, the old line too, and nothing wider."""

    def own(self, cmd):
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "demo#1"}):
            return launch.own_command("/x/herdr-task", f"hc run --bg --name demo-1-review -- {cmd} 'review'", True)

    def test_the_new_line_and_the_old_one(self):
        new = settings.reviewer_command("codex", "gpt-6.2-sol", "high", folder=self.wt, fast=False, tmp=self.tmp)
        self.assertIn("default_permissions", new)
        self.assertTrue(self.own(new))
        self.assertTrue(self.own("codex --no-daemon --sandbox read-only --ask-for-approval never --disable hooks -m gpt-6.2-sol"))

    def test_nothing_wider(self):
        line = shlex.join(["codex", "--no-daemon", *review_sandbox.args(self.tmp), "--ask-for-approval", "never"])
        self.assertTrue(self.own(line))
        for bad in ['-c \'sandbox_mode="workspace-write"\'', "-c 'default_permissions=\":workspace\"'",
                    "-c 'permissions.shepherdr-reviewer.filesystem={\":root\"=\"write\"}'",
                    "-c 'sandbox_workspace_write.writable_roots=[\"/\"]'", "--add-dir /", "--sandbox workspace-write"]:
            self.assertFalse(self.own(f"{line} {bad}"), bad)
        # the profile's own words changed in place: another folder, more of them, write everywhere, another profile
        for old, new in ((self.tmp, "/"), (self.tmp, os.path.expanduser("~")), (self.tmp, os.path.join(self.root, "nope")),
                         ('="write"}', '="write","/"="write"}'), (':root"="read"', ':root"="write"'),
                         ('default_permissions="shepherdr-reviewer"', 'default_permissions=":workspace"')):
            self.assertFalse(self.own(line.replace(old, new, 1)), new)
        # both: the read-only flag and the profile
        self.assertFalse(self.own(line.replace("--no-daemon", "--no-daemon --sandbox read-only", 1)))


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

PYTEST = """def test_tmp_path(tmp_path):
    (tmp_path / "a").write_text("ok")
    assert (tmp_path / "a").read_text() == "ok"
"""


@unittest.skipUnless(sandbox_works(), "codex's sandbox isn't available here")
class RealSandbox(Roots):
    """The reviewer's sandbox words in Codex's own sandbox: in a scratch worktree, a test's temp files work, writing
    the worktree is refused; read-only, the line before, has no temp folder at all."""

    def setUp(self):
        super().setUp()
        subprocess.run(["git", "init", "-q", self.wt], check=True)
        with open(os.path.join(self.wt, "probe.py"), "w") as f:
            f.write(PROBE)
        with open(os.path.join(self.wt, "test_tmp_path.py"), "w") as f:
            f.write(PYTEST)

    def run_in(self, sandbox, cmd, tmp):
        env = dict(os.environ, TMPDIR=tmp, TMP=tmp, TEMP=tmp)
        return subprocess.run(["codex", "sandbox", *sandbox, "--", *cmd], cwd=self.wt, env=env, capture_output=True,
                              text=True, timeout=120)

    def reviewer(self):
        argv = shlex.split(settings.reviewer_command("codex", folder=self.wt, tmp=self.tmp))
        i = argv.index("--no-daemon")
        return argv[i + 1:argv.index("--ask-for-approval")]

    def test_temp_files_work_and_the_worktree_is_refused(self):
        r = self.run_in(self.reviewer(), [sys.executable, "probe.py"], self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("OK", r.stderr)
        g = self.run_in(self.reviewer(), ["git", "commit", "--allow-empty", "-q", "-m", "x"], self.tmp)
        self.assertNotEqual(g.returncode, 0)
        self.assertEqual(sorted(os.listdir(self.wt)), [".git", "probe.py", "test_tmp_path.py"])

    def test_a_tmpdir_elsewhere_stays_read_only(self):
        other = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, other, True)
        r = self.run_in(self.reviewer(), [sys.executable, "probe.py"], other)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("No usable temporary directory", r.stderr)

    def test_pytest_tmp_path(self):
        try:
            import pytest  # noqa: F401
        except ImportError:
            self.skipTest("no pytest here")
        r = self.run_in(self.reviewer(), [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_tmp_path.py"], self.tmp)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("1 passed", r.stdout)

    def test_read_only_had_no_temp_folder(self):
        # the line before: a test's first temp file fails ("No usable temporary directory")
        r = self.run_in(["-c", 'sandbox_mode="read-only"'], [sys.executable, "probe.py"], self.tmp)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("No usable temporary directory", r.stderr)


@unittest.skipUnless(sandbox_works() and os.access("/var/tmp", os.W_OK), "codex's sandbox or /var/tmp isn't available here")
class RealSandboxVarTmp(RealSandbox):
    """The same with the task temp folders under /var/tmp, where a machine of its own may keep them."""

    base = "/var/tmp"


if __name__ == "__main__":
    unittest.main()
