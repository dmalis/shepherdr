"""How a sync run ends (fork/specs/sync-pipeline.md, "Finishing the run" and "Completion commands", build task 3):
`fork/bin/sync finish` prints the exact `herdr-task ready` command for the run's outcome after checking the branch
is in a state that command accepts; and a pin that runs the completion table's cases against herdr-task's own
`cmd_ready`, `review_refusal`, `quiet_ready` and `tick.facts` (the spec's "What was tried"), with local main stale and
fast-forwarded, with and without recorded own work. A throwaway git world; hc and GitHub are never reached."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import argparse  # noqa: E402
import shlex  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

from syncworld import World, git  # noqa: E402
from sync import gate, state  # noqa: E402
from sync.state import Refused  # noqa: E402

BIN = os.path.join(ROOT, "mods", "tasks", "bin")


class FinishCommand(World):
    def finish(self, *args):
        code, out = self.sync("finish", *args, paths_ok=True)
        return code, out

    def cmd(self, out):
        return shlex.split(out["command"])

    def test_nothing_new(self):
        self.edit(baseline={"sha": self.main0})
        self.assertEqual(self.sync("select")[1]["path"], "nothing")
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (0, "nothing"), out)
        self.assertEqual(self.cmd(out), ["herdr-task", "ready", self.RUN, "--folder", self.space, "--nothing"])
        self.assertIsNone(self.st()["lease"], "a final phase lets the lease go")

    def test_another_runs_lease_is_nothing_and_untouched(self):
        code, out = self.sync("finish", run="SYNC-2", paths_ok=True)
        self.assertEqual((code, out["outcome"]), (0, "nothing"))
        self.assertEqual(self.st()["lease"]["run"], self.RUN)

    def merged_run(self):
        """A run that took v3.2.22: its branch merged into the fork's main on GitHub; the worktree hasn't fetched."""
        rel = self.upstream_release("v3.2.22")
        self.sync("select")
        merge, head = self.sync_branch("v3.2.22", rel)
        w = tempfile.mkdtemp(dir=self.tmp)
        subprocess.run(["git", "clone", "-q", self.origin, w], check=True)
        git(w, "merge", "-q", "--no-ff", "--no-edit", "origin/sync/v3.2.22")
        git(w, "push", "-q", "origin", "main")
        git(self.space, "update-ref", "refs/remotes/origin/main", self.main0)    # as last fetched: before the merge
        with state.locked(self.p) as st:
            st["run"] = dict(st["run"], merged=True)
        return rel, head

    def test_installed_after_a_merge_fetches_first(self):
        self.merged_run()
        self.edit(phase="healthy")
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (1, "stop"), "an install says what's new")
        code, out = self.finish("--says", "Shepherdr 3.2.22 is in, with our patches.")
        self.assertEqual((code, out["outcome"]), (0, "installed"), out)
        self.assertEqual(self.cmd(out)[-2:], ["--told", "Shepherdr 3.2.22 is in, with our patches."])
        self.assertTrue(git(self.wt, "merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main", ok=False) == "")
        self.assertIsNone(self.st()["lease"])

    def test_the_issue_cursor_moves_only_with_an_install(self):
        """select says where the person's upstream issues are searched from; only an install's report (which lists
        them) moves it, to the run's start, so a run that told nothing never skips a reply."""
        self.edit(baseline={"sha": self.main0}, issue_cursor="2026-01-01T00:00:00Z")
        code, out = self.sync("select")
        self.assertEqual((code, out["issue_cursor"]), (0, "2026-01-01T00:00:00Z"), out)
        self.finish()
        self.assertEqual(self.st()["issue_cursor"], "2026-01-01T00:00:00Z", "nothing new moves nothing")

    def test_an_install_moves_the_issue_cursor_to_the_runs_start(self):
        self.merged_run()
        start = self.st()["run"]["at"]
        self.edit(phase="healthy")
        code, out = self.finish("--says", "Shepherdr 3.2.22 is in.")
        self.assertEqual((code, out["outcome"]), (0, "installed"), out)
        self.assertEqual(self.st()["issue_cursor"], start)

    def test_the_told_words_pass_the_public_check(self):
        self.merged_run()
        self.edit(phase="healthy")
        for says in ("installed from /home/someone/x", "ask t@example.com", "it printed NOT DONE"):
            with self.subTest(says):
                code, out = self.finish("--says", says)
                self.assertEqual((code, out["outcome"]), (1, "stop"))
                self.assertNotIn(says, out["why"], "a refusal never repeats what it refused")

    def test_a_branch_the_command_would_refuse(self):
        self.edit(baseline={"sha": self.main0})
        self.sync("select")
        self.write(self.wt, "a.txt", "changed\n")
        code, out = self.finish()
        self.assertIn("uncommitted", out["why"])
        self.commit(self.wt, "something of its own")
        code, out = self.finish()
        self.assertIn("commits origin/main doesn't hold", out["why"])
        self.assertEqual(self.st()["lease"]["run"], self.RUN, "a refused finish keeps the lease")
        git(self.wt, "reset", "-q", "--hard", self.start)
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (0, "nothing"))

    def test_a_run_that_hasnt_ended(self):
        self.sync("select")
        code, out = self.finish()
        self.assertEqual(code, 1, "install-main hasn't ended")
        self.assertIn("hasn't ended (phase selected)", out["why"])

    def held_run(self, kind, new=True, **extra):
        rel = self.upstream_release("v3.2.22")
        self.sync("select")
        args = ["hold", "--run", self.RUN, "--folder", self.space, "--blocker", "5", "--tag", "v3.2.22", "--sha",
                rel, "--kind", kind, "--line", "the patch's test fails on the release"]
        for k, v in extra.items():
            args += [f"--{k}", *([v] if isinstance(v, str) else v)]
        code, out = self.sync(*args, paths_ok=True)
        self.assertEqual(code, 0, out)
        if not new:
            with state.locked(self.p) as st:
                st["run"]["held"]["new"] = False
        return rel

    def test_held_with_a_pushed_draft(self):
        rel = self.upstream_release("v3.2.22")
        self.sync("select")
        merge, head = self.sync_branch("v3.2.22", rel)
        self.sync("hold", "--run", self.RUN, "--folder", self.space, "--blocker", "5", "--tag", "v3.2.22", "--sha",
                  rel, "--kind", "draft", "--branch", "sync/v3.2.22", "--head", head, "--pr", "9", "--line",
                  "the patch's test fails on the release")
        code, out = self.finish()
        self.assertIn("commits origin/main doesn't hold", out["why"], "the branch is reset to its start first")
        git(self.wt, "reset", "-q", "--hard", self.start)
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (0, "held"), out)
        self.assertEqual(out["told"], "Held: v3.2.22 waits on patch #5: the patch's test fails on the release")
        self.assertIsNone(self.st()["lease"])

    def test_a_draft_not_pushed_at_its_head(self):
        self.held_run("draft", branch="sync/v3.2.22", head="c" * 40)
        code, out = self.finish()
        self.assertIn("isn't pushed", out["why"])

    def test_held_with_an_unresolved_merge(self):
        rel = self.held_run("conflict", files=["a.txt"])
        git(self.wt, "merge", "--no-ff", "--no-edit", rel, ok=False)
        code, out = self.finish()
        self.assertIn("merge is in progress", out["why"])
        git(self.wt, "merge", "--abort")
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (0, "held"))

    def test_a_held_record_is_told_once(self):
        self.held_run("trial", new=False)
        code, out = self.finish()
        self.assertEqual((code, out["outcome"], self.cmd(out)[-1]), (0, "nothing", "--nothing"))

    def test_no_update_permission(self):
        self.held_run("permission")
        code, out = self.finish()
        self.assertEqual(out["told"], "3.2.22 is ready to install")

    def test_unknown_keeps_the_lease_and_alerts(self):
        self.sync("select")
        self.edit(phase="installing")
        code, out = self.finish()
        self.assertEqual((code, out["outcome"], out["keeps_lease"]), (0, "unknown", True))
        self.assertEqual(shlex.split(out["before"][0])[:3], ["herdr-task", "alert", "Update outcome unknown"])
        self.assertEqual(self.st()["lease"]["run"], self.RUN)
        self.edit(phase="broken")
        code, out = self.finish()
        self.assertIn("Rollback failed", out["told"])

    def test_unknown_after_a_merge_fetches_and_checks_the_branch(self):
        """The unknown --told goes through herdr-task like any other: the merged branch fetched first, and a worktree
        the command would refuse is refused here (the lease kept either way)."""
        self.merged_run()
        self.edit(phase="installing")
        self.write(self.wt, "a.txt", "dirty\n")
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (1, "stop"))
        self.assertIn("uncommitted", out["why"])
        git(self.wt, "reset", "-q", "--hard", "HEAD")
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (0, "unknown"), out)
        self.assertEqual(git(self.wt, "rev-parse", "refs/remotes/origin/main"), git(self.origin, "rev-parse", "main"),
                         "fetched: the merged head is in origin/main")
        self.assertEqual(self.st()["lease"]["run"], self.RUN)

    def test_rolled_back(self):
        self.sync("select")
        self.edit(phase="rolled-back", quarantine=[{"sha": self.main0, "step": "health", "at": state.stamp()}],
                  baseline={"sha": self.v21, "version": "3.2.21"})
        code, out = self.finish()
        self.assertEqual((code, out["outcome"]), (0, "rolled-back"), out)
        self.assertEqual(out["told"], f"Rolled back: the install of {self.main0[:12]} failed at health; back on 3.2.21.")
        self.assertIsNone(self.st()["lease"])

    def test_a_rollback_then_a_healthy_install_ends_healthy(self):
        """The reported run: the first round rolled back, finish said settle again, the next tip installed healthy.
        The last words are the healthy ones; the rollback is over, so never "back on <the old version>"."""
        self.sync("select")
        rnd = {"path": "install-merged", "phase": "rolled-back", "candidate": self.main0,
               "quarantined": {"sha": self.main0, "step": "health (scheduler: still on the old code)"},
               "baseline": {"sha": self.v21, "version": "3.2.21"}}
        with state.locked(self.p) as st:
            st["run"] = dict(st["run"], path="install-merged", rounds=[rnd])
        self.edit(phase="healthy", baseline={"sha": self.main0, "version": "3.2.22"})
        code, out = self.finish("--says", "The button works.")
        self.assertEqual((code, out["outcome"]), (0, "installed"), out)
        self.assertEqual(out["told"], "The button works. An earlier try rolled back; the next install is healthy.")
        self.assertEqual(self.cmd(out)[-2:], ["--told", out["told"]])


