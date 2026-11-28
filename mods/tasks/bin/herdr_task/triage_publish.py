"""Triage's publisher (dmalis/shepherdr#235, fork/specs/issue-loop.md, "2. File"): a script, not an agent. The serving
machine's service runs `herdr-task triage publish` at most every 10 minutes while something waits. Once Triage is on for
a repo, it is that repo's only publisher.

- **What it posts:** the finding's line as the title, its report's words (goal, what happened, expected), its suggested
  fix and the Shepherdr version. Never a log, space, machine, task title or key, or anything from settings. Labels:
  `needs-triage` and the kind (`bug` for bug, confusing, workaround and miss; `enhancement` for manual).
- **When it posts by itself:** only when every field of the draft (title, details, fix) came from reports made in the
  repo's space (`sources`, kept per field by feedback.py), and the privacy check passes. A field from another space, or
  whose source isn't known (an older record), makes the draft wait for the app's yes on its exact text (the service's
  `.triage-yes.json`: the Feedback page's Post it today; no command writes it).
- **Posting once:** the friction loop's posting reused (feedback_post.py): the stored draft and its hidden marker,
  `posting`, then `posted`, `refused` or `unsure`, reconciled from the repo's own issues by the marker. A posted create
  leaves a receipt `{repo, number, rev, marker, at}` on its finding and in Triage's record.
- **The destination fails closed** (triage.destination): read again with the level, under the record's lock, right
  before each write.
- **One publisher machine:** other machines' findings come in as the service read them (`--there`), copied into
  Triage's record keyed by machine and id; the other machine's own row is never written. A copy always waits for the
  app's yes. One with the same words as a finding here joins it, counted privately.

Every GitHub call goes through triage_gh.call."""

import json
import re

from . import feedback as fbm
from . import feedback_post as fpost
from . import triage as tri
from . import triage_gh as tgh
from .base import Fail, now
from .settings import bare, read_settings

KIND_LABEL = {"bug": "bug", "confusing": "bug", "workaround": "bug", "miss": "bug", "manual": "enhancement"}
DONE_DECISIONS = ("declined", "following")


def kind_label(p):
    return KIND_LABEL.get(p.get("kind") or "bug", "bug")


def compose(p):
    """Triage's draft for a finding: {target, title, body, by: "triage", labels}, redacted (the marker comes when kept)."""
    title = fbm.redact(fbm.one_line(p.get("line") or "", fpost.TITLE_MAX))
    parts = []
    details = fbm.trim(p.get("details"))
    parts.append("## What happened\n\n" + (details or "_Not known._"))
    if p.get("fix"):
        parts.append("## Suggested fix\n\n" + fbm.trim(p["fix"]))
    parts.append(f"## Shepherdr\n\n{fbm.shepherdr_version()}")
    parts.append("_Filed by Triage from a Shepherdr agent's report._")
    return {"title": title, "body": fbm.redact("\n\n".join(parts)), "labels": ["needs-triage", kind_label(p)]}


def fields_of(p):
    """The draft's fields that hold words: the title (line) always, the details and the fix when there are some."""
    return ["line"] + [f for f in ("details", "fix") if p.get(f)]


def own_space(p, space):
    """Every field of the draft came from reports made in the repo's space (its source kept and known)."""
    src = p.get("sources") if isinstance(p.get("sources"), dict) else {}
    if not space or "/" in str(space):
        return False
    return all(src.get(f) and "/" not in str(src[f]) and bare(src[f]) == bare(space) for f in fields_of(p))


def filed_before(p):
    """The finding already has an issue: a receipt, or an earlier round that was posted, followed or filed."""
    if p.get("receipt"):
        return True
    rounds = p.get("before") if isinstance(p.get("before"), list) else [p.get("before")]
    return any(isinstance(x, dict) and (x.get("url") or (x.get("post") or {}).get("state") in ("posted", "posting", "unsure")
                                        or x.get("state") == "filed") for x in rounds)


