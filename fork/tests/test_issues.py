"""The issue pass after a healthy install, and the `Part of #n` a patch's pull request owes (fork/sync/issues.py).
Feedback reports 8a45b209fe, 9094455750, e4a7cf6cf4 and ed70c77eca. A real throwaway git repo; gh is a fake that holds
issues and pull requests in memory: nothing here reaches GitHub."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import issues  # noqa: E402

SYNC = os.path.join(ROOT, "fork", "bin", "sync")
IDENT = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "T",
         "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}


def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env={**os.environ, **IDENT})
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return r.stdout.strip()


class FakeGh:
    """`gh issue list|edit|close` and `gh pr list|edit` against dmalis/shepherdr, in memory, every call logged."""

    def __init__(self, issues_, prs):
        self.issues = {i["number"]: dict(i) for i in issues_}
        self.prs = {p["number"]: dict(p) for p in prs}
        self.calls = []

    def writes(self):
        return [c for c in self.calls if c[1] in ("edit", "close")]

    def __call__(self, *a):
        a = list(a)
        self.calls.append(a)
        assert a[a.index("-R") + 1] == "dmalis/shepherdr", a
        if a[:2] == ["issue", "list"]:
            want = a[a.index("--state") + 1]
            label = a[a.index("--label") + 1] if "--label" in a else None
            out = [i for i in self.issues.values() if i["state"] == want
                   and (label is None or label in [x["name"] for x in i["labels"]])]
            return True, json.dumps(out), ""
        if a[:2] == ["pr", "list"]:
            return True, json.dumps(list(self.prs.values())), ""
        if a[:2] == ["issue", "edit"]:
            i = self.issues[int(a[2])]
            if "--body-file" in a:
                with open(a[a.index("--body-file") + 1], encoding="utf-8") as f:
                    i["body"] = f.read()
            names = [x["name"] for x in i["labels"]]
            if "--add-label" in a:
                names += [n for n in a[a.index("--add-label") + 1].split(",") if n not in names]
            if "--remove-label" in a:
                gone = a[a.index("--remove-label") + 1].split(",")
                names = [n for n in names if n not in gone]
            i["labels"] = [{"name": n} for n in names]
            return True, "", ""
        if a[:2] == ["issue", "close"]:
            self.issues[int(a[2])]["state"] = "closed"
            return True, "", ""
        if a[:2] == ["pr", "edit"]:
            with open(a[a.index("--body-file") + 1], encoding="utf-8") as f:
                self.prs[int(a[2])]["body"] = f.read()
            return True, "", ""
        raise AssertionError(f"fake gh: no {a}")


def issue(n, body, labels, state="open"):
    return {"number": n, "body": body, "labels": [{"name": x} for x in labels], "state": state}


def patch(n, **more):
    return json.dumps({"issue": n, "name": f"patch {n}", "files": ["x.txt"], "tests": ["x.txt"], **more})


class World(unittest.TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp(prefix="fork-issues-test-")
        self.addCleanup(shutil.rmtree, self.repo, True)
        git(self.repo, "init", "-q", "-b", "main")
        self.put("x.txt", "x\n")
        self.put("fork/patches/10.json", patch(10))
        self.put("fork/patches/11.json", patch(11))
        self.c0 = self.commit("Start")
        self.put("fork/patches/12.json", patch(12))
        self.c1 = self.commit("Device: the fix (#50)")
        self.put("fork/patches/13.json", patch(13, umbrella=12))
        self.c2 = self.commit("Slice: without its line (#51)")
        self.put("web/x.ts", "x\n")
        self.c3 = self.commit("Shepherdr change, no issue (#52)")

    def put(self, path, text):
        full = os.path.join(self.repo, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)

    def commit(self, msg):
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", msg)
        return git(self.repo, "rev-parse", "HEAD")

    def prs(self):
        return [{"number": 50, "headRefName": "task/a", "mergeCommit": {"oid": self.c1}, "body": "Part of #12"},
                {"number": 51, "headRefName": "task/b", "mergeCommit": {"oid": self.c2}, "body": "A slice."},
                {"number": 52, "headRefName": "task/c", "mergeCommit": {"oid": self.c3}, "body": ""},
                {"number": 53, "headRefName": "sync/v9.9.9", "mergeCommit": {"oid": self.c3}, "body": ""}]


class IssuePass(World):
    def issues(self):
        return [
            issue(10, "Status: carried since `ours-1-1`, not filed yet (built in #40). What it does: A.\n\n## Why\n",
                  ["patch", "not-filed", "live"]),
            issue(11, "**Status:** building. Fork-only: ours.\n\n## Why\n\nWords.", ["patch", "fork-only"]),
            issue(12, "## Why\n\nWords stay.\n\nDevice check: open the phone's chat\n\n"
                      "Status: #50: building; #60: building. What it does: B.", ["patch"]),
            issue(13, "Part of #12. A slice, no status line of its own.", ["patch"]),
            issue(14, "Status: carried since `ours-1-1`, not filed yet. What it does: C.",
                  ["patch", "not-filed", "live", "fixed-upstream"]),
            issue(15, "Status: reverting in #52. What it does: D.", ["patch", "not-filed", "live"]),
            issue(16, "Status: carried since `ours-1-1`.", ["patch", "live"], state="closed"),
            issue(17, "Status: building. Not merged yet.", ["patch"]),
        ]

    def pass_(self, gh, dry_run=False):
        return issues.run(self.repo, self.c3, self.c0, "ours-1-2", "v3.2.21", gh, dry_run=dry_run)

    def test_one_pass_writes_only_what_changes(self):
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh)
        reads = [c for c in gh.calls if c[1] == "list"]
        self.assertEqual(len(reads), 3, "open issues, closed ones still live, merged pull requests: once each")
        body = {n: i["body"] for n, i in gh.issues.items()}
        labels = {n: sorted(x["name"] for x in i["labels"]) for n, i in gh.issues.items()}
        # already right: untouched, its tag kept (it names the install that first carried it)
        self.assertNotIn(10, [c and int(c[2]) for c in gh.writes()])
        self.assertTrue(body[10].startswith("Status: carried since `ours-1-1`"))
        # building -> carried, no "not filed yet" on a fork-only one; the words after it stay
        self.assertEqual(body[11], "**Status:** carried since `ours-1-2`. Fork-only: ours.\n\n## Why\n\nWords.")
        self.assertEqual(labels[11], ["fork-only", "live", "patch"])
        # a part lands, the other stays building; the device check is said, not called fixed
        self.assertEqual(body[12].split("\n")[-1],
                         "Status: carried since `ours-1-2`; not seen on a device yet: please check its Device check "
                         "line. #50: not filed yet; #60: building. What it does: B.")
        self.assertTrue(body[12].startswith("## Why\n\nWords stay.\n\nDevice check: open the phone's chat\n"))
        self.assertEqual(labels[12], ["device-check", "live", "not-filed", "patch"])
        self.assertEqual(out["device_checks"], [{"issue": 12, "check": "open the phone's chat"}])
        # no status line: only live goes on
        self.assertEqual((body[13], labels[13]), ("Part of #12. A slice, no status line of its own.",
                                                  ["live", "patch"]))
        # fixed upstream, dropped: said, labels off, closed
        self.assertEqual(body[14], "Status: fixed upstream in `v3.2.21`, then dropped. What it does: C.")
        self.assertEqual((labels[14], gh.issues[14]["state"]), (["fixed-upstream", "patch"], "closed"))
        # reverted: said, labelled, closed
        self.assertEqual(body[15], "Status: reverted in #52. What it does: D.")
        self.assertEqual((labels[15], gh.issues[15]["state"]), (["patch", "reverted"], "closed"))
        # a closed issue the install doesn't carry loses live
        self.assertEqual(labels[16], ["patch"])
        # not carried and building: untouched
        self.assertEqual(body[17], "Status: building. Not merged yet.")
        # the pull request without its line gets it from its patch file (and the umbrella's); one that changes
        # Shepherdr with no issue at all is listed; a sync pull request is neither
        self.assertEqual(gh.prs[51]["body"], "A slice.\n\nPart of #12\nPart of #13\n")
        self.assertEqual([(x["pr"], x["issues"]) for x in out["linked"]], [(51, [12, 13])])
        self.assertEqual(out["unlinked"], [52])
        self.assertEqual(sorted(out["written"]), [11, 12, 13, 14, 15, 16])

    def test_a_second_pass_writes_nothing(self):
        gh = FakeGh(self.issues(), self.prs())
        self.pass_(gh)
        gh.calls = []
        out = self.pass_(gh)
        self.assertEqual((out["edits"], gh.writes()), ([], []))

    def test_a_later_install_doesnt_move_carried_since(self):
        """The by-hand round of 50 writes: every carried issue's tag moved. Now a new tag moves none of them."""
        carried = [issue(n, f"Status: carried since `ours-1-1`, not filed yet (built in #{n}). What: x.",
                         ["patch", "not-filed", "live"]) for n in (10, 11, 12, 13)]
        gh = FakeGh(carried, self.prs())
        out = issues.run(self.repo, self.c3, self.c2, "ours-1-9", "v3.2.21", gh)
        self.assertEqual(gh.writes(), [], out)

    def test_a_dry_run_writes_nothing_and_shows_the_lines(self):
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh, dry_run=True)
        self.assertEqual(gh.writes(), [])
        self.assertEqual(out["bodies"]["11"], "carried since `ours-1-2`. Fork-only: ours.")

    def test_a_status_line_in_a_code_block_isnt_one(self):
        self.assertIsNone(issues.status_at("```\nStatus: building\n```\n"))
        self.assertEqual(issues.status_at("```\nStatus: x\n```\n**Status:** y")[1:], ("**Status:** ", "y"))

    def test_building_with_words_keeps_its_pull_requests(self):
        text, newly = issues.carried_text('building, ready for merge in "Speed" (#187). The page asks.', "ours-1-2",
                                          False, {}, False)
        self.assertEqual((text, newly), ("carried since `ours-1-2`, not filed yet (built in #187). The page asks.",
                                         True))


