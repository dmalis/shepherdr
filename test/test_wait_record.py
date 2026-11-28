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

    def test_the_same_question_after_a_reply_keeps_its_wait_and_deadline(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        w = dict(self.run_pass(reply, began=1000))
        self.assertTrue(self.store.data.get("wait_records"), "the list says it keeps wait records")
        # Shepherdr wrote to it ("noted") and it asked the same again: a reply never moves the deadline
        again = self.run_pass(reply, began=2000)
        self.assertEqual((again["id"], again["first"], again["deadline"]), (w["id"], w["first"], w["deadline"]))
        # it went to work on that reply a while, then asked the same again before its deadline: still the same wait
        self.run_pass({"status": "working", "needs": None, "why": None}, began=2000)
        later = self.news.now() + 3 * 60000
        with self.mock.patch.object(self.news.wait_record, "now", lambda: later):
            back = self.run_pass(reply, began=3000)
        self.assertEqual((back["id"], back["deadline"], back.get("outcome")), (w["id"], w["deadline"], None))
        # only the stock words: which turn it is says which question
        stock = {"status": "needs", "needs": "reply", "why": "Waits for your reply"}
        s1 = dict(self.run_pass(stock, began=4000))
        self.assertNotEqual(s1["id"], w["id"])
        self.assertNotEqual(self.run_pass(stock, began=5000)["id"], s1["id"])

    def test_a_failed_lookup_holds_its_news_as_it_was(self):
        self.start()
        reply = {"status": "needs", "needs": "reply", "why": "Which colour?"}
        with self.mock.patch.object(self.news, "NEWS_SETTLE_MS", 10 ** 9):
            w = dict(self.run_pass(reply, began=1000))
        with open(self.news.NEWS) as f:
            queued = json.load(f)["outbox"]
        self.sent.clear()
        # herdr-core can't say what its agents do: no false stop, the queued line kept and not sent yet
        self.assertEqual(self.run_pass({"status": "needs", "needs": "stopped", "why": "Agent stopped"}, hc_up=False), w)
        with open(self.news.NEWS) as f:
            self.assertEqual(json.load(f)["outbox"], queued)
        self.assertEqual(self.sent, [])
        # read again: the line goes, about the wait it was about
        self.run_pass(reply, began=1000)
        self.assertEqual(len(self.sent), 1)
        self.assertIn(f'event="waiting" needs="reply" wait="{w["id"]}"', self.sent[0][1])

    def test_the_person_s_prompt_is_no_inferred_wait(self):
        self.start()
        self.assertIsNone(self.run_pass({"status": "needs", "needs": "asks", "why": "Asks permission"}))
        self.assertIsNone(self.run_pass({"status": "needs", "needs": "stopped", "why": "Stopped by you.", "stopped_by": "you"}))


class OverviewWaits(unittest.TestCase):
    """The home Assistant's overview: a queued line about a wait a newer line on the same task replaced never goes."""
    setUp, round, overview = H.HomeLead.setUp, H.HomeLead.round, H.HomeLead.overview
    CFG = H.HomeLead.CFG

    def test_a_replaced_wait_never_reaches_the_overview(self):
        world, t = {"mini": dict(H.home_world()["mini"], links=[], linked_by=0)}, 10 ** 12
        # "Which colour?" waits in the overview queue (its Assistant was busy), then "Which size?" replaces it
        path = os.path.join(self.store, ".home-mini.json")
        with open(path, "w") as f:
            json.dump({"at": 0, "outbox": [{"to": "home:local", "line": '<herdr-overview task="SHOP-7" event="waiting" wait="w1">~/shop: Which colour?</herdr-overview>',
                                            "at": t - 60000, "wait": "w1", "of": ["", "SHOP-7"]}]}, f)
        world["mini"]["news"] = [{"to": "t9", "space": "sp-shop", "folder": "~/shop", "lines": [
            '<herdr-news task="SHOP-7" event="waiting" needs="reply" wait="w2">SHOP-7 is waiting: Which size?</herdr-news>']}]
        sent = self.round(world, "mini", at=t)
        lines = [l for _, l in self.overview(sent)]
        self.assertEqual([l.split(">", 1)[1].split("<")[0] for l in lines], ["~/shop: SHOP-7 is waiting: Which size?"])
        self.assertIn('wait="w2"', lines[0])


class AskAfter(unittest.TestCase):
    def test_minutes_right_away_or_the_default(self):
        sys.path.insert(0, H.BIN)
        from herdr_task.wait_record import ask_after_ms
        self.assertEqual([ask_after_ms({"tasks": {"ask_after": v}}) for v in (10, 0, "now", "right away", None, "soon", True, -3)],
                         [600000, 0, 0, 0, 300000, 300000, 300000, 300000])
        self.assertEqual(ask_after_ms(None), 300000)


if __name__ == "__main__":
    unittest.main()
