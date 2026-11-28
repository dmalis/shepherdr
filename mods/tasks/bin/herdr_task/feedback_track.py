"""Follow the issue (friction loop, slice 5, #94: fork/specs/friction-loop.md).

- `herdr-task feedback --track` reads, with the person's own gh and read only, the issue each filed or followed problem
  follows: its state and close reason (`gh issue view`), and for one closed as a duplicate the issue GitHub's timeline
  says it duplicates (its MarkedAsDuplicateEvent's canonical issue, feedback_check.canonical), followed on to the one
  that isn't a duplicate itself. What it read is kept as the problem's `outcome`: {url, issue, title, state, reason?,
  canonical?, checked_at}. Only GitHub's side changes: the person's decision, and what this machine has, stay as they are.
- Each problem's issue is read at most once an hour (SPAN_MS), counted from its last read, whether it answered or not;
  `--key K --track` reads that one now. The service runs it hourly, only while something is followed (service/jobs.ts).
- gh failing keeps the last outcome and notes why (`track_error`): the page says GitHub isn't reachable there.
- Nothing is read for a problem whose origin has Feedback offers off, or one the person said works (slice 6's `tried`)."""

import json
import re

from .base import Fail, now
from .feedback import feedback_on, one_line, problems, problems_read
from .feedback_check import canonical, gh, match

SPAN_MS = 3600000          # an issue is read at most once an hour
HOPS = 3                   # a duplicate of a duplicate: followed this many steps at most
ISSUE = re.compile(r"https://github\.com/([A-Za-z0-9-]+/[A-Za-z0-9._-]+)/issues/(\d+)/?")


def issue_of(p):
    """The issue a problem follows, as (repo, number, url): what was followed or filed (a comment's issue, not the
    comment), else None."""
    for u in ((p.get("outcome") or {}).get("url"), p.get("url")):
        m = ISSUE.match(str(u or ""))
        if m:
            return m.group(1), int(m.group(2)), f"https://github.com/{m.group(1)}/issues/{m.group(2)}"
    return None


def followed(p, d=None):
    """Whether this problem's issue is followed now: filed (an issue made or commented on) or the person's Follow,
    its origin's offers on, and not yet said to work."""
    if not isinstance(p, dict) or not issue_of(p):
        return False
    filed = p.get("state") == "filed" or p.get("decision") == "following" or (p.get("post") or {}).get("state") == "posted"
    works = (p.get("tried") or {}).get("result") == "works"
    return filed and p.get("decision") != "declined" and not works and feedback_on(p.get("space"), d)


def last_read(p):
    return max(int((p.get("outcome") or {}).get("checked_at") or 0), int((p.get("track_error") or {}).get("at") or 0))


def due(p, at=None):
    return (now() if at is None else at) - last_read(p) >= SPAN_MS


def track_call(args):
    """--track, when asked for: True once said (else None)."""
    from .output import say
    if not getattr(args, "track", False):
        return None
    say(args, *track(args.key or None))
    return True


def track(key=None):
    """Reads the issue of each followed problem that's due (or of `key`, now) and keeps what GitHub says. -> (data, words)"""
    ps = problems_read()
    if key:
        if key not in ps:
            raise Fail("No problem with that key is kept here.")
        if not followed(ps[key]):
            return ({"tracked": [], "failed": [], "why": "not-followed"},
                    "It isn't filed or followed on GitHub (or its space has feedback offers off): nothing to read.")
        keys = [key]
    else:
        keys = [k for k, p in ps.items() if followed(p) and due(p)]
    tracked, failed = [], []
    for k in keys:
        repo, n, url = issue_of(ps[k])
        try:
            out = read(repo, n, url, ps[k].get("outcome") or {})
        except Fail as e:
            why = one_line(str(e), 200)
            keep(k, url, None, why)
            failed.append({"key": k, "error": why})
            continue
        was = ps[k].get("outcome") or {}
        keep(k, url, out, None)
        tracked.append({"key": k, "changed": said(was) != said(out), **{x: out[x] for x in ("state", "reason", "canonical") if x in out}})
    return {"tracked": tracked, "failed": failed}, words(ps, tracked, failed)


def read(repo, n, url, was):
    """GitHub's side of one issue, read only: its state and close reason, and a duplicate's canonical issue."""
    r = gh(["issue", "view", str(n), "--repo", repo, "--json", "number,title,url,state,stateReason"])
    if r.returncode != 0:
        raise Fail(f"GitHub isn't reachable here ({one_line((r.stderr or r.stdout or '').strip() or 'gh failed', 160)}).")
    try:
        x = json.loads(r.stdout or "")
        m = match(repo, {**x, "number": x.get("number") or n})
    except (ValueError, TypeError, KeyError, AttributeError):
        raise Fail("GitHub's answer couldn't be read.")
    out = {"url": url, "issue": f"{repo}#{n}", "title": m["title"] or was.get("title") or "", "state": m["state"],
           **({"reason": m["reason"]} if m.get("reason") else {}), "checked_at": now()}
    if m.get("reason") == "duplicate":
        c, seen = m, {url}
        for _ in range(HOPS):
            nxt = canonical(c["repo"], c["number"])
            if not nxt or nxt["url"] in seen:
                break
            seen.add(nxt["url"])
            c = nxt
            if c.get("reason") != "duplicate":
                break
        if c is not m:
            out["canonical"] = {k: c[k] for k in ("repo", "number", "title", "url", "state", "reason") if k in c}
        elif isinstance(was.get("canonical"), dict) and was.get("reason") == "duplicate":
            out["canonical"] = was["canonical"]  # the timeline didn't answer this time: the last one it named stays
    return out


def keep(key, url, out, why):
    """What was read (or why nothing could be), on the problem, under the lock; only if it still follows that issue."""
    with problems() as ps:
        p = ps.get(key)
        if not isinstance(p, dict) or (issue_of(p) or (None, None, None))[2] != url:
            return
        if out is None:
            ps[key] = {**p, "track_error": {"at": now(), "why": why}}
        else:
            ps[key] = {**{k: v for k, v in p.items() if k != "track_error"}, "outcome": {**(p.get("outcome") or {}), **out,
                       **({} if "reason" in out else {"reason": None}), **({} if "canonical" in out else {"canonical": None})}}
            ps[key]["outcome"] = {k: v for k, v in ps[key]["outcome"].items() if v is not None}


# GitHub's side in words, for the command's answer: web/plugins/feedback/words.ts says the same to the person.
def said(o):
    if not o or not o.get("state"):
        return "Filed"
    if o["state"] == "open":
        return "Open on GitHub"
    r = o.get("reason")
    if r == "completed":
        return "Closed as fixed"
    if r == "not_planned":
        return "Declined there"
    if r == "duplicate":
        c = o.get("canonical")
        if not isinstance(c, dict) or not c.get("title"):
            return "Closed as a duplicate"
        which = "is open" if c.get("state") == "open" else "was declined" if c.get("reason") == "not_planned" else "is " + said(c).lower()
        return f"Closed as a duplicate of “{c['title']}”, which {which}"
    return "Closed"


def words(ps, tracked, failed):
    if not tracked and not failed:
        return "Nothing followed is due a look on GitHub: each issue is read at most once an hour."
    lines = [f"- {one_line(ps[t['key']].get('line'), 80)}: {said(t)}{'' if t['changed'] else ' (as before)'}" for t in tracked]
    lines += [f"- {one_line(ps[f['key']].get('line'), 80)}: {f['error']} The Feedback page keeps its last state." for f in failed]
    return "Read on GitHub; the person sees this on the Feedback page:\n" + "\n".join(lines)
