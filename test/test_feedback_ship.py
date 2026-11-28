"""Friction loop, slice 6 (#94): on this machine. A followed issue closed as fixed is looked at further, read only: the
commit that closed it (its timeline's ClosedEvent), the first stable release whose tag contains it, and whether the
installed build (the installer's record) does (`gh api repos/<repo>/compare/<base>...<sha>`). An install's own
`--installed <build> --issues …` is kept only for the recorded build; a build change clears On this machine. The
person's Works and Still broken; came back. Slice 5's fixture (test_feedback_track.Tracked) with a fake gh that also
answers timelines, releases and compares; one run through the real CLI with HERDR_TASK_GH. Made-up names only."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from test_feedback_found import BIN, World, fb  # noqa: E402
import test_feedback_track as tt  # noqa: E402  (its Tracked reused by attribute: its tests don't run twice)
import herdr_task.cli as cli  # noqa: E402
import herdr_task.feedback_ship as fs  # noqa: E402

FIX = "a" * 40          # the commit that closed issue 42
BUILD = "b" * 40        # the build installed here (it has FIX)
OLD = "c" * 40          # an older build (it hasn't)
FORK = "acme/shep"
REPO, URL = tt.REPO, tt.URL


class Ship(World):
    """Tracked's filed problem k1 (acme/shep#42), filed in acme/shep (the feedback repo), with this machine's install
    record in a throwaway share folder; the fake gh answers closers (self.closers {(repo, n): sha}), releases
    (self.releases, newest last) and compares (self.has {base: shas it contains})."""

    filed, track, outcome, listed_by, close = (tt.Tracked.filed, tt.Tracked.track, tt.Tracked.outcome,
                                                tt.Tracked.listed_by, tt.Tracked.close)

    def setUp(self):
        super().setUp()
        self.issues = {(REPO, 42): tt.gh_issue(42, "Reply bubble hides the message it answers")}
        self.dupe_of, self.timeline_down, self.down = {}, set(), False
        p = mock.patch.object(fb, "run", self.github)
        p.start()
        self.addCleanup(p.stop)
        self.seed({"k1": self.filed()})
        self.closers = {(REPO, 42): FIX}
        self.releases = ["v3.2.21", "v3.2.22", "v3.2.23", "v3.2.24"]
        self.has = {"v3.2.23": {FIX}, "v3.2.24": {FIX}, "v3.2.22": set(), "v3.2.21": set(), BUILD: {FIX}, OLD: set()}
        self.share = os.path.join(self.dir, "share")
        os.makedirs(self.share)
        p = mock.patch.object(fs, "SHARE", self.share)
        p.start()
        self.addCleanup(p.stop)
        self.install(BUILD)
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": FORK}}})
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("HC_TERMINAL_ID", None)
        os.environ.pop("HC_TERMINAL_SOCKET", None)
        foreign = mock.patch("herdr_task.base.FOREIGN_TERMINAL", False, create=True)
        foreign.start()
        self.addCleanup(foreign.stop)

    def install(self, build, version="3.2.24"):
        """What bin/shepherdr's record says after an install: its version, and its build when it could be known."""
        with open(os.path.join(self.share, "installed.json"), "w") as f:
            json.dump({"version": version, "files": {}, **({"build": build} if build else {})}, f)

    def github(self, args, **kw):
        ok = lambda out: subprocess.CompletedProcess(args, 0, out, "")
        if self.down or args[1:2] != ["api"]:
            return tt.Tracked.github(self, args, **kw)
        if args[2] == "graphql" and any("ClosedEvent" in a for a in args):
            self.gh.append(args)
            n = int(next(a for a in args if a.startswith("i="))[2:])
            sha = self.closers.get((REPO, n))
            closer = {"__typename": "PullRequest", "mergeCommit": {"oid": sha}} if sha else None
            return ok(json.dumps({"data": {"repository": {"issue": {"timelineItems": {"nodes": [{"closer": closer}]}}}}}))
        if args[2] == f"repos/{REPO}/releases?per_page={fs.RELEASES}":
            self.gh.append(args)
            return ok(json.dumps([{"tag_name": t, "draft": False, "prerelease": False} for t in self.releases]
                                 + [{"tag_name": "v9.0.0-rc1", "prerelease": True}]))
        if args[2].startswith(f"repos/{REPO}/compare/"):
            self.gh.append(args)
            base, _, head = args[2].rsplit("/", 1)[1].partition("...")
            if base not in self.has:
                return subprocess.CompletedProcess(args, 1, "", "gh: Not Found (HTTP 404)")
            return ok("behind\n" if head in self.has[base] else "diverged\n")
        return tt.Tracked.github(self, args, **kw)

    def fixed(self):
        self.close("COMPLETED")
        self.track()
        return self.listed_by("k1")

    def compares(self):
        return [a[2] for a in self.gh if a[1:2] == ["api"] and "/compare/" in a[2]]

    # ---- what GitHub shows of the fix ---------------------------------------------------------

    def test_a_release_whose_tag_has_the_commit_gives_fixed_in_and_the_build_on_this_machine(self):
        row = self.fixed()
        self.assertEqual(row["outcome"]["fix"], {"issue": f"{REPO}#42", "commit": FIX, "release": "3.2.23",
                                                 "build": {"sha": BUILD, "has": True}})
        s = row["shipped"]
        self.assertEqual((s["build"], s["how"], s["release"], s["machine"]), (BUILD, "release", "3.2.23", "vm-test"))
        self.assertEqual(row["here"], {"version": "3.2.22", "build": BUILD})
        # newest first, stopping at the first tag without it; a prerelease is never named
        self.assertEqual(self.compares(), [f"repos/{REPO}/compare/v3.2.24...{FIX}", f"repos/{REPO}/compare/v3.2.23...{FIX}",
                                           f"repos/{REPO}/compare/v3.2.22...{FIX}", f"repos/{REPO}/compare/{BUILD}...{FIX}"])

    def test_a_closed_issue_with_no_closing_commit_stays_closed_as_fixed(self):
        self.closers = {}
        row = self.fixed()
        self.assertEqual(row["outcome"]["fix"], {"issue": f"{REPO}#42", "commit": None})
        self.assertNotIn("shipped", row)
        self.assertEqual(self.compares(), [], "a closing date before a release proves nothing: no compare without a commit")

    def test_no_release_has_it_yet_and_a_later_read_finds_the_one_that_does(self):
        self.has.update({"v3.2.23": set(), "v3.2.24": set()})
        row = self.fixed()
        self.assertIsNone(row["outcome"]["fix"]["release"])
        self.assertEqual(row["shipped"]["how"], "release", "the build has it all the same: on this machine")
        self.releases.append("v3.2.25")
        self.has["v3.2.25"] = {FIX}
        self.seed({"k1": {**self.listed_by("k1"), "outcome": {**self.outcome(), "checked_at": 1}}})
        self.track()
        self.assertEqual(self.outcome()["fix"]["release"], "3.2.25")

    def test_an_older_build_without_it_is_not_on_this_machine(self):
        self.install(OLD, "3.2.22")
        row = self.fixed()
        self.assertEqual(row["outcome"]["fix"]["build"], {"sha": OLD, "has": False})
        self.assertEqual(row["outcome"]["fix"]["release"], "3.2.23")
        self.assertNotIn("shipped", row)
        self.assertEqual(row["here"]["build"], OLD, "the page says update to get it: Fixed in 3.2.23, this machine older")

    def test_an_install_with_no_build_shows_no_on_this_machine(self):
        self.install(None)
        row = self.fixed()
        self.assertNotIn("build", row["outcome"]["fix"])
        self.assertNotIn("shipped", row)
        self.assertEqual(row["here"], {"version": "3.2.22", "build": None})
        self.assertEqual(self.compares()[-1], f"repos/{REPO}/compare/v3.2.22...{FIX}", "no build: nothing to compare it with")
        code, out = self.say("--works", "--key", "k1", "--json")
        self.assertEqual(json.loads(out)["tried"], "works", "only the person's Works says it, for an unknown build")

    def test_a_same_version_update_to_another_build_clears_it_and_looks_again(self):
        self.fixed()
        self.install(OLD)  # same version, another build: a rollback to one without the fix
        self.assertNotIn("shipped", self.listed_by("k1"), "a build change clears On this machine at once")
        self.track()  # not due (read a minute ago): only the look for the new build
        row = self.listed_by("k1")
        self.assertEqual(row["outcome"]["fix"]["build"], {"sha": OLD, "has": False})
        self.assertNotIn("shipped", row)
        self.install(BUILD)
        self.track()
        self.assertEqual(self.listed_by("k1")["shipped"]["build"], BUILD)

    def test_gh_failing_keeps_what_was_known(self):
        self.fixed()
        was = self.outcome()["fix"]
        self.install("d" * 40)
        self.down = True
        self.track()
        self.assertEqual(self.outcome()["fix"], was)

    def test_reopened_drops_the_fix_and_keeps_what_was_tried(self):
        self.fixed()
        self.say("--works", "--key", "k1", "--json")
        self.issues[(REPO, 42)] = {**self.issues[(REPO, 42)], "state": "OPEN", "stateReason": "REOPENED"}
        self.track("--key", "k1")
        self.assertEqual(self.outcome()["state"], "closed", "Works ends the following: nothing more is read")

    # ---- what an install carries --------------------------------------------------------------

    def test_installed_for_the_recorded_build_puts_its_issues_on_this_machine(self):
        self.closers = {}  # the closing commit isn't known: the install's word is what counts
        self.fixed()
        code, out = self.say("--installed", BUILD[:12], "--issues", URL, "--try-it", URL, "Reply to a message: its first line shows above", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out)["here"], ["k1"])
        s = self.listed_by("k1")["shipped"]
        self.assertEqual((s["build"], s["how"], s["try"]), (BUILD, "install", "Reply to a message: its first line shows above"))

    def test_installed_for_a_build_that_is_not_the_recorded_one_is_ignored(self):
        self.closers = {}
        self.fixed()
        code, out = self.say("--installed", OLD, "--issues", URL, "--json")
        self.assertEqual((code, json.loads(out)["ignored"]), (0, True))
        self.assertNotIn("shipped", self.listed_by("k1"))
        self.install(None)
        code, out = self.say("--installed", BUILD, "--issues", URL, "--json")
        self.assertTrue(json.loads(out)["ignored"], "no recorded build: nothing to match")

    def test_a_rollback_s_list_without_the_issue_takes_it_away(self):
        self.closers = {}
        self.fixed()
        self.say("--installed", BUILD, "--issues", URL, "--json")
        code, out = self.say("--installed", BUILD, "--issues", "--json")
        self.assertEqual(json.loads(out)["gone"], ["k1"])
        self.assertNotIn("shipped", self.listed_by("k1"))

    def test_installed_refuses_what_is_no_issue(self):
        code, out = self.say("--installed", BUILD, "--issues", "acme/shep#42")
        self.assertNotEqual(code, 0)
        self.assertIn("isn't an issue on GitHub", out)
        code, out = self.say("--issues", URL)
        self.assertIn("go with --installed", out)

    # ---- the person's Works and Still broken ----------------------------------------------------

    def test_works_is_kept_for_the_build_and_ends_the_following(self):
        self.fixed()
        code, out = self.say("--works", "--key", "k1", "--json")
        self.assertEqual(code, 0, out)
        row = self.listed_by("k1")
        self.assertEqual((row["tried"]["result"], row["tried"]["build"]), ("works", BUILD))
        n = len(self.gh)
        self.track("--key", "k1")
        self.assertEqual(len(self.gh), n, "a fix that works isn't read any more")

    def test_works_and_broken_are_the_person_s_only(self):
        self.fixed()
        os.environ["HC_TERMINAL_ID"] = "t9"
        for flag in ("--works", "--broken"):
            code, out = self.say(flag, "--key", "k1")
            self.assertNotEqual(code, 0)
            self.assertIn("Only the person", out)
        self.assertNotIn("tried", self.listed_by("k1"))
        self.assertTrue(cli.person_flags(["--works", "--key", "k1"]) and cli.person_flags(["--brok"]))

    def test_nothing_to_try_before_the_fix_is_here(self):
        self.install(OLD)
        self.fixed()
        code, out = self.say("--works", "--key", "k1", "--json")
        self.assertEqual(json.loads(out)["why"], "not-here")

    def test_still_broken_is_found_again_linked_and_its_comment_a_draft(self):
        self.fixed()
        code, out = self.say("--broken", "--key", "k1", "--json")
        self.assertEqual(code, 0, out)
        self.assertTrue(json.loads(out)["draft"])
        row = self.listed_by("k1")
        self.assertEqual((row["state"], row["back"]["why"], row["back"]["issue"]), ("found", "broken", URL))
        self.assertEqual(row["tried"], {**row["tried"], "result": "broken", "build": BUILD})
        self.assertIn({"issue": f"{REPO}#42", "url": URL, "by": "came-back"}, row["related"])
        self.assertNotIn("url", row)
        self.assertEqual(row["before"]["post"]["state"], "posted", "what was posted stays as history")
        d = row["draft"]
        self.assertEqual((d["rev"], d["target"]), (1, {"repo": FORK, "action": "comment", "issue": 42}))
        self.assertIn("This still happens here with the fix installed.", d["body"])
        self.assertIn(f"(build {BUILD[:12]})", d["body"])
        self.assertNotIn("approval", row)
        self.assertFalse([a for a in self.gh if a[1:3] in (["issue", "comment"], ["issue", "create"])], "nothing posted")

    def test_still_broken_on_an_issue_elsewhere_comes_back_without_a_draft(self):
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": "other/shepherdr"}}})
        self.fixed()
        code, out = self.say("--broken", "--key", "k1", "--json")
        self.assertFalse(json.loads(out)["draft"], "a comment goes only where feedback is filed")
        self.assertEqual(self.listed_by("k1")["back"]["issue"], URL)

    def test_a_report_after_works_is_came_back(self):
        self.fixed()
        self.say("--works", "--key", "k1", "--json")
        self.install("d" * 40)  # a newer build: Works doesn't come undone by itself
        self.assertEqual(self.listed_by("k1")["tried"]["result"], "works")
        code, out = self.say("The reply bubble doesn't show which message it answers", "--details", "Again today.", "--json")
        self.assertEqual(code, 0, out)
        row = self.listed_by("k1")
        self.assertEqual((row["back"]["why"], row["count"]), ("reported", 2))
        self.assertIn(row["state"], ("found", "telling"), "back under Found, and offered to its Assistant like any report")
        self.assertNotIn("url", row)

    def test_a_report_with_its_fix_on_this_machine_is_came_back(self):
        self.fixed()
        self.say("The reply bubble doesn't show which message it answers", "--details", "Again.", "--json")
        self.assertEqual(self.listed_by("k1")["back"]["why"], "reported")

    def test_a_report_of_a_fix_not_here_yet_is_one_more_report(self):
        self.install(OLD)
        self.fixed()
        self.say("The reply bubble doesn't show which message it answers", "--details", "Again.", "--json")
        row = self.listed_by("k1")
        self.assertNotIn("back", row)
        self.assertEqual(row["state"], "filed")

    def test_posting_the_comment_ends_came_back(self):
        self.fixed()
        self.say("--broken", "--key", "k1", "--json")
        import herdr_task.feedback_post as fp
        row = self.listed_by("k1")
        fp.posted("k1", {"target": row["draft"]["target"], "started": None}, URL + "#issuecomment-1")
        row = self.listed_by("k1")
        self.assertNotIn("back", row)
        self.assertEqual(row["state"], "filed")

    # ---- pins ---------------------------------------------------------------------------------

    def test_the_seams_it_relies_on(self):
        import inspect
        import herdr_task.feedback_track as ft
        self.assertIn("after(", inspect.getsource(ft.track))
        self.assertIn("reported_again(", inspect.getsource(fb.add_report))
        self.assertIn("seen_here(", inspect.getsource(fb.list_all))
        self.assertIn('"back"', inspect.getsource(__import__("herdr_task.feedback_post", fromlist=["posted"]).posted))


