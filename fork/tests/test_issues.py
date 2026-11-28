"""The issue pass after a healthy install, and the `Part of #n` a patch's pull request owes (fork/sync/issues.py).
Feedback reports 8a45b209fe, 9094455750, e4a7cf6cf4 and ed70c77eca; fork/specs/issue-loop.md, "Close and tell".
A real throwaway git repo; gh is a fake that holds
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
    """`gh issue list|edit|close|comment`, `gh pr list|edit`, `gh api` (an issue's comments, the GraphQL read again)
    and `gh label list|create|edit|delete`, against dmalis/shepherdr, in memory, every call logged."""

    def __init__(self, issues_, prs, labels=None):
        self.issues = {i["number"]: dict(i) for i in issues_}
        self.prs = {p["number"]: dict(p) for p in prs}
        self.labels = {x["name"]: dict(x) for x in labels or []}
        self.calls = []
        self.refuse = set()

    def writes(self):
        return [c for c in self.calls if c[0] in ("issue", "pr", "label") and c[1] in
                ("edit", "close", "comment", "create", "delete", "pin")]

    def __call__(self, *a):
        a = list(a)
        self.calls.append(a)
        if tuple(a[:2]) in self.refuse:
            return False, "", "refused"
        if a[0] == "api":
            return self.api(a)
        assert a[a.index("-R") + 1] == "dmalis/shepherdr", a
        if a[:2] == ["issue", "list"]:
            want = a[a.index("--state") + 1]
            out = [i for i in self.issues.values() if i["state"] == want]
            return True, json.dumps(out), ""
        if a[:2] == ["pr", "list"]:
            want = a[a.index("--state") + 1]
            return True, json.dumps([p for p in self.prs.values() if p.get("state", "merged") == want]), ""
        if a[:2] == ["issue", "edit"]:
            i = self.issues[int(a[2])]
            assert "--body-file" not in a and "--body" not in a, "the pass never rewrites a body"
            names = [x["name"] for x in i["labels"]]
            if "--add-label" in a:
                names += [n for n in a[a.index("--add-label") + 1].split(",") if n not in names]
            if "--remove-label" in a:
                gone = a[a.index("--remove-label") + 1].split(",")
                names = [n for n in names if n not in gone]
            i["labels"] = [{"name": n} for n in names]
            return True, "", ""
        if a[:2] == ["issue", "close"]:
            i = self.issues[int(a[2])]
            i["state"], i["reason"] = "closed", a[a.index("--reason") + 1] if "--reason" in a else None
            return True, "", ""
        if a[:2] == ["issue", "comment"]:
            with open(a[a.index("--body-file") + 1], encoding="utf-8") as f:
                self.issues[int(a[2])].setdefault("comments", []).append(f.read())
            return True, "", ""
        if a[:2] == ["issue", "pin"]:
            self.issues[int(a[2])]["isPinned"] = True
            return True, "", ""
        if a[:2] == ["pr", "edit"]:
            with open(a[a.index("--body-file") + 1], encoding="utf-8") as f:
                self.prs[int(a[2])]["body"] = f.read()
            return True, "", ""
        if a[:2] == ["label", "list"]:
            return True, json.dumps(list(self.labels.values())), ""
        if a[:2] in (["label", "create"], ["label", "edit"]):
            self.labels[a[2]] = {"name": a[2], "color": a[a.index("--color") + 1],
                                 "description": a[a.index("--description") + 1]}
            return True, "", ""
        if a[:2] == ["label", "delete"]:
            self.labels.pop(a[2])
            for i in self.issues.values():
                i["labels"] = [x for x in i["labels"] if x["name"] != a[2]]
            return True, "", ""
        raise AssertionError(f"fake gh: no {a}")

    def api(self, a):
        if a[1] == "graphql":
            n = int(next(x for x in a if x.startswith("n="))[2:])
            i = self.issues[n]
            return True, json.dumps({"data": {"repository": {"issue": {
                "state": i["state"].upper(), "lastEditedAt": i.get("edited"),
                "labels": {"nodes": i["labels"]},
                "timelineItems": {"nodes": [{"createdAt": i["reopened"]}] if i.get("reopened") else []}}}}}), ""
        path = a[-1]
        assert path.startswith("repos/dmalis/shepherdr/issues/") and path.endswith("/comments"), a
        n = int(path.split("/")[4])
        return True, json.dumps([[{"body": b} for b in self.issues[n].get("comments", [])]]), ""


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
        self.put("web/y.ts", "y\n")
        self.c4 = self.commit("Revert D (#54)")

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
        at = {"mergedAt": "2026-11-01T00:00:00Z"}
        return [{"number": 50, "headRefName": "task/a", "mergeCommit": {"oid": self.c1}, "body": "Part of #12", **at},
                {"number": 51, "headRefName": "task/b", "mergeCommit": {"oid": self.c2}, "body": "A slice.", **at},
                {"number": 52, "headRefName": "task/c", "mergeCommit": {"oid": self.c3}, "body": "", **at},
                {"number": 53, "headRefName": "sync/v9.9.9", "mergeCommit": {"oid": self.c3}, "body": "", **at},
                {"number": 54, "headRefName": "task/d", "mergeCommit": {"oid": self.c4}, "body": "Undo it. Part of #15",
                 **at}]


class IssuePass(World):
    """fork/specs/issue-loop.md, "Close and tell": a comment, never a body edit; a close only for a linked Triage fix,
    read again first."""

    def issues(self):
        return [
            issue(10, "Status: live since `ours-1-1`. What it does: A.", ["patch", "device-check"]),
            issue(11, "**Status:** building. What it does: ours.\n\n## Why\n\nWords.", ["patch"]),
            issue(12, "## Why\n\nWords stay.\n\nDevice check: open the phone's chat\n\nStatus: building.", ["patch"]),
            issue(13, "Part of #12. A slice, no status line of its own.", ["patch", "fixing"]),
            issue(14, "Status: live since `ours-1-1`. What it does: C.", ["patch", "fixed-upstream"]),
            issue(15, "Status: building. What it does: D.", ["patch", "fixing"]),
            issue(16, "Status: building. Not merged yet.", ["patch"]),
        ]

    def links(self, fixes):
        f = os.path.join(self.repo, ".triage.json")
        with open(f, "w") as fh:
            json.dump({"fixes": {f"dmalis/shepherdr#{n}": {"pr": pr} for n, pr in fixes.items()}}, fh)
        return f

    def pass_(self, gh, links=None, dry_run=False, tag="ours-1-2"):
        return issues.run(self.repo, self.c4, self.c0, tag, "v3.2.21", gh, dry_run=dry_run,
                          links_path=links or os.path.join(self.repo, "none.json"))

    def test_a_live_fix_gets_one_comment_and_no_body_edit(self):
        gh = FakeGh(self.issues(), self.prs())
        before = {n: i["body"] for n, i in gh.issues.items()}
        out = self.pass_(gh)
        self.assertEqual({n: i["body"] for n, i in gh.issues.items()}, before, "no body is ever rewritten")
        # its own pull request landed: one comment, it stays open (nothing links a Triage fix to it)
        self.assertEqual(gh.issues[12]["comments"][0].split("\n\n")[0],
                         "Live since `ours-1-2` (#50, #51). Not seen on a device yet: please check its Device check"
                         " line.")
        self.assertEqual((sorted(x["name"] for x in gh.issues[12]["labels"]), gh.issues[12]["state"]),
                         (["device-check", "patch"], "open"))
        self.assertEqual(out["device_checks"], [{"issue": 12, "check": "open the phone's chat"}])
        self.assertEqual(gh.issues[13]["comments"][0].split("\n\n")[0], "Live since `ours-1-2` (#51).")
        self.assertEqual(gh.issues[15]["comments"][0].split("\n\n")[0], "Live since `ours-1-2` (#54).")
        # nothing closes because the patch list names it, and the old labels aren't written
        self.assertEqual([i["number"] for i in gh.issues.values() if i["state"] == "closed"], [])
        self.assertFalse(any({"live", "not-filed", "reverted"} & {x["name"] for x in i["labels"]}
                             for i in gh.issues.values()))
        # fixed upstream and no longer carried: said once, left open for the person
        self.assertEqual(gh.issues[14]["comments"][0].split("\n\n")[0],
                         "Fixed upstream in `v3.2.21`; ours was dropped.")
        self.assertNotIn("comments", gh.issues[16])
        self.assertNotIn("comments", gh.issues[10])
        # the pull request without its line gets it from its patch file (and the umbrella's); one that changes
        # Shepherdr with no issue at all is listed; a sync pull request is neither
        self.assertEqual(gh.prs[51]["body"], "A slice.\n\nPart of #12\nPart of #13\n")
        self.assertEqual(out["unlinked"], [52])

    def test_a_second_pass_writes_nothing(self):
        gh = FakeGh(self.issues(), self.prs())
        self.pass_(gh)
        gh.calls = []
        self.pass_(gh)
        self.assertEqual(gh.writes(), [], "each comment's mark says it was written: once per issue and tag")

    def test_only_a_linked_triage_fix_closes_its_issue(self):
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh, links=self.links({13: 51, 15: 54, 16: 99}))
        self.assertEqual((gh.issues[13]["state"], gh.issues[13]["reason"]), ("closed", "completed"))
        self.assertNotIn("fixing", [x["name"] for x in gh.issues[13]["labels"]])
        self.assertEqual(gh.issues[15]["state"], "closed")
        self.assertEqual(gh.issues[16]["state"], "open", "its linked pull request doesn't run at the install")
        self.assertEqual(out["left"], [])

    def test_a_reopened_or_edited_issue_is_left_as_it_is(self):
        """Codex round 2: a body read earlier overwrote a newer edit, and a reopened issue was closed again."""
        cases = self.issues()
        cases[3]["reopened"] = "2099-01-01T00:00:00Z"
        cases[5]["edited"] = "2099-01-01T00:00:00Z"
        gh = FakeGh(cases, self.prs())
        out = self.pass_(gh, links=self.links({13: 51, 15: 54}))
        self.assertEqual((gh.issues[13]["state"], gh.issues[15]["state"]), ("open", "open"))
        self.assertEqual(out["left"], [{"issue": 13, "why": "it was reopened after its fix merged"},
                                       {"issue": 15, "why": "it was edited after its fix merged"}])

    def test_a_linked_fix_waiting_on_a_device_stays_open(self):
        gh = FakeGh(self.issues(), self.prs())
        self.pass_(gh, links=self.links({12: 50}))
        self.assertEqual(gh.issues[12]["state"], "open")

    def test_an_unreadable_triage_record_closes_nothing(self):
        f = os.path.join(self.repo, ".triage.json")
        with open(f, "w") as fh:
            fh.write("{not json")
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh, links=f)
        self.assertEqual((out["triage_links"], [i for i in gh.issues.values() if i["state"] == "closed"]),
                         ("unreadable", []))
        self.assertEqual(issues.triage_links(os.path.join(self.repo, "absent.json")), {})

    def test_a_dry_run_writes_nothing_and_shows_the_comments(self):
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh, dry_run=True)
        self.assertEqual(gh.writes(), [])
        self.assertEqual(out["comments"]["15"], "Live since `ours-1-2` (#54).")

    def test_a_comment_whose_read_fails_isnt_written(self):
        gh = FakeGh(self.issues(), self.prs())
        gh.api = lambda a: (False, "", "no")
        with self.assertRaises(issues.state.Refused) as e:
            self.pass_(gh)
        self.assertEqual(e.exception.fields["outcome"], "wait")
        self.assertFalse(any("comments" in i for i in gh.issues.values()))

    def test_our_own_files_ship_nothing(self):
        self.assertFalse(issues.ships([".github/workflows/fork-check.yml", "fork/sync/issues.py", "FORK.md",
                                       ".github/ISSUE_TEMPLATE/bug.yml"]))
        self.assertTrue(issues.ships([".github/workflows/check.yml"]))


class PartOf(World):
    def test_each_changed_patch_file_and_its_umbrella_are_owed(self):
        self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2, "Part of #12"), ["Part of #13"])
        self.assertEqual(issues.part_of_missing(self.repo, self.c1, self.c2, ""), ["Part of #12", "Part of #13"])
        self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2, "part of #13, Part of #12."), [])
        self.assertEqual(issues.part_of_missing(self.repo, self.c2, self.c3, ""), [], "no patch file changed")

    def test_an_instruction_or_an_example_isnt_the_line(self):
        """Review: "add `Part of #12` before merging" passed the check without linking anything."""
        for body in ("Instructions say to add `Part of #12` and `Part of #13` before merging.",
                     "```\nPart of #12\nPart of #13\n```", "Example:\n\n    Part of #12\n    Part of #13"):
            self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2, body),
                             ["Part of #12", "Part of #13"], body)
        self.assertEqual(issues.part_of_missing(self.repo, self.c0, self.c2,
                                                "Slice 6 (Part of #12; upstream checked). Part of #13."), [],
                         "a link said in a sentence, as real pull requests say it")

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
