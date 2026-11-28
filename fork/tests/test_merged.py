"""Installing our own merges (fork/sync/merged.py; fork/specs/sync-pipeline.md, build task 9): settle's paths, the
pending merges and finish's `again`, our merges' own install policy (no trial, no wait on main's checks; the rehearsal
gate kept), the quarantine by shipped files, CI's verdict after the install and its words told once, and the skip
list pinned against the installer's own shipped files."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import http.server  # noqa: E402
import importlib.machinery  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import io  # noqa: E402
import contextlib  # noqa: E402
import tempfile  # noqa: E402
import subprocess  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
import types  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import installworld  # noqa: E402
import syncworld  # noqa: E402
from sync import gate, install, merged, state  # noqa: E402
from sync.state import Refused  # noqa: E402

GREEN = syncworld.GREEN
RED = [{"name": "check", "status": "completed", "conclusion": "failure"},
       {"name": "fork-check", "status": "completed", "conclusion": "success"}]
CANCELLED = [{"name": "check", "status": "completed", "conclusion": "cancelled"},
             {"name": "fork-check", "status": "completed", "conclusion": "cancelled"}]


class SkipList(unittest.TestCase):
    """The paths that install nothing, pinned against what the installer really ships: a new shipped folder that
    the list would skip breaks this test, not an install."""

    def installer(self):
        loader = importlib.machinery.SourceFileLoader("shepherdr_installer", os.path.join(ROOT, "bin", "shepherdr"))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        mod = importlib.util.module_from_spec(spec)
        loader.exec_module(mod)
        return mod

    def test_nothing_the_installer_ships_is_skipped(self):
        mod = self.installer()
        scratch = tempfile.mkdtemp(prefix="fork-skip-")
        self.addCleanup(shutil.rmtree, scratch, True)
        items = mod.source_items(ROOT, scratch)
        shipped = sorted({os.path.relpath(src, ROOT) for _, _, src in items})
        self.assertGreater(len(shipped), 50, "the installer's list was read")
        self.assertEqual([f for f in shipped if merged.installs_nothing(f)], [])

    def test_the_list(self):
        for path in ("fork/sync/state.py", "docs/develop.md", ".agents/skills/x/SKILL.md", ".claude/settings.json",
                     ".github/workflows/check.yml", "test/test_install.py", "README.md", "CHANGELOG.md"):
            self.assertTrue(merged.installs_nothing(path), path)
        for path in ("bin/shepherdr", "service/main.ts", "web/src/app.tsx", "mods/tasks/bin/herdr_task/cli.py",
                     "mods/artifacts/ARTIFACTS.md", "package.json", "install.sh", "templates/worker.md", "LICENSE"):
            self.assertFalse(merged.installs_nothing(path), path)


class Pending(unittest.TestCase):
    def test_a_pin_clears_only_what_came_before_it(self):
        st = state.fresh()
        merged.record_pending(st, "Fix the  button", now=10.0)
        merged.record_pending(st, "Fix the button", now=11.0)
        self.assertEqual(st["pending"]["titles"], ["Fix the button"], "one title, kept once")
        self.assertEqual(merged.clear_pending(st, 11_000), [], "recorded at the pin: the next round's")
        self.assertEqual(merged.clear_pending(st, 11_001), ["Fix the button"])
        self.assertIsNone(st["pending"])

    def test_it_keeps_the_newest_titles(self):
        st = state.fresh()
        for n in range(merged.PENDING_KEEP + 5):
            merged.record_pending(st, f"t{n}", now=float(n))
        self.assertEqual(len(st["pending"]["titles"]), merged.PENDING_KEEP)
        self.assertEqual(st["pending"]["titles"][-1], f"t{merged.PENDING_KEEP + 4}")

    def test_main_holds_ask_no_24_hour_question(self):
        rec = {"blocker": "main-hooks", "kind": "hooks", "first_seen": "2020-01-01T00:00:00Z"}
        self.assertFalse(state.question_due(rec))

    def test_a_title_that_mustnt_go_public_is_kept_as_a_merged_task(self):
        st = state.fresh()
        merged.record_pending(st, "Fix /home/someone/notes")
        self.assertEqual(st["pending"]["titles"], ["a merged task"])

    def test_every_unresolved_install_of_ours_is_read_however_many_came_after(self):
        st = state.fresh()
        shas = [f"{n:040x}" for n in range(1, 16)]
        st["installs"] = [{"sha": x, "path": "install-merged"} for x in shas] + [{"sha": "f" * 40, "path": "take"}]
        st["ci"] = {x: {"verdict": "green"} for x in shas[1:]}
        st["ci"][shas[3]] = {"verdict": "pending"}
        self.assertEqual(merged.ci_unresolved(st), [shas[0], shas[3]], "the oldest is never dropped")

    def test_a_pending_install_outlives_the_installs_history(self):
        st = state.fresh()
        shas = [f"{n:040x}" for n in range(1, state.KEEP + 12)]
        for n, x in enumerate(shas):
            merged.track(st, x, "3.2.21", f"ours-3.2.21-{n}", "SYNC-1")
            st["ci"][x]["installed"] = f"2026-01-01T00:{n // 60:02d}:{n % 60:02d}Z"
            st["installs"] = ((st.get("installs") or []) + [{"sha": x, "path": "install-merged", "run": "SYNC-1"}])[
                -state.KEEP:]
        self.assertNotIn(shas[0], [i["sha"] for i in st["installs"]], "the history moved on")
        self.assertEqual(merged.ci_unresolved(st)[0], shas[0], "its CI is still read")
        self.assertEqual(merged.run_installs(st, "SYNC-1")[0], shas[0], "and its run still waits for it")


class Settle(syncworld.World):
    """settle in the sync world: the fork's main is v3.2.21 plus our patch (a.txt changed, a shipped file)."""

    def settle(self, **kw):
        return merged.settle(self.p, self.RUN, self.space, self.wt, **kw)

    def test_main_installed_is_nothing(self):
        self.edit(baseline={"sha": self.main0})
        out = self.settle()
        self.assertEqual((out["path"], out["why"]), ("nothing", "main is installed"))
        st = self.st()
        self.assertIsNone(st["phase"])
        self.assertEqual(st["run"]["path"], "nothing")

    def test_a_shipped_change_is_settled_for_install(self):
        code, out = self.sync("settle")
        self.assertEqual(code, 0, out)
        self.assertEqual((out["path"], out["candidate"]), ("install-merged", self.main0))
        self.assertEqual(out["release"]["tag"], "v3.2.21")
        self.assertTrue(out["rehearse"], "no rehearsal recorded for this pipeline code yet")
        st = self.st()
        self.assertEqual((st["phase"], st["candidate"], st["run"]["path"]), ("settled", self.main0, "install-merged"))
        self.assertEqual(install.policy(st, self.RUN), "ours")
        self.assertEqual(install.policy(st, "SYNC-9"), None, "another run's state is no policy")

    def test_only_paths_that_install_nothing_are_skipped(self):
        self.edit(baseline={"sha": self.main0})
        self.our_merge("fork/more.py")
        self.our_merge("docs/new.md", "new\n")
        tip = self.our_merge("NOTES.md", "notes\n")
        out = self.settle()
        self.assertEqual(out["path"], "skip")
        self.assertEqual(out["main"], tip)
        st = self.st()
        self.assertIsNone(st["phase"])
        self.assertEqual(st["baseline"]["sha"], self.main0, "the baseline stays")

    def test_a_quarantined_tip_and_a_docs_merge_on_top_stay_out(self):
        with state.locked(self.p) as st:
            state.quarantine(st, self.main0, "health (web)")
        self.assertEqual(self.settle()["path"], "nothing")
        self.our_merge("docs/why.md", "why\n")
        out = self.settle()
        self.assertEqual(out["path"], "nothing")
        self.assertEqual(out["quarantined"], self.main0)
        self.assertIn("ships the same files", out["why"])
        fix = self.our_merge("a.txt", "one, fixed\n")
        out = self.settle()
        self.assertEqual((out["path"], out["candidate"]), ("install-merged", fix), "a shipped change clears it")

    def test_a_tip_held_already_is_nothing(self):
        with state.locked(self.p) as st:
            state.hold(st, "v3.2.21", self.v21, "hooks", "main-hooks", "the update would write hooks",
                       head=self.main0)
        out = self.settle()
        self.assertEqual(out["path"], "nothing")
        self.assertIn("held already", out["why"])

    def test_a_settled_run_that_stopped_settles_again(self):
        self.assertEqual(self.settle()["path"], "install-merged")
        tip = self.our_merge("b.txt", "b, later\n")
        out = self.settle()
        self.assertEqual((out["path"], out["candidate"]), ("install-merged", tip), "the newer tip, pinned again")
        self.assertNotIn("rounds", self.st()["run"], "nothing ended: no round")

    def test_a_resumed_settle_that_finds_nothing_goes_back_to_where_it_settled_from(self):
        self.edit(phase="healthy")
        self.assertEqual(self.settle()["path"], "install-merged")
        self.edit(baseline={"sha": self.main0})      # main came back to what's installed
        out = self.settle()
        self.assertEqual(out["path"], "nothing")
        st = self.st()
        self.assertEqual((st["phase"], st["candidate"]), ("healthy", None), "no unfinished settled phase left")
        code, out = self.sync("finish", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "nothing"), out)
        self.assertIsNone(self.st()["lease"])

    def test_no_baseline_stops(self):
        self.edit(baseline=None)
        with self.assertRaises(Refused) as e:
            self.settle()
        self.assertEqual(e.exception.fields["outcome"], "stop")

    def test_a_moving_phase_stops(self):
        self.edit(phase="installing")
        with self.assertRaises(Refused) as e:
            self.settle()
        self.assertEqual(e.exception.fields["outcome"], "stop")

    def preflight(self, run, *args):
        """fork/bin/sync preflight in-process, its repo check stood in (the world's origin URL is rewritten by
        insteadOf) and this machine as the config's: (exit code, its JSON line)."""
        loader = importlib.machinery.SourceFileLoader("fork_sync_cli", syncworld.SYNC)
        spec = importlib.util.spec_from_loader(loader.name, loader)
        cli = importlib.util.module_from_spec(spec)
        loader.exec_module(cli)
        out = io.StringIO()
        with mock.patch.object(cli, "check_repo", lambda folder: None), \
                mock.patch.object(state, "check_machine", lambda *a, **k: None), \
                mock.patch.dict(os.environ, self.env()), contextlib.redirect_stdout(out):
            code = cli.main(["preflight", "--run", run, "--folder", self.space, "--repo", self.wt, "--root", self.root,
                             *args])
        return code, json.loads(out.getvalue())

    def test_a_broken_pipeline_keeps_the_merge_pending(self):
        self.edit(phase="broken")
        code, out = self.preflight("SYNC-2", "--pending", "Fix the button")
        self.assertEqual((code, out["outcome"], out["pending"]), (1, "broken", True))
        self.assertEqual(self.st()["pending"]["titles"], ["Fix the button"])

    def test_a_takeover_keeps_its_own_merge_pending(self):
        self.edit(phase="installed", candidate=self.main0, baseline={"sha": self.v21})
        self.set_ht({self.RUN: {"state": "done"}, "SYNC-2": {"state": "running"}})
        code, out = self.preflight("SYNC-2", "--pending", "Fix the button")
        self.assertEqual(code, 0, out)
        self.assertTrue(out["took_over"])
        self.assertEqual((out["resume"], out["pending"]), ("installed", True), "it resumes the old candidate")
        self.assertEqual(self.st()["pending"]["titles"], ["Fix the button"], "so its own merge waits after it")

    def test_a_merge_while_the_lease_is_taken_waits_in_pending_then_the_owner_goes_again(self):
        self.edit(baseline={"sha": self.main0})
        self.set_ht({self.RUN: {"state": "running"}, "SYNC-2": {"state": "running"}})
        tip = self.our_merge("b.txt", "b, more\n")
        code, out = self.preflight("SYNC-2", "--pending", "Fix the button")
        self.assertEqual((code, out["outcome"], out["pending"]), (1, "nothing", True))
        self.assertEqual(self.st()["pending"]["titles"], ["Fix the button"])
        code, out = self.preflight("SYNC-3")
        self.assertEqual((code, out["outcome"]), (1, "nothing"))
        self.assertNotIn("pending", out, "a release sync's preflight records nothing")
        # the owner's settle, pinned after that merge was recorded, takes it with main's tip
        time.sleep(0.01)
        out = self.settle()
        self.assertEqual((out["path"], out["candidate"]), ("install-merged", tip))
        self.assertEqual(out["pending_cleared"], ["Fix the button"])
        self.assertIsNone(self.st()["pending"])

    def test_finish_wont_let_go_of_the_lease_while_merges_are_pending(self):
        self.edit(baseline={"sha": self.main0})
        self.assertEqual(self.settle()["path"], "nothing")
        with state.locked(self.p) as st:
            merged.record_pending(st, "Fix the button", now=time.time() + 5)   # after the pin
        code, out = self.sync("finish", paths_ok=True)
        self.assertEqual((code, out["outcome"], out["pending"]), (1, "again", ["Fix the button"]))
        self.assertEqual(self.st()["lease"]["run"], self.RUN, "the lease stays")
        out = self.settle(now=lambda: time.time() + 10)
        self.assertEqual(out["pending_cleared"], ["Fix the button"])
        code, out = self.sync("finish", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "nothing"), out)
        self.assertIsNone(self.st()["lease"])

    def test_a_run_that_installed_then_settled_again_tells_both_rounds(self):
        self.edit(baseline={"sha": self.v21})
        self.assertEqual(self.settle()["path"], "install-merged")
        # as install and health would leave it: healthy, the baseline moved, our install counted
        with state.locked(self.p) as st:
            state.set_phase(st, "installing")
            state.set_phase(st, "installed")
            state.set_phase(st, "healthy")
            st["baseline"] = {"sha": self.main0, "version": "3.2.21"}
        tip = self.our_merge("b.txt", "b, again\n")
        out = self.settle()
        self.assertEqual((out["path"], out["candidate"]), ("install-merged", tip))
        rounds = self.st()["run"]["rounds"]
        self.assertEqual([(r["path"], r["phase"]) for r in rounds], [("install-merged", "healthy")])
        # the second round's health fails: rolled back
        with state.locked(self.p) as st:
            state.set_phase(st, "installing")
            state.set_phase(st, "installed")
            state.set_phase(st, "rolling-back")
            state.set_phase(st, "rolled-back")
            state.quarantine(st, tip, "health (web)")
        code, out = self.sync("finish", "--says", "The button works", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "installed"), out)
        self.assertTrue(out["told"].startswith("The button works Rolled back: the install of " + tip[:12]), out)
        self.assertNotEqual(self.st()["issue_cursor"], self.st()["run"]["at"], "our merges never move the cursor")

    def test_select_leaves_out_main_holds(self):
        with state.locked(self.p) as st:
            state.hold(st, "v3.2.21", self.v21, "hooks", "main-hooks", "x", head=self.main0)
        code, out = self.sync("select")
        self.assertEqual(out["held"], [])