class RealCli(unittest.TestCase):
    """The real herdr-task, with HERDR_TASK_GH a fake gh script and a throwaway install record (SHEPHERDR_SHARE): an
    issue closed by a merge commit the installed build has; --track: On this machine."""

    def test_track_through_herdr_task_gh(self):
        d = tempfile.mkdtemp(prefix="feedback-ship-cli-")
        log, gh, share = os.path.join(d, "gh.log"), os.path.join(d, "gh"), os.path.join(d, "share")
        os.makedirs(share)
        with open(os.path.join(share, "installed.json"), "w") as f:
            json.dump({"version": "3.2.22", "build": BUILD, "files": {}}, f)
        with open(gh, "w") as f:
            f.write("#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + log + "\n"
                    "case \"$*\" in\n"
                    "  'issue view 42 --repo acme/shep '*) echo '{\"number\":42,\"title\":\"Reply bubble hides its message\","
                    "\"url\":\"https://github.com/acme/shep/issues/42\",\"state\":\"CLOSED\",\"stateReason\":\"COMPLETED\"}';;\n"
                    "  *ClosedEvent*) echo '{\"data\":{\"repository\":{\"issue\":{\"timelineItems\":{\"nodes\":[{\"closer\":"
                    "{\"__typename\":\"Commit\",\"oid\":\"" + FIX + "\"}}]}}}}}';;\n"
                    "  'api repos/acme/shep/releases'*) echo '[]';;\n"
                    "  'api repos/acme/shep/compare/" + BUILD + "..." + FIX + " '*) echo behind;;\n"
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
               "HERDR_TASK_SETTINGS": os.path.join(d, "settings.json"), "SHEPHERDR_NO_MIGRATE": "1", "SHEPHERDR_SHARE": share}
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "feedback", "--track", "--json"],
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "feedback", "--list", "--all", "--json"],
                           env=env, capture_output=True, text=True, timeout=60)
        p = json.loads(r.stdout)[0]
        self.assertEqual((p["shipped"]["build"], p["outcome"]["fix"]["commit"]), (BUILD, FIX))
        with open(log) as f:
            self.assertIn(f"api repos/acme/shep/compare/{BUILD}...{FIX} --jq .status", f.read().split("\n"))


if __name__ == "__main__":
    unittest.main()
