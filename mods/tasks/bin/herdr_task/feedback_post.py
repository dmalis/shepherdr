"""The yes for the exact text, posted once (friction loop, slice 4, #94: fork/specs/friction-loop.md).

- A draft is the exact post: `{rev, target: {repo, action: "create" or "comment", issue?}, title, body}`, redacted, its
  body ending with a hidden marker `<!-- shepherdr-feedback <id> rev <N> <tag> -->` (tag: random, one per revision). An Assistant writes it with `--file`
  (no `--rev`: nothing is posted; the answer shows the draft and the next step) or with `--shape` and the draft's
  fields. Any change to its title, body or target makes a new revision. The target always names its whole repo.
- The person's yes is for one revision: `--approve <rev>` from the Feedback page's Post it (the service's call, refused
  in an agent's terminal), or `--approve <rev> --by chat` by an Assistant right after the person's yes to a card that
  showed that revision. Not now and Never clear it (feedback_page.change, and the chat's `--no`).
- `--file --rev N` (an Assistant) posts the stored draft as it is, only with an approval for that revision and target,
  the decision not Not now or Never, the origin's Feedback offers on and the feedback repo still the target's (settings
  read again under the lock). Before the request `post.state` is `posting`, saved; then `posted`; `refused` only for a
  refusal gh reports before any write (not signed in, no such repo or issue, no permission, issues off: the same
  approval may post it again); anything else, a bare HTTP error too, is `unsure`, and an unsure post is never posted
  again, by anyone.
- `--reconcile` (the page's Check again; `--file` on an unsure one): reads GitHub directly, never its search: the
  person's own issues in the target repo since the attempt began, or the target issue's comments since then, every
  page, for the marker. Found: posted. Not found: still unsure. Reads only.

The record's fields are the spec's: `draft`, `approval`, `post`, and `decision: "approved"`."""

import json
import os
import re
import secrets
import subprocess
import tempfile
import time

from . import feedback as fbm
from .base import Fail, now
from .feedback import FIELDS, FILING_MS, feedback_on, feedback_repo, one_line, problems, problems_read, repo_of

TITLE_MAX = 120
SINCE_SLACK_MS = 5 * 60000   # a reconcile reads from a little before the attempt began: GitHub's clock and ours differ
MARK = re.compile(r"\n*<!-- shepherdr-feedback [0-9A-Za-z_-]+ rev \d+(?: [0-9a-f]{8,32})? -->\s*$")
# A refusal gh reports before anything is written: not signed in (gh checks before asking), bad credentials, no such
# repo or issue (looked up before the write), no permission or issues off (the write itself turned down). A bare HTTP
# error is not one: nothing says when it came, so it is unsure.
REFUSED = re.compile(r"(?i)\bHTTP 401\b|gh auth login|not logged in|authentication (?:required|failed)|bad credentials|"
                     r"could not resolve to a (?:repository|issue)|resource not accessible|must have (?:push|admin|write)|"
                     r"does not have the correct permissions|issues are disabled|has disabled issues|gh can't start")


def marker(key, rev, tag=None):
    """The hidden line every post ends with: how a post whose answer was lost is found again, never posted twice. Its
    tag, random per revision, keeps two stores' posts with one id and revision apart."""
    return f"<!-- shepherdr-feedback {key} rev {rev}{' ' + tag if tag else ''} -->"


def mark_of(body):
    """The marker a stored draft's body ends with (None when it has none)."""
    m = MARK.search(str(body or ""))
    return m.group(0).strip() if m else None


def shown(body):
    """A draft's body as the person reads it: without its hidden marker (GitHub doesn't show it either)."""
    return MARK.sub("", str(body or "")).rstrip()


def note(d=None):
    """Settings › Everywhere's agents.feedback_note: one line every draft's words end with (and the page's sheet shows
    above Post it), empty by default."""
    d = fbm.read_settings() if d is None else d
    a = (d.get("everywhere") or {}).get("agents") if isinstance(d.get("everywhere"), dict) else None
    v = a.get("feedback_note") if isinstance(a, dict) else None
    return one_line(v, 200) if isinstance(v, str) and v.strip() else ""


# ---- where it goes --------------------------------------------------------------------------

