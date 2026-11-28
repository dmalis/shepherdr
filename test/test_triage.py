"""Triage, phase 2 (dmalis/shepherdr#235, fork/specs/issue-loop.md): file and score, at Score only, on a throwaway repo.

The tests the spec names: nothing is posted twice; the destination fails closed; another space's field makes a draft
wait; the scorer can't add `ready`; no CLI records the app's yes; the pause and the plugin switch stop everything; a
failed check alerts and starts no run. Then the privacy check, the pace, the fingerprint and the turn-on steps.

A throwaway store, settings file and git repo (its origin names a made-up GitHub repo); gh is a fake that keeps issues
in memory (triage_gh.runner), hc and news are faked (test_feedback_found.World). Nothing is posted anywhere."""
import home_guard  # noqa: F401  (first: every test on a throwaway home, never the real one)
import io
import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from test_feedback_found import BIN, ROOT, TASK, World, fb  # noqa: E402  (World has no tests of its own)
import herdr_task.automations as autos  # noqa: E402
import herdr_task.cli as cli  # noqa: E402
import herdr_task.commands as commands  # noqa: E402
import herdr_task.github as github  # noqa: E402
import herdr_task.launch as launch  # noqa: E402
import herdr_task.schedule_gate as gate  # noqa: E402
import herdr_task.scheduler as scheduler  # noqa: E402
import herdr_task.store as store  # noqa: E402
import herdr_task.triage as tri  # noqa: E402
import herdr_task.triage_gh as tgh  # noqa: E402
import herdr_task.triage_public as public  # noqa: E402
import herdr_task.triage_publish as tpub  # noqa: E402

REAL_RUNNER = tgh.runner  # before any test replaces it with the fake gh
REPO = "acme/shepherdr"
LINE = "The reply bubble doesn't show which message it answers"
ASSISTANT = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp1", "herdr.agent": "claude"}, "name": "assistant"}
OTHER = {"labels": {"herdr.task": "dev#8", "herdr.task.space": "sp2", "herdr.agent": "codex"}, "name": "shep-8"}


class Hub:
    """A fake gh for one repo: issues kept in memory; create, edit (labels), comment, and the REST reads Triage makes,
    paginated, with an etag on the conditional read. mode: ok, lose (written, answer lost), down (nothing written)."""

    def __init__(self):
        self.calls, self.issues, self.comments = [], {}, {}
        self.mode, self.login, self.next = "ok", "jdoe-test", 40

    def add(self, title, labels=("needs-triage", "bug"), body="", user="someone", state="open"):
        n = self.next
        self.next += 1
        self.issues[n] = {"number": n, "title": title, "body": body, "labels": [{"name": l} for l in labels],
                          "state": state, "user": {"login": user}, "html_url": f"https://github.com/{REPO}/issues/{n}"}
        return n

    def labels(self, n):
        return [l["name"] for l in self.issues[n]["labels"]]

    def writes(self):
        return [a for a in self.calls if a[:2] in (["issue", "create"], ["issue", "edit"], ["issue", "comment"])]

    def creates(self):
        return [a for a in self.calls if a[:2] == ["issue", "create"]]

    def etag(self):
        rows = [n for n, x in self.issues.items() if x["state"] == "open" and "needs-triage" in self.labels(n)]
        return 'W/"' + hashlib.sha1(json.dumps(rows).encode()).hexdigest()[:12] + '"'

    def __call__(self, argv):
        a = argv[1:]
        self.calls.append(a)
        done = lambda out: subprocess.CompletedProcess(argv, 0, out, "")
        fail = lambda err, code=1, out="": subprocess.CompletedProcess(argv, code, out, err)
        body = None
        if "--body-file" in a:
            with open(a[a.index("--body-file") + 1], encoding="utf-8") as f:
                body = f.read()
        if a[:2] in (["issue", "create"], ["issue", "comment"], ["issue", "edit"]):
            if self.mode == "down":
                return fail('Post "https://api.github.com/graphql": dial tcp: i/o timeout')
            if self.mode == "limit":
                return fail("HTTP 403: You have exceeded a secondary rate limit")
        if a[:2] == ["issue", "create"]:
            labels = [a[i + 1] for i, x in enumerate(a) if x == "--label"]
            n = self.add(a[a.index("--title") + 1], labels, body, self.login)
            if self.mode == "timeout":  # written on GitHub, then cut off by triage_gh.runner's time limit
                return fail("gh timed out after 120 s: whether it went out isn't known", 124)
            return fail("stream error: connection reset") if self.mode == "lose" else done(self.issues[n]["html_url"] + "\n")
        if a[:2] == ["issue", "edit"]:
            n = int(a[2])
            names = self.labels(n)
            for i, x in enumerate(a):
                if x == "--add-label" and a[i + 1] not in names:
                    names.append(a[i + 1])
                if x == "--remove-label" and a[i + 1] in names:
                    names.remove(a[i + 1])
            self.issues[n]["labels"] = [{"name": l} for l in names]
            return done(self.issues[n]["html_url"] + "\n")
        if a[:2] == ["issue", "comment"]:
            self.comments.setdefault(int(a[2]), []).append(body)
            return done(self.issues[int(a[2])]["html_url"] + "#issuecomment-1\n")
        if a[:2] == ["api", "user"]:
            return done(self.login + "\n")
        if a[:2] == ["api", "-i"]:
            if self.mode == "down":
                return fail("error connecting to api.github.com")
            tag = self.etag()
            if "-H" in a and a[a.index("-H") + 1] == f"If-None-Match: {tag}":
                return fail("gh: HTTP 304", out="HTTP/2.0 304 Not Modified\r\nEtag: " + tag + "\r\n\r\n")
            rows = [x for n, x in self.issues.items() if x["state"] == "open" and "needs-triage" in self.labels(n)]
            return done("HTTP/2.0 200 OK\r\nEtag: " + tag + "\r\n\r\n" + json.dumps(rows))
        if a[:1] == ["api"] and a[1].startswith(f"repos/{REPO}/issues?"):
            if self.mode == "down":
                return fail("error connecting to api.github.com")
            q = dict(x.split("=", 1) for x in a[1].split("?", 1)[1].split("&"))
            rows = [x for n, x in self.issues.items() if (q.get("state") in ("all", None) or x["state"] == q["state"])
                    and (not q.get("labels") or q["labels"] in self.labels(n))
                    and (not q.get("creator") or x["user"]["login"] == q["creator"])]
            return done("".join(json.dumps([r]) for r in rows) or "[]")
        return fail("unexpected: " + " ".join(a))


