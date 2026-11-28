"""dmalis/shepherdr "Ready refuses reviewed work" (#388): a round recorded on the commit that is HEAD always satisfies
ready, one case per report folded into #388; ready's refusal names the commit it checked and the one the newest round is
on; the brief says plainly which commit `reviewed --commit` names. A real throwaway git repo and task list on disk
(ReadyMergeGit's); hc and gh are never run."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shutil
import sys
import unittest

import test_herdr_task as H

sys.path.insert(0, H.BIN)


class ReadyTakesTheReviewedHead(unittest.TestCase):
    G = H.ReadyMergeGit
    setUp, patch, git, commit, args, remote = G.setUp, G.patch, G.git, G.commit, G.args, G.remote
    ready_on_disk, ready_args = G.ready_on_disk, G.ready_args

    def on_disk(self, rounds):
        self.loc, ref = self.ready_on_disk(rounds=rounds)
        return self.loc, ref

    def reviewed(self, ref, commit=None, report="no findings"):
        self.commands.cmd_reviewed(self.args(id=ref, folder=self.main, report=report, commit=commit))
        return self.said[-1]

    def ready(self, ref, cwd=None):
        """ready from cwd, after the scheduler's tick saw the branch's newest commit (as every 15 s for real): ready's
        own_work then changes nothing, and its fetch reads the list again (upstream #1488, #1489)."""
        import herdr_task.github as github
        import herdr_task.store as store
        with store.Store(self.loc) as s:
            github.own_work(s, s.find(ref))
        here = os.getcwd()
        os.chdir(cwd or self.main)
        try:
            self.commands.cmd_ready(self.ready_args(ref))
        finally:
            os.chdir(here)

    def stored(self, loc, ref):
        import herdr_task.store as store
        with store.Store(loc, write=False) as s:
            return dict(s.find(ref))

    def refusal(self, ref):
        with self.assertRaises(self.commands.Fail) as e:
            self.ready(ref)
        return str(e.exception)

    def test_a_round_on_head_without_commit_is_taken_twice_in_a_row(self):
        """#389, #394, #396: `reviewed` with no --commit (it records HEAD), nothing committed after, ready twice."""
        loc, ref = self.on_disk(rounds=2)
        wt = self.task["worktree"]
        self.commit(wt, "work", "a.txt")
        self.reviewed(ref, report="2 majors")
        head = self.commit(wt, "fix round 1", "a.txt")
        self.assertIn(f"for commit {head[:7]}", self.reviewed(ref))
        self.ready(ref)
        self.ready(ref)  # a second ready of a Ready task
        t = self.stored(loc, ref)
        self.assertEqual((t["state"], t["head"]), ("ready", head))

    def test_a_base_branch_gone_from_origin_still_takes_the_reviewed_head(self):
        """#389: the task's base branch no longer exists on origin, its local copy older than the branch's start."""
        old = self.git(self.main, "rev-parse", "HEAD")
        self.git(self.main, "branch", "feature")
        self.task.update(base="feature", base_set=True)
        loc, ref = self.on_disk(rounds=2)
        self.git(self.main, "push", "-q", "origin", "feature")
        self.git(self.main, "push", "-q", "origin", "--delete", "feature")
        self.git(self.main, "fetch", "-q", "--prune", "origin")
        self.assertEqual(self.git(self.main, "rev-parse", "feature"), old)
        wt = self.task["worktree"]
        head = self.commit(wt, "work", "a.txt")
        self.reviewed(ref)
        self.ready(ref)
        self.assertEqual(self.stored(loc, ref)["state"], "ready")
        self.assertEqual(self.stored(loc, ref)["head"], head)

    def test_several_rounds_on_one_commit_any_of_them_counts(self):
        """#390 (upstream #1488): rounds on A, B, C, then a clean one on C again, a round still left: C is taken."""
        loc, ref = self.on_disk(rounds=5)
        wt = self.task["worktree"]
        for n in range(3):
            self.commit(wt, f"step {n}", "a.txt")
            self.reviewed(ref, report=f"round {n + 1}: 1 major")
        head = self.git(wt, "rev-parse", "HEAD")
        self.reviewed(ref, commit=head[:8], report="no findings")  # a short sha, as people type it
        t = self.stored(loc, ref)
        self.assertEqual([r["head"] for r in t["reviews"]][-2:], [head, head])
        self.ready(ref)
        self.assertEqual(self.stored(loc, ref)["state"], "ready")

    def test_ready_from_the_main_folder_or_the_worktree_after_a_no_op_rebase(self):
        """#391, #399: origin/main merged in before the round, a rebase onto origin/main that changes nothing, then
        ready from the main folder and from the worktree."""
        loc, ref = self.on_disk(rounds=2)
        wt = self.task["worktree"]
        self.commit(wt, "work", "a.txt")
        self.commit(self.main, "someone else's merge", "b.txt")
        self.git(self.main, "push", "-q", "origin", "main")
        self.git(wt, "fetch", "-q", "origin")
        self.git(wt, "merge", "-q", "--no-edit", "origin/main")
        head = self.git(wt, "rev-parse", "HEAD")
        self.reviewed(ref)
        self.git(wt, "rebase", "-q", "--rebase-merges", "origin/main")  # already on it: nothing moves
        self.assertEqual(self.git(wt, "rev-parse", "HEAD"), head)
        self.ready(ref, cwd=self.main)
        self.ready(ref, cwd=wt)
        self.assertEqual(self.stored(loc, ref)["state"], "ready")

    def test_a_report_with_a_minor_left_is_still_a_reviewed_head(self):
        """#397: the round's report text never counts, only the commit it is on."""
        loc, ref = self.on_disk(rounds=2)
        self.commit(self.task["worktree"], "work", "a.txt")
        self.reviewed(ref, report="1 minor left: a test's comment overclaims; no blocker or major")
        self.ready(ref)
        self.assertEqual(self.stored(loc, ref)["state"], "ready")

    def test_the_refusal_names_the_commit_it_checked_and_the_one_reviewed(self):
        """#388, #397: with a round left, a round recorded on an older commit (--commit the reviewed one, a fix after)
        is refused, naming HEAD, where it is, and the newest round's commit; reviewed said so when it recorded it."""
        loc, ref = self.on_disk(rounds=2)
        wt = self.task["worktree"]
        seen = self.commit(wt, "work", "a.txt")
        head = self.commit(wt, "fix", "a.txt")
        said = self.reviewed(ref, commit=seen)
        self.assertIn(f"for commit {seen[:7]}", said)
        self.assertIn(f"newer than it: {head[:7]}", said)
        msg = self.refusal(ref)
        self.assertIn(f"HEAD {head[:7]}", msg)
        self.assertIn(f"(round 1) is on {seen[:7]}, 1 commit before it", msg)
        self.assertNotIn("this task's work", msg)
        self.reviewed(ref)  # round 2, on HEAD
        self.ready(ref)
        self.assertEqual(self.stored(loc, ref)["state"], "ready")

    def test_a_head_ready_cannot_read_is_said_as_that(self):
        """#388: an unreadable HEAD was read as "" and refused as "this task's work isn't reviewed"."""
        loc, ref = self.on_disk(rounds=2)
        wt = self.task["worktree"]
        self.commit(wt, "work", "a.txt")
        self.reviewed(ref)
        real = self.commands.git
        self.patch(self.commands, "git", lambda cwd, *a: (False, "", "fatal: not a git repository")
                   if cwd == wt and a == ("rev-parse", "HEAD") else real(cwd, *a))
        msg = self.refusal(ref)
        self.assertIn("couldn't read", msg)
        self.assertIn("fatal: not a git repository", msg)
        self.assertNotIn("isn't reviewed", msg)

    def test_a_worktree_gone_is_said_as_that_not_as_unreviewed(self):
        """#388: with its worktree folder gone, ready said "this task's work isn't reviewed"."""
        loc, ref = self.on_disk(rounds=2)
        wt = self.task["worktree"]
        self.commit(wt, "work", "a.txt")
        self.reviewed(ref)
        shutil.rmtree(wt)
        msg = self.refusal(ref)
        self.assertIn("worktree", msg)
        self.assertIn("is gone", msg)
        self.assertNotIn("isn't reviewed", msg)

    def test_ready_moving_a_stacked_task_onto_its_merged_base_keeps_the_review(self):
        """#389: its base, another task's branch, merged (squashed) and gone: ready rebases the reviewed commit onto
        the new base itself; the same changes as reviewed, so the round holds."""
        import herdr_task.stack as stack
        self.patch(stack, "gh", lambda *a, **k: (True, "[]", ""))
        self.patch(self.commands, "mid_turn", lambda s, t: False)
        wt = self.task["worktree"]
        feature = self.commit(wt, "the base task's work", "f.txt")
        self.git(self.main, "branch", "feature", feature)
        self.task.update(base="feature", base_set=True, start=feature)
        parent = {"id": 2, "title": "Base", "state": "done", "merged": True, "mode": "worktree", "branch": "feature",
                  "base": "main", "worktree": os.path.join(self.root, "gone"), "agents": []}
        loc, ref = self.on_disk(rounds=2)
        import herdr_task.store as store
        with store.Store(loc) as s:
            s.data["tasks"].append(parent)
            s.dirty = True
        reviewed = self.commit(wt, "work", "a.txt")
        self.reviewed(ref)
        with open(os.path.join(self.main, "f.txt"), "a") as f:   # its squash merge into main
            f.write("the base task's work\n")
        self.git(self.main, "add", "f.txt")
        self.commit(self.main, "Base (#1)")
        self.git(self.main, "push", "-q", "origin", "main")
        self.ready(ref)
        t = self.stored(loc, ref)
        self.assertEqual((t["state"], t["base"]), ("ready", "main"))
        self.assertNotEqual(t["head"], reviewed)





class BriefSaysWhichCommit(unittest.TestCase):
    """#388: "add --commit <sha> if you committed fixes since" was read two ways (the reviewed commit, or the fix)."""
    C = H.ParallelCollisions
    setUp, patch, git, write, commit, task = C.setUp, C.patch, C.git, C.write, C.commit, C.task

    def test_the_brief_names_the_reviewed_commit_never_the_fix(self):
        self.patch(self.launch, "review_limits", lambda s, t: (True, 2))
        line = self.launch.closing_line(self.store, self.task(1, "A"))
        self.assertNotIn("if you committed fixes since", line)
        self.assertIn("it records your HEAD", line)
        self.assertIn("add `--commit <the commit the reviewer read>`, never your fix's", line)
        self.assertIn("ready takes your HEAD only when a round is recorded on it", line)

    def test_the_help_names_the_reviewed_commit(self):
        import subprocess
        env = {**os.environ, "HERDR_TASK_STORE": os.path.join(self.root, "tasks")}
        out = subprocess.run([sys.executable, os.path.join(H.BIN, "herdr-task"), "reviewed", "--help"], capture_output=True,
                             text=True, env=env, stdin=subprocess.DEVNULL, timeout=60).stdout
        self.assertIn("the commit the reviewer read", " ".join(out.split()))


if __name__ == "__main__":
    unittest.main()
