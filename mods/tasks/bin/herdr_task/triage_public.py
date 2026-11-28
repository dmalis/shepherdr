"""Triage's privacy check (dmalis/shepherdr#235, fork/specs/issue-loop.md, "Privacy"): run on the exact payload of every
GitHub call Triage makes, inside the one wrapper every call goes through (triage_gh.call). It says what kind of thing it
found and on which line, never the text. Its answer is pass, unsure or hit.

- **Hit: the deny list**, read at runtime and never committed: the person's emails (git config, `gh api user/emails`),
  home paths whole or with a tilde, this machine's host name and every linked machine's (`hc machine ls`), the names of
  the machine's other spaces and repos (the settings file, and `gh repo list` once a day), `triage.private_words`, and
  what `fork/sync/public.py` refuses (tailnet and `.local` names, IP addresses, installer output and tracebacks), ported
  here since herdr-task can't import `fork/`; and a task's key (feedback.task_keys: "AB-12"), which feedback.redact()
  turns into "a task" in every draft.
- **Unsure:** a phone-number shape; anything feedback.redact() would change; a capitalised word that isn't at a
  sentence's start, or a word mixing letters and digits, that appears nowhere in the repo's own text.

What the daily reads found is kept in the store, owner-only (`.triage-deny.json`): it never leaves this machine."""

import json
import os
import re
import socket
import subprocess

from .base import GH, HOME, hc_json, now, STORE
from .feedback import task_keys

DAY_MS = 24 * 3600000
DENY_FILE = os.path.join(STORE, ".triage-deny.json")
WORDS_FILE = os.path.join(STORE, ".triage-words.json")