class CiVerdict(syncworld.World):
    """CI's verdict on an install: the newest finished run on that commit or a later one of main's line."""

    def line(self):
        a = self.our_merge("b.txt", "b1\n")
        b = self.our_merge("b.txt", "b2\n")
        git = syncworld.git
        git(self.wt, "fetch", "-q", "origin")
        return a, b

    def verdict(self, sha, runs):
        tip = syncworld.git(self.wt, "rev-parse", "origin/main")
        return merged.ci_verdict(self.wt, sha, tip, runs_of=lambda c: runs.get(c, []))

    def test_a_cancelled_run_is_covered_by_a_later_one(self):
        a, b = self.line()
        v, got = self.verdict(a, {a: CANCELLED, b: GREEN})
        self.assertEqual(v, "green")
        self.assertEqual(got["check"]["by"], b)

    def test_the_newest_finished_run_counts(self):
        a, b = self.line()
        self.assertEqual(self.verdict(a, {a: GREEN, b: RED})[0], "red")
        self.assertEqual(self.verdict(a, {a: RED})[0], "red")
        self.assertEqual(self.verdict(a, {a: CANCELLED})[0], "pending")
        running = [{"name": "check", "status": "in_progress"}, {"name": "fork-check", "status": "queued"}]
        self.assertEqual(self.verdict(a, {b: running, a: GREEN})[0], "green")

    def test_unreadable_is_pending(self):
        a, _ = self.line()
        tip = syncworld.git(self.wt, "rev-parse", "origin/main")
        self.assertEqual(merged.ci_verdict(self.wt, a, tip, runs_of=lambda c: None)[0], "pending")


