"""Feedback for Shepherdr (SHEP-78): an agent that hits a problem in Shepherdr itself (a Shepherdr,
herdr-task, web or window feature that doesn't work as meant, a command failing like our bug, the
person's frustration with Shepherdr) offers, once, to file it as a GitHub issue, and files it only
with the person's yes.

- Any agent that isn't an Assistant (a task worker, its reviewer, an automation's run, an agent
  tab) runs `herdr-task feedback "<one line>" --details "…"`: it returns at once and its Assistant
  gets one <herdr-news event="feedback"> line (held while the person writes to it, as other news),
  so the agent carries on. A reviewer usually puts it in its findings for its worker instead.
- The Assistant runs the same command for a problem it noticed itself or was told: it says whether
  to offer (never twice for one problem, never after the person's No), then asks with its question
  tool. On yes: `--file` searches the repo's open issues for a duplicate first, then files a
  redacted issue with gh (or `--comment <n>` adds to the duplicate). On no: `--no`, remembered.
- Settings › Agents › Feedback offers (agents.feedback, on unless turned off, per space or
  Everywhere) and the repo it files to (agents.feedback_repo, Everywhere's; default upstream).

One problem is the words of its one line (id_of; key_of for a row an older version wrote); each report of it and what
happened to it are kept in STATE (friction loop, #94: fork/specs/friction-loop.md)."""

import fcntl
import hashlib
import json
import os
import platform
import pwd
import re
import socket
import subprocess
import sys
import tempfile
import unicodedata
from contextlib import contextmanager

from .base import APP_HOME, ENTRY, Fail, GH, HOME, hc_json, now, own_core_check, run, SHARE, STORE
from .settings import DEFAULTS, bare, read_settings

STATE = os.path.join(STORE, ".feedback.json")
REPO = DEFAULTS["agents"]["feedback_repo"]
AGAIN_MS = 12 * 3600000            # told or offered: not again within this (about a working session)
FILING_MS = 10 * 60000             # a filing under way: another --file of the same problem waits this long
KEEP_MS = 90 * 24 * 3600000        # what's remembered of a problem, the person's No too
LINE_MAX = 160
FIELD_MAX = 1500                   # a body section's length: never a log pasted whole
FIELD_LINES = 25
FIELDS = [("goal", "Goal"), ("happened", "What happened"), ("tried", "What was tried"), ("expected", "Expected"),
          ("fix", "Suggested fix"), ("repro", "Steps to reproduce")]
STOP = set("a an and are as at be but by can could did do does doesnt dont for from had has have i in is isnt it its "
           "me my no not of on or our so that the their them then there these this to too was wasnt we were what when "
           "where which while who why will with wont would you your".split())


# What every agent that isn't an Assistant is told at its session's start (reactions.agent_note), with offers on.
AGENT_NOTE = ("Feedback for Shepherdr (on in Settings): when Shepherdr itself misbehaves, not the project's own code (a Shepherdr, "
              "herdr-task, web app or window feature that doesn't work as meant, a Herdr command failing like a bug, the person "
              "frustrated with Shepherdr), run herdr-task feedback \"<one line>\" --details \"<goal, what was tried, what went wrong, "
              "expected>\" --fix \"<the fix for every Shepherdr user, one line>\" once per problem and carry on: it returns at "
              "once, is kept for the person, and the space's Assistant asks the person whether to file it. Never file an issue "
              "yourself; no secrets, private paths or whole logs.")


# ---- the settings ---------------------------------------------------------------------------

def feedback_on(space=None, d=None):
    """Settings › Agents › Feedback offers in a space: its own, else Everywhere's, else on."""
    d = read_settings() if d is None else d
    own = (d.get("spaces") or {}).get(bare(space)) if space else None
    for layer in (own, d.get("everywhere")):
        a = layer.get("agents") if isinstance(layer, dict) else None
        if isinstance(a, dict) and isinstance(a.get("feedback"), bool):
            return a["feedback"]
    return DEFAULTS["agents"]["feedback"]