class Triaged(World):
    """A throwaway checkout of acme/shepherdr on this machine, Triage at Score only for it (its schedule made), the
    space sp1 on it; Feedback reports from task agents in sp1 and sp2; the fake gh above."""

    def setUp(self):
        super().setUp()
        self.folder = os.path.realpath(tempfile.mkdtemp(prefix="triage-repo-"))
        self.addCleanup(shutil.rmtree, self.folder, True)
        git = lambda *a: subprocess.run(["git", "-C", self.folder, *a], check=True, capture_output=True)
        git("init", "-q", "-b", "main")
        with open(os.path.join(self.folder, "README.md"), "w") as f:
            f.write("Shepherdr runs Triage on the Feedback page; a Reply bubble shows its quote. Settings and Needs you.\n")
        git("add", "README.md")
        git("-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-q", "-m", "base")
        git("remote", "add", "origin", f"https://github.com/{REPO}.git")
        self.hub, self.alerts, self.slept = Hub(), [], []
        tasks = os.path.join(self.dir, "tasks")
        os.makedirs(tasks)
        ctx = lambda folder, repo, d=None: {"deny": {"emails": ["jane@example.com"], "words": ["Jane Doe", "Jane", "vm-test"]},
                                            "known": public.repo_words(folder), "redact": fb.redact}
        for target, name, value in [
            (store, "STORE", tasks), (github, "STORE", self.dir),
            (tri, "RECORD", os.path.join(self.dir, ".triage.json")), (tri, "YES", os.path.join(self.dir, ".triage-yes.json")),
            (tgh, "STATE", os.path.join(self.dir, ".triage-gh.json")), (tgh, "LOCK", os.path.join(self.dir, ".triage-gh.json.lock")),
            (public, "DENY_FILE", os.path.join(self.dir, ".triage-deny.json")), (public, "WORDS_FILE", os.path.join(self.dir, ".triage-words.json")),
            (tgh, "runner", self.hub), (tgh, "sleep", self.slept.append), (tri, "ctx_for", ctx),
            (tri, "alert", lambda title, body: self.alerts.append((title, body)) or True),
            (launch, "space_for_folder", lambda folder, caller=None: "sp1"), (launch, "default_space", lambda: "sp1"),
            (launch, "own_path", lambda: "herdr-task"), (scheduler, "ensure_scheduler", lambda quiet=False: {}),
            (fb, "shepherdr_version", lambda: "3.2.24"),
        ]:
            p = mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.dict(os.environ, {"HERDR_TASK_SETTINGS": self.file, "HC_TERMINAL_ID": "", "HC_TERMINAL_SOCKET": ""})
        p.start()
        self.addCleanup(p.stop)
        self.base = {"here": "vm-test", "everywhere": {"agents": {"feedback_repo": REPO}},
                     "repos": {self.folder: {"triage": {"level": "score"}}}, "spaces": {"sp1": {"folder": self.folder, "name": "sp1"}}}
        self.settings(self.base)
        self.out(tri.prepare(self.folder))
        tri.ensure_schedule(self.folder, REPO)

    def out(self, v):
        return v

    def triage(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["herdr-task", "triage", *argv, "--folder", self.folder]), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = cli.main()
        return code, out.getvalue()

    def report(self, line=LINE, caller=TASK, details="Seen in the chat: it shows no quote.", fix="Quote the message it answers"):
        self.caller = caller
        code, out = self.say(line, "--details", details, "--fix", fix, "--json")
        self.assertEqual(code, 0, out)
        return json.loads(out)["key"]

    def record(self):
        return tri.record_read()

    def schedule(self):
        return tri.schedule_of(self.folder)[1]

    def app_yes(self, key):
        """The person's Post it on the Feedback page, as the service keeps it (service/triage.ts keepYes): its draft's
        revision and the hash of its exact text. Only the service writes this file."""
        p = fb.problems_read()[key]
        dr = p["draft"]
        h = tri.yes_hash(dr["target"], dr["title"], tpub.fpost.shown(dr["body"]))
        with open(tri.YES, "w") as f:
            json.dump({"yes": [{"kind": "draft", "repo": REPO, "key": key, "rev": dr["rev"], "hash": h, "at": 1, "by": "app"}]}, f)


