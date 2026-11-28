"""Shape and check a kept problem (friction loop, slice 3, #94: fork/specs/friction-loop.md).

- An Assistant, when it's free, shapes a problem: `herdr-task feedback --key K --shape --fix "<one line>" --search
  "<public words>"` keeps the fix for every Shepherdr user and the public words a search may use, then checks.
- `--check` (on shaping, before `--file` posts, or on its own) asks GitHub with the person's own gh, read only:
  the feedback repo's issues, open and closed; Shepherdr's repo's too when the feedback repo is another one (a fork);
  and Shepherdr's newest release against the installed version. Only the `search` words leave the machine, redacted
  again; never the line or the details. No `search` words: nothing is checked. The result is kept as `checked`; a
  check gh couldn't answer keeps the last one and notes why (`check_error`). It never blocks: the person decides.
- The person's Follow this one (`--follow <url>`, from the Feedback page, refused in an agent's terminal): the problem
  follows an issue the check found, and nothing is posted. Its Undo is the page's (feedback_page.change)."""

import json
import re
import subprocess

from . import feedback as fbm
from .base import Fail, now
from .feedback import REPO, feedback_on, feedback_repo, one_line, problems, problems_read, search_terms

SEARCH_MAX = 200     # the public words a search may use, as an agent wrote them
MATCHES = 3          # a repo's possible matches kept and shown (GitHub shows up to three while you write an issue)
REASONS = {"COMPLETED": "completed", "NOT_PLANNED": "not_planned", "DUPLICATE": "duplicate"}
CANONICAL = ("query($o:String!,$n:String!,$i:Int!){repository(owner:$o,name:$n){issue(number:$i){timelineItems("
             "itemTypes:[MARKED_AS_DUPLICATE_EVENT],last:1){nodes{...on MarkedAsDuplicateEvent{canonical{...on Issue{"
             "number title url state stateReason repository{nameWithOwner}}}}}}}}}")


# The Assistant's settings block, on its Feedback offers line (assistant_settings.py): upstream's way to tell Assistants
# about this setting, as the templates stay upstream's. If upstream takes this, the words belong in its template.
SETTINGS_WORDS = ("Record each one without asking (herdr-task feedback \"<one line>\" --details \"…\" --fix \"<one line>\") and "
                  "say so in one line: the person's Feedback page keeps what waits, so nothing is lost. When you're free, never "
                  "before answering the person, shape it: herdr-task feedback --key <key> --shape --fix \"<the fix for every "
                  "Shepherdr user, one line>\" --search \"<public words: Shepherdr's own names for the screen or command, never "
                  "the person's project, people or data>\" keeps the fix and checks GitHub for it; the page shows what it found")


def public_terms(text):
    """The words a search may send: no path, address or redaction mark at all (redact() keeps a home path's tail as
    ~/…, fine in an issue body, never in a search), then search_terms' redacted, telling words. Redacted whole first
    (a "password: x" is seen as one), then a quoted path goes whole, spaces and all, then any word with a path in it."""
    s = fbm.redact(text or "")
    s = re.sub(r"[\"'`“‘][^\"'`”’\n]*[/\\][^\"'`”’\n]*[\"'`”’]", " ", s)
    kept = [w for w in s.split() if not re.search(r"[/\\~<>@:]", w)]
    return search_terms(" ".join(kept))


def gh(args):
    """gh, read only; one that can't start (not installed) answers as a failure, never an exception."""
    try:
        return fbm.run([fbm.GH, *args])
    except OSError as e:
        return subprocess.CompletedProcess([fbm.GH, *args], 127, "", f"gh can't start: {e.strerror or e}")


def asked(args):
    return bool(getattr(args, "shape", False) or getattr(args, "check", False) or getattr(args, "follow", None))