def repo_of(value):
    """owner/name from a repo setting ("owner/name", a github.com URL), else None."""
    v = str(value or "").strip()
    v = re.sub(r"^(?:https?://)?(?:www\.)?github\.com/", "", v).rstrip("/")
    v = re.sub(r"\.git$", "", v)
    return v if re.fullmatch(r"[A-Za-z0-9-]+/[A-Za-z0-9._-]+", v) else None


def feedback_repo(d=None):
    """The repo feedback is filed to: Everywhere's agents.feedback_repo, else upstream Shepherdr's."""
    d = read_settings() if d is None else d
    a = (d.get("everywhere") or {}).get("agents") if isinstance(d.get("everywhere"), dict) else None
    return repo_of((a or {}).get("feedback_repo") if isinstance(a, dict) else None) or REPO


# ---- one problem ----------------------------------------------------------------------------

def one_line(text, n=LINE_MAX):
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def words_of(line):
    return [w for w in re.findall(r"[a-z0-9]+", str(line).lower().replace("'", "")) if w not in STOP]


def key_of(line):
    """A problem's key: the words of its one line that say something, in order."""
    return hashlib.sha1(" ".join(words_of(line)).encode()).hexdigest()[:10]


# Friction loop, slice 1 (#94): every report is kept. A problem's id is its first key: upstream's key_of for a row an
# older version wrote, else id_of, which keeps negations and every script's words. Each report is kept on its
# problem, saved before anyone is told; reads never write; nothing undecided expires.
NEGATIONS = {"no", "not", "never", "nothing"}
NOT_WORDS = set("aint arent cant couldnt didnt doesnt dont hadnt hasnt havent isnt mustnt neednt shouldnt wasnt werent "
                "wont wouldnt".split())
KINDS = ("bug", "confusing", "workaround", "manual", "miss")
TELLING_MS = 2 * 60000             # a report handed to its Assistant's news: told once the news is held, else sent again


def tokens(text):
    """The words of a line in any script: letters, digits and the marks that belong to them (a Devanagari vowel sign,
    an accent), joined by an apostrophe inside a word; Unicode-normalized first."""
    out, w = [], ""
    for ch in unicodedata.normalize("NFKC", str(text or "")).casefold():
        if unicodedata.category(ch)[0] in "LNM" or ch == "_" or (ch in "'’" and w):
            w += ch
        else:
            if w:
                out.append(w)
            w = ""
    if w:
        out.append(w)
    return [x.rstrip("'’") for x in out]


def id_of(line):
    """A new problem's id: its line's words in any script, lower-cased, without upstream's stop words but keeping
    no, not, never, nothing (n't words count as not); a hash of the line as written when no word is left."""
    words = []
    for w in tokens(line):
        plain = w.replace("'", "").replace("’", "")
        if re.search(r"n['’]t$", w) or plain in NOT_WORDS:
            words.append("not")
        elif plain not in STOP or plain in NEGATIONS:
            words.append(plain)
    seed = ("words " + " ".join(words)) if words else ("line " + str(line or ""))
    return hashlib.sha1(seed.encode()).hexdigest()[:10]  # seeded apart from key_of's, so an old key never meets a new id


def find(ps, line):
    """The problem a report of this line joins: the one with its id, else a row an older version keyed the old way
    whose own line has the same id, whatever its old key (an old collision never absorbs a different problem, nor its
    No), else a new id."""
    new = id_of(line)
    same = [k for k, p in ps.items() if k == new or isinstance(p, dict) and p.get("line") and id_of(p["line"]) == new]
    if not same:
        return new
    # Several old rows can say the same: a filing or a No first, so it's never offered again; then its own id, then
    # the row upstream's key picks.
    rank = {"filed": 0, "filing": 0, "declined": 1}
    return min(same, key=lambda k: (rank.get((ps[k] or {}).get("state") if isinstance(ps[k], dict) else None, 2),
                                    k != new, k != key_of(line)))


class Unreadable(Exception):
    pass


def read_problems():
    """STATE's problems, read only: no lock, no write, nothing pruned. An unreadable record raises Unreadable."""
    try:
        with open(STATE) as f:
            d = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        raise Unreadable(str(e))
    ps = d.get("problems", {}) if isinstance(d, dict) else None
    if not isinstance(ps, dict):
        raise Unreadable("not a feedback record")
    return ps


