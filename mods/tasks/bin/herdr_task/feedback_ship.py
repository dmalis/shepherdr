"""On this machine, and works (friction loop, slice 6, #94: fork/specs/friction-loop.md).

- A followed problem whose issue GitHub closed as fixed (feedback_track; a duplicate's canonical issue, when that one
  is) is looked at further, read only, with the person's own gh: the commit that closed it (its timeline's ClosedEvent
  closer: a pull request's merge commit, or a commit), the first stable release of that repo whose tag contains it
  (`gh api repos/<repo>/compare/<tag>...<sha>`: behind or identical), and whether this machine's installed build
  contains it. Kept as the outcome's `fix` ({issue, commit, release?, build: {sha, has}}) and, when the build has it,
  `shipped` ({build, machine, at, how: "release"}). No closing commit, or no release with it: "Closed as fixed" stays.
  A closing date before a release proves nothing and isn't used.
- The installed build is the installer's record's (bin/shepherdr's build_of): none is unknown, and gives no "On this
  machine" from evidence, only the person's Works.
- An install says what it carries: `--installed <build> --issues <url>…` (each `--try-it <url> "<words>"` its Try it
  words) replaces the list of issues that build carries, ignored unless <build> is the one the installer recorded.
  An issue left out loses "On this machine"; every one does when the recorded build changes, since reads show
  `shipped` only for the build installed now (seen_here).
- The person's Works and Still broken (`--works`, `--broken`, from the Feedback page, refused in an agent's terminal)
  are kept for the build they have (`tried`). Works ends the following; a newer build doesn't undo it. Still broken
  brings it back under Found, linked to its issue, with a comment on that issue as a draft for File it… (only where
  feedback is filed). A report after Works, or once its fix is on this machine, brings it back too (`back`)."""

import json
import os
import re
import socket

from . import feedback as fbm
from .base import APP_HOME, Fail, HOME, SHARE, now
from .feedback import feedback_on, feedback_repo, one_line, problems, problems_read
from .feedback_check import gh, version
from .feedback_track import ISSUE, followed, issue_of

CLOSER = ("query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){timelineItems("
          "itemTypes:[CLOSED_EVENT],last:1){nodes{...on ClosedEvent{closer{__typename ...on PullRequest{mergeCommit{oid}}"
          " ...on Commit{oid}}}}}}}}")
COMMIT = re.compile(r"[0-9a-f]{40}")
RELEASES = 30        # the newest releases looked through, of the repo the fix is in
COMPARES = 8         # release tags compared at most in one look, newest first
TRY_MAX = 200
FAILED = object()    # GitHub didn't answer: what was known stays


# ---- this machine ---------------------------------------------------------------------------

def installed_build():
    """The commit the installed Shepherdr came from (its install record's `build`), else None: unknown."""
    for p in (os.path.join(SHARE, "installed.json"), os.path.join(HOME, ".local", "share", "shepherdr", "installed.json"),
              os.path.join(APP_HOME, "data", "shepherdr", "installed.json")):
        try:
            with open(p) as f:
                rec = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(rec, dict) and rec.get("version"):
            b = str(rec.get("build") or "")
            return b if COMMIT.fullmatch(b) else None
    return None


def shipped_here(p, b):
    """The evidence its fix is on this machine, for the build installed now (else None)."""
    s = p.get("shipped") if isinstance(p, dict) else None
    return s if isinstance(s, dict) and b and s.get("build") == b else None


def seen_here(rows):
    """Rows as reads show them: `shipped` only for the build installed now; `here`, this machine's version and build,
    on each row with a fix, a shipped or a tried (the page tells "update to get it" and the person's build by them)."""
    b, v, out = installed_build(), None, []
    for r in rows:
        if not any(r.get(x) for x in ("shipped", "tried")) and not (r.get("outcome") or {}).get("fix"):
            out.append(r)
            continue
        v = v or fbm.shepherdr_version()
        r = {k: x for k, x in r.items() if k != "shipped" or shipped_here(r, b)}
        out.append({**r, "here": {"version": v, "build": b}})
    return out


def here_name():
    from .settings import machine_name
    return machine_name() or socket.gethostname()


# ---- GitHub, read only ----------------------------------------------------------------------

def fixed_issue(o):
    """The issue whose closing is the fix, as (repo, number): its own, closed as fixed; a duplicate's canonical one,
    when that one is closed as fixed; else None."""
    if not isinstance(o, dict) or o.get("state") != "closed":
        return None
    c = o.get("canonical") if o.get("reason") == "duplicate" else None
    x = o if o.get("reason") == "completed" else c if isinstance(c, dict) and c.get("state") == "closed" and c.get("reason") == "completed" else None
    m = ISSUE.match(str((x or {}).get("url") or ""))
    return (m.group(1), int(m.group(2))) if m else None