class CiAfterInstall(syncworld.World):
    """CI after an install of ours, through finish and ci: told once per commit, nothing rolled back, the newest
    green install kept as the recovery point."""

    def installed(self, sha, at=None, run=None):
        with state.locked(self.p) as st:
            st["run"] = {"key": run or self.RUN, "folder": self.space, "path": "install-merged",
                         "start": self.start, "at": state.stamp()}
            st["phase"] = "healthy"
            st["installs"] = (st.get("installs") or []) + [
                {"sha": sha, "version": "3.2.21", "at": at or state.stamp(), "tag": "ours-3.2.21-1",
                 "run": run or self.RUN, "path": "install-merged"}]

    def test_finish_hands_over_to_ci_which_tells_a_red_result_once(self):
        self.installed(self.main0)
        self.set_gh(checks={"*": []})
        code, out = self.sync("finish", "--wait-ci", "--says", "The button works", paths_ok=True)
        self.assertEqual((code, out["next"], out["ci"]), (0, "ci", [self.main0]), out)
        self.assertNotIn("command", out)
        self.assertIsNone(self.st()["lease"], "the lease is let go while CI runs")
        self.set_gh(checks={self.main0: RED})
        code, out = self.sync("ci", paths_ok=True)
        self.assertEqual(code, 0, out)
        self.assertEqual(out["ci"], {self.main0: "red"})
        self.assertIn("The button works CI on main failed after the install of 3.2.21: GitHub's Check failed on "
                      "“our patch”. Nothing was rolled back: open a task to fix it.", out["told"])
        self.assertNotIn(self.main0[:7], out["told"], "no commit's hash in the person's words")
        self.assertIn("--told", out["command"])
        # told once: a later run's finish doesn't say it again
        with state.locked(self.p) as st:
            state.take_lease(st, "SYNC-2", self.space, owner=lambda *a: "done")
            st["run"] = {"key": "SYNC-2", "folder": self.space, "path": "nothing", "start": self.start}
        code, out = self.sync("finish", "--wait-ci", run="SYNC-2", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "nothing"), out)
        self.assertEqual(self.st()["phase"], "healthy", "no rollback on red CI")

    def test_green_ci_is_the_recovery_point(self):
        self.installed(self.main0)
        self.set_gh(checks={self.main0: GREEN})
        code, out = self.sync("finish", "--wait-ci", "--says", "The button works", paths_ok=True)
        self.assertEqual((code, out["outcome"], out["next"]), (0, "installed", "ci"), "finish reads no CI")
        code, out = self.sync("ci", paths_ok=True)
        self.assertEqual((code, out["ci"], out["told"]), (0, {self.main0: "green"}, "The button works"), out)
        self.assertEqual(self.st()["recovery"]["sha"], self.main0)
        self.assertEqual(self.st()["ci"][self.main0]["verdict"], "green")

    def test_a_result_that_comes_after_the_run_is_told_by_a_later_one(self):
        self.installed(self.main0, at=state.stamp(time.time() - merged.CI_WAIT_S - 60))
        self.set_gh(checks={"*": []})
        code, out = self.sync("finish", "--wait-ci", "--says", "The button works", paths_ok=True)
        code, out = self.sync("ci", paths_ok=True)
        self.assertEqual(code, 0, out)
        self.assertIn("GitHub's checks on main haven't finished for the install of 3.2.21 yet", out["told"])
        self.assertNotIn("minutes", out["told"], "no claim of how long it waited")
        self.set_gh(checks={self.main0: RED})
        with state.locked(self.p) as st:
            state.take_lease(st, "SYNC-2", self.space, owner=lambda *a: "done")
            st["run"] = {"key": "SYNC-2", "folder": self.space, "path": "nothing", "start": self.start}
        code, out = self.sync("finish", "--wait-ci", run="SYNC-2", paths_ok=True)
        self.assertEqual((code, out["next"], out["ci"]), (0, "ci", []), "nothing of its own to wait for")
        code, out = self.sync("ci", run="SYNC-2", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "reported"), out)
        self.assertIn("CI on main failed", out["told"])

    def test_no_run_ever_is_missed(self):
        self.installed(self.main0, at=state.stamp(time.time() - merged.CI_MISSED_AFTER_S - 60))
        self.set_gh(checks={"*": []})
        code, out = self.sync("finish", "--wait-ci", "--says", "The button works", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "installed"), out)
        code, out = self.sync("ci", paths_ok=True)
        self.assertIn("CI on main never gave a verdict on the install of 3.2.21 within 2 hours", out["told"])

    def test_ci_without_finish_stops(self):
        code, out = self.sync("ci", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (1, "stop"))

    def finish(self, run=None, **kw):
        return gate.finish(self.p, run or self.RUN, self.space, self.wt, cfg_hostname=None, **kw)

    def test_finish_reads_no_ci_while_it_holds_the_lease(self):
        self.installed(self.main0)
        with mock.patch.object(merged, "ci_read", side_effect=AssertionError("a CI read in finish")), \
                mock.patch.object(merged.release, "fetch_main", side_effect=AssertionError("a fetch in finish")):
            out = self.finish(says="The button works", wait_ci=True)
        self.assertEqual((out["next"], out["ci"]), ("ci", [self.main0]))

    def test_by_default_no_run_waits_on_ci(self):
        """#230: finish gives the completion command at once while CI hasn't answered; the install stays tracked, and
        a later run's glance (settle, select) reads it once, and a red or missing one waits for that run's finish words
        (nothing here can see that Shepherdr's main-red notice reached anyone)."""
        self.installed(self.main0)
        with mock.patch.object(merged, "ci_read", side_effect=AssertionError("a CI read in finish")):
            out = self.finish(says="The button works")
        self.assertEqual((out.get("next"), out["outcome"]), (None, "installed"))
        self.assertIn("ready SYNC-1", out["command"])
        with state.locked(self.p) as st:
            self.assertEqual(merged.ci_unresolved(st), [self.main0])
            self.assertNotIn(self.RUN, st.get("reports") or {})
        red = {"check": {"state": "red", "by": self.main0}}

        def read(p, repo, now=None, runs_of=None):
            with state.locked(p) as st:
                st.setdefault("ci", {})[self.main0] = {"verdict": "red", "names": red, "version": "3.2.21",
                                                       "tag": "ours-3.2.21-1", "told": False}
            return {}
        with mock.patch.object(merged, "ci_read", side_effect=read):
            merged.ci_glance(self.p, self.wt)
        with state.locked(self.p) as st:
            self.assertEqual([sha for sha, _ in merged.ci_untold(st, mark=False)], [self.main0])  # for finish to say
        with mock.patch.object(merged, "ci_read", side_effect=RuntimeError("GitHub is down")):
            self.assertIsNone(merged.ci_glance(self.p, self.wt))  # never stops the run

    def test_a_late_red_on_a_missing_one_is_still_told_in_words(self):
        """Shepherdr's main watch may have ended by then: the glance leaves it untold, for finish's words."""
        self.installed(self.main0)
        with state.locked(self.p) as st:
            st["ci"] = {self.main0: {"verdict": "missed", "names": {}, "version": "3.2.21", "tag": "ours-3.2.21-1",
                                     "told": True}}

        def read(p, repo, now=None, runs_of=None):
            with state.locked(p) as st:
                st["ci"][self.main0].update(verdict="red", told=False,
                                            names={"check": {"state": "red", "by": self.main0}})
            return {}
        with mock.patch.object(merged, "ci_read", side_effect=read), \
                mock.patch.object(merged, "late", return_value=[self.main0]):
            merged.ci_glance(self.p, self.wt)
        with state.locked(self.p) as st:
            self.assertEqual([sha for sha, _ in merged.ci_untold(st, mark=False)], [self.main0])

    def test_a_red_result_another_run_told_meanwhile_isnt_told_again(self):
        self.installed(self.main0)
        with state.locked(self.p) as st:
            st["ci"] = {self.main0: {"verdict": "red", "names": {"check": {"state": "red", "by": self.main0}},
                                     "version": "3.2.21", "tag": "ours-3.2.21-1", "told": False}}
        from sync import public
        real = public.problems

        def told_meanwhile(*a, **k):        # another run's `ci` marks it told between finish's two locks
            with state.locked(self.p) as st:
                merged.mark_told(st, [self.main0])
            return real(*a, **k)
        with mock.patch.object(public, "problems", side_effect=told_meanwhile):
            out = self.finish(says="The button works")
        self.assertEqual(out.get("told"), "The button works", "told once, by the other run")

    def red_on(self, shas, by, name="fork-check", told=False):
        """Installs of ours whose verdict one failed run on `by` decided (ci_verdict reads a later commit's run)."""
        with state.locked(self.p) as st:
            ci = st.setdefault("ci", {})
            for sha in shas:
                ci[sha] = {"verdict": "red", "names": {name: {"state": "red", "by": by},
                                                       "check": {"state": "green", "by": sha}},
                           "version": "3.2.22", "tag": "ours-3.2.22-1", "told": told, "installed": state.stamp()}

    def test_one_failure_over_five_installs_is_one_sentence(self):
        """The reported --told: five installs pending, their own checks green, one fork-check failure on a later
        merge decided all five. One sentence names the check and the commit it failed on."""
        shas = [c * 40 for c in "12345"]
        by = "c" * 40
        self.red_on(shas, by)
        with state.locked(self.p) as st:
            said = merged.ci_untold(st, mark=False)
        words = [w for _, w in said if w]
        self.assertEqual(words, ["CI on main failed after 5 installs of 3.2.22: the fork check failed. Nothing was "
                                 "rolled back: open a task to fix it."])
        self.assertEqual(sorted(s for s, _ in said), shas, "every install it covers is marked told with it")
        told, _ = merged.with_ci_words("The button works.", "installed", [w for _, w in said])
        self.assertEqual(told.count("CI on main failed"), 1)

    def test_a_failure_told_once_isnt_told_again_by_another_run(self):
        """Several runs open at once: the one that told the failure marks it; a later run's install that the same
        failed run decided says nothing more."""
        by = "c" * 40
        self.red_on(["1" * 40, "2" * 40], by)
        with state.locked(self.p) as st:
            first = merged.ci_untold(st, mark=True)
        self.assertEqual(len([w for _, w in first if w]), 1)
        self.red_on(["3" * 40], by)                                   # read later by another run's ci
        with state.locked(self.p) as st:
            again = merged.ci_untold(st, mark=False)
        self.assertEqual(again, [("3" * 40, None)])
        told, outcome = merged.with_ci_words(None, "nothing", [w for _, w in again])
        self.assertEqual((told, outcome), (None, "nothing"))
        # a new failure on another commit is told
        self.red_on(["4" * 40], "d" * 40)
        with state.locked(self.p) as st:
            self.assertEqual(len([w for _, w in merged.ci_untold(st) if w]), 1, "the new failure is told")

    def test_a_failure_shared_by_installs_with_other_failures_is_still_one_sentence(self):
        """A: check red on A and fork-check red on C; B: only fork-check red on C. fork-check on C is said once."""
        a, b, c = "a" * 40, "b" * 40, "c" * 40
        with state.locked(self.p) as st:
            st["ci"] = {
                a: {"verdict": "red", "version": "3.2.22", "installed": "2026-11-27T10:00:00Z", "told": False,
                    "names": {"check": {"state": "red", "by": a}, "fork-check": {"state": "red", "by": c}}},
                b: {"verdict": "red", "version": "3.2.22", "installed": "2026-11-27T10:05:00Z", "told": False,
                    "names": {"check": {"state": "green", "by": b}, "fork-check": {"state": "red", "by": c}}}}
            said = merged.ci_untold(st, mark=True)
            self.assertTrue(all(st["ci"][s]["told"] for s in (a, b)))
        text = " ".join(w for _, w in said if w)
        self.assertEqual(text.count("the fork check failed"), 1, text)
        self.assertEqual(text.count("GitHub's Check failed"), 1, text)
        self.assertIn("2 installs of 3.2.22", text)

    def test_the_words_carry_no_commit_hash(self):
        e, c = "e" * 40, "c" * 40
        with state.locked(self.p) as st:
            st["ci"] = {sha: {"verdict": "red", "version": "3.2.22", "installed": at, "told": False,
                              "names": {"fork-check": {"state": "red", "by": "f" * 40}}}
                        for sha, at in ((e, "2026-11-27T10:00:00Z"), (c, "2026-11-27T10:02:00Z"))}
            said = merged.ci_untold(st, mark=False)
        text = " ".join(w for _, w in said if w)
        self.assertNotIn("cccccc", text)
        self.assertNotIn("ffffff", text)

    def test_a_failure_told_meanwhile_by_another_install_drops_out_under_the_lock(self):
        by = "c" * 40
        self.red_on(["1" * 40, "2" * 40], by)
        with state.locked(self.p) as st:
            said = merged.ci_untold(st, mark=False)
        self.red_on(["9" * 40], by, told=True)                       # another run told it on its own install
        with state.locked(self.p) as st:
            kept = merged.still_untold(st, said)
        self.assertEqual([w for _, w in kept if w], [])


