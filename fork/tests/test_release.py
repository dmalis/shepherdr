"""Release selection and the reviewer's inputs (fork/specs/sync-pipeline.md, build task 3): `fork/bin/sync select`
and `review-inputs` on a real scratch git world, upstream and the fork as bare repos behind their GitHub URLs, gh and
herdr-task faked. Tags come only from upstream's ls-remote, by exact name and version, peeled, on upstream's main;
untagged main is never taken; the decision table; the three diffs for the reviewer."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import unittest  # noqa: E402

from syncworld import World, git  # noqa: E402
from sync import release, state  # noqa: E402
from sync.state import Refused  # noqa: E402


class Releases(World):
    def test_the_highest_version_peeled_from_upstream_only(self):
        self.upstream_release("v3.3.9", text="nine\n")
        ten = self.upstream_release("v3.3.10", text="ten\n", annotated=False)
        # names that aren't releases, at newer commits
        for name in ("v3.3.0-rc1", "latest", "v3.2", "3.4.0", "v3.10.0.1"):
            self.write(self.dev, "x.txt", name)
            self.commit(self.dev, name)
            git(self.dev, "tag", name)
        git(self.dev, "push", "-q", "origin", "main", "--tags")
        # a fork-side tag, on origin and here, never counts
        git(self.ours, "tag", "v9.9.9")
        git(self.ours, "push", "-q", "origin", "v9.9.9")
        git(self.space, "fetch", "-q", "origin", "--tags")
        rels = release.releases(self.wt)
        self.assertEqual([r["tag"] for r in rels], ["v3.3.10", "v3.3.9", "v3.2.21", "v3.2.20"])
        self.assertEqual(rels[0]["sha"], ten, "a lightweight tag names its commit")
        self.assertEqual(rels[2]["sha"], self.v21, "an annotated tag's peeled commit, not the tag object")
        self.assertNotEqual(git(self.dev, "rev-parse", "v3.2.21"), self.v21)

    def test_an_upstream_remote_elsewhere_holds(self):
        git(self.space, "remote", "set-url", "upstream", "https://github.com/dmalis/shepherdr.git")
        with self.assertRaises(Refused) as e:
            release.releases(self.wt)
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("held", "pipeline"))

    def test_untagged_upstream_main_is_never_taken(self):
        rel = self.upstream_release("v3.2.22")
        tip = self.upstream_commit()
        got = release.select(self.wt, self.v21)
        self.assertEqual((got["path"], got["release"]), ("take", {"tag": "v3.2.22", "sha": rel}))
        self.assertNotEqual(rel, tip)
        self.assertTrue(release.is_ancestor(self.wt, rel, "refs/remotes/upstream/main"))
        # only that tag was fetched
        self.assertEqual(git(self.space, "tag", "-l"), "v3.2.22")

    def test_a_local_tag_of_that_name_elsewhere_holds(self):
        self.upstream_release("v3.2.22")
        git(self.space, "tag", "v3.2.22", self.main0)
        with self.assertRaises(Refused) as e:
            release.select(self.wt, self.v21)
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("held", "pipeline"))
        self.assertIn("v3.2.22", e.exception.why)

    def test_a_release_off_upstreams_main_holds(self):
        git(self.dev, "checkout", "-q", "-b", "side")
        self.upstream_release("v3.2.22")   # pushes main (unchanged) and the tag on the side branch
        with self.assertRaises(Refused) as e:
            release.select(self.wt, self.v21)
        self.assertEqual((e.exception.fields["outcome"], e.exception.fields["kind"]), ("held", "pipeline"))
        self.assertIn("is not an ancestor of upstream's main", e.exception.why)

    def test_the_decision(self):
        # release in main, main is the baseline: nothing new
        got = release.select(self.wt, self.main0)
        self.assertEqual((got["path"], got["in_main"]["tag"], got["candidate"]), ("nothing", "v3.2.21", None))
        # release in main, main beyond the baseline (our merged patches await delivery): install main's SHA
        got = release.select(self.wt, self.v21)
        self.assertEqual((got["path"], got["candidate"], got["main"]), ("install-main", self.main0, self.main0))
        # ... unless that SHA is quarantined
        got = release.select(self.wt, self.v21, quarantined=lambda sha: sha == self.main0)
        self.assertEqual((got["path"], got["quarantined"]), ("nothing", True))
        # a newer release: take it, whatever the baseline; the release main holds is proven its ancestor
        rel = self.upstream_release("v3.2.22")
        for baseline in (self.main0, self.v21):
            got = release.select(self.wt, baseline)
            self.assertEqual((got["path"], got["release"]["sha"]), ("take", rel))
            self.assertEqual(got["in_main"], {"tag": "v3.2.21", "sha": self.v21})

    def test_no_baseline_or_no_release_in_main_stops(self):
        with self.assertRaises(Refused):
            release.select(self.wt, None)
        git(self.dev, "tag", "-d", "v3.2.20")
        git(self.dev, "push", "-q", "origin", ":refs/tags/v3.2.20", ":refs/tags/v3.2.21")
        git(self.dev, "checkout", "-q", "--orphan", "other")
        self.commit(self.dev, "unrelated")
        git(self.dev, "tag", "v4.0.0")
        git(self.dev, "push", "-q", "-f", "origin", "other:main", "v4.0.0")
        with self.assertRaises(Refused) as e:
            release.select(self.wt, self.v21)
        self.assertIn("no upstream release is an ancestor of origin/main", e.exception.why)


class SelectCommand(World):
    def test_select_records_the_run_and_its_phase(self):
        code, out = self.sync("select")
        self.assertEqual((code, out["path"], out["candidate"]), (0, "install-main", self.main0), out)
        st = self.st()
        self.assertEqual((st["phase"], st["candidate"], st["main"]), ("selected", self.main0, self.main0))
        self.assertEqual((st["run"]["key"], st["run"]["path"], st["run"]["start"]), (self.RUN, "install-main",
                                                                                      self.start))
        rel = self.upstream_release("v3.2.22")
        code, out = self.sync("select")
        self.assertEqual((out["path"], out["release"]["sha"], out["held"]), ("take", rel, []))
        self.assertEqual((self.st()["candidate"], self.st()["release"]["tag"]), (None, "v3.2.22"))

    def test_nothing_new_leaves_the_phase(self):
        self.edit(baseline={"sha": self.main0}, phase="healthy")
        code, out = self.sync("select")
        self.assertEqual((code, out["path"]), (0, "nothing"))
        self.assertEqual(self.st()["phase"], "healthy")

    def test_a_held_record_for_the_release_is_named(self):
        rel = self.upstream_release("v3.2.22")
        with state.locked(self.p) as st:
            state.hold(st, "v3.2.22", rel, "trial", "trial", "the trial failed")
        code, out = self.sync("select")
        self.assertEqual(out["held"], ["trial"])

    def test_only_the_leases_owner_and_never_mid_install(self):
        code, out = self.sync("select", run="SYNC-2")
        self.assertEqual((code, out["outcome"]), (1, "stop"))
        self.edit(phase="installing")
        code, out = self.sync("select")
        self.assertEqual((code, out["outcome"]), (1, "stop"))
        self.assertIn("installing", out["why"])

    def test_every_gh_call_names_the_fork(self):
        self.upstream_release("v3.2.22")
        self.sync("select")
        self.assertEqual(self.gh_calls(), [], "select needs no GitHub API")


class ReviewInputs(World):
    def setUp(self):
        super().setUp()
        self.rel = self.upstream_release("v3.2.22")
        code, out = self.sync("select")
        self.assertEqual(out["path"], "take")

    def test_the_three_files(self):
        merge, head = self.sync_branch("v3.2.22", self.rel)
        code, out = self.sync("review-inputs", paths_ok=True)
        self.assertEqual(code, 0, out)
        self.assertEqual((out["head"], out["merge"], out["old_main"]), (head, merge, self.main0))
        gitdir = git(self.wt, "rev-parse", "--absolute-git-dir")
        self.assertIn(os.sep + "worktrees" + os.sep, gitdir, "the run's worktree's own git dir")
        read = {}
        for k, n in (("footprint", "footprint.diff"), ("patches", "patches.range-diff"),
                     ("resolutions", "resolutions.diff")):
            with open(os.path.join(gitdir, "sync-review", n)) as f:
                read[k] = f.read()
        # our footprint on the release: our files and our side of a.txt, none of upstream's own commits
        self.assertIn("fork/ours.py", read["footprint"])
        self.assertIn("+two, ours", read["footprint"])
        self.assertNotIn("b.txt", read["footprint"])
        # how our patch moved: range-diff of the old release..old main against the new
        self.assertIn("our patch", read["patches"])
        # the conflict resolution, which range-diff skips, and the adaptation after the merge
        self.assertIn("two, ours", read["resolutions"])
        self.assertIn("adapt our patch", read["resolutions"])
        st = self.st()
        self.assertEqual((st["phase"], st["sync"]["head"], st["sync"]["branch"]), ("branch-pushed", head,
                                                                                    "sync/v3.2.22"))

    def test_the_head_must_be_pushed_and_checked_out(self):
        code, out = self.sync("review-inputs")
        self.assertEqual((code, out["outcome"]), (1, "stop"))
        self.assertIn("isn't on origin", out["why"])
        merge, head = self.sync_branch("v3.2.22", self.rel)
        self.commit(self.wt, "not pushed yet")
        code, out = self.sync("review-inputs")
        self.assertIn("isn't sync/v3.2.22's pushed head", out["why"])

    def test_a_trial_on_the_head_moves_the_phase(self):
        merge, head = self.sync_branch("v3.2.22", self.rel)
        self.sync("review-inputs", paths_ok=True)
        with state.locked(self.p) as st:
            state.record_trial(st, head, release.tree(self.wt, head))
        self.assertEqual(self.st()["phase"], "tried")
        code, out = self.sync("review-inputs", paths_ok=True)
        self.assertEqual(code, 1, "after the trial the inputs are fixed")


if __name__ == "__main__":
    unittest.main()
