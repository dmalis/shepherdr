"""Friction loop, slice 4 (#94): the yes for the exact text, posted once. `--file` writes a draft and posts nothing; the
person's yes (`--approve <rev>`, the page's Post it, or `--by chat`) is for one revision and target; `--file --rev N`
posts that stored draft byte for byte with its hidden marker, once: posting, then posted, refused (a clear no before
anything was written) or unsure (never posted again, reconciled from the repo's own issues by the marker). Not now and
Never take a yes back. Slice 1's throwaway store, settings file and fakes (test_feedback_found.World), with a fake gh
that keeps the issues it was asked to make; one run goes through the real CLI with HERDR_TASK_GH. Made-up names only."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from test_feedback_found import BIN, ROOT, TASK, World, fb  # noqa: E402  (World has no tests of its own: none run twice)
import herdr_task.assistant_settings as aset  # noqa: E402
import herdr_task.feedback_post as post  # noqa: E402

ASSISTANT = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1", "herdr.agent": "claude"}, "name": "assistant"}
UP = fb.REPO
FORK = "acme/shepherdr"
LINE = "The reply bubble doesn't show which message it answers"


class GitHub:
    """A fake gh: issue create and comment keep what they were given (and may lose their answer), issue list searches
    titles (never a post whose answer was lost: GitHub's search lags), and the REST reads return everything."""

    def __init__(self):
        self.calls, self.made, self.comments = [], [], {}
        self.mode = "ok"        # ok, lose (written, answer lost), refuse (a 4xx, nothing written), down (nothing written, no answer)
        self.lost_from_reads = False  # a post that went out but no read finds (its marker gone)
        self.login = "jdoe-test"

    def __call__(self, args, **_):
        self.calls.append(args)
        done = lambda out: subprocess.CompletedProcess(args, 0, out, "")
        fail = lambda err: subprocess.CompletedProcess(args, 1, "", err)
        body = None
        if "--body-file" in args:
            with open(args[args.index("--body-file") + 1], "rb") as f:
                body = f.read().decode("utf-8")
        if args[1:3] in (["issue", "create"], ["issue", "comment"]):
            if self.mode == "refuse":
                return fail("HTTP 403: Resource not accessible by integration (https://api.github.com/graphql)")
            if self.mode == "down":
                return fail("Post \"https://api.github.com/graphql\": dial tcp: i/o timeout")
            repo = args[args.index("--repo") + 1]
            if args[2] == "create":
                n = 40 + len(self.made)
                self.made.append({"repo": repo, "number": n, "title": args[args.index("--title") + 1], "body": body,
                                  "html_url": f"https://github.com/{repo}/issues/{n}"})
                url = self.made[-1]["html_url"]
            else:
                n = int(args[3])
                c = self.comments.setdefault((repo, n), [])
                c.append({"body": body, "html_url": f"https://github.com/{repo}/issues/{n}#issuecomment-{900 + len(c)}"})
                url = c[-1]["html_url"]
            if self.mode == "write-4xx":  # written, then an HTTP error from a later step: nothing says it wasn't
                return fail("HTTP 422: Validation Failed (https://api.github.com/graphql)")
            return fail("stream error: connection reset") if self.mode == "lose" else done(url + "\n")
        if args[1:3] == ["issue", "list"]:
            return done("[]")
        if args[1:3] == ["api", "user"]:
            return done(self.login + "\n")
        if args[1] == "api" and args[2].startswith("repos/"):
            m = re.match(r"repos/([^/]+/[^/]+)/issues(?:/(\d+)/comments)?\?", args[2])
            repo, n = m.group(1), m.group(2)
            rows = self.comments.get((repo, int(n)), []) if n else [x for x in self.made if x["repo"] == repo]
            if self.lost_from_reads:
                rows = []
            # --paginate: one array per page, back to back
            return done("".join(json.dumps(rows[i:i + 1]) for i in range(len(rows))) or "[]")
        if args[1] == "api" and args[2].endswith("/releases/latest"):
            return done("v3.2.22\n")
        return fail("unexpected")

    def posts(self):
        return [a for a in self.calls if a[1:3] in (["issue", "create"], ["issue", "comment"])]


class Posted(World):
    """A task's report in sp1, then its Assistant; the fake gh above."""

    def setUp(self):
        super().setUp()
        self.github = GitHub()
        p = mock.patch.object(fb, "run", self.github)
        p.start()
        self.addCleanup(p.stop)

    def report(self, line=LINE):
        self.caller = TASK
        code, out = self.say(line, "--details", "Seen in the chat.", "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)["key"]

    def as_assistant(self, *argv):
        self.caller = ASSISTANT
        code, out = self.say(*argv, "--json")
        return code, json.loads(out) if out.strip().startswith("{") else out

    def draft(self, key, *fields):
        code, out = self.as_assistant("--key", key, "--file", "--happened", "It shows no quote.", *fields)
        self.assertEqual(code, 0, out)
        self.assertTrue(out["kept"], out)
        return out["draft"]

    def person(self, *argv):
        """The person's call from the Feedback page, as the service runs it: outside any agent's terminal."""
        self.caller = {}
        with mock.patch.dict(os.environ):
            os.environ.pop("HC_TERMINAL_ID", None)
            os.environ.pop("HC_TERMINAL_SOCKET", None)
            code, out = self.say(*argv, "--json")
        return code, json.loads(out)

    def one(self, key):
        return next(p for p in self.listed() if p["key"] == key)

    # ---- the draft ----------------------------------------------------------------------------

    def test_file_with_no_revision_writes_a_draft_and_posts_nothing(self):
        key = self.report()
        code, out = self.as_assistant("--key", key, "--file", "--happened", "It shows no quote.")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.github.posts(), [])
        d = out["draft"]
        self.assertEqual((d["rev"], d["target"]), (1, {"repo": UP, "action": "create"}))
        self.assertRegex(d["body"], rf"\n\n<!-- shepherdr-feedback {key} rev 1 [0-9a-f]{{16}} -->$")
        self.assertIn("## What happened\n\nIt shows no quote.", d["body"])
        self.assertEqual(self.one(key)["draft"], d)
        self.assertNotIn("approval", self.one(key))
        # the words say where it goes and the next step; the same text again keeps its revision
        self.caller = ASSISTANT
        code, words = self.say("--key", key, "--file", "--happened", "It shows no quote.")
        self.assertIn(f"A new issue in {UP}", words)
        self.assertIn(f"--approve 1 --by chat", words)
        self.assertIn(f"--file --rev 1", words)
        self.assertNotIn("shepherdr-feedback", words)  # the hidden marker isn't shown
        self.assertEqual(self.one(key)["draft"]["rev"], 1)

    def test_file_without_a_matching_approval_is_refused(self):
        key = self.report()
        self.draft(key)
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(out["why"], "no-yes")
        self.assertEqual(self.github.posts(), [])
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "5")[1]["why"], "changed")

    def test_only_the_person_approves_on_the_page_and_only_an_assistant_records_a_chat_yes(self):
        key = self.report()
        self.draft(key)
        self.caller = ASSISTANT
        with mock.patch.dict(os.environ, {"HC_TERMINAL_ID": "t5"}):
            code, out = self.say("--key", key, "--approve", "1")
        self.assertEqual(code, 1)
        self.assertIn("Only the person says yes", out)
        self.caller = TASK
        code, out = self.say("--key", key, "--approve", "1", "--by", "chat")
        self.assertEqual(code, 1)
        self.assertIn("Only an Assistant records", out)
        self.assertNotIn("approval", self.one(key))
        code, out = self.person("--key", key, "--approve", "1")
        self.assertEqual((code, out["approved"]), (0, 1))
        self.assertEqual(self.one(key)["approval"]["by"], "page")
        self.assertEqual(self.person("--key", key, "--approve", "1")[1]["changed"], False)  # a second tap: already

    def test_a_changed_draft_needs_a_new_approval(self):
        key = self.report()
        self.draft(key)
        self.person("--key", key, "--approve", "1")
        d2 = self.draft(key, "--expected", "The quote above the reply.")
        self.assertEqual(d2["rev"], 2)
        p = self.one(key)
        self.assertNotIn("approval", p)
        self.assertNotIn("decision", p)
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "changed")
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "2")[1]["why"], "no-yes")
        self.assertEqual(self.github.posts(), [])
        self.person("--key", key, "--approve", "2")
        self.assertTrue(self.as_assistant("--key", key, "--file", "--rev", "2")[1]["filed"])
        self.assertEqual(len(self.github.posts()), 1)

    def test_a_changed_target_is_refused(self):
        key = self.report()
        self.draft(key)
        self.person("--key", key, "--approve", "1")
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": FORK}}})
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(out["why"], "target")
        self.assertEqual(self.github.posts(), [])
        # written again, it goes to the new repo, and needs the person's yes again
        d = self.draft(key)
        self.assertEqual((d["rev"], d["target"]["repo"]), (2, FORK))

    def test_a_comments_target_names_its_whole_repo(self):
        """Filing to a fork: its issue 12 and Shepherdr's issue 12 are told apart; a comment goes only where we file."""
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": FORK}}})
        key = self.report()
        d = self.draft(key, "--comment", "12")
        self.assertEqual(d["target"], {"repo": FORK, "action": "comment", "issue": 12})
        self.assertEqual(self.draft(key, "--comment", f"{FORK}#12")["target"], d["target"])
        code, out = self.as_assistant("--key", key, "--file", "--comment", f"{UP}#12")
        self.assertEqual(code, 1)
        self.assertIn(f"only to {FORK}", out["error"])
        self.person("--key", key, "--approve", "1")
        self.assertTrue(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["filed"])
        (call,) = self.github.posts()
        self.assertEqual(call[:6], [fb.GH, "issue", "comment", "12", "--repo", FORK])
        self.assertEqual(list(self.github.comments), [(FORK, 12)])
        self.assertEqual(self.one(key)["outcome"]["url"], f"https://github.com/{FORK}/issues/12")

    # ---- posting once -------------------------------------------------------------------------

    def approved(self, *fields):
        key = self.report()
        d = self.draft(key, *fields)
        self.person("--key", key, "--approve", str(d["rev"]))
        return key, d

    def test_the_posted_body_is_byte_for_byte_the_approved_draft(self):
        key, d = self.approved("--repro", "1. Reply to a message\n2. Look at the bubble ✓")
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertTrue(out["filed"], out)
        (made,) = self.github.made
        self.assertEqual((made["title"], made["body"]), (d["title"], d["body"]))
        self.assertRegex(made["body"], rf"\n\n<!-- shepherdr-feedback {key} rev 1 [0-9a-f]{{16}} -->$")
        p = self.one(key)
        self.assertEqual((p["state"], p["post"]["state"], p["url"]), ("filed", "posted", made["html_url"]))
        self.assertNotIn("approval", p)  # used up
        # and never again: the same revision, a new draft, a report
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "filed")
        self.assertIn("Already filed", self.say("--key", key, "--file", "--rev", "1")[1])
        self.assertEqual(self.as_assistant("--key", key, "--file")[1]["why"], "filed")
        self.assertEqual(len(self.github.posts()), 1)

    def test_a_post_whose_answer_was_lost_is_found_by_its_marker_and_posted_once(self):
        """GitHub made the issue, its answer never came, and its search doesn't show it yet: the repo's own issues do."""
        key, d = self.approved()
        self.github.mode = "lose"
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertTrue(out["filed"], out)
        self.assertEqual(len(self.github.made), 1)
        p = self.one(key)
        self.assertEqual((p["state"], p["post"]["state"], p["url"]), ("filed", "posted", self.github.made[0]["html_url"]))
        read = next(a for a in self.github.calls if a[1] == "api" and a[2].startswith("repos/"))
        self.assertIn(f"repos/{UP}/issues?creator=jdoe-test&state=all&since=", read[2])
        self.assertIn("--paginate", read)
        self.assertEqual(len(self.github.posts()), 1)

    def test_a_post_no_read_finds_stays_unsure_and_nothing_posts_it_again(self):
        key, d = self.approved()
        self.github.mode, self.github.lost_from_reads = "lose", True
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual((out["filed"], out["why"]), (False, "unsure"))
        self.assertEqual(self.one(key)["post"]["state"], "unsure")
        self.github.mode = "ok"
        # the Assistant again, the person's yes again, Check again, a new draft, Not now: none of them posts
        self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(self.person("--key", key, "--approve", "1")[1]["why"], "unsure")
        self.as_assistant("--key", key, "--file")
        self.assertEqual(self.person("--key", key, "--reconcile")[1]["why"], "unsure")
        self.assertEqual(self.person("--key", key, "--later", "week")[1]["changed"], False)
        self.assertEqual(len(self.github.posts()), 1)
        self.assertEqual(self.one(key)["post"]["state"], "unsure")
        # Never is what's left: kept, said no, still never posted
        self.assertEqual(self.person("--key", key, "--no", "--person")[1]["state"], "declined")
        self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(len(self.github.posts()), 1)

    def test_a_restart_from_posting_ends_unsure_and_posts_nothing(self):
        key, d = self.approved()
        with fb.problems() as ps:  # the process died after it marked the post as going out
            ps[key]["post"] = {**ps[key]["post"], "state": "posting", "started": fb.now() - fb.FILING_MS - 1000}
        self.github.lost_from_reads = True
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(out["why"], "unsure")
        self.assertEqual(self.github.posts(), [])
        self.assertEqual(self.one(key)["post"]["state"], "unsure")

    def test_one_posting_now_holds_a_second_off(self):
        key, d = self.approved()
        with fb.problems() as ps:
            ps[key]["post"] = {**ps[key]["post"], "state": "posting", "started": fb.now()}
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "posting")
        self.assertEqual(self.person("--key", key, "--no", "--person")[1]["changed"], False)
        self.assertEqual(self.github.posts(), [])

    def test_a_4xx_before_any_write_is_refused_and_the_same_yes_posts_it_later(self):
        key, d = self.approved()
        self.github.mode = "refuse"
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(out["why"], "refused")
        p = self.one(key)
        self.assertEqual(p["post"]["state"], "refused")
        self.assertIn("HTTP 403", p["post"]["why"])
        self.assertEqual(p["approval"]["rev"], 1)  # still the person's yes
        self.assertEqual(self.github.made, [])
        self.github.mode = "ok"
        self.assertTrue(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["filed"])
        self.assertEqual(len(self.github.made), 1)

    # ---- the review's cases (#94, slice 4) ----------------------------------------------------

    def test_a_bare_http_error_after_a_write_is_unsure_and_found_never_refused(self):
        """An HTTP 4xx alone doesn't say it came before the write: unsure, then found by its marker, posted once."""
        key, d = self.approved()
        self.github.mode = "write-4xx"
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertTrue(out["filed"], out)  # the repo's own issues hold its marker
        self.github.mode = "ok"
        self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(len(self.github.made), 1)
        # and when no read finds it, it stays unsure: no command posts it again
        key2 = self.report("Dictation stops after the first sentence on a phone")
        self.person("--key", key2, "--approve", str(self.draft(key2)["rev"]))
        self.github.mode, self.github.lost_from_reads = "write-4xx", True
        self.assertEqual(self.as_assistant("--key", key2, "--file", "--rev", "1")[1]["why"], "unsure")
        self.github.mode = "ok"
        self.as_assistant("--key", key2, "--file", "--rev", "1")
        self.assertEqual(len(self.github.made), 2)

    def test_dry_run_never_goes_with_rev(self):
        key, d = self.approved()
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1", "--dry-run")
        self.assertNotEqual(code, 0)
        self.assertIn("--dry-run", str(out))
        self.assertEqual(self.github.posts(), [])
        self.assertEqual(self.one(key)["post"]["state"], "waiting")

    def test_settings_changed_since_the_command_began_stop_the_post(self):
        """The settings the post is checked against are read again under the lock, right before it's reserved."""
        key, d = self.approved()
        began = fb.read_settings()
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": FORK}}})
        self.caller = ASSISTANT
        out, words = post.file_rev(key, 1, began)
        self.assertEqual(out["why"], "target")
        self.settings({"here": "vm-test", "spaces": {"sp1": {"agents": {"feedback": False}}}})
        self.assertEqual(post.file_rev(key, 1, began)[0]["why"], "off")
        self.assertEqual(self.github.posts(), [])

    def test_another_stores_post_with_the_same_id_and_revision_is_never_taken_for_this_one(self):
        key, d = self.approved()
        self.github.made.append({"repo": UP, "number": 7, "title": LINE, "html_url": f"https://github.com/{UP}/issues/7",
                                 "body": f"Elsewhere.\n\n<!-- shepherdr-feedback {key} rev 1 0123456789abcdef -->"})
        self.github.mode = "down"
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "unsure")
        self.assertNotIn("url", self.one(key))
        self.assertEqual(self.one(key)["post"]["state"], "unsure")

    def test_a_late_lookup_that_found_nothing_never_undoes_posted(self):
        key, d = self.approved()
        self.as_assistant("--key", key, "--file", "--rev", "1")
        p = self.one(key)
        post.still_unsure(key, {**p["post"], "state": "posting"}, "a slow read")
        self.assertEqual(self.one(key)["post"]["state"], "posted")
        self.assertEqual(self.one(key)["state"], "filed")

    def test_the_chats_preview_is_the_stored_body_exactly(self):
        key = self.report()
        d = self.draft(key, "--repro", "1. Reply\n\n\n\n2. Look")
        self.caller = ASSISTANT
        code, words = self.say("--key", key, "--file", "--happened", "It shows no quote.", "--repro", "1. Reply\n\n\n\n2. Look")
        self.assertIn(post.shown(d["body"]), words)
        self.assertIn("1. Reply\n\n\n\n2. Look", words)

    def test_a_comments_destination_always_says_its_number_and_repo(self):
        t = {"repo": UP, "action": "comment", "issue": 12}
        self.assertEqual(post.where_words(t, "Replies lose their quote"), f"A comment on “Replies lose their quote” (#12) in {UP}")
        self.assertEqual(post.where_words(t), f"A comment on issue #12 in {UP}")

    def test_a_new_draft_after_a_refusal_goes_back_to_file_it(self):
        """Nothing went out, so a refused post goes with the old text: the new draft is Found again, for a new yes."""
        key, d = self.approved()
        self.github.mode = "refuse"
        self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(self.one(key)["post"]["state"], "refused")
        d2 = self.draft(key, "--expected", "Its first line above the reply.")
        self.assertEqual(d2["rev"], 2)
        p = self.one(key)
        self.assertNotIn("post", p)
        self.assertNotIn("approval", p)
        self.assertNotEqual(p.get("decision"), "approved")
        self.assertTrue(self.person("--key", key, "--approve", "2")[1]["changed"])
        self.github.mode = "ok"
        self.assertTrue(self.as_assistant("--key", key, "--file", "--rev", "2")[1]["filed"])
        self.assertEqual(len(self.github.made), 1)

    def test_no_answer_at_all_is_unsure_never_refused(self):
        """A timeout says nothing about whether it went out: unsure, reconciled, never posted again by itself."""
        key, d = self.approved()
        self.github.mode = "down"
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(out["why"], "unsure")
        self.github.mode = "ok"
        self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(self.github.made, [])

    def test_never_after_post_it_makes_the_late_file_refuse(self):
        key, d = self.approved()
        self.assertEqual(self.person("--key", key, "--no", "--person")[1]["state"], "declined")
        p = self.one(key)
        self.assertNotIn("approval", p)
        self.assertNotIn("post", p)
        code, out = self.as_assistant("--key", key, "--file", "--rev", "1")
        self.assertEqual(out["why"], "declined")
        self.assertEqual(self.github.posts(), [])
        # Undo brings it back to found, the draft kept, and a new yes is needed
        self.person("--key", key, "--undo", "--expect", "declined")
        p = self.one(key)
        self.assertEqual((p["state"], p.get("decision"), p["draft"]["rev"]), ("told", None, 1))
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "no-yes")

    def test_not_now_and_the_chats_no_take_the_yes_back_too(self):
        key, d = self.approved()
        self.person("--key", key, "--later", "tomorrow")
        self.assertNotIn("approval", self.one(key))
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "later")
        key2, _ = self.approved()  # the same problem back: Undo first
        self.person("--key", key, "--undo", "--expect", "later")
        self.person("--key", key, "--approve", "1")
        self.as_assistant("--key", key, "--no")
        self.assertNotIn("approval", self.one(key))
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "declined")
        self.assertEqual(self.github.posts(), [])

    def test_the_origins_offers_switched_off_after_post_it_refuses_the_post(self):
        key, d = self.approved()
        self.settings({"here": "vm-test", "spaces": {"sp1": {"agents": {"feedback": False}}}})
        self.assertEqual(self.as_assistant("--key", key, "--file", "--rev", "1")[1]["why"], "off")
        self.assertEqual(self.github.posts(), [])

    # ---- upstream's paths, through the draft --------------------------------------------------

    def test_upstreams_chat_file_and_the_old_boxs_message_reach_a_draft_not_a_post(self):
        """The template's "Yes: --file …" and the old Feedback box's message to Everything (which an Assistant turns
        into a --file of the person's words) write a draft and answer with the next step; nothing is posted."""
        self.caller = ASSISTANT
        code, out = self.say("Ready refuses a reviewed commit")  # upstream's offer, unchanged
        self.assertIn("Leave feedback for Shepherdr about", out)
        code, out = self.say("--key", fb.id_of("Ready refuses a reviewed commit"), "Ready refuses a reviewed commit", "--file",
                             "--goal", "Accept a task.", "--happened", "It said no round was recorded.", "--surface", "web")
        self.assertEqual(code, 0, out)
        self.assertIn("nothing posted", out)
        self.assertIn("--approve 1 --by chat", out)
        # the old box: Everything's Assistant files the person's words, a line nobody reported yet
        code, out = self.say("The Tasks panel forgets its filter", "--file", "--json")
        self.assertEqual(code, 0, out)
        out = json.loads(out)
        self.assertEqual((out["kept"], out["draft"]["rev"]), (True, 1))
        self.assertEqual(self.github.posts(), [])
        self.assertEqual(self.one(out["key"])["reports"][0]["from"], {"chat": True})

    def test_the_drafts_words_end_with_the_settings_note_when_one_is_set(self):
        key = self.report()
        self.caller = ASSISTANT
        code, out = self.say("--key", key, "--file")
        self.assertFalse(out.rstrip().endswith("starts a fix here."))
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_note": "Posting also starts a fix here."}}})
        code, out = self.say("--key", key, "--file")
        self.assertTrue(out.rstrip().endswith("Posting also starts a fix here."), out[-200:])
        code, out = self.say("--key", key, "--file", "--json")
        self.assertEqual(json.loads(out)["note"], "Posting also starts a fix here.")

    def test_shaping_with_the_drafts_fields_writes_the_draft(self):
        key = self.report()
        code, out = self.as_assistant("--key", key, "--shape", "--fix", "Show the first line it answers",
                                      "--title", "Reply bubble hides its message", "--happened", "No quote.")
        self.assertEqual(code, 0, out)
        d = self.one(key)["draft"]
        self.assertEqual((d["rev"], d["title"]), (1, "Reply bubble hides its message"))
        self.assertIn("## Suggested fix\n\nShow the first line it answers", d["body"])
        self.assertEqual(self.github.posts(), [])

    def test_the_settings_line_says_the_card_shows_the_draft(self):
        text = next(r["text"] for r in aset.rows("sp1", {}, folder="") if r["key"] == "feedback")
        self.assertIn(post.SETTINGS_WORDS, text)
        for w in ("--approve <rev> --by chat", "--file --rev", "<hc feedback", "question card"):
            self.assertIn(w, post.SETTINGS_WORDS)

    # ---- pins ---------------------------------------------------------------------------------

    def test_upstream_seams_this_relies_on(self):
        """#94, slice 4: upstream's issue body, redaction, duplicate search and settings keep their names."""
        import inspect
        self.assertEqual(list(inspect.signature(fb.issue_body).parameters), ["line", "fields", "env", "private"])
        self.assertEqual(list(inspect.signature(fb.duplicates).parameters), ["repo", "line"])
        self.assertEqual(list(inspect.signature(fb.environment).parameters), ["agent", "surface"])
        self.assertTrue(callable(fb.redact) and callable(fb.feedback_repo) and callable(fb.feedback_on))
        self.assertEqual([f for f, _ in fb.FIELDS], ["goal", "happened", "tried", "expected", "fix", "repro"])


