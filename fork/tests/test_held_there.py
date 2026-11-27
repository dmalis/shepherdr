"""Busy Assistant: hold messages (dmalis/shepherdr#80): tell-assistant to an Assistant on another machine that is busy
waits there and arrives once it's free, as on this machine, instead of failing.

Two machines, simulated: this test's process is the sender (machines.tell, its hc exec --on answered by running the
command for real); the receiver is a real herdr-task process on its own task store, with a fake hc that knows one
Assistant (t3) whose state the test turns, and logs what is sent to it. Also pins the upstream seams the patch hangs
on, so the next sync sees a break at once."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME)

import inspect  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

BIN = os.path.join(ROOT, "mods", "tasks", "bin")
REAL_RUN = subprocess.run  # held_there.subprocess is this module: patching its run patches this one
sys.path.insert(0, BIN)
from herdr_task import cli, held_there, machines, news  # noqa: E402

FAKE_HC = r'''#!{python}
import json, os, sys
d = os.path.dirname(os.path.abspath(__file__))
a = sys.argv[1:]
if a[:1] == ["get"] and a[1:2] == ["t3"]:
    print(open(os.path.join(d, "t3.json")).read())
elif a[:2] == ["attach", "--observe"]:
    sys.stdout.write("─" * 40 + "\n❯ \n" + "─" * 40 + "\n")
elif a[:1] == ["send"]:
    with open(os.path.join(d, "sent.jsonl"), "a") as f:
        f.write(json.dumps(a[1:]) + "\n")
else:
    sys.exit(1)
'''
# the receiver's herdr-task: this checkout's, with hc allowed on this run's throwaway HOME (its hc is the fake)
RECEIVER = ("import sys, runpy; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
            "import herdr_task.base as base; base.not_real = lambda: None;"
            "sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name='__main__')")
HELD_PASS = ("import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]);"
             "import herdr_task.base as base; base.not_real = lambda: None;"
             "import herdr_task.news as news; news.held_pass({})")


class HeldOnAnotherMachine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin = os.path.join(self.tmp, "bin")
        os.makedirs(self.bin)
        self.store = os.path.join(self.tmp, "b-tasks")
        with open(os.path.join(self.bin, "hc"), "w") as f:
            f.write(FAKE_HC.replace("{python}", sys.executable))
        with open(os.path.join(self.tmp, "receiver.py"), "w") as f:
            f.write(RECEIVER)
        with open(os.path.join(self.bin, "herdr-task"), "w") as f:
            f.write(f'#!/bin/sh\nexec "{sys.executable}" -c "$(cat "{self.tmp}/receiver.py")" "{BIN}" "{os.path.join(BIN, "herdr-task")}" "$@"\n')
        for n in ("hc", "herdr-task"):
            os.chmod(os.path.join(self.bin, n), 0o755)
        self.env = {**os.environ, "HERDR_TASK_STORE": self.store, "PATH": self.bin + os.pathsep + os.environ.get("PATH", ""),
                    "HERDR_TASK_SETTINGS": os.path.join(self.tmp, "b-settings.json"), "SHEPHERDR_NO_MIGRATE": "1"}
        self.calls = []
        self.state("working")

    def state(self, word):
        with open(os.path.join(self.bin, "t3.json"), "w") as f:
            json.dump({"address": "t3", "state": "live", "turn": 4, "status": {"app": "claude-code", "state": word},
                       "labels": {"herdr.role": "coordinator", "herdr.space": "sp1"}, "foreground": {"name": "claude"}}, f)

    def sent(self):
        try:
            with open(os.path.join(self.bin, "sent.jsonl")) as f:
                return [json.loads(x) for x in f]
        except OSError:
            return []

    def run_there(self, argv, **kw):
        """this machine's subprocess.run: hc exec --on vmb runs the rest on the receiver, as herdr-core would"""
        self.calls.append(argv)
        self.assertEqual(argv[:5], ["hc", "exec", "--on", "vmb", "--"])
        kw.pop("env", None)
        return REAL_RUN(argv[5:], env=self.env, **kw)

    def tell(self, text="Can you check the disk?"):
        graph = {"core": {"name": "mac", "id": "m1"}, "assistants": [{"address": "t13", "space": "sp0", "space_name": "Home"}]}
        row = {"target": "vmb/t3", "route": "vmb", "how": ["herdr-core"], "address": "t3", "space": "sp1", "space_name": "root"}
        with mock.patch.object(machines, "directory", lambda refresh=False: ({"graph": graph}, [row])), \
                mock.patch.object(machines, "nodes", lambda g: [{"route": [{"to": "vmb"}], "node": {"core": {"name": "vmb", "id": "v1"}}}]), \
                mock.patch.object(machines, "route_text", lambda r: "vmb" if r else ""), \
                mock.patch.object(machines, "_path_back", lambda *a: ["mac"]), \
                mock.patch.object(machines, "hc_json", lambda *a: self.fail("asked this machine's hc about vmb's t3")), \
                mock.patch.object(held_there, "guard", lambda a: None), \
                mock.patch.object(held_there.subprocess, "run", self.run_there):
            return machines.tell("vmb/t3", text, sender="t13")

    def held_pass(self):
        r = subprocess.run([sys.executable, "-c", HELD_PASS, BIN], env=self.env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_a_working_assistant_gets_it_once_it_is_free_with_the_original_tag(self):
        r = self.tell()
        self.assertTrue(r["held"], r)
        self.assertEqual(r["why"], machines.HELD_WHY["working"])
        self.assertEqual(self.sent(), [], "nothing typed into its turn")
        self.assertEqual(len(self.calls), 1)
        self.held_pass()
        self.assertEqual(self.sent(), [], "still working: still held")
        self.state("idle")
        self.held_pass()
        self.held_pass()
        got = self.sent()
        self.assertEqual(len(got), 1, "exactly one delivery")
        self.assertEqual(got[0][0], "t3")
        self.assertEqual(got[0][1], '<herdr-assistant from="mac/t13" machine="mac" space="Home" can-reply="yes">'
                                    'Can you check the disk?</herdr-assistant>')

    def test_the_sender_is_told_it_is_held_not_an_error(self):
        import argparse
        import io
        from contextlib import redirect_stdout
        out, r = io.StringIO(), self.tell("hi")
        with mock.patch.object(machines, "sandbox_blocks_hc", lambda: None), redirect_stdout(out):
            with mock.patch.object(machines, "tell", lambda t, x: dict(r)):
                machines.cmd_tell(argparse.Namespace(target="vmb/t3", text="hi", json=False))
        self.assertEqual(out.getvalue().strip(), "Not delivered yet, held for vmb/t3 (root): it's in the middle of a turn; it goes once that ends.")

    def test_an_idle_assistant_gets_it_at_once(self):
        self.state("idle")
        r = self.tell()
        self.assertFalse(r["held"])
        self.assertEqual(len(self.sent()), 1)
        self.held_pass()
        self.assertEqual(len(self.sent()), 1, "nothing held besides")

    def test_an_assistant_asking_something_holds_it_too(self):
        self.state("blocked")
        r = self.tell()
        self.assertTrue(r["held"])
        self.assertEqual(self.sent(), [])

    def test_a_plain_shell_there_is_never_typed_into(self):
        with open(os.path.join(self.bin, "t3.json"), "w") as f:
            json.dump({"address": "t3", "state": "live", "labels": {"herdr.role": "coordinator"}, "foreground": {"name": "bash"}}, f)
        with self.assertRaises(machines.Fail) as e:
            self.tell()
        self.assertIn("plain shell", str(e.exception))
        self.assertEqual(self.sent(), [])

    def test_an_older_receiver_is_sent_to_as_before(self):
        older = subprocess.CompletedProcess([], 2, "", "herdr-task: error: argument cmd: invalid choice: '_receive' (choose from ...)\n")
        with mock.patch.object(held_there, "guard", lambda a: None), mock.patch.object(held_there.subprocess, "run", return_value=older), \
                mock.patch.object(machines, "_deliver", return_value=True) as old:
            self.assertEqual(held_there.deliver(["vmb"], ["herdr-core"], "t3", "hi"), (True, False, None))
        old.assert_called_once_with(["vmb"], ["herdr-core"], "t3", "hi")

    def test_a_lost_answer_is_an_error_never_a_second_send(self):
        lost = subprocess.CompletedProcess([], 1, "", "hc: vmb: connection refused\n")
        with mock.patch.object(held_there, "guard", lambda a: None), mock.patch.object(held_there.subprocess, "run", return_value=lost), \
                mock.patch.object(machines, "_deliver", side_effect=AssertionError("sent the old way too")):
            with self.assertRaises(machines.Fail):
                held_there.deliver(["vmb"], ["herdr-core"], "t3", "hi")


class Seams(unittest.TestCase):
    """What the patch relies on in upstream's code."""

    def test_tell_sends_to_another_machine_through_it(self):
        src = inspect.getsource(machines.tell)
        self.assertIn("from .held_there import deliver", src)
        self.assertIn('ok, held, why = deliver(to["route"].split(">"), to["how"], to["address"], msg)', src)
        self.assertIn('"why": held and (why or _held_why(to["address"]))', src)

    def test_the_cli_has_receive(self):
        self.assertIn('sub.add_parser("_receive")', inspect.getsource(cli.main))

    def test_upstreams_send_or_hold_and_helpers_are_as_it_uses_them(self):
        self.assertEqual(list(inspect.signature(news.send_or_hold).parameters), ["address", "text", "how"])
        self.assertEqual(news.NO_AGENT, "no-agent")
        self.assertEqual(list(inspect.signature(machines._deliver).parameters), ["names", "hows", "address", "text"])
        self.assertEqual(list(inspect.signature(machines._hops).parameters), ["route_names", "hows", "inner"])
        self.assertTrue(callable(machines._held_why))
        self.assertIn("held_pass(report)", inspect.getsource(news))


if __name__ == "__main__":
    unittest.main()
