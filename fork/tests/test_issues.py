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
            i = self.issues[int(a[2])]
            i["state"] = "closed"
            if "--comment" in a:
                i.setdefault("comments", []).append(a[a.index("--comment") + 1])
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
        return [{"number": 50, "headRefName": "task/a", "mergeCommit": {"oid": self.c1}, "body": "Part of #12"},
                {"number": 51, "headRefName": "task/b", "mergeCommit": {"oid": self.c2}, "body": "A slice."},
                {"number": 52, "headRefName": "task/c", "mergeCommit": {"oid": self.c3}, "body": ""},
                {"number": 53, "headRefName": "sync/v9.9.9", "mergeCommit": {"oid": self.c3}, "body": ""},
                {"number": 54, "headRefName": "task/d", "mergeCommit": {"oid": self.c4}, "body": "Undo it. Part of #15"}]


class IssuePass(World):
    def issues(self):
        return [
            issue(10, "Status: live since `ours-1-1` (built in #40). What it does: A.\n\n## Why\n",
                  ["patch", "live", "device-check"]),
            issue(11, "**Status:** building. What it does: ours.\n\n## Why\n\nWords.", ["patch"]),
            issue(12, "## Why\n\nWords stay.\n\nDevice check: open the phone's chat\n\n"
                      "Status: #50: building; #60: building. What it does: B.", ["patch"]),
            issue(13, "Part of #12. A slice, no status line of its own.", ["patch"]),
            issue(14, "Status: carried since `ours-1-1`, not filed yet. What it does: C.",
                  ["patch", "live", "fixed-upstream"]),
            issue(15, "Status: reverting in #54. What it does: D.", ["patch", "live"]),
            issue(18, "Status: reverting in #52. What it does: E.", ["patch", "live"]),
            issue(16, "Status: live since `ours-1-1`.", ["patch", "live"], state="closed"),
            issue(17, "Status: building. Not merged yet.", ["patch"]),
        ]

    def pass_(self, gh, dry_run=False):
        return issues.run(self.repo, self.c4, self.c0, "ours-1-2", "v3.2.21", gh, dry_run=dry_run)

    def test_one_pass_writes_only_what_changes(self):
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh)
        reads = [c for c in gh.calls if c[1] == "list"]
        self.assertEqual(len(reads), 3, "open issues, closed ones still live, merged pull requests: once each")
        body = {n: i["body"] for n, i in gh.issues.items()}
        labels = {n: sorted(x["name"] for x in i["labels"]) for n, i in gh.issues.items()}
        # already right, and waiting on a device: untouched and open, its tag kept (the install that first carried it)
        self.assertNotIn(10, [c and int(c[2]) for c in gh.writes()])
        self.assertEqual((body[10].split("\n")[0], gh.issues[10]["state"]),
                         ("Status: live since `ours-1-1` (built in #40). What it does: A.", "open"))
        # building -> live; the words after it stay; live and healthy, so it closes with one comment
        self.assertEqual(body[11], "**Status:** live since `ours-1-2`. What it does: ours.\n\n## Why\n\nWords.")
        self.assertEqual((labels[11], gh.issues[11]["state"]), (["live", "patch"], "closed"))
        self.assertNotIn("comments", gh.issues[11], "a retried close never posts a second comment: it posts none")
        # a part lands, the other stays building; the device check is said, not called fixed; it stays open
        self.assertEqual(body[12].split("\n")[-1],
                         "Status: live since `ours-1-2`; not seen on a device yet: please check its Device check "
                         "line. #50: live; #60: building. What it does: B.")
        self.assertTrue(body[12].startswith("## Why\n\nWords stay.\n\nDevice check: open the phone's chat\n"))
        self.assertEqual((labels[12], gh.issues[12]["state"]), (["device-check", "live", "patch"], "open"))
        self.assertEqual(out["device_checks"], [{"issue": 12, "check": "open the phone's chat"}])
        # no status line: live goes on, and it closes
        self.assertEqual((body[13], labels[13], gh.issues[13]["state"]),
                         ("Part of #12. A slice, no status line of its own.", ["live", "patch"], "closed"))
        # no label says where it stands with upstream any more
        self.assertFalse(any({"not-filed", "upstream-proposed"} & set(x) for x in labels.values()))
        # fixed upstream, dropped: said, labels off, closed
        self.assertEqual(body[14], "Status: fixed upstream in `v3.2.21`, then dropped. What it does: C.")
        self.assertEqual((labels[14], gh.issues[14]["state"]), (["fixed-upstream", "patch"], "closed"))
        # reverted: said, labelled, closed
        self.assertEqual(body[15], "Status: reverted in #54. What it does: D.")
        self.assertEqual((labels[15], gh.issues[15]["state"]), (["patch", "reverted"], "closed"))
        # a pull request that names no issue never moves one, whatever number its line says
        self.assertEqual((body[18], gh.issues[18]["state"]), ("Status: reverting in #52. What it does: E.", "open"))
        # a closed issue the install doesn't carry loses live
        self.assertEqual(labels[16], ["patch"])
        # not carried and building: untouched
        self.assertEqual(body[17], "Status: building. Not merged yet.")
        # the pull request without its line gets it from its patch file (and the umbrella's); one that changes
        # Shepherdr with no issue at all is listed; a sync pull request is neither
        self.assertEqual(gh.prs[51]["body"], "A slice.\n\nPart of #12\nPart of #13\n")
        self.assertEqual([(x["pr"], x["issues"]) for x in out["linked"]], [(51, [12, 13])])
        self.assertEqual(out["unlinked"], [52])
        self.assertEqual(sorted(out["written"]), [11, 12, 13, 14, 15, 16, 18])

    def test_a_second_pass_writes_nothing(self):
        gh = FakeGh(self.issues(), self.prs())
        self.pass_(gh)
        gh.calls = []
        out = self.pass_(gh)
        self.assertEqual((out["edits"], gh.writes()), ([], []))

    def test_a_later_install_doesnt_move_carried_since(self):
        """The by-hand round of 50 writes: every carried issue's tag moved. Now a new tag moves none of them: the
        older words become "live since" with the first tag, and a later pass writes nothing."""
        carried = [issue(n, f"Status: carried since `ours-1-1`, not filed yet (built in #{n}). What: x.",
                         ["patch", "live", "device-check"]) for n in (10, 11, 12, 13)]
        gh = FakeGh(carried, self.prs())
        issues.run(self.repo, self.c4, self.c2, "ours-1-5", "v3.2.21", gh)
        self.assertEqual([gh.issues[n]["body"] for n in (10, 11, 12, 13)],
                         [f"Status: live since `ours-1-1` (built in #{n}). What: x." for n in (10, 11, 12, 13)])
        gh.calls = []
        out = issues.run(self.repo, self.c4, self.c2, "ours-1-9", "v3.2.21", gh)
        self.assertEqual(gh.writes(), [], out)

    def test_a_dry_run_writes_nothing_and_shows_the_lines(self):
        gh = FakeGh(self.issues(), self.prs())
        out = self.pass_(gh, dry_run=True)
        self.assertEqual(gh.writes(), [])
        self.assertEqual(out["bodies"]["11"], "live since `ours-1-2`. What it does: ours.")

    def test_a_status_line_in_a_code_block_isnt_one(self):
        self.assertIsNone(issues.status_at("```\nStatus: building\n```\n"))
        self.assertEqual(issues.status_at("```\nStatus: x\n```\n**Status:** y")[1:], ("**Status:** ", "y"))

    def test_a_lead_building_before_parts_keeps_every_part(self):
        """Review: the upstream link and the other part were wiped with the leading "building"."""
        text, _ = issues.carried_text("building; #29: proposed upstream as upstream issue 1648; #30: building. "
                                      "What it does: Adds pause.", "ours-1-2", {30: True}, False)
        self.assertEqual(text, "live since `ours-1-2`; #29: proposed upstream as upstream issue 1648; "
                               "#30: live. What it does: Adds pause.")

    def test_a_status_example_in_an_indented_block_isnt_the_line(self):
        body = "How to write it:\n\n    Status: building\n\nStatus: carried since `ours-1-1`."
        self.assertEqual(issues.status_at(body)[1:], ("Status: ", "carried since `ours-1-1`."))
        self.assertIsNone(issues.status_at("~~~\nStatus: x\n~~~\n"))

    def test_the_older_upstream_words_become_live(self):
        """Our own path (#233): nothing waits for an upstream round, so "not filed yet" goes, part by part."""
        edits = issues.plan([issue(20, "Status: carried since `ours-1-1`, not filed yet; #20: not filed yet; "
                                       "#30: building.", ["patch", "live", "not-filed"])],
                            [], {20}, {20: {30: True}}, "ours-1-2", None)
        self.assertEqual(issues.status_at(edits[0]["body"])[2], "live since `ours-1-1`; #20: live; #30: live.")
        self.assertEqual((edits[0]["add"], edits[0]["remove"], edits[0]["close"]), ([], [], True))
        # the pass before #233 put its own lead in front of a "live since" line (#105, #144): the first tag stays
        text, _ = issues.carried_text("carried since `ours-3.2.22-82`. live since `ours-3.2.22-65` (built in #111); "
                                      "not seen on a device yet.", "ours-3.2.22-90", {}, True)
        self.assertEqual(text, "live since `ours-3.2.22-65` (built in #111); not seen on a device yet.")
        # an unquoted older tag keeps its sentence's full stop out
        text, _ = issues.carried_text("carried since ours-1-1. What it does: A.", "ours-1-2", {}, False)
        self.assertEqual(text, "live since ours-1-1. What it does: A.")
        # slices and fixes written in a sentence, as real issues say them (#119, #105)
        text, _ = issues.carried_text("carried since `ours-1-1`. Slice 1 (the mark, #38): not filed yet. Slice 3 "
                                      "(first of waits, #210): building. Broke, fixed in #23 (Chat box), not filed "
                                      "yet; what it does.", "ours-1-2", {210: False}, False)
        self.assertEqual(text, "live since `ours-1-1`. Slice 1 (the mark, #38): live. Slice 3 (first of waits, "
                               "#210): live. Broke, fixed in #23 (Chat box); what it does.")
        self.assertFalse(issues.still_moving(text))
        self.assertTrue(issues.still_moving("live since `ours-1-1`. Slice 4 (later, #300): building."))

    def test_a_live_fix_stays_open_while_it_waits(self):
        """A fix still building, a device check, `later` or pipeline work: the issue stays open."""
        cases = [issue(21, "Status: live since `ours-1-1`; #30: live; #31: building.", ["patch", "live"]),
                 issue(22, "Status: live since `ours-1-1`. What: x.", ["patch", "live", "later"]),
                 issue(23, "Status: live since `ours-1-1`. What: x.", ["pipeline", "live"]),
                 issue(24, "Status: #40: live; reverting in #41.", ["patch", "live"])]
        edits = issues.plan(cases, [], {21, 22, 23, 24}, {21: {30: False}}, "ours-1-2", None)
        self.assertEqual([e for e in edits if e["close"]], [])

    def test_a_lead_building_whose_pull_request_doesnt_run_stays_open(self):
        """Review: an older fix is carried, the new one (#187) isn't merged: it was called built and closed."""
        body = 'Status: building, ready for merge in "Speed" (#187). The page asks.'
        edits = issues.plan([issue(26, body, ["patch", "live"])], [], {26}, {26: {150: False}}, "ours-1-2", None)
        self.assertEqual(edits, [])
        edits = issues.plan([issue(26, body, ["patch", "live"])], [], {26}, {26: {187: True}}, "ours-1-2", None)
        self.assertEqual((issues.status_at(edits[0]["body"])[2], edits[0]["close"]),
                         ("live since `ours-1-2` (built in #187). The page asks.", True))

    def test_a_device_check_without_a_status_line_stays_open(self):
        """Review: the device check was read only beside a status line."""
        edits = issues.plan([issue(27, "## Why\n\nDevice check: open the app: the header is sharp", ["patch"])],
                            [], {27}, {27: {70: True}}, "ours-1-2", None)
        self.assertEqual((edits[0]["add"], edits[0]["close"], edits[0]["device"]),
                         (["device-check", "live"], False, "open the app: the header is sharp"))

    def test_a_dropped_or_reverted_fix_with_a_slice_still_building_stays_open(self):
        """Review: a slice written in a sentence still building, or a device check not made, closed with the
        rest. Retries too."""
        cases = [issue(28, "Status: #40: reverting in #54. Slice 2 (chat, #41): building.", ["patch"]),
                 issue(29, "Status: live since `ours-1-1`; #31: building.", ["patch", "fixed-upstream"]),
                 issue(30, "Status: live since `ours-1-1`. What: x.", ["patch", "fixed-upstream", "device-check"]),
                 issue(31, "Status: fixed upstream in `v3.2.30`, then dropped. #31: building.",
                       ["patch", "fixed-upstream"]),
                 issue(32, "Status: #40: reverted in #54. Slice 2 (chat, #41): building.", ["patch", "reverted"])]
        edits = issues.plan(cases, [], set(), {28: {54: True}}, "ours-1-2", "v3.2.30")
        self.assertEqual([(e["number"], e["close"]) for e in edits], [(28, False), (29, False), (30, False)])
        self.assertEqual(edits[0]["add"], [])
        self.assertEqual(issues.status_at(edits[2]["body"])[2], "fixed upstream in `v3.2.30`, then dropped. What: x.")

    def test_a_closed_issue_whose_fix_upstream_shipped_says_so(self):
        """Closed once live; the sync then drops ours for upstream's: its line says so, it loses live, stays shut."""
        closed = [issue(25, "Status: live since `ours-1-1`. What: x.", ["patch", "live", "fixed-upstream"],
                        state="closed")]
        edits = issues.plan([], closed, set(), {}, "ours-1-2", "v3.2.30")
        self.assertEqual(len(edits), 1)
        self.assertEqual((issues.status_at(edits[0]["body"])[2], edits[0]["remove"], edits[0]["close"]),
                         ("fixed upstream in `v3.2.30`, then dropped. What: x.", ["live"], False))

    def test_a_close_that_didnt_go_in_is_made_by_the_next_pass(self):
        """Review: the edit went in and the close didn't; the retry must still close."""
        said = [issue(14, "Status: fixed upstream in `v3.2.21`, then dropped. What it does: C.",
                      ["patch", "fixed-upstream"]),
                issue(15, "Status: reverted in #54. What it does: D.", ["patch", "reverted"])]
        edits = issues.plan(said, [], {10}, {}, "ours-1-2", "v3.2.21")
        self.assertEqual([(e["number"], e["body"], e["close"]) for e in edits], [(14, None, True), (15, None, True)])

    def test_a_revert_with_a_fix_still_building_doesnt_close(self):
        edits = issues.plan([issue(15, "Status: #40: reverting in #54; #41: building.", ["patch", "not-filed"])],
                            [], set(), {15: {54: True}}, "ours-1-2", None)
        self.assertEqual((issues.status_at(edits[0]["body"])[2], edits[0]["close"]),
                         ("#40: reverted in #54; #41: building.", False))

    def test_the_fork_checks_workflow_ships_nothing(self):
        self.assertFalse(issues.ships([".github/workflows/fork-check.yml", "fork/sync/issues.py", "FORK.md"]))
        self.assertTrue(issues.ships([".github/workflows/check.yml"]))

    def test_building_with_words_keeps_its_pull_requests(self):
        text, newly = issues.carried_text('building, ready for merge in "Speed" (#187). The page asks.', "ours-1-2",
                                          {187: True}, False)
        self.assertEqual((text, newly), ("live since `ours-1-2` (built in #187). The page asks.", True))


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
