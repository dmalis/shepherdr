"""Friction loop, slice 7 (#94): a failed action's Report. What the person sends from the box Report opened is kept
as a report from that action (`--person --action "<label>"`), and goes the way of every other report: told, offered,
drafted, never posted here. The label is a few plain words from the app's fixed list, only with --person, and refused
in an agent's terminal like every person's call. Slice 1's throwaway store, settings file and fakes
(test_feedback_found.World); hc and gh are faked, nothing is sent or filed."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import unittest
from unittest import mock

from test_feedback_found import World  # noqa: E402  (World has no tests of its own: none run twice)


class FromAnAction(World):
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
        self.caller = {}

    def test_a_sent_report_is_kept_from_the_action_and_told(self):
        code, out = self.say("Mark as done didn't work", "--person", "--action", "Mark as done", "--space", "sp2", "--json")
        self.assertEqual(code, 0, out)
        (p,) = self.listed()
        self.assertEqual((p["space"], p["reports"][0]["from"], p["line"]), ("sp2", {"action": "Mark as done"}, "Mark as done didn't work"))
        self.assertEqual([to for to, _ in self.held], ["t6"])  # saved first, then told to that space's Assistant
        self.assertEqual(self.gh, [])  # nothing searched or posted

    def test_the_same_words_again_count_on_one_problem(self):
        for _ in range(2):
            self.assertEqual(self.say("Start didn't work", "--person", "--action", "Start", "--space", "sp1", "--json")[0], 0)
        (p,) = self.listed()
        self.assertEqual((p["count"], [r["from"] for r in p["reports"]]), (2, [{"action": "Start"}] * 2))

    def test_a_label_is_plain_words_and_only_with_person(self):
        for argv in (["--action", "Mark as done"],  # not the person's
                     ["--person", "--action", "Merge failed in /home/sam/shop"],  # an error's text, not a label
                     ["--person", "--action", "mark as done"], ["--person", "--action", ""],
                     ["--person", "--action", "Mark as done and then " + "also " * 8]):
            code, out = self.say("It didn't work", *argv, "--space", "sp1", "--json")
            self.assertNotEqual(code, 0, argv)
            self.assertIn("--action", out)
        self.assertFalse(os.path.exists(self.state))

    def test_refused_in_an_agents_terminal(self):
        os.environ["HC_TERMINAL_ID"] = "t9"
        code, out = self.say("Mark as done didn't work", "--person", "--action", "Mark as done", "--space", "sp1")
        self.assertNotEqual(code, 0)
        self.assertIn("Only the person", out)
        self.assertFalse(os.path.exists(self.state))

    def test_a_space_with_offers_off_keeps_nothing(self):
        self.settings({"everywhere": {"agents": {"feedback": True}}, "spaces": {"sp2": {"agents": {"feedback": False}}}})
        code, out = self.say("Send didn't work", "--person", "--action", "Send", "--space", "sp2", "--json")
        self.assertEqual((code, json.loads(out)["why"]), (0, "off"))
        self.assertFalse(os.path.exists(self.state))


class Pins(unittest.TestCase):
    """The seams slice 7 relies on (#94): the report's `from` comes from feedback_page.person_from, and herdr-task's
    --action is the person's own flag."""

    def test_person_from(self):
        from types import SimpleNamespace as NS
        from herdr_task.feedback_page import person_from
        self.assertEqual(person_from(NS(person=True, action=None)), {"person": True})
        self.assertEqual(person_from(NS(person=True, action="Send")), {"action": "Send"})
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "..", "mods", "tasks", "bin", "herdr_task", "feedback.py"), encoding="utf-8") as f:
            self.assertIn('"from": person_from(args) if getattr(args, "person", False) else from_of(', f.read())


if __name__ == "__main__":
    unittest.main()
