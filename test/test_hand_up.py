"""dmalis/shepherdr "Needs you 6b: hand-up": Shepherdr hands a task's wait up to the person (herdr_task/hand_up.py,
`herdr-task alert --task`). Plain dicts and a faked task list; hc is never run."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import argparse
import contextlib
import json
import sys
import unittest
from unittest import mock

import test_herdr_task as H

sys.path.insert(0, H.BIN)

from herdr_task import commands, hand_up  # noqa: E402
from herdr_task.base import Fail  # noqa: E402


def task(n, wait_id=None, **wait):
    t = {"id": n, "title": f"Task {n}", "state": "running"}
    if wait_id:
        t["wait"] = {"id": wait_id, "gen": 1, "kind": "reply", "why": "Which plan?", "mark": "m", "first": 1000, "deadline": 301000, **wait}
    return t


class Mark(unittest.TestCase):
    def test_hands_up_the_open_wait_with_its_ask_and_choices(self):
        t = task(1, "w1")
        got = hand_up.mark([t], "a1", "Choose a migration plan", "Two plans, both tested", ["In place", "Copy then swap", "In place"], at=5000)
        self.assertEqual(got, ["w1"])
        self.assertEqual(t["wait"]["up"], {"at": 5000, "what": "Choose a migration plan", "why": "Two plans, both tested",
                                           "choices": ["In place", "Copy then swap"], "lead": "w1", "alert": "a1"})

    def test_choices_are_short_and_at_most_four(self):
        self.assertEqual(hand_up.choices_of(["a", " ", "b", "c", "d", "e"]), ["a", "b", "c", "d"])
        self.assertEqual(len(hand_up.choices_of(["x" * 200])[0]), hand_up.CHOICE_MAX)

    def test_a_late_hand_up_writes_nothing(self):
        over = task(1, "w1", outcome={"how": "moved-on", "at": 2})
        self.assertEqual(hand_up.mark([over], "a1", "Choose"), [])
        self.assertNotIn("up", over["wait"])
        # a new question replaced the one it answers
        t = task(2, "w2")
        self.assertEqual(hand_up.mark([t], "a1", "Choose", wait="w-old"), [])
        self.assertNotIn("up", t["wait"])
        self.assertEqual(hand_up.mark([task(3)], "a1", "Choose"), [], "no wait at all")

    def test_one_question_over_several_tasks_shares_one_lead(self):
        a, b = task(1, "wa"), task(2, "wb")
        self.assertEqual(hand_up.mark([a, b], "a1", "Pick one database for both", wait=["wa", "wb"]), ["wa", "wb"])
        self.assertEqual({a["wait"]["up"]["lead"], b["wait"]["up"]["lead"]}, {"wa"})

    def test_a_second_hand_up_of_the_same_wait_keeps_its_lead_and_time(self):
        t = task(1, "w1")
        hand_up.mark([t], "a1", "Choose", at=5000)
        hand_up.mark([t], "a2", "Choose now", at=9000, lead="other")
        self.assertEqual((t["wait"]["up"]["lead"], t["wait"]["up"]["at"], t["wait"]["up"]["what"]), ("w1", 5000, "Choose now"))

    def test_settle_takes_it_back_once(self):
        t = task(1, "w1")
        hand_up.mark([t], "a1", "Choose", at=5000)
        self.assertEqual(hand_up.settle([t], at=7000), ["w1"])
        self.assertEqual(t["wait"]["up"]["settled"], 7000)
        self.assertEqual(hand_up.settle([t], at=8000), [], "already taken back")
        # handed up again after: a fresh hand-up (its own time), not the old one's
        hand_up.mark([t], "a3", "Choose again", at=9000)
        self.assertEqual((t["wait"]["up"]["at"], t["wait"]["up"].get("settled")), (9000, None))


class FakeStore:
    def __init__(self, tasks):
        self.tasks, self.dirty = {str(t["id"]): t for t in tasks}, False

    def find(self, ref):
        return self.tasks[ref.split("-")[-1]]

    def ref(self, t):
        return f"SD-{t['id']}"


class AlertCommand(unittest.TestCase):
    def setUp(self):
        self.tasks = {"1": task(1, "w1"), "2": task(2, "w2")}
        self.stores, self.labels = [], []

        @contextlib.contextmanager
        def open_store(args, write=True, wait=None):
            s = FakeStore([self.tasks[args.id.split("-")[-1]]])
            self.stores.append(s)
            yield s

        self.said = []
        for name, value in (("open_store", open_store), ("caller_labels", lambda: {"herdr.role": "coordinator"}),
                            ("run", lambda argv, **k: self.labels.append(argv) or mock.Mock(returncode=0, stdout="", stderr="")),
                            ("say", lambda args, data, text: self.said.append((data, text)))):
            p = mock.patch.object(commands, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.dict("os.environ", {"HC_TERMINAL_ID": "t-asst"})
        p.start()
        self.addCleanup(p.stop)

    def alert(self, title="", task=None, wait=None, choice=None, settled=False, body=None):
        commands.cmd_alert(argparse.Namespace(title=title, body=body, task=task, wait=wait, choice=choice, settled=settled, folder=None, json=False))

    def label(self):
        return json.loads(self.labels[-1][-1].split("=", 1)[1])

    def test_a_hand_up_marks_the_wait_and_its_label_names_it(self):
        self.alert("Choose a migration plan", task=["SD-1"], wait=["w1"], choice=["In place", "Copy then swap"])
        up = self.tasks["1"]["wait"]["up"]
        self.assertEqual((up["what"], up["choices"]), ("Choose a migration plan", ["In place", "Copy then swap"]))
        self.assertTrue(self.stores[0].dirty)
        lab = self.label()
        self.assertEqual((lab["task"], lab["about"], lab["waits"]), ("SD-1", True, ["w1"]))
        self.assertEqual(up["alert"], lab["id"])
        self.assertIn("Handed up", self.said[-1][1])

    def test_one_question_two_tasks_one_lead(self):
        self.alert("Pick one database for both", task=["SD-1", "SD-2"], wait=["w1", "w2"])
        self.assertEqual(self.tasks["2"]["wait"]["up"]["lead"], "w1")
        self.assertEqual(self.label()["tasks"], ["SD-1", "SD-2"])

    def test_late_sends_nothing(self):
        self.alert("Choose", task=["SD-1"], wait=["w-gone"])
        self.assertEqual(self.labels, [], "no label: nothing buzzes")
        self.assertNotIn("up", self.tasks["1"]["wait"])
        self.assertEqual(self.said[-1][0], {"sent": False, "late": True, "task": "SD-1"})

    def test_settled_takes_it_back(self):
        self.alert("Choose", task=["SD-1"])
        self.alert(task=["SD-1"], settled=True)
        self.assertIn("settled", self.tasks["1"]["wait"]["up"])
        self.assertEqual(self.said[-1][0], {"settled": ["SD-1"]})

    def test_wait_choice_or_settled_need_a_task(self):
        for kw in ({"wait": ["w1"]}, {"choice": ["a"]}, {"settled": True}):
            with self.assertRaises(Fail):
                self.alert("Choose", **kw)

    def test_an_assistants_bare_alert_says_it_stays_in_the_bell(self):
        self.alert("Disk nearly full", body="92% used")
        self.assertNotIn("about", self.label())
        self.assertIn("Kept in the bell", self.said[-1][1])


if __name__ == "__main__":
    unittest.main()