def eligible(p):
    """A finding Triage may draft and post (its own state, not GitHub's): not filed, not in doubt, not Never, Follow or Not
    now, its origin's Feedback offers on."""
    from .feedback_page import snoozed
    post = p.get("post") or {}
    if p.get("state") in ("filed", "declined") or post.get("state") in ("posted", "posting", "unsure"):
        return False
    if filed_before(p):  # it came back after a fix (feedback_ship.back): its issue exists, never a second create
        return False
    if p.get("decision") in DONE_DECISIONS or snoozed(p):
        return False
    if p.get("state") == "filing" and now() - (p.get("at") or 0) < fbm.FILING_MS:
        return False
    return bool(p.get("line")) and (p.get("_copy") or fbm.feedback_on(p.get("space")))


def keep_draft(ps, key, new, repo):
    """Stores Triage's draft for one row under the lock (the same text keeps its revision). A draft an Assistant wrote
    for this repo stays as it is (the person may have said yes to it); one for anywhere else is replaced. -> the draft"""
    p = ps[key]
    old = p.get("draft") if isinstance(p.get("draft"), dict) else None
    if old and old.get("by") != "triage" and str((old.get("target") or {}).get("repo") or "").lower() == repo.lower():
        return old
    want = {"target": {"repo": repo, "action": "create"}, "title": new["title"], "body": new["body"]}
    if old and old.get("by") == "triage" and fpost.same(old, want):
        return old
    dr = fpost.keep_draft(ps, key, want)
    ps[key]["draft"] = {**dr, "by": "triage", "labels": new["labels"]}
    return ps[key]["draft"]


# ---- the rows: this machine's findings, and the copies of other machines' ---------------------

class Copies:
    """Triage's copies of other machines' findings, as one dict under Triage's record's lock (feedback.problems()'s
    shape), so posting reads the same either way."""

    def __enter__(self):
        self._cm = tri.record()
        self._d = self._cm.__enter__()
        return self._d.setdefault("copies", {})

    def __exit__(self, *exc):
        return self._cm.__exit__(*exc)


def rows_lock(copy):
    return Copies() if copy else fbm.problems()


def copy_in(path):
    """Other machines' findings as the service read them ({machine: [rows]} in a file): each one not filed or decided
    there is copied in, keyed "<machine>:<id>"; its fields only, never the other machine's row. One with the same words
    as a finding here joins it (counted privately). -> how many copies changed"""
    try:
        with open(path) as f:
            there = json.load(f)
    except (OSError, ValueError):
        return 0
    if not isinstance(there, dict):
        return 0
    here = fbm.problems_read()
    ids_here = {fbm.id_of(p.get("line") or "") for p in here.values() if p.get("line")}
    changed = 0
    with Copies() as cs:
        for machine, rows in there.items():
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", str(machine)) or not isinstance(rows, list):
                continue
            for r in rows:
                if not isinstance(r, dict) or not r.get("line"):
                    continue
                key = f"{machine}:{r.get('id') or r.get('key')}"
                post = r.get("post") or {}
                gone = r.get("state") in ("filed", "declined") or post.get("state") in ("posted", "posting", "unsure") \
                    or r.get("decision") in DONE_DECISIONS
                c = cs.get(key) or {}
                if gone and not c:
                    continue
                joined = fbm.id_of(r["line"]) in ids_here
                fields = {"id": key, "machine": machine, "line": fbm.one_line(r["line"]), "details": r.get("details"),
                          "fix": r.get("fix"), "kind": r.get("kind"), "space": f"{machine}/{r.get('space') or ''}",
                          "count": r.get("count") or len(r.get("reports") or []) or 1, "_copy": True,
                          **({"joined": True} if joined else {}), **({"there_done": True} if gone else {})}
                new = {**c, **fields}
                if new != c:
                    cs[key] = new
                    changed += 1
    return changed


# ---- posting once ---------------------------------------------------------------------------

