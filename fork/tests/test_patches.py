"""The patch list (fork/patches/<issue>.json, or an old tree's fork/patches.json) and `fork/bin/sync patch-list` and
`patch-tests` (Part of #2): every line names files and tests this tree has, a Python entry may name one class or test
so only that runs, and the step runs each line's tests from the right folder. The real list is checked against this
tree with checks that hold for any set of patches; the loader, the install gate and the steps run on scratch trees
and scratch git repos, never on the repo's own tests."""
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
    """This tree's list, checked so it holds for any set of patches: no issue numbers to keep up to date, so patches
    built side by side never edit the same line here."""

    def setUp(self):
        self.lines, self.layout = patches.read(ROOT)

    def test_every_line_matches_this_tree(self):
        # each file in fork/patches/ is <issue>.json for its own issue, every line has its fields, no issue twice,
        # and each file and test it names is here
        self.assertEqual(self.layout + patches.problems(ROOT, self.lines), [])

    def test_one_file_per_patch(self):
        self.assertTrue(os.path.isdir(os.path.join(ROOT, patches.DIR)))
        self.assertFalse(os.path.exists(os.path.join(ROOT, patches.LEGACY)),
                         f"{patches.LEGACY} is the old list: move its lines to {patches.DIR}/<issue>.json")
        self.assertTrue(self.lines)

    def test_it_carries_the_hold_patch(self):
        # install refuses a candidate without it (install.carries_hold_patch)
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


IDENT = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "T",
         "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}
HOLD = {"issue": 19, "name": "the hold patch", "files": ["a.py"], "tests": ["fork/tests/test_hold_patch.py"]}


def git(cwd, *args, ok=True):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env={**os.environ, **IDENT})
    if ok and r.returncode != 0:
        raise AssertionError(f"git {' '.join(args)}: {r.stderr}")
    return r


def put(repo, rel, text):
    full = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)


def put_line(repo, line):
    """A patch's own file, as the fork-patch skill says to write it."""
    put(repo, f"fork/patches/{line['issue']}.json", json.dumps(line, indent=2) + "\n")


def put_legacy(repo, lines):
    put(repo, "fork/patches.json", json.dumps({"patches": lines}))


def line(issue, **kw):
    return dict({"issue": issue, "name": f"fix {issue}", "files": ["a.py"], "tests": ["test/test_a.py"]}, **kw)