def closer(repo, n):
    """The commit that closed an issue: a merged pull request's merge commit, or a commit; None when nothing closed it
    (closed by hand); FAILED when GitHub didn't say."""
    owner, _, name = repo.partition("/")
    r = gh(["api", "graphql", "-f", f"query={CLOSER}", "-f", f"o={owner}", "-f", f"n={name}", "-F", f"i={n}"])
    if r.returncode != 0:
        return FAILED
    try:
        nodes = json.loads(r.stdout)["data"]["repository"]["issue"]["timelineItems"]["nodes"]
    except (ValueError, KeyError, TypeError):
        return FAILED
    last = next((x for x in reversed(nodes or []) if isinstance(x, dict)), None)
    c = (last or {}).get("closer")
    if not isinstance(c, dict):
        return None
    sha = (c.get("mergeCommit") or {}).get("oid") if c.get("__typename") == "PullRequest" else c.get("oid")
    return sha if COMMIT.fullmatch(str(sha or "")) else None


def contains(repo, base, head):
    """Whether `base` (a tag, a build) has commit `head`, as GitHub's compare says (behind or identical); None when
    the repo doesn't know one of them; FAILED when GitHub didn't say."""
    r = gh(["api", f"repos/{repo}/compare/{base}...{head}", "--jq", ".status"])
    if r.returncode != 0:
        said = (r.stderr or "") + (r.stdout or "")
        return None if re.search(r"\b(?:404|422)\b|Not Found|No common ancestor", said) else FAILED
    return (r.stdout or "").strip() in ("behind", "identical")


def releases(repo):
    """The repo's stable releases, newest first: [(version, tag)]; FAILED when GitHub didn't say."""
    r = gh(["api", f"repos/{repo}/releases?per_page={RELEASES}"])
    if r.returncode != 0:
        return FAILED
    try:
        rows = json.loads(r.stdout or "[]")
    except ValueError:
        return FAILED
    out = []
    for x in rows if isinstance(rows, list) else []:
        tag = str((x or {}).get("tag_name") or "") if isinstance(x, dict) else ""
        m = re.fullmatch(r"v?(\d+\.\d+\.\d+)", tag)
        if m and not x.get("draft") and not x.get("prerelease"):
            out.append((m.group(1), tag))
    return sorted(out, key=lambda t: version(t[0]), reverse=True)


def first_release(repo, sha):
    """The first stable release whose tag has the commit ("3.2.23"), None when none does, FAILED when GitHub didn't
    say. Newest first, stopping at the first without it: releases come one after another from one line."""
    rs = releases(repo)
    if rs is FAILED:
        return FAILED
    found = None
    for v, tag in rs[:COMPARES]:
        has = contains(repo, tag, sha)
        if has is FAILED:
            return FAILED
        if not has:
            break
        found = v
    return found


def build_has(repo, b, sha):
    """Whether the installed build has the fix: compared where the issue is, then where feedback is filed (a fork's
    build may be unknown upstream). True, False, or FAILED."""
    for where in dict.fromkeys([repo.lower(), feedback_repo().lower()]):
        has = contains(where, b, sha)
        if has is not None:
            return has
    return False


# ---- after each --track -----------------------------------------------------------------------

def after(fresh):
    """After --track: the fix of each problem whose issue was just read (`fresh`, keys), and of every followed one
    whose last look was for another build than the one installed now."""
    b = installed_build()
    for k, p in problems_read().items():
        fix = (p.get("outcome") or {}).get("fix")
        if k in fresh or followed(p) and fixed_issue(p.get("outcome")) and b and ((fix or {}).get("build") or {}).get("sha") != b:
            look(k, k in fresh, b)