def post_args(dr):
    t = dr["target"]
    if t["action"] == "comment":
        return ["issue", "comment", str(t["issue"]), "--repo", t["repo"]]
    argv = ["issue", "create", "--repo", t["repo"], "--title", dr["title"]]
    for lab in dr.get("labels") or ["needs-triage", "bug"]:
        argv += ["--label", lab]
    return argv


def post_one(key, copy, pub, ctx):
    """Posts one row's stored draft once. -> "posted", "refused", "unsure", "waits" (didn't go out: no yes for this very
    text, the check or GitHub's limit), "pace" or "bulk-pace" (Triage's own cap, or the batch's ceiling, is full: it
    waits, and the other kind still goes) or "stop" (the level, the destination, the pause or GitHub's limit: nothing more this
    pass). Whether it may go (the app's yes for this exact draft, or every field from the repo's space and the
    privacy check) is decided under the same lock that reserves the post: a draft replaced meanwhile is judged as it is."""
    with rows_lock(copy) as ps:
        p = ps.get(key)
        d = read_settings()
        if tri.publisher(d) != pub:  # the level, destination and pause, read again under the record's lock
            return "stop"
        # a copy whose finding was decided on its own machine (declined, filed there) since its yes never posts here
        if not isinstance(p, dict) or not eligible(p) or p.get("there_done") or p.get("joined") or not isinstance(p.get("draft"), dict):
            return "waits"
        dr = p["draft"]
        if str(dr["target"].get("repo") or "").lower() != pub["repo"].lower():
            return "waits"
        yes = tri.yes_for(key, p, pub["repo"])
        # the person's No to this very text keeps it private: it never posts by itself either
        if not yes and (tri.yes_for(key, p, pub["repo"], "no") or not auto_ok(p, dr, pub, ctx)):
            return "waits"
        dr = {**dr, "body": fpost.fresh(key, dr["body"])}  # a draft from before mark_key: its marker names no machine
        # a yes from the backlog's batch card: never past the privacy check (the batch holds only drafts that pass it;
        # one that fails now waits for its own card), and paced by GitHub's limits instead of Triage's cap. A held
        # draft's own Yes in the backlog's review goes with the batch too, at its pace: its own Yes, so past the check
        src = tri.yes_from(key, p, pub["repo"]) if yes and dr["target"]["action"] == "create" else None
        batch = src == "batch"
        bulk = src in ("batch", "backlog")
        if batch:
            # the privacy inputs read again for each batch post (a word added to the deny list during the pass counts),
            # used for this check and for the wrapper's own check of the text right before gh
            ctx = tri.ctx_for(pub["folder"], pub["repo"])
            if privacy(p, dr, lambda t: _check(t, ctx)):
                return "waits"
        post = {"state": "posting", "rev": dr["rev"], "target": dr["target"], "started": now(),
                "mark": fpost.mark_of(dr["body"]) or fpost.marker(key, dr["rev"]), "by": "triage"}
        ps[key] = {**p, "draft": dr, "post": post}
    argv = post_args(dr)
    text = (dr["title"] + "\n" if dr["target"]["action"] == "create" else "") + fpost.shown(dr["body"])
    try:
        res = tgh.call(argv, repo=pub["repo"], text=text, body=dr["body"], write=True,
                       create=dr["target"]["action"] == "create", yes=yes and not batch, ctx=ctx,
                       still=lambda: tri.publisher() == pub, bulk=bulk)
    except Exception as e:  # noqa: BLE001  (anything else: nobody knows whether it went out)
        res = tgh.Result(False, err=f"{type(e).__name__}: {e}", sent=True, why="failed")
    if not res.sent:
        with rows_lock(copy) as ps:
            p = ps.get(key) or {}
            if (p.get("post") or {}).get("started") == post["started"]:
                ps[key] = {k: v for k, v in p.items() if k != "post"}
        # a cap full (Triage's own, or the batch's ceiling): this one waits, and the other kind still goes this pass
        if res.why == "pace":
            return "bulk-pace" if bulk else "pace"
        return "waits" if res.why in ("private", "hit", "unsure") else "stop"
    urls = re.findall(r"https://github\.com/\S+", res.out or "")
    if res.ok and urls:
        posted(key, copy, post, urls[-1])
        return "posted"
    said = fbm.one_line(res.err or res.out or "gh gave no answer", 300)
    state = "refused" if not urls and fpost.REFUSED.search(said) else "unsure"
    with rows_lock(copy) as ps:
        p = ps.get(key) or {}
        if (p.get("post") or {}).get("started") == post["started"]:
            ps[key] = {**p, "post": {**post, "state": state, "why": said}}
    return state