class OursInstall(installworld.World):
    """Our merges' own install policy on the toy install: phase settled, no trial, no main's checks."""

    def settled(self, sha=None, rehearsed=True):
        sha = sha or self.C
        with state.locked(self.p) as st:
            st.update(phase="settled", candidate=sha, release={"tag": "v3.2.21", "sha": self.B},
                      run={"key": self.RUN, "folder": self.space, "path": "install-merged", "start": self.B},
                      baseline={"sha": self.B, "version": "3.2.21"})
            if rehearsed:
                state.record_rehearsal(st, sha, install.pipeline_hash(self.wt, sha))

    def test_installs_without_a_trial_or_mains_checks(self):
        self.settled()
        self.set(plan=["ok"])
        st = self.st()
        self.assertEqual((st["trials"], st["checks"]), ([], []))
        self.install()
        out = self.health()
        self.assertEqual(out["outcome"], "installed")
        st = self.st()
        self.assertEqual(st["installs"][-1]["path"], "install-merged")
        self.assertEqual(st["installs"][-1]["run"], self.RUN)
        self.assertIsNone(st.get("recovery"), "only CI's pass makes ours a recovery point")
        self.assertEqual(st["ci"][self.C]["verdict"], "pending", "tracked for CI from its install")
        self.assertEqual([x["line"] for x in out["lines"]],
                         ["hooks", "record", "files", "web", "tasks", "assistants", "scheduler", "doctor"])

    def test_the_rehearsal_gate_stays(self):
        self.settled(rehearsed=False)
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual(e.exception.fields.get("gate"), "rehearsal")

    def test_a_release_sync_keeps_its_gates(self):
        self.settled()
        with state.locked(self.p) as st:
            st["phase"] = "tried"
            st["run"] = dict(st["run"], path="take")
        with mock.patch.object(install, "ensure_checks", return_value=None):
            with self.assertRaises(Refused) as e:
                self.install()
        self.assertEqual(e.exception.fields.get("gate"), "trial")

    def test_ours_only_from_settled(self):
        self.settled()
        with state.locked(self.p) as st:
            st["phase"] = "tried"
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual(e.exception.fields["outcome"], "stop")
        self.assertIn("settle", e.exception.why)

    def test_the_same_shipped_files_as_a_quarantined_commit_stay_out(self):
        self.put(self.dev, "docs/note.md", "note\n")
        git = installworld.git
        git(self.dev, "commit", "-q", "-m", "docs")
        git(self.dev, "push", "-q", "origin", "main")
        git(self.wt, "fetch", "-q", "origin")
        docs = git(self.dev, "rev-parse", "HEAD")
        self.settled(docs)
        with state.locked(self.p) as st:
            state.quarantine(st, self.C, "health (web)")
        with self.assertRaises(Refused) as e:
            self.install(docs)
        self.assertEqual(e.exception.fields.get("gate"), "quarantine")
        self.assertIn("ships the same files", e.exception.why)

    def test_a_release_sync_recovery_point(self):
        self.ready_to_install()
        self.set(plan=["ok"])
        self.install()
        self.health()
        self.assertEqual(self.st()["recovery"]["sha"], self.C)


