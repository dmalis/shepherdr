"""Work after a merge (dmalis/shepherdr#48): a task whose change merged stays Done, what its agent commits on the branch
afterwards is offered as a follow-up task (nothing when main already has it), and the turning ring shows only while
its agent works.

Pins the upstream seams the patch hangs on, so the next sync sees a break at once: the refusal of a second pull
request it recognises, the calls in herdr-task's ready, reply, finish, tidy and tick, the command, and the web's still
mark. Its behaviour is tested in test/test_herdr_task.py (WorkAfterTheMerge, Next32), core/tasks.test.js
(core/on-it.cases.json) and web/shared/after-merge.test.ts."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import inspect  # noqa: E402
import unittest  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "mods", "tasks", "bin"))
from herdr_task import after_merge, agents, cli, commands, github, link, tick  # noqa: E402


def read(*path):
    with open(os.path.join(ROOT, *path)) as f:
        return f.read()


class Seams(unittest.TestCase):
    def test_the_refusal_it_recognises_is_upstreams(self):
        # a task stuck before the patch carries this refusal as its attention (unstick finds it by these words)
        self.assertIn(after_merge.STUCK, inspect.getsource(github.pr_push))

    def test_ready_closes_a_merged_task_before_any_second_pull_request(self):
        src = inspect.getsource(commands.cmd_ready)
        self.assertIn("after_merge.merged_before(s, t)", src)
        self.assertIn("after_merge.ready_words(", src)
        self.assertLess(src.index("after_merge.merged_before(s, t)"), src.index("msg = finalize(s, t)"))

    def test_a_reply_keeps_a_merged_task_done(self):
        src = inspect.getsource(commands.cmd_reply)
        self.assertIn('kept = was == "done" and bool(t.get("merged"))', src)
        self.assertIn("after_merge.reply_note(", src)

    def test_finish_tidy_and_tick_call_it(self):
        self.assertIn("note_merged(s, task)", inspect.getsource(github.finish))
        self.assertIn("unsaved(s, t)", inspect.getsource(github.tidy_done))
        src = inspect.getsource(tick.tick_turn)
        self.assertIn("after_merge.unstick(", src)
        self.assertIn("after_merge.watch(", src)

    def test_the_command_is_there(self):
        self.assertIn('cmd("follow-up", cmd_follow_up', inspect.getsource(cli))
        self.assertIn("follow-up", link.ACTIONS)

    def test_working_again_only_while_its_agent_works(self):
        self.assertIn('"working" in states or now() - (task.get("handed_at") or 0) < STARTING_MS', inspect.getsource(agents.task_status))
        self.assertIn('live.some((a) => a.status === "working") || now - (task.handed_at ?? 0) < STARTING_MS', read("core", "tasks.js"))

    def test_the_web_reads_it(self):
        self.assertIn("after_merge: task.after_merge", read("service", "model.ts"))
        self.assertIn("afterMergeOf(x.after_merge, t.id)", read("service", "next.ts"))
        self.assertIn('case "follow-up":', read("service", "actions.ts"))
        self.assertIn("kind: 'pending'", read("web", "shared", "view.ts"))
        self.assertIn("r.kind === 'pending'", read("web", "plugins", "tasks", "icon.tsx"))
        self.assertIn("<AfterMergeCard t={t} />", read("web", "plugins", "tasks", "client.tsx"))


if __name__ == "__main__":
    unittest.main()