def number_of(url):
    m = re.search(r"/issues/(\d+)", url or "")
    return int(m.group(1)) if m else None


def posted(key, copy, post, url):
    """The post went out: filed, with its receipt (a create), on the finding and in Triage's record."""
    t = post["target"]
    issue = re.sub(r"[#?].*$", "", url if t["action"] == "create" else f"https://github.com/{t['repo']}/issues/{t['issue']}")
    n = number_of(issue)
    receipt = {"repo": t["repo"], "number": n, "rev": post["rev"], "marker": post["mark"], "at": now()}
    with rows_lock(copy) as ps:
        p = ps.get(key) or {}
        if (p.get("post") or {}).get("started") != post.get("started"):
            return
        ps[key] = {**{k: v for k, v in p.items() if k not in ("approval", "back")}, "state": "filed", "at": now(),
                   "url": url, "post": {**post, "state": "posted", "url": url}, "outcome": {"url": issue},
                   **({"receipt": receipt} if t["action"] == "create" and n else {})}
    if t["action"] == "create" and n:
        with tri.record() as d:
            tri.repo_rec(d, t["repo"]).setdefault("receipts", {})[str(n)] = {**receipt, "key": key}


def reconcile(key, copy, repo, ctx):
    """A post whose answer was lost, looked for by its marker on GitHub (the person's own issues since it began, or the
    issue's comments), every page, through the wrapper. -> "posted" or "unsure" (never posted again)"""
    with rows_lock(copy) as ps:
        p = ps.get(key) or {}
    post = p.get("post") or {}
    if post.get("state") == "posted":
        return "posted"
    if post.get("state") not in ("posting", "unsure") or post.get("state") == "posting" and not fpost.stale(post):
        return "skip"
    t, mark = post["target"], post.get("mark") or fpost.marker(key, post["rev"])
    since = fpost.iso((post.get("started") or 0) - fpost.SINCE_SLACK_MS)
    if t["action"] == "comment":
        r = tgh.read(["api", f"repos/{t['repo']}/issues/{t['issue']}/comments?since={since}&per_page=100", "--paginate"], repo=repo, ctx=ctx)
    else:
        who = tgh.read(["api", "user", "--jq", ".login"], repo=repo, ctx=ctx)
        login = (who.out or "").strip()
        if not who.ok or not re.fullmatch(r"[A-Za-z0-9-]+", login):
            return still_unsure(key, copy, post, "GitHub couldn't say who is signed in")
        r = tgh.read(["api", f"repos/{t['repo']}/issues?creator={login}&state=all&since={since}&per_page=100", "--paginate"], repo=repo, ctx=ctx)
    if not r.ok:
        return still_unsure(key, copy, post, fbm.one_line(r.err or r.why or "gh failed", 200))
    try:
        items = tgh.pages(r.out)
    except ValueError:
        return still_unsure(key, copy, post, "GitHub's answer couldn't be read")
    hit = next((x for x in items if isinstance(x, dict) and fpost.same_mark(fpost.mark_of(x.get("body")), mark, key) and x.get("html_url")), None)
    if hit:
        posted(key, copy, post, str(hit["html_url"]))
        return "posted"
    return still_unsure(key, copy, post, "not found on GitHub")