def tidy(ps):
    """Nothing undecided expires. A No's report text goes after KEEP_MS; its id, line, state and link stay, so a
    later report finds its history."""
    for p in ps.values():
        if not isinstance(p, dict) or p.get("state") != "declined":
            continue
        last = max([p.get("at") or 0, *[r.get("at") or 0 for r in p.get("reports") or [] if isinstance(r, dict)]])
        if now() - last > KEEP_MS:
            p.pop("details", None)
            if p.get("reports"):
                p["reports"] = [{k: v for k, v in r.items() if k not in ("line", "details")} for r in p["reports"] if isinstance(r, dict)]


@contextmanager
def problems():
    """STATE's {key: {line, state, at, space, ...}} under its lock (an agent and the Assistant may
    write it at once). state: found (kept, not told yet), telling (handed to the Assistant's news),
    told (sent to the Assistant), offered,
    declined, filed (later: an older version's, noted to offer once the person is back). Written
    only when something changed; an unreadable record is kept aside, never overwritten as empty."""
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE + ".lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            ps = read_problems()
        except Unreadable:
            if not os.path.isfile(STATE):
                raise Fail(f"Couldn't read the feedback record ({STATE}): nothing changed.")
            os.replace(STATE, f"{STATE}.bad-{now()}")
            ps = {}
        before = json.dumps(ps, sort_keys=True)
        yield ps
        if json.dumps(ps, sort_keys=True) == before:
            return
        tidy(ps)
        tmp = f"{STATE}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump({"problems": ps}, f)
        os.replace(tmp, STATE)


def add_report(ps, key, report, fix=None, kind=None):
    """One more report on a problem (a new one is found): kept with its space; the first report's space is its origin."""
    p = ps.get(key) if isinstance(ps.get(key), dict) else {}
    reports = [r for r in p.get("reports") or [] if isinstance(r, dict)]
    if not reports and p.get("line"):  # a row an older version wrote: its one report so far
        reports = [{k: v for k, v in (("at", p.get("at")), ("space", p.get("space")), ("line", p.get("line")),
                                      ("details", p.get("details"))) if v}]
    count = max(p.get("count") or 0, len(reports)) + 1
    reports.append({k: v for k, v in report.items() if v})
    p = {**p, "id": key, "line": p.get("line") or report["line"], "space": p.get("space") or report.get("space"),
         "reports": reports, "count": count, **({"fix": fix} if fix else {}), **({"kind": kind} if kind else {})}
    p.setdefault("state", "found")
    p.setdefault("at", report["at"])
    if p.get("decision") == "later":  # Not now ends when it happens again (feedback_page.py)
        p = {k: v for k, v in p.items() if k not in ("decision", "until", "was", "decided")}
    ps[key] = p
    return p


def recent(p):
    return now() - (p.get("at") or 0) < AGAIN_MS


# ---- redaction ------------------------------------------------------------------------------

SECRETS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)"),
    re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
    re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{30,}"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"),  # a JWT
    # a long run of letters and digits mixed (a key, a token): 32 or more
    re.compile(r"(?<![\w/.-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{32,}={0,2}(?![\w/.-])"),
]
NAMED_SECRET = re.compile(r"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Z0-9_]*)"
                          r"(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|\S+)")
BEARER = re.compile(r"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{12,}")
URL_AUTH = re.compile(r"(\b[a-z][a-z0-9+.-]*://)[^/\s:@]+(?::[^/\s@]*)?@")
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
HOME_PATH = re.compile(r"(?:/home|/Users)/[^/\s'\"`]+")
TAILNET = re.compile(r"\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b")
IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")


