"""Friction loop, slice 3 (#94): shape and check. An Assistant shapes a kept problem (`--shape --fix --search`), which
keeps its fix and starts a read-only check on GitHub: the feedback repo's issues, open and closed (a closed one says
fixed or declined before), Shepherdr's repo's too when filing to a fork (Follow only), and Shepherdr's newest release.
Only the `search` words leave the machine, redacted; no check without them; gh failing leaves the row as it was; the
person's Follow this one posts nothing. Slice 1's throwaway store, settings file and fakes (test_feedback_found.World),
with a fake gh that answers from made-up issues; one run goes through the real CLI with HERDR_TASK_GH."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from test_feedback_found import BIN, ROOT, World, fb  # noqa: E402  (World has no tests of its own: none run twice)
import herdr_task.assistant_settings as aset  # noqa: E402
import herdr_task.feedback_check as fc  # noqa: E402
import herdr_task.feedback_page as page  # noqa: E402

ASSISTANT = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1"}, "name": "assistant"}
FORK = "acme/shepherdr"
UP = fb.REPO  # Shepherdr's own repo, upstream's default


def issue(n, title, state="OPEN", reason=None, repo=UP):
    return {"number": n, "title": title, "url": f"https://github.com/{repo}/issues/{n}", "state": state, "stateReason": reason}


class Checked(World):
    """A task's report in sp1, then its Assistant; gh answers from self.issues ({repo: [issue]}) and self.release."""

    def setUp(self):
        super().setUp()
        self.issues = {}
        self.release = "v3.2.23"
        self.down = False
        self.dupe_of = {}  # (repo, n) -> the canonical issue GitHub's timeline names
        p = mock.patch.object(fb, "run", self.github)
        p.start()
        self.addCleanup(p.stop)

    def github(self, args, **_):
        self.gh.append(args)
        ok = lambda out: subprocess.CompletedProcess(args, 0, out, "")
        if self.down:
            return subprocess.CompletedProcess(args, 1, "", "error connecting to api.github.com")
        if args[1:3] == ["issue", "list"]:
            repo, words = args[args.index("--repo") + 1], args[args.index("--search") + 1].split()
            hits = [x for x in self.issues.get(repo, []) if all(w in x["title"].lower() for w in words)]
            if args[args.index("--state") + 1] == "open":
                hits = [x for x in hits if x["state"] == "OPEN"]
            return ok(json.dumps(hits))
        if args[1:3] == ["api", "graphql"]:
            n = int(next(a for a in args if a.startswith("i="))[2:])
            repo = "/".join(next(a for a in args if a.startswith(k + "="))[2:] for k in ("o", "n"))
            c = self.dupe_of.get((repo, n))
            nodes = [{"canonical": {**c, "repository": {"nameWithOwner": repo}}}] if c else []
            return ok(json.dumps({"data": {"repository": {"issue": {"timelineItems": {"nodes": nodes}}}}}))
        if args[1] == "api" and args[2].endswith("/releases/latest"):
            return ok(self.release + "\n") if self.release else subprocess.CompletedProcess(args, 1, "", "HTTP 404: Not Found")
        if "--body-file" in args:
            return ok("https://github.com/acme/shep/issues/42\n")
        return subprocess.CompletedProcess(args, 1, "", "unexpected")

    def report(self, line="The reply bubble doesn't show which message it answers"):
        self.caller = dict(self.caller)
        code, out = self.say(line, "--details", "Seen in the chat of Jane's shop.", "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)["key"]

    def shape(self, key, *more, search="reply bubble message"):
        self.caller = ASSISTANT
        code, out = self.say("--key", key, "--shape", "--fix", "Show the first line of the message it answers above it",
                             *(["--search", search] if search is not None else []), *more, "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)

    def one(self, key):
        return next(p for p in self.listed() if p["key"] == key)

    def searched(self):
        return [a[a.index("--search") + 1] for a in self.gh if a[1:3] == ["issue", "list"]]

    # ---- shape --------------------------------------------------------------------------------

    def test_shaping_writes_the_fix_and_starts_the_check(self):
        key = self.report()
        self.issues = {UP: [issue(7, "Reply bubble loses its message")]}
        out = self.shape(key)
        self.assertTrue(out["shaped"] and out["checked"])
        p = self.one(key)
        self.assertEqual((p["fix"], p["search"]), ("Show the first line of the message it answers above it", "reply bubble message"))
        (m,) = p["checked"]["dupes"]
        self.assertEqual((m["repo"], m["number"], m["state"], m["title"]), (UP, 7, "open", "Reply bubble loses its message"))
        self.assertEqual(p["checked"]["repo"], UP)
        self.assertEqual(p["checked"]["upstream"], [])  # filing to Shepherdr's own repo: searched once, not twice
        self.assertEqual(p["state"], "told")  # shaping decides nothing: it still waits for the person

    def test_only_an_assistant_shapes(self):
        key = self.report()
        code, out = self.say("--key", key, "--shape", "--fix", "x", "--search", "reply bubble")
        self.assertEqual(code, 1)
        self.assertIn("Only an Assistant shapes", out)
        self.assertNotIn("search", self.one(key))
        self.assertEqual(self.searched(), [])

    def test_a_closed_completed_match_is_fixed_before_and_not_planned_declined_before(self):
        key = self.report()
        self.issues = {UP: [issue(3, "Reply bubble message shows nothing", "CLOSED", "COMPLETED"),
                            issue(4, "Reply bubble message preview", "CLOSED", "NOT_PLANNED")]}
        self.shape(key)
        a, b = self.one(key)["checked"]["dupes"]
        self.assertEqual((a["state"], a["reason"], b["state"], b["reason"]), ("closed", "completed", "closed", "not_planned"))
        self.assertEqual(fc.said(a), "Fixed before: “Reply bubble message shows nothing”")
        self.assertEqual(fc.said(b), "Declined before: “Reply bubble message preview”")
        # closed ones are searched for too (today's --file looks at open ones only)
        self.assertTrue(all(a[a.index("--state") + 1] == "all" for a in self.gh if a[1:3] == ["issue", "list"]))

    def test_a_duplicate_is_followed_to_its_canonical_issue(self):
        key = self.report()
        self.issues = {UP: [issue(5, "Reply bubble message", "CLOSED", "DUPLICATE")]}
        self.dupe_of = {(UP, 5): issue(2, "Replies don't say what they answer", "CLOSED", "COMPLETED")}
        self.shape(key)
        (m,) = self.one(key)["checked"]["dupes"]
        self.assertEqual((m["number"], m["canonical"]["number"], m["canonical"]["reason"]), (5, 2, "completed"))
        self.assertEqual(fc.said(m), "Fixed before: “Replies don't say what they answer”")

    def test_a_fork_feedback_repo_also_searches_shepherdrs_repo_whose_matches_are_follow_only(self):
        self.settings({"here": "vm-test", "everywhere": {"agents": {"feedback_repo": FORK}}})
        key = self.report()
        self.issues = {FORK: [issue(9, "Reply bubble message missing", repo=FORK)],
                       UP: [issue(9, "Reply bubble message preview", "CLOSED", "COMPLETED")]}
        out = self.shape(key)
        self.assertEqual([a[a.index("--repo") + 1] for a in self.gh if a[1:3] == ["issue", "list"]], [FORK, UP])
        c = self.one(key)["checked"]
        self.assertEqual((c["repo"], c["dupes"][0]["repo"], c["upstream"][0]["repo"]), (FORK, FORK, UP))
        # one number in two repos: told apart by the whole repo, never a bare number
        self.assertNotEqual(c["dupes"][0]["url"], c["upstream"][0]["url"])
        self.assertEqual(fc.said(c["upstream"][0], True), "Shepherdr's makers fixed it before: “Reply bubble message preview”")
        self.assertTrue(out["checked"])
        self.assertIn("Shepherdr's makers fixed it before", fc.found_words(c))

    def test_a_newer_release_is_named(self):
        key = self.report()
        self.shape(key)
        c = self.one(key)["checked"]
        self.assertEqual((c["newest"], c["installed"]), ("3.2.23", "3.2.22"))
        self.assertEqual(fc.newer(c), ("3.2.23", "3.2.22"))
        self.assertIn("A newer version is out (3.2.23; you have 3.2.22)", fc.found_words(c))
        # the same version, or none released yet: nothing said
        self.assertIsNone(fc.newer({**c, "newest": "3.2.22"}))
        self.release = None
        self.say("--key", key, "--check", "--json")
        self.assertIsNone(self.one(key)["checked"]["newest"])

    def test_no_check_runs_without_search_words(self):
        key = self.report()
        out = self.shape(key, search=None)
        self.assertEqual((out["shaped"], out["checked"], out["why"]), (True, False, "no-search"))
        self.assertEqual(self.gh, [])
        self.caller = ASSISTANT
        code, out = self.say("--key", key, "--check", "--json")
        self.assertEqual(json.loads(out)["why"], "no-search")
        self.assertEqual(self.gh, [])
        self.assertNotIn("checked", self.one(key))

    def test_the_search_sends_only_those_words_redacted(self):
        key = self.report("Jane's shop chat loses the reply bubble")
        self.shape(key, search="Jane reply bubble ghp_abcdefghijklmnopqrstuvwxyz0123 shown")
        for q in self.searched():
            self.assertNotIn("jane", q.lower())
            self.assertNotIn("ghp_", q)
            self.assertNotIn("shop", q)  # the line's own words never leave
        self.assertEqual(self.searched()[0], "reply bubble shown")
        # nothing but the search words is in any gh call: not the line, not the details
        flat = " ".join(" ".join(a) for a in self.gh)
        self.assertNotIn("Seen in the chat", flat)
        self.assertNotIn("loses", flat)

    def test_a_long_search_tries_six_words_then_three(self):
        key = self.report()
        self.shape(key, search="reply bubble message answer missing preview quoted header")
        self.assertEqual(self.searched(), ["reply bubble message answer missing preview", "reply bubble message"])

    def test_gh_failing_leaves_the_row_as_it_was(self):
        key = self.report()
        self.issues = {UP: [issue(7, "Reply bubble loses its message")]}
        self.shape(key)
        before = self.one(key)
        self.down = True
        self.caller = ASSISTANT
        code, out = self.say("--key", key, "--check", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out)["why"], "gh")
        after = self.one(key)
        self.assertEqual({k: v for k, v in after.items() if k != "check_error"}, before)
        self.assertIn("GitHub isn't reachable", after["check_error"]["why"])
        # it answers again: the note goes
        self.down = False
        self.say("--key", key, "--check", "--json")
        self.assertNotIn("check_error", self.one(key))

    def test_a_path_in_the_search_words_never_leaves(self):
        # redact() keeps a home path's tail (~/clients/…), fine in an issue body: a search drops the whole path
        key = self.report()
        self.shape(key, search="reply bubble /home/localuser/clients/private-project ~/work/acme-site C:\\Users\\x message")
        self.assertEqual(self.searched(), ["reply bubble message"])
        # a secret is redacted whole before any word is dropped, and a quoted path goes whole, spaces and all
        for words in ("reply bubble password: example123 message", 'reply bubble "~/work/Private Project" message',
                      "reply bubble token=example123 message"):
            self.gh.clear()
            self.shape(key, search=words)
            self.assertEqual(self.searched(), ["reply bubble message"], words)
            self.assertNotIn("example123", json.dumps(self.gh))

    def test_a_release_lookup_that_fails_keeps_the_last_answer(self):
        key = self.report()
        self.shape(key)
        self.assertEqual(self.one(key)["checked"]["newest"], "3.2.23")
        real = self.github
        self.github = lambda args, **kw: (subprocess.CompletedProcess(args, 1, "", "HTTP 502: Bad Gateway")
                                          if args[1] == "api" and args[2].endswith("/releases/latest") else real(args, **kw))
        self.caller = ASSISTANT
        with mock.patch.object(fb, "run", self.github):
            self.say("--key", key, "--check", "--json")
        self.assertEqual(self.one(key)["checked"]["newest"], "3.2.23")
        # GitHub's own "no release" (404) is an answer: none
        self.release = None
        self.say("--key", key, "--check", "--json")
        self.assertIsNone(self.one(key)["checked"]["newest"])

    def test_gh_that_cant_start_is_a_failed_check_not_a_crash(self):
        key = self.report()
        self.shape(key)
        before = self.one(key)
        self.caller = ASSISTANT

        def missing(args, **_):
            raise FileNotFoundError(2, "No such file or directory")
        with mock.patch.object(fb, "run", missing):
            code, out = self.say("--key", key, "--check", "--json")
        self.assertEqual((code, json.loads(out)["why"]), (0, "gh"))
        after = self.one(key)
        self.assertIn("gh can't start", after["check_error"]["why"])
        self.assertEqual(after["checked"], before["checked"])

    def test_a_space_with_offers_off_checks_nothing(self):
        key = self.report()
        self.settings({"here": "vm-test", "spaces": {"sp1": {"agents": {"feedback": False}}}})
        out = self.shape(key)
        self.assertEqual((out["shaped"], out["why"]), (False, "off"))
        self.assertEqual(self.gh, [])

    def test_the_check_runs_again_before_posting_and_the_duplicate_search_uses_the_search_words(self):
        key = self.report()
        self.shape(key)
        self.gh.clear()
        self.issues = {UP: [issue(8, "Reply bubble message gone", "CLOSED", "COMPLETED")]}
        self.caller = ASSISTANT
        code, out = self.say("--key", key, "--file", "--goal", "Reply", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.one(key)["checked"]["dupes"][0]["number"], 8)
        self.assertEqual(set(self.searched()), {"reply bubble message"})

    # ---- Follow this one -------------------------------------------------------------------------

    def person(self, *argv):
        self.caller = {}
        env = mock.patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("HC_TERMINAL_ID", None)
        os.environ.pop("HC_TERMINAL_SOCKET", None)
        with mock.patch("herdr_task.base.FOREIGN_TERMINAL", False, create=True):
            return self.say(*argv)

    def test_follow_posts_nothing_and_undo_puts_it_back(self):
        key = self.report()
        self.issues = {UP: [issue(3, "Reply bubble message shows nothing", "CLOSED", "COMPLETED")]}
        self.shape(key)
        before = self.one(key)
        self.gh.clear()
        code, out = self.person("--key", key, "--follow", f"https://github.com/{UP}/issues/3", "--json")
        self.assertEqual(code, 0, out)
        self.assertTrue(json.loads(out)["changed"])
        self.assertEqual(self.gh, [])  # nothing posted, nothing even read
        p = self.one(key)
        self.assertEqual((p["decision"], p["outcome"]["issue"], p["outcome"]["state"], p["outcome"]["reason"]),
                         ("following", f"{UP}#3", "closed", "completed"))
        self.assertEqual(p["related"], [{"issue": f"{UP}#3", "url": f"https://github.com/{UP}/issues/3", "by": "person"}])
        # no longer offered in chat, nor on upstream's list
        self.caller = TASK_AGAIN
        self.assertIn("follows an issue", self.say("The reply bubble doesn't show which message it answers")[1])
        self.assertNotIn(key, [r["key"] for r in json.loads(self.say("--list", "--json")[1])])
        # Undo: as it was, the issue link gone
        code, out = self.person("--key", key, "--undo", "--expect", "following", "--json")
        self.assertEqual(code, 0, out)
        p = self.one(key)
        for k in ("decision", "outcome", "related", "was"):
            self.assertNotIn(k, p)
        self.assertEqual((p["state"], p["checked"]), (before["state"], before["checked"]))

    def test_follow_takes_only_an_issue_its_check_found(self):
        key = self.report()
        self.shape(key)
        code, out = self.person("--key", key, "--follow", "https://github.com/acme/other/issues/1")
        self.assertEqual(code, 1)
        self.assertIn("its check found", out)
        self.assertNotIn("decision", self.one(key))

    def test_follow_is_refused_in_an_agents_terminal(self):
        key = self.report()
        self.issues = {UP: [issue(3, "Reply bubble message shows nothing")]}
        self.shape(key)
        with mock.patch.dict(os.environ, {"HC_TERMINAL_ID": "t5"}):
            code, out = self.say("--key", key, "--follow", f"https://github.com/{UP}/issues/3")
        self.assertEqual(code, 1)
        self.assertIn("Only the person follows", out)
        self.assertNotIn("decision", self.one(key))

    def test_a_chat_yes_or_no_after_follow_changes_nothing(self):
        # the chat's card stayed open while the person chose Follow this one on the page
        key = self.report()
        self.issues = {UP: [issue(3, "Reply bubble message shows nothing")]}
        self.shape(key)
        self.person("--key", key, "--follow", f"https://github.com/{UP}/issues/3")
        self.gh.clear()
        self.caller = ASSISTANT
        for flag in ("--file", "--no"):
            code, out = self.say("--key", key, flag, "--json")
            self.assertEqual((code, json.loads(out)["why"]), (0, "following"), out)
        self.assertEqual(self.gh, [])
        p = self.one(key)
        self.assertEqual((p["decision"], p["state"]), ("following", "told"))

    def test_not_now_or_never_on_a_followed_one_waits_for_its_undo(self):
        key = self.report()
        self.issues = {UP: [issue(3, "Reply bubble message shows nothing")]}
        self.shape(key)
        self.person("--key", key, "--follow", f"https://github.com/{UP}/issues/3")
        code, out = self.person("--key", key, "--later", "week", "--json")
        self.assertFalse(json.loads(out)["changed"])
        self.assertEqual(self.one(key)["decision"], "following")

    # ---- what the Assistant is told -------------------------------------------------------------

    def test_an_unshaped_offer_says_how_to_shape_it_and_a_shaped_one_doesnt(self):
        key = self.report()
        self.caller = ASSISTANT
        out = self.say("--key", key, "The reply bubble doesn't show which message it answers")[1]
        self.assertIn(f"--key {key} --shape", out)
        self.assertIn("Offer it once", out)
        self.shape(key)
        with mock.patch.object(fb, "recent", lambda p: False):  # a later session: offered again, now shaped
            out = self.say("--key", key, "The reply bubble doesn't show which message it answers")[1]
        self.assertNotIn("--shape", out)

    def test_the_settings_line_names_the_page_and_says_record_without_asking(self):
        self.assertIn("Feedback page", fc.SETTINGS_WORDS)
        self.assertIn("without asking", fc.SETTINGS_WORDS)
        self.assertIn("--shape", fc.SETTINGS_WORDS)
        self.assertIn("--search", fc.SETTINGS_WORDS)
        self.assertIn("public words", fc.SETTINGS_WORDS)
        src = open(aset.__file__).read()
        self.assertIn("FEEDBACK_SHAPE", src[src.index('"Feedback offers"'):src.index('"Feedback offers"') + 200])

    # ---- pins: the upstream seams this slice relies on (#94) --------------------------------------

    def test_pins(self):
        import inspect
        self.assertEqual(list(inspect.signature(fb.search_terms).parameters), ["line"])
        self.assertEqual(list(inspect.signature(fb.duplicates).parameters), ["repo", "line"])
        self.assertEqual(list(inspect.signature(fb.offer_words).parameters), ["line", "key"])
        self.assertEqual(list(inspect.signature(fb.feedback_on).parameters), ["space", "d"])
        self.assertEqual(list(inspect.signature(fb.shepherdr_version).parameters), [])
        self.assertEqual(fb.REPO, "eliasstravik/shepherdr")
        self.assertIn("Feedback offers", open(aset.__file__).read())


TASK_AGAIN = {"labels": {"herdr.task": "dev#7", "herdr.task.space": "sp1", "herdr.agent": "codex"}, "name": "shep-7-fix"}


class RealCli(unittest.TestCase):
    """The real herdr-task, with HERDR_TASK_GH a fake gh script that logs what it was asked: --check from the person's
    side (the service's) on a shaped record, a throwaway store and settings file."""

    def test_check_through_herdr_task_gh(self):
        d = tempfile.mkdtemp(prefix="feedback-check-cli-")
        log, gh = os.path.join(d, "gh.log"), os.path.join(d, "gh")
        with open(gh, "w") as f:
            f.write("#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + log + "\n"
                    "case \"$*\" in\n"
                    "  *'issue list'*) echo '[{\"number\":3,\"title\":\"Reply bubble shows nothing\",\"url\":\"https://github.com/eliasstravik/shepherdr/issues/3\",\"state\":\"CLOSED\",\"stateReason\":\"COMPLETED\"}]';;\n"
                    "  *releases/latest*) echo v3.2.23;;\n"
                    "  *) exit 1;;\n"
                    "esac\n")
        os.chmod(gh, os.stat(gh).st_mode | stat.S_IEXEC)
        with open(os.path.join(d, ".feedback.json"), "w") as f:
            json.dump({"problems": {"abc123": {"id": "abc123", "line": "The reply bubble hides its message", "state": "found",
                                               "space": "sp1", "search": "reply bubble", "at": 1}}}, f)
        with open(os.path.join(d, "settings.json"), "w") as f:
            json.dump({}, f)
        env = {"HOME": os.environ["HOME"], "PATH": "/usr/bin:/bin", "HERDR_TASK_STORE": d, "HERDR_TASK_GH": gh,
               "HERDR_TASK_SETTINGS": os.path.join(d, "settings.json"), "SHEPHERDR_NO_MIGRATE": "1"}
        r = subprocess.run([sys.executable, os.path.join(BIN, "herdr-task"), "feedback", "--key", "abc123", "--check", "--json"],
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with open(os.path.join(d, ".feedback.json")) as f:
            p = json.load(f)["problems"]["abc123"]
        self.assertEqual((p["checked"]["dupes"][0]["reason"], p["checked"]["newest"]), ("completed", "3.2.23"))
        with open(log) as f:
            asked = f.read()
        self.assertIn("issue list --repo eliasstravik/shepherdr --state all --search reply bubble", asked)
        self.assertNotIn("hides", asked)


if __name__ == "__main__":
    unittest.main()
