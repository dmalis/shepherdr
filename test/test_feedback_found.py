"""Friction loop, slice 1 (#94): every report of a problem in Shepherdr is kept. herdr-task feedback saves a report
before anyone is told, keeps it with no Assistant running, gives new problems an id that keeps negations and every
script's words (an old row still takes its own line), records only from a space with Feedback offers on, keeps the
first report's space as the origin, reads without writing, keeps an unreadable record aside and lets nothing undecided
expire. A throwaway store and settings file; hc and gh are faked, nothing is sent or filed. Made-up names only."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import contextlib
import fcntl
import inspect
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = os.path.join(ROOT, "mods", "tasks", "bin")
sys.path.insert(0, BIN)
sys.dont_write_bytecode = True

import herdr_task.cli as cli  # noqa: E402
import herdr_task.feedback as fb  # noqa: E402
import herdr_task.launch as launch  # noqa: E402
import herdr_task.settings as settings  # noqa: E402

DAY = 24 * 3600000
TASK = {"labels": {"herdr.task": "dev#7", "herdr.task.space": "sp1", "herdr.agent": "codex"}, "name": "shep-7-fix"}


class Kept(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="feedback-found-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.file = os.path.join(self.dir, "shepherdr.json")
        self.state = os.path.join(self.dir, ".feedback.json")
        self.held, self.gh = [], []
        self.caller = TASK
        self.assistants = {"sp1": "t5", "sp2": "t6"}
        self.settings({"here": "vm-test"})
        with open(os.path.join(self.dir, "dev.json"), "w") as f:
            json.dump({"prefix": "SHEP", "tasks": [{"id": 7, "title": "Fix login"}]}, f)

        def run(args, **_):
            self.gh.append(args)
            if args[1:3] == ["issue", "list"]:
                return subprocess.CompletedProcess(args, 0, "[]", "")
            if "--body-file" in args:
                with open(args[args.index("--body-file") + 1]) as f:
                    self.body = f.read()
                return subprocess.CompletedProcess(args, 0, "https://github.com/acme/shep/issues/42\n", "")
            return subprocess.CompletedProcess(args, 1, "", "unexpected")

        space = lambda: (self.caller.get("labels") or {}).get("herdr.task.space") or (self.caller.get("labels") or {}).get("herdr.space")
        for target, name, value in [
            (settings, "SETTINGS", self.file), (fb, "STATE", self.state), (fb, "STORE", self.dir),
            (fb, "me", lambda: (("t9" if self.caller else None), self.caller)), (fb, "run", run),
            (fb, "cli_version", lambda agent: "0.9.1"), (fb, "private_words", lambda: ["Jane Doe", "Jane"]),
            (fb, "shepherdr_version", lambda: "3.2.22"), (fb, "own_core_check", lambda: None),
            (launch, "caller_space", space), (launch, "coordinator_in", lambda sp: self.assistants.get(sp)),
            (fb, "queue_news", lambda to, text: self.held.append((to, text))),
        ]:
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def settings(self, d):
        with open(self.file, "w") as f:
            json.dump(d, f)

    def say(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["herdr-task", "feedback", *argv]), contextlib.redirect_stdout(out), \
                contextlib.redirect_stderr(out):
            code = cli.main()
        return code, out.getvalue()

    def listed(self):
        code, out = self.say("--list", "--all", "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)

    def seed(self, problems):
        with open(self.state, "w") as f:
            json.dump({"problems": problems}, f)

    def raw(self):
        with open(self.state, "rb") as f:
            return f.read()

    # ---- kept ---------------------------------------------------------------------------------

    def test_a_report_with_no_assistant_is_kept(self):
        self.assistants = {}
        code, out = self.say("The Accept card shows an empty diff", "--details", "Expected its 3 files.",
                             "--fix", "Show the diff's files", "--kind", "bug")
        self.assertEqual(code, 0, out)
        self.assertIn("kept", out)
        self.assertEqual(self.held, [])
        (p,) = self.listed()
        self.assertEqual((p["state"], p["line"], p["space"], p["count"], p["fix"], p["kind"]),
                         ("found", "The Accept card shows an empty diff", "sp1", 1, "Show the diff's files", "bug"))
        self.assertEqual(p["id"], p["key"])
        (r,) = p["reports"]
        self.assertEqual({k: r[k] for k in ("space", "machine", "from", "line", "details")},
                         {"space": "sp1", "machine": "vm-test", "from": {"task": "Fix login"},
                          "line": "The Accept card shows an empty diff", "details": "Expected its 3 files."})
        # an Assistant starts later: the next report tells it, once
        self.assistants = {"sp1": "t5"}
        self.say("The Accept card shows an empty diff")
        self.assertEqual(len(self.held), 1)
        self.assertEqual(self.listed()[0]["state"], "told")

    def test_a_repeat_adds_a_report_and_sends_news_once(self):
        self.say("Status lines vanish after a restart", "--details", "First time.")
        code, out = self.say("status lines vanish after the restart", "--details", "Second time.")
        self.assertIn("already has this one", out)
        self.assertEqual(len(self.held), 1)
        self.assertEqual(self.held[0][0], "t5")
        (p,) = self.listed()
        self.assertEqual(p["count"], 2)
        self.assertEqual([r["details"] for r in p["reports"]], ["First time.", "Second time."])
        self.assertEqual([r["line"] for r in p["reports"]], ["Status lines vanish after a restart", "status lines vanish after the restart"])

    def test_saved_before_told(self):
        """The news goes out only once the report is on disk."""
        seen = []
        with mock.patch.object(fb, "queue_news", lambda to, text: seen.append(json.loads(self.raw()))):
            self.say("Status lines vanish after a restart")
        (d,) = seen
        (p,) = d["problems"].values()
        self.assertEqual((p["state"], len(p["reports"])), ("told", 1))

    def test_a_send_that_fails_keeps_the_report(self):
        def boom(to, text):
            raise OSError("no fork")
        with mock.patch.object(fb, "queue_news", boom):
            code, out = self.say("Status lines vanish after a restart")
        self.assertEqual(code, 0, out)
        self.assertIn("Kept", out)
        self.assertEqual(self.listed()[0]["state"], "found")

    def test_a_declined_one_keeps_counting(self):
        self.say("Status lines vanish after a restart")
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1"}, "name": "assistant"}
        self.say("--key", self.listed()[0]["key"], "--no")
        self.caller = TASK
        self.assertIn("said no", self.say("Status lines vanish after a restart")[1])
        (p,) = self.listed()
        self.assertEqual((p["state"], p["count"]), ("declined", 2))
        self.assertEqual(len(self.held), 1)

    # ---- identity -----------------------------------------------------------------------------

    def test_not_after_a_declined_old_row_is_a_new_problem(self):
        old = fb.key_of("Reply context is shown")
        self.assertEqual(old, fb.key_of("Reply context is not shown"))  # upstream's collision, pinned
        self.seed({old: {"line": "Reply context is shown", "state": "declined", "at": fb.now(), "space": "sp1"}})
        code, out = self.say("Reply context is not shown")
        self.assertIn("Sent to your Assistant", out)
        rows = {r["line"]: r for r in self.listed()}
        self.assertEqual(rows["Reply context is shown"]["state"], "declined")
        self.assertEqual(rows["Reply context is not shown"]["state"], "told")
        self.assertNotEqual(rows["Reply context is not shown"]["key"], old)
        self.assertEqual(len(self.held), 1)

    def test_a_second_japanese_line_after_a_declined_first_is_a_new_problem(self):
        a, b = "返信の吹き出しに元のメッセージが出ない", "タスクの状態が再起動で消える"
        self.assertEqual(fb.key_of(a), fb.key_of(b))  # upstream keeps ASCII words only: both are the empty key
        self.seed({fb.key_of(a): {"line": a, "state": "declined", "at": fb.now(), "space": "sp1"}})
        self.assertIn("Sent to your Assistant", self.say(b)[1])
        rows = {r["line"]: r for r in self.listed()}
        self.assertEqual((rows[a]["state"], rows[b]["state"]), ("declined", "told"))
        self.assertNotEqual(fb.id_of(a), fb.id_of(b))

    def test_an_old_row_still_takes_a_report_of_its_own_line(self):
        line = "Status lines vanish after a restart"
        old = fb.key_of(line)
        self.seed({old: {"line": line, "state": "told", "at": fb.now(), "space": "sp1", "details": "Upstream's words.", "by": "SHEP-7"}})
        self.assertIn("already has this one", self.say("status lines vanish after the restart")[1])
        (p,) = self.listed()
        self.assertEqual((p["key"], p["id"], p["count"]), (old, old, 2))
        self.assertEqual([r.get("details") for r in p["reports"]], ["Upstream's words.", None])

    def test_negations_and_words_without_letters(self):
        self.assertNotEqual(fb.id_of("Reply context is shown"), fb.id_of("Reply context isn't shown"))
        self.assertEqual(fb.id_of("Reply context isn't shown"), fb.id_of("reply context is NOT shown"))
        self.assertEqual(fb.id_of("Reply context doesn’t show"), fb.id_of("Reply context does not show"))
        self.assertNotEqual(fb.id_of("it is"), fb.id_of("is it"))  # no telling word: the line as written

    # ---- spaces -------------------------------------------------------------------------------

    def test_a_report_from_a_space_with_offers_off_is_not_recorded(self):
        self.settings({"spaces": {"sp1": {"agents": {"feedback": False}}}})
        code, out = self.say("Status lines vanish after a restart")
        self.assertIn("off in Settings", out)
        self.assertFalse(os.path.exists(self.state))
        self.assertEqual(self.held, [])

    def test_a_web_report_with_space_of_a_space_with_offers_off_is_not_recorded(self):
        """The web app has no terminal: it names the space. Off there wins over Everywhere's on."""
        self.caller = {}
        self.settings({"everywhere": {"agents": {"feedback": True}}, "spaces": {"sp2": {"agents": {"feedback": False}}}})
        code, out = self.say("Status lines vanish after a restart", "--space", "sp2")
        self.assertIn("off in Settings", out)
        self.assertFalse(os.path.exists(self.state))
        # on there: kept, with that space
        code, out = self.say("Status lines vanish after a restart", "--space", "sp3")
        self.assertEqual(self.listed()[0]["space"], "sp3")

    def test_a_caller_in_a_space_cant_name_another(self):
        code, out = self.say("Status lines vanish after a restart", "--space", "sp2")
        self.assertEqual(code, 1)
        self.assertIn("your own space", out)
        self.assertFalse(os.path.exists(self.state))

    def test_a_second_spaces_report_keeps_the_first_as_origin(self):
        self.say("Status lines vanish after a restart")
        self.caller = {"labels": {"herdr.task": "dev#7", "herdr.task.space": "sp2"}, "name": "shep-7-fix"}
        self.say("Status lines vanish after a restart")
        (p,) = self.listed()
        self.assertEqual(p["space"], "sp1")
        self.assertEqual([r["space"] for r in p["reports"]], ["sp1", "sp2"])
        # the person's No said in the second space keeps the origin too
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp2"}, "name": "assistant"}
        self.say("--key", p["key"], "--no")
        self.assertEqual(self.listed()[0]["space"], "sp1")

    # ---- read and kept ------------------------------------------------------------------------

    def test_list_all_changes_nothing_on_disk(self):
        self.assistants = {}
        self.say("Status lines vanish after a restart")
        old = {fb.key_of("Ready hangs"): {"line": "Ready hangs", "state": "told", "at": fb.now() - 100 * DAY}}
        with open(self.state) as f:
            d = json.load(f)
        d["problems"].update(old)
        with open(self.state, "w") as f:
            json.dump(d, f)
        before, mtime = self.raw(), os.stat(self.state).st_mtime_ns
        os.remove(self.state + ".lock")
        self.assertEqual(len(self.listed()), 2)
        self.say("--list")  # upstream's list, in this space: read only too
        self.assertEqual((self.raw(), os.stat(self.state).st_mtime_ns), (before, mtime))
        self.assertFalse(os.path.exists(self.state + ".lock"))
        # a store nobody may write to still reads
        os.chmod(self.dir, stat.S_IRUSR | stat.S_IXUSR)
        self.addCleanup(os.chmod, self.dir, stat.S_IRWXU)
        self.assertEqual(len(self.listed()), 2)

    def test_a_corrupt_record_is_kept_aside_not_overwritten(self):
        with open(self.state, "w") as f:
            f.write('{"problems": {"abc": {"line": "half a wr')
        code, out = self.say("--list", "--all", "--json")
        self.assertEqual(code, 1)
        self.assertIn("can't be read", out)
        self.assertEqual(self.raw(), b'{"problems": {"abc": {"line": "half a wr')
        self.say("Status lines vanish after a restart")
        (aside,) = [n for n in os.listdir(self.dir) if n.startswith(".feedback.json.bad-")]
        with open(os.path.join(self.dir, aside)) as f:
            self.assertEqual(f.read(), '{"problems": {"abc": {"line": "half a wr')
        self.assertEqual([p["line"] for p in self.listed()], ["Status lines vanish after a restart"])

    def test_nothing_undecided_expires(self):
        long_ago = fb.now() - 100 * DAY
        self.seed({fb.key_of("Ready hangs"): {"line": "Ready hangs", "state": "told", "at": long_ago, "details": "Kept words."},
                   fb.key_of("Offered once"): {"line": "Offered once", "state": "offered", "at": long_ago},
                   fb.key_of("Said no long ago"): {"line": "Said no long ago", "state": "declined", "at": long_ago,
                                                   "details": "Old words.", "space": "sp1"}})
        self.say("Status lines vanish after a restart")  # any write
        rows = {r["line"]: r for r in self.listed()}
        self.assertEqual(set(rows), {"Ready hangs", "Offered once", "Said no long ago", "Status lines vanish after a restart"})
        self.assertEqual(rows["Ready hangs"]["details"], "Kept words.")
        # a No's report text goes after 90 days; its line, state and id stay, so it is still a No
        no = rows["Said no long ago"]
        self.assertEqual((no["state"], no.get("details")), ("declined", None))
        self.assertIn("said no", self.say("Said no long ago")[1])

    def test_an_upstream_shaped_record_reads_unchanged(self):
        k1, k2 = fb.key_of("Ready refuses a reviewed commit"), fb.key_of("Status lines vanish")
        upstream = {k1: {"line": "Ready refuses a reviewed commit", "state": "told", "at": fb.now(), "space": "sp1",
                         "details": "It said no round.", "agent": "codex", "by": "SHEP-7"},
                    k2: {"line": "Status lines vanish", "state": "filed", "at": fb.now(), "url": "https://github.com/acme/shep/issues/9"}}
        self.seed(upstream)
        before = self.raw()
        rows = {r["key"]: r for r in self.listed()}
        self.assertEqual({k: {f: v for f, v in r.items() if f not in ("id", "key")} for k, r in rows.items()}, upstream)
        self.assertEqual((rows[k1]["id"], rows[k2]["id"]), (k1, k2))
        self.assertEqual(json.loads(self.say("--list", "--json")[1]), [{"key": k1, **upstream[k1]}])
        # an answer that changes nothing writes nothing
        self.assertIn("Already filed", self.say("--key", k2)[1])  # not a report: nothing changes, nothing is written
        self.assertEqual(self.raw(), before)

    def test_the_reporters_fix_goes_in_the_issue(self):
        self.say("Status lines vanish after a restart", "--fix", "Keep each status line in the store")
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1", "herdr.agent": "claude"}, "name": "assistant"}
        code, out = self.say("--key", self.listed()[0]["key"], "--file", "--new")
        self.assertIn("Filed:", out)
        self.assertIn("## Suggested fix\n\nKeep each status line in the store", self.body)
        (p,) = self.listed()
        self.assertEqual((p["state"], p["count"]), ("filed", 1))

    def test_a_report_while_filing_is_kept_when_filing_fails(self):
        self.say("Status lines vanish after a restart")
        key = self.listed()[0]["key"]
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1"}, "name": "assistant"}

        def gh(args, **_):
            self.caller, keep = TASK, self.caller
            try:
                self.say("Status lines vanish after a restart", "--details", "Meanwhile.")
            finally:
                self.caller = keep
            return subprocess.CompletedProcess(args, 1, "", "HTTP 502")
        with mock.patch.object(fb, "run", gh):
            code, out = self.say("--key", key, "--file", "--new")
        self.assertEqual(code, 1)
        (p,) = self.listed()
        self.assertEqual((p["state"], p["count"]), ("told", 2))
        self.assertEqual(p["reports"][-1]["details"], "Meanwhile.")


