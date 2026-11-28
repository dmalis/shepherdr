"""Nothing to merge (dmalis/shepherdr#29): a task with no commits beyond its base follows the Merge setting, and every
Ready card that waits says what it asks, why it waits, and what its buttons do.

Pins the upstream seams the patch hangs on, so the next sync sees a break at once: the calls in herdr-task's ready and
finalize, the fields it reads there, the done news line, the service's task fields and the card's words. Its
behaviour is tested in test/test_herdr_task.py (MergedOnlyWithOwnWork), web/plugins/tasks/ready-words.test.tsx and
service/ready-waits.test.ts."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import inspect  # noqa: E402
import unittest  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import commands, github, news, settings, waits  # noqa: E402


def read(*path):
    with open(os.path.join(ROOT, *path)) as f:
        return f.read()


class Seams(unittest.TestCase):
    def test_ready_closes_a_task_with_nothing_to_merge_before_finalize(self):
        src = inspect.getsource(commands.cmd_ready)
        self.assertIn('t["nothing_to_merge"] = True', src)  # upstream still marks a no-commit task
        self.assertLess(src.index("closes_alone(t, policy)"), src.index("msg = finalize(s, t)"))
        self.assertIn("finish(s, t, even_if_busy=True, quiet=True)", src)
        self.assertIn("quiet", inspect.signature(github.finish).parameters)

    def test_finalize_keeps_why_a_ready_task_waits(self):
        """finalize as ready calls it: a task with nothing to merge, and one whose pull request waits for the person,
        each keep waits_why's words; Proof on and none found (dmalis/shepherdr#215), the proof's words instead."""
        from unittest import mock
        from herdr_task import proof_hold

        class Store:
            dirty, loc = False, {}

            def name(self, t):
                return f'"{t["title"]}"'

        def ready(merge, proof=False, **t):
            t = {"id": 1, "title": "Login", "state": "running", "mode": "worktree", "worktree": ROOT, **t}
            pr = {"number": 7, "url": "https://example.com/pr/7"}
            with mock.patch.object(commands, "merge_policy", lambda s, t: merge), \
                    mock.patch.object(commands, "waits_why", lambda s, t, policy: f"why: {policy}"), \
                    mock.patch.object(commands, "github", lambda s: "o/r"), \
                    mock.patch.object(commands, "pr_open", lambda s, t, repo, summary=None: t.setdefault("pr", pr)), \
                    mock.patch.object(proof_hold, "asked", lambda s, t: proof):
                commands.finalize(Store(), t)
            return t["state"], t.get("waits_why")

        self.assertEqual(ready("auto", nothing_to_merge=True), ("ready", "why: auto"))  # whatever Merge says
        self.assertEqual(ready("ask"), ("ready", "why: ask"))
        self.assertEqual(ready("auto", proof=True), ("ready", proof_hold.WHY))
        self.assertIn('"waits_why", "closed_alone"', inspect.getsource(commands.cmd_state))

    def test_the_sources_and_merge_names_it_reads(self):
        # setting_sources names it "tasks.merge", from DEFAULTS' sections and keys
        self.assertIn("merge", settings.DEFAULTS["tasks"])
        self.assertIn('f"{section}.{key}"', inspect.getsource(settings.setting_sources))
        self.assertEqual(set(waits.MERGE_NAMES), set(settings.MERGE_WORDS))
        # the names Settings › Tasks › Merge shows
        for name in waits.MERGE_NAMES.values():
            self.assertIn(f"'{name}'", read("web", "src", "settings.tsx"))

    def test_it_never_closes_over_new_files_and_old_cards_say_why(self):
        from herdr_task import tick
        self.assertIn("left_files(wt)", inspect.getsource(commands.cmd_ready))
        self.assertIn('"--untracked-files=no"', inspect.getsource(github.remove_worktree))  # why: it removes new files
        self.assertIn('"waits_why"', inspect.getsource(commands.back_to_work))
        self.assertIn("waits_now(s, t)", inspect.getsource(tick.tick_turn))
        model = read("service", "model.ts")  # the service reads the stored task: each field reaches the app
        for k in ("nothing_to_merge", "left_files", "closed_alone", "waits_why"):
            self.assertIn(f"{k}: ", model)

    def test_the_done_news_says_what_it_found(self):
        self.assertIn('t.get("closed_alone")', inspect.getsource(news.news_line))
        self.assertIn('not t.get("quiet")', inspect.getsource(news.news_pass))  # its done news isn't skipped as quiet

    def test_the_app_shows_it(self):
        nxt = read("service", "next.ts")
        for k in ("nothing_to_merge", "closed_alone", "waits_why"):
            self.assertIn(f"x.{k}", nxt)
        card = read("web", "plugins", "tasks", "client.tsx")
        self.assertIn("const rw = readyWords(t)", card)
        self.assertIn("{rw.go}", card)
        self.assertIn("{rw.later}", card)
        self.assertIn("t.waitsWhy", card)
        push = read("service", "push.ts")
        self.assertIn("title: readyWords(t).go", push)
        self.assertIn("!t.closedAlone", push)
        self.assertNotIn("Mark as done and merge'", card.split("export function ReviewCard")[1].split("\nexport ")[0])


if __name__ == "__main__":
    unittest.main()