class Filing(Triaged):
    # ---- nothing is posted twice --------------------------------------------------------------

    def test_an_own_space_finding_is_filed_once_with_its_receipt_and_never_again(self):
        key = self.report()
        out = tpub.publish()
        self.assertEqual(out["posted"], 1, out)
        (create,) = self.hub.creates()
        self.assertEqual(create[create.index("--title") + 1], LINE)
        self.assertEqual([create[i + 1] for i, x in enumerate(create) if x == "--label"], ["needs-triage", "bug"])
        n = max(self.hub.issues)
        body = self.hub.issues[n]["body"]
        self.assertIn("Seen in the chat: it shows no quote.", body)
        self.assertIn("## Suggested fix\n\nQuote the message it answers", body)
        self.assertIn("3.2.24", body)
        for private in ("sp1", "vm-test", "Fix login", "dev#7", self.folder, key):
            self.assertNotIn(private, tpub.fpost.shown(body))
        p = fb.problems_read()[key]
        self.assertEqual((p["state"], p["receipt"]["number"], p["receipt"]["repo"]), ("filed", n, REPO))
        self.assertEqual(self.record()["repos"][REPO]["receipts"][str(n)]["key"], key)
        self.assertEqual(tpub.publish()["posted"], 0)
        self.report()  # reported again after filing: still the one issue
        tpub.publish()
        self.assertEqual(len(self.hub.creates()), 1)

    def test_a_post_whose_answer_was_lost_is_found_by_its_marker_and_never_posted_again(self):
        key = self.report()
        self.hub.mode = "lose"
        self.assertEqual(tpub.publish()["unsure"], 1)
        self.assertEqual(fb.problems_read()[key]["post"]["state"], "unsure")
        self.hub.mode = "ok"
        out = tpub.publish()
        self.assertEqual((out["posted"], len(self.hub.creates())), (1, 1), out)
        self.assertEqual(fb.problems_read()[key]["receipt"]["number"], max(self.hub.issues))

    def test_the_old_posting_is_fenced_off_once_triage_files_the_repo(self):
        key = self.report()
        self.caller = ASSISTANT
        code, out = self.say("--key", key, "--file", "--happened", "It shows no quote.", "--json")
        self.assertEqual(code, 0, out)
        self.assertEqual(json.loads(out)["why"], "triage")
        self.assertIn("Triage files this repo's findings", self.say("--key", key, "--file", "--rev", "1")[1])
        self.assertEqual(self.hub.writes(), [])
        self.assertEqual(json.loads(self.triage("files", "--repo", REPO, "--json")[1])["files"], True)
        self.assertEqual(json.loads(self.triage("files", "--repo", "acme/other", "--json")[1])["files"], False)

    def test_turning_it_on_reconciles_a_post_already_in_flight(self):
        key = self.report()
        with fb.problems() as ps:
            ps[key]["post"] = {"state": "unsure", "rev": 1, "started": tri.now() - 60000, "mark": "<!-- shepherdr-feedback x rev 1 -->",
                               "target": {"repo": REPO, "action": "create"}}
        n = self.hub.add(LINE, body="words\n\n<!-- shepherdr-feedback x rev 1 -->", user=self.hub.login)
        with tri.record() as d:
            d["repos"][REPO.lower()].pop("fenced")
        out = tri.prepare(self.folder)
        self.assertEqual(out["reconciled"], {"posted": 1, "unsure": 0})
        self.assertEqual(fb.problems_read()[key]["receipt"]["number"], n)
        self.assertEqual(self.hub.writes(), [])

    # ---- the destination fails closed ---------------------------------------------------------

    def test_the_destination_fails_closed(self):
        self.report()
        for agents in ({}, {"feedback_repo": "eliasstravik/shepherdr"}, {"feedback_repo": "not a repo"},
                       {"feedback_repo": "acme/elsewhere"}):
            self.settings({**self.base, "everywhere": {"agents": agents}})
            out = tpub.publish()
            self.assertEqual(out["posted"], 0, agents)
            self.assertIn("why", out)
        self.assertEqual(self.hub.writes(), [])
        self.assertIsNone(tri.destination({"everywhere": {"agents": {"feedback_repo": "https://github.com/EliasStravik/shepherdr"}}}))
        self.assertEqual(tri.destination({"everywhere": {"agents": {"feedback_repo": f"https://github.com/{REPO}"}}}), REPO)

    def test_a_destination_changed_between_draft_and_post_stops_the_pass(self):
        self.report()
        real = tri.publisher
        calls = []

        def moved(d=None):
            calls.append(1)
            if len(calls) > 1:  # read again under the lock, right before the write: changed meanwhile
                self.settings({**self.base, "everywhere": {"agents": {"feedback_repo": "acme/elsewhere"}}})
            return real()
        with mock.patch.object(tri, "publisher", moved):
            out = tpub.publish()
        self.assertEqual((out["posted"], self.hub.writes()), (0, []))

    # ---- another space's field makes a draft wait --------------------------------------------

    def test_another_spaces_field_makes_the_draft_wait_for_the_apps_yes(self):
        key = self.report()
        self.report(caller=OTHER, fix="Show the quoted message above the reply")  # the fix now comes from sp2
        p = fb.problems_read()[key]
        self.assertEqual(p["sources"]["fix"], "sp2")
        self.assertEqual(p["sources"]["line"], "sp1")
        out = tpub.publish()
        self.assertEqual((out["posted"], out["waits"], self.hub.writes()), (0, 1, []))
        self.assertEqual([w["key"] for w in tpub.waiting_rows()], [key])
        self.app_yes(key)
        self.assertEqual(tpub.publish()["posted"], 1)
        self.assertEqual(len(self.hub.creates()), 1)

    def test_a_yes_for_an_older_text_does_not_count(self):
        key = self.report()
        self.report(caller=OTHER, fix="Show the quote above it")
        tpub.publish()
        self.app_yes(key)
        self.report(caller=OTHER, fix="Show the quote above it, changed after the yes")
        out = tpub.publish()
        self.assertEqual((out["posted"], self.hub.writes()), (0, []))

    def test_an_older_row_with_no_sources_waits(self):
        self.seed({"old1": {"id": "old1", "line": LINE, "state": "found", "at": 1, "space": "sp1", "details": "From before."}})
        out = tpub.publish()
        self.assertEqual((out["posted"], out["waits"]), (0, 1))

    def test_a_private_word_makes_an_own_space_draft_wait(self):
        self.report(details="Jane saw it at 192.168.1.20 on her laptop.")
        out = tpub.publish()
        self.assertEqual((out["posted"], self.hub.writes()), (0, []))

    def test_another_machines_findings_are_copied_and_always_wait(self):
        there = os.path.join(self.dir, "there.json")
        with open(there, "w") as f:
            json.dump({"vm-b": [{"id": "b1", "line": "Search misses archived spaces", "details": "From vm-b.", "space": "sp1"}]}, f)
        out = tpub.publish(there)
        self.assertEqual((out["copied"], out["posted"]), (1, 0))
        self.assertIn("vm-b:b1", self.record()["copies"])
        self.assertEqual(self.hub.writes(), [])
        self.assertEqual([w["key"] for w in tpub.waiting_rows()], ["vm-b:b1"])

    # ---- no CLI records the app's yes ---------------------------------------------------------

    def test_no_cli_records_the_apps_yes(self):
        key = self.report(caller=OTHER)
        tpub.publish()
        rev = fb.problems_read()[key]["draft"]["rev"]
        self.caller = ASSISTANT
        self.say("--key", key, "--approve", str(rev), "--by", "chat")
        self.caller = {}
        self.say("--key", key, "--approve", str(rev), "--json")  # the person's CLI yes: not the app's
        for argv in (["status"], ["schedule"], ["prepare"], ["publish"], ["files", "--repo", REPO], ["issues"], ["due"]):
            self.triage(*argv)
        self.assertFalse(os.path.exists(tri.YES))
        self.assertEqual(tpub.publish()["posted"], 0)
        self.assertEqual(self.hub.creates(), [])
        # nothing in herdr-task writes the yes file: only service/triage.ts does
        for name in os.listdir(os.path.join(BIN, "herdr_task")):
            if name.endswith(".py"):
                with open(os.path.join(BIN, "herdr_task", name), encoding="utf-8") as f:
                    self.assertNotRegex(f.read(), r"open\(\s*YES\s*,\s*['\"][wa]", name)
        with open(os.path.join(ROOT, "service", "triage.ts"), encoding="utf-8") as f:
            self.assertIn(".triage-yes.json", f.read())

    # ---- the pace -----------------------------------------------------------------------------

    def test_writes_go_two_seconds_apart_and_creates_stop_at_the_hourly_cap(self):
        for i in range(12):
            self.report(line=f"The reply bubble number {chr(97 + i)} misses its quote")
        out = tpub.publish()
        self.assertEqual(len(self.hub.creates()), 10, out)
        self.assertTrue(all(ms <= tgh.APART_MS for ms in self.slept))
        self.assertIn("why", out)  # the cap stops the pass; the rest wait for the next one

    def test_a_secondary_limit_waits_and_sends_nothing_meanwhile(self):
        self.report()
        self.hub.mode = "limit"
        tpub.publish()
        self.assertIsNotNone(tgh.waiting())
        self.hub.mode = "ok"
        before = len(self.hub.calls)
        self.report(line="Another problem in the bubble")
        tpub.publish()
        self.assertEqual(self.hub.creates()[len([c for c in self.hub.calls[:before] if c[:2] == ["issue", "create"]]):], [])


