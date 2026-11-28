"""Friction loop, slice 5 (#94): follow the issue. `herdr-task feedback --track` reads, read only, the issue each filed
or followed problem follows: open, closed as fixed, declined there, or a duplicate followed to the issue GitHub's
timeline names (MarkedAsDuplicateEvent). Reopened goes back to open; gh failing keeps the last outcome; each issue is
read at most once an hour; nothing is read with offers off in its origin. Slice 1's throwaway store and settings file
(test_feedback_found.World), with a fake gh that answers from made-up issues; one run goes through the real CLI with
HERDR_TASK_GH. Made-up names only."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import inspect
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from test_feedback_found import BIN, World, fb  # noqa: E402  (World has no tests of its own: none run twice)
import herdr_task.feedback_check as fc  # noqa: E402
import herdr_task.feedback_track as ft  # noqa: E402

REPO = "acme/shep"
URL = f"https://github.com/{REPO}/issues/42"
HOUR = 3600000


def gh_issue(n, title, state="OPEN", reason=None, repo=REPO):
    return {"number": n, "title": title, "url": f"https://github.com/{repo}/issues/{n}", "state": state, "stateReason": reason}


class Tracked(World):
    """A filed problem in sp1 (issue acme/shep#42, as slice 4's post leaves it); gh answers from self.issues
    {(repo, n): issue} and self.dupe_of {(repo, n): canonical issue}."""

    def setUp(self):
        super().setUp()
        self.issues = {(REPO, 42): gh_issue(42, "Reply bubble hides the message it answers")}
        self.dupe_of = {}
        self.down = False
        p = mock.patch.object(fb, "run", self.github)
        p.start()
        self.addCleanup(p.stop)
        self.seed({"k1": self.filed()})

    def filed(self, **more):
        return {"id": "k1", "line": "The reply bubble doesn't show which message it answers", "state": "filed", "space": "sp1",
                "at": 1, "url": URL, "decision": "approved", "post": {"state": "posted", "rev": 1, "url": URL},
                "outcome": {"url": URL, "state": "open", "checked_at": 1}, **more}

    def github(self, args, **_):
        self.gh.append(args)
        ok = lambda out: subprocess.CompletedProcess(args, 0, out, "")
        if self.down:
            return subprocess.CompletedProcess(args, 1, "", "error connecting to api.github.com")
        if args[1:3] == ["issue", "view"]:
            x = self.issues.get((args[args.index("--repo") + 1], int(args[3])))
            return ok(json.dumps(x)) if x else subprocess.CompletedProcess(args, 1, "", "GraphQL: Could not resolve to an issue")
        if args[1:3] == ["api", "graphql"]:
            n = int(next(a for a in args if a.startswith("i="))[2:])
            repo = "/".join(next(a for a in args if a.startswith(k + "="))[2:] for k in ("o", "n"))
            c = self.dupe_of.get((repo, n))
            nodes = [{"canonical": {**c, "repository": {"nameWithOwner": c["url"].split("/")[3] + "/" + c["url"].split("/")[4]}}}] if c else []
            return ok(json.dumps({"data": {"repository": {"issue": {"timelineItems": {"nodes": nodes}}}}}))
        return subprocess.CompletedProcess(args, 1, "", "unexpected")

    def track(self, *more):
        code, out = self.say("--track", *more, "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)

    def outcome(self, key="k1"):
        return self.listed_by(key).get("outcome")

    def listed_by(self, key):
        return next(r for r in self.listed() if r["id"] == key)

    def close(self, reason, n=42, repo=REPO):
        self.issues[(repo, n)] = {**self.issues[(repo, n)], "state": "CLOSED", "stateReason": reason}

    # ---- what GitHub says ---------------------------------------------------------------------

    def test_closed_as_completed_is_closed_as_fixed(self):
        self.close("COMPLETED")
        out = self.track()
        self.assertEqual(out["tracked"], [{"key": "k1", "changed": True, "state": "closed", "reason": "completed"}])
        o = self.outcome()
        self.assertEqual((o["state"], o["reason"], o["url"], o["issue"]), ("closed", "completed", URL, f"{REPO}#42"))
        self.assertEqual(o["title"], "Reply bubble hides the message it answers")
        self.assertEqual(ft.said(o), "Closed as fixed")

    def test_closed_as_not_planned_is_declined_there(self):
        self.close("NOT_PLANNED")
        self.track()
        self.assertEqual((self.outcome()["reason"], ft.said(self.outcome())), ("not_planned", "Declined there"))

    def test_a_duplicate_follows_the_issue_its_timeline_names(self):
        self.close("DUPLICATE")
        self.dupe_of[(REPO, 42)] = gh_issue(7, "Reply context in chat")
        out = self.track()
        o = self.outcome()
        self.assertEqual((o["state"], o["reason"]), ("closed", "duplicate"))
        self.assertEqual(o["canonical"], {"repo": REPO, "number": 7, "title": "Reply context in chat",
                                          "url": f"https://github.com/{REPO}/issues/7", "state": "open"})
        self.assertEqual(out["tracked"][0]["canonical"]["number"], 7)
        self.assertEqual(ft.said(o), "Closed as a duplicate of “Reply context in chat”, which is open")
        # the canonical issue closed as fixed since: the next read says so
        self.dupe_of[(REPO, 42)] = gh_issue(7, "Reply context in chat", "CLOSED", "COMPLETED")
        self.track("--key", "k1")
        self.assertEqual(ft.said(self.outcome()), "Closed as a duplicate of “Reply context in chat”, which is closed as fixed")

    def test_a_duplicate_of_a_duplicate_is_followed_on(self):
        self.close("DUPLICATE")
        self.dupe_of[(REPO, 42)] = gh_issue(7, "Reply context", "CLOSED", "DUPLICATE")
        self.dupe_of[(REPO, 7)] = gh_issue(3, "Quote the answered message", "CLOSED", "COMPLETED")
        self.track()
        c = self.outcome()["canonical"]
        self.assertEqual((c["number"], c["state"], c["reason"]), (3, "closed", "completed"))

    def test_a_duplicate_with_no_canonical_is_closed_as_a_duplicate(self):
        self.close("DUPLICATE")
        self.track()
        self.assertNotIn("canonical", self.outcome())
        self.assertEqual(ft.said(self.outcome()), "Closed as a duplicate")

    def test_reopened_goes_back_to_open(self):
        self.seed({"k1": self.filed(outcome={"url": URL, "state": "closed", "reason": "duplicate", "checked_at": 1,
                                             "canonical": {"repo": REPO, "number": 7, "title": "x", "url": f"https://github.com/{REPO}/issues/7", "state": "open"}})})
        out = self.track()
        o = self.outcome()
        self.assertEqual(o["state"], "open")
        self.assertNotIn("reason", o)
        self.assertNotIn("canonical", o)
        self.assertTrue(out["tracked"][0]["changed"])

    def test_gh_failing_keeps_the_last_outcome(self):
        self.seed({"k1": self.filed(outcome={"url": URL, "state": "closed", "reason": "completed", "title": "Reply bubble", "checked_at": 1})})
        self.down = True
        out = self.track()
        self.assertEqual(out["failed"][0]["key"], "k1")
        p = self.listed_by("k1")
        self.assertEqual(p["outcome"], {"url": URL, "state": "closed", "reason": "completed", "title": "Reply bubble", "checked_at": 1})
        self.assertIn("isn't reachable", p["track_error"]["why"])
        # back: the next read answers, and the error goes
        self.down = False
        self.track("--key", "k1")
        p = self.listed_by("k1")
        self.assertNotIn("track_error", p)
        self.assertEqual(p["outcome"]["state"], "open")

    def test_a_canonical_the_timeline_didnt_name_this_time_stays(self):
        c = {"repo": REPO, "number": 7, "title": "Reply context in chat", "url": f"https://github.com/{REPO}/issues/7", "state": "open"}
        self.seed({"k1": self.filed(outcome={"url": URL, "state": "closed", "reason": "duplicate", "checked_at": 1, "canonical": c})})
        self.close("DUPLICATE")
        self.track()
        self.assertEqual(self.outcome()["canonical"], c)

    # ---- what is read, and when ---------------------------------------------------------------

    def test_each_issue_is_read_at_most_once_an_hour(self):
        self.track()
        self.assertEqual(len(self.views()), 1)
        self.gh.clear()
        self.close("COMPLETED")
        out = self.track()  # read a moment ago: not again
        self.assertEqual((self.views(), out["tracked"]), ([], []))
        self.assertEqual(self.outcome()["state"], "open")
        self.track("--key", "k1")  # that one, now
        self.assertEqual(self.outcome()["reason"], "completed")
        # an hour on, it's due again
        with mock.patch.object(ft, "now", lambda: fb.now() + HOUR + 1):
            self.gh.clear()
            self.track()
            self.assertEqual(len(self.views()), 1)

    def test_a_failed_read_waits_its_hour_too(self):
        self.down = True
        self.track()
        self.gh.clear()
        self.track()
        self.assertEqual(self.views(), [])

    def views(self):
        return [a for a in self.gh if a[1:3] == ["issue", "view"]]

    def test_only_filed_and_followed_problems_are_read(self):
        follow = {"id": "k2", "line": "Search misses tasks on another machine", "state": "told", "space": "sp1", "at": 1,
                  "decision": "following", "outcome": {"url": f"https://github.com/{REPO}/issues/19", "issue": f"{REPO}#19",
                                                       "title": "Task search covers linked machines", "state": "open", "checked_at": 1}}
        comment = {**self.filed(), "id": "k3", "line": "Another one", "url": f"https://github.com/{REPO}/issues/42#issuecomment-9",
                   "outcome": {"url": URL, "state": "open", "checked_at": 1}}
        old = {"id": "k4", "line": "An older version's filing", "state": "filed", "space": "sp1", "at": 1, "url": f"https://github.com/{REPO}/issues/5"}
        found = {"id": "k5", "line": "Not filed", "state": "found", "space": "sp1", "at": 1}
        waits = {**self.filed(), "id": "k6", "line": "Waiting", "state": "told", "url": None,
                 "post": {"state": "waiting", "rev": 1}, "outcome": None}
        works = {**self.filed(), "id": "k7", "line": "Works now", "tried": {"result": "works", "build": "abc", "at": 1}}
        self.issues[(REPO, 19)] = gh_issue(19, "Task search covers linked machines", "CLOSED", "COMPLETED")
        self.issues[(REPO, 5)] = gh_issue(5, "Older filing", "CLOSED", "NOT_PLANNED")
        self.seed({"k1": self.filed(), "k2": follow, "k3": comment, "k4": old, "k5": found, "k6": waits, "k7": works})
        out = self.track()
        self.assertEqual(sorted(t["key"] for t in out["tracked"]), ["k1", "k2", "k3", "k4"])
        p = self.listed_by("k2")
        self.assertEqual((p["decision"], p["outcome"]["reason"]), ("following", "completed"))  # the person's decision stays
        self.assertEqual(self.listed_by("k3")["outcome"]["url"], URL)  # a comment follows its issue
        self.assertEqual(self.listed_by("k4")["outcome"]["reason"], "not_planned")  # an older version's filing too
        self.assertEqual(sorted({a[3] for a in self.views()}), ["19", "42", "5"])

    def test_nothing_is_read_with_offers_off_in_its_origin(self):
        self.settings({"spaces": {"sp1": {"agents": {"feedback": False}}}})
        out = self.track()
        self.assertEqual((out["tracked"], self.views()), ([], []))
        out = self.track("--key", "k1")
        self.assertEqual(out["why"], "not-followed")
        self.assertEqual(self.views(), [])

    def test_only_github_reads(self):
        self.close("DUPLICATE")
        self.dupe_of[(REPO, 42)] = gh_issue(7, "Reply context in chat")
        self.track()
        self.assertTrue(self.gh)
        for a in self.gh:
            self.assertTrue(a[1:3] == ["issue", "view"] or a[1:3] == ["api", "graphql"], a)
            self.assertNotIn("--body-file", a)
            self.assertFalse(any(x.startswith("query=mutation") for x in a), a)

    def test_only_github_s_side_changes(self):
        shipped = {"release": "3.2.23", "build": "abc", "machine": "vm-test", "at": 1, "how": "release"}
        self.seed({"k1": self.filed(shipped=shipped, tried={"result": "broken", "build": "abc", "at": 1})})
        before = {k: v for k, v in self.listed_by("k1").items() if k != "outcome"}
        self.close("COMPLETED")
        self.track()
        after = {k: v for k, v in self.listed_by("k1").items() if k != "outcome"}
        self.assertEqual(before, after)

    def test_an_agent_may_track_and_it_needs_no_assistant(self):
        self.caller = {}  # outside any agent's terminal, as the service runs it
        self.close("COMPLETED")
        self.assertEqual(self.track()["tracked"][0]["reason"], "completed")

    # ---- pins ---------------------------------------------------------------------------------

    def test_the_seams_it_relies_on(self):
        """#94, slice 5 relies on these upstream and earlier-slice names: a break shows here at once."""
        self.assertEqual(list(inspect.signature(fc.canonical).parameters), ["repo", "number"])
        self.assertEqual(list(inspect.signature(fc.match).parameters), ["repo", "x"])
        self.assertEqual(list(inspect.signature(fc.gh).parameters), ["args"])
        self.assertEqual(list(inspect.signature(fb.feedback_on).parameters), ["space", "d"])
        self.assertTrue(callable(fb.problems) and callable(fb.problems_read))
        self.assertIn("MarkedAsDuplicateEvent", fc.CANONICAL)


class RealCli(unittest.TestCase):
    """The real herdr-task, with HERDR_TASK_GH a fake gh script: a filed record, its issue closed as completed, then
    --track from the service's side (no agent terminal)."""

    def test_track_through_herdr_task_gh(self):
        d = tempfile.mkdtemp(prefix="feedback-track-cli-")
        log, gh = os.path.join(d, "gh.log"), os.path.join(d, "gh")
        with open(gh, "w") as f:
            f.write("#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + log + "\n"
                    "case \"$*\" in\n"
                    "  'issue view 42 --repo acme/shep '*) echo '{\"number\":42,\"title\":\"Reply bubble hides its message\","
                    "\"url\":\"https://github.com/acme/shep/issues/42\",\"state\":\"CLOSED\",\"stateReason\":\"COMPLETED\"}';;\n"
                    "  *) exit 1;;\n"
                    "esac\n")
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)
        with open(os.path.join(d, ".feedback.json"), "w") as f:
            json.dump({"problems": {"abc123": {"id": "abc123", "line": "The reply bubble hides its message", "state": "filed",
                                               "space": "sp1", "at": 1, "url": URL,
                                               "outcome": {"url": URL, "state": "open", "checked_at": 1}}}}, f)
        with open(os.path.join(d, "settings.json"), "w") as f:
            json.dump({}, f)
        env = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin", "HERDR_TASK_STORE": d, "HERDR_TASK_GH": gh,
               "HERDR_TASK_SETTINGS": os.path.join(d, "settings.json"), "SHEPHERDR_NO_MIGRATE": "1"}
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "feedback", "--track", "--json"],
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with open(os.path.join(d, ".feedback.json")) as f:
            p = json.load(f)["problems"]["abc123"]
        self.assertEqual((p["outcome"]["state"], p["outcome"]["reason"]), ("closed", "completed"))
        with open(log) as f:
            self.assertEqual(f.read().split("\n")[0], "issue view 42 --repo acme/shep --json number,title,url,state,stateReason")


if __name__ == "__main__":
    unittest.main()
