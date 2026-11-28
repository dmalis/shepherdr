"""Our repo's label set and its one migration (fork/sync/labels.py; fork/specs/issue-loop.md, "Labels" and "Data").
gh is the in-memory fake from test_issues: nothing here reaches GitHub."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)
import unittest  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fork"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync import labels  # noqa: E402
from sync.state import Refused  # noqa: E402
from test_issues import FakeGh  # noqa: E402

OLD = ["bug", "enhancement", "patch", "pipeline", "later", "device-check", "sync-blocked", "fixed-upstream", "live",
       "not-filed", "on-hold", "fork-only", "handover", "reverted", "rethink", "upstream-proposed", "duplicate",
       "wontfix", "invalid", "question", "good first issue", "help wanted", "documentation", "accessibility"]


def issue(n, title, names, **more):
    return {"number": n, "title": title, "labels": [{"name": x} for x in names], "state": "open", "body": "", **more}


def world():
    issues = [
        issue(1, "Start here", ["handover"]),
        issue(3, "A way of working", ["patch", "on-hold"]),
        issue(6, "Browser check", ["patch", "later", "on-hold"]),
        issue(43, "Install waits: main's check was cancelled", ["pipeline", "sync-blocked"]),
        issue(72, "iPhone: header not blurred", ["patch", "not-filed"]),
        issue(73, "Fork rules", ["fork-only"]),
        issue(105, "Typing on a phone", ["patch", "live", "device-check"]),
        issue(235, "The issue loop", ["patch", "pipeline"]),
        issue(240, "Two kinds", ["bug", "enhancement", "patch", "accessibility"]),
    ]
    prs = [{"number": 300, "state": "open", "body": "Part of #235"}]
    return FakeGh(issues, prs, [{"name": n, "color": "ffffff", "description": ""} for n in OLD])


def after(gh, n):
    return sorted(x["name"] for x in gh.issues[n]["labels"])


class Migration(unittest.TestCase):
    def test_the_dry_run_lists_every_move_and_writes_nothing(self):
        gh = world()
        out = labels.run(gh, {3, 6, 72, 105, 235, 240})
        self.assertEqual(gh.writes(), [])
        moves = {m["number"]: m["after"] for m in out["changes"]}
        self.assertEqual(moves, {
            1: [],                                                      # pinned instead
            3: ["enhancement", "later", "patch"],                       # on-hold is later
            6: ["enhancement", "later", "patch"],
            43: ["bug", "pipeline", "sync-blocked"],                    # a title that names something broken
            72: ["bug", "needs-triage", "patch"],
            73: ["enhancement", "needs-triage", "pipeline"],            # fork-only, no area: pipeline
            105: ["device-check", "enhancement", "patch"],              # live goes, device-check holds it
            235: ["enhancement", "fixing", "patch"],                    # an open pull request is on it; a patch file
            240: ["bug", "needs-triage", "patch"],                      # one kind
        })
        self.assertTrue(next(m for m in out["changes"] if m["number"] == 1)["pin"])
        self.assertEqual(sorted(out["labels_to_delete"]), sorted(set(OLD) - set(labels.NAMES)))

    def test_apply_moves_every_issue_then_deletes_the_old_labels_and_closes_nothing(self):
        gh = world()
        out = labels.run(gh, {3, 6, 72, 105, 235, 240}, apply=True)
        self.assertEqual(sorted(gh.labels), sorted(labels.NAMES))
        self.assertEqual(sorted(out["deleted"]), sorted(set(OLD) - set(labels.NAMES)))
        self.assertEqual([i["number"] for i in gh.issues.values() if i["state"] != "open"], [])
        self.assertTrue(gh.issues[1]["isPinned"])
        self.assertEqual(after(gh, 72), ["bug", "needs-triage", "patch"])
        self.assertFalse([c for c in gh.calls if c[:2] in (["issue", "close"], ["issue", "comment"])])
        self.assertEqual(gh.labels["score:5"]["description"],
                         "Triage's score: work stops, or something real is at risk")
        gh.calls = []
        again = labels.run(gh, {3, 6, 72, 105, 235, 240}, apply=True)
        self.assertEqual((again["changes"], gh.writes()), ([], []), "a second run writes nothing")

    def test_old_labels_stay_until_every_issue_is_moved(self):
        gh = world()
        gh.refuse.add(("issue", "edit"))
        with self.assertRaises(Refused) as e:
            labels.run(gh, set(), apply=True)
        self.assertEqual(e.exception.fields["outcome"], "wait")
        self.assertFalse([c for c in gh.calls if c[:2] == ["label", "delete"]])
        self.assertIn("live", gh.labels)

    def test_one_flow_label_at_most(self):
        for names in (["later", "needs-triage"], ["on-hold", "later", "fixing"], ["blocked", "ready"]):
            got, _, _ = labels.target(issue(9, "x", ["patch", *names]), True, False)
            self.assertEqual(len([x for x in got if x in labels.FLOW]), 1, (names, got))


if __name__ == "__main__":
    unittest.main()
