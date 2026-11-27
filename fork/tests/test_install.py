"""Install, health and rollback (fork/sync/install.py; fork/specs/sync-pipeline.md, build task 4), with
`update-shepherdr` and `shepherdr doctor` faked on a throwaway root (installworld.py): the baseline, every check
before anything moves, every outcome row, resume from each phase, the hooks check, quarantine and the rehearsal
gate. Pins on what the pipeline reads from upstream: installed.json's keys, update-shepherdr's status JSON, and the
installed herdr-task's own names."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import json  # noqa: E402
import re  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from installworld import World, git, store_key  # noqa: E402
from sync import gate, install, public, state  # noqa: E402
from sync.state import Refused  # noqa: E402


class Baseline(World):
    def test_the_first_run_captures_what_is_installed(self):
        out = self.baseline(capture=True)
        self.assertTrue(out["captured"])
        b = self.st()["baseline"]
        self.assertEqual((b["sha"], b["branch"], b["version"], b["whole"]), (self.B, "main", "3.2.21", True))
        self.assertEqual(b["source"], self.p.show(os.path.realpath(self.folder)))
        # later runs prove it again, without --capture, and never rewrite it
        again = self.baseline()
        self.assertFalse(again["captured"])
        self.assertEqual(self.st()["baseline"]["captured"], b["captured"])

    def test_no_baseline_without_capture(self):
        with self.assertRaises(Refused) as e:
            self.baseline()
        self.assertEqual(e.exception.fields["outcome"], "stop")
        self.assertIsNone(self.st()["baseline"])

    def test_a_folder_that_moved_after_its_install_is_held(self):
        git(self.folder, "checkout", "-q", "--detach", self.C)       # VERSION 3.2.22, 3.2.21 installed
        with self.assertRaises(Refused) as e:
            self.baseline(capture=True)
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("held", "pipeline"))
        self.assertIn("moved after its last install", e.exception.why)
        self.assertIsNone(self.st()["baseline"])

    def test_another_source_a_dirty_folder_or_a_half_install_is_held(self):
        rec_path = os.path.join(self.share, "installed.json")
        with open(rec_path) as f:
            good = json.load(f)
        for change, words in ((lambda r: r.update(source="/elsewhere"), "another folder"),
                              (lambda r: r.update(root="/elsewhere"), "another root"),
                              (lambda r: r.update(whole=False), "isn't whole")):
            rec = dict(good)
            change(rec)
            with open(rec_path, "w") as f:
                json.dump(rec, f)
            with self.assertRaises(Refused) as e:
                self.baseline(capture=True)
            self.assertIn(words, e.exception.why)
        with open(rec_path, "w") as f:
            json.dump(good, f)
        with open(os.path.join(self.folder, "service", "main.ts"), "a") as f:
            f.write("// by hand\n")
        with self.assertRaises(Refused) as e:
            self.baseline(capture=True)
        self.assertIn("uncommitted", e.exception.why)
        self.assertIsNone(self.st()["baseline"])

    def test_someone_installed_by_hand_since_the_baseline(self):
        self.baseline(capture=True)
        # the person moved the folder to C and installed it themselves: whole, but not the baseline
        git(self.folder, "checkout", "-q", "--detach", self.C)
        __import__("installworld").fake_update(self.load_cfg())
        with self.assertRaises(Refused) as e:
            self.baseline()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("held", "pipeline"))
        self.assertIn("by hand", e.exception.why)
        self.assertEqual(self.st()["baseline"]["sha"], self.B)

    def test_not_while_the_folder_may_have_moved(self):
        self.edit_phase("installing")
        with self.assertRaises(Refused) as e:
            self.baseline(capture=True)
        self.assertEqual(e.exception.fields["outcome"], "stop")

    def test_another_machine_writes_nothing(self):
        with open(self.p.config) as f:
            c = json.load(f)
        c["hostname"] = "another-machine"
        with open(self.p.config, "w") as f:
            json.dump(c, f)
        with self.assertRaises(Refused) as e:
            self.baseline(capture=True)
        self.assertNotIn("another-machine", e.exception.why)
        self.assertIsNone(self.st()["baseline"])

    def edit_phase(self, phase):
        with state.locked(self.p) as st:
            st["phase"] = phase


class BeforeAnythingMoves(World):
    """Each check that fails stops with nothing changed: the folder at the baseline, no update asked, the phase and
    the installed files as they were."""

    def setUp(self):
        super().setUp()
        self.ready_to_install()

    def refused(self, live=True, **kw):
        before = (self.st(), self.head(), self.read_hooks())
        with self.assertRaises(Refused) as e:
            self.install(live=live, **kw)
        st, head, hooks = self.st(), self.head(), self.read_hooks()
        self.assertEqual((st["phase"], st["install"], head, hooks), (before[0]["phase"], None, self.B, before[2]))
        self.assertEqual(self.asks(), [], "no update asked")
        self.assertEqual(self.holds(), [None, None], "no sync hold written")
        return e.exception

    def test_a_sync_hold_that_cant_be_written(self):
        with open(os.path.join(self.root, ".herdr"), "w") as f:     # a file where the hold's folder goes
            f.write("x\n")
        e = self.refused()
        self.assertEqual((e.fields["outcome"], e.fields["kind"], e.fields["gate"]), ("held", "install", "hold"))

    def test_the_rehearsal_gate(self):
        with state.locked(self.p) as st:
            st["rehearsals"] = []
        e = self.refused()
        self.assertEqual((e.fields["outcome"], e.fields["gate"]), ("held", "rehearsal"))
        # a rehearsal of other pipeline code doesn't count: the candidate's own fork/bin and fork/sync
        other = self.new_candidate(pipeline=2)
        with state.locked(self.p) as st:
            state.record_rehearsal(st, other, install.pipeline_hash(self.wt, other))
        self.assertNotEqual(install.pipeline_hash(self.wt, other), install.pipeline_hash(self.wt, self.C))
        self.assertEqual(self.refused().fields["gate"], "rehearsal")

    def test_a_quarantined_candidate(self):
        with state.locked(self.p) as st:
            state.quarantine(st, self.C, "health (doctor)")
        e = self.refused()
        self.assertEqual(e.fields["gate"], "quarantine")
        self.assertIn("health (doctor)", e.why)

    def test_no_trial_on_the_candidates_tree(self):
        with state.locked(self.p) as st:
            st["trials"] = [{"sha": self.C, "tree": "f" * 40}]
        self.assertEqual(self.refused().fields["gate"], "trial")

    def test_the_trials_tree_counts_for_a_merge_commit_with_the_same_tree(self):
        # the trial ran on the sync PR's head; the merge commit has the same tree
        with state.locked(self.p) as st:
            st["trials"] = [{"sha": "e" * 40, "tree": git(self.wt, "rev-parse", f"{self.C}^{{tree}}")}]
        self.set(plan=["ok"])
        self.assertEqual(self.install()["update"], "ok")

    def test_the_release_must_be_an_ancestor(self):
        with state.locked(self.p) as st:
            st["release"] = {"tag": "v9.9.9", "sha": "d" * 40}
        e = self.refused()
        self.assertEqual(e.fields["gate"], "ancestry")
        self.assertEqual(e.why, f"{'d' * 40} is not an ancestor of {self.C}")

    def test_mains_checks_must_have_passed(self):
        with state.locked(self.p) as st:
            st["checks"] = []
        with mock.patch.object(gate, "main_checks", return_value=("wait", {"fork-check": "running"})) as mc:
            e = self.refused()
        self.assertEqual(e.fields["outcome"], "wait")
        self.assertEqual(mc.call_args[0][2:4], (self.C, self.B), "the push is what its first parent didn't have")
        with mock.patch.object(gate, "main_checks", side_effect=Refused("x", outcome="held", kind="gate")):
            self.assertEqual(self.refused().fields["kind"], "gate")

    def test_a_hook_the_update_would_add_holds(self):
        c2 = self.new_candidate(hook_script="session-note-2.sh")
        self.ready_to_install(c2)
        e = self.refused(sha=c2)
        self.assertEqual((e.fields["outcome"], e.fields["kind"]), ("held", "hooks"))
        self.assertEqual(sorted(e.fields["files"]), sorted(install.HOOK_FILES))
        self.assertNotIn("~/", e.why)

    def test_a_missing_hook_file_the_update_would_create_holds(self):
        os.remove(os.path.join(self.root, ".codex", "hooks.json"))
        e = self.refused()
        self.assertEqual((e.fields["kind"], e.fields["files"]), ("hooks", [".codex/hooks.json"]))
        self.assertFalse(os.path.exists(os.path.join(self.root, ".codex", "hooks.json")), "read only")

    def test_no_cli_folder_no_hook_file_needed(self):
        # Codex isn't installed here: its file isn't created, so nothing would be written
        shutil.rmtree(os.path.join(self.root, ".codex"))
        self.set(plan=["ok"])
        self.assertEqual(self.install()["update"], "ok")

    def test_an_older_tree_s_patch_list_still_counts(self):
        # a commit from before the list became one file per patch: its fork/patches.json names the hold patch
        c2 = self.new_candidate(patches="legacy")
        self.ready_to_install(c2)
        self.set(plan=["ok"])
        self.assertEqual(self.install(sha=c2)["update"], "ok")

    def test_the_hold_patch_must_be_carried(self):
        c2 = self.new_candidate(patches=False)
        self.ready_to_install(c2)
        self.assertEqual(self.refused(sha=c2).fields["gate"], "hold-patch")

    def test_the_installed_cli(self):
        link = os.path.join(self.root, ".local", "bin", "shepherdr")
        os.remove(link)
        elsewhere = os.path.join(self.tmp, "other-shepherdr")
        with open(elsewhere, "w") as f:
            f.write("#!/bin/sh\n")
        os.chmod(elsewhere, 0o755)
        os.symlink(elsewhere, link)
        self.assertEqual(self.refused().fields["gate"], "cli")
        self.assertEqual(self.refused(live=False).fields["gate"], "cli")

    def test_the_guards_shepherdr_is_skipped_as_the_runner_skips_it(self):
        # the guard's shepherdr is first on the run's PATH; clean_env takes its folder out
        self.assertEqual(install.installed_cli(install.site(self.p, True)),
                         os.path.realpath(os.path.join(self.share, "bin", "shepherdr")))

    def test_the_recorded_source(self):
        rec_path = os.path.join(self.share, "installed.json")
        with open(rec_path) as f:
            rec = json.load(f)
        rec["source"] = os.path.join(self.tmp, "another-checkout")
        with open(rec_path, "w") as f:
            json.dump(rec, f)
        self.assertEqual(self.refused().fields["gate"], "source")

    def test_a_dirty_folder_or_one_off_the_baseline(self):
        with open(os.path.join(self.folder, "install.sh"), "a") as f:
            f.write("# by hand\n")
        self.assertIn("uncommitted", self.refused().why)
        git(self.folder, "checkout", "-q", "--", "install.sh")
        git(self.folder, "checkout", "-q", "--detach", self.C)
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual(e.exception.fields["gate"], "folder")
        self.assertEqual(self.asks(), [])

    def test_no_update_permission_or_another_terminal(self):
        self.set(autos={"7": {"may_update": False}})
        e = self.refused()
        self.assertEqual((e.fields["outcome"], e.fields["kind"]), ("held", "permission"))
        self.set(autos={"7": {"may_update": True}})
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "OTHER-2"}):
            self.assertEqual(self.refused().fields["kind"], "permission")

    def test_the_terminal_check_uses_the_tasks_store_key(self):
        # herdr-task puts the store key, `<folder slug>#<id>`, in a task's terminal and `show --json` gives it as `key`
        # (self_update.py compares the same two); the short key alone never matches it (issue #24)
        long_key = store_key(self.RUN)
        self.assertEqual(install.task_json(self.RUN, self.space)["key"], long_key)
        self.assertIsNone(install.may_ask(self.RUN, self.space, {"HERDR_BROWSER_TASK": long_key}))
        why = install.may_ask(self.RUN, self.space, {"HERDR_BROWSER_TASK": self.RUN})
        self.assertIn("own terminal", why)
        self.assertIsNotNone(install.may_ask(self.RUN, self.space, {}))
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": self.RUN}):
            e = self.refused()
        self.assertEqual((e.fields["outcome"], e.fields["gate"]), ("held", "permission"))
        self.assertEqual(self.asks(), [], "a refused terminal asks nothing")
        self.assertEqual(self.head(), self.B, "nothing moved")

    def test_a_task_without_a_key_is_refused(self):
        for key in (None, ""):
            with self.subTest(key=key):
                self.set(tasks={self.RUN: {"state": "running", "automation": 7, "key": key}})
                why = install.may_ask(self.RUN, self.space, {"HERDR_BROWSER_TASK": store_key(self.RUN)})
                self.assertIn("key can't be read", why)
                self.assertEqual(self.refused().fields["gate"], "permission")
        self.set(tasks={})
        self.assertIn("can't be read", install.may_ask(self.RUN, self.space, {"HERDR_BROWSER_TASK": self.RUN}))
        self.assertEqual(self.asks(), [])

    def test_a_scratch_root_never_asks_herdr_task(self):
        # its runner would update this home's Shepherdr: without its own updater, a scratch root stops
        with mock.patch.dict(os.environ):
            del os.environ["FORK_SYNC_SCRATCH_UPDATER"]
            e = self.refused(live=False)
        self.assertEqual((e.fields["outcome"], e.fields["gate"]), ("held", "updater"))
        self.assertEqual(self.calls("herdr-task"), [], "herdr-task isn't called at all")

    def test_the_assistants_must_be_readable(self):
        self.set(assistants="not a list")
        self.assertEqual(self.refused().fields["gate"], "assistants")

    def test_the_phase_and_the_candidate(self):
        with self.assertRaises(Refused):
            self.install(sha=self.B)
        with state.locked(self.p) as st:
            st["phase"] = "selected"
        e = self.refused()
        self.assertEqual(e.fields["outcome"], "stop")

    def test_another_runs_lease(self):
        with self.assertRaises(Refused):
            install.install(self.p, "OTHER-2", self.space, self.wt, self.C)
        self.assertEqual(self.asks(), [])


class Outcomes(World):
    """Each outcome row, from install to the last word."""

    def setUp(self):
        super().setUp()
        self.ready_to_install()

    def test_installed(self):
        self.set(plan=["ok"])
        out = self.install()
        self.assertEqual(out["update"], "ok")
        st = self.st()
        self.assertEqual((st["phase"], self.head()), ("installed", self.C))
        self.assertEqual(st["install"]["before"]["assistants"], ["t1"], "this machine's Assistants")
        self.assertEqual(len(self.asks()), 1)
        out = self.health()
        self.assertEqual((out["outcome"], out["version"], out["tag"]), ("installed", "3.2.22", "ours-3.2.22-1"))
        self.assertEqual([x["line"] for x in out["lines"]],
                         ["hooks", "record", "files", "web", "tasks", "assistants", "scheduler", "doctor"])
        st = self.st()
        self.assertEqual(st["phase"], "healthy")
        self.assertEqual((st["baseline"]["sha"], st["baseline"]["version"]), (self.C, "3.2.22"))
        self.assertEqual(st["installs"][-1]["sha"], self.C)
        self.assertEqual(git(self.origin, "rev-parse", "refs/tags/ours-3.2.22-1"), self.C)
        doctor = self.calls("doctor")
        self.assertEqual(len(doctor), 1)
        self.assertIsNone(doctor[0][2], "doctor runs without the hold variable")
        # the run ends: finish says installed and lets go of the lease
        self.assertEqual(self.finish(says="3.2.22 with our patches")["outcome"], "installed")
        self.assertIsNone(self.st()["lease"])

    def test_a_healthy_install_ends_the_held_records_it_carries(self):
        """A held record whose release the healthy install carries is over (no 24-hour question about it later);
        one for a release it doesn't carry stays."""
        later = self.new_candidate("3.2.23")
        with state.locked(self.p) as st:
            state.hold(st, "v3.2.21", self.B, "trial", "trial", "the trial failed")
            state.hold(st, "v3.2.23", later, "draft", "7", "a patch waits", branch="sync/v3.2.23", head=later)
        self.set(plan=["ok"])
        self.install()
        out = self.health()
        self.assertEqual((out["outcome"], out["held_over"]), ("installed", ["trial"]))
        self.assertEqual([h["blocker"] for h in self.st()["held"]], ["7"])

    def test_the_runs_sync_hold(self):
        """The hold patch's other half (dmalis/shepherdr#19): the run's hold is in both files before the folder
        moves, for the install and again for the rollback; the update, and only it, carries the hold variable;
        doctor runs without it (and alone lets go: a fake here, the real one in test_hold_patch.py)."""
        self.set(plan=["failed", "ok"])
        real, seen = install.checkout, []

        def checkout(s, sha):
            seen.append((sha, self.holds()))
            return real(s, sha)
        line = install.HOLD_LINE + "\n"
        with mock.patch.object(install, "checkout", checkout):
            with self.assertRaises(Refused):
                self.install()
            with self.assertRaises(Refused):
                self.health()
            self.assertEqual(self.holds(), [line, line], "a failed health keeps it")
            for p in (os.path.join(self.root, ".herdr", "sync-hold"),
                      os.path.join(self.root, ".local", "state", "shepherdr", "sync-hold")):
                os.remove(p)                                        # gone meanwhile: the rollback holds again
            self.assertEqual(self.rollback()["outcome"], "rolled-back")
        self.assertEqual(seen, [(self.C, [line, line]), (self.B, [line, line])])
        asked = [(a["var"], a["holds"], a["head"]) for a in self.load_cfg()["asked_with"]]
        self.assertEqual(asked, [("1", [line, line], self.C), ("1", [line, line], self.B)])
        self.assertEqual(self.load_cfg().get("status_with_var", 0), 0, "status reads don't carry it")
        self.assertNotIn(install.HOLD_VAR, os.environ, "set on the ask's own environment only")
        self.assertEqual([c[2] for c in self.calls("doctor")], [None])

    def test_the_tag_counts_on(self):
        subprocess.run(["git", "-C", self.origin, "tag", "ours-3.2.22-1", self.B], check=True)
        self.set(plan=["ok"])
        self.install()
        self.assertEqual(self.health()["tag"], "ours-3.2.22-2")

    def test_rolled_back_after_a_failed_update(self):
        self.set(plan=["failed", "ok"])
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["next"]), ("failed", "health"))
        self.assertEqual(self.st()["phase"], "installed")
        with self.assertRaises(Refused) as e:
            self.health()
        self.assertEqual(e.exception.fields["outcome"], "rollback")
        self.assertEqual(self.calls("doctor"), [], "doctor never runs on an install another line failed")
        out = self.rollback()
        self.assertEqual(out["outcome"], "rolled-back")
        st = self.st()
        self.assertEqual((st["phase"], self.head(), st["baseline"]["sha"]), ("rolled-back", self.B, self.B))
        self.assertEqual(state.quarantined(st, self.C)["step"], "the update")
        self.assertEqual(len(self.asks()), 2, "a second update, from the same run")
        self.assertEqual(self.installed()["version"], "3.2.21")
        self.assertEqual(public.problems(out["report"]), [], out["report"])
        self.assertIn("3.2.22", out["report"])
        fin = self.finish()
        self.assertEqual(fin["outcome"], "rolled-back")
        self.assertIn("failed at the update", fin["told"])
        self.assertIsNone(self.st()["lease"])

    def test_a_half_landed_update_still_rolls_back(self):
        # the update said failed, but every health line holds: never the new baseline
        self.set(plan=["landed-failed", "ok"])
        with self.assertRaises(Refused):
            self.install()
        with self.assertRaises(Refused) as e:
            self.health()
        self.assertEqual(e.exception.fields["outcome"], "rollback")
        failed = [x for x in e.exception.fields["lines"] if not x["ok"]]
        self.assertEqual([x["line"] for x in failed], ["doctor"])
        self.assertEqual(self.calls("doctor"), [], "doctor (which lets go of the sync hold) never runs on it")
        self.assertEqual(self.rollback()["outcome"], "rolled-back")
        self.assertEqual(self.st()["baseline"]["sha"], self.B)
        self.assertEqual(len(self.calls("doctor")), 1, "only health on the baseline runs doctor")

    def test_a_tag_that_cant_be_pushed_is_retried_alone(self):
        self.set(plan=["ok"])
        self.install()
        with mock.patch.object(install, "push_tag", return_value=None):
            with self.assertRaises(Refused) as e:
                self.health()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["next"]), ("wait", "health"))
        st = self.st()
        self.assertEqual((st["phase"], st["install"]["passed"], st["baseline"]["sha"]), ("installed", True, self.B))
        with self.assertRaises(Refused):
            self.rollback()                    # a passed install isn't rolled back for its tag
        with self.assertRaises(Refused):
            self.finish(says="x")              # nor finished without it
        out = self.health()
        self.assertEqual((out["outcome"], out["tag"]), ("installed", "ours-3.2.22-1"))
        self.assertEqual(len(self.calls("doctor")), 1, "the lines don't run again")
        self.assertEqual(self.st()["baseline"]["sha"], self.C)

    def test_a_tag_already_on_the_commit_is_reused(self):
        # a push that landed but said it failed
        subprocess.run(["git", "-C", self.origin, "tag", "ours-3.2.22-1", self.C], check=True)
        self.set(plan=["ok"])
        self.install()
        self.assertEqual(self.health()["tag"], "ours-3.2.22-1")

    def test_rolled_back_when_doctor_fails(self):
        self.set(plan=["ok", "ok"], doctor_fails=True)
        self.install()
        with self.assertRaises(Refused) as e:
            self.health()
        self.assertIn("doctor", e.exception.why)
        self.set(doctor_fails=False)
        self.assertEqual(self.rollback()["outcome"], "rolled-back")
        self.assertEqual(state.quarantined(self.st(), self.C)["step"], "health (doctor)")
        # quarantined: the same SHA never installs again unchanged
        with state.locked(self.p) as st:
            st.update(phase="merged", install=None)
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual(e.exception.fields["gate"], "quarantine")

    def test_each_health_line_fails_into_a_rollback(self):
        cases = {
            "files": lambda: self.spoil(os.path.join(self.share, "service", "main.ts")),
            "assistants": lambda: self.set(assistants_after=[{"target": "t9", "route": ""}]),
            "scheduler": lambda: self.set(stale_scheduler=True),
            "record": lambda: self.set(not_whole=True),
            "web": lambda: os.remove(os.path.join(self.share, "web", "dist", "index.html")),
            "web ": lambda: self.set(page="the service doesn't serve the built web app"),
            "tasks": lambda: os.environ.update(FAKE_HT_BROKEN="1"),
        }
        for line, spoil in cases.items():
            with self.subTest(line):
                self.reset_world()
                self.set(plan=["ok", "ok"])
                if line in ("scheduler", "record"):
                    spoil()
                    self.install()
                else:
                    self.install()
                    spoil()
                with self.assertRaises(Refused) as e:
                    self.health()
                self.assertEqual(e.exception.fields["outcome"], "rollback")
                failed = [x for x in e.exception.fields["lines"] if not x["ok"]]
                self.assertEqual([x["line"] for x in failed], [line.strip()])
                self.set(stale_scheduler=False, not_whole=False, assistants_after=None, page=None)
                os.environ.pop("FAKE_HT_BROKEN", None)
                self.assertEqual(self.rollback()["outcome"], "rolled-back")

    def test_a_far_assistant_dropping_isnt_this_install(self):
        self.set(plan=["ok"], assistants_after=[{"target": "t1", "route": ""}])
        self.install()
        self.assertEqual(self.health()["outcome"], "installed")

    def test_a_scratch_root_skips_the_live_lines(self):
        self.set(plan=["ok"], stale_scheduler=True, assistants="not read")
        self.install(live=False)
        out = self.health(live=False)
        self.assertEqual([x["line"] for x in out["lines"]], ["hooks", "record", "files", "web", "tasks", "doctor"])
        self.assertIsNone(out["tag"], "no tag from a scratch root")
        self.assertEqual(self.calls("doctor")[0][1], ["doctor", "--root", os.path.realpath(self.root)])

    def test_unknown_update(self):
        # still running 40 minutes after it began (the runner stops one after 30)
        self.set(plan=["running"])
        with self.assertRaises(Refused) as e:
            self.install(now=lambda: time.time() + 39 * 60)
        self.assertEqual(e.exception.fields["outcome"], "wait")
        with self.assertRaises(Refused) as e:
            self.install(now=lambda: time.time() + 40 * 60)
        self.assertEqual(e.exception.fields["outcome"], "unknown")
        self.assertEqual(len(self.asks()), 1)
        st = self.st()
        self.assertEqual((st["phase"], st["lease"]["run"]), ("installing", self.RUN))
        fin = self.finish()
        self.assertEqual((fin["outcome"], fin["keeps_lease"]), ("unknown", True))
        self.assertTrue(fin["before"][0].startswith("herdr-task alert"))
        self.assertEqual(self.st()["lease"]["run"], self.RUN, "the lease is kept")
        # rollback won't start while the update may still run
        with self.assertRaises(Refused) as e:
            self.rollback()
        self.assertEqual(e.exception.fields["outcome"], "stop")

    def test_changed_hooks_are_the_persons_whatever_else_failed(self):
        self.set(plan=["landed-failed"], touch_hooks=True, not_whole=True)
        with self.assertRaises(Refused):
            self.install()
        with self.assertRaises(Refused) as e:
            self.health()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("unknown", "hooks"))
        self.assertEqual(self.st()["phase"], "broken")
        with self.assertRaises(Refused):
            self.rollback()
        self.assertEqual(self.head(), self.C, "nothing rolls back over it")

    def test_hook_files_changed_by_the_update(self):
        self.set(plan=["ok"], touch_hooks=True)
        self.install()
        with self.assertRaises(Refused) as e:
            self.health()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("unknown", "hooks"))
        self.assertIn("Claude Code's settings", e.exception.fields["alert"])
        st = self.st()
        self.assertEqual(st["phase"], "broken")
        self.assertTrue(state.quarantined(st, self.C))
        self.assertEqual(self.calls("doctor"), [], "doctor doesn't let the sync go")
        fin = self.finish()
        self.assertEqual(fin["outcome"], "unknown")
        self.assertIn("hook file changed", fin["told"])
        self.assertEqual(public.problems(fin["told"]), [])

    def test_rollback_failed(self):
        self.set(plan=["ok", "failed"], doctor_fails=True)
        self.install()
        with self.assertRaises(Refused):
            self.health()
        with self.assertRaises(Refused) as e:
            self.rollback()
        self.assertEqual(e.exception.fields["outcome"], "broken")
        st = self.st()
        self.assertEqual(st["phase"], "broken")
        self.assertTrue(state.quarantined(st, self.C) and state.quarantined(st, self.B), "both SHAs")
        self.assertEqual(st["lease"]["run"], self.RUN)
        self.assertEqual(self.finish()["outcome"], "unknown")
        # nothing installs until the person clears it
        with self.assertRaises(Refused):
            self.install()

    def test_health_on_the_baseline_fails(self):
        self.set(plan=["ok", "ok"], doctor_fails=True)
        self.install()
        with self.assertRaises(Refused):
            self.health()
        with self.assertRaises(Refused) as e:
            self.rollback()
        self.assertEqual(e.exception.fields["outcome"], "broken")
        self.assertIn("health on the baseline", e.exception.why)

    def test_someone_elses_change_stops_the_rollback_before_it_moves(self):
        self.set(plan=["failed"])
        with self.assertRaises(Refused):
            self.install()
        other = self.new_candidate("3.2.30")
        git(self.folder, "fetch", "-q", "fork", "main")
        git(self.folder, "checkout", "-q", "--detach", other)
        with self.assertRaises(Refused) as e:
            self.rollback()
        self.assertEqual(e.exception.fields["outcome"], "broken")
        self.assertEqual(self.head(), other, "nothing moved")
        self.assertEqual(len(self.asks()), 1)

    def test_the_rollbacks_ask_needs_the_runs_terminal(self):
        self.set(plan=["failed"])
        with self.assertRaises(Refused):
            self.install()
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": "OTHER-2"}):
            with self.assertRaises(Refused) as e:
                self.rollback()
        self.assertEqual(e.exception.fields["outcome"], "broken")
        self.assertEqual(self.head(), self.C, "nothing moved")

    # --- helpers ---
    def finish(self, says=None):
        with mock.patch.object(gate, "fetch_for_finish"), mock.patch.object(gate, "branch_problem"):
            return gate.finish(self.p, self.RUN, self.space, self.wt, says=says)

    def installed(self):
        with open(os.path.join(self.share, "installed.json")) as f:
            return json.load(f)

    def spoil(self, path):
        with open(path, "a") as f:
            f.write("// changed\n")

    def reset_world(self):
        """Back to B installed and the run ready to install C (for subTests)."""
        git(self.folder, "checkout", "-q", "--detach", self.B)
        self.set(plan=[], updates={}, stale_scheduler=False, not_whole=False, assistants_after=None)
        __import__("installworld").fake_update(self.load_cfg())
        with state.locked(self.p) as st:
            st.update(phase="merged", install=None, rollback=None, quarantine=[])


