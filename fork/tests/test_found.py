"""`fork/bin/found` (fork/specs/friction-loop.md, "The fork's parts", slice 9; Part of #94): in this fork every yes to
file becomes work in this repo's space, once, and each install tells the Feedback page what it carries.

The feedback record is real: a problem reported, drafted, approved and posted through herdr-task's own feedback code
(slice 4's World, its fake gh keeping what it was asked to post), then listed with the real `--list --all --json`. That
list, the space's Assistants and every tell-assistant go through a fake herdr-task first on PATH, which logs each send
and can fail it or lose its answer; a fake gh answers issue reads. `found` runs as a subprocess on a scratch root.
Nothing reaches GitHub, hc or the live session. Made-up names only."""
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
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

import test_feedback_post as tfp  # noqa: E402  (as a module: its test classes don't run again here)

fb = tfp.fb
FOUND = os.path.join(ROOT, "fork", "bin", "found")
OURS = "dmalis/shepherdr"
URL = f"https://github.com/{OURS}/issues/"

FAKE_HERDR_TASK = r'''#!/usr/bin/env python3
import json, os, sys
d = os.environ["FOUND_FAKE"]
a = sys.argv[1:]
def log(name, v):
    with open(os.path.join(d, name), "a") as f:
        f.write(json.dumps(v) + "\n")
if a == ["feedback", "--list", "--all", "--json"]:
    print(open(os.path.join(d, "list.json")).read()); sys.exit(0)
if a == ["assistants", "--json"]:
    print(open(os.path.join(d, "assistants.json")).read()); sys.exit(0)
if a[:1] == ["tell-assistant"]:
    if os.path.exists(os.path.join(d, "send-fails")):
        sys.exit("Not delivered to " + a[1] + ": couldn't deliver to " + a[1])
    log("sends.jsonl", a[1:])
    if os.path.exists(os.path.join(d, "send-lost")):  # it went, but no answer came back in time
        sys.exit(1)
    print("Delivered to " + a[1] + "."); sys.exit(0)
if a[:3] == ["list", "--json", "--folder"]:
    log("lists.jsonl", a[3])
    path = os.path.join(d, "tasks.json")
    print(open(path).read() if os.path.exists(path) else '{"tasks": []}'); sys.exit(0)
if a[:2] == ["feedback", "--installed"]:
    log("installed.jsonl", a)
    print(json.dumps({"build": a[2], "issues": a.count("--try-it"), "here": [], "gone": []})); sys.exit(0)
sys.exit("unexpected: " + " ".join(a))
'''

FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
d = os.environ["FOUND_FAKE"]
a = sys.argv[1:]
with open(os.path.join(d, "gh.jsonl"), "a") as f:
    f.write(json.dumps(a) + "\n")
if a[:2] == ["issue", "view"] and a[3:5] == ["-R", "dmalis/shepherdr"] and a[5:] == ["--json", "body"]:
    bodies = json.load(open(os.path.join(d, "issues.json")))
    if a[2] not in bodies:
        sys.exit("GraphQL: Could not resolve to an issue or pull request with the number of " + a[2])
    print(json.dumps({"body": bodies[a[2]]})); sys.exit(0)