class ToldWords(unittest.TestCase):
    """finish's words from a run's rounds (gate.told_words): the last words follow what is installed now."""
    RB1 = "Rolled back: the install of aaaaaaaaaaaa failed at health; back on 3.2.21."
    RB2 = "Rolled back: the install of bbbbbbbbbbbb failed at health; back on 3.2.22."
    HELD = "Held: v3.2.23 waits on patch #5."

    def words(self, *rounds, says="What's new."):
        return gate.told_words([(o, w, "install-merged") for o, w in rounds], says)

    def test_one_healthy_install(self):
        self.assertEqual(self.words(("installed", None)), ("installed", "What's new."))

    def test_a_rollback_then_healthy(self):
        self.assertEqual(self.words(("rolled-back", self.RB1), ("installed", None)),
                         ("installed", "What's new. " + gate.EARLIER_ROLLBACK))

    def test_two_rollbacks_then_healthy_say_it_once(self):
        self.assertEqual(self.words(("rolled-back", self.RB1), ("rolled-back", self.RB2), ("installed", None)),
                         ("installed", "What's new. " + gate.EARLIER_ROLLBACK))

    def test_healthy_then_a_rollback_says_where_it_is_back_on_last(self):
        self.assertEqual(self.words(("installed", None), ("rolled-back", self.RB2)),
                         ("installed", "What's new. " + self.RB2))

    def test_rollback_healthy_rollback_ends_on_the_last_rollback(self):
        self.assertEqual(self.words(("rolled-back", self.RB1), ("installed", None), ("rolled-back", self.RB2)),
                         ("installed", "What's new. " + self.RB2))

    def test_a_hold_still_held_stays(self):
        self.assertEqual(self.words(("held", self.HELD), ("rolled-back", self.RB1), ("installed", None)),
                         ("installed", self.HELD + " What's new. " + gate.EARLIER_ROLLBACK))

    def test_only_rollbacks(self):
        self.assertEqual(self.words(("rolled-back", self.RB1), ("rolled-back", self.RB2), says=None),
                         ("rolled-back", self.RB1 + " " + self.RB2))

    def test_an_install_needs_whats_new(self):
        with self.assertRaises(Refused):
            self.words(("rolled-back", self.RB1), ("installed", None), says=None)

    def test_a_hold_a_later_healthy_install_cleared_isnt_told(self):
        """The same stale pattern for holds: a later healthy install that carries the held release clears the
        record (install.passed), so the earlier round's "Held: …" is over."""
        rnd = {"path": "install-merged", "phase": "held", "held": {"blocker": "main-hooks", "new": True},
               "held_record": {"blocker": "main-hooks", "kind": "hooks", "head": "c" * 40,
                               "release": {"tag": "v3.2.21", "sha": "d" * 40}, "line": "x"}}
        self.assertEqual(gate.earlier_round({"held": []}, rnd), ("nothing", None, "install-merged"))
        still = {"held": [rnd["held_record"]]}
        self.assertEqual(gate.earlier_round(still, rnd)[0], "held")