def look(key, fresh, b):
    """One problem's fix, as far as GitHub shows it, kept under the lock (only if it still follows that issue)."""
    p = problems_read().get(key) or {}
    o = p.get("outcome") or {}
    fi = fixed_issue(o)
    if not fi:  # open again, or not closed as fixed: no fix to look for (shipped and tried stay, for their build)
        if "fix" in o:
            keep(key, o.get("url"), None)
        return
    ref = f"{fi[0]}#{fi[1]}"
    fix = dict(o["fix"]) if isinstance(o.get("fix"), dict) and o["fix"].get("issue") == ref else {"issue": ref}
    if "commit" not in fix:  # once per closing: a reopen drops the fix, and the next close is looked at again
        c = closer(*fi)
        if c is not FAILED:
            fix["commit"] = c
    sha = fix.get("commit")
    if not sha:
        keep(key, o.get("url"), fix)
        return
    if not fix.get("release") and (fresh or "release" not in fix):  # a release may come out since: each read looks
        rel = first_release(fi[0], sha)
        if rel is not FAILED:
            fix["release"] = rel
    ship = None
    if b and (fix.get("build") or {}).get("sha") != b:
        has = build_has(fi[0], b, sha)
        if has is not FAILED:
            fix["build"] = {"sha": b, "has": has}
            ship = has
    keep(key, o.get("url"), fix, ship, b)


def keep(key, url, fix, ship=None, b=None):
    with problems() as ps:
        p = ps.get(key)
        if not isinstance(p, dict) or (p.get("outcome") or {}).get("url") != url:
            return
        o = {k: v for k, v in (p.get("outcome") or {}).items() if k != "fix"}
        p = {**p, "outcome": {**o, **({"fix": fix} if fix else {})}}
        s = p.get("shipped") if isinstance(p.get("shipped"), dict) else None
        if ship is True and not (s and s.get("build") == b):
            p["shipped"] = {"build": b, "machine": here_name(), "at": now(), "how": "release",
                            **({"release": fix["release"]} if fix.get("release") else {})}
        elif ship is False and s and s.get("how") == "release":
            p.pop("shipped")  # the build installed now hasn't it (a rollback): not on this machine
        ps[key] = p


# ---- what an install carries ----------------------------------------------------------------

def installed_call(args):
    """--installed <build> --issues <url>…: the issues that build carries, from the install itself. True once said."""
    from .output import say
    if getattr(args, "installed", None) is None:
        if getattr(args, "issues", None) or getattr(args, "try_it", None):
            raise Fail("--issues and --try-it go with --installed <build>.")
        return None
    b, given = installed_build(), str(args.installed).strip().lower()
    if not b or len(given) < 7 or not b.startswith(given):
        say(args, {"build": given, "ignored": True, "why": "not-installed"},
            "That isn't the build installed here (its install record names " + (b[:12] if b else "no build") + "): nothing changed.")
        return True
    carries = {}
    for u in getattr(args, "issues", None) or []:
        m = ISSUE.match(str(u).strip())
        if not m:
            raise Fail(f"{one_line(u, 80)} isn't an issue on GitHub: --issues https://github.com/<owner>/<name>/issues/<n> …")
        carries[f"https://github.com/{m.group(1)}/issues/{m.group(2)}"] = None
    for u, words in getattr(args, "try_it", None) or []:
        m = ISSUE.match(str(u).strip())
        url = f"https://github.com/{m.group(1)}/issues/{m.group(2)}" if m else None
        if url not in carries:
            raise Fail("--try-it names one of the --issues: --try-it <its url> \"<what to do, and what to see>\".")
        carries[url] = one_line(words, TRY_MAX) or None
    here, gone, at = [], [], now()
    with problems() as ps:
        for k, p in ps.items():
            if not isinstance(p, dict):
                continue
            urls = [x for x in ((issue_of(p) or (None, None, None))[2], fixed_url(p), (p.get("back") or {}).get("issue")) if x]
            hit = next((u for u in urls if u in carries), None)
            s = p.get("shipped") if isinstance(p.get("shipped"), dict) else None
            if hit:
                new = {"build": b, "machine": here_name(), "at": at, "how": "install", **({"try": carries[hit]} if carries[hit] else {})}
                if not s or {**s, "at": at} != new:
                    ps[k] = {**p, "shipped": new}
                here.append(k)
            elif s and s.get("how") == "install":
                ps[k] = {x: v for x, v in p.items() if x != "shipped"}
                gone.append(k)
    say(args, {"build": b, "issues": len(carries), "here": here, "gone": gone},
        f"Kept: build {b[:12]} carries {len(carries)} issue{'' if len(carries) == 1 else 's'}; "
        f"{len(here)} problem{'' if len(here) == 1 else 's'} on the Feedback page now say On this machine"
        + (f", and {len(gone)} no longer do" if gone else "") + ".")
    return True


def fixed_url(p):
    fi = fixed_issue(p.get("outcome"))
    return f"https://github.com/{fi[0]}/issues/{fi[1]}" if fi else None


# ---- the person's Works and Still broken ----------------------------------------------------