def shape_or_check(args, assistant):
    """--shape, --check or --follow, when asked for: True once said (else None)."""
    from .feedback_page import in_agent_terminal
    from .output import say
    if not asked(args):
        return None
    if not args.key:
        raise Fail("Which problem? Pass --key <its id>, as its news line or --list gives it.")
    if args.follow:
        say(args, *follow(args.key, args.follow))
        return True
    if args.shape:
        if not assistant:
            raise Fail("Only an Assistant shapes feedback, when it's free: report it with herdr-task feedback \"<one line>\" "
                       "--details \"…\" --fix \"<one line>\" and carry on.")
        say(args, *shape(args))
        return True
    if not assistant and in_agent_terminal():
        raise Fail("Only an Assistant or the Feedback page checks feedback on GitHub: carry on with your work.")
    say(args, *check(args.key))
    return True


# ---- shape ----------------------------------------------------------------------------------

def shape_words(p, key):
    """Before an Assistant offers a problem nobody shaped yet: how to shape it, so the page shows its fix and check."""
    if p.get("search"):
        return ""
    return (f"First, when you're free (never before answering the person), shape it: herdr-task feedback --key {key} --shape "
            "--fix \"<the fix for every Shepherdr user, one line>\" --search \"<public words: Shepherdr's own names for the "
            "screen or command, never the person's project>\" keeps the fix and checks GitHub for it. Then: ")


def shape(args):
    """The fix and the public search words, kept on the problem; then the check, when there are search words."""
    fix = one_line(args.fix) if args.fix else None
    search = one_line(args.search, SEARCH_MAX) if getattr(args, "search", None) else None
    from . import feedback_post as post
    if not (fix or search or post.wants_draft(args)):
        raise Fail("Shape it with --fix \"<the fix for every Shepherdr user, one line>\" and --search \"<public words>\".")
    with problems() as ps:
        p = ps.get(args.key)
        if not isinstance(p, dict):
            raise Fail("No problem with that key is kept here.")
        if not feedback_on(p.get("space")):
            return {"key": args.key, "shaped": False, "why": "off"}, "Feedback offers are off in its space: nothing kept, nothing checked."
        ps[args.key] = {**p, **({"fix": fix} if fix else {}), **({"search": search} if search else {}),
                        **({"kind": args.kind} if getattr(args, "kind", None) else {})}
        has_search = bool(ps[args.key].get("search"))
    # the draft's own fields (--title, --goal, --happened, --comment …): the exact post for the person's yes (slice 4)
    drafted, more = ({}, "")
    if post.wants_draft(args):
        data, words = post.write_draft(args, args.key, "", None, None)
        drafted, more = {"draft": data.get("draft"), "kept": data.get("kept", False)}, "\n\n" + words
    if not has_search:
        return ({"key": args.key, "shaped": True, "checked": False, "why": "no-search", **drafted},
                "Shaped: the person sees its fix on the Feedback page. Add --search \"<public words>\" to check GitHub for it." + more)
    data, words = check(args.key)
    return {**data, "key": args.key, "shaped": True, **drafted}, "Shaped: the person sees its fix on the Feedback page. " + words + more


# ---- check ----------------------------------------------------------------------------------

def check(key, d=None):
    """Asks GitHub about one problem, read only, and keeps what it found: (data, words)."""
    p = problems_read().get(key)
    if not p:
        raise Fail("No problem with that key is kept here.")
    if not feedback_on(p.get("space"), d):
        return {"key": key, "checked": False, "why": "off"}, "Feedback offers are off in its space: nothing checked."
    terms = public_terms(p.get("search"))
    if not terms:
        return ({"key": key, "checked": False, "why": "no-search"},
                "No search words yet, so nothing was checked: shape it first (--shape --fix \"…\" --search \"<public words>\").")
    repo = feedback_repo(d)
    try:
        same = issues(repo, terms)
        makers = issues(REPO, terms) if repo.lower() != REPO.lower() else []
    except Fail as e:
        why = one_line(str(e), 200)
        with problems() as ps:
            if isinstance(ps.get(key), dict):
                ps[key] = {**ps[key], "check_error": {"at": now(), "why": why}}
        return {"key": key, "checked": False, "why": "gh", "error": why}, f"{why} The Feedback page keeps its last check."
    newest = newest_release(REPO)
    if newest is FAILED:  # GitHub didn't say: the last check's answer stays
        newest = p["checked"].get("newest") if isinstance(p.get("checked"), dict) else None
    found = {"at": now(), "repo": repo, "dupes": same, "upstream": makers, "newest": newest,
             "installed": fbm.shepherdr_version()}
    with problems() as ps:
        if isinstance(ps.get(key), dict):
            ps[key] = {**{k: v for k, v in ps[key].items() if k != "check_error"}, "checked": found}
    return {"key": key, "checked": True, **found}, found_words(found)