def target_of(comment, d=None):
    """A draft's whole target: a new issue in the feedback repo, or a comment on one of its issues (`N` or
    `owner/name#N`). Comments go only where problems are filed: Shepherdr's own issue, when filing elsewhere, is
    followed from the Feedback page, never written on."""
    repo = feedback_repo(d)
    if comment in (None, ""):
        return {"repo": repo, "action": "create"}
    m = re.fullmatch(r"(?:(.+?)#)?#?(\d+)", str(comment).strip())
    if not m or int(m.group(2)) <= 0:
        raise Fail("--comment takes an issue: its number, or owner/name#number.")
    if m.group(1) and (repo_of(m.group(1)) or "").lower() != repo.lower():
        raise Fail(f"A comment goes only to {repo}, where feedback is filed: an issue elsewhere can be followed from the "
                   "Feedback page, never written on.")
    return {"repo": repo, "action": "comment", "issue": int(m.group(2))}


def where_words(t, title=None):
    """Where a draft goes, in the person's words: "A new issue in owner/name", "A comment on “…” in owner/name"."""
    if t.get("action") == "comment":
        on = f"“{title}” (#{t.get('issue')})" if title else "issue #" + str(t.get("issue"))
        return f"A comment on {on} in {t['repo']}"
    return f"A new issue in {t['repo']}"


def issue_title(p, t):
    """The title of the issue a comment goes on, when its check found it."""
    c = p.get("checked") or {}
    for m in [*(c.get("dupes") or []), *(c.get("upstream") or [])]:
        for x in (m, m.get("canonical") or {}):
            if isinstance(x, dict) and str(x.get("repo") or "").lower() == t["repo"].lower() and x.get("number") == t.get("issue"):
                return x.get("title")
    return None


# ---- the draft ------------------------------------------------------------------------------

DRAFT_FIELDS = ("title", "goal", "happened", "tried", "expected", "repro", "comment")


def wants_draft(args):
    """--shape with any of the draft's own fields writes a draft too."""
    return any(getattr(args, f, None) not in (None, "") for f in DRAFT_FIELDS)


def compose(p, key, line, args, d, agent):
    """The draft these arguments make, redacted, without its revision yet: {target, title, body}. The body is upstream's
    issue body (feedback.issue_body); a problem's details and fix fill what the arguments leave out."""
    fields = {f: getattr(args, f, None) for f, _ in FIELDS}
    if not fields.get("happened") and p.get("details"):
        fields["happened"] = p["details"]
    env = fbm.environment(p.get("agent") or agent, getattr(args, "surface", None))
    return {"target": target_of(getattr(args, "comment", None), d),
            "title": fbm.redact(one_line(getattr(args, "title", None) or line, TITLE_MAX)),
            "body": fbm.issue_body(line, fields, env)}


def same(a, b):
    return bool(a) and bool(b) and a.get("target") == b.get("target") and a.get("title") == b.get("title") \
        and shown(a.get("body")) == shown(b.get("body"))


def cleared(p):
    """A problem without the person's yes: Not now, Never or a new draft took it back. A post that never went out
    (waiting, or refused before any write) goes with it; one that may have (posting, unsure) stays, as what happened."""
    out = {k: v for k, v in p.items() if k != "approval"}
    if (out.get("post") or {}).get("state") in ("waiting", "refused"):
        out.pop("post")
    if out.get("decision") == "approved":
        out.pop("decision")
    if isinstance(out.get("was"), dict) and out["was"].get("decision") == "approved":
        out["was"] = {**out["was"], "decision": None}
    return out


def next_rev(p, old):
    """The next draft revision: after the current draft's, and after every earlier round's (a problem that came back,
    feedback_ship.last_rev), so an old yes never matches a new round's text."""
    from .feedback_ship import last_rev
    return max(int((old or {}).get("rev") or 0), last_rev(p)) + 1


def keep_draft(ps, key, new):
    """Stores a draft (under the lock): the same text and target keep their revision (and any yes for it); anything
    changed is a new revision, and the yes for the old one no longer counts. Returns the stored draft."""
    p = ps[key]
    old = p.get("draft") if isinstance(p.get("draft"), dict) else None
    if same(old, new):
        return old
    rev = next_rev(p, old)
    dr = {"rev": rev, "target": new["target"], "title": new["title"],
          "body": shown(new["body"]) + "\n\n" + marker(key, rev, secrets.token_hex(8))}
    ps[key] = {**cleared(p), "draft": dr}
    return dr