class Resume(World):
    """A run that dies is resumed by the next call, never repeated blindly."""

    def setUp(self):
        super().setUp()
        self.ready_to_install()

    def test_waiting_on_a_running_update_then_reading_it(self):
        self.set(plan=["running"])
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual(e.exception.fields["outcome"], "wait")
        self.assertEqual(self.st()["phase"], "installing")
        # the update ends meanwhile; install again reads it, never asking twice
        self.load_cfg()
        u = self.cfg["updates"][self.RUN]
        __import__("installworld").fake_update(self.cfg)
        u.update(state="ok", done_at=u["at"] + 1)
        self.save_cfg()
        self.assertEqual(self.install()["update"], "ok")
        self.assertEqual(len(self.asks()), 1)
        self.assertEqual(self.health()["outcome"], "installed")

    def test_a_run_that_died_after_its_ask_is_resumed_by_another(self):
        self.set(plan=["ok"])
        real = install.outcome
        with mock.patch.object(install, "outcome", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.install()
        self.assertEqual(self.st()["phase"], "installing")
        # the next run takes the lease over (the dead one is done) and resumes: reads the outcome, no second ask
        self.set(tasks={"SYNC-2": {"state": "running", "automation": 7}, self.RUN: {"state": "done"}})
        with state.locked(self.p) as st:
            state.take_lease(st, "SYNC-2", self.space, owner=lambda *a: "done")
            state.adopt_run(st, "SYNC-2", self.space)
        with mock.patch.dict(os.environ, {"HERDR_BROWSER_TASK": store_key("SYNC-2")}):
            out = install.install(self.p, "SYNC-2", self.space, self.wt, self.C)
            self.assertEqual(out["update"], "ok")
            self.assertEqual(len(self.asks()), 1)
            self.assertEqual(install.health(self.p, "SYNC-2", self.space, self.wt, self.C)["outcome"], "installed")
        self.assertIs(install.outcome, real)

    def test_a_run_that_died_before_its_ask(self):
        self.set(plan=["ok"])
        with mock.patch.object(install, "move_and_ask", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.install()
        st = self.st()
        self.assertEqual((st["phase"], st["install"]["ask"], self.head()), ("installing", None, self.B))
        line = install.HOLD_LINE + "\n"
        self.assertEqual(self.holds(), [line, line], "held before the phase said the folder may move")
        os.remove(os.path.join(self.root, ".herdr", "sync-hold"))
        self.assertEqual(self.install()["update"], "ok")
        self.assertEqual(len(self.asks()), 1)
        self.assertEqual(self.load_cfg()["asked_with"][0]["holds"], [line, line], "the resume holds again")

    def test_a_resume_before_the_ask_checks_the_folder_again(self):
        self.set(plan=["ok"])
        with mock.patch.object(install, "move_and_ask", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.install()
        # meanwhile the person edits the install folder: a checkout would carry the edit into the update
        with open(os.path.join(self.folder, "install.sh"), "a") as f:
            f.write("# by hand\n")
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["gate"]), ("unknown", "resume"))
        self.assertEqual((self.head(), self.asks()), (self.B, []), "nothing moved, nothing asked")
        # the schedule's permission taken away meanwhile: the same
        git(self.folder, "checkout", "-q", "--", "install.sh")
        self.set(autos={"7": {"may_update": False}})
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual(e.exception.fields["gate"], "resume")
        self.assertEqual(self.asks(), [])

    def test_a_resume_before_the_ask_checks_the_hooks_again(self):
        self.set(plan=["ok"])
        with mock.patch.object(install, "move_and_ask", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.install()
        # meanwhile the person takes Shepherdr's hook out of Codex: the update would put it back
        path = os.path.join(self.root, ".codex", "hooks.json")
        with open(path, "w") as f:
            f.write("{}\n")
        with self.assertRaises(Refused) as e:
            self.install()
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["gate"]), ("unknown", "resume"))
        self.assertIn("hook file", e.exception.why)
        self.assertEqual((self.head(), self.asks()), (self.B, []), "nothing moved, nothing asked")
        with open(path) as f:
            self.assertEqual(f.read(), "{}\n", "read only")

    def test_an_ask_recorded_but_never_made_reads_as_failed(self):
        self.set(plan=["ok", "ok"])
        with mock.patch.object(install, "ask_update"), mock.patch.object(install, "update_status",
                                                                            return_value={}):
            with self.assertRaises(Refused) as e:
                self.install()
        self.assertEqual(e.exception.fields["outcome"], "failed")
        with self.assertRaises(Refused):
            self.health()
        self.assertEqual(self.rollback()["outcome"], "rolled-back")

    def test_from_installed_health_runs(self):
        self.set(plan=["ok"])
        self.install()
        with self.assertRaises(Refused):
            self.install()          # the update already ended: health next
        self.assertEqual(self.health()["outcome"], "installed")

    def test_from_rolling_back(self):
        self.set(plan=["failed", "running"])
        with self.assertRaises(Refused):
            self.install()
        with self.assertRaises(Refused):
            self.health()
        with self.assertRaises(Refused) as e:
            self.rollback()
        self.assertEqual(e.exception.fields["outcome"], "wait")
        self.assertEqual((self.st()["phase"], self.head()), ("rolling-back", self.B))
        self.load_cfg()
        u = self.cfg["updates"][self.RUN]
        __import__("installworld").fake_update(self.cfg)
        u.update(state="ok", done_at=u["at"] + 1)
        self.save_cfg()
        self.assertEqual(self.rollback()["outcome"], "rolled-back")
        self.assertEqual(len(self.asks()), 2)

    def test_a_rollback_that_died_after_its_checkout(self):
        self.set(plan=["failed", "ok"])
        with self.assertRaises(Refused):
            self.install()
        with mock.patch.object(install, "ask_update", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.rollback()
        self.assertEqual((self.st()["phase"], self.head()), ("rolling-back", self.B))
        with state.locked(self.p) as st:
            st["rollback"]["ask"] = None          # it died before recording the ask
        self.assertEqual(self.rollback()["outcome"], "rolled-back")


class Command(World):
    """fork/bin/sync's four new steps, as the run's agent calls them (a scratch root: not live)."""

    def test_baseline_install_health_through_the_command(self):
        code, out = self.sync("baseline", "--capture")
        self.assertEqual((code, out["captured"], out["baseline"]["sha"]), (0, True, self.B), out)
        self.ready_to_install()
        self.set(plan=["ok"])
        code, out = self.sync("install", self.C)
        self.assertEqual((code, out["update"]), (0, "ok"), out)
        code, out = self.sync("health", self.C)
        self.assertEqual((code, out["outcome"], out["tag"]), (0, "installed", None), out)

    def test_a_refusal_is_one_line_with_its_outcome(self):
        self.ready_to_install()
        with state.locked(self.p) as st:
            st["rehearsals"] = []
        code, out = self.sync("install", self.C)
        self.assertEqual((code, out["outcome"], out["gate"]), (1, "held", "rehearsal"), out)
        code, out = self.sync("rollback")
        self.assertEqual((code, out["outcome"]), (1, "stop"), out)


class Pins(unittest.TestCase):
    """What the pipeline reads from upstream, under the names it reads them by."""

    def read(self, rel):
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            return f.read()

    def test_installed_json_keys(self):
        text = self.read("bin/shepherdr")
        self.assertIn('RECORD = f"{SHARE}/installed.json"', text)
        self.assertIn('SHARE = ".local/share/shepherdr"', text)
        self.assertRegex(text, r'rec\.update\(\{"version": VERSION, "source": src, "at": r\.stamp, "root": root\}\)')
        self.assertIn('rec["whole"] = not whole_bad', text)
        self.assertIn('rec["files"] = files', text)
        self.assertIn('self.stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")', text)
        self.assertRegex(text, r'(?m)^VERSION = "\d+\.\d+\.\d+"$')
        self.assertIsNotNone(install.stamp_epoch("20261127-061500"))

    def test_the_hooks_rule(self):
        text = self.read("bin/shepherdr")
        self.assertIn("def set_hooks(r, rec, add):", text)
        self.assertIn("share = r.p(SHARE)", text)
        self.assertIn("path = r.p(f)", text)
        for f in install.HOOK_FILES:
            self.assertIn(f'("{f}", ', text)
        self.assertIn('rec["hooks"] = set_hooks(r, rec, None if a.no_hooks else True)', text)

    def test_doctor_and_the_runner(self):
        su = self.read("mods/tasks/bin/herdr_task/self_update.py")
        self.assertIn("def clean_env(env, store=None):", su)
        self.assertIn('argv = ["shepherdr", "update"]', su)
        self.assertIn("env=clean_env(os.environ)", su)
        self.assertIn("TIMEOUT_S = 30 * 60", su)
        self.assertLess(30 * 60, install.UNKNOWN_AFTER_S)
        self.assertIn('raise Fail(f"Refused: only {s.name(t)}\'s own terminal can ask for its update.")', su)
        self.assertIn('os.environ.get("HERDR_BROWSER_TASK") != s.key(t)', su)
        sched = self.read("mods/tasks/bin/herdr_task/scheduler.py")
        self.assertIn("def script_hash():", sched)
        auto = self.read("mods/tasks/bin/herdr_task/automations.py")
        self.assertIn('json.dump({"pid": os.getpid(), "hash": started', auto)
        self.assertIn('os.path.join(STORE, ".scheduler.json")', auto)
        self.assertIn("may_update=bool(a.get(\"may_update\"))", auto)
        base = self.read("mods/tasks/bin/herdr_task/base.py")
        self.assertRegex(base, r"(?m)^STORE = ")
        mach = self.read("mods/tasks/bin/herdr_task/machines.py")
        self.assertIn("print(json.dumps(rows))", mach)
        self.assertIn('a["route"]', mach)
        self.assertIn("a['target']", mach)

    def test_update_shepherdr_status_json(self):
        """The real herdr-task: --status --json prints the task's shepherdr_update with state, at and done_at, and
        exits 0 whatever it says; `show --json` carries the task's automation."""
        tmp = tempfile.mkdtemp(prefix="fork-pin-")
        self.addCleanup(shutil.rmtree, tmp, True)
        store, folder = os.path.join(tmp, "store"), os.path.join(tmp, "space-pin")
        os.makedirs(folder)
        env = dict(os.environ, HERDR_TASK_STORE=store, HERDR_TASK_SETTINGS=os.path.join(tmp, "settings.json"),
                   SHEPHERDR_NO_MIGRATE="1", PATH=os.path.join(tmp, "nobin") + os.pathsep + "/usr/bin:/bin")
        ht = [sys.executable, os.path.join(ROOT, "mods", "tasks", "bin", "herdr-task")]
        r = subprocess.run(ht + ["add", "pin", "--folder", folder, "--json"], capture_output=True, text=True,
                           env=env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        lists = [os.path.join(d, f) for d, _, fs in os.walk(store) for f in fs if f.endswith(".json")
                 and not f.startswith(".")]
        target = None
        for path in lists:
            with open(path) as f:
                data = json.load(f)
            if isinstance(data, dict) and data.get("tasks"):
                target = path
                break
        self.assertIsNotNone(target, lists)
        data["tasks"][0].update(automation=3, shepherdr_update={"state": "failed", "at": 1000, "done_at": 2000,
                                                                "code": 1, "tail": "x", "log": "/x.log"})
        with open(target, "w") as f:
            json.dump(data, f)
        key = str(data["tasks"][0]["id"])
        r = subprocess.run(ht + ["update-shepherdr", key, "--folder", folder, "--status", "--json"],
                           capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        u = install.json_line(r.stdout)
        self.assertEqual((u["state"], u["at"], u["done_at"]), ("failed", 1000, 2000))
        # `show --json` reads live agents through hc (refused under a test's HOME): its view is the task's own
        # fields, the run's automation among them, and a schedule's run records it there
        self.assertIn("    v = dict(task)\n", self.read("mods/tasks/bin/herdr_task/output.py"))
        self.assertIn('t["automation"], t["automation_title"], t["automation_ref"] = a["id"]',
                      self.read("mods/tasks/bin/herdr_task/automations.py"))
        su = self.read("mods/tasks/bin/herdr_task/self_update.py")
        self.assertIn('u = t["shepherdr_update"] = {"state": "running", "at": now()}', su)
        self.assertIn('u.update(state="ok" if code == 0 else "failed", done_at=now()', su)
        self.assertIn("return int(time.time() * 1000)", self.read("mods/tasks/bin/herdr_task/base.py"))


if __name__ == "__main__":
    unittest.main()