def quietly(key, d=None):
    """The check right before a post: best effort, never in the way of filing."""
    try:
        check(key, d)
    except Fail:
        pass


def issues(repo, terms):
    """The repo's issues, open and closed, that may be this one: all the words first, then the first three (a long
    query finds nothing). Each closed as a duplicate names its canonical issue when GitHub's timeline does."""
    for ws in (terms, terms[:3]) if len(terms) > 3 else (terms,):
        r = gh(["issue", "list", "--repo", repo, "--state", "all", "--search", " ".join(ws),
                "--json", "number,title,url,state,stateReason", "--limit", "5"])
        if r.returncode != 0:
            raise Fail(f"GitHub isn't reachable here ({one_line((r.stderr or r.stdout).strip() or 'gh failed', 160)}).")
        try:
            rows = [x for x in json.loads(r.stdout or "[]") if isinstance(x, dict) and x.get("number")]
        except ValueError:
            rows = []
        if rows:
            out = [match(repo, x) for x in rows[:MATCHES]]
            for m in out:
                if m.get("reason") == "duplicate":
                    c = canonical(repo, m["number"])
                    if c:
                        m["canonical"] = c
            return out
    return []


def match(repo, x):
    return {"repo": str((x.get("repository") or {}).get("nameWithOwner") or repo), "number": int(x["number"]),
            "title": one_line(x.get("title") or "", 120), "url": str(x.get("url") or ""),
            "state": "closed" if str(x.get("state") or "").upper() == "CLOSED" else "open",
            **({"reason": REASONS[str(x.get("stateReason") or "").upper()]}
               if str(x.get("state") or "").upper() == "CLOSED" and str(x.get("stateReason") or "").upper() in REASONS else {})}


def canonical(repo, number, failed=None):
    """The issue a duplicate points to (GitHub's MarkedAsDuplicateEvent), else None; `failed` when GitHub didn't answer."""
    owner, _, name = repo.partition("/")
    r = gh(["api", "graphql", "-f", f"query={CANONICAL}", "-f", f"o={owner}", "-f", f"n={name}", "-F", f"i={number}"])
    if r.returncode != 0:
        return failed
    try:
        nodes = json.loads(r.stdout)["data"]["repository"]["issue"]["timelineItems"]["nodes"]
    except (ValueError, KeyError, TypeError):
        return failed
    try:
        c = next(n["canonical"] for n in reversed(nodes) if isinstance(n, dict) and isinstance(n.get("canonical"), dict))
    except (TypeError, StopIteration):
        return None
    if not c.get("number") or not c.get("url"):
        return None
    return match(repo, c)


FAILED = object()  # newest_release: GitHub didn't answer


def newest_release(repo):
    """Shepherdr's newest stable release, as a version ("3.2.23"); None when it has none (GitHub's 404); FAILED when
    GitHub didn't say."""
    r = gh(["api", f"repos/{repo}/releases/latest", "--jq", ".tag_name"])
    if r.returncode != 0:
        return None if re.search(r"\b404\b|Not Found", (r.stderr or "") + (r.stdout or "")) else FAILED
    m = re.fullmatch(r"v?(\d+\.\d+\.\d+)", (r.stdout or "").strip())
    return m.group(1) if m else FAILED


