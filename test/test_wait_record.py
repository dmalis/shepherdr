"""dmalis/shepherdr "Needs you 6a: wait lifecycle": each inferred wait is kept where it happens (herdr_task/wait_record.py),
with an id, a generation, when it was first confirmed, its deadline and its outcome. Throwaway files; hc is never run."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import sys
import unittest

import test_herdr_task as H

sys.path.insert(0, H.BIN)


class WaitLifecycle(unittest.TestCase):
    setUp = H.AcceptCommandNews.setUp

    def run_pass(self, v, began=None, hc_up=True):
        """One news pass with the task's view `v` (its agent quiet), someone last writing to it at `began`."""
        import herdr_task.wait_record as wr  # noqa: F401
        m = self.mock
        with m.patch.object(self.news, "live_agents", return_value=[]), \
                m.patch.object(self.news, "view", lambda s, t, live=None: dict(v)), \
                m.patch.object(self.news, "stall_of", lambda *a: None), \
                m.patch.object(self.news, "turn_began", lambda t, a=None: began), \
                m.patch.object(self.news, "hc_json", lambda *a: {} if hc_up else None):
            self.news.news_pass({})
        return self.task.get("wait")

    def start(self):
        self.task.update(state="running", merged=False)
        self.run_pass({"status": "working", "needs": None, "why": None})  # a first look (or, later, back at work)

    def test_a_wait_is_kept_with_its_id_generation_first_and_deadline(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        w = self.run_pass(reply, began=1000)
        self.assertEqual((w["gen"], w["kind"], w["why"]), (1, "reply", "Which colour?"))
        self.assertRegex(w["id"], r"^[0-9a-f]{16}$")
        self.assertEqual(w["deadline"] - w["first"], 5 * 60000, "Ask me after: 5 minutes by default")
        # read again: the same wait, nothing moved
        again = self.run_pass(reply, began=1000)
        self.assertEqual((again["id"], again["first"], again["deadline"]), (w["id"], w["first"], w["deadline"]))
        # its news names it
        self.assertIn(f'wait="{w["id"]}"', self.sent[0][1])

    def test_a_replacement_question_in_the_same_status_is_a_new_wait(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        w1 = dict(self.run_pass(reply, began=1000))
        self.sent.clear()
        # its Shepherdr answered and the agent asked again, the task reading Needs you all along
        w2 = self.run_pass({**reply, "why": "Which size?"}, began=2000)
        self.assertNotEqual(w2["id"], w1["id"])
        self.assertEqual(w2["gen"], 2)
        self.assertGreaterEqual(w2["first"], w1["first"])
        self.assertEqual(w2["prev"]["id"], w1["id"])
        self.assertEqual(w2["prev"]["how"], "replaced")
        # told again, about the new wait
        self.assertEqual(len(self.sent), 1)
        self.assertIn(f'wait="{w2["id"]}"', self.sent[0][1])
        self.assertIn("Which size?", self.sent[0][1])

    def test_a_queued_line_about_a_replaced_wait_goes_unsaid(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        with self.mock.patch.object(self.news, "NEWS_SETTLE_MS", 10 ** 9):  # nothing settles: lines stay queued
            w1 = dict(self.run_pass(reply, began=1000))
            with open(self.news.NEWS) as f:
                self.assertEqual([x.get("wait") for x in json.load(f)["outbox"]], [w1["id"]])
            w2 = self.run_pass({**reply, "why": "Which size?"}, began=2000)
        with open(self.news.NEWS) as f:
            self.assertEqual([x.get("wait") for x in json.load(f)["outbox"]], [w2["id"]])
        self.sent.clear()
        self.run_pass({**reply, "why": "Which size?"}, began=2000)
        said = re.findall(r'wait="([0-9a-f]+)"', "\n".join(t for _, t in self.sent))
        self.assertEqual(said, [w2["id"]])

    def test_a_restart_keeps_first_seen_and_deadline(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        w = dict(self.run_pass(reply, began=1000))
        # herdr-task (and the scheduler) start again: the task list read back from disk, the news state lost
        self.store.data["tasks"][:] = json.loads(json.dumps(self.store.data["tasks"]))
        self.task = self.store.data["tasks"][0]
        os.remove(self.news.NEWS)
        self.run_pass({"status": "working", "needs": None, "why": None}, hc_up=False)  # a first look again (hc not up yet)
        after = self.run_pass(reply, began=1000)
        self.assertEqual({k: after[k] for k in ("id", "gen", "first", "deadline")}, {k: w[k] for k in ("id", "gen", "first", "deadline")})

    def test_unknown_keeps_it_as_it_was(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        w = dict(self.run_pass(reply, began=1000))
        # herdr-core can't be read: its agents look gone, yet nothing closes or replaces the wait
        self.assertEqual(self.run_pass({"status": "needs", "needs": "stopped", "why": "Agent stopped"}, hc_up=False), w)
        self.assertEqual(self.run_pass({"status": "working", "needs": None, "why": None}, hc_up=False), w)

    def test_how_a_wait_ends(self):
        for view, how in (({"status": "working", "needs": None, "why": None}, "moved-on"),
                          ({"status": "needs", "needs": "asks", "why": "Asks permission"}, "person"),
                          ({"status": "needs", "needs": "stopped", "why": "Stopped by you.", "stopped_by": "you"}, "paused")):
            with self.subTest(how=how):
                self.task.pop("wait", None)
                self.start()
                w = dict(self.run_pass({"status": "needs", "needs": "attention", "why": "Checks failing"}))
                ended = self.run_pass(view)
                self.assertEqual((ended["id"], ended["outcome"]["how"]), (w["id"], how))
        # a task gone (done) closes its wait too
        self.task.pop("wait", None)
        self.start()
        self.run_pass({"status": "needs", "needs": "attention", "why": "Checks failing"})
        self.task["state"] = "done"
        self.assertEqual(self.run_pass({"status": "done", "needs": None, "why": None})["outcome"]["how"], "gone")

    def test_back_within_a_moment_is_the_same_wait(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        w = dict(self.run_pass(reply, began=1000))
        self.run_pass({"status": "working", "needs": None, "why": None}, began=1000)
        back = self.run_pass(reply, began=1000)
        self.assertEqual((back["id"], back["first"], back.get("outcome")), (w["id"], w["first"], None))

    def test_the_person_s_prompt_is_no_inferred_wait(self):
        self.start()
        self.assertIsNone(self.run_pass({"status": "needs", "needs": "asks", "why": "Asks permission"}))
        self.assertIsNone(self.run_pass({"status": "needs", "needs": "stopped", "why": "Stopped by you.", "stopped_by": "you"}))


class AskAfter(unittest.TestCase):
    def test_minutes_right_away_or_the_default(self):
        sys.path.insert(0, H.BIN)
        from herdr_task.wait_record import ask_after_ms
        self.assertEqual([ask_after_ms({"tasks": {"ask_after": v}}) for v in (10, 0, "now", "right away", None, "soon", True, -3)],
                         [600000, 0, 0, 0, 300000, 300000, 300000, 300000])
        self.assertEqual(ask_after_ms(None), 300000)


if __name__ == "__main__":
    unittest.main()
