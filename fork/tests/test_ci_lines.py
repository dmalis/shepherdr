"""CI's lines after an install of ours (fork/sync/merged.py): one GitHub call per read, each install's wait counted
from its own install time, a later commit's pass covering every install before it, and words that name the fixes
by title, never a hash, with the recovery point as it is when the words are final. Feedback reports 771d291875,
78406c8a1f and 59f0250639. gh is a fake (syncworld): nothing here reaches GitHub."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)
import time  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

import syncworld  # noqa: E402
from sync import merged, state  # noqa: E402

GREEN = syncworld.GREEN
RED = [{"name": "check", "status": "completed", "conclusion": "failure"},
       {"name": "fork-check", "status": "completed", "conclusion": "success"}]
CANCELLED = [{"name": "check", "status": "completed", "conclusion": "cancelled"},
             {"name": "fork-check", "status": "completed", "conclusion": "success"}]
RUNNING = [{"name": "check", "status": "in_progress", "conclusion": None},
           {"name": "fork-check", "status": "completed", "conclusion": "success"}]


class CiLines(syncworld.World):
    def merges(self, n):
        shas = []
        for i in range(n):
            syncworld.git(self.ours, "pull", "-q", "--no-rebase", "origin", "main")
            self.write(self.ours, "b.txt", f"b{i}\n")
            shas.append(self.commit(self.ours, f"Fix {i}: a plain title (#{100 + i})"))
            syncworld.git(self.ours, "push", "-q", "origin", "main")
        syncworld.git(self.wt, "fetch", "-q", "origin")
        return shas

    def install(self, sha, ago_s, tag, run=None, titles=None, since=None):
        with state.locked(self.p) as st:
            st["run"] = {"key": run or self.RUN, "folder": self.space, "path": "install-merged",
                         "start": self.start, "at": state.stamp()}
            st["phase"] = "healthy"
            st["installs"] = (st.get("installs") or []) + [
                {"sha": sha, "version": "3.2.21", "at": state.stamp(time.time() - ago_s), "tag": tag,
                 "run": run or self.RUN, "path": "install-merged"}]
            merged.track(st, sha, "3.2.21", tag, run or self.RUN,
                         titles if titles is not None else merged.install_titles(self.wt, sha, since))
            st["ci"][sha]["installed"] = state.stamp(time.time() - ago_s)

    def read(self):
        """One ci read in this process, its gh the fake (never GitHub's)."""
        with mock.patch.dict(os.environ, self.env(), clear=True):
            return merged.ci_read(self.p, self.wt)

    def finish_then_ci(self):
        code, out = self.sync("finish", "--says", "The button works", paths_ok=True)
        self.assertEqual((code, out.get("next")), (0, "ci"), out)
        return self.sync("ci", paths_ok=True)

    def api_calls(self, since=0):
        return [c for c in self.gh_calls()[since:] if c[:1] == ["api"]]

    def test_one_read_is_one_call_however_many_installs_wait(self):
        shas = self.merges(15)
        for k, s in enumerate(shas[2::3]):
            self.install(s, 600 - 60 * k, f"ours-3.2.21-{k + 1}")
        checks = {s: CANCELLED for s in shas}
        checks[shas[-1]] = RUNNING
        self.set_gh(checks=checks)
        code, out = self.sync("finish", "--says", "The button works", paths_ok=True)
        n = len(self.gh_calls())
        code, out = self.sync("ci", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (1, "wait"), out)
        calls = self.api_calls(n)
        self.assertEqual(len(calls), 1, calls)
        self.assertTrue(calls[0][1].startswith("repos/dmalis/shepherdr/actions/runs?branch=main"), calls)

    def test_a_later_commits_pass_covers_every_install_before_it(self):
        a, b, c = self.merges(3)
        self.install(a, 900, "ours-3.2.21-1")
        self.install(b, 600, "ours-3.2.21-2")
        self.set_gh(checks={a: CANCELLED, b: CANCELLED, c: GREEN})
        code, out = self.finish_then_ci()
        self.assertEqual((code, out["ci"]), (0, {a: "green", b: "green"}), out)
        self.assertEqual(out["told"], "The button works")
        self.assertEqual(self.st()["recovery"]["tag"], "ours-3.2.21-2")

    def test_the_wait_counts_from_the_install_not_from_an_older_one(self):
        """Report 771d291875: an install five minutes old, GitHub busy on an older commit: `ci` keeps waiting
        and says nothing about 30 minutes."""
        old, new = self.merges(2)
        self.install(old, 3 * 3600, "ours-3.2.21-1", run="SYNC-0")
        with state.locked(self.p) as st:
            st["ci"][old].update(verdict="missed", told=True)
        self.install(new, 300, "ours-3.2.21-2")
        self.set_gh(checks={old: RUNNING, new: [{"name": "check", "status": "queued", "conclusion": None},
                                               {"name": "fork-check", "status": "queued", "conclusion": None}]})
        code, out = self.finish_then_ci()
        self.assertEqual((code, out["outcome"]), (1, "wait"), out)
        self.assertNotIn("minutes", out["why"])

    def test_a_check_still_running_keeps_the_wait_past_half_an_hour(self):
        (a,) = self.merges(1)
        self.install(a, merged.CI_WAIT_S + 60, "ours-3.2.21-1")
        self.set_gh(checks={a: RUNNING})
        code, out = self.finish_then_ci()
        self.assertEqual((code, out["outcome"]), (1, "wait"), "a check that covers it still runs")

    def test_github_busy_on_an_older_commit_keeps_the_wait(self):
        """Review: only an older commit's run is active and the install's own hasn't started: still waiting at 31
        minutes, since its own run waits in line behind the older one."""
        old, new = self.merges(2)
        self.install(new, merged.CI_WAIT_S + 60, "ours-3.2.21-1")
        self.set_gh(checks={old: RUNNING})
        code, out = self.finish_then_ci()
        self.assertEqual((code, out["outcome"]), (1, "wait"), out)

    def test_a_run_still_going_is_never_missed(self):
        (a,) = self.merges(1)
        self.install(a, merged.CI_MISSED_AFTER_S + 60, "ours-3.2.21-1")
        self.set_gh(checks={a: RUNNING})
        self.read()
        self.assertEqual(self.st()["ci"][a]["verdict"], "pending")

    def test_runs_that_cant_be_read_are_never_missed(self):
        (a,) = self.merges(1)
        self.install(a, merged.CI_MISSED_AFTER_S + 60, "ours-3.2.21-1")
        self.set_gh(checks={a: GREEN}, checks_unread=True)
        self.read()
        self.assertEqual(self.st()["ci"][a]["verdict"], "pending")

    def test_a_pass_after_a_missing_verdict_still_moves_the_recovery_point(self):
        (a,) = self.merges(1)
        self.install(a, merged.CI_MISSED_AFTER_S + 60, "ours-3.2.21-1")
        with state.locked(self.p) as st:
            st["ci"][a].update(verdict="missed", told=True)
        self.set_gh(checks={a: GREEN})
        self.read()
        st = self.st()
        self.assertEqual((st["ci"][a]["verdict"], (st.get("recovery") or {}).get("tag")), ("green", "ours-3.2.21-1"), st.get("ci"))

    def test_past_the_wait_the_words_say_checks_havent_finished_by_title(self):
        (a,) = self.merges(1)
        self.install(a, merged.CI_BUSY_S + 60, "ours-3.2.21-1")
        self.set_gh(checks={a: RUNNING})
        code, out = self.finish_then_ci()
        self.assertEqual(code, 0, out)
        self.assertEqual(out["told"], "The button works GitHub's checks on main haven't finished for the install of "
                                      "“Fix 0: a plain title” yet: a later install tells you if they fail.")

    def test_a_red_result_names_the_fix_by_title_never_a_hash(self):
        a, b = self.merges(2)
        self.install(b, 600, "ours-3.2.21-1", since=self.main0)
        self.set_gh(checks={a: GREEN, b: RED})
        code, out = self.finish_then_ci()
        self.assertEqual(code, 0, out)
        told = out["told"]
        self.assertIn("CI on main failed after the install of “Fix 1: a plain title”, “Fix 0: a plain title”: "
                      "GitHub's Check failed on “Fix 1: a plain title”. Nothing was rolled back", told)
        for sha in (a, b, self.main0):
            self.assertNotIn(sha[:7], told)
        self.assertNotIn("(#10", told, "titles without their pull request's number")

    def test_missing_verdicts_are_one_sentence_told_once(self):
        """Report 78406c8a1f: an old install's missing verdict is said once, then never again."""
        a, b = self.merges(2)
        self.install(a, merged.CI_MISSED_AFTER_S + 300, "ours-3.2.21-1")
        self.install(b, merged.CI_MISSED_AFTER_S + 60, "ours-3.2.21-2")
        self.set_gh(checks={"*": []})
        code, out = self.finish_then_ci()
        self.assertEqual(out["told"].count("never gave a verdict"), 1, out["told"])
        with state.locked(self.p) as st:
            state.take_lease(st, "SYNC-2", self.space, owner=lambda *a: "done")
            st["run"] = {"key": "SYNC-2", "folder": self.space, "path": "nothing", "start": self.start}
        code, out = self.sync("finish", run="SYNC-2", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "nothing"), out)
        self.assertNotIn("told", out)

    def test_the_recovery_point_is_the_one_ci_just_found(self):
        """Report 59f0250639: finish tells an older install's red while this run's install waits; `ci` then finds
        this one green: the words name its tag, not the older one."""
        a, b = self.merges(2)
        self.install(self.main0, 7200, "ours-3.2.21-1", run="SYNC-0")
        with state.locked(self.p) as st:
            st["ci"][self.main0]["verdict"] = "green"
            st["recovery"] = merged.recovery(st)
        self.install(a, 3000, "ours-3.2.21-2", run="SYNC-0")
        with state.locked(self.p) as st:
            st["ci"][a].update(verdict="red", names={"check": {"state": "red", "by": a, "title": "Fix 0"}})
        self.install(b, 300, "ours-3.2.21-3")
        self.set_gh(checks={b: GREEN})
        code, out = self.finish_then_ci()
        self.assertEqual((code, out["ci"]), (0, {b: "green"}), out)
        self.assertTrue(out["told"].endswith("The last install CI passed is ours-3.2.21-3."), out["told"])
        self.assertNotIn("ours-3.2.21-1", out["told"])
        self.assertEqual(out["told"].count("The last install CI passed"), 1)


if __name__ == "__main__":
    unittest.main()