class TheLoader(unittest.TestCase):
    """patches.read, the one loader: fork/patches/<issue>.json, or an old tree's fork/patches.json, in the working
    tree or at a commit (a real scratch git repo)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        git(self.tmp, "init", "-q", "-b", "main")
        put(self.tmp, "a.py", "x = 1\n")

    def commit(self, words):
        git(self.tmp, "add", "-A")
        git(self.tmp, "commit", "-q", "-m", words)
        return git(self.tmp, "rev-parse", "HEAD").stdout.strip()

    def test_one_file_per_patch_in_issue_order(self):
        for n in (100, 19, 5):
            put_line(self.tmp, line(n))
        lines, layout = patches.read(self.tmp)
        self.assertEqual(([x["issue"] for x in lines], layout), ([5, 19, 100], []))
        self.assertEqual(lines[0], line(5))

    def test_an_old_tree(self):
        put_legacy(self.tmp, [line(7), line(3)])
        self.assertEqual(patches.read(self.tmp), ([line(7), line(3)], []))

    def test_what_the_layout_finds(self):
        put_line(self.tmp, line(5))
        put(self.tmp, "fork/patches/6.json", json.dumps(line(7)))
        put(self.tmp, "fork/patches/eight.json", json.dumps(line(8)))
        put(self.tmp, "fork/patches/README.md", "notes\n")
        put(self.tmp, "fork/patches/9.json", json.dumps(line(True)))
        lines, layout = patches.read(self.tmp)
        # every .json file is still read, so a misnamed one is never dropped from what the gate sees
        self.assertEqual([x["issue"] for x in lines], [5, 7, True, 8])
        self.assertEqual(layout, ["fork/patches/6.json: its issue is 7, its name says 6",
                                  "fork/patches/9.json: its issue is true, its name says 9",
                                  "fork/patches/README.md: only <issue>.json files go in fork/patches/",
                                  "fork/patches/eight.json: name it <issue>.json"])

    def test_the_old_list_beside_the_new_folder(self):
        # a rebase that kept fork/patches.json: both are read (nothing lost) and the layout says to move it
        put_line(self.tmp, line(5))
        put_legacy(self.tmp, [line(5), line(6)])
        lines, layout = patches.read(self.tmp)
        self.assertEqual([x["issue"] for x in lines], [5, 5, 6])
        self.assertEqual(layout, ["fork/patches.json is the old list: move each of its lines to fork/patches/<issue>.json"])
        self.assertIn("#5: listed twice", patches.problems(self.tmp, lines))

    def test_what_it_refuses(self):
        with self.assertRaises(OSError):
            patches.read(self.tmp)
        put(self.tmp, "fork/patches/5.json", "{not json")
        with self.assertRaises(ValueError):
            patches.read(self.tmp)
        put(self.tmp, "fork/patches/5.json", "[]")
        with self.assertRaises(TypeError):
            patches.read(self.tmp)

    def test_at_a_commit_either_format(self):
        put_legacy(self.tmp, [HOLD, line(7)])
        old = self.commit("the old list")
        git(self.tmp, "rm", "-q", "fork/patches.json")
        put_line(self.tmp, HOLD)
        put_line(self.tmp, line(7))
        new = self.commit("one file per patch")
        put_line(self.tmp, line(8))                           # not committed: a commit's list ignores the tree
        self.assertEqual(patches.read(self.tmp, at=old), ([HOLD, line(7)], []))
        self.assertEqual(patches.read(self.tmp, at=new), ([line(7), HOLD], []))
        self.assertEqual([x["issue"] for x in patches.read(self.tmp)[0]], [7, 8, 19])
        with self.assertRaises(OSError):
            patches.read(self.tmp, at="0" * 40)

    def test_the_install_gate_reads_either_format(self):
        put_legacy(self.tmp, [HOLD, line(7)])
        old = self.commit("the old list")
        put_legacy(self.tmp, [line(7)])
        old_without = self.commit("the old list, no hold patch")
        git(self.tmp, "rm", "-q", "fork/patches.json")
        put_line(self.tmp, HOLD)
        put_line(self.tmp, line(7))
        new = self.commit("one file per patch")
        git(self.tmp, "rm", "-q", "fork/patches/19.json")
        new_without = self.commit("no hold patch")
        put(self.tmp, "fork/patches/19.json", "{broken")
        broken = self.commit("a broken file")
        # a rebase that lost the hold patch's file but kept the old list beside the folder: the old list still names
        # it, yet the gate refuses, since the folder is the list now
        git(self.tmp, "rm", "-q", "fork/patches/19.json")
        put_legacy(self.tmp, [HOLD, line(7)])
        mixed = self.commit("both")
        self.assertEqual([install.carries_hold_patch(self.tmp, s)
                          for s in (old, old_without, new, new_without, broken, mixed)],
                         [True, False, True, False, False, False])
        self.assertFalse(install.carries_hold_patch(self.tmp, "0" * 40))
        self.assertEqual(install.patch_list_at(self.tmp, mixed)[1], "its patch list is laid out wrong: fork/patches.json "
                         "is the old list: move each of its lines to fork/patches/<issue>.json")
        self.assertEqual(install.patch_list_at(self.tmp, broken), ([], "its patch list can't be read (JSONDecodeError)"))
        self.assertEqual(install.patch_list_at(self.tmp, new)[1], None)

    def test_two_new_patches_merge_cleanly(self):
        """Two patch branches from the same main, each adding its own file, merge without a conflict; the same two
        additions to the old single file conflict (what every rebase hit)."""
        def two_branches(base, add):
            git(self.tmp, "checkout", "-q", "-b", base)
            for n in (50, 51):
                git(self.tmp, "checkout", "-q", "-b", f"{base}-{n}", base)
                add(n)
                self.commit(f"#{n}")
            git(self.tmp, "checkout", "-q", base)
            git(self.tmp, "merge", "-q", "--no-edit", f"{base}-50")
            return git(self.tmp, "merge", "--no-edit", f"{base}-51", ok=False)

        put_line(self.tmp, HOLD)
        self.commit("main")
        r = two_branches("new", lambda n: put_line(self.tmp, line(n)))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(patches.read(self.tmp, at="HEAD"), ([HOLD, line(50), line(51)], []))
        self.assertEqual(patches.read(self.tmp), ([HOLD, line(50), line(51)], []))

        # the old way, from a main that still has the one file: each branch appends its line to it
        git(self.tmp, "checkout", "-q", "main")
        git(self.tmp, "rm", "-q", "-r", "fork/patches")
        put(self.tmp, "fork/patches.json", json.dumps({"patches": [HOLD]}, indent=1) + "\n")
        self.commit("the old list")

        def append(n):
            with open(os.path.join(self.tmp, "fork/patches.json"), encoding="utf-8") as f:
                lines = json.load(f)["patches"]
            put(self.tmp, "fork/patches.json", json.dumps({"patches": lines + [line(n)]}, indent=1) + "\n")
        r = two_branches("old", append)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("CONFLICT (content): Merge conflict in fork/patches.json", r.stdout + r.stderr)
        git(self.tmp, "merge", "--abort")


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

    def write(self, lines, legacy=False):
        """The list as one file per patch, or (legacy) as an old tree's fork/patches.json."""
        shutil.rmtree(os.path.join(self.tree, "fork", "patches"), True)
        if legacy:
            put_legacy(self.tree, lines)
        else:
            for x in lines:
                put_line(self.tree, x)

    def step(self, *args, step="patch-tests"):
        r = subprocess.run([sys.executable, SYNC, step, "--repo", self.tree, "--root", self.tmp, *args],
                           capture_output=True, text=True, timeout=120)
        return r.returncode, json.loads(r.stdout.strip().splitlines()[-1])

    def test_an_old_tree_s_list_runs_too(self):
        self.write([{"issue": 2, "name": "two", "files": ["a.py"], "tests": ["test/test_big.py::Ours.test_two"]},
                    {"issue": 1, "name": "one", "files": ["a.py"], "tests": ["test/test_big.py::Theirs"]}], legacy=True)
        code, out = self.step()
        self.assertEqual((code, [p["issue"] for p in out["patches"]]), (0, [2, 1]), out)
        self.assertEqual(sorted(self.ran_tests()), ["Ours.test_two", "Theirs.test_it"])

    def test_a_kept_old_list_stops_the_step(self):
        self.write([{"issue": 1, "name": "one", "files": ["a.py"], "tests": ["test/test_big.py::Ours"]}])
        put_legacy(self.tree, [{"issue": 2, "name": "two", "files": ["a.py"], "tests": ["test/test_big.py::Ours"]}])
        code, out = self.step()
        self.assertEqual((code, out["problems"]),
                         (1, ["fork/patches.json is the old list: move each of its lines to fork/patches/<issue>.json"]))
        self.assertEqual(self.ran_tests(), [])

    def test_the_list_at_a_commit(self):
        git(self.tree, "init", "-q", "-b", "main")
        self.write([HOLD], legacy=True)
        git(self.tree, "add", "-A")
        git(self.tree, "commit", "-q", "-m", "old")
        old = git(self.tree, "rev-parse", "HEAD").stdout.strip()
        os.remove(os.path.join(self.tree, "fork", "patches.json"))
        self.write([HOLD, line(7)])
        git(self.tree, "add", "-A")
        git(self.tree, "commit", "-q", "-m", "new")
        want = lambda *ns: [{"issue": n, "name": "the hold patch" if n == 19 else f"fix {n}"} for n in ns]  # noqa: E731
        self.assertEqual(self.step("--at", old, step="patch-list"),
                         (0, {"ok": True, "step": "patch-list", "patches": want(19)}))
        self.assertEqual(self.step("--at", "HEAD", step="patch-list")[1]["patches"], want(7, 19))
        self.assertEqual(self.step(step="patch-list")[1]["patches"], want(7, 19))
        code, out = self.step("--at", "0" * 40, step="patch-list")
        self.assertEqual((code, out["outcome"]), (1, "stop"))
        # a rebase that kept the old list beside the folder: refused, not listed as if all were well
        put_legacy(self.tree, [HOLD])
        git(self.tree, "add", "-A")
        git(self.tree, "commit", "-q", "-m", "both")
        code, out = self.step("--at", "HEAD", step="patch-list")
        self.assertEqual((code, out["outcome"], out["problems"]),
                         (1, "stop", ["fork/patches.json is the old list: move each of its lines to fork/patches/<issue>.json"]))

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
        self.assertEqual((code, out["why"]), (1, "the patch list has no line for #9"))


if __name__ == "__main__":
    unittest.main()
