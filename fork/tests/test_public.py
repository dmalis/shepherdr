"""`fork/bin/sync public-check` (fork/specs/sync-pipeline.md, "GitHub destinations and public text", build task 3):
text bound for GitHub is refused when it carries a home or `~/` path, a host or machine name, an email, a tailnet
name or address, or installer and log lines; the refusal names the kind and line, never the text found."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import unittest  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import public, state  # noqa: E402

SYNC = os.path.join(ROOT, "fork", "bin", "sync")

CLEAN = """## Sync v3.2.22

Part of #2. Takes upstream's v3.2.22 and adapts our patches to it.

- The hold patch (#5) moved with `hold_paths`; its test passes.
- Upstream issue 1556 is fixed in this release: our patch for it is dropped.
- Checked: `python3 -m unittest discover -s fork/tests`, the trial PASS on 1a2b3c4d5e6f.
- Version 3.2.22, file fork/sync/gate.py, the docs in docs/upgrading.md and ~ alone.
"""


class Problems(unittest.TestCase):
    def setUp(self):
        p = mock.patch("socket.gethostname", return_value="studio-mini.lan")
        p.start()
        self.addCleanup(p.stop)

    def kinds(self, text, cfg=None):
        return [f["kind"] for f in public.problems(text, cfg)]

    def test_clean_text_passes(self):
        self.assertEqual(public.problems(CLEAN, "box-under-test"), [])

    def test_each_refusal(self):
        cases = [
            ("the log is in /home/someone/.local/state/x", "a home path"),
            ("see /Users/someone/dev", "a home path"),
            ("C:\\Users\\someone\\x", "a home path"),
            ("installed from ~/development/projects/shepherdr", "a ~/ path"),
            ("(~/.config/shepherdr-fork/sync.json)", "a ~/ path"),
            ("ask me at someone@example.com", "an email address"),
            ("served on box.tail1234.ts.net", "a network host name"),
            ("reachable as box.local", "a network host name"),
            ("Service: http://other-machine.local/api", "a network host name"),
            ("from 100.101.102.103", "an IP address"),
            ("this ran on box-under-test", "this machine's name"),
            ("and on studio-mini too", "this machine's name"),
            ("the installer said NOT DONE", "installer output"),
            ("\u2717 helpers", "installer output"),
            ("(all its output: somewhere)", "installer output"),
            ("Traceback (most recent call last):", "a traceback"),
        ]
        for text, kind in cases:
            with self.subTest(text):
                self.assertIn(kind, self.kinds(text, "box-under-test"))

    def test_lines_and_words(self):
        found = public.problems("fine\nsee /home/x/y and a@b.io\nfine\nNOT DONE", None)
        self.assertEqual(found, [{"kind": "a home path", "line": 2}, {"kind": "an email address", "line": 2},
                                 {"kind": "installer output", "line": 4}])
        self.assertEqual(public.words(found), "a home path (line 2); an email address (line 2); installer output "
                                              "(line 4)")

    def test_names_inside_words_are_no_host(self):
        self.assertEqual(self.kinds("the boxes moved; a studio-minimal look", "box"), [])


class Command(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fork-public-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        self.p = state.Paths(self.root)
        os.makedirs(os.path.dirname(self.p.config))
        with open(self.p.config, "w") as f:
            json.dump({"hostname": "box-under-test", "install_folder": "/x", "time_zone": "UTC"}, f)

    def check(self, text):
        path = os.path.join(self.tmp, "body.md")
        with open(path, "w") as f:
            f.write(text)
        r = subprocess.run([sys.executable, SYNC, "public-check", path, "--root", self.root], capture_output=True,
                           text=True, timeout=60)
        out = json.loads(r.stdout)
        self.assertEqual(out["ok"], r.returncode == 0)
        return r.returncode, out, r.stdout

    def test_passes_clean_text(self):
        code, out, _ = self.check(CLEAN)
        self.assertEqual((code, out["lines"]), (0, 8))

    def test_refuses_without_repeating_it(self):
        code, out, raw = self.check("Part of #2.\nIt ran on box-under-test, logs in /home/someone/x.\n")
        self.assertEqual((code, out["outcome"]), (1, "refused"))
        self.assertEqual([(f["kind"], f["line"]) for f in out["problems"]],
                         [("a home path", 2), ("this machine's name", 2)])
        self.assertNotIn("box-under-test", raw)
        self.assertNotIn("someone", raw)

    def test_stdin(self):
        r = subprocess.run([sys.executable, SYNC, "public-check", "-", "--root", self.root], input="me@example.com\n",
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main()