class Scoring(Triaged):
    def scores(self, entries):
        path = os.path.join(self.dir, "scores.json")
        with open(path, "w") as f:
            json.dump(entries, f)
        code, out = self.triage("score", path, "--json")
        self.assertTrue(out.strip().startswith("{"), out)
        return code, json.loads(out)

    def entry(self, n, **kw):
        return {"issue": n, "score": 3, "why": "an agent did it by hand", "fingerprint": "ready/reviewed-head-refused",
                "area": "patch", "product": False, "ban_risk": None, "same_as": None, **kw}

    # ---- the scorer can't add `ready` ---------------------------------------------------------

    def test_the_scorer_cant_add_ready_or_anything_outside_its_labels(self):
        a, b = self.hub.add("Stuck worker"), self.hub.add("Odd wording")
        code, out = self.scores([self.entry(a, labels=["ready"]), self.entry(b, area="ready"), self.entry(b, score=6),
                                 self.entry(b, issue=999), self.entry(b, score=4, area="pipeline")])
        self.assertEqual(code, 0, out)
        self.assertEqual([x["issue"] for x in out["applied"]], [b])
        self.assertEqual(len(out["refused"]), 4)
        self.assertEqual(sorted(self.hub.labels(b)), ["bug", "pipeline", "score:4"])
        self.assertEqual(sorted(self.hub.labels(a)), ["bug", "needs-triage"])
        for w in self.hub.writes():
            self.assertNotIn("ready", w)
            self.assertNotIn("close", w)
        with self.assertRaises(AssertionError):
            tri.label_edit({"score": 3, "area": "ready"}, [])

    def test_a_product_entry_asks_the_assistant_once_and_an_own_3_is_told_once(self):
        key = self.report()
        tpub.publish()
        own = max(self.hub.issues)
        other = self.hub.add("Should the digest come on Fridays")
        self.queued.clear()
        code, out = self.scores([self.entry(own), self.entry(other, product=True, area=None, score=2)])
        self.assertEqual(code, 0, out)
        self.assertIn("decision", self.hub.labels(other))
        self.assertEqual(sorted(x["told"] for x in out["told"]), ["decision", "fit"])
        self.assertEqual([to for to, _, _ in self.queued], ["t5", "t5"])  # sp1's Assistant, never a task
        self.assertEqual(tri.act(self.folder, REPO, [own, other]), [])  # once each
        self.assertNotIn(key, json.dumps(self.queued))

    def test_a_same_as_link_is_one_advisory_comment(self):
        a, b = self.hub.add("Stuck worker"), self.hub.add("Worker stuck after ready")
        self.scores([self.entry(b, same_as=a)])
        self.assertEqual(len(self.hub.comments[b]), 1)
        self.assertIn(f"#{a}", self.hub.comments[b][0])
        self.assertEqual([w[0:2] for w in self.hub.writes()], [["issue", "edit"], ["issue", "comment"]])

    def test_a_ban_risk_alerts_once_pauses_and_applies_nothing(self):
        a, b = self.hub.add("Auto-answer the trust prompt"), self.hub.add("Odd wording")
        code, out = self.scores([self.entry(b), self.entry(a, ban_risk="answers an agent's own prompt")])
        self.assertEqual((out["paused"], out["applied"]), ("ban-risk", []), out)
        self.assertEqual(self.hub.writes(), [])
        self.assertEqual(len(self.alerts), 1)
        self.assertTrue(self.schedule()["paused"])
        self.assertIn("paused", tri.stopped(self.folder))

    def test_the_fingerprint_names_an_action_and_no_volatile_value(self):
        ok = ["ready/reviewed-head-refused", "feedback/post-unsure", "settings-page/save-lost"]
        bad = ["ready", "Ready/Refused", "ready/head-3f9a2c1d", "task/sd-286-stuck", "sync/12345", "digest/nov-28",
               "check/07h30-failed", "ready/2026-11-28", "ready refused", ""]
        for fp in ok:
            self.assertIsNone(tri.fingerprint_refusal(fp), fp)
        for fp in bad:
            self.assertIsNotNone(tri.fingerprint_refusal(fp), fp)

    # ---- the pause and the plugin switch stop everything --------------------------------------

    def stops_everything(self):
        key = self.report()
        n = self.hub.add("Stuck worker")
        self.assertEqual(tpub.publish()["posted"], 0)
        code, out = self.triage("score", "-")
        self.assertNotEqual(code, 0)
        self.assertEqual(self.triage("due")[0], 1)
        self.assertNotEqual(self.triage("issues")[0], 0)
        self.assertNotEqual(self.triage("digest")[0], 0)
        self.assertEqual(tri.act(self.folder, REPO, [n]), [])
        with store.Store(store.locate(self.folder)) as s:
            a = tri.schedule_in(s)
            with self.assertRaises(tri.Fail):
                autos.fire(s, a, "run now")
            t = s.new("Triage", "x", "here")
            t["automation"] = a["id"]
            with self.assertRaises(tri.Fail):
                commands.begin(s, t, ["claude"], "sp1")
            s.data["tasks"].remove(t)
        self.assertEqual(self.hub.writes(), [])
        self.assertNotIn("post", fb.problems_read()[key])

    def test_the_pause_stops_everything(self):
        self.assertTrue(tri.pause_schedule(self.folder, "person"))
        self.stops_everything()

    def test_the_plugin_switch_stops_everything(self):
        self.settings({**self.base, "everywhere": {**self.base["everywhere"], "plugins_off": ["triage"]}})
        self.stops_everything()

    def test_the_level_off_pauses_the_schedule_and_on_again_resumes_only_that_pause(self):
        self.settings({**self.base, "repos": {self.folder: {"triage": {"level": "off"}}}})
        tri.follow_level(self.folder)
        self.assertEqual((self.schedule()["paused"], self.schedule()["triage"]["paused_by"]), (True, "level"))
        self.settings(self.base)
        tri.follow_level(self.folder)
        self.assertFalse(self.schedule()["paused"])
        tri.pause_schedule(self.folder, "person")
        tri.follow_level(self.folder)
        self.assertTrue(self.schedule()["paused"])  # the person's pause stays

    # ---- a failed check alerts and starts no run ----------------------------------------------

    def test_a_failed_read_alerts_once_and_says_nothing_to_do(self):
        self.hub.add("Stuck worker")
        self.hub.mode = "down"
        self.assertEqual(self.triage("due")[0], 1)
        self.assertEqual(self.triage("due")[0], 1)
        self.assertEqual(len(self.alerts), 1)
        self.hub.mode = "ok"
        self.assertEqual(self.triage("due")[0], 0)
        self.assertNotIn("failing", self.record()["repos"][REPO])

    def test_a_check_that_itself_fails_alerts_and_starts_no_run(self):
        with store.Store(store.locate(self.folder)) as s:
            a = tri.schedule_in(s)
            a["checking"] = {"since": tri.now(), "whys": [["every hour", None]]}
            s.dirty = True
            before = len(s.data.get("tasks") or [])
            aid = a["id"]
        report = {"fired": []}
        gate.settle({"folder": self.folder, "id": aid, "why": [["every hour", None]]}, "failed", "it exited 2", report)
        with store.Store(store.locate(self.folder)) as s:
            self.assertEqual(len(s.data.get("tasks") or []), before)
            self.assertTrue(tri.schedule_in(s).get("check_failing"))
        self.assertEqual(report["fired"], [])
        self.assertEqual(len(self.alerts), 1)

    def test_due_reads_once_then_answers_from_its_etag(self):
        self.assertEqual(self.triage("due")[0], 1)  # nothing waits
        self.hub.add("Stuck worker")
        with tri.record() as d:
            d["repos"][REPO.lower()]["last_score"] = 0
        self.assertEqual(self.triage("due")[0], 0)
        self.assertIn("-H", self.hub.calls[-1])

    def test_the_digest_comes_on_monday_morning_once_a_week_as_the_runs_last_word(self):
        import datetime
        monday = int(datetime.datetime(2026, 11, 30, 8, 0).timestamp() * 1000)
        self.assertFalse(tri.digest_due({}, monday - 2 * 3600000)[0])  # 6:00: not yet
        self.assertTrue(tri.digest_due({}, monday)[0])
        self.assertFalse(tri.digest_due({}, monday - 24 * 3600000)[0])  # a Sunday
        live = self.hub.add("Stuck worker", labels=("bug", "score:4"), state="closed")
        self.hub.issues[live].update(state_reason="completed", closed_at="2099-01-01T00:00:00Z")
        self.hub.add("Odd wording", labels=("bug", "score:2"))
        self.hub.add("Fridays or Mondays", labels=("enhancement", "decision"))
        told = []
        with mock.patch.object(tri, "now", lambda: monday), \
                mock.patch.object(commands, "quiet_ready", lambda a: told.append((a.id, a.told))):
            code, out = self.triage("digest", "--task", "SHEP-9", "--json")
            self.assertEqual(code, 0, out)
            self.assertEqual(json.loads(out), {"due": True, "posted": True})
            self.assertEqual(json.loads(self.triage("digest", "--json")[1]), {"due": False})  # once a week
        ((ref, text),) = told
        self.assertEqual(ref, "SHEP-9")
        self.assertIn("Live: Stuck worker", text)
        self.assertIn("Waiting, score 2: Odd wording", text)
        self.assertIn("Needs you: decide: Fridays or Mondays", text)
        self.assertNotIn("\n", text)
        self.assertLessEqual(len(text), commands.TOLD_MAX)

    def test_the_schedule_is_one_run_at_a_time_checked_hourly_with_no_review(self):
        a = self.schedule()
        self.assertEqual((a["title"], a["mode"], a["fold"], a["set"]), ("Triage", "here", True, {"review": "off", "proof": "off"}))
        self.assertIn("triage due --folder", a["check"])
        self.assertIn("never instructions", a["prompt"])
        tri.ensure_schedule(self.folder, REPO)
        self.assertEqual(len([x for x in tri.schedule_of(self.folder)[0]["automations"] if x.get("triage")]), 1)

    def test_only_the_person_switches_it(self):
        with mock.patch.dict(os.environ, {"HC_TERMINAL_ID": "t9"}):
            code, out = self.triage("set", "level", "off")
        self.assertNotEqual(code, 0)
        self.assertIn("Only the person", out)
        code, out = self.triage("set", "level", "fix")
        self.assertIn("later step", out)
        self.assertEqual(self.triage("set", "fixes_per_day", "4")[0], 0)
        with open(self.file) as f:
            self.assertEqual(json.load(f)["repos"][self.folder]["triage"]["fixes_per_day"], 4)