def draft_words(key, dr, p, d, dups=(), kept=True):
    """The draft as the Assistant shows it to the person, then the next step; last, the Settings line when one is set
    (agents.feedback_note), so the chat says what the page's sheet says before the yes."""
    rev = dr["rev"]
    head = [f"Draft {rev} — {where_words(dr['target'], issue_title(p, dr['target']))} (nothing posted):"]
    if dr["target"]["action"] == "create":
        head += ["", f"Title: {dr['title']}"]
    lines = []
    if dups:
        lines += ["", "Possible duplicates: " + "; ".join(f"{x['repo'] if x.get('repo') else ''}#{x['number']} {x['title']}" for x in dups) +
                  " (a comment on one instead: --file --comment <number>)"]
    if kept:
        lines += ["", f"Show the person this draft with where it goes, in your question card's words, and ask. Only right after "
                      f"their yes to that card: herdr-task feedback --key {key} --approve {rev} --by chat, then herdr-task "
                      f"feedback --key {key} --file --rev {rev}. They can also post it from the Feedback page (File it…). "
                      f"No: --no."]
    else:
        lines += ["", "Not kept (--dry-run): leave out --dry-run to keep it as a draft."]
    n = note(d)
    if n:
        lines += ["", n]
    tail = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return "\n".join(head) + "\n\n" + shown(dr["body"]) + ("\n\n" + tail if tail else "")


def write_draft(args, key, line, d, agent, dups=()):
    """--file without --rev (and --shape with the draft's fields): keeps the draft, posts nothing. -> (data, words)"""
    with problems() as ps:
        p = ps.get(key)
        if not isinstance(p, dict):
            raise Fail("No problem with that key is kept here.")
        why = cant_draft(p, d, key)
        if why:
            return why
        new = compose(p, key, line or p.get("line") or "", args, d, agent)
        if getattr(args, "dry_run", False):
            old = p.get("draft") if isinstance(p.get("draft"), dict) else None
            rev = old["rev"] if same(old, new) else next_rev(p, old)
            dr = {**new, "rev": rev, "body": shown(new["body"]) + "\n\n" + marker(key, rev)}
            return {"key": key, "kept": False, "draft": dr, "duplicates": list(dups)}, draft_words(key, dr, p, d, dups, kept=False)
        dr = keep_draft(ps, key, new)
        p = ps[key]
    return ({"key": key, "kept": True, "draft": dr, "where": where_words(dr["target"], issue_title(p, dr["target"])),
             "note": note(d), "duplicates": list(dups)}, draft_words(key, dr, p, d, dups))


def cant_draft(p, d, key=None):
    """Why no draft is written for this problem now, as (data, words); None when one may be."""
    key = key or p.get("id")
    post = p.get("post") or {}
    if p.get("decision") == "following":
        return {"key": key, "kept": False, "why": "following"}, "The person follows an issue for this one: nothing to write. Carry on."
    if p.get("state") == "filed" or post.get("state") == "posted":
        return {"key": key, "kept": False, "why": "filed", "url": p.get("url")}, f"Already filed: {p.get('url')}. Nothing posted again."
    if post.get("state") in ("posting", "unsure"):
        return {"key": key, "kept": False, "why": "unsure"}, ("It may have been posted already, so it's never posted again: "
                                                            f"herdr-task feedback --key {key} --reconcile looks for it on GitHub.")
    if p.get("state") == "filing" and now() - (p.get("at") or 0) < FILING_MS:  # an older version's filing, under way
        return {"key": key, "kept": False, "why": "filing"}, "It's being filed right now: nothing filed again."
    if p.get("decision") == "declined":
        return {"key": key, "kept": False, "why": "declined"}, "The person said no to this one on the Feedback page: nothing to write."
    if not feedback_on(p.get("space"), d):
        return {"key": key, "kept": False, "why": "off"}, "Feedback offers are off in its space: nothing written, nothing posted."
    return None


# ---- the yes --------------------------------------------------------------------------------

