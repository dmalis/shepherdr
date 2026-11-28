"""Machine card: the three numbers at a glance, and disk counts file slots: a disk's % full is the fuller of its space
and its file slots (inodes), since a /tmp with no file slots left takes no new file however much space it has. Faked
statvfs results stand in for each disk."""
import home_guard  # noqa: F401
import os
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mods/tasks/bin"))
import herdr_task.machine as machine  # noqa: E402

GB = 2 ** 30


def vfs(size_gb, used_gb, files=0, files_used=0):
    """a statvfs result: 4 KiB blocks, none kept for the system, `files` slots of which `files_used` are taken"""
    blk = 4096
    return os.statvfs_result((blk, blk, size_gb * GB // blk, (size_gb - used_gb) * GB // blk,
                              (size_gb - used_gb) * GB // blk, files, files - files_used, files - files_used, 0, 255))


def blocks(total, free, files=0, ffree=0):
    """a statvfs result in raw 4 KiB blocks, for shares that don't fall on whole GB"""
    return os.statvfs_result((4096, 4096, total, free, free, files, ffree, ffree, 0, 255))


class DiskFileSlots(unittest.TestCase):
    def read(self, home, tmp):
        disks = {machine.HOME: (home, 1), "/tmp": (tmp, 2)}
        with mock.patch.object(machine.os, "statvfs", lambda p: disks[p][0]), \
                mock.patch.object(machine.os, "stat", lambda p: mock.Mock(st_dev=disks[p][1])):
            return {d["path"]: d for d in machine._disks()}

    def test_tmp_out_of_file_slots_with_space_free_reads_full(self):
        # the tmpfs that ran out of inodes with 23 GB free, while the card said Disk 9% and OK
        d = self.read(vfs(1900, 85, files=10 ** 8, files_used=10 ** 6), vfs(32, 9, files=500_000, files_used=500_000))
        self.assertEqual(d["/tmp"]["pct"], 100)
        self.assertEqual(d["/tmp"]["by"], "files")
        self.assertEqual(d["/tmp"]["space_pct"], 28)
        self.assertEqual(d["/tmp"]["files_pct"], 100)
        self.assertEqual(d["/tmp"]["free_gb"], 23)  # its space numbers stay as they were
        self.assertEqual(d["home"]["by"], "space")
        self.assertEqual(d["home"]["pct"], 4)

    def test_sample_alert_and_start_limit_follow_it(self):
        disks = {machine.HOME: vfs(1900, 85, files=10 ** 8, files_used=10 ** 6), "/tmp": vfs(32, 9, files=1000, files_used=1000)}
        with mock.patch.object(machine.os, "statvfs", lambda p: disks[p]), \
                mock.patch.object(machine.os, "stat", lambda p: mock.Mock(st_dev=hash(p))), \
                mock.patch.object(machine.os, "getloadavg", lambda: (0.0, 0.0, 0.0)), \
                mock.patch.object(machine, "_memory", lambda: (100, 10)):
            # this machine's own load and memory stay out of it: only the disk may hold
            h = machine.sample()
        self.assertEqual(h["disk"], 100)
        self.assertGreater(h["disk"], machine.ALERT["disk"])
        self.assertEqual(machine.hold_reason(h), "disk is 100% full (/tmp's file slots)")

    def test_space_fuller_than_files_reads_by_space(self):
        d = self.read(vfs(500, 460, files=10 ** 7, files_used=10 ** 5), vfs(32, 1))
        self.assertEqual((d["home"]["pct"], d["home"]["by"], d["home"]["files_pct"]), (92, "space", 1))

    def test_no_file_count_reads_by_space_alone(self):
        # btrfs and some network disks report 0 file slots: never read as full
        d = self.read(vfs(500, 50), vfs(32, 1))
        self.assertEqual((d["home"]["pct"], d["home"]["by"]), (10, "space"))
        self.assertNotIn("files_pct", d["home"])

    def test_one_disk_read_once(self):
        with mock.patch.object(machine.os, "statvfs", lambda p: vfs(100, 50, files=100, files_used=10)), \
                mock.patch.object(machine.os, "stat", lambda p: mock.Mock(st_dev=7)):
            self.assertEqual([d["path"] for d in machine._disks()], ["home"])

    def test_a_tmpfs_with_no_size_reads_by_its_files(self):
        # tmpfs size=0: no byte limit (0 blocks), its own file-slot limit, all taken
        d = self.read(vfs(1900, 85, files=10 ** 8, files_used=10 ** 6), blocks(0, 0, files=100, ffree=0))
        self.assertEqual((d["/tmp"]["pct"], d["/tmp"]["by"], d["/tmp"]["files_pct"]), (100, "files", 100))
        self.assertNotIn("free_gb", d["/tmp"])  # no space to count, so no "0 GB free"
        self.assertTrue(d["/tmp"]["fullest"])

    def test_the_cause_is_chosen_before_rounding(self):
        # 99.6% of its space and every file slot: both round to 100, the file slots filled it
        d = self.read(vfs(100, 10), blocks(1000, 4, files=100, ffree=0))
        self.assertEqual((d["/tmp"]["pct"], d["/tmp"]["by"]), (100, "files"))

    def test_the_fullest_disk_is_chosen_before_rounding(self):
        # home 99.6% by space, /tmp 100% by its file slots: both read 100, /tmp is the one that's full
        disks = {machine.HOME: blocks(1000, 4, files=1000, ffree=990), "/tmp": blocks(1000, 500, files=100, ffree=0)}
        with mock.patch.object(machine.os, "statvfs", lambda p: disks[p]), \
                mock.patch.object(machine.os, "stat", lambda p: mock.Mock(st_dev=hash(p))), \
                mock.patch.object(machine.os, "getloadavg", lambda: (0.0, 0.0, 0.0)), \
                mock.patch.object(machine, "_memory", lambda: (100, 10)):
            h = machine.sample()
        self.assertEqual([d["pct"] for d in h["disks"]], [100, 100])
        self.assertEqual([d["path"] for d in h["disks"] if d.get("fullest")], ["/tmp"])
        self.assertEqual(machine.hold_reason(h), "disk is 100% full (/tmp's file slots)")

    def test_the_real_disks_read(self):
        for d in machine._disks():
            self.assertIn(d["by"], ("space", "files"))
            self.assertEqual(d["pct"], max(d.get("space_pct", 0), d.get("files_pct", 0)))


if __name__ == "__main__":
    unittest.main()
