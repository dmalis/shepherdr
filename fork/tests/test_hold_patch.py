"""The hold patch (dmalis/shepherdr#19): the sync run holds the sync to other machines itself until its health check
passes, and `bin/shepherdr`'s hold_paths keeps the installer off that hold while SHEPHERDR_KEEP_SYNC_HOLD=1 is set.

Upstream's real installer, on a throwaway root: this checkout installed with `--root`, then updated from a scratch
copy of it whose own installer differs (so the installed copy hands the update over to it, as live, and the update
replaces helpers, so the installer holds the sync). Whether the sync is held is asked of the installed herdr-task's
own base.sync_held, in a program whose home is the root. Nothing reaches the real home, hc or another machine."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "test"))
import home_guard  # noqa: E402,F401  (first: a throwaway HOME, the agent's own terminal dropped)

import importlib.util  # noqa: E402
import json  # noqa: E402
import shutil  # noqa: E402
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402
import unittest  # noqa: E402
from importlib.machinery import SourceFileLoader  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # before test/: its test_install isn't ours
sys.path.insert(0, os.path.join(ROOT, "fork"))
from sync import install  # noqa: E402

SHARE = os.path.join(".local", "share", "shepherdr")
VAR = "SHEPHERDR_KEEP_SYNC_HOLD"

# An update that stops where the gap is: after finish_install's first save_record (installed.json has the new stamp,
# and `whole` still reads true from the last install), before its whole check and its release_hold.
STOPPED = r'''
import os, sys
from importlib.machinery import SourceFileLoader
import importlib.util
loader = SourceFileLoader("shepherdr_stopped", sys.argv[1])
spec = importlib.util.spec_from_loader("shepherdr_stopped", loader)
sh = importlib.util.module_from_spec(spec)
loader.exec_module(sh)


def stop(*a, **k):
    sys.stdout.flush()
    os._exit(9)


sh.install_checks = stop
sys.exit(sh.main(sys.argv[2:]))
'''

# The installed herdr-task's own answer, with the root as its home: what the sync and the self-copies obey.
HELD = r'''
import json, sys
sys.path.insert(0, sys.argv[1])
from herdr_task import base
print(json.dumps({"held": base.sync_held()}))
'''


def installer():
    loader = SourceFileLoader("shepherdr_hold_patch", os.path.join(ROOT, "bin", "shepherdr"))
    spec = importlib.util.spec_from_loader("shepherdr_hold_patch", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def copy_source(dest, broken=False):
    """This checkout as the source an update comes from. Its own installer differs by a comment, so the installed
    copy hands the update over to it (hand_over), as a live update does. `broken`: a helper without its SHEP block,
    so the update goes in but isn't whole."""
    shutil.copytree(ROOT, dest, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__", "dist"))
    with open(os.path.join(dest, "bin", "shepherdr"), "a", encoding="utf-8") as f:
        f.write("# the source's own installer\n")
    if broken:
        helper = os.path.join(dest, "bin", "herdr-secret")
        with open(helper, encoding="utf-8") as f:
            text = f.read()
        a = text.index("# ---- SHEP:")
        b = text.index("\n", text.index("# ---- end SHEP ----")) + 1
        with open(helper, "w", encoding="utf-8") as f:
            f.write(text[:a] + text[b:])
    return dest


class HoldPatch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sources = tempfile.mkdtemp(prefix="fork-hold-src-")
        cls.src = copy_source(os.path.join(cls.sources, "good"))
        cls.bad = copy_source(os.path.join(cls.sources, "broken"), broken=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.sources, ignore_errors=True)

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fork-hold-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "root")
        self.share = os.path.join(self.root, SHARE)
        self.site = types.SimpleNamespace(home=os.path.realpath(self.root), live=False,
                                          tasks_bin=os.path.join(self.share, "mods", "tasks", "bin"))
        self.real = [os.path.join(self.site.home, ".herdr", "sync-hold"),
                     os.path.join(self.site.home, ".local", "state", "shepherdr", "sync-hold")]
        self.side = os.path.join(self.site.home, ".local", "state", "shepherdr", "sync-hold.install")
        self.shepherdr("install", via=os.path.join(ROOT, "bin", "shepherdr"))
        self.assertIs(self.record()["whole"], True)
        self.assertEqual(self.files(), {}, "a whole install leaves no hold")

    # --- running the installer ---
    def env(self, keep):
        e = {k: v for k, v in os.environ.items() if k not in (VAR, "SHEPHERDR_HANDED_OVER")}
        if keep:
            e[VAR] = "1"
        return e

    def shepherdr(self, cmd, via=None, keep=False, source=None, ok=True, stopped=False):
        """`shepherdr <cmd> --root <root>`, by the installed copy unless `via` names another. Returns the process."""
        via = via or os.path.join(self.share, "bin", "shepherdr")
        argv = [cmd, "--root", self.root]
        if cmd in ("install", "update"):
            argv += ["--yes", "--no-build"] + (["--source", source] if source else [])
        pre = [sys.executable, "-c", STOPPED, via] if stopped else [sys.executable, via]
        p = subprocess.run(pre + argv, capture_output=True, text=True, stdin=subprocess.DEVNULL, env=self.env(keep),
                           timeout=300)
        if ok:
            self.assertEqual(p.returncode, 0, f"shepherdr {cmd}:\n{p.stdout}\n{p.stderr}")
        return p

    def update(self, keep=True, source=None, **kw):
        return self.shepherdr("update", keep=keep, source=source or self.src, **kw)

    # --- what holds ---
    def record(self):
        with open(os.path.join(self.share, "installed.json"), encoding="utf-8") as f:
            return json.load(f)

    def files(self):
        """{path: first line} of the hold files there are: the two real ones and the side file."""
        out = {}
        for p in self.real + [self.side]:
            try:
                with open(p, encoding="utf-8") as f:
                    out[p] = f.readline().rstrip("\n")
            except FileNotFoundError:
                pass
        return out

    def held(self):
        """The installed herdr-task's base.sync_held(), with the root as its home."""
        env = dict(os.environ, HOME=self.root)
        env.pop(VAR, None)
        p = subprocess.run([sys.executable, "-c", HELD, self.site.tasks_bin], capture_output=True, text=True,
                           env=env, stdin=subprocess.DEVNULL, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return json.loads(p.stdout.strip().splitlines()[-1])["held"]

    def assertRunHolds(self, why):
        files = self.files()
        for p in self.real:
            self.assertEqual(files.get(p), install.HOLD_LINE, f"{why}: {os.path.relpath(p, self.root)}")
        self.assertEqual(self.held(), install.HOLD_LINE, f"{why}: base.sync_held")
        self.assertEqual(self.files().keys(), files.keys(), f"{why}: base.sync_held never clears the run's hold")

    # --- the run's hold is where herdr-task and doctor look ---
    def test_the_runs_hold_is_upstreams_two_paths(self):
        self.assertEqual(install.hold_paths(self.site), self.real)
        self.assertEqual([os.path.realpath(p) for p in installer().hold_paths(self.root)],
                         [os.path.realpath(p) for p in self.real], "bin/shepherdr's own paths, without the variable")
        install.hold_sync(self.site)
        self.assertEqual(self.files(), {p: install.HOLD_LINE for p in self.real})
        self.assertNotIn(" install at ", install.HOLD_LINE, "a stamp would let base.sync_held clear it")
        self.assertEqual(self.held(), install.HOLD_LINE)

    # --- with the variable on the update ---
    def test_a_whole_update_keeps_the_runs_hold_until_doctor(self):
        install.hold_sync(self.site)
        out = self.update().stdout
        self.assertIn("the installer in", out, "the installed copy handed the update over, the variable kept")
        rec = self.record()
        self.assertIs(rec["whole"], True)
        self.assertEqual(os.path.realpath(rec["source"]), os.path.realpath(self.src), "the update went in")
        self.assertNotIn(self.side, self.files(), "the installer let go of its own hold, in the side file")
        self.assertRunHolds("after a whole update")
        # health's last line: doctor without the variable lets go
        d = self.shepherdr("doctor")
        self.assertIn("the sync to other machines may go again", d.stdout)
        self.assertEqual(self.files(), {})
        self.assertIsNone(self.held())

    def test_an_update_stopped_in_the_gap_keeps_the_runs_hold(self):
        install.hold_sync(self.site)
        p = self.update(via=os.path.join(self.src, "bin", "shepherdr"), stopped=True, ok=False)
        self.assertEqual(p.returncode, 9, p.stdout + p.stderr)
        rec = self.record()
        self.assertEqual(os.path.realpath(rec["source"]), os.path.realpath(self.src), "stopped after the first save_record")
        self.assertIs(rec["whole"], True, "whole still reads true from the last install: the gap")
        self.assertIn(f" install at {rec['at']}:", self.files().get(self.side, ""), "the installer's stamped hold")
        self.assertRunHolds("after an update stopped in the gap")

    def test_a_failed_update_keeps_the_runs_hold(self):
        install.hold_sync(self.site)
        out = self.update(source=self.bad).stdout
        self.assertIn("NOT DONE", out)
        self.assertIs(self.record()["whole"], False)
        self.assertRunHolds("after a failed update")
        d = self.shepherdr("doctor", ok=False)
        self.assertNotEqual(d.returncode, 0)
        self.assertRunHolds("doctor on an install that isn't whole")
        # the rollback's update (the variable again) and then doctor on the healthy install let go
        self.update()
        self.assertRunHolds("after the rollback's update")
        self.shepherdr("doctor")
        self.assertIsNone(self.held())
        self.assertEqual({p for p in self.files() if p != self.side}, set())

    # --- without the variable: upstream's hold, as it was ---
    def test_without_the_variable_a_whole_update_lets_go(self):
        install.hold_sync(self.site)
        out = self.update(keep=False).stdout
        self.assertIn("the install is whole: the sync to other machines may go again", out)
        self.assertEqual(self.files(), {}, "upstream's release_hold takes both real paths away")
        self.assertIsNone(self.held())

    def test_without_the_variable_the_gap_lets_the_sync_go(self):
        """Why the patch is there: upstream's stamped hold, cleared by base.sync_held before the whole check ran."""
        install.hold_sync(self.site)
        p = self.update(keep=False, via=os.path.join(self.src, "bin", "shepherdr"), stopped=True, ok=False)
        self.assertEqual(p.returncode, 9, p.stdout + p.stderr)
        stamp = self.record()["at"]
        files = self.files()
        self.assertEqual(set(files), set(self.real), "the installer wrote over both real paths")
        for line in files.values():
            self.assertIn(f" install at {stamp}:", line)
        self.assertIsNone(self.held(), "upstream's gap: the stamped hold goes before the install was checked")
        self.assertEqual(self.files(), {})

    def test_without_the_variable_a_failed_update_holds_with_its_own_line(self):
        install.hold_sync(self.site)
        self.update(keep=False, source=self.bad)
        stamp = self.record()["at"]
        files = self.files()
        self.assertEqual(set(files), set(self.real))
        for line in files.values():
            self.assertIn(f" install at {stamp}:", line)
        self.assertIn(f" install at {stamp}:", self.held(), "not whole: upstream's hold stays")


if __name__ == "__main__":
    unittest.main()