def tryable(p, b):
    """Whether the person can say it works now: its fix is on this machine, or GitHub closed it as fixed and this
    machine's build isn't known (no evidence either way: only their Works)."""
    return bool(shipped_here(p, b)) or (not b and fixed_issue(p.get("outcome")) is not None)


def tried_call(args):
    """--works or --broken, the person's, from the Feedback page: True once said (else None)."""
    from .feedback_page import in_agent_terminal
    from .output import say
    result = "works" if getattr(args, "works", False) else "broken" if getattr(args, "broken", False) else None
    if not result:
        return None
    if in_agent_terminal():
        raise Fail("Only the person says whether a fix works, on the Feedback page: an agent can't. Carry on with your work.")
    if not args.key:
        raise Fail("Which problem? Pass --key <its id>.")
    say(args, *tried(args.key, result))
    return True


def tried(key, result):
    b = installed_build()
    with problems() as ps:
        p = ps.get(key)
        if not isinstance(p, dict):
            raise Fail("No problem with that key is kept here.")
        if not feedback_on(p.get("space")):
            return {"key": key, "changed": False, "why": "off"}, "Feedback offers are off in its space: nothing more happens to it."
        t = p.get("tried") if isinstance(p.get("tried"), dict) else {}
        if p.get("back"):
            return {"key": key, "changed": False, "why": "back"}, "It came back already: it waits under Found."
        if t.get("result") == result and t.get("build") == b:
            return {"key": key, "changed": False}, "Already said."
        if not tryable(p, b) and not (result == "broken" and t.get("result") == "works"):
            return {"key": key, "changed": False, "why": "not-here"}, "Its fix isn't on this machine yet: nothing to try."
        p = {**p, "tried": {"result": result, "build": b, "at": now()}}
        if result == "works":
            ps[key] = p
            return {"key": key, "changed": True, "tried": "works"}, "Noted: it works. Its issue isn't followed any more."
        fi = fixed_issue(p.get("outcome"))
        own = issue_of(p)
        on = fi or (own and (own[0], own[1]))
        ps[key] = back(p, "broken", b)
        drafted = False
        if on and on[0].lower() == feedback_repo().lower():  # a comment goes only where feedback is filed
            from .feedback_post import keep_draft
            keep_draft(ps, key, {"target": {"repo": feedback_repo(), "action": "comment", "issue": on[1]},
                                 "title": fbm.redact(one_line(p.get("line"), 120)), "body": comment_body(b)})
            drafted = True
    return ({"key": key, "changed": True, "tried": "broken", "back": True, "draft": drafted},
            "Back under Found: it still happens with its fix" + (", and a comment on its issue waits for the person's "
                                                                 "File it…" if drafted else "") + ".")


def comment_body(b):
    """Still broken's comment, redacted: the exact words the person sees before Post it."""
    return fbm.redact("\n\n".join([
        "This still happens here with the fix installed.",
        "## Environment\n\n" + "\n".join([f"- Shepherdr: {fbm.shepherdr_version()}" + (f" (build {b[:12]})" if b else ""),
                                          f"- Machine: {fbm.os_words()}"]),
        "_Posted by a Shepherdr agent with the person's yes (Settings › Agents › Feedback offers)._"]))


# ---- came back ------------------------------------------------------------------------------

def back(p, why, b):
    """It came back: under Found again, linked to its issue. What was posted stays as history (`before`), so a new
    draft (a comment on that issue) can be written and posted; shipped and tried stay, for their build."""
    own = issue_of(p)
    url = fixed_url(p) or (own[2] if own else None)
    before = {k: p[k] for k in ("url", "post", "draft", "approval", "decision", "state") if k in p}
    out = {k: v for k, v in p.items() if k not in ("url", "post", "draft", "approval", "decision", "until", "was", "decided")}
    related = [x for x in out.get("related") or [] if isinstance(x, dict) and x.get("url") != url]
    if url:
        m = ISSUE.match(url)
        related.append({"issue": f"{m.group(1)}#{m.group(2)}", "url": url, "by": "came-back"})
    return {**out, "state": "found", "at": now(), "back": {"at": now(), "why": why, "build": b, **({"issue": url} if url else {})},
            "before": before, **({"related": related} if related else {})}


def reported_again(p):
    """A report of a problem the person said works, or whose fix is on this machine: it came back (a Never stays)."""
    if p.get("back") or p.get("state") == "declined" or p.get("decision") == "declined":
        return p
    b = installed_build()
    if shipped_here(p, b) or (p.get("tried") or {}).get("result") == "works":
        return back(p, "reported", b)
    return p