def private_words():
    """Words that name this machine and its people: the account, its full name, git's user name,
    the host's name. Longest first, so a full name goes before its parts."""
    out = set()
    try:
        pw = pwd.getpwuid(os.getuid())
        out.add(pw.pw_name)
        out.update(x.strip() for x in (pw.pw_gecos or "").split(",")[:1])
    except KeyError:
        pass
    out.add(os.path.basename(HOME.rstrip("/")))
    try:
        r = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True, timeout=3)
        out.add(r.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    host = socket.gethostname()
    out.update([host, host.split(".")[0]])
    words = {w for x in out for w in [x, *x.split()] if w and len(w) >= 3 and w.lower() not in ("root", "user", "admin", "localhost")}
    return sorted(words, key=len, reverse=True)


def redact(text, private=None):
    """Text fit for a public issue: secrets, tokens, credentials in URLs, e-mail addresses, home
    paths (made ~), tailnet names and IP addresses, and the names of this machine and its people
    gone. private: the words to hide (private_words() when None)."""
    s = str(text or "")
    s = HOME_PATH.sub("~", s.replace(HOME.rstrip("/") + "/", "~/")) if HOME.rstrip("/") else HOME_PATH.sub("~", s)
    for rx in SECRETS:
        s = rx.sub("<redacted>", s)
    s = NAMED_SECRET.sub(lambda m: f"{m.group(1)}{m.group(2)}<redacted>", s)
    s = BEARER.sub(lambda m: f"{m.group(1)} <redacted>", s)
    s = URL_AUTH.sub(r"\1<redacted>@", s)
    s = EMAIL.sub("<email>", s)
    s = TAILNET.sub("<host>", s)
    s = IPV4.sub("<ip>", s)
    for w in private_words() if private is None else private:
        s = re.sub(rf"(?i)(?<![\w-]){re.escape(w)}(?![\w-])", "<name>", s)
    return s


def trim(text):
    """A section's words, never a log whole: at most FIELD_LINES lines and FIELD_MAX characters."""
    s = str(text or "").strip()
    lines = s.split("\n")
    if len(lines) > FIELD_LINES:
        s = "\n".join(lines[:FIELD_LINES]) + "\n… (cut)"
    return s if len(s) <= FIELD_MAX else s[:FIELD_MAX].rstrip() + " … (cut)"


# ---- the issue ------------------------------------------------------------------------------

def shepherdr_version():
    """The installed version: the install's record (<SHARE>/installed.json; a machine not switched to 3.2 yet
    keeps it in Herdr's app folder)."""
    for p in (os.path.join(SHARE, "installed.json"), os.path.join(HOME, ".local", "share", "shepherdr", "installed.json"),
              os.path.join(APP_HOME, "data", "shepherdr", "installed.json")):
        try:
            with open(p) as f:
                v = json.load(f).get("version")
        except (OSError, ValueError, AttributeError):
            continue
        if v:
            return str(v)
    return "unknown"


def os_words():
    if platform.system() == "Darwin":
        return f"macOS {platform.mac_ver()[0] or ''} ({platform.machine()})".replace("  ", " ")
    try:
        with open("/etc/os-release") as f:
            name = next((l.split("=", 1)[1].strip().strip('"') for l in f if l.startswith("PRETTY_NAME=")), None)
    except OSError:
        name = None
    return f"{name or platform.system()} ({platform.machine()})"


def cli_version(agent):
    """`<cli> --version`'s first line, for claude or codex; else ''."""
    if agent not in ("claude", "codex"):
        return ""
    try:
        r = subprocess.run([agent, "--version"], capture_output=True, text=True, timeout=5)
        return one_line(r.stdout.split("\n")[0], 60) if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def environment(agent=None, surface=None):
    agent = agent if agent in ("claude", "codex") else None
    names = {"claude": "Claude Code", "codex": "Codex"}
    v = cli_version(agent) if agent else ""
    return {"shepherdr": shepherdr_version(), "os": os_words(),
            "agent": (f"{names[agent]} {v}".strip() if agent else "not known"),
            "surface": {"web": "the web app", "window": "the Herdr window", "both": "the web app and the Herdr window"}.get(surface or "", "not stated")}


def issue_body(line, fields, env, private=None):
    """The issue's body, redacted: each section (Not known when empty), then Environment."""
    parts = []
    for key, head in FIELDS:
        words = trim(fields.get(key))
        parts.append(f"## {head}\n\n{words or '_Not known._'}")
    parts.append("## Environment\n\n" + "\n".join([
        f"- Shepherdr: {env.get('shepherdr') or 'unknown'}",
        f"- Machine: {env.get('os') or 'unknown'}",
        f"- Agent CLI: {env.get('agent') or 'not known'}",
        f"- Used from: {env.get('surface') or 'not stated'}",
    ]))
    parts.append("_Filed by a Shepherdr agent with the person's yes (Settings › Agents › Feedback offers)._")
    return redact("\n\n".join(parts), private)


def search_terms(line):
    """The words a duplicate search uses: the line's telling words once redacted (it leaves this
    machine too), at most six."""
    marks = {"redacted", "name", "email", "host", "ip"}
    return [w for w in words_of(redact(line)) if len(w) > 2 and w not in marks][:6]


def duplicates(repo, line):
    """Open issues in the repo that may be this one: [{number, title, url}] (gh issue list's search;
    all six words first, then the first three)."""
    words = search_terms(line)
    for ws in (words, words[:3]) if len(words) > 3 else (words,):
        if not ws:
            return []
        r = run([GH, "issue", "list", "--repo", repo, "--state", "open", "--search", " ".join(ws),
                 "--json", "number,title,url", "--limit", "5"])
        if r.returncode != 0:
            raise Fail("Couldn't search the repo's issues: " + one_line((r.stderr or r.stdout).strip() or "gh failed", 200)
                       + ". Is gh signed in (gh auth status)?")
        try:
            found = [x for x in json.loads(r.stdout or "[]") if isinstance(x, dict) and x.get("number")]
        except ValueError:
            found = []
        if found:
            return [{"number": x["number"], "title": x.get("title") or "", "url": x.get("url") or ""} for x in found]
    return []


def gh_with_body(args, body):
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(body)
    try:
        r = run([*args, "--body-file", f.name])
    finally:
        os.unlink(f.name)
    if r.returncode != 0:
        raise Fail(one_line((r.stderr or r.stdout).strip() or "gh failed", 300))
    urls = re.findall(r"https://\S+", r.stdout or "")
    return urls[-1] if urls else (r.stdout or "").strip()


# ---- the command ----------------------------------------------------------------------------

def me():
    addr = os.environ.get("HC_TERMINAL_ID")
    k = hc_json("get", addr) if addr else None
    return addr, k or {}


def agent_of(k):
    """The CLI an agent runs (claude, codex), from its label or its program, else None."""
    from .settings import agent_key
    labels = k.get("labels") or {}
    argv = (k.get("foreground") or {}).get("argv") or k.get("argv") or []
    return labels.get("herdr.agent") or (agent_key([str(x) for x in argv]) if argv else None)


def task_ref(labels):
    """The caller's task as people name it (SHEP-7), from its herdr.task label, else None."""
    slug, _, n = str(labels.get("herdr.task") or "").rpartition("#")
    if not slug or not n:
        return None
    try:
        with open(os.path.join(STORE, f"{slug}.json")) as f:
            d = json.load(f)
        pre = d.get("prefix")
        t = next((t for t in d.get("tasks") or [] if str(t.get("id")) == n), None)
        return (f"{pre}-{n}" if pre else f"#{n}"), (t or {}).get("title")
    except (OSError, ValueError, AttributeError):
        return None


def queue_news(to, text):
    """Hands the news line to a background herdr-task that holds it for the Assistant (news.hold,
    sent by the scheduler's next pass): the held messages' lock may be busy for seconds while a
    send goes out, and a report never waits on it."""
    subprocess.Popen([sys.executable, ENTRY, "_hold-news", to, text], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)


def hold_news(to, text):
    """_hold-news, in the background: holds the news line for the Assistant, then marks its problem told. A hand-off
    that never got this far leaves it telling, and the next report after TELLING_MS sends it again."""
    from .news import hold
    hold(to, text, "news")
    m = re.search(r'event="feedback" key="([0-9a-f]+)"', text)
    if m:
        with problems() as ps:
            p = ps.get(m.group(1))
            if isinstance(p, dict) and p.get("state") == "telling":
                ps[m.group(1)] = {**p, "state": "told"}


def news_line(ref, title, line, details, key):
    attr = lambda x: str(x).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    more = one_line(details, 900)
    # SHEP-322: named by its task's title; the key rides only in the tag.
    text = (f"\"{one_line(title, 80)}\" feedback: " if title else "Feedback: ") + line + (f" · {more}" if more else "")
    return f'<herdr-news task="{attr(ref)}" event="feedback" key="{key}">{text.replace("<", "‹").replace(">", "›")}</herdr-news>'


def offer_words(line, key):
    return (f"Offer it once, when you're between things (never mid-work, never while the person is in the middle of "
            f"something urgent): ask with your question tool \"Leave feedback for Shepherdr about {line}?\" with Yes, No and "
            f"Edit first. Yes: herdr-task feedback --key {key} \"{line}\" --file --goal … --happened … --tried … "
            f"--expected … --fix … --repro … --surface web|window. Edit first: show the draft (add --dry-run), take their "
            f"changes, then file. No: herdr-task feedback --key {key} \"{line}\" --no.")


def problems_read():
    try:
        return {k: p for k, p in read_problems().items() if isinstance(p, dict)}
    except Unreadable as e:
        raise Fail(f"The feedback record can't be read ({one_line(str(e), 120)}): it's left as it is, and the next report "
                   "keeps it aside and starts a new one.")


def list_all(args):
    """--list --all: every problem kept, in every space and state, read only."""
    from .output import say
    rows = [{**p, "id": p.get("id") or key, "key": key} for key, p in problems_read().items()]
    n = lambda r: r.get("count") or len(r.get("reports") or []) or 1
    return say(args, rows, "\n".join(f"{r['id']}  {r.get('state') or 'found'}  {n(r)} report{'' if n(r) == 1 else 's'}  "
                                     f"{r.get('line') or ''}" for r in rows) or "Nothing kept.")


def cmd_feedback(args):
    own_core_check()
    from .launch import caller_space, is_coordinator
    from .output import say
    from . import reactions
    from .feedback_page import decide, snoozed
    decided = decide(args)  # the person's Not now, Never or Undo (the Feedback page, #94): refused in an agent's terminal
    if decided is not None:
        return decided
    line = one_line(args.line)
    if getattr(args, "all", False) and not args.list:
        raise Fail("--all goes with --list: herdr-task feedback --list --all --json")
    if args.list and getattr(args, "all", False):
        return list_all(args)
    addr, k = me()
    labels = k.get("labels") or {}
    assistant = bool(k) and is_coordinator(k)
    from .feedback_check import quietly, shape_or_check
    shaped = shape_or_check(args, assistant)  # --shape, --check, the person's --follow (#94, slice 3)
    if shaped is not None:
        return shaped
    d = read_settings()
    space = caller_space() or reactions.space_of(k, d)
    if getattr(args, "space", None):
        if space and bare(args.space) != bare(space):
            raise Fail("A report comes from your own space: leave out --space.")
        space = args.space
    if args.list:
        rows = [{"key": key, **p} for key, p in problems_read().items() if p.get("state") in ("found", "telling", "told", "later")
                and not snoozed(p) and p.get("decision") not in ("declined", "following") and "/" not in (p.get("space") or "") and (not space or not p.get("space") or bare(p["space"]) == bare(space))]
        return say(args, rows, "\n".join(f"{r['key']}  {r['state']}  {r['line']}" for r in rows) or "Nothing waits to be offered.")
    if not line and not args.key:
        raise Fail("Say the problem in one line: herdr-task feedback \"Ready refused a reviewed commit\" --details \"…\"")
    if (args.file or args.no) and not assistant:
        raise Fail("Only an Assistant asks the person and files feedback: run herdr-task feedback \"<one line>\" --details \"…\" "
                   "and your Assistant offers it. Carry on with your work.")
    if not feedback_on(space, d) and not args.no and not (args.file and args.dry_run):
        # Off: nothing recorded, and the record isn't opened for writing (a filing's preview still shows).
        try:
            key = args.key or find(problems_read(), line)
        except Fail:
            key = args.key or id_of(line)
        return say(args, {"key": key, "sent": False, "why": "off"},
                   "Feedback offers are off in Settings: nothing sent, nothing to offer. Carry on." if not args.file else
                   "Feedback offers are off in Settings: nothing filed.")
    with problems() as ps:
        key = args.key or find(ps, line)
        p = ps.get(key) if isinstance(ps.get(key), dict) else None
        line = line or (p or {}).get("line") or ""
        if args.no:
            ps[key] = {**(p or {}), "id": key, "line": line, "state": "declined", "at": now(), "space": (p or {}).get("space") or space}
            return say(args, {"key": key, "state": "declined"}, "Remembered: the person said no. Never offer this one again.")
        if not args.file:
            if args.line and not args.key:  # a report: kept first, whatever happens next
                p = add_report(ps, key, {"at": now(), "space": space, "machine": d.get("here") or socket.gethostname(),
                                         "from": {"person": True} if getattr(args, "person", False) else from_of(k, labels, assistant), "line": line,
                                         "details": trim(args.details) if args.details else None},
                               one_line(args.fix) if getattr(args, "fix", None) else None, getattr(args, "kind", None))
            answer, news = offer_or_tell(args, ps, key, p, line, k, addr, labels, assistant, space)
        else:
            known = dict(p or {})
            if known.get("state") == "filed" and not args.dry_run:
                return say(args, {"key": key, "filed": True, "url": known.get("url")}, f"Already filed: {known.get('url')}. Nothing filed again.")
            if known.get("state") == "filing" and now() - (known.get("at") or 0) < FILING_MS and not args.dry_run:
                return say(args, {"key": key, "filed": False, "why": "filing"}, "It's being filed right now: nothing filed again.")
            if not args.dry_run:
                ps[key] = {**known, "line": line, "state": "filing", "at": now()}
    if not args.file:
        # Saved first (the lock's end wrote it), then told: a report is never lost to a send that failed.
        if news:
            try:
                queue_news(*news)
            except OSError:
                with problems() as ps:
                    if (ps.get(key) or {}).get("state") == "telling":
                        ps[key] = {**ps[key], "state": "found"}
                return say(args, {"key": key, "sent": False, "kept": True, "why": "send-failed"},
                           "Kept, but it couldn't reach your Assistant now: it waits for the person. Carry on.")
        return say(args, *answer)
    # Filing talks to GitHub: outside the lock, so an agent's report never waits on it. Marked
    # "filing" meanwhile, so a second --file of the same problem can't file it twice.
    try:
        if not args.dry_run and known.get("search"):
            quietly(key, d)  # checked again right before posting (#94)
        return file_it(args, key, known, line, d, agent_of(k))
    finally:
        if not args.dry_run:
            with problems() as ps:
                now_p = ps.get(key) or {}
                if now_p.get("state") == "filing":  # not filed (duplicates found, or gh failed): as it was, with any report since
                    if known or now_p.get("reports"):
                        ps[key] = {**{k: v for k, v in now_p.items() if k not in ("state", "at")},
                                   **{k: known[k] for k in ("state", "at") if k in known}}
                        ps[key].setdefault("state", "found")
                    else:
                        ps.pop(key, None)


def from_of(k, labels, assistant):
    """Who a report came from, as people name it, never a key: an Assistant's chat, a task by its title, else an agent."""
    if assistant:
        return {"chat": True}
    title = (task_ref(labels) or (None, None))[1]
    return {"task": one_line(title, 80)} if title else {"agent": True}


def offer_or_tell(args, ps, key, p, line, k, addr, labels, assistant, space):
    """Not filing, under STATE's lock, the report already kept: an Assistant is told whether to
    offer; any other agent's report goes to its Assistant as news, once per problem. Returns the
    answer (data, words) and the news to send once saved ((to, text), or None)."""
    from .launch import coordinator_in
    from .feedback_page import snoozed
    state = (p or {}).get("state")
    if p and "/" in (p.get("space") or ""):
        # from another machine's space (the Feedback page's box there): never this machine's chat to offer
        return ({"key": key, "sent": False, "kept": True, "why": "elsewhere"}, "That one belongs to another machine's space: nothing to do. Carry on."), None
    if p and snoozed(p):
        # the person's Not now on the Feedback page (#94): nothing offered until it comes back or happens again
        return ({"key": key, "sent": False, "why": "later"}, "The person said not now to this one: nothing to do. Carry on."), None
    if state == "filing" and now() - (p.get("at") or 0) < FILING_MS:
        return ({"key": key, "sent": False, "why": "filing"}, "Your Assistant is filing this one right now: nothing to do. Carry on."), None
    if state == "declined":
        return ({"key": key, "sent": False, "why": "declined"}, "The person said no to this before: nothing to do. Carry on."), None
    if state == "filed":
        return ({"key": key, "sent": False, "why": "filed", "url": p.get("url")}, f"Already filed: {p.get('url')}. Nothing to do. Carry on."), None
    if p and p.get("decision") == "following":  # the person follows an issue for it (#94): nothing to offer
        return ({"key": key, "sent": False, "why": "following", "url": (p.get("outcome") or {}).get("url")},
                "The person follows an issue for this one: nothing to do. Carry on."), None
    entry = {**(p or {}), "id": key, "line": line, "at": now(), "space": (p or {}).get("space") or space,
             **({"details": trim(args.details)} if args.details else {}),
             **({"agent": agent_of(k)} if agent_of(k) and not assistant else {})}
    if assistant:
        if state == "offered" and recent(p):
            return ({"key": key, "offer": False, "why": "offered"}, "Already offered: don't offer it again."), None
        ps[key] = {**entry, "state": "offered"}
        from .feedback_check import shape_words
        return ({"key": key, "offer": True}, shape_words(ps[key], key) + offer_words(line, key)), None
    if state in ("told", "offered", "later") and recent(p) or state == "telling" and now() - (p.get("at") or 0) < TELLING_MS:
        return ({"key": key, "sent": False, "why": "told"}, "Your Assistant already has this one: nothing sent. Carry on."), None
    # another machine's space ("vm/sp1", only from the Feedback page's box): never a chat here, whose ids are this core's
    to = coordinator_in(space) if "/" not in (space or "") else None
    if not to:
        return ({"key": key, "sent": False, "kept": True, "why": "no-assistant"},
                "No Assistant runs here now: it's kept for the person, nothing sent. Carry on."), None
    ref, title = task_ref(labels) or (k.get("name") or addr or "Agent", None)
    ps[key] = {**entry, "state": "telling", "by": ref}  # told once hold_news has held it
    return ({"key": key, "sent": True, "to": to}, "Sent to your Assistant: it asks the person whether to file it. Carry on with your work."), \
        (to, news_line(ref, title, line, args.details, key))


def file_it(args, key, p, line, d, agent):
    """The person said yes: a duplicate search first, then the issue (or a comment on one). Runs
    outside STATE's lock (gh may be slow); notes it as filed after."""
    from .output import say
    repo = repo_of(args.repo) or feedback_repo(d)
    p = p or {}
    fields = {f: getattr(args, f, None) for f, _ in FIELDS}
    if not fields.get("happened") and p.get("details"):
        fields["happened"] = p["details"]
    env = environment(p.get("agent") or agent, args.surface)
    title = redact(one_line(args.title or line, 120))
    body = issue_body(line, fields, env)
    dups = [] if args.new else duplicates(repo, p.get("search") or line) if not args.comment else []
    if args.dry_run:
        out = {"repo": repo, "title": title, "body": body, "duplicates": dups}
        return say(args, out, f"Draft for {repo} (nothing filed):\n\nTitle: {title}\n\n{body}" +
                   ("\n\nPossible duplicates: " + "; ".join(f"#{x['number']} {x['title']}" for x in dups) if dups else ""))
    if dups:
        return say(args, {"key": key, "filed": False, "duplicates": dups},
                   "Possible duplicates are open:\n" + "\n".join(f"- #{x['number']} {x['title']} {x['url']}" for x in dups) +
                   f"\nAsk the person: add a comment there instead (--comment <number>), or file a new one anyway (--new).")
    if args.comment:
        url = gh_with_body([GH, "issue", "comment", str(args.comment), "--repo", repo], body)
    else:
        url = gh_with_body([GH, "issue", "create", "--repo", repo, "--title", title], body)
    with problems() as ps:
        ps[key] = {**ps.get(key, p), "line": line, "state": "filed", "at": now(), "url": url}
    return say(args, {"key": key, "filed": True, "url": url}, f"{'Commented' if args.comment else 'Filed'}: {url} — tell the person this link in one line.")