class RealCli(unittest.TestCase):
    """The real herdr-task with HERDR_TASK_GH a fake gh script that makes an issue and then drops its answer: the
    person's yes from the page (the service's call), the Assistant's post, and one issue, filed."""

    def test_a_dropped_answer_through_herdr_task_gh_is_one_issue_filed(self):
        d = tempfile.mkdtemp(prefix="feedback-post-cli-")
        log, gh, made = (os.path.join(d, x) for x in ("gh.log", "gh", "made.json"))
        with open(gh, "w") as f:
            f.write("#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + log + "\n"
                    "case \"$1 $2\" in\n"
                    "  'issue create') shift; while [ \"$1\" != --body-file ]; do shift; done\n"
                    "    python3 -c 'import json,sys; print(json.dumps([{\"html_url\":\"https://github.com/eliasstravik/shepherdr/issues/77\",\"body\":open(sys.argv[1]).read()}]))' \"$2\" > " + made + "\n"
                    "    echo 'stream error: connection reset' >&2; exit 1;;\n"
                    "  'api user') echo jdoe-test;;\n"
                    "  'api repos/'*) cat " + made + ";;\n"
                    "  *) exit 1;;\n"
                    "esac\n")
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)
        key = "abc123"
        body = "## Goal\n\nReply.\n\n" + post.marker(key, 1)
        target = {"repo": UP, "action": "create"}
        with open(os.path.join(d, ".feedback.json"), "w") as f:
            json.dump({"problems": {key: {"id": key, "line": LINE, "state": "told", "space": "sp1", "at": 1,
                                          "draft": {"rev": 1, "target": target, "title": LINE, "body": body}}}}, f)
        with open(os.path.join(d, "settings.json"), "w") as f:
            json.dump({}, f)
        env = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin", "HERDR_TASK_STORE": d, "HERDR_TASK_GH": gh,
               "HERDR_TASK_SETTINGS": os.path.join(d, "settings.json"), "SHEPHERDR_NO_MIGRATE": "1"}
        tool = [sys.executable, os.path.join(BIN, "herdr-task"), "feedback", "--key", key]
        r = subprocess.run([*tool, "--approve", "1", "--json"], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        # the post itself is an Assistant's: here the module runs it as one would, against the same store and fake gh
        code = ("import sys; sys.path.insert(0, sys.argv[1]); from herdr_task import feedback_post as p; "
                "import json; print(json.dumps(p.file_rev(sys.argv[2], 1, {})[0]))")
        r = subprocess.run([sys.executable, "-c", code, BIN, key], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(json.loads(r.stdout.strip().splitlines()[-1])["filed"], r.stdout)
        with open(log) as f:
            calls = f.read().splitlines()
        self.assertEqual(sum(c.startswith("issue create") for c in calls), 1)
        with open(os.path.join(d, ".feedback.json")) as f:
            p = json.load(f)["problems"][key]
        self.assertEqual((p["state"], p["post"]["state"], p["url"]), ("filed", "posted", "https://github.com/eliasstravik/shepherdr/issues/77"))


if __name__ == "__main__":
    unittest.main()