def refusal(p, rev, d, approving=False):
    """Why this revision can't be approved (approving) or posted now, as (why, words); None when it can."""
    post = p.get("post") or {}
    dr = p.get("draft") if isinstance(p.get("draft"), dict) else None
    if p.get("decision") == "following":
        return "following", "The person follows an issue for this one: nothing posted."
    if p.get("state") == "filed" or post.get("state") == "posted":
        return "filed", f"Already filed: {p.get('url') or post.get('url')}. Nothing posted again."
    if post.get("state") == "unsure" or post.get("state") == "posting" and stale(post):
        return "unsure", "Couldn't tell whether it was posted, so it's never posted again: Check again looks for it on GitHub."
    if post.get("state") == "posting":
        return "posting", "It's being posted right now: nothing posted again."
    if p.get("state") == "declined" or p.get("decision") == "declined":
        return "declined", "The person said no to this one: nothing posted."
    from .feedback_page import snoozed
    if snoozed(p):
        return "later", "The person said not now to this one: nothing posted."
    if not feedback_on(p.get("space"), d):
        return "off", "Feedback offers are off in its space: nothing posted."
    if not dr:
        return "no-draft", "There's no draft yet: write one first (--file, which posts nothing)."
    if dr.get("rev") != rev:
        return "changed", f"That draft changed since: the newest is draft {dr.get('rev')}, and a yes is for the text the person saw."
    if (dr.get("target") or {}).get("repo", "").lower() != feedback_repo(d).lower():
        return "target", (f"Feedback now goes to {feedback_repo(d)} (Settings), not {dr['target']['repo']}: write the draft again "
                          "(--file) and ask again.")
    if approving:
        return None
    a = p.get("approval") if isinstance(p.get("approval"), dict) else None
    if not a or a.get("rev") != rev or a.get("target") != dr.get("target"):
        return "no-yes", (f"The person hasn't said yes to draft {rev}: show it to them and ask, or they post it from the "
                          "Feedback page. Nothing posted.")
    return None


def approve(args, assistant, d=None):
    """The person's yes to one draft revision: from the page (the service), or an Assistant's record of a yes said in
    chat (--by chat). -> (data, words)"""
    from .feedback_page import in_agent_terminal
    by = getattr(args, "by", None) or "page"
    if by == "page" and in_agent_terminal():
        raise Fail("Only the person says yes, on the Feedback page's Post it. A yes they said in chat, to your card that "
                   "showed this draft: --approve <rev> --by chat.")
    if by == "chat" and not assistant:
        raise Fail("Only an Assistant records a yes said in chat, right after the person's yes to a card that showed that draft.")
    if not args.key:
        raise Fail("Which problem? Pass --key <its id>.")
    rev = int(args.approve)
    with problems() as ps:
        p = ps.get(args.key)
        if not isinstance(p, dict):
            raise Fail("No problem with that key is kept here.")
        a = p.get("approval") if isinstance(p.get("approval"), dict) else None
        if a and a.get("rev") == rev and p.get("decision") == "approved" and not refusal(p, rev, d, approving=True):
            return {"key": args.key, "changed": False, "approved": rev}, "Already approved: nothing changed."
        why = refusal(p, rev, d, approving=True)
        if why:
            return {"key": args.key, "changed": False, "approved": False, "why": why[0]}, why[1]
        dr = p["draft"]
        ps[args.key] = {**p, "decision": "approved", "until": None,
                        "was": {k: p.get(k) for k in ("state", "decision", "until")},
                        "decided": {"at": now(), "by": by},
                        "approval": {"rev": rev, "target": dr["target"], "at": now(), "by": by},
                        "post": {"state": "waiting", "rev": rev, "target": dr["target"]}}
    return ({"key": args.key, "changed": True, "approved": rev},
            f"Approved draft {rev}. Post it: herdr-task feedback --key {args.key} --file --rev {rev}.")


# ---- posting once ---------------------------------------------------------------------------

def stale(post):
    """A post marked posting whose process never came back (it died, or its answer is lost): read as unsure."""
    return post.get("state") == "posting" and now() - (post.get("started") or 0) > FILING_MS


def gh(args, body=None):
    """gh, with the body in a file (byte for byte), never raising: one that can't start answers as a clear refusal."""
    path = None
    try:
        if body is not None:
            with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8", newline="") as f:
                f.write(body)
                path = f.name
            args = [*args, "--body-file", path]
        try:
            return fbm.run([fbm.GH, *args])
        except OSError as e:
            return subprocess.CompletedProcess([fbm.GH, *args], 127, "", f"gh can't start: {e.strerror or e}")
    finally:
        if path:
            os.unlink(path)


def posting_call(args, assistant):
    """--approve or --reconcile, when asked for: True once said (else None)."""
    from .output import say
    if getattr(args, "approve", None) is not None:
        say(args, *approve(args, assistant))
        return True
    if getattr(args, "reconcile", False):
        if not args.key:
            raise Fail("Which problem? Pass --key <its id>.")
        say(args, *reconcile(args.key))
        return True
    if getattr(args, "by", None) and not getattr(args, "approve", None):
        raise Fail("--by goes with --approve <rev>.")
    if getattr(args, "rev", None) is not None and getattr(args, "dry_run", False):
        raise Fail("--dry-run shows a draft without keeping it; it never goes with --rev, which posts. Nothing posted.")
    if getattr(args, "rev", None) is not None and not args.file:
        raise Fail("--rev goes with --file: herdr-task feedback --key <key> --file --rev <n>.")
    return None