class OwnCode(unittest.TestCase):
    def test_a_rehearsal_of_another_commits_code_refuses_at_once(self):
        repo = tempfile.mkdtemp(prefix="fork-own-")
        self.addCleanup(shutil.rmtree, repo, True)
        syncworld.git(repo, "init", "-q", "-b", "main")
        os.makedirs(os.path.join(repo, "fork", "sync"))
        with open(os.path.join(repo, "fork", "sync", "x.py"), "w") as f:
            f.write("# not this checkout's\n")
        syncworld.git(repo, "add", "-A")
        syncworld.git(repo, "commit", "-q", "-m", "x")
        sha = syncworld.git(repo, "rev-parse", "HEAD")
        r = subprocess.run([sys.executable, os.path.join(ROOT, "fork", "bin", "rehearse"), sha, "--repo", repo,
                            "--own-code", "--root", repo], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 1)
        self.assertTrue(r.stdout.startswith("FAIL: own-code:"), r.stdout)
        self.assertFalse(os.path.exists(os.path.join(repo, ".local")), "nothing rehearsed, nothing recorded")


class Page(unittest.TestCase):
    """health's live web line against a page of its own on 127.0.0.1: the service's id, then the built page."""

    def serve(self, page=b"<!doctype html><html><body>app</body></html>", status=200, sid="s1"):
        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.headers.get("Authorization") != "Bearer tok":
                    self.send_response(401)
                    self.end_headers()
                    return
                body = json.dumps({"id": sid}).encode() if self.path == "/api/health" else page
                self.send_response(200 if self.path == "/api/health" else status)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass
        srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        d = tempfile.mkdtemp(prefix="fork-page-")
        self.addCleanup(shutil.rmtree, d, True)
        with open(os.path.join(d, "service.json"), "w") as f:
            json.dump({"port": srv.server_address[1], "id": "s1"}, f)
        with open(os.path.join(d, "token"), "w") as f:
            f.write("tok\n")
        return d

    def check(self, d):
        s = types.SimpleNamespace(live=True, home="/h")
        with mock.patch.object(install, "probe", return_value={"dir": d}):
            return install.service_page(s)

    def test_the_built_page(self):
        self.assertIsNone(self.check(self.serve()))

    def test_the_isnt_built_page(self):
        self.assertIn("doesn't serve", self.check(self.serve(b"The web app isn't built: run bun run build.", 503)))

    def test_another_app(self):
        self.assertIn("another app", self.check(self.serve(sid="other")))


if __name__ == "__main__":
    unittest.main()