def version(v):
    m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", str(v or ""))
    return tuple(int(x) for x in m.groups()) if m else None


def newer(found):
    """(newest, installed) when a newer release is out than the one installed, else None."""
    a, b = version(found.get("newest")), version(found.get("installed"))
    return (found["newest"], found["installed"]) if a and b and a > b else None


# a match in words, by its state or close reason: (in the feedback repo, in Shepherdr's repo when filing elsewhere).
# web/plugins/feedback/words.ts says the same to the person.
SAID = {"open": ("Maybe the same", "Shepherdr's makers have it"),
        "completed": ("Fixed before", "Shepherdr's makers fixed it before"),
        "not_planned": ("Declined before", "Shepherdr's makers declined it before"),
        "duplicate": ("Closed as a duplicate", "Shepherdr's makers closed it as a duplicate"),
        "closed": ("Closed before", "Shepherdr's makers closed it")}


def said(m, makers=False):
    """One match in the page's words; a duplicate whose canonical issue is known, as that one."""
    m = m.get("canonical") or m
    kind = "open" if m["state"] == "open" else m.get("reason") if m.get("reason") in SAID else "closed"
    return f"{SAID[kind][1 if makers else 0]}: “{m['title']}”" + (" (open)" if kind == "open" else "")


def found_words(found):
    lines = [f"- {said(m)} {m.get('canonical', m)['url']}" for m in found["dupes"]]
    lines += [f"- {said(m, True)} {m.get('canonical', m)['url']}" for m in found["upstream"]]
    n = newer(found)
    if n:
        lines.append(f"- A newer version is out ({n[0]}; you have {n[1]})")
    if not lines:
        return "Checked GitHub: no issue like it, and no newer version."
    return ("Checked GitHub; the person sees this on the Feedback page, where a match can be followed with nothing "
            "posted:\n" + "\n".join(lines))


# ---- Follow this one ------------------------------------------------------------------------

def follow(key, url):
    """The person's Follow this one: the problem follows an issue its check found; nothing is posted."""
    from .feedback_page import KEPT, in_agent_terminal
    if in_agent_terminal():
        raise Fail("Only the person follows an issue, on the Feedback page: an agent can't. Carry on with your work.")
    with problems() as ps:
        p = ps.get(key)
        if not isinstance(p, dict):
            raise Fail("No problem with that key is kept here.")
        if not feedback_on(p.get("space")):
            return {"key": key, "changed": False, "why": "off"}, "Feedback offers are off in its space: nothing more happens to it."
        if p.get("decision") == "following":
            return {"key": key, "changed": False}, "It follows an issue already."
        if p.get("state") in ("filed", "filing", "declined") or p.get("decision") == "declined":
            return {"key": key, "changed": False}, "That one was decided already: nothing followed."
        c = p.get("checked") or {}
        m = next((x.get("canonical") or x for x in [*(c.get("dupes") or []), *(c.get("upstream") or [])]
                  if isinstance(x, dict) and url in (x.get("url"), (x.get("canonical") or {}).get("url"))), None)
        if not m or m.get("url") != url:
            raise Fail("Follow an issue its check found: that one isn't among them.")
        issue = f"{m['repo']}#{m['number']}"
        ps[key] = {**p, "decision": "following", "until": None, "was": {k: p.get(k) for k in KEPT},
                   "decided": {"at": now(), "by": "page"},
                   "outcome": {"url": m["url"], "issue": issue, "title": m.get("title") or "", "state": m["state"],
                               **({"reason": m["reason"]} if m.get("reason") else {}), "checked_at": c.get("at")},
                   "related": [*[x for x in p.get("related") or [] if isinstance(x, dict) and x.get("url") != m["url"]],
                               {"issue": issue, "url": m["url"], "by": "person"}]}
    return {"key": key, "changed": True, "following": m["url"]}, f"Following “{m.get('title') or issue}”: nothing posted."