def file_or_draft(args, key, line, d, agent, space=None):
    """--file: with --rev, the approved draft posted once; without, the draft written (nothing posted), with any open
    issue like it named (advisory: the person decides). -> (data, words)"""
    from .triage import FENCED, fenced
    if fenced(feedback_repo(d)):  # Triage is that repo's only publisher (#235, turning it on, step 2)
        return ({"key": key, "kept": False, "filed": False, "why": "triage"},
                f"{FENCED}: nothing drafted or posted here. The person's yes is on the Feedback page; Triage posts it. Carry on.")
    if getattr(args, "rev", None) is not None:
        if getattr(args, "dry_run", False):
            raise Fail("--dry-run shows a draft without keeping it; it never goes with --rev, which posts. Nothing posted.")
        return file_rev(key, int(args.rev), d)
    p = problems_read().get(key)
    if not p and not feedback_on(space, d):
        return {"key": key, "kept": False, "why": "off"}, "Feedback offers are off in Settings: nothing filed."
    if not p:
        raise Fail("No problem with that key is kept here.")
    if cant_draft(p, d, key):
        return cant_draft(p, d, key)
    dups = []
    if not getattr(args, "new", False) and getattr(args, "comment", None) in (None, ""):
        from .feedback_check import public_terms
        try:  # upstream's duplicate search (open issues), from the shaped words when there are some (slice 3)
            dups = fbm.duplicates(feedback_repo(d), " ".join(public_terms(p["search"])) if p.get("search") else line or p["line"])
        except Fail:
            dups = []
    return write_draft(args, key, line, d, agent, dups)


def file_rev(key, rev, d):
    """--file --rev N: posts the approved draft as it is, once. -> (data, words)"""
    p = problems_read().get(key)
    if not p:
        raise Fail("No problem with that key is kept here.")
    why = refusal(p, rev, d)
    if why and why[0] == "unsure":
        return reconcile(key, d)
    if why:
        return {"key": key, "filed": False, "why": why[0]}, why[1]
    if p.get("search"):
        from .feedback_check import quietly
        quietly(key, d)  # checked again right before posting (#94, slice 3): it never blocks
    with problems() as ps:
        p = ps.get(key) or {}
        d = fbm.read_settings()  # as they are now: a repo changed or offers turned off meanwhile stop it
        why = refusal(p, rev, d)  # again, under the lock: two --file calls at once post once
        if why:
            return {"key": key, "filed": False, "why": why[0]}, why[1]
        dr = p["draft"]
        post = {"state": "posting", "rev": rev, "target": dr["target"], "started": now(),
                "mark": mark_of(dr["body"]) or marker(key, rev)}
        ps[key] = {**p, "post": post}
    t = dr["target"]
    try:
        if t["action"] == "comment":
            r = gh(["issue", "comment", str(t["issue"]), "--repo", t["repo"]], dr["body"])
        else:
            r = gh(["issue", "create", "--repo", t["repo"], "--title", dr["title"]], dr["body"])
    except Exception as e:  # noqa: BLE001  (anything else: nobody knows whether it went out)
        r = subprocess.CompletedProcess([], -1, "", f"{type(e).__name__}: {e}")
    out = (r.stdout or "").strip()
    urls = re.findall(r"https://github\.com/\S+", out)
    if r.returncode == 0 and urls:
        return posted(key, post, urls[-1])
    said = one_line((r.stderr or r.stdout or "").strip() or "gh gave no answer", 300)
    if r.returncode != 0 and not urls and REFUSED.search(said):
        with problems() as ps:
            p = ps.get(key) or {}
            if (p.get("post") or {}).get("started") == post["started"]:
                ps[key] = {**p, "post": {**post, "state": "refused", "why": said}}
        return ({"key": key, "filed": False, "why": "refused", "error": said},
                f"Couldn't post it: {said}. Nothing went out, and the person's yes still holds: once that's fixed, "
                f"herdr-task feedback --key {key} --file --rev {rev} posts it.")
    with problems() as ps:
        p = ps.get(key) or {}
        if (p.get("post") or {}).get("started") == post["started"]:
            ps[key] = {**p, "post": {**post, "state": "unsure", "why": said}}
    return reconcile(key, d)