class PartOf(World):
    def test_each_changed_patch_file_and_its_umbrella_are_owed(self):
        self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2, "Part of #12"), ["Part of #13"])
        self.assertEqual(issues.part_of_missing(self.repo, self.c1, self.c2, ""), ["Part of #12", "Part of #13"])
        self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2, "part of #13, Part of #12."), [])
        self.assertEqual(issues.part_of_missing(self.repo, self.c2, self.c3, ""), [], "no patch file changed")

    def test_a_removed_patch_file_is_owed_too(self):
        os.remove(os.path.join(self.repo, "fork/patches/13.json"))
        c4 = self.commit("Revert the slice (#54)")
        self.assertEqual(issues.part_of_missing(self.repo, self.c3, c4, ""), ["Part of #12", "Part of #13"])

    def test_a_sync_pull_request_is_exempt(self):
        self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2, "", branch="sync/v3.2.23"), [])

    def test_the_fork_check_step_says_the_exact_line(self):
        f = os.path.join(self.repo, "body.md")
        with open(f, "w") as fh:
            fh.write("Part of #12\n")
        r = subprocess.run([sys.executable, SYNC, "part-of", "--base", self.c0, "--head", self.c2, "--body-file", f,
                            "--repo", self.repo, "--root", self.repo], capture_output=True, text=True)
        out = json.loads(r.stdout)
        self.assertEqual((r.returncode, out["outcome"], out["add"]), (1, "refused", ["Part of #13"]), out)
        self.assertIn('add the line "Part of #13"', out["why"])
        with open(f, "w") as fh:
            fh.write("Part of #12\nPart of #13\n")
        r = subprocess.run([sys.executable, SYNC, "part-of", "--base", self.c0, "--head", self.c2, "--body-file", f,
                            "--repo", self.repo, "--root", self.repo], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)


if __name__ == "__main__":
    unittest.main()