# ported from fork/sync/public.py (kept in step by test/test_triage.py)
HOME_PATH = re.compile(r"(?:^|[\s\"'`(=:\[<])(?:/home/|/Users/|/root/|/var/home/)|[A-Za-z]:\\Users\\", re.I)
TILDE_PATH = re.compile(r"(?:^|[^\w/])~[\w.-]*/")
EMAIL = re.compile(r"[\w.%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
TAILNET = re.compile(r"\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|tailscale\.net|beta\.tailscale\.net)\b", re.I)
MDNS = re.compile(r"\b[A-Za-z0-9][\w-]*\.local\b")
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
RAW = [
    ("installer output", re.compile(r"NOT DONE")),
    ("installer output", re.compile("✗")),
    ("installer output", re.compile(r"\(all its output:")),
    ("a traceback", re.compile(r"Traceback \(most recent call last\)")),
]
PHONE = re.compile(r"(?<![\w.])\+?\(?\d[\d ().-]{7,}\d(?![\w.])")
WORD = re.compile(r"[A-Za-z][A-Za-z0-9_'’-]*[A-Za-z0-9]|[A-Za-z0-9]*\d[A-Za-z0-9]*")
# what never counts as a private name, whatever a list says (too short, or Triage's own words)
PLAIN = {"root", "user", "admin", "localhost", "home", "main", "dev", "test", "tmp", "app", "the"}


def _words_ok(words, keep=()):
    keep = {str(k).lower() for k in keep if k}
    return sorted({w for w in (str(x).strip() for x in words) if len(w) >= 3 and w.lower() not in PLAIN
                   and w.lower() not in keep}, key=len, reverse=True)


def _read(path):
    try:
        with open(path) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write_private(path, d):
    """Owner-only, written whole: the deny list's daily reads never leave this machine."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(d, f)
        os.replace(tmp, path)
    except OSError:
        pass


def _out(argv, timeout=20):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        return r.stdout if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


def git_emails(folder=None):
    out = set()
    for argv in (["git", "config", "--global", "user.email"], ["git", "-C", folder or HOME, "config", "user.email"]):
        v = (_out(argv, 5) or "").strip()
        if v:
            out.add(v)
    return out


def daily(gh_read):
    """What GitHub says once a day (the person's emails, their repos' names), kept owner-only. gh_read(args) -> text or
    None: the wrapper's read, so these calls are paced and checked like every other."""
    d = _read(DENY_FILE)
    if now() - int(d.get("at") or 0) < DAY_MS and isinstance(d.get("emails"), list):
        return d
    emails = gh_read(["api", "user/emails", "--jq", ".[].email"])
    repos = gh_read(["repo", "list", "--limit", "200", "--json", "name", "--jq", ".[].name"])
    if emails is None and repos is None:
        return d  # GitHub can't say now: the last day's list holds (or none, and the local list still applies)
    d = {"at": now(), "emails": sorted({x.strip() for x in (emails or "").split("\n") if "@" in x}) or d.get("emails") or [],
         "repos": sorted({x.strip() for x in (repos or "").split("\n") if x.strip()}) or d.get("repos") or []}
    _write_private(DENY_FILE, d)
    return d


def machine_names():
    out = set()
    try:
        host = socket.gethostname()
        out.update([host, host.split(".")[0]])
    except OSError:
        pass
    ms = hc_json("machine", "ls")
    rows = ms.get("machines") if isinstance(ms, dict) else ms
    for m in rows if isinstance(rows, list) else []:
        if isinstance(m, dict):
            for k in ("name", "host", "hostname"):
                v = str(m.get(k) or "").strip()
                if v:
                    out.update([v, v.split(".")[0]])
    return out


def settings_names(d):
    """The names of the machine's spaces and repos in the settings file."""
    out = set()
    for sp in (d.get("spaces") or {}).values() if isinstance(d.get("spaces"), dict) else []:
        if isinstance(sp, dict):
            if sp.get("name"):
                out.add(str(sp["name"]))
            if sp.get("folder"):
                out.add(os.path.basename(str(sp["folder"]).rstrip("/")))
    for key in (d.get("repos") or {}) if isinstance(d.get("repos"), dict) else []:
        out.add(os.path.basename(str(key).split(":", 1)[-1].rstrip("/")))
    return out


def private_words(d):
    """triage.private_words, Everywhere's and every repo's: a list, or one string split at commas and lines."""
    out = set()
    for layer in [d.get("everywhere"), *((d.get("repos") or {}).values() if isinstance(d.get("repos"), dict) else [])]:
        tri = layer.get("triage") if isinstance(layer, dict) else None
        pw = tri.get("private_words") if isinstance(tri, dict) else None
        if isinstance(pw, list):
            out.update(str(x) for x in pw if isinstance(x, str))
        elif isinstance(pw, str):
            out.update(x.strip() for x in re.split(r"[,\n]", pw) if x.strip())
    return out


def deny_list(d, repo=None, folder=None, gh_read=None):
    """{"emails": [...], "words": [...]}: what makes a payload a hit. repo ("owner/name") and folder: Triage's own repo,
    whose own names aren't private (the space it runs in is the repo's)."""
    day = daily(gh_read) if gh_read else _read(DENY_FILE)
    emails = git_emails(folder) | set(day.get("emails") or [])
    own = {repo.split("/")[-1], repo.split("/")[0]} if repo else set()
    if folder:
        own.add(os.path.basename(folder.rstrip("/")))
    for sp in (d.get("spaces") or {}).values() if isinstance(d.get("spaces"), dict) else []:
        if isinstance(sp, dict) and folder and str(sp.get("folder") or "").rstrip("/") == folder.rstrip("/") and sp.get("name"):
            own.add(str(sp["name"]))
    names = machine_names() | settings_names(d) | set(day.get("repos") or [])
    try:
        import pwd
        pw = pwd.getpwuid(os.getuid())
        names.add(pw.pw_name)
        names.update(x.strip() for x in (pw.pw_gecos or "").split(",")[:1])
    except (KeyError, ImportError):
        pass
    names.add(os.path.basename(HOME.rstrip("/")))
    names = {w for x in names for w in [x, *str(x).split()]}
    return {"emails": sorted(emails), "words": _words_ok(names, keep=own) + _words_ok(private_words(d))}


# ---- the repo's own text --------------------------------------------------------------------

def repo_words(folder):
    """Every word in the repo's tracked text, lower-cased: a name that appears there is the project's, not the person's.
    Kept per commit (WORDS_FILE), read again when HEAD moves. None when the folder isn't a git checkout."""
    head = (_out(["git", "-C", folder, "rev-parse", "HEAD"], 10) or "").strip() if folder else ""
    if not head:
        return None
    kept = _read(WORDS_FILE)
    if kept.get("head") == head and kept.get("folder") == folder and isinstance(kept.get("words"), list):
        return set(kept["words"])
    files = (_out(["git", "-C", folder, "ls-files", "-z"], 30) or "").split("\0")
    seen = set()
    for rel in files:
        p = os.path.join(folder, rel)
        try:
            if not rel or os.path.getsize(p) > 2_000_000:
                continue
            with open(p, "rb") as f:
                raw = f.read()
        except OSError:
            continue
        if b"\0" in raw[:4096]:
            continue
        seen.update(w.lower() for w in WORD.findall(raw.decode("utf-8", "replace")))
    _write_private(WORDS_FILE, {"head": head, "folder": folder, "words": sorted(seen)})
    return seen


# ---- the check ------------------------------------------------------------------------------

def _named(words):
    if not words:
        return None
    return re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(w) for w in words) + r")(?![\w-])", re.I)


