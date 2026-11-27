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
        src = inspect.getsource(commands.finalize)
        self.assertIn("if local:", src)
        self.assertEqual(src.count('t["waits_why"] = waits_why('), 2)
        self.assertIn('"waits_why", "closed_alone"', inspect.getsource(commands.cmd_state))

    def test_the_sources_and_merge_names_it_reads(self):
        # setting_sources names it "tasks.merge", from DEFAULTS' sections and keys
        self.assertIn("merge", settings.DEFAULTS["tasks"])
        self.assertIn('f"{section}.{key}"', inspect.getsource(settings.setting_sources))
        self.assertEqual(set(waits.MERGE_NAMES), set(settings.MERGE_WORDS))
        # the names Settings › Tasks › Merge shows
        for name in waits.MERGE_NAMES.values():
            self.assertIn(f"'{name}'", read("web", "src", "settings.tsx"))

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
        self.assertNotIn("Mark as done and merge'", card.split("export function ReviewCard")[1].split("\nexport ")[0])


if __name__ == "__main__":
    unittest.main()
