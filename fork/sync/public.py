"""Text bound for GitHub (pull request bodies, issue text and comments) and the run's `--told` words
(fork/specs/sync-pipeline.md, "GitHub destinations and public text"). `problems()` refuses home paths, `~/` paths,
host and machine names (the config's hostname and this machine's among them), emails, tailnet names and addresses,
and installer or log lines. Its findings name the kind and the line, never the text found, so a refusal can't carry
what it refused."""
import re
import socket

HOME_PATH = re.compile(r"(?:^|[\s\"'`(=:\[<])(?:/home/|/Users/|/root/|/var/home/)|[A-Za-z]:\\Users\\", re.I)
TILDE_PATH = re.compile(r"(?:^|[^\w/])~[\w.-]*/")
EMAIL = re.compile(r"[\w.%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
TAILNET = re.compile(r"\b[\w-]+(?:\.[\w-]+)*\.(?:ts\.net|tailscale\.net|beta\.tailscale\.net)\b", re.I)
MDNS = re.compile(r"\b[A-Za-z0-9][\w-]*\.local\b(?!/)")
IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
# what an installer, a log or a crash prints: never pasted where people read it
RAW = [
    ("installer output", re.compile(r"NOT DONE")),
    ("installer output", re.compile("✗")),
    ("installer output", re.compile(r"\(all its output:")),
    ("a traceback", re.compile(r"Traceback \(most recent call last\)")),
]


def hosts(cfg_hostname=None):
    """The machine names that must never go public: the config's, and this machine's own (short and full)."""
    names = {cfg_hostname} if cfg_hostname else set()
    try:
        names.add(socket.gethostname())
    except OSError:
        pass
    out = set()
    for n in names:
        n = (n or "").strip()
        if n and n.lower() not in ("localhost", "localhost.localdomain"):
            out.add(n)
            out.add(n.split(".")[0])
    return {n for n in out if len(n) >= 3}


def problems(text, cfg_hostname=None):
    """[{kind, line}] for each thing in the text that mustn't go public (one per kind and line)."""
    names = hosts(cfg_hostname)
    host = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(n) for n in sorted(names, key=len, reverse=True))
                      + r")(?![\w-])", re.I) if names else None
    found = []
    for n, line in enumerate(str(text).splitlines() or [""], 1):
        kinds = []
        if HOME_PATH.search(line):
            kinds.append("a home path")
        if TILDE_PATH.search(line):
            kinds.append("a ~/ path")
        if EMAIL.search(line):
            kinds.append("an email address")
        if TAILNET.search(line) or MDNS.search(line):
            kinds.append("a network host name")
        if IPV4.search(line):
            kinds.append("an IP address")
        if host and host.search(line):
            kinds.append("this machine's name")
        for kind, rx in RAW:
            if rx.search(line) and kind not in kinds:
                kinds.append(kind)
        found += [{"kind": k, "line": n} for k in kinds]
    return found


def words(found):
    """One line for a refusal: which kinds, on which lines."""
    by = {}
    for f in found:
        by.setdefault(f["kind"], []).append(str(f["line"]))
    return "; ".join(f"{k} (line {', '.join(v)})" for k, v in by.items())
