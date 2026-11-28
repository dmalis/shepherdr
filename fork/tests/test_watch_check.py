"""`fork/bin/watch-check` (fork/specs/fewer-runs.md; Part of #230): the "Watch upstream issues" schedule's check. It
runs as a subprocess against a real git checkout whose `upstream` remote is a scratch repo, with a fake gh first on
PATH (it answers from files and logs every call). Nothing reaches GitHub. Made-up issue numbers and names only."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402

CHECK = os.path.join(ROOT, "fork", "bin", "watch-check")

FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
d = os.environ["WATCH_FAKE"]
a = sys.argv[1:]
with open(os.path.join(d, "calls"), "a") as f:
    f.write(json.dumps(a) + "\n")
if os.path.exists(os.path.join(d, "down")):
    sys.stderr.write("error connecting to api.github.com\n"); sys.exit(1)
if a[:2] == ["api", "user"]:
    print("person"); sys.exit(0)
if a[:2] == ["api", "--paginate"]:
    repo = a[2].split("/issues")[0].split("repos/")[1].replace("/", "_")
    p = os.path.join(d, repo + ".json")
    for i in json.load(open(p)) if os.path.exists(p) else []:
        print(json.dumps({"number": i["number"], "updated_at": i["updated_at"], "user": i.get("user", "someone"),
                          "pr": i.get("pr", False), "labels": i.get("labels", [])}))
    sys.exit(0)
sys.exit(3)
'''


def git(cwd, *args):
    return subprocess.run(["git", "-C", cwd, "-c", "user.name=T", "-c", "user.email=t@example.com", *args],
                          check=True, capture_output=True, text=True).stdout.strip()


class WatchCheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.fake = os.path.join(self.tmp, "fake")
        bin_ = os.path.join(self.tmp, "bin")
        os.makedirs(self.fake)
        os.makedirs(bin_)
        with open(os.path.join(bin_, "gh"), "w") as f:
            f.write(FAKE_GH)
        os.chmod(os.path.join(bin_, "gh"), 0o755)
        self.env = {**os.environ, "PATH": bin_ + os.pathsep + os.environ["PATH"], "WATCH_FAKE": self.fake}
        self.up = os.path.join(self.tmp, "up")
        subprocess.run(["git", "init", "-q", "-b", "main", self.up], check=True)
        git(self.up, "commit", "-q", "--allow-empty", "-m", "Release 1.0.0")
        git(self.up, "tag", "v1.0.0")
        self.space = os.path.join(self.tmp, "space")
        subprocess.run(["git", "init", "-q", "-b", "main", self.space], check=True)
        git(self.space, "remote", "add", "upstream", self.up)
        git(self.space, "fetch", "-q", "upstream", "--tags")
        self.private = os.path.join(self.space, ".private")
        os.makedirs(self.private)
        self.view = {"upstream_head": git(self.up, "rev-parse", "HEAD"), "fork_seen": [3, 4],
                     "issues": {"501": {"state": "OPEN", "updatedAt": "2026-11-20T10:00:00Z"},
                                "502": {"state": "CLOSED", "updatedAt": "2026-11-21T10:00:00Z"}}}
        self.write_view()

    def write_view(self):
        with open(os.path.join(self.private, "upstream-watch.json"), "w") as f:
            json.dump(self.view, f)

    def answers(self, repo, issues):
        with open(os.path.join(self.fake, repo.replace("/", "_") + ".json"), "w") as f:
            json.dump(issues, f)

    def check(self):
        r = subprocess.run([CHECK], cwd=self.space, env=self.env, capture_output=True, text=True, timeout=60)
        return r.returncode, r.stdout.strip().splitlines(), r.stderr.strip()

    def checkpoint(self):
        try:
            with open(os.path.join(self.private, "upstream-watch-check.json")) as f:
                return json.load(f)["since"]
        except FileNotFoundError:
            return None

    def calls(self):
        with open(os.path.join(self.fake, "calls")) as f:
            return [json.loads(x) for x in f]

    def test_nothing_moved_starts_nothing_and_moves_the_checkpoint(self):
        self.answers("eliasstravik/shepherdr", [{"number": 501, "updated_at": "2026-11-20T10:00:00Z"},
                                                {"number": 777, "updated_at": "2026-11-22T10:00:00Z"}])
        self.answers("dmalis/shepherdr", [{"number": 3, "updated_at": "2026-11-22T10:00:00Z"},
                                          {"number": 9, "updated_at": "2026-11-22T10:00:00Z", "labels": ["patch"]},
                                          {"number": 10, "updated_at": "2026-11-22T10:00:00Z", "pr": True}])
        code, out, err = self.check()
        self.assertEqual(code, 1, (out, err))
        self.assertEqual(out, ["nothing moved since 2026-11-21T10:00:00Z"])  # no checkpoint yet: the view's newest
        since = self.checkpoint()
        self.assertTrue(since)
        self.assertEqual(len(self.calls()), 3)  # light: who the person is, and one list per repo
        self.assertIn("since=2026-11-21T10:00:00Z", self.calls()[1][2])
        self.check()
        self.assertIn(f"since={since}", self.calls()[4][2])

    def test_what_moved_is_listed_and_the_checkpoint_stays(self):
        self.answers("eliasstravik/shepherdr", [{"number": 502, "updated_at": "2026-11-23T09:00:00Z"},
                                                {"number": 600, "updated_at": "2026-11-23T09:00:00Z", "user": "person"}])
        self.answers("dmalis/shepherdr", [{"number": 12, "updated_at": "2026-11-23T09:00:00Z", "labels": ["bug"]}])
        git(self.up, "commit", "-q", "--allow-empty", "-m", "Fix the thing (#501)")
        git(self.up, "tag", "v1.0.1")
        code, out, _ = self.check()
        self.assertEqual(code, 0)
        self.assertEqual(out[:2], ["upstream 502 updated 2026-11-23T09:00:00Z", "upstream 600 is new, by the person"])
        self.assertIn("new upstream tag v1.0.1", out)
        self.assertTrue(any(x.startswith("upstream commit ") and x.endswith(" names 501") for x in out), out)
        self.assertEqual(out[-1], "fork issue 12 is new")
        self.assertIsNone(self.checkpoint())

    def test_an_outage_is_a_failed_check_and_what_moved_meanwhile_is_found_after(self):
        self.answers("eliasstravik/shepherdr", [])
        self.answers("dmalis/shepherdr", [])
        self.assertEqual(self.check()[0], 1)
        before = self.checkpoint()
        open(os.path.join(self.fake, "down"), "w").close()
        code, _, err = self.check()
        self.assertEqual(code, 255)
        self.assertIn("error connecting to api.github.com", err)
        self.assertEqual(self.checkpoint(), before)
        os.remove(os.path.join(self.fake, "down"))
        self.answers("eliasstravik/shepherdr", [{"number": 501, "updated_at": "2026-11-29T09:00:00Z"}])
        code, out, _ = self.check()
        self.assertEqual((code, out), (0, ["upstream 501 updated 2026-11-29T09:00:00Z"]))
        self.assertIn(f"since={before}", self.calls()[-2][2])  # read from the last good checkpoint

    def test_the_scheduler_reads_its_answers_as_meant(self):
        """Through herdr-task's own result handler (schedule_gate.run_check): moved is work, quiet is nothing, and a
        read that fails is a failed check (never nothing to do, so an outage can't hide a reply)."""
        sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
        from herdr_task import schedule_gate
        from unittest import mock
        job = {"id": 1, "folder": self.space, "command": CHECK, "why": ["time"]}
        self.answers("eliasstravik/shepherdr", [])
        self.answers("dmalis/shepherdr", [])
        with mock.patch.dict(os.environ, self.env):
            self.assertEqual(schedule_gate.run_check(job)[0], "nothing")
            open(os.path.join(self.fake, "down"), "w").close()
            kind, why = schedule_gate.run_check(job)
            self.assertEqual(kind, "failed")
            self.assertIn("it exited 255", why)
            os.remove(os.path.join(self.fake, "down"))
            self.answers("eliasstravik/shepherdr", [{"number": 501, "updated_at": "2026-11-29T09:00:00Z"}])
            self.assertEqual(schedule_gate.run_check(job), ("work", "upstream 501 updated 2026-11-29T09:00:00Z"))

    def test_a_run_that_failed_is_found_again(self):
        """Work found, its agent failed (the view didn't move): the next check still finds it."""
        self.answers("eliasstravik/shepherdr", [{"number": 501, "updated_at": "2026-11-23T09:00:00Z"}])
        self.answers("dmalis/shepherdr", [])
        self.assertEqual(self.check()[0], 0)
        self.assertEqual(self.check()[0], 0)
        self.view["issues"]["501"]["updatedAt"] = "2026-11-23T09:00:00Z"  # the agent's run that worked
        self.write_view()
        self.assertEqual(self.check()[0], 1)

    def test_no_view_yet_is_work(self):
        os.remove(os.path.join(self.private, "upstream-watch.json"))
        code, out, _ = self.check()
        self.assertEqual((code, out), (0, ["no view yet: the watch's first run records everything"]))
        self.assertFalse(os.path.exists(os.path.join(self.fake, "calls")))

    def test_an_unknown_upstream_head_is_work(self):
        self.answers("eliasstravik/shepherdr", [])
        self.answers("dmalis/shepherdr", [])
        self.view["upstream_head"] = "0" * 40
        self.write_view()
        code, out, _ = self.check()
        self.assertEqual((code, out), (0, ["upstream head 000000000000 isn't known here"]))


if __name__ == "__main__":
    unittest.main()