sys.exit("unexpected: " + " ".join(a))
'''


class Found(tfp.World):
    """A real feedback record in a scratch store, filed to our repo; the fakes above; a scratch root and space folder."""

    report, as_assistant, draft, person, one = (tfp.Posted.report, tfp.Posted.as_assistant, tfp.Posted.draft,
                                                tfp.Posted.person, tfp.Posted.one)

    def setUp(self):
        super().setUp()
        self.github = tfp.GitHub()
        p = mock.patch.object(fb, "run", self.github)
        p.start()
        self.addCleanup(p.stop)
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": OURS}}})
        self.fake = tempfile.mkdtemp(prefix="found-fake-")
        self.root = tempfile.mkdtemp(prefix="found-root-")
        self.space = os.path.realpath(tempfile.mkdtemp(prefix="found-space-"))
        for d in (self.fake, self.root, self.space):
            self.addCleanup(shutil.rmtree, d, True)
        bin_ = os.path.join(self.fake, "bin")
        os.makedirs(bin_)
        for name, text in (("herdr-task", FAKE_HERDR_TASK), ("gh", FAKE_GH)):
            with open(os.path.join(bin_, name), "w") as f:
                f.write(text)
            os.chmod(os.path.join(bin_, name), 0o755)
        self.env = {**os.environ, "FOUND_FAKE": self.fake, "PATH": bin_ + os.pathsep + os.environ["PATH"]}
        self.in_spaces([{"target": "sp-dev", "machine": "", "route": "", "space": "sp-dev", "space_name": "shepherdr-dev",
                          "folder": self.space, "role": "assistant"},
                         {"target": "everything", "machine": "", "route": "", "space": "all", "folder": self.space,
                          "role": "everything"}])
        self.publish()
        with open(os.path.join(self.fake, "issues.json"), "w") as f:
            json.dump({}, f)

    # ---- the world ----------------------------------------------------------------------------

    def in_spaces(self, rows):
        with open(os.path.join(self.fake, "assistants.json"), "w") as f:
            json.dump(rows, f)

    def publish(self, rows=None):
        """What the fake herdr-task lists: the real record's --list --all --json, or rows given."""
        with open(os.path.join(self.fake, "list.json"), "w") as f:
            json.dump(self.listed() if rows is None else rows, f)

    def flag(self, name, on=True):
        path = os.path.join(self.fake, name)
        if on:
            open(path, "w").close()
        elif os.path.exists(path):
            os.remove(path)

    def found(self, *argv, folder=True, cwd=None):
        r = subprocess.run([sys.executable, FOUND, "--root", self.root, *(["--folder", self.space] if folder else []), *argv],
                           capture_output=True, text=True, env=self.env, timeout=60, cwd=cwd)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertEqual(r.returncode, 0 if out["ok"] else 1, r.stderr)
        return out

    def logged(self, name):
        path = os.path.join(self.fake, name)
        if not os.path.exists(path):
            return []
        with open(path) as f:
            return [json.loads(x) for x in f]

    def record(self):
        with open(os.path.join(self.root, ".local", "state", "shepherdr-fork", "found.json")) as f:
            return json.load(f)["handoffs"]

    def filed(self, line=tfp.LINE, *fields):
        """A task's report, its Assistant's draft, the person's Post it, then the post: as the page's flow does it."""
        key = self.report(line)
        d = self.draft(key, *fields)
        self.assertEqual(self.person("--key", key, "--approve", str(d["rev"]))[0], 0)
        code, out = self.as_assistant("--key", key, "--file", "--rev", str(d["rev"]))
        self.assertEqual(code, 0, out)
        self.publish()
        return key, out

    def tasks(self):
        path = os.path.join(self.fake, "tasks.json")
        if not os.path.exists(path):
            return []
        with open(path) as f:
            return json.load(f)["tasks"]

    def receive(self, running=None, dies=False):
        """This space's Assistant on each message it got, as FORK.md says: `found task` first; none, then the work goes
        in a task (a reply to `running` when one fits, else a new task with the link in its brief) and `found took`.
        `dies`: it restarts before its `found took`. -> the work it added, one entry per piece."""
        work = []
        for _, text in self.logged("sends.jsonl")[len(getattr(self, "_seen", [])):]:
            key = re.search(r"fork/bin/found task (\S+?):", text).group(1)
            url = re.search(r"(https://github\.com/\S+?/issues/[0-9]+)", text).group(1)
            if self.found("task", key)["task"]:
                continue
            if running:
                task = running
            else:
                task = f"SD-{50 + len(self.tasks())}"
                rows = self.tasks() + [{"ref": task, "title": "Reply bubble quote", "prompt": f"Fix {url} (shaped)."}]
                with open(os.path.join(self.fake, "tasks.json"), "w") as f:
                    json.dump({"tasks": rows}, f)
            work.append((task, key))
            if dies:
                break
            self.assertTrue(self.found("took", key, "--task", task)["ok"])
        self._seen = self.logged("sends.jsonl")
        return work

    # ---- the handoff --------------------------------------------------------------------------

    def test_a_posted_new_issue_is_handed_off_once_with_its_link_and_no_private_words(self):
        key, out = self.filed()
        self.assertTrue(out["filed"], out)
        first = self.found()
        self.assertEqual((first["made"], first["sent"], first["pending"]), ([f"{OURS}#40"], [f"{OURS}#40"], []))
        (to, text), = self.logged("sends.jsonl")
        self.assertEqual(to, "sp-dev")   # this space's Assistant, never Everything's
        self.assertIn(f"{URL}40", text)
        self.assertIn(f"fork/bin/found task {OURS}#40:", text)
        self.assertIn(f"fork/bin/found took {OURS}#40 --task", text)
        for private in (tfp.LINE, "Seen in the chat", "It shows no quote", key, self.space, self.root, "Jane", "vm-test"):
            self.assertNotIn(private, text)
        h = self.record()[f"{OURS}#40"]
        self.assertEqual((h["state"], h["url"], h["problem"], h["sends"]), ("sent", f"{URL}40", key, 1))
        again = self.found()
        self.assertEqual((again["made"], again["sent"]), ([], []))
        self.assertEqual(len(self.logged("sends.jsonl")), 1)

    def test_one_handoff_per_issue_identity_and_none_for_another_repo(self):
        self.filed()
        rows = self.listed()
        (row,) = rows
        twin = json.loads(json.dumps(row))       # a second problem whose post named the same issue, its repo cased
        twin["id"] = twin["key"] = "reply-bubble-twin"
        twin["post"]["target"]["repo"] = "DMalis/Shepherdr"
        twin["post"]["url"] = "https://github.com/DMalis/Shepherdr/issues/40"
        theirs = json.loads(json.dumps(row))     # Shepherdr's own issue 40: the same number, another repo
        theirs["id"] = theirs["key"] = "upstream-40"
        theirs["post"]["target"]["repo"] = tfp.UP
        theirs["post"]["url"] = f"https://github.com/{tfp.UP}/issues/40"
        self.publish(rows + [twin, theirs])
        out = self.found()
        self.assertEqual(out["made"], [f"{OURS}#40"])
        self.assertEqual(list(self.record()), [f"{OURS}#40"])
        self.assertEqual(len(self.logged("sends.jsonl")), 1)

    def test_a_comment_makes_no_handoff(self):
        key, out = self.filed(tfp.LINE, "--comment", "12")
        self.assertTrue(out["filed"], out)
        self.assertEqual(self.one(key)["post"]["target"], {"repo": OURS, "action": "comment", "issue": 12})
        self.assertEqual(self.found()["made"], [])
        self.assertEqual(self.logged("sends.jsonl"), [])

    def test_a_post_found_posted_only_by_reconciling_is_handed_off_on_the_next_run(self):
        self.github.mode = "lose"                 # it went out, the answer was lost, and GitHub didn't show it yet: unsure
        self.github.lost_from_reads = True
        key, out = self.filed()
        self.github.lost_from_reads = False
        self.assertFalse(out.get("filed"), out)
        self.assertEqual(self.one(key)["post"]["state"], "unsure")
        self.assertEqual(self.found()["made"], [])
        code, out = self.as_assistant("--key", key, "--reconcile")
        self.assertTrue(out["filed"], out)
        self.publish()
        self.assertEqual(self.found()["made"], [f"{OURS}#40"])
        self.assertEqual(len(self.github.posts()), 1)
        self.assertEqual(len(self.logged("sends.jsonl")), 1)

    def test_a_failed_send_stays_pending_and_is_sent_again(self):
        self.filed()
        self.flag("send-fails")
        out = self.found()
        self.assertEqual((out["made"], out["sent"], out["pending"]), ([f"{OURS}#40"], [], [f"{OURS}#40"]))
        h = self.record()[f"{OURS}#40"]
        self.assertEqual((h["state"], h["sends"]), ("pending", 0))
        self.assertIn("couldn't deliver", h["why"])
        self.flag("send-fails", False)
        out = self.found()
        self.assertEqual((out["made"], out["sent"]), ([], [f"{OURS}#40"]))
        self.assertEqual(len(self.logged("sends.jsonl")), 1)
        self.assertNotIn("why", self.record()[f"{OURS}#40"])

    def test_with_no_assistant_in_the_space_it_waits(self):
        self.filed()
        self.in_spaces([{"target": "sp-other", "route": "", "folder": self.root, "role": "assistant"},
                         {"target": "vm/sp-dev", "route": "vm", "folder": self.space, "role": "assistant"}])
        out = self.found()
        self.assertEqual(out["pending"], [f"{OURS}#40"])
        self.assertIn("isn't running", self.record()[f"{OURS}#40"]["why"])
        self.assertEqual(self.logged("sends.jsonl"), [])

    def test_a_lost_answer_sent_again_makes_one_new_task(self):
        self.filed()
        self.flag("send-lost")                    # delivered, but its answer never came back
        self.assertEqual(self.found()["pending"], [f"{OURS}#40"])
        self.flag("send-lost", False)
        self.assertEqual(self.found()["sent"], [f"{OURS}#40"])    # the same message, twice in its chat
        self.assertEqual(len(self.logged("sends.jsonl")), 2)
        self.assertEqual(self.receive(), [("SD-50", f"{OURS}#40")])
        self.assertEqual(self.found("task", f"{OURS}#40")["task"], "SD-50")
        self.assertEqual(self.found("task", "#40")["task"], "SD-50")
        self.assertEqual(self.found("task", f"{URL}40")["task"], "SD-50")

    def test_a_lost_answer_sent_again_makes_one_reply_to_a_running_task(self):
        self.filed()
        self.flag("send-lost")
        self.found()
        self.flag("send-lost", False)
        self.assertEqual(self.found()["sent"], [f"{OURS}#40"])    # both messages wait in its chat
        self.assertEqual(len(self.logged("sends.jsonl")), 2)
        self.assertEqual(self.receive(running="SD-31"), [("SD-31", f"{OURS}#40")])   # one reply; the second asks first
        self._age(f"{OURS}#40")
        self.assertEqual(self.found()["sent"], [])   # taken: never sent again
        self.assertEqual(self.tasks(), [])

    def test_a_task_added_before_its_took_was_lost_is_found_by_its_brief(self):
        self.filed()
        self.found()
        self.assertEqual(self.receive(dies=True), [("SD-50", f"{OURS}#40")])     # added, then restarted: no took
        self.assertEqual(self.record()[f"{OURS}#40"]["state"], "sent")
        self._age(f"{OURS}#40")
        self.assertEqual(self.found()["sent"], [f"{OURS}#40"])
        self.assertEqual(self.receive(), [])                                      # `found task` names SD-50
        self.assertEqual([t["ref"] for t in self.tasks()], ["SD-50"])
        h = self.record()[f"{OURS}#40"]
        self.assertEqual((h["state"], h["task"], h["by"]), ("taken", "SD-50", "brief"))
        self.assertEqual(self.logged("lists.jsonl")[-1], self.space)

    def test_a_brief_naming_another_issue_is_not_taken_for_it(self):
        self.filed()
        self.found()
        with open(os.path.join(self.fake, "tasks.json"), "w") as f:
            json.dump({"tasks": [{"ref": "SD-9", "prompt": f"Fix {URL}400 and {URL}4."},
                                 {"ref": "not a key", "prompt": f"{URL}40"}]}, f)
        self.assertEqual(self.found("task", f"{OURS}#40")["task"], None)
        self.assertEqual(self.record()[f"{OURS}#40"]["state"], "sent")

    def test_from_another_folder_it_still_hands_off_to_this_repos_space(self):
        self.filed()
        code = subprocess.run(["git", "-C", os.path.dirname(FOUND), "rev-parse", "--path-format=absolute",
                               "--git-common-dir"], capture_output=True, text=True)
        if code.returncode:
            self.skipTest("fork/bin/found isn't in a git checkout here")
        home = os.path.realpath(os.path.dirname(code.stdout.strip()))
        self.in_spaces([{"target": "sp-other", "route": "", "folder": self.root, "role": "assistant"},
                        {"target": "sp-home", "route": "", "folder": home, "role": "assistant"}])
        self.found(folder=False, cwd=self.root)     # called from another space's folder
        self.assertEqual([to for to, _ in self.logged("sends.jsonl")], ["sp-home"])

    def test_took_closes_it_and_a_second_task_is_refused(self):
        self.filed()
        self.found()
        self.assertEqual(self.found("took", f"{OURS}#40", "--task", "SD-50"), {"ok": True, "issue": f"{OURS}#40", "task": "SD-50"})
        self.assertTrue(self.found("took", "40", "--task", "SD-50")["ok"])     # the same again: nothing changes
        refused = self.found("took", f"{OURS}#40", "--task", "SD-51")
        self.assertFalse(refused["ok"])
        self.assertEqual(refused["task"], "SD-50")
        h = self.record()[f"{OURS}#40"]
        self.assertEqual((h["state"], h["task"]), ("taken", "SD-50"))
        self._age(f"{OURS}#40")
        self.assertEqual(self.found()["sent"], [])
        self.assertEqual(len(self.logged("sends.jsonl")), 1)

    def test_sent_but_not_taken_a_day_later_is_sent_again(self):
        self.filed()
        self.found()
        self.assertEqual(self.found()["sent"], [])
        self._age(f"{OURS}#40")
        self.assertEqual(self.found()["sent"], [f"{OURS}#40"])
        self.assertEqual(self.record()[f"{OURS}#40"]["sends"], 2)

    def _age(self, key):
        path = os.path.join(self.root, ".local", "state", "shepherdr-fork", "found.json")
        with open(path) as f:
            data = json.load(f)
        data["handoffs"][key]["sent"] -= 25 * 3600
        with open(path, "w") as f:
            json.dump(data, f)

    def test_issue_names_are_checked(self):
        self.assertFalse(self.found("task", "next week")["ok"])
        self.assertFalse(self.found("took", "#4", "--task", "next week")["ok"])
        self.assertEqual(self.found("task", "acme/shep#4"), {"ok": True, "issue": "acme/shep#4", "url": "https://github.com/acme/shep/issues/4",
                                                              "state": None, "task": None})

    def test_an_unreadable_list_changes_nothing(self):
        with open(os.path.join(self.fake, "list.json"), "w") as f:
            f.write("not json")
        out = self.found()
        self.assertFalse(out["ok"])
        self.assertFalse(os.path.exists(os.path.join(self.root, ".local", "state", "shepherdr-fork", "found.json")))


class Installed(unittest.TestCase):
    """`found installed <build>`: the patch list at that commit, each issue's Device check line, told to herdr-task."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="found-installed-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.fake, self.repo = os.path.join(self.dir, "fake"), os.path.join(self.dir, "repo")
        bin_ = os.path.join(self.fake, "bin")
        os.makedirs(bin_)
        for name, text in (("herdr-task", FAKE_HERDR_TASK), ("gh", FAKE_GH)):
            with open(os.path.join(bin_, name), "w") as f:
                f.write(text)
            os.chmod(os.path.join(bin_, name), 0o755)
        self.env = {**os.environ, "FOUND_FAKE": self.fake, "PATH": bin_ + os.pathsep + os.environ["PATH"],
                    "GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "T",
                    "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_CONFIG_NOSYSTEM": "1"}
        os.makedirs(os.path.join(self.repo, "fork", "patches"))
        self.git("init", "-q", "-b", "main")
        for n in (8, 31):
            self.patch(n)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "two patches")
        self.build = self.git("rev-parse", "HEAD")
        os.remove(os.path.join(self.repo, "fork", "patches", "31.json"))   # the working tree moved on: not what's installed
        self.patch(77)
        with open(os.path.join(self.fake, "issues.json"), "w") as f:
            json.dump({"8": "## Status\n\nbuilding. Try it: open the chat.\n\nDevice check: open the app from the home "
                            "screen: the header's first row is sharp\n", "31": "No device line here."}, f)

    def git(self, *args):
        return subprocess.run(["git", "-C", self.repo, *args], capture_output=True, text=True, check=True, env=self.env).stdout.strip()

    def patch(self, n):
        with open(os.path.join(self.repo, "fork", "patches", f"{n}.json"), "w") as f:
            json.dump({"issue": n, "name": f"patch {n}", "files": [], "tests": []}, f)

    def found(self, *argv):
        r = subprocess.run([sys.executable, FOUND, "--root", self.dir, "installed", *argv, "--repo", self.repo],
                           capture_output=True, text=True, env=self.env, timeout=60)
        return r.returncode, json.loads(r.stdout.strip().splitlines()[-1])

    def told(self):
        with open(os.path.join(self.fake, "installed.jsonl")) as f:
            return [json.loads(x) for x in f]

    def test_the_installed_patch_lists_issues_go_with_the_installed_build(self):
        code, out = self.found(self.build)
        self.assertEqual(code, 0, out)
        self.assertEqual((out["build"], out["issues"], out["unread"]), (self.build, [8, 31], []))
        (argv,) = self.told()
        self.assertEqual(argv, ["feedback", "--installed", self.build, "--issues", f"{URL}8", f"{URL}31",
                                "--try-it", f"{URL}8", "open the app from the home screen: the header's first row is sharp",
                                "--json"])

    def test_an_issue_github_cant_read_still_goes_without_try_it_words(self):
        with open(os.path.join(self.fake, "issues.json"), "w") as f:
            json.dump({}, f)
        code, out = self.found(self.build)
        self.assertEqual(code, 0, out)
        self.assertEqual(out["unread"], [8, 31])
        self.assertEqual(self.told(), [["feedback", "--installed", self.build, "--issues", f"{URL}8", f"{URL}31", "--json"]])

    def test_a_bad_build_tells_nothing(self):
        self.assertEqual(self.found("main")[0], 1)
        self.assertEqual(self.found("0" * 40)[0], 1)   # no such commit: no patch list
        self.assertFalse(os.path.exists(os.path.join(self.fake, "installed.jsonl")))


class Seams(unittest.TestCase):
    """What found relies on in herdr-task (upstream's and slice 6's): if one moves, the next sync sees it here."""

    def test_herdr_tasks_commands_keep_their_names_and_fields(self):
        with open(os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task", "cli.py")) as f:
            cli = f.read()
        for want in ('add_parser("tell-assistant"', 'add_parser("assistants"', 'g.add_argument("--installed"',
                     'c.add_argument("--issues", nargs="*"', 'c.add_argument("--try-it", nargs=2, action="append"'):
            self.assertIn(want, cli)
        with open(os.path.join(ROOT, "mods", "tasks", "bin", "herdr_task", "machines.py")) as f:
            machines = f.read()
        for field in ('"target"', '"route"', '"folder"', '"role"'):
            self.assertIn(field, machines)


if __name__ == "__main__":
    unittest.main()