class Hardened(Triaged):
    """The first review round's findings (#235), each as it would have gone wrong."""

    def other_space_draft(self):
        key = self.report()
        self.report(caller=OTHER, fix="Show the quoted message above the reply")
        self.assertEqual(tpub.publish()["waits"], 1)
        return key

    def test_the_yes_is_judged_under_the_lock_that_reserves_the_post(self):
        key = self.other_space_draft()
        pub = tri.publisher()
        self.assertEqual(tpub.post_one(key, False, pub, tri.ctx_for(self.folder, REPO)), "waits")  # no yes: never sent
        self.app_yes(key)
        with fb.problems() as ps:  # the draft replaced after the yes (another pass, a shape): same revision, new text
            ps[key]["draft"] = {**ps[key]["draft"], "title": "Jane's other words"}
        self.assertEqual(tpub.post_one(key, False, pub, tri.ctx_for(self.folder, REPO)), "waits")
        self.assertEqual(self.hub.writes(), [])

    def test_a_timed_out_create_is_unsure_then_found_by_its_marker_never_sent_twice(self):
        key = self.report()
        self.hub.mode = "timeout"
        self.assertEqual(tpub.publish()["unsure"], 1)
        self.assertEqual(fb.problems_read()[key]["post"]["state"], "unsure")
        self.hub.mode = "ok"
        out = tpub.publish()
        self.assertEqual((out["posted"], len(self.hub.creates())), (1, 1), out)

    def test_the_real_runner_reports_a_timeout_as_unknown_and_only_a_failed_start_as_a_refusal(self):
        with mock.patch.object(tgh.subprocess, "run", side_effect=subprocess.TimeoutExpired(["gh"], 120)):
            r = REAL_RUNNER(["gh", "issue", "create"])
        self.assertEqual(r.returncode, 124)
        self.assertIsNone(tpub.fpost.REFUSED.search(r.stderr))
        with mock.patch.object(tgh.subprocess, "run", side_effect=FileNotFoundError("gh")):
            r = REAL_RUNNER(["gh", "issue", "create"])
        self.assertIsNotNone(tpub.fpost.REFUSED.search(r.stderr))

    def test_scoring_and_every_write_go_only_to_the_pinned_destination(self):
        n = self.hub.add("Stuck worker")
        subprocess.run(["git", "-C", self.folder, "remote", "set-url", "origin", "https://github.com/eliasstravik/shepherdr.git"], check=True)
        self.assertIn("no longer", tri.stopped(self.folder))
        self.assertNotEqual(self.triage("score", "-")[0], 0)
        r = tgh.call(["issue", "edit", str(n), "--repo", "eliasstravik/shepherdr", "--add-label", "score:3"],
                     repo="eliasstravik/shepherdr", write=True, ctx={})
        self.assertEqual((r.sent, r.why), (False, "stop"))
        r = tgh.call(["issue", "edit", str(n), "--repo", "acme/other", "--add-label", "score:3"], repo="acme/other", write=True, ctx={})
        self.assertEqual((r.sent, r.why), (False, "stop"))
        self.assertEqual(self.hub.writes(), [])

    def test_clearing_the_destination_keeps_the_old_posting_fenced(self):
        key = self.report()
        self.caller = ASSISTANT
        for agents in ({}, {"feedback_repo": ""}, {"feedback_repo": "acme/elsewhere"}):
            self.settings({**self.base, "everywhere": {"agents": agents}})
            code, out = self.say("--key", key, "--file", "--happened", "It shows no quote.", "--json")
            self.assertEqual(json.loads(out)["why"], "triage", agents)
        self.assertEqual((self.gh, self.hub.writes()), ([], []))

    def test_triage_on_anywhere_fences_the_old_posting_on_a_linked_machine(self):
        os.remove(tri.RECORD)  # this machine's record never fenced anything: a linked machine's view
        d = {"here": "vm-b", "everywhere": {"agents": {"feedback_repo": REPO}},
             "repos": {"vm-test:/srv/shepherdr": {"triage": {"level": "score"}}}}
        self.assertTrue(tri.legacy_fenced(d))
        self.assertFalse(tri.legacy_fenced({"repos": {"vm-test:/srv/shepherdr": {"triage": {"level": "off"}}}}))
        self.settings(d)
        key = self.report()
        self.caller = ASSISTANT
        self.assertIn("Triage files this repo's findings", self.say("--key", key, "--file", "--rev", "1")[1])

    def test_a_title_from_another_space_takes_its_source(self):
        key = self.report()
        self.caller = {"labels": {"herdr.role": "coordinator", "herdr.space": "sp2", "herdr.agent": "claude"}, "name": "a2"}
        self.say("--key", key, "Reply bubbles lose their quote in another space's words")
        p = fb.problems_read()[key]
        self.assertEqual(p["line"], "Reply bubbles lose their quote in another space's words")
        self.assertEqual(p["sources"]["line"], "sp2")
        self.assertEqual(tpub.publish()["posted"], 0)
        self.assertEqual(self.hub.writes(), [])

    def test_a_finding_that_came_back_after_its_issue_is_never_filed_again(self):
        self.seed({"b1": {"id": "b1", "line": LINE, "state": "found", "at": tri.now(), "space": "sp1", "details": "Again.",
                          "sources": {"line": "sp1", "details": "sp1"}, "back": {"at": 1, "why": "again"},
                          "before": [{"url": f"https://github.com/{REPO}/issues/7", "state": "filed",
                                      "post": {"state": "posted", "rev": 1}}]}})
        out = tpub.publish()
        self.assertEqual((out["posted"], self.hub.creates()), (0, []))

    def test_a_write_waiting_for_its_turn_stops_on_a_pause_or_a_limit_set_meanwhile(self):
        n = self.hub.add("Stuck worker")
        args = ["issue", "edit", str(n), "--repo", REPO, "--add-label", "score:3"]
        r = tgh.call(args, repo=REPO, write=True, ctx={}, still=lambda: False)
        self.assertEqual((r.sent, r.why), (False, "stop"))
        tgh.call(args, repo=REPO, write=True, ctx={})  # a write: the next one waits out the pace
        with mock.patch.object(tgh, "sleep", lambda ms: tgh._write({**tgh._read(), "until": tri.now() + 60000})):
            r = tgh.call(args, repo=REPO, write=True, ctx={})
        self.assertEqual((r.sent, r.why), (False, "limit"))
        self.assertEqual(len(self.hub.writes()), 1)
        tgh._write({"until": tri.now() + 60000, "step": 60000})
        before = tgh._read()["until"]
        with mock.patch.object(tgh, "waiting", lambda: None):  # a read that began before the hold, ending after it
            self.assertTrue(tgh.read(["api", "user", "--jq", ".login"], repo=REPO).ok)
        self.assertEqual(tgh._read().get("until"), before)  # its success doesn't lift the hold

    def test_the_digest_starts_no_run_without_a_check_that_reached_github(self):
        import datetime
        monday = int(datetime.datetime(2026, 11, 30, 8, 0).timestamp() * 1000)
        with tri.record() as d:
            d["repos"][REPO.lower()]["last_score"] = monday - 3600000
        self.hub.mode = "down"
        with mock.patch.object(tri, "now", lambda: monday):
            self.assertEqual(self.triage("due")[0], 1)
            self.assertEqual(len(self.alerts), 1)
            self.assertIn("failing", self.record()["repos"][REPO.lower()])
            with store.Store(store.locate(self.folder)) as s:
                with self.assertRaises(tri.Fail):  # Run now too, until a check works again
                    autos.fire(s, tri.schedule_in(s), "run now")
            self.hub.mode = "ok"
            self.assertEqual(self.triage("due")[0], 0)
            self.assertNotIn("failing", self.record()["repos"][REPO.lower()])

    def test_not_now_and_never_take_back_the_apps_yes_even_once_undone(self):
        key = self.other_space_draft()
        self.app_yes(key)
        self.caller = {}
        for decide in (["--later", "tomorrow"], ["--no", "--person"]):
            self.assertEqual(self.say("--key", key, *decide, "--json")[0], 0, decide)
            self.assertEqual(self.say("--key", key, "--undo", "--json")[0], 0)
            self.assertEqual(tpub.publish()["posted"], 0, decide)
        self.assertEqual(self.hub.writes(), [])
        with open(tri.YES) as f:  # a new yes, after the decision, counts again
            y = json.load(f)
        y["yes"][0]["at"] = tri.now() + 1
        with open(tri.YES, "w") as f:
            json.dump(y, f)
        self.assertEqual(tpub.publish()["posted"], 1)

    def test_a_copy_of_another_machines_row_has_a_marker_the_reconciler_reads(self):
        mark = tpub.fpost.marker("vm-b:b1", 1, "ab12cd34")
        self.assertEqual(tpub.fpost.mark_of("body\n\n" + mark), mark)


