"""fork/patches.json and `fork/bin/sync patch-tests` (Part of #2): every line names files and tests this tree has, a
Python entry may name one class or test so only that runs, and the step runs each line's tests from the right folder.
The real list is checked against this tree; the step itself runs on a scratch tree, never on the repo's own tests."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import install, patches  # noqa: E402

SYNC = os.path.join(ROOT, "fork", "bin", "sync")


class TheList(unittest.TestCase):
    def setUp(self):
        self.lines = patches.read(ROOT)

    def test_every_line_matches_this_tree(self):
        self.assertEqual(patches.problems(ROOT, self.lines), [])

    def test_it_carries_the_hold_patch_and_the_fixes(self):
        # #19 the hold patch (install refuses a candidate without it); #7, #11, #12, #29, #33 the fixes to upstream's files; #31 a space above groups
        # #36 Zoom and chat text size; #34 the installed app; #37 the alerts list and device check; #55 agent messages fold; #44 About names the build; #45 waiting prompts
        self.assertEqual(sorted(x["issue"] for x in self.lines), [7, 11, 12, 19, 29, 31, 33, 34, 36, 37, 44, 45, 55])
        self.assertTrue(any(os.path.basename(patches.split(t)[0]) == install.HOLD_PATCH_TEST
                            for x in self.lines for t in x["tests"]))

    def test_a_big_file_runs_only_the_patch_s_tests(self):
        for x in self.lines:
            for t in x["tests"]:
                if patches.split(t)[0] == "test/test_herdr_task.py":
                    self.assertIsNotNone(patches.split(t)[1], f"#{x['issue']}: name its class or test in {t}")


class Problems(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.put("a.py", "x = 1\n")
        self.put("web/b.tsx", "export {}\n")
        self.put("test/test_a.py", "import unittest\n\nclass One(unittest.TestCase):\n    def test_it(self):\n        pass\n")
        self.put("service/b.test.ts", "")

    def put(self, path, text):
        full = os.path.join(self.tmp, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)

    def line(self, **kw):
        return dict({"issue": 5, "name": "a fix", "files": ["a.py"], "tests": ["test/test_a.py"]}, **kw)

    def test_a_good_line(self):
        for tests in (["test/test_a.py"], ["test/test_a.py::One"], ["test/test_a.py::One.test_it"], ["service/b.test.ts"]):
            self.assertEqual(patches.problems(self.tmp, [self.line(tests=tests, files=["a.py", "web/b.tsx"])]), [])

    def test_what_it_finds(self):
        cases = [
            (self.line(files=["gone.py"]), "#5: gone.py isn't there"),
            (self.line(tests=["test/test_gone.py"]), "#5: test/test_gone.py isn't there"),
            (self.line(tests=["test/test_a.py::Two"]), "#5: test/test_a.py has no Two"),
            (self.line(tests=["test/test_a.py::One.test_gone"]), "#5: test/test_a.py has no One.test_gone"),
            (self.line(tests=["service/b.test.ts::a name"]), "#5: service/b.test.ts::a name: only a Python test file names its tests"),
            (self.line(tests=[]), "#5: no tests"),
            (self.line(files="a.py"), "#5: no files"),
            (self.line(name=""), "#5: no name"),
            (self.line(issue="5"), "line 1: no issue number"),
            (self.line(issue=True), "line 1: no issue number"),
        ]
        for line, want in cases:
            self.assertEqual(patches.problems(self.tmp, [line]), [want], line)
        self.assertEqual(patches.problems(self.tmp, [self.line(), self.line()]), ["#5: listed twice"])

    def test_how_each_entry_runs(self):
        self.assertEqual(patches.command("test/test_herdr_task.py::HeldForTheTrueReason"),
                         ("test", ["python3", "-m", "unittest", "test_herdr_task.HeldForTheTrueReason"]))
        self.assertEqual(patches.command("test/test_herdr_task.py::AssistantSettings.test_it"),
                         ("test", ["python3", "-m", "unittest", "test_herdr_task.AssistantSettings.test_it"]))
        self.assertEqual(patches.command("fork/tests/test_hold_patch.py"),
                         ("fork/tests", ["python3", "-m", "unittest", "test_hold_patch"]))
        self.assertEqual(patches.command("service/review-rows.test.ts"), (".", ["bun", "test", "./service/review-rows.test.ts"]))


class TheStep(unittest.TestCase):
    """`fork/bin/sync patch-tests` on a scratch tree: each named entry runs, and only it."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.tree = os.path.join(self.tmp, "tree")
        self.ran = os.path.join(self.tmp, "ran")
        os.makedirs(os.path.join(self.tree, "test"))
        os.makedirs(os.path.join(self.tree, "fork"))
        with open(os.path.join(self.tree, "a.py"), "w") as f:
            f.write("x = 1\n")
        # each test writes its name down, so the step's runs show which ran
        with open(os.path.join(self.tree, "test", "test_big.py"), "w") as f:
            f.write(f"import unittest\nRAN = {self.ran!r}\n\n"
                    "def mark(n):\n    open(RAN, 'a').write(n + '\\n')\n\n"
                    "class Ours(unittest.TestCase):\n    def test_one(self):\n        mark('Ours.test_one')\n"
                    "    def test_two(self):\n        mark('Ours.test_two')\n\n"
                    "class Theirs(unittest.TestCase):\n    def test_it(self):\n        mark('Theirs.test_it')\n\n"
                    "class Broken(unittest.TestCase):\n    def test_it(self):\n        mark('Broken.test_it')\n        self.fail('dropped')\n")

    def write(self, lines):
        with open(os.path.join(self.tree, "fork", "patches.json"), "w") as f:
            json.dump({"patches": lines}, f)

    def step(self, *args):
        r = subprocess.run([sys.executable, SYNC, "patch-tests", "--repo", self.tree, "--root", self.tmp, *args],
                           capture_output=True, text=True, timeout=120)
        return r.returncode, json.loads(r.stdout.strip().splitlines()[-1])

    def ran_tests(self):
        try:
            with open(self.ran) as f:
                return f.read().split()
        except FileNotFoundError:
            return []

    def test_only_the_named_tests_run(self):
        self.write([{"issue": 1, "name": "one", "files": ["a.py"], "tests": ["test/test_big.py::Ours"]},
                    {"issue": 2, "name": "two", "files": ["a.py"], "tests": ["test/test_big.py::Ours.test_two"]}])
        code, out = self.step()
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"])
        self.assertEqual([(p["issue"], [t["ok"] for t in p["tests"]]) for p in out["patches"]], [(1, [True]), (2, [True])])
        self.assertEqual(sorted(self.ran_tests()), ["Ours.test_one", "Ours.test_two", "Ours.test_two"])

    def test_a_failing_patch_says_which(self):
        self.write([{"issue": 1, "name": "one", "files": ["a.py"], "tests": ["test/test_big.py::Ours.test_one"]},
                    {"issue": 2, "name": "two", "files": ["a.py"], "tests": ["test/test_big.py::Broken"]}])
        code, out = self.step()
        self.assertEqual(code, 1)
        self.assertEqual((out["ok"], out["outcome"], out["failed"]), (False, "stop", [2]))
        self.assertIn("dropped", out["patches"][1]["tests"][0]["tail"])
        code, out = self.step("--issue", "1")
        self.assertEqual((code, [p["issue"] for p in out["patches"]]), (0, [1]))

    def test_a_list_that_doesn_t_match_runs_nothing(self):
        self.write([{"issue": 1, "name": "one", "files": ["a.py"], "tests": ["test/test_big.py::Gone"]}])
        code, out = self.step()
        self.assertEqual((code, out["problems"]), (1, ["#1: test/test_big.py has no Gone"]))
        self.assertEqual(self.ran_tests(), [])
        self.write([{"issue": 1, "name": "one", "files": ["a.py"], "tests": ["test/test_big.py::Ours"]}])
        code, out = self.step("--issue", "9")
        self.assertEqual((code, out["why"]), (1, "fork/patches.json has no line for #9"))


if __name__ == "__main__":
    unittest.main()