class Store:
    """Enough of herdr_task.store.Store for the commands, in memory (as test/test_herdr_task.py's)."""

    def __init__(self, tasks, folder):
        self.data, self.loc, self.dirty, self.write = {"tasks": tasks}, {"folder": folder, "kind": "repo",
                                                                          "name": "space"}, False, True
        self.prefix, self.slug = "SYNC", "space"

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def find(self, ref):
        return next(t for t in self.data["tasks"] if t["id"] == int(str(ref).split("-")[-1]))

    def ref(self, t):
        return f"SYNC-{t['id']}"

    def name(self, t):
        return '"' + " ".join(str(t.get("title") or "").split()) + '"'

    def key(self, t):
        return f"space#{t['id']}"


class CompletionPin(unittest.TestCase):
    """The completion table, run against herdr-task's own code: a bare repo for GitHub, the space, the run's
    worktree; the task list, agents and GitHub lookups mocked (as test/test_herdr_task.py's MergedOnlyWithOwnWork).
    When one of these changes, the route `finish` prints may no longer work: fix both."""

    def setUp(self):
        sys.path.insert(0, BIN)
        import herdr_task.commands as commands
        import herdr_task.github as github
        import herdr_task.tick as tick
        from herdr_task.base import Fail
        self.commands, self.tick, self.Fail = commands, tick, Fail
        self.tmp = tempfile.mkdtemp(prefix="fork-pin-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.origin, self.space = os.path.join(self.tmp, "origin.git"), os.path.join(self.tmp, "space")
        self.wt = os.path.join(self.tmp, "wt")
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", self.origin], check=True)
        subprocess.run(["git", "clone", "-q", self.origin, self.space], check=True, capture_output=True)
        self.commit(self.space, "base", "a.txt", "one\n")
        git(self.space, "push", "-q", "origin", "main")
        git(self.space, "worktree", "add", "-q", "-b", "task/1", self.wt, "main")
        self.start = git(self.wt, "rev-parse", "HEAD")
        self.live, self.said = [], []
        self.task = {"id": 1, "title": "Upstream sync", "state": "running", "mode": "worktree", "worktree": self.wt,
                     "branch": "task/1", "base": "main", "start": self.start, "agents": [], "review_gate": True,
                     "automation": {"id": 1, "title": "Upstream sync"}, "started": 0}
        self.store = Store([self.task], self.space)
        done = lambda s, t, even_if_busy=False, quiet=False: t.update(state="done")   # noqa: E731
        ready = lambda s, t: (t.update(state="ready"), "ready")[1]                      # noqa: E731
        merged_pr = {"number": 5, "url": "u", "state": "MERGED", "isCrossRepository": False, "baseRefName": "main",
                     "headRefName": "sync/v3.2.22", "headRefOid": "x"}
        for mod, name, value in (
                (tick, "live_agents", lambda key: self.live), (tick, "detail", lambda k: k), (tick, "finish", done),
                (tick, "watch_main", lambda *a: None),
                (commands, "finish", done), (commands, "open_store", lambda args, write=True, wait=None: self.store),
                (commands, "view", lambda s, t, live=None: dict(t)),
                (commands, "say", lambda a, v, text=None: self.said.append(text)),
                (commands, "live_agents", lambda key: self.live), (commands, "detail", lambda k: k),
                (commands, "own_core_check", lambda: None), (commands, "review_limits", lambda s, t: (True, 2)),
                (commands, "finalize", ready),
                (commands, "find_proof", lambda *a: None), (commands, "task_settings", lambda s, t: []),
                (commands, "ready_turns", lambda live: {}), (commands, "watch_main", lambda *a: None),
                (commands, "update_main", lambda *a: None), (commands, "github", lambda s: "dmalis/shepherdr"),
                (commands, "gh", lambda *a, **k: (True, __import__("json").dumps(merged_pr), "")),
                (github, "github", lambda s: None)):
            p = mock.patch.object(mod, name, value)
            p.start()
            self.addCleanup(p.stop)

    def commit(self, repo, words, path=None, text=None):
        if path:
            with open(os.path.join(repo, path), "w") as f:
                f.write(text)
            git(repo, "add", path)
        git(repo, "commit", "-q", "--allow-empty", "-m", words)
        return git(repo, "rev-parse", "HEAD")

    def args(self, **kw):
        base = dict(id="SYNC-1", json=True, folder=self.space, summary=None, details=None, proof=None, agents_md=None,
                    pr=None, pr_title=None, pr_body=None, draft=False, nothing=False, told=None)
        base.update(kw)
        return argparse.Namespace(**base)

    def ready(self, **kw):
        """herdr-task ready: None when accepted, else its refusal's words."""
        try:
            self.commands.cmd_ready(self.args(**kw))
        except self.Fail as e:
            return str(e)
        return None

    def reset(self):
        self.task.update(state="running")
        for k in ("quiet", "told", "nothing_to_merge", "merged", "own", "head", "reviews"):
            self.task.pop(k, None)

    def sync_work(self):
        """The run's own commits (as the sync branch's), reviewed on its head."""
        head = self.commit(self.wt, "merge the release, adapt our patches", "a.txt", "two, ours\n")
        self.task["reviews"] = [{"round": 1, "result": "report", "at": 1, "head": head, "text": "no findings"}]
        return head

    def merge_on_github(self, head):
        """`gh pr merge --merge` of the sync branch: a merge commit on the bare repo's main. The space hasn't
        fetched."""
        git(self.wt, "push", "-q", "origin", f"{head}:refs/heads/sync/v3.2.22")
        w = os.path.join(self.tmp, "gh-merge")
        shutil.rmtree(w, True)
        subprocess.run(["git", "clone", "-q", self.origin, w], check=True, capture_output=True)
        git(w, "merge", "-q", "--no-ff", "--no-edit", "origin/sync/v3.2.22")
        git(w, "push", "-q", "origin", "main")
        return git(w, "rev-parse", "HEAD")

    def fast_forward_local_main(self, mc):
        """herdr-task's update_main after a merge: the local main moves, origin/main as last fetched doesn't."""
        git(self.space, "fetch", "-q", self.origin, "main:refs/pin/m")
        git(self.space, "merge", "-q", "--ff-only", "refs/pin/m")
        self.assertNotEqual(git(self.space, "rev-parse", "refs/remotes/origin/main"), mc)

    def fetch(self):
        git(self.wt, "fetch", "-q", "origin", "main")

    def told_route_ok(self, merged):
        """finish's own check of the branch, as it runs before printing the command (with its fetch when merged)."""
        if merged:
            gate.fetch_for_finish(self.wt)
        try:
            gate.branch_problem(self.wt, self.start)
        except Refused as e:
            return e.why
        return None

    # --- the review gate ---
    def test_the_review_gate(self):
        head = self.sync_work()
        self.task["head"] = head
        reviews = self.task.pop("reviews")
        refuse = lambda: self.commands.review_refusal(self.store, self.task, self.wt)   # noqa: E731
        self.assertIn("isn't reviewed", refuse(), "no round")
        self.task["reviews"] = [dict(reviews[0], head=self.start)]
        self.assertIn("isn't reviewed", refuse(), "a round on another commit")
        self.task["reviews"] = reviews
        self.assertIsNone(refuse(), "a round on the head")

    # --- after the merge commit ---
    def test_after_the_merge_in_every_history(self):
        for ff in (False, True):
            for own in (False, True):
                with self.subTest(local_main="fast-forwarded" if ff else "stale", own_recorded=own):
                    self.setUp()
                    head = self.sync_work()
                    if own:
                        self.task["own"] = head      # the tick saw the branch's newest commit before the merge
                    mc = self.merge_on_github(head)
                    if ff:
                        self.fast_forward_local_main(mc)
                    # the tick, with the run's agent mid-turn: never finishes it under the run
                    self.live = [{"address": "t1", "status": {"state": "working"}}]
                    self.tick.facts(self.store, self.task, {"attention": [], "done": []})
                    self.assertEqual(self.task["state"], "running")
                    # ready --pr refuses a merged pull request (upstream issue 1595's case)
                    self.assertIn("is merged: only an open one can be taken", self.ready(pr=5, summary="Done."))
                    self.reset()
                    self.task["reviews"] = [{"round": 1, "result": "report", "at": 1, "head": head, "text": "-"}]
                    if own:
                        self.task["own"] = head
                    # --nothing and --told before the fetch: refused while the local main is stale
                    for kw in ({"nothing": True}, {"told": "Installed."}):
                        said = self.ready(**kw)
                        if ff:
                            self.assertIsNone(said, kw)
                            self.reset()
                            if own:
                                self.task["own"] = head
                        else:
                            self.assertIn("has commits of its own", said)
                    # the route finish prints: git fetch origin main, then --told: done in every history
                    self.fetch()
                    self.assertIsNone(self.told_route_ok(merged=True))
                    self.assertIsNone(self.ready(told="Installed 3.2.22."))
                    self.assertEqual((self.task["state"], self.task["quiet"]), ("done", "told"))

    def test_every_told_ending_after_a_merge(self):
        """installed, rolled back and unknown all end --told after a merge: each is accepted after the fetch, with
        the local main stale and own work recorded (the history most likely to refuse)."""
        for told in ("Shepherdr 3.2.22 is in.",
                     "Rolled back: the install of 1a2b3c4d5e6f failed at health; back on 3.2.21.",
                     "Update outcome unknown: v3.2.22 (1a2b3c4d5e6f). Nothing installs until it is looked at."):
            with self.subTest(told):
                self.setUp()
                head = self.sync_work()
                self.task["own"] = head
                self.merge_on_github(head)
                self.assertIn("has commits of its own", self.ready(told=told), "before the fetch")
                self.reset()
                self.task.update(own=head, reviews=[{"round": 1, "result": "report", "at": 1, "head": head}])
                self.assertIsNone(self.told_route_ok(merged=True))
                self.assertIsNone(self.ready(told=told))
                self.assertEqual((self.task["state"], self.task["quiet"]), ("done", "told"))

    def test_summary_after_the_merge_is_never_the_route(self):
        """ready --summary after a merge-commit merge: left Ready with nothing to merge (not done), or, with own work
        recorded and the local main caught up, done at once. Either way not the run's ending: it never uses it."""
        head = self.sync_work()
        mc = self.merge_on_github(head)
        self.fast_forward_local_main(mc)
        self.assertIsNone(self.ready(summary="Done."))
        self.assertEqual((self.task["state"], self.task.get("nothing_to_merge")), ("ready", True))
        self.reset()
        self.task.update(reviews=[{"round": 1, "result": "report", "at": 1, "head": head}], own=head)
        self.assertIsNone(self.ready(summary="Done."))
        self.assertEqual((self.task["state"], self.task.get("merged")), ("done", True))

    def test_an_idle_agent_and_a_caught_up_main_let_the_tick_finish_it(self):
        """Why the run keeps its turn until ready: between turns, with its own work recorded and the local main
        caught up, the tick marks it merged and done, and its --told would then be refused."""
        head = self.sync_work()
        self.task["own"] = head
        self.fast_forward_local_main(self.merge_on_github(head))
        self.live = []
        self.tick.facts(self.store, self.task, {"attention": [], "done": []})
        self.assertEqual((self.task["state"], self.task.get("merged")), ("done", True))
        self.assertIn("already done", self.ready(told="Installed."))

    def test_told_with_the_branch_not_merged(self):
        self.sync_work()
        self.fetch()
        self.assertIn("has commits of its own", self.ready(told="Installed."))
        self.assertIn("commits origin/main doesn't hold", self.told_route_ok(merged=False))

    # --- held ---
    def test_held_with_a_pushed_draft_and_the_branch_reset(self):
        head = self.sync_work()
        git(self.wt, "push", "-q", "origin", f"{head}:refs/heads/sync/v3.2.22")
        git(self.wt, "reset", "-q", "--hard", self.start)
        self.assertIsNone(self.told_route_ok(merged=False))
        self.assertIsNone(self.ready(told="Held: v3.2.22 waits on patch #5."))
        self.assertEqual(self.task["state"], "done")

    def test_held_with_an_unresolved_merge(self):
        other = os.path.join(self.tmp, "release")
        subprocess.run(["git", "clone", "-q", self.origin, other], check=True, capture_output=True)
        rel = self.commit(other, "the release", "a.txt", "two\n")
        git(other, "push", "-q", "origin", "HEAD:refs/heads/release")
        self.commit(self.wt, "ours", "a.txt", "one, ours\n")
        git(self.wt, "reset", "-q", "--hard", self.start)
        self.commit(self.space, "ours on main", "a.txt", "one, ours\n")
        git(self.space, "push", "-q", "origin", "main")
        git(self.wt, "fetch", "-q", "origin")
        git(self.wt, "reset", "-q", "--hard", "origin/main")
        r = subprocess.run(["git", "-C", self.wt, "merge", "--no-ff", "--no-edit", rel], capture_output=True)
        self.assertNotEqual(r.returncode, 0, "a conflict")
        self.assertIn("uncommitted changes", self.ready(told="Held: v3.2.22 waits on patch #5."))
        self.assertIn("merge is in progress", self.told_route_ok(merged=False))
        git(self.wt, "merge", "--abort")
        self.assertIsNone(self.told_route_ok(merged=False))
        self.assertIsNone(self.ready(told="Held: v3.2.22 waits on patch #5."))
        self.assertEqual(self.task["state"], "done")

    # --- nothing new ---
    def test_an_untouched_worktree(self):
        for kw in ({"nothing": True}, {"told": "Nothing new."}):
            with self.subTest(kw):
                self.reset()
                self.assertIsNone(self.told_route_ok(merged=False))
                self.assertIsNone(self.ready(**kw))
                self.assertEqual((self.task["state"], self.task["quiet"]), ("done", "nothing" if "nothing" in kw
                                                                            else "told"))


if __name__ == "__main__":
    unittest.main()