class Pins(unittest.TestCase):
    """The upstream seams this patch relies on (#94): their names and arguments."""

    def test_names_and_arguments(self):
        self.assertEqual(list(inspect.signature(fb.key_of).parameters), ["line"])
        self.assertEqual(list(inspect.signature(fb.redact).parameters), ["text", "private"])
        self.assertEqual(fb.key_of("Ready refuses a reviewed commit"), fb.key_of("ready refuses the reviewed commit"))
        self.assertRegex(fb.key_of("Ready refuses a reviewed commit"), r"^[0-9a-f]{10}$")
        self.assertTrue(callable(fb.problems().__enter__))
        self.assertEqual(fb.STATE, os.path.join(fb.STORE, ".feedback.json"))

    def test_the_record_is_written_under_its_lock(self):
        d = tempfile.mkdtemp(prefix="feedback-lock-")
        self.addCleanup(shutil.rmtree, d, True)
        with mock.patch.object(fb, "STATE", os.path.join(d, ".feedback.json")):
            with fb.problems() as ps:
                with open(fb.STATE + ".lock", "a") as lock:
                    with self.assertRaises(OSError):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                ps["x"] = {"line": "x"}
            self.assertEqual(fb.read_problems(), {"x": {"line": "x"}})

    def test_the_commands_keep_their_flags(self):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["herdr-task", "feedback", "--help"]), contextlib.redirect_stdout(out), \
                self.assertRaises(SystemExit):
            cli.main()
        out = types.SimpleNamespace(stdout=out.getvalue())
        for flag in ("--list", "--file", "--no", "--key", "--details", "--fix", "--kind", "--all", "--space", "--json", "--dry-run", "--comment", "--new"):
            self.assertIn(flag, out.stdout, flag)


if __name__ == "__main__":
    unittest.main()
