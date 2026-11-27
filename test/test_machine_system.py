"""Machines: more health facts, clearer cards (dmalis/shepherdr#107): machine_system.py reads a machine's OS, uptime,
restart and versions with plain file reads and documented commands, on Linux and macOS, and leaves out what it can't
read. Fake outputs stand in for each system; the probe itself also runs here for real."""
import home_guard  # noqa: F401
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
BIN = ROOT / "mods/tasks/bin"
PROBE = BIN / "herdr_task/machine_system.py"
sys.path.insert(0, str(BIN))
import herdr_task.machine_system as ms  # noqa: E402

UBUNTU = 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nID=ubuntu\nID_LIKE=debian\n'
FEDORA = 'NAME="Fedora Linux"\nVERSION_ID=41\nID=fedora\n'
BOOTTIME = "{ sec = 1700000000, usec = 123456 } Tue Nov 14 22:13:20 2023\n"


class Linux(unittest.TestCase):
    def setUp(self):
        self.files = {"/etc/os-release": UBUNTU, "/proc/uptime": "175390.66 4818187.42\n"}
        for name, value in (("MAC", False), ("_read", lambda p: self.files.get(p, ""))):
            p = mock.patch.object(ms, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_os_from_os_release(self):
        self.assertEqual(ms.os_name(), "Ubuntu 24.04.1 LTS")
        self.files["/etc/os-release"] = FEDORA
        self.assertEqual(ms.os_name(), "Fedora Linux 41")

    def test_uptime_from_proc(self):
        self.assertEqual(ms.uptime(), 175390)
        self.files["/proc/uptime"] = ""
        self.assertIsNone(ms.uptime())

    def test_restart_needed_where_debian_says(self):
        self.assertIs(ms.restart_needed(ms.os_release(UBUNTU), exists=lambda p: p == ms.REBOOT_FILE), True)
        self.assertIs(ms.restart_needed(ms.os_release(UBUNTU), exists=lambda p: False), False)
        # Fedora has no such file: it can't say, so it says nothing (never "not needed")
        self.assertIsNone(ms.restart_needed(ms.os_release(FEDORA), exists=lambda p: False))


class MacOS(unittest.TestCase):
    def setUp(self):
        fake = {"sw_vers -productName": "macOS\n", "sw_vers -productVersion": "15.1\n", "sysctl -n kern.boottime": BOOTTIME}
        self.ran = []

        def run(argv, timeout=10):
            self.ran.append(argv)
            return fake.get(" ".join(argv), "")
        for name, value in (("MAC", True), ("_run", run)):
            p = mock.patch.object(ms, name, value)
            p.start()
            self.addCleanup(p.stop)

    def test_os_from_sw_vers(self):
        self.assertEqual(ms.os_name(), "macOS 15.1")

    def test_uptime_from_kern_boottime(self):
        with mock.patch.object(ms.time, "time", return_value=1700000000 + 2 * 86400 + 5):
            self.assertEqual(ms.uptime(), 2 * 86400 + 5)

    def test_restart_is_left_out_on_macos(self):
        # no documented, non-privileged way short of softwareupdate (slow, and it asks Apple's servers)
        self.assertIsNone(ms.restart_needed(exists=lambda p: True))
        self.assertNotIn("softwareupdate", " ".join(" ".join(a) for a in self.ran))


class Versions(unittest.TestCase):
    def test_versions_from_hc_and_the_install_record(self):
        with tempfile.TemporaryDirectory() as tmp:
            hc = Path(tmp) / "hc"
            hc.write_text("#!/bin/sh\necho 'hc 0.1.22'\n")
            hc.chmod(0o700)
            rec = Path(tmp) / "installed.json"
            rec.write_text(json.dumps({"version": "3.2.22", "root": "/x"}))
            with mock.patch.dict(os.environ, {"PATH": f"{tmp}:/usr/bin:/bin"}), mock.patch.object(ms, "PATHS", []), \
                    mock.patch.object(ms, "RECORD", str(rec)):
                self.assertEqual(ms.hc_version(), "0.1.22")
                self.assertEqual(ms.shepherdr_version(), "3.2.22")
            rec.write_text("not json")
            with mock.patch.object(ms, "RECORD", str(rec)):
                self.assertIsNone(ms.shepherdr_version())
            with mock.patch.object(ms, "RECORD", str(Path(tmp) / "none.json")):
                self.assertIsNone(ms.shepherdr_version())

    def test_version_in(self):
        self.assertEqual(ms.version_in("hc 0.1.22\n"), "0.1.22")
        self.assertIsNone(ms.version_in("hc (dev)"))


class Probe(unittest.TestCase):
    def test_runs_as_herdr_core_runs_it_one_json_line(self):
        # as service/machine-system.ts runs it: its source with python3 -c, from any folder
        res = subprocess.run([sys.executable, "-c", PROBE.read_text()], cwd=tempfile.gettempdir(), text=True,
                             capture_output=True, timeout=20, check=True)
        lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
        self.assertEqual(len(lines), 1)
        d = json.loads(lines[0])["system"]
        self.assertEqual(set(d), {"os", "arch", "up", "restart", "hc", "shepherdr"})
        self.assertTrue(d["os"])

    def test_nothing_privileged_and_nothing_of_an_agent(self):
        src = PROBE.read_text().split('"""', 2)[2]  # its code, not the docstring that says what it never does
        for word in ("sudo", "softwareupdate", ".claude", ".codex", "auth.json", "/usage", "app-server", "doas", "pkexec"):
            self.assertNotIn(word, src)

    def test_machine_probe_gives_disk_bytes(self):
        # the card's "1.7 of 1.8 TB free" (upstream's machine.py, one line of ours: free and size beside free_gb)
        sys.path.insert(0, str(BIN))
        import herdr_task.machine as machine
        disks = machine._disks()
        self.assertTrue(disks)
        for d in disks:
            self.assertEqual({"path", "pct", "free_gb", "free", "size"}, set(d))
            self.assertLessEqual(d["free"], d["size"])


if __name__ == "__main__":
    unittest.main()