def still_unsure(key, copy, post, why):
    with rows_lock(copy) as ps:
        p = ps.get(key) or {}
        cur = p.get("post") or {}
        if cur.get("started") == post.get("started") and cur.get("state") in ("posting", "unsure"):
            ps[key] = {**p, "post": {**cur, "state": "unsure", "why": why, "looked": now()}}
    return "unsure"


def reconcile_all(repo, folder):
    """Turn-on step 3: every post in flight to this repo (posting or unsure, Triage's or the old posting's), reconciled
    by its marker. -> {"posted": n, "unsure": n}"""
    out = {"posted": 0, "unsure": 0}
    rows = [(k, False) for k, p in fbm.problems_read().items()
            if str(((p.get("post") or {}).get("target") or {}).get("repo") or "").lower() == repo.lower()
            and (p.get("post") or {}).get("state") in ("posting", "unsure")]
    if not rows:
        return out
    ctx = tri.ctx_for(folder, repo)
    for key, copy in rows:
        r = reconcile(key, copy, repo, ctx)
        if r in out:
            out[r] += 1
    return out


# ---- the pass -------------------------------------------------------------------------------

def _check(text, ctx):
    from . import triage_public as public
    return public.check(text, ctx.get("deny"), ctx.get("known"), ctx.get("redact"))


def privacy(p, dr, check):
    """What the privacy check found in a draft and in the finding's own words before redaction (what redaction changed
    was private: the person decides): [] when both pass, else the kinds with their line, never the text."""
    raw = "\n".join(str(p.get(f) or "") for f in ("line", "details", "fix"))
    found = []
    for text in (dr["title"] + "\n" + fpost.shown(dr["body"]), raw):
        c = check(text)
        if c["verdict"] != "pass":
            found += [f"{x['kind']}, line {x['line']}" for x in c.get("found") or []] or [c["verdict"]]
    return list(dict.fromkeys(found))[:6]


def auto_ok(p, dr, pub, ctx):
    """It posts by itself: Triage's own draft, every field from the repo's space, and the privacy check passes, on the
    draft and on the finding's own words."""
    if dr.get("by") != "triage" or p.get("_copy") or not own_space(p, pub["space"]):
        return False
    return not privacy(p, dr, lambda t: _check(t, ctx))


def held_why(p, dr, copy, pub, check):
    """Why a draft waits for the app's yes, as the card says it: {why: machine | written | unknown | space | private,
    found?: [the kinds the privacy check found, with their line, never the text]}. check(text) -> the check's answer."""
    if copy or p.get("_copy"):
        return {"why": "machine"}
    if dr.get("by") != "triage":
        return {"why": "written"}
    src = p.get("sources") if isinstance(p.get("sources"), dict) else {}
    if not pub or not own_space(p, pub["space"]):
        return {"why": "unknown" if any(not src.get(f) for f in fields_of(p)) else "space"}
    return {"why": "private", "found": privacy(p, dr, check)}