def _starts(line):
    """The offsets in a line where a sentence starts: the line's first word (after list marks, headings, quotes) and
    each word after . ! ? or :."""
    out = set()
    m = re.match(r"\s*(?:[#>*+-]+\s*|\d+[.)]\s*|[_*`\"'(“‘\[]+)*", line)
    out.add(m.end() if m else 0)
    for m in re.finditer(r"[.!?:;—–]\s+[_*`\"'(“‘\[]*", line):
        out.add(m.end())
    return out


def check(text, deny=None, known=None, redact=None, hits_only=False):
    """{"verdict": "pass" | "unsure" | "hit", "found": [{"kind", "line"}]} for the exact text. deny: deny_list()'s;
    known: the repo's own words (repo_words; None: unknowable, so any such word is unsure); redact: feedback.redact
    (what it would change is unsure). hits_only: the deny list alone, for what code wrote (a call's own arguments: a
    path, labels, a time), where the unsure rules mean nothing."""
    deny = deny or {"emails": [], "words": []}
    emails = {e.lower() for e in deny.get("emails") or []}
    named = _named(deny.get("words") or [])
    found = []
    key_rx = None if hits_only else task_keys()[0]
    for n, line in enumerate(str(text or "").splitlines() or [""], 1):
        kinds = []
        if HOME_PATH.search(line) or (HOME.rstrip("/") and HOME.rstrip("/") in line):
            kinds.append("a home path")
        if TILDE_PATH.search(line):
            kinds.append("a ~/ path")
        hits = [m.group(0).lower() for m in EMAIL.finditer(line)]
        if hits:
            kinds.append("the person's email" if any(h in emails for h in hits) else "an email address")
        if TAILNET.search(line) or MDNS.search(line):
            kinds.append("a network host name")
        if IPV4.search(line):
            kinds.append("an IP address")
        if named and named.search(line):
            kinds.append("a private name")
        if key_rx and key_rx.search(line):
            kinds.append("a task key")
        for kind, rx in RAW:
            if rx.search(line) and kind not in kinds:
                kinds.append(kind)
        found += [{"kind": k, "line": n, "level": "hit"} for k in kinds]
        if hits_only:
            continue
        unsure = []
        if PHONE.search(line) and len(re.sub(r"\D", "", PHONE.search(line).group(0))) >= 9:
            unsure.append("a phone number's shape")
        starts = _starts(line)
        for m in WORD.finditer(line):
            w = m.group(0)
            mixed = bool(re.search(r"\d", w)) and bool(re.search(r"[A-Za-z]", w))
            capital = w[0].isupper() and m.start() not in starts
            if (mixed or capital) and (known is None or w.lower() not in known):
                unsure.append("a name the repo doesn't use")
                break
        found += [{"kind": k, "line": n, "level": "unsure"} for k in unsure]
    if redact is not None and not hits_only and not any(f["level"] == "hit" for f in found):
        try:
            changed = redact(text) != str(text or "")
        except Exception:  # noqa: BLE001  (a redaction that fails can't vouch for the text)
            changed = True
        if changed:
            found.append({"kind": "something redaction would change", "line": 0, "level": "unsure"})
    verdict = "hit" if any(f["level"] == "hit" for f in found) else "unsure" if found else "pass"
    return {"verdict": verdict, "found": [{"kind": f["kind"], "line": f["line"]} for f in found]}


def words(result):
    """One line for the person or the log: which kinds, on which lines; never the text found."""
    by = {}
    for f in result.get("found") or []:
        by.setdefault(f["kind"], []).append(str(f["line"]) if f["line"] else "the whole text")
    return "; ".join(f"{k} (line {', '.join(v)})" for k, v in by.items()) or "nothing"
