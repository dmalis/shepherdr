"""The sync PR's one merge route and main's checks (fork/specs/sync-pipeline.md, "Merge and finish", build task 3):
every gate of `fork/bin/sync merge` holds the run on its own, the merge is a real merge commit in a bare stand-in for
the fork (gh faked), its verification catches a squash, and main's checks read upstream's own push trigger. Plus
pins on the two workflows the gates read by name."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import time  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

from syncworld import GREEN, World, git  # noqa: E402
from sync import gate, release, state  # noqa: E402

RUNNING = [{"name": "check", "status": "in_progress", "conclusion": None},
           {"name": "fork-check", "status": "completed", "conclusion": "success"}]


class Merge(World):
    def setUp(self):
        super().setUp()
        self.rel = self.upstream_release("v3.2.22")
        self.assertEqual(self.sync("select")[1]["path"], "take")
        self.merge, self.head = self.sync_branch("v3.2.22", self.rel)
        self.assertEqual(self.sync("review-inputs", paths_ok=True)[0], 0)
        with state.locked(self.p) as st:
            state.record_trial(st, self.head, release.tree(self.wt, self.head))
        self.assertEqual(self.st()["phase"], "tried")
        self.pr = {"number": 7, "state": "OPEN", "isDraft": False, "baseRefName": "main",
                   "headRefName": "sync/v3.2.22", "headRefOid": self.head, "isCrossRepository": False,
                   "headRepository": {"name": "shepherdr"}, "mergeCommit": None}
        self.set_gh(prs={"7": self.pr})
        self.reviewed(self.head)

    def reviewed(self, head):
        self.set_ht({self.RUN: {"state": "running", "review_rounds": {"used": 1, "of": 2,
                                                                       "last": {"head": head, "text": "no findings"}}}})

    def held_at(self, gate_name, *args):
        code, out = self.sync("merge", "7", *args)
        self.assertEqual((code, out.get("outcome"), out.get("kind"), out.get("gate")), (1, "held", "gate", gate_name),
                         out)
        self.assertFalse([c for c in self.gh_calls() if c[:2] == ["pr", "merge"]], "nothing merged")
        self.assertEqual(self.st()["phase"], "tried")
        return out

    def test_it_merges_verifies_and_reads_mains_checks(self):
        code, out = self.sync("merge", "7")
        self.assertEqual(code, 0, out)
        mc = out["candidate"]
        self.assertEqual(git(self.origin, "rev-parse", "main"), mc)
        self.assertEqual(git(self.origin, "rev-list", "--parents", "-n", "1", mc).split()[1:], [self.main0, self.head])
        st = self.st()
        self.assertEqual((st["phase"], st["candidate"], st["release"]["merged"], st["run"]["merged"]),
                         ("merged", mc, True, True))
        self.assertTrue(state.checks_passed(st, mc))
        merges = [c for c in self.gh_calls() if c[:2] == ["pr", "merge"]]
        self.assertEqual(merges, [["pr", "merge", "7", "-R", "dmalis/shepherdr", "--merge", "--match-head-commit",
                                   self.head]])
        for c in self.gh_calls():
            self.assertTrue("dmalis/shepherdr" in c or any(x.startswith("repos/dmalis/shepherdr/") for x in c), c)
        # called again (a resume): main's checks only, no second merge
        code, out = self.sync("merge", "7")
        self.assertEqual((code, out["candidate"]), (0, mc))
        self.assertEqual(len([c for c in self.gh_calls() if c[:2] == ["pr", "merge"]]), 1)

    def test_the_pull_request_gate(self):
        for change in ({"state": "CLOSED"}, {"isDraft": True}, {"baseRefName": "release"},
                       {"headRefName": "sync/v3.2.21"}, {"isCrossRepository": True}, {"headRefOid": self.main0}):
            with self.subTest(change):
                self.set_gh(prs={"7": dict(self.pr, **change)})
                self.held_at("pr")

    def test_the_review_gate_wants_a_round_on_the_exact_head(self):
        self.set_ht({self.RUN: {"state": "running", "review_rounds": {"used": 0, "of": 2}}})
        self.held_at("review")
        self.reviewed(self.merge)
        out = self.held_at("review")
        self.assertIn(self.merge[:12], out["why"])
        # rounds used up and the last one on an earlier commit: still held, the person decides
        self.set_ht({self.RUN: {"state": "running", "review_rounds": {"used": 2, "of": 2,
                                                                       "last": {"head": self.merge}}}})
        self.held_at("review")

    def test_main_moved_on_is_not_up_to_date(self):
        moved = self.our_merge()
        out = self.held_at("up-to-date")
        self.assertEqual(out["why"], f"{moved} is not an ancestor of {self.head}")

    def test_main_moving_while_the_checks_ran_is_caught_before_the_merge(self):
        self.set_gh(advance_on_checks=self.head)
        out = self.held_at("up-to-date")
        moved = git(self.origin, "rev-parse", "main")
        self.assertNotEqual(moved, self.main0)
        self.assertEqual(out["why"], f"{moved} is not an ancestor of {self.head}")

    def test_a_run_that_takes_the_lease_over_resumes_the_merge(self):
        """The run that tried the head ended (done) before merging; the next run takes the lease over and merges,
        the review rounds read from the run that recorded the head."""
        self.set_ht({self.RUN: {"state": "done", "review_rounds": {"used": 1, "of": 2, "last": {"head": self.head}}},
                     "SYNC-2": {"state": "running"}})
        with state.locked(self.p) as st:          # preflight's takeover (its CLI wiring: test_state's SyncCommand)
            self.assertEqual(state.take_lease(st, "SYNC-2", self.space, owner=lambda *a: "done"),
                             {"run": self.RUN, "was": "done"})
            self.assertEqual(state.adopt_run(st, "SYNC-2", self.space, start=self.head), self.RUN)
        r = self.st()["run"]
        self.assertEqual((r["key"], r["took_from"], r["path"]), ("SYNC-2", self.RUN, "take"))
        code, out = self.sync("merge", "7")
        self.assertEqual(out["outcome"], "stop", "the earlier run no longer owns it")
        code, out = self.sync("merge", "7", run="SYNC-2")
        self.assertEqual((code, self.st()["phase"]), (0, "merged"), out)
        code, out = self.sync("finish", run="SYNC-2", paths_ok=True)
        self.assertIn("hasn't ended (phase merged)", out["why"], "the install steps come next, in this run")

    def test_the_release_must_be_an_ancestor_of_the_head(self):
        other = self.upstream_commit("after the release")
        self.edit(release={"tag": "v3.2.22", "sha": other})
        out = self.held_at("ancestry")
        self.assertEqual(out["why"], f"{other} is not an ancestor of {self.head}", "facts, never a guess at why")

    def test_the_heads_checks(self):
        self.set_gh(checks={self.head: [GREEN[0], dict(GREEN[1], conclusion="failure")]})
        self.held_at("checks")
        self.set_gh(checks={self.head: [GREEN[1]]})          # check hasn't appeared yet: wait, then call again
        code, out = self.sync("merge", "7")
        self.assertEqual((code, out["outcome"]), (1, "wait"), out)
        self.set_gh(checks={self.head: RUNNING})
        code, out = self.sync("merge", "7")
        self.assertEqual(out["outcome"], "wait")
        first = self.st()["waits"][f"pr:{self.head}"]
        self.sync("merge", "7")
        self.assertEqual(self.st()["waits"][f"pr:{self.head}"], first, "the 30 minutes count from the first wait")
        with state.locked(self.p) as st:                      # 30 minutes on, still running: held
            st["waits"][f"pr:{self.head}"] = state.stamp(time.time() - gate.CHECKS_WAIT_S - 5)
        out = self.held_at("checks")
        self.assertIn("30 minutes", out["why"])
        self.set_gh(checks_unread=True)
        self.held_at("checks")

    def test_the_trial_must_have_passed_on_the_head(self):
        with state.locked(self.p) as st:
            st["trials"] = []
        self.held_at("trial")

    def test_a_squash_fails_verification(self):
        self.set_gh(merge="squash")
        code, out = self.sync("merge", "7")
        self.assertEqual((code, out["outcome"], out["gate"]), (1, "held", "verify"), out)
        self.assertIn("parents", out["why"])
        self.assertEqual(self.st()["phase"], "tried", "never recorded as the candidate")

    def test_a_merge_that_died_before_its_record_is_verified_on_the_next_call(self):
        self.set_gh(merge="fail")
        code, out = self.sync("merge", "7")
        self.assertEqual((code, out["gate"]), (1, "merge"))
        self.assertEqual(self.st()["sync"]["main_before"], self.main0)
        self.set_gh(merge="merge")
        # GitHub merged it after all (the call died after the merge): the next call verifies, merges nothing
        import subprocess
        subprocess.run([os.path.join(self.bin, "gh"), "pr", "merge", "7", "-R", "dmalis/shepherdr", "--merge",
                        "--match-head-commit", self.head], env=self.env(), check=True)
        n = len(self.gh_calls())
        code, out = self.sync("merge", "7")
        self.assertEqual((code, self.st()["phase"]), (0, "merged"), out)
        self.assertFalse([c for c in self.gh_calls()[n:] if c[:2] == ["pr", "merge"]])

    def test_mains_checks_hold_or_wait_after_the_merge(self):
        self.set_gh(checks={"*": GREEN, self.head: GREEN})
        # the merge commit's own checks: fork-check failed
        def merged_with(checks):
            self.set_gh(checks={self.head: GREEN, "*": checks})
            return self.sync("merge", "7")
        code, out = merged_with([GREEN[0], dict(GREEN[1], conclusion="cancelled")])
        self.assertEqual((code, out["gate"]), (1, "main-checks"), out)
        self.assertEqual(self.st()["phase"], "merged", "merged: the install waits on main's checks")
        code, out = merged_with(RUNNING)
        self.assertEqual(out["outcome"], "wait")
        code, out = merged_with(GREEN)
        self.assertEqual(code, 0)

    def test_only_the_leases_owner_after_its_trial(self):
        code, out = self.sync("merge", "7", run="SYNC-2")
        self.assertEqual(out["outcome"], "stop")
        self.edit(phase="branch-pushed")
        code, out = self.sync("merge", "7")
        self.assertEqual(out["outcome"], "stop")
        self.assertIn("after its trial", out["why"])


class MainChecks(World):
    """Main's checks on a candidate: fork-check always, upstream's check when its push trigger would run."""

    def setUp(self):
        super().setUp()
        with open(os.path.join(ROOT, ".github", "workflows", "check.yml")) as f:
            self.write(self.ours, ".github/workflows/check.yml", f.read())
        self.with_yml = self.commit(self.ours, "the workflow")
        git(self.ours, "push", "-q", "origin", "main")
        git(self.wt, "fetch", "-q", "origin")
        env = mock.patch.dict(os.environ, self.env())     # in-process: the fakes first on PATH
        env.start()
        self.addCleanup(env.stop)

    def candidate(self, path, text="x\n"):
        old = git(self.ours, "rev-parse", "HEAD")
        self.write(self.ours, path, text)
        sha = self.commit(self.ours, path)
        git(self.ours, "push", "-q", "origin", "main")
        git(self.wt, "fetch", "-q", "origin")
        return old, sha

    def test_a_code_change_expects_check(self):
        old, sha = self.candidate("bin/tool.py")
        self.assertEqual(gate.check_expected(self.wt, sha, old), (True, ["**/*.md", "docs/**"]))
        self.set_gh(checks={sha: [GREEN[1]]})
        self.assertEqual(gate.main_checks(self.p, self.wt, sha, old)[0], "wait")
        self.set_gh(checks={sha: GREEN})
        self.assertEqual(gate.main_checks(self.p, self.wt, sha, old)[0], "pass")
        self.assertTrue(state.checks_passed(self.st(), sha))

    def test_a_docs_only_change_needs_fork_check_and_a_passed_check_before_it(self):
        old, sha = self.candidate("docs/more.md")
        self.assertEqual(gate.check_expected(self.wt, sha, old)[0], False)
        self.set_gh(checks={sha: [GREEN[1]], old: GREEN})
        self.assertEqual(gate.main_checks(self.p, self.wt, sha, old)[0], "pass")
        # no commit before it whose check passed: held
        self.set_gh(checks={sha: [GREEN[1]], "*": []})
        with self.assertRaises(state.Refused) as e:
            gate.main_checks(self.p, self.wt, sha, old)
        self.assertEqual(e.exception.fields["gate"], "main-checks")

    def test_a_cancelled_check_holds(self):
        old, sha = self.candidate("bin/tool.py")
        self.set_gh(checks={sha: [dict(GREEN[0], conclusion="cancelled"), GREEN[1]]})
        with self.assertRaises(state.Refused) as e:
            gate.main_checks(self.p, self.wt, sha, old)
        self.assertIn("check failed: cancelled", e.exception.why)


class Workflows(unittest.TestCase):
    """What the gates read from the workflows, pinned: a change upstream (or ours) breaks these first."""

    def read(self, name):
        with open(os.path.join(ROOT, ".github", "workflows", name)) as f:
            return f.read()

    def test_upstreams_push_trigger_and_job_name(self):
        text = self.read("check.yml")
        self.assertEqual(gate.push_paths_ignore(text), ["**/*.md", "docs/**"])
        self.assertRegex(text, r"(?m)^  check:\n    name: check$")

    def test_our_fork_check_has_no_paths_ignore(self):
        text = self.read("fork-check.yml")
        self.assertEqual(gate.push_paths_ignore(text), [])
        self.assertRegex(text, r"(?m)^  fork-check:\n    name: fork-check$")

    def test_shapes_it_cant_read_expect_a_run(self):
        for text in ("on: push\n", "on:\n  pull_request:\n", "on:\n  push:\n    paths:\n      - 'x/**'\n",
                     "on:\n  push: {branches: [main]}\n", ""):
            with self.subTest(text):
                self.assertIsNone(gate.push_paths_ignore(text))
        self.assertEqual(gate.push_paths_ignore("on:\n  push:\n    paths-ignore: ['a/**', \"*.txt\"]\n"),
                         ["a/**", "*.txt"])

    def test_globs(self):
        pats = ["**/*.md", "docs/**"]
        for path, want in (("README.md", True), ("fork/specs/x.md", True), ("docs/a/b.py", True),
                           ("bin/shepherdr", False), ("docs.md", True), ("web/docs/x.ts", False), ("a.mdx", False)):
            with self.subTest(path):
                self.assertEqual(gate.ignored(path, pats), want)
        self.assertIsNone(gate.ignored("x", ["!docs/**"]))


if __name__ == "__main__":
    unittest.main()
