"""herdr-browser's screenshots finish, at the size set (dmalis/shepherdr: "herdr-browser: screenshots that finish, at
the size set"). Headless Chrome draws only a window brought to the front, so a capture of an agent's page that
another agent's window hid waited for a frame that never came, or came back stale at the old size. Against a fake
agent-browser (test/fake_ab.py) and a stand-in for the front-and-frame step ($HERDR_BROWSER_FRAME):
- every screenshot first brings its page to the front and waits for it to draw;
- a capture that timed out is tried once more, and twice says what to try;
- the saved picture must have the viewport's size: a wrong one is tried once more, then not kept (what was there
  before is put back), with why;
- a new tab (the space's browser restarted, or the tab was gone) gets the agent's viewport and media again."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import os
import shutil
import struct
import subprocess
import tempfile
import unittest

import fake_ab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HB = os.path.join(ROOT, "bin", "herdr-browser")

# The fake's command: logs it; a screenshot does what the next line of `shots` says: "timeout", or the size of the
# picture it saves ("390x844", "jpeg 390x844"), and says where, as agent-browser does.
BODY = r'''
[ "$1" = tab ] && exit 0   # tab list: the active tab, which shot_front reads (none here: its .tab)
printf '%%s\n' "$*" >> %(log)s
[ "$1" = set ] && echo "$#" >> %(log)s.n
if case " $* " in *" screenshot "*) true ;; *) false ;; esac; then
  n=$(grep -c 'screenshot' %(log)s)
  what=$(sed -n "${n}p" %(shots)s)
  [ -n "$what" ] || what=$(tail -n 1 %(shots)s)
  if [ "$what" = timeout ]; then echo "✗ CDP command timed out: Page.captureScreenshot" >&2; exit 1; fi
  if [ "$what" = json-timeout ]; then echo '{"success":false,"data":null,"error":"CDP command timed out: Page.captureScreenshot"}'; exit 1; fi
  if [ "$what" = unchanged ]; then echo "✓ Screenshot unchanged (revision 2, 0.0000%% pixels changed)"; exit 0; fi
  path=%(home)s/default.png
  for a in "$@"; do case "$a" in /*) path=$a ;; esac; done
  python3 %(writer)s "$path" $what
  echo "✓ Screenshot saved to $path"
fi
exit 0
'''

# A picture's header only, as the size check reads it: PNG's IHDR, or JPEG's SOF0.
WRITER = r'''import struct, sys
p = sys.argv[1]; kind = "png"
if sys.argv[2] == "jpeg": kind = "jpeg"; sys.argv.pop(2)
w, h = map(int, sys.argv[2].split("x"))
with open(p, "wb") as f:
    if kind == "png": f.write(b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + struct.pack(">II", w, h) + b"\x08\x06\x00\x00\x00" + b"\x00" * 4)
    else: f.write(b"\xff\xd8" + b"\xff\xe0" + struct.pack(">H", 4) + b"JF" + b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, h, w, 3) + b"\x00" * 6)
'''


class Shots(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="shep-browser-shots-")
        self.addCleanup(shutil.rmtree, self.home, True)
        self.log = os.path.join(self.home, "ab.log")
        self.shots = os.path.join(self.home, "shots")
        writer = os.path.join(self.home, "writer.py")
        with open(writer, "w") as f:
            f.write(WRITER)
        self.bin = os.path.join(self.home, "agent-browser")
        with open(self.bin, "w") as f:
            f.write(fake_ab.script(BODY % {"log": self.log, "shots": self.shots, "home": self.home, "writer": writer}))
        os.chmod(self.bin, 0o755)
        # the front-and-frame step: logged, and the page's size it measures
        self.front = os.path.join(self.home, "front")
        with open(self.front, "w") as f:
            f.write('#!/bin/sh\necho "front $HERDR_BROWSER_FRAME_TAB" >> %s\necho "${FAKE_PAGE-1280 720 1 1280 720}"\n' % self.log)
        os.chmod(self.front, 0o755)
        self.root = os.path.join(self.home, ".herdr", "browser")
        self.out = os.path.join(self.home, "out.png")

    def shots_are(self, *what):
        with open(self.shots, "w") as f:
            f.write("\n".join(what) + "\n")

    def run_it(self, *args, **env):
        e = {"HOME": self.home, "PATH": os.environ["PATH"], "HERDR_BROWSER_BIN": self.bin, **fake_ab.ENV,
             "HERDR_BROWSER_FRAME": self.front, **env}
        return subprocess.run(["sh", HB, "--task", "dev-shop#2", "--space", "sp1", *args], env=e, capture_output=True, text=True, timeout=60)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as f:
            return f.read().splitlines()

    def size(self, path):
        with open(path, "rb") as f:
            d = f.read(32)
        return "%dx%d" % struct.unpack(">II", d[16:24])

    # ---- the page is in front and drawn before every capture ----

    def test_each_capture_brings_the_page_to_the_front_first(self):
        self.shots_are("1280x720")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.calls(), ["front T1", "screenshot " + self.out])
        self.assertIn("Screenshot saved to " + self.out, p.stdout)

    # ---- a capture that timed out ----

    def test_a_capture_that_timed_out_is_tried_once_more(self):
        self.run_it("set", "viewport", "390", "844")
        self.shots_are("timeout", "390x844")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("the screenshot timed out (your page drew no picture); bringing it to the front and trying once more", p.stderr)
        self.assertEqual([c for c in self.calls() if c.startswith(("front", "screenshot"))],
                         ["front T1", "screenshot " + self.out, "front T1", "screenshot " + self.out])
        self.assertEqual(self.size(self.out), "390x844")

    def test_timed_out_twice_says_what_to_try(self):
        self.shots_are("timeout", "timeout")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 1)
        self.assertIn("CDP command timed out", p.stderr)
        self.assertIn("the screenshot timed out twice: your page drew no picture in time, so nothing was saved", p.stderr)
        self.assertIn("Try: herdr-browser reload, then screenshot again", p.stderr)
        self.assertIn("take the viewport (no --full)", p.stderr)
        self.assertEqual(len([c for c in self.calls() if c.startswith("screenshot")]), 2)
        self.assertFalse(os.path.exists(self.out))

    # ---- the picture has the viewport's size, or isn't kept ----

    def test_the_right_size_is_kept(self):
        self.run_it("set", "viewport", "390", "844")
        self.shots_are("390x844")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.size(self.out), "390x844")
        self.assertEqual(len([c for c in self.calls() if c.startswith("screenshot")]), 1)

    def test_a_stale_size_is_set_again_and_tried_once_more(self):
        self.run_it("set", "viewport", "1280", "800")
        self.shots_are("390x844", "1280x800")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("came out 390x844, not your viewport's 1280x800 (a stale picture); setting your viewport again and trying once more", p.stderr)
        self.assertEqual([c for c in self.calls() if not c.startswith("front")][-3:],
                         ["screenshot " + self.out, "set viewport 1280 800", "screenshot " + self.out])
        self.assertEqual(self.size(self.out), "1280x800")

    def test_a_wrong_size_twice_is_deleted_with_why(self):
        self.run_it("set", "viewport", "1280", "800")
        self.shots_are("390x844", "390x844")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 1)
        self.assertIn("the screenshot came out 390x844 twice, not your viewport's 1280x800, so it wasn't kept: it would be a stale or wrong picture", p.stderr)
        self.assertIn("Try: herdr-browser set viewport 1280 800, then herdr-browser reload, then screenshot again", p.stderr)
        self.assertFalse(os.path.exists(self.out), "the wrong picture isn't left behind")
        self.assertNotIn("Screenshot saved", p.stdout)

    def test_a_rejected_picture_puts_back_the_one_that_was_there(self):
        self.run_it("set", "viewport", "1280", "800")
        self.shots_are("1280x800", "390x844", "390x844")
        self.assertEqual(self.run_it("screenshot", self.out).returncode, 0)
        with open(self.out, "rb") as f:
            good = f.read()
        self.assertEqual(self.run_it("screenshot", self.out).returncode, 1)
        with open(self.out, "rb") as f:
            self.assertEqual(f.read(), good, "the good picture from before is still there")

    def test_a_path_ending_in_a_space_is_checked_where_it_was_asked(self):
        self.run_it("set", "viewport", "1280", "800")
        out = os.path.join(self.home, "proof.png ")
        neighbour = os.path.join(self.home, "proof.png")
        with open(neighbour, "w") as f:
            f.write("not mine")
        self.shots_are("390x844", "390x844")
        self.assertEqual(self.run_it("screenshot", out).returncode, 1)
        with open(neighbour) as f:
            self.assertEqual(f.read(), "not mine")

    def test_the_scale_counts(self):
        self.run_it("set", "viewport", "390", "844", "2")
        self.shots_are("780x1688")
        self.assertEqual(self.run_it("screenshot", self.out).returncode, 0)

    def test_a_flag_is_not_kept_as_the_scale(self):
        self.run_it("set", "viewport", "390", "844", "--json")
        with open(os.path.join(self.root, "dev-shop-2.viewport")) as f:
            self.assertEqual(f.read().splitlines(), ["viewport", "390", "844"])
        self.shots_are("390x844")
        self.assertEqual(self.run_it("screenshot", self.out).returncode, 0)

    def test_scale_0_is_the_pages_own_ratio(self):
        self.run_it("set", "viewport", "390", "844", "0")
        self.shots_are("780x1688")
        self.assertEqual(self.run_it("screenshot", self.out, FAKE_PAGE="390 844 2 800 600").returncode, 0)

    def test_a_viewport_that_isnt_numbers_is_not_kept(self):
        self.run_it("set", "viewport", "wide", "tall")
        self.assertFalse(os.path.exists(os.path.join(self.root, "dev-shop-2.viewport")))

    def test_without_a_viewport_set_the_page_own_size_counts(self):
        self.shots_are("1280x720", "800x600", "800x600")
        self.assertEqual(self.run_it("screenshot", self.out).returncode, 0)
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 1)
        self.assertIn("came out 800x600 twice, not your viewport's 1280x720", p.stderr)

    def test_a_jpeg_is_checked_too(self):
        self.run_it("set", "viewport", "390", "844")
        out = os.path.join(self.home, "thumb.jpg")
        self.shots_are("jpeg 1280x800", "jpeg 1280x800")
        p = self.run_it("--own", "screenshot", out, "--screenshot-format", "jpeg", "--screenshot-quality", "60")
        self.assertEqual(p.returncode, 1)
        self.assertIn("came out 1280x800 twice, not your viewport's 390x844", p.stderr)

    def test_the_screens_jpeg_thumbnail_at_the_right_size_is_kept(self):
        self.run_it("set", "viewport", "390", "844")
        out = os.path.join(self.home, "thumb.jpg")
        self.shots_are("jpeg 390x844")
        p = self.run_it("--own", "screenshot", out, "--screenshot-format", "jpeg", "--screenshot-quality", "60")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(out))

    def test_flags_before_the_command_dont_skip_the_check(self):
        self.run_it("set", "viewport", "390", "844")
        out = os.path.join(self.home, "x.jpg")
        self.shots_are("jpeg 1280x800", "jpeg 1280x800")
        p = self.run_it("--screenshot-format", "jpeg", "screenshot", out)
        self.assertEqual(p.returncode, 1)
        self.assertIn("came out 1280x800 twice", p.stderr)

    def test_full_page_and_element_shots_are_not_held_to_the_viewport(self):
        self.run_it("set", "viewport", "390", "844")
        self.shots_are("390x9000")
        self.assertEqual(self.run_it("screenshot", "--full", self.out).returncode, 0)
        self.assertEqual(self.run_it("screenshot", "#card", self.out).returncode, 0)
        self.assertEqual(self.run_it("screenshot", "@e3", self.out).returncode, 0)
        self.assertEqual(len([c for c in self.calls() if c.startswith("screenshot")]), 3)

    def test_a_device_is_held_to_its_screen(self):
        self.run_it("set", "viewport", "1280", "800")
        self.run_it("set", "device", "iPhone 12")
        # an iPhone 12: its page may be laid out 980 wide, but its screen is 390x844 at ratio 3
        page = "980 2121 3 390 844"
        self.shots_are("1170x2532", "1280x800", "1280x800")
        self.assertEqual(self.run_it("screenshot", self.out, FAKE_PAGE=page).returncode, 0)
        p = self.run_it("screenshot", self.out, FAKE_PAGE=page)
        self.assertEqual(p.returncode, 1)
        self.assertIn("came out 1280x800 twice, not your viewport's 1170x2532", p.stderr)

    # ---- a page that doesn't draw, and the one retry ----

    def test_a_page_that_never_draws_isnt_captured(self):
        self.shots_are("1280x720")
        p = self.run_it("screenshot", self.out, FAKE_PAGE="")
        self.assertEqual(p.returncode, 1)
        self.assertIn("your page didn't draw (its window may be hidden or busy); bringing it to the front again", p.stderr)
        self.assertIn("your page drew no picture within 10 s, even brought to the front, so no screenshot was taken. Try: herdr-browser reload", p.stderr)
        self.assertEqual(self.calls(), ["front T1", "front T1"])

    def test_a_timeout_said_in_json_is_tried_once_more(self):
        self.shots_are("json-timeout", "1280x720")
        p = self.run_it("--json", "screenshot", self.out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("trying once more", p.stderr)

    def test_one_retry_whatever_went_wrong(self):
        self.run_it("set", "viewport", "1280", "800")
        self.shots_are("390x844", "timeout")
        p = self.run_it("screenshot", self.out)
        self.assertEqual(p.returncode, 1)
        self.assertIn("the screenshot timed out after a retry", p.stderr)
        self.assertEqual(len([c for c in self.calls() if c.startswith("screenshot")]), 2)

    def test_if_changed_after_a_rejected_picture_is_an_error(self):
        self.run_it("set", "viewport", "1280", "800")
        self.shots_are("390x844", "unchanged")
        p = self.run_it("screenshot", "--if-changed", self.out)
        self.assertEqual(p.returncode, 1)
        self.assertIn("the retry saved no new picture (--if-changed compares with the rejected one)", p.stderr)

    def test_if_changed_unchanged_is_fine(self):
        self.shots_are("unchanged")
        p = self.run_it("screenshot", "--if-changed", self.out)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("Screenshot unchanged", p.stdout)

    def test_no_path_finds_the_picture_from_what_agent_browser_says(self):
        self.run_it("set", "viewport", "1280", "800")
        self.shots_are("390x844", "390x844")
        p = self.run_it("screenshot")
        self.assertEqual(p.returncode, 1)
        self.assertFalse(os.path.exists(os.path.join(self.home, "default.png")))

    # ---- a new tab gets the viewport and media again ----

    def restart(self):
        """The space's browser restarted: the tab this agent had is on a browser that is gone."""
        with open(os.path.join(self.root, "dev-shop-2.cdp"), "w") as f:
            f.write("ws://127.0.0.1:1/devtools/browser/gone\n")

    def test_a_restart_sets_the_viewport_and_media_again(self):
        self.run_it("set", "viewport", "1280", "800")
        self.run_it("set", "media", "dark")
        self.restart()
        open(self.log, "w").close()
        p = self.run_it("snapshot")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.calls(), ["set viewport 1280 800", "set media dark", "snapshot"])
        self.assertIn("your space's browser was restarted, so your tab starts again on a blank page (set again: viewport 1280 800, media dark)", p.stderr)

    def test_a_device_with_a_space_in_its_name_is_set_again_whole(self):
        self.run_it("set", "device", "iPhone 12")
        self.restart()
        open(self.log, "w").close()
        open(self.log + ".n", "w").close()
        self.run_it("get", "url")
        self.assertEqual(self.calls()[0], "set device iPhone 12")
        with open(self.log + ".n") as f:
            self.assertEqual(f.read().split(), ["3"], "set, device and one name: 'iPhone 12'")
        with open(os.path.join(self.root, "dev-shop-2.viewport")) as f:
            self.assertEqual(f.read().splitlines(), ["device", "iPhone 12"])

    def test_a_browser_herdr_closed_sets_them_again_and_says_so(self):
        self.run_it("set", "viewport", "390", "844")
        self.restart()
        with open(os.path.join(self.root, "dev-shop-2.closed"), "w") as f:
            f.write("it was closed after 10 minutes unused\n")
        p = self.run_it("snapshot")
        self.assertIn("had been closed (it was closed after 10 minutes unused); your tab starts again on a blank page (set again: viewport 390 844): open your page. Sign-ins are kept.", p.stderr)

    def test_nothing_set_starts_at_the_default_size(self):
        self.run_it("get", "url")
        self.restart()
        open(self.log, "w").close()
        p = self.run_it("snapshot")
        self.assertEqual(self.calls(), ["snapshot"])
        self.assertIn("(at its default size)", p.stderr)

    def test_the_agents_own_close_starts_fresh(self):
        self.run_it("set", "viewport", "1280", "800")
        self.run_it("close")
        self.assertFalse(os.path.exists(os.path.join(self.root, "dev-shop-2.viewport")))
        open(self.log, "w").close()
        self.run_it("snapshot")
        self.assertEqual(self.calls(), ["snapshot"])

    def test_a_failed_set_is_not_kept(self):
        with open(self.bin) as f:
            src = f.read()
        with open(self.bin, "w") as f:
            f.write(src.replace('if case', '[ "$1" = set ] && exit 1\nif case', 1))
        self.assertEqual(self.run_it("set", "viewport", "1280", "800").returncode, 1)
        self.assertFalse(os.path.exists(os.path.join(self.root, "dev-shop-2.viewport")))


if __name__ == "__main__":
    unittest.main()