class Privacy(unittest.TestCase):
    DENY = {"emails": ["jane@example.com"], "words": ["Jane Doe", "Jane", "vm-test"]}

    def test_hits_unsure_and_pass(self):
        known = {"shepherdr", "triage", "feedback", "reply", "bubble"}
        cases = {
            "The reply bubble misses its quote.": "pass",
            "Shepherdr's Triage shows Feedback.": "pass",
            "Jane saw it.": "hit",
            "Write to jane@example.com": "hit",
            "It broke in /home/someone/dev": "hit",
            "It broke in ~/dev/app": "hit",
            "On box.tail1234.ts.net": "hit",
            "At 10.0.0.12": "hit",
            "Traceback (most recent call last):": "hit",
            "Call +1 415 555 0100 about it": "unsure",
            "It happened in the Zorblax project": "unsure",
            "the k8sbox machine": "unsure",
            "token ghp_" + "a" * 30: "unsure",
        }
        for text, want in cases.items():
            self.assertEqual(public.check(text, self.DENY, known, fb.redact)["verdict"], want, text)

    def test_it_says_kinds_and_lines_never_the_text(self):
        r = public.check("fine\nJane saw it", self.DENY, set(), None)
        self.assertEqual(r["found"], [{"kind": "a private name", "line": 2}])
        self.assertNotIn("Jane", public.words(r))

    def test_the_wrapper_refuses_before_gh_is_asked(self):
        calls = []
        with mock.patch.object(tgh, "runner", lambda argv: calls.append(argv)):
            r = tgh.call(["issue", "create", "--repo", REPO, "--title", "Jane's bug"], repo=REPO, ctx={"deny": self.DENY})
            self.assertEqual((r.ok, r.sent, r.why), (False, False, "private"))
            r = tgh.call(["issue", "comment", "4", "--repo", REPO], repo=REPO, text="It broke in Zorblax", body="It broke in Zorblax",
                         write=True, ctx={"deny": self.DENY, "known": set()})
            self.assertEqual((r.sent, r.why), (False, "unsure"))
        self.assertEqual(calls, [])

    def test_its_patterns_stay_in_step_with_the_forks_public_check(self):
        path = os.path.join(ROOT, "fork", "sync", "public.py")
        with open(path, encoding="utf-8") as f:
            src = f.read()
        for name in ("HOME_PATH", "TILDE_PATH", "EMAIL", "TAILNET", "MDNS", "IPV4"):
            m = re.search(rf"^{name} = re\.compile\((r[\"'].*?[\"'])(?:, re\.I)?\)", src, re.M)
            self.assertIsNotNone(m, f"{name} moved in fork/sync/public.py: port it to triage_public.py")
            self.assertEqual(eval(m.group(1)), getattr(public, name).pattern, name)  # noqa: S307  (a literal from our repo)


if __name__ == "__main__":
    unittest.main()