def waiting_rows():
    """Findings with a Triage draft that wait for the person's yes in the app: [{key, copy, rev, hash, title, body,
    target, at, why, found?, kind, label, batch}] (the service's cards read this, and the digest counts it). One the
    person said No to, for its exact text, no longer waits: it stays private until its text changes.

    `batch`: the draft may go in the backlog's one batch yes (a new issue whose words and the finding's own pass the
    privacy check); one that doesn't keeps its own card, with what the check found (`found`)."""
    from . import triage_public as public
    pub = tri.publisher()
    out = []
    ctx = []  # read once, only when an own-space draft needs its check

    def context():
        if not ctx:
            ctx.append(tri.ctx_for(pub["folder"], pub["repo"]))
        return ctx[0]

    def posts_by_itself(p, dr):
        return auto_ok(p, dr, pub, context())

    def check(text):
        c = context()
        return public.check(text, c.get("deny"), c.get("known"), c.get("redact"))
    for copy, rows in ((False, fbm.problems_read()), (True, (tri.record_read().get("copies") or {}))):
        for key, p in rows.items():
            if not isinstance(p, dict) or not eligible(p) or p.get("joined") or p.get("there_done"):
                continue  # a copy whose finding is done on its own machine asks nothing any more
            dr = p.get("draft") if isinstance(p.get("draft"), dict) else None
            if not dr or (pub and str(dr["target"].get("repo") or "").lower() != pub["repo"].lower()):
                continue
            if pub and tri.yes_for(key, p, pub["repo"], "no"):
                continue  # No to this very text keeps it private
            # Yes to this very text waits only for the publisher's pace; a batch's yes never goes past the privacy
            # check, so one that fails it now (a new word on the deny list) asks again on its own card
            if pub and tri.yes_for(key, p, pub["repo"]) and not (
                    tri.yes_for(key, p, pub["repo"], batch=True) and privacy(p, dr, check)):
                continue
            if dr.get("by") == "triage" and not copy and pub and own_space(p, pub["space"]) and posts_by_itself(p, dr):
                continue  # posts by itself: not waiting (one its privacy check holds back waits for the yes)
            body = fpost.shown(dr["body"])
            held = held_why(p, dr, copy, pub, check)
            found = held.get("found") if held["why"] == "private" else (privacy(p, dr, check) if pub else ["unsure"])
            out.append({"key": key, "copy": copy, "rev": dr["rev"], "title": dr["title"], "body": body,
                        "target": dr["target"], "hash": tri.yes_hash(dr["target"], dr["title"], body),
                        "at": int(dr.get("at") or p.get("at") or 0), **held,
                        **({"found": found} if found else {}), "kind": p.get("kind") or None, "label": kind_label(p),
                        "batch": not found and dr["target"].get("action") == "create"})
    return out


def publish(there=None, for_s=None):
    """One publisher pass: other machines' findings copied in, then each waiting finding drafted and, when it may be,
    posted once, at the pace. for_s: the pass's time (seconds): once it is up, nothing more starts and `more` says the
    rest waits for the next pass (the service runs it soon), so a batch of a hundred never outlives its caller.
    -> {posted, waits, unsure, refused, why?, more?}"""
    out = {"posted": 0, "waits": 0, "unsure": 0, "refused": 0}
    until = now() + int(for_s * 1000) if for_s else None
    pub = tri.publisher()
    if not pub:
        return {**out, "why": "Triage files no repo's findings here now (off, paused, not this repo, or no destination)."}
    if there:
        out["copied"] = copy_in(there)
    ctx = tri.ctx_for(pub["folder"], pub["repo"])
    for copy in (False, True):
        with rows_lock(copy) as ps:
            todo = []
            for key, p in ps.items():
                if not isinstance(p, dict):
                    continue
                if (p.get("post") or {}).get("state") in ("unsure",) or fpost.stale(p.get("post") or {}):
                    todo.append((key, "reconcile"))
                    continue
                if not eligible(p) or p.get("joined") or p.get("there_done"):  # decided on its own machine: no draft, no post
                    continue
                dr = keep_draft(ps, key, compose(p), pub["repo"])
                todo.append((key, "post"))
        for key, what in todo:
            if until and now() >= until:
                out["more"] = True
                return out
            if what == "reconcile":
                r = reconcile(key, copy, pub["repo"], ctx)
                out["posted" if r == "posted" else "unsure"] += r in ("posted", "unsure")
                continue
            r = post_one(key, copy, pub, ctx)
            if r == "stop":
                out["why"] = "Stopped: the level, the destination, the pause or GitHub's limit changed."
                return out
            if r == "pace":  # Triage's own cap: the rest of the everyday posts wait for the next hour, the batch's go on
                out.setdefault("why", "Triage's pace: at most 10 new issues an hour and 30 a day per repo; the rest wait.")
            if r == "bulk-pace":  # the batch's ceiling: its rest waits, everyday posts still go
                out.setdefault("why", f"The batch's pace: at most {tgh.BULK_HOUR} new issues an hour; the rest wait.")
            out[r if r in out else "waits"] += 1
    return out