def posted(key, post, url):
    """The post went out: filed, its yes used up, and the issue it went to noted for --track to read."""
    t = post["target"]
    issue = url if t["action"] == "create" else f"https://github.com/{t['repo']}/issues/{t['issue']}"
    issue = re.sub(r"[#?].*$", "", issue)
    with problems() as ps:
        p = ps.get(key) or {}
        if (p.get("post") or {}).get("started") != post.get("started"):  # another attempt's record: left as it is
            return {"key": key, "filed": True, "url": url}, f"Already filed: {url}."
        ps[key] = {**{k: v for k, v in p.items() if k not in ("approval", "back")}, "state": "filed", "at": now(), "url": url,
                   "post": {**post, "state": "posted", "url": url},
                   "outcome": {"url": issue}}  # its issue; GitHub's side is read by --track (feedback_track)
    return ({"key": key, "filed": True, "url": url},
            f"{'Commented' if t['action'] == 'comment' else 'Filed'}: {url} — tell the person this link in one line.")


def pages(text):
    """gh api --paginate's answer: one JSON array per page, back to back."""
    out, i, dec = [], 0, json.JSONDecoder()
    s = str(text or "")
    while True:
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s):
            return out
        v, i = dec.raw_decode(s, i)
        out.extend(v if isinstance(v, list) else [v])


def iso(ms):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(max(0, ms) / 1000))


def reconcile(key, d=None):
    """Looks on GitHub for a post whose answer was lost, by its marker, reading the repo directly (its search index can
    lag or miss): the person's own issues since the attempt began, or the issue's comments since then, every page.
    Found: posted. Not found, or GitHub can't say: still unsure, and never posted again. -> (data, words)"""
    p = problems_read().get(key)
    if not p:
        raise Fail("No problem with that key is kept here.")
    post = p.get("post") or {}
    if post.get("state") == "posted":
        return {"key": key, "filed": True, "url": post.get("url")}, f"Already filed: {post.get('url')}."
    if post.get("state") not in ("posting", "unsure") or post.get("state") == "posting" and not stale(post):
        return {"key": key, "checked": False, "why": post.get("state") or "none"}, "Nothing to look for: it isn't a post in doubt."
    t, mark = post["target"], post.get("mark") or marker(key, post["rev"])
    since = iso((post.get("started") or 0) - SINCE_SLACK_MS)
    words = ("Couldn't tell whether it was posted. It is never posted again: the person can check on GitHub from the "
             "Feedback page; if it isn't there, Never on its row and a new report start over.")
    if t["action"] == "comment":
        r = gh(["api", f"repos/{t['repo']}/issues/{t['issue']}/comments?since={since}&per_page=100", "--paginate"])
    else:
        who = gh(["api", "user", "--jq", ".login"])
        login = (who.stdout or "").strip()
        if who.returncode != 0 or not re.fullmatch(r"[A-Za-z0-9-]+", login):
            return still_unsure(key, post, "GitHub couldn't say who is signed in"), words
        r = gh(["api", f"repos/{t['repo']}/issues?creator={login}&state=all&since={since}&per_page=100", "--paginate"])
    if r.returncode != 0:
        return still_unsure(key, post, one_line((r.stderr or r.stdout or "").strip() or "gh failed", 200)), words
    try:
        items = pages(r.stdout)
    except ValueError:
        return still_unsure(key, post, "GitHub's answer couldn't be read"), words
    hit = next((x for x in items if isinstance(x, dict) and mark_of(x.get("body")) == mark and x.get("html_url")), None)
    if hit:
        return posted(key, post, str(hit["html_url"]))
    return still_unsure(key, post, "not found on GitHub"), words


def still_unsure(key, post, why):
    with problems() as ps:
        p = ps.get(key) or {}
        cur = p.get("post") or {}
        if cur.get("started") == post.get("started") and cur.get("state") in ("posting", "unsure"):  # never undoes posted
            ps[key] = {**p, "post": {**cur, "state": "unsure", "why": why, "looked": now()}}
    return {"key": key, "filed": False, "why": "unsure", "unsure": True}


# What the Assistant's settings block says on its Feedback offers line (assistant_settings.py), after slice 3's words.
SETTINGS_WORDS = ("A yes is for the exact text: --file writes the draft and posts nothing, and its answer shows it; put it "
                  "with where it goes in your question card, and only right after the person's yes to that card run "
                  "--approve <rev> --by chat, then --file --rev <rev>. A message with <hc feedback id=\"<key>\" "
                  "rev=\"<n>\"/> is the person's Post it on the Feedback page: run herdr-task feedback --key <key> "
                  "--file --rev <n>")
