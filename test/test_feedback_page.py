"""Friction loop, slice 2 (#94): the person's own calls on a kept problem, from the Feedback page. Not now
(`--later`), Never (`--no --person`), Undo and the box's report (`--person --space`) work only outside an agent's
terminal, stay local (nothing is filed), and Not now ends when the problem is reported again. Slice 1's throwaway
store, settings file and fakes (test_feedback_found.World); hc and gh are faked, nothing is sent or filed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import contextlib
import io
import json
import os
import sys
import unittest
from unittest import mock

from test_feedback_found import DAY, World, fb  # noqa: E402  (World has no tests of its own: none run twice)
import herdr_task.feedback_page as page  # noqa: E402


class Person(World):
    """The service runs these for the person's tap: no agent's terminal (no HC_TERMINAL_ID), no caller labels."""

    def setUp(self):
        super().setUp()
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("HC_TERMINAL_ID", None)
        os.environ.pop("HC_TERMINAL_SOCKET", None)
        foreign = mock.patch("herdr_task.base.FOREIGN_TERMINAL", False, create=True)
        foreign.start()
        self.addCleanup(foreign.stop)

    def report(self, line="The reply bubble doesn't show which message it answers", space="sp1"):
        """An agent's report from sp1's task, then back to the person's side."""
        was, self.caller = self.caller, dict(self.caller or {})
        try:
            code, out = self.say(line, "--details", "Seen twice today.", "--json")
        finally:
            self.caller = was
        self.assertEqual(code, 0, out)
        return json.loads(out)["key"]

    def person(self, *argv):
        self.caller = {}
        return self.say(*argv)

    def one(self, key):
        return next(p for p in self.listed() if p["key"] == key)

    # ---- the box ------------------------------------------------------------------------------

    def test_the_boxs_report_is_kept_from_the_person_and_told(self):
        code, out = self.person("Feedback page needs a search", "--person", "--space", "sp2", "--json")
        self.assertEqual(code, 0, out)
        (p,) = self.listed()
        self.assertEqual((p["space"], p["reports"][0]["from"], p["count"]), ("sp2", {"person": True}, 1))
        self.assertEqual([to for to, _ in self.held], ["t6"])  # saved first, then told to that space's Assistant
        self.assertEqual(self.gh, [])

    def test_the_boxs_report_from_a_space_with_offers_off_is_refused_even_with_everywhere_on(self):
        self.settings({"everywhere": {"agents": {"feedback": True}}, "spaces": {"sp2": {"agents": {"feedback": False}}}})
        code, out = self.person("Feedback page needs a search", "--person", "--space", "sp2", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out)["why"], "off")
        self.assertFalse(os.path.exists(self.state))

    def test_the_boxs_report_names_its_space(self):
        code, out = self.person("Feedback page needs a search", "--person")
        self.assertNotEqual(code, 0)
        self.assertIn("--space", out)
        self.assertFalse(os.path.exists(self.state))

    # ---- Not now, Never, Undo ------------------------------------------------------------------

    def test_not_now_tomorrow_keeps_the_state_and_ends_on_a_new_report(self):
        key = self.report()
        before = self.one(key)["state"]
        code, out = self.person("--key", key, "--later", "tomorrow", "--json")
        self.assertEqual(code, 0, out)
        p = self.one(key)
        self.assertEqual((p["decision"], p["state"]), ("later", before))
        self.assertAlmostEqual(p["until"], fb.now() + DAY, delta=60000)
        self.assertFalse(page.comes_back(p))
        self.assertTrue(page.comes_back(p, at=p["until"] + 1))
        self.report()  # reported again: back under Found, its count grown
        p = self.one(key)
        self.assertEqual((p.get("decision"), p.get("until"), p["count"]), (None, None, 2))
        self.assertEqual(self.gh, [])

    def test_not_now_when_it_happens_again_has_no_time(self):
        key = self.report()
        code, out = self.person("--key", key, "--later", "again", "--json")
        self.assertEqual(code, 0, out)
        p = self.one(key)
        self.assertEqual((p["decision"], p["until"]), ("later", None))
        self.assertFalse(page.comes_back(p, at=fb.now() + 365 * DAY))

    def test_undo_puts_a_not_now_back(self):
        key = self.report()
        state = self.one(key)["state"]
        self.person("--key", key, "--later", "week")
        code, out = self.person("--key", key, "--undo", "--json")
        self.assertEqual(code, 0, out)
        p = self.one(key)
        self.assertEqual((p.get("decision"), p.get("until"), p["state"], "was" in p), (None, None, state, False))

    def test_never_is_declined_keeps_counting_and_undo_puts_it_back(self):
        key = self.report()
        state = self.one(key)["state"]
        code, out = self.person("--key", key, "--no", "--person", "--json")
        self.assertEqual(code, 0, out)
        p = self.one(key)
        self.assertEqual((p["state"], p["decision"]), ("declined", "declined"))
        held = len(self.held)
        self.report()  # reported again after Never: stays declined, told to nobody, but counted
        p = self.one(key)
        self.assertEqual((p["state"], p["count"], len(self.held)), ("declined", 2, held))
        code, out = self.person("--key", key, "--undo", "--json")
        self.assertEqual(code, 0, out)
        p = self.one(key)
        self.assertEqual((p["state"], p.get("decision")), (state, None))

    def test_undo_of_a_no_said_in_chat_brings_it_back_as_found(self):
        self.seed({"abc123": {"id": "abc123", "line": "Old one", "state": "declined", "at": fb.now()}})
        code, out = self.person("--key", "abc123", "--undo", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.one("abc123")["state"], "found")

    def test_nothing_to_undo_changes_nothing(self):
        key = self.report()
        raw = self.raw()
        code, out = self.person("--key", key, "--undo", "--json")
        self.assertEqual(code, 0, out)
        self.assertFalse(json.loads(out)["changed"])
        self.assertEqual(self.raw(), raw)

    def test_a_filed_problem_has_nothing_to_decide(self):
        self.seed({"abc123": {"id": "abc123", "line": "Old one", "state": "filed", "url": "https://github.com/acme/shep/issues/4"}})
        raw = self.raw()
        code, out = self.person("--key", "abc123", "--later", "week", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out)["why"], "filed")
        self.assertEqual(self.raw(), raw)

    def test_an_unknown_key_is_refused(self):
        self.report()
        code, out = self.person("--key", "nope", "--later", "week")
        self.assertNotEqual(code, 0)
        self.assertIn("No problem", out)

    # ---- refused in an agent's terminal --------------------------------------------------------

    def test_every_person_call_is_refused_in_an_agents_terminal(self):
        key = self.report()
        raw = self.raw()
        os.environ["HC_TERMINAL_ID"] = "t9"
        for argv in (["--key", key, "--later", "tomorrow"], ["--key", key, "--undo"], ["--key", key, "--no", "--person"],
                     ["Feedback page needs a search", "--person", "--space", "sp1"]):
            code, out = self.person(*argv)
            self.assertNotEqual(code, 0, argv)
            self.assertIn("Only the person", out)
        self.assertEqual(self.raw(), raw)

    def test_another_sessions_terminal_is_an_agents_terminal_too(self):
        """base drops a terminal id from another core session (FOREIGN_TERMINAL): still refused, as a bare socket is."""
        key = self.report()
        raw = self.raw()
        with mock.patch("herdr_task.base.FOREIGN_TERMINAL", True, create=True):
            code, out = self.person("--key", key, "--undo")
        self.assertNotEqual(code, 0)
        self.assertIn("Only the person", out)
        os.environ["HC_TERMINAL_SOCKET"] = "/tmp/a-terminal.sock"
        code, out = self.person("--key", key, "--later", "week")
        self.assertNotEqual(code, 0)
        self.assertEqual(self.raw(), raw)
        self.assertFalse(page.in_agent_terminal({}))

    def test_the_assistants_own_no_still_works(self):
        key = self.report()
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.coordinator.space": "sp1"}, "name": "assistant"}
        with mock.patch("herdr_task.launch.is_coordinator", lambda k: True):
            os.environ["HC_TERMINAL_ID"] = "t5"
            code, out = self.say("--key", key, "--no", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.one(key)["state"], "declined")

    # ---- what the chat sees (review round 1) ----------------------------------------------------

    def assistant(self, *argv):
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1"}, "name": "assistant"}
        with mock.patch("herdr_task.launch.is_coordinator", lambda k: True):
            return self.say(*argv)

    def test_not_now_keeps_it_out_of_the_chat_until_it_comes_back(self):
        key = self.report()
        self.assertEqual(self.person("--key", key, "--later", "week", "--json")[0], 0)
        code, out = self.assistant("--list", "--json")
        self.assertEqual((code, [r["key"] for r in json.loads(out)]), (0, []))
        code, out = self.assistant("--key", key, "--json")
        self.assertEqual((code, json.loads(out)["why"]), (0, "later"))
        self.assertNotEqual(self.one(key).get("state"), "offered")
        # its week is over: listed and offered again, nothing rewritten in the meantime
        with mock.patch.object(fb, "now", lambda: self.one(key)["until"] + 1), mock.patch.object(page, "now", lambda: self.one(key)["until"] + 1):
            self.assertEqual([r["key"] for r in json.loads(self.assistant("--list", "--json")[1])], [key])
            self.assertTrue(json.loads(self.assistant("--key", key, "--json")[1])["offer"])

    def test_a_said_no_from_the_page_is_not_listed_in_chat(self):
        key = self.report()
        self.assertEqual(self.person("--key", key, "--no", "--person", "--json")[0], 0)
        self.assertEqual(json.loads(self.assistant("--list", "--json")[1]), [])

    def test_a_box_report_from_another_machines_space_goes_to_no_chat_here(self):
        # this core's sp2 is another space than vm's sp2: kept for the page, never handed to the local sp2's chat
        with mock.patch("herdr_task.launch.coordinator_in", lambda sp: self.assistants.get(sp.split("/")[-1])):
            code, out = self.person("Feedback page needs a search", "--person", "--space", "vm/sp2", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual((json.loads(out)["why"], self.held), ("elsewhere", []))
        self.assertEqual(self.listed()[0]["space"], "vm/sp2")
        # nor listed or offered in this machine's sp2 chat, whose id only looks the same
        self.assistants = {"sp1": "t5"}
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp2"}, "name": "assistant"}
        with mock.patch("herdr_task.launch.is_coordinator", lambda k: True):
            self.assertEqual(json.loads(self.say("--list", "--json")[1]), [])
            key = self.listed()[0]["key"]
            self.assertEqual(json.loads(self.say("--key", key, "--json")[1])["why"], "elsewhere")

    def test_the_persons_calls_are_never_sent_to_another_machine(self):
        from herdr_task import cli
        for argv in (["--key", "k1", "--later", "week"], ["--key", "k1", "--undo"], ["--key", "k1", "--no", "--person"],
                     ["The page needs a search", "--person", "--space", "sp1"], ["--key", "k1", "--later=week"],
                     ["--key", "k1", "--lat", "week"], ["--key", "k1", "--und"], ["--key", "k1", "--no", "--pers"]):
            with mock.patch.object(cli, "remote", side_effect=AssertionError("sent")):
                out = io.StringIO()
                with mock.patch.object(sys, "argv", ["herdr-task", "--on", "vm", "feedback", *argv]), contextlib.redirect_stderr(out):
                    self.assertEqual(cli.main(), 1, argv)
                self.assertIn("own Feedback page", out.getvalue())
        # a line that only reads like one, after --, is an agent's ordinary report there
        with mock.patch.object(cli, "remote", return_value=0) as sent, mock.patch.object(sys, "argv", ["herdr-task", "--on", "vm", "feedback", "--", "--undo is broken"]):
            self.assertEqual(cli.main(), 0)
        sent.assert_called_once()

    def test_an_old_undo_leaves_a_newer_decision_alone(self):
        key = self.report()
        self.person("--key", key, "--later", "week", "--json")           # device A: Not now (its toast keeps Undo)
        self.person("--key", key, "--undo", "--expect", "later", "--json")  # device B: Restore
        self.person("--key", key, "--no", "--person", "--json")           # device B: Never
        code, out = self.person("--key", key, "--undo", "--expect", "later", "--json")  # A's old Undo
        self.assertEqual((code, json.loads(out)["changed"]), (0, False))
        self.assertEqual(self.one(key)["state"], "declined")
        # Said no's own Undo still works
        self.assertTrue(json.loads(self.person("--key", key, "--undo", "--expect", "declined", "--json")[1])["changed"])
        self.assertNotEqual(self.one(key)["state"], "declined")


class Pins(unittest.TestCase):
    """The upstream seams this slice relies on (#94): their names and arguments."""

    def test_the_seams(self):
        import inspect
        self.assertEqual(list(inspect.signature(fb.add_report).parameters), ["ps", "key", "report", "fix", "kind"])
        self.assertTrue(callable(fb.problems) and callable(fb.list_all))
        self.assertIn('"from":', inspect.getsource(fb.cmd_feedback))


if __name__ == "__main__":
    unittest.main()
