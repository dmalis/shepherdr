"""The one wrapper every GitHub call Triage makes goes through (dmalis/shepherdr#235, fork/specs/issue-loop.md: "Pace",
"Privacy", "Ban rules"): the person's own `gh`, on the person's own repo, one write at a time.

- **The privacy check** (triage_public.check) runs on the call's exact payload first: its own arguments (the deny list
  only: code wrote them) and its free text (title, body, comment: every rule). Anything but pass refuses the call, unless
  the free text is the very text the person said yes to in the app (`yes`, its hash): then only its arguments must pass.
- **The budget gate** (ghbudget, #201): nothing goes out while GitHub's limit holds, its wait kept on disk. A primary
  limit waits for its reset; a secondary one waits `retry-after`, else one minute, doubling up to 30 minutes
  (Triage's own wait, `.triage-gh.json`). While it waits, nothing is sent.
- **The pace:** writes go one at a time (a lock), two seconds apart; at most 10 new issues an hour and 30 a day per repo.
  A create over the cap isn't sent, and says so. A create the person said yes to in the backlog's batch (`bulk`) skips
  that cap and keeps inside GitHub's documented secondary limits for content-creating requests instead ("no more than
  80 content-generating requests per minute and no more than 500 content-generating requests per hour", and "wait at
  least one second between each request": docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api and
  .../best-practices-for-using-the-rest-api): two seconds apart (30 a minute at most) and at most BULK_HOUR creates of
  any kind an hour. Its creates are counted apart, so they don't spend the cap's own count.

Nothing here retries: a call that didn't go out is the caller's to try on its next pass."""

import fcntl
import json
import os
import re
import subprocess
import tempfile
import time

from . import ghbudget
from . import triage_public as public
from .base import GH, now, STORE

STATE = os.path.join(STORE, ".triage-gh.json")
LOCK = STATE + ".lock"
APART_MS = 2000
HOUR_MS, DAY_MS = 3600000, 24 * 3600000
CREATES_HOUR, CREATES_DAY = 10, 30
BULK_HOUR = 300                     # the batch's ceiling, well under GitHub's 500 content-creating requests an hour
SECONDARY_FIRST_MS, SECONDARY_MAX_MS = 60000, 30 * 60000
RETRY_AFTER = re.compile(r"(?i)retry-after:\s*(\d+)")


def runner(argv):
    """gh itself, never raising. A gh that can't start answers as a refusal (nothing went out); one cut off by the time
    limit as an unknown (it may have written: never a refusal, so its post is reconciled, never sent again). Tests
    replace this."""
    try:
        return subprocess.run(argv, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(argv, 124, "", "gh timed out after 120 s: whether it went out isn't known")
    except OSError as e:
        return subprocess.CompletedProcess(argv, 127, "", f"gh can't start: {e}")
    except subprocess.SubprocessError as e:
        return subprocess.CompletedProcess(argv, 125, "", f"gh stopped ({type(e).__name__}): whether it went out isn't known")


def sleep(ms):
    time.sleep(ms / 1000)


def _read():
    try:
        with open(STATE) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(d):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = f"{STATE}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(d, f)
    os.replace(tmp, STATE)


class _state:
    """STATE read, changed and written under its own short lock (a read and a write finishing at once both count)."""

    def __enter__(self):
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        self._f = open(STATE + ".rw", "a")
        fcntl.flock(self._f, fcntl.LOCK_EX)
        self.d = _read()
        return self.d

    def __exit__(self, kind, *_):
        try:
            if kind is None:
                _write(self.d)
        finally:
            self._f.close()


def _destination_refusal(repo):
    """A write goes only to the destination in the settings file, read now (never upstream's: destination fails closed)."""
    from .settings import read_settings
    from .triage import destination
    dest = destination(read_settings())
    if not dest or dest.lower() != str(repo or "").lower():
        return "Triage writes only to agents.feedback_repo, our own repo: nothing sent"
    return None


def waiting():
    """When Triage's own wait for GitHub ends (ms), or None: a secondary limit's, or the budget gate's."""
    until = max(int(_read().get("until") or 0), ghbudget.reset_at() or 0)
    return until if until > now() else None


class Result:
    def __init__(self, ok, out="", err="", sent=False, why=None, found=None):
        self.ok, self.out, self.err, self.sent, self.why, self.found = ok, out, err, sent, why, found

    def __repr__(self):
        return f"Result(ok={self.ok}, sent={self.sent}, why={self.why!r})"


def creates_left(d, repo, at=None):
    at = at or now()
    made = [t for t in (d.get("creates") or {}).get(repo.lower(), []) if at - t < DAY_MS]
    return min(CREATES_HOUR - len([t for t in made if at - t < HOUR_MS]), CREATES_DAY - len(made))


def bulk_left(d, repo, at=None):
    """Creates the batch may still make this hour: every create to the repo (capped or the batch's) counts."""
    at = at or now()
    made = [t for k in ("creates", "bulk") for t in (d.get(k) or {}).get(repo.lower(), []) if at - t < HOUR_MS]
    return BULK_HOUR - len(made)


def call(args, *, repo, text=None, body=None, write=False, create=False, yes=False, ctx=None, still=None, bulk=False):
    """One gh call: args after `gh` (a body goes in a file, `--body-file`, byte for byte). text: the free text it sends
    (title and body, or a comment), checked with every rule; yes: that text is what the person said yes to in the app.
    ctx: {"deny", "known", "redact"} for the check. still: for a write, whether it may still go (the caller's pause,
    level and destination), asked again right before gh, after the write lock and the pace's wait, with the destination
    and GitHub's limit. bulk: a create from the person's batch yes, paced by GitHub's documented limits instead of
    Triage's hourly and daily cap. -> Result (sent says whether gh was asked at all)."""
    ctx = ctx or {}
    argv_text = "\n".join(str(a) for a in args)
    fixed = public.check(argv_text, ctx.get("deny"), hits_only=True)
    if fixed["verdict"] != "pass":
        return Result(False, why="private", found=fixed)
    if text is not None:
        free = public.check(text, ctx.get("deny"), ctx.get("known"), ctx.get("redact"))
        if free["verdict"] != "pass" and not yes:
            return Result(False, why=free["verdict"], found=free)
    if write:
        why = _destination_refusal(repo)
        if why:
            return Result(False, why="stop", err=why)
    if ghbudget.held(args) or waiting():
        return Result(False, why="limit", err=ghbudget.held_err(waiting() or ghbudget.held(args) or now()))
    path = None
    lock = None
    try:
        if write:
            os.makedirs(os.path.dirname(LOCK), exist_ok=True)
            lock = open(LOCK, "a")
            fcntl.flock(lock, fcntl.LOCK_EX)
            d = _read()
            if create and bulk and bulk_left(d, repo) <= 0:
                return Result(False, why="pace", err=f"The batch's pace: at most {BULK_HOUR} new issues an hour")
            if create and not bulk and creates_left(d, repo) <= 0:
                return Result(False, why="pace", err="Triage's pace: at most 10 new issues an hour and 30 a day per repo")
            gap = APART_MS - (now() - int(d.get("last_write") or 0))
            if gap > 0:
                sleep(gap)
            # what changed while it waited for the lock and the pace: a pause, the level, the destination, a limit
            why = _destination_refusal(repo) or (None if still is None or still() else "Triage stopped meanwhile: nothing sent")
            if why:
                return Result(False, why="stop", err=why)
            if ghbudget.held(args) or waiting():
                return Result(False, why="limit", err=ghbudget.held_err(waiting() or ghbudget.held(args) or now()))
        if body is not None:
            with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False, encoding="utf-8", newline="") as f:
                f.write(body)
                path = f.name
            args = [*args, "--body-file", path]
        r = runner([GH, *args])
        err = (r.stderr or "").strip()
        if r.returncode != 0 and ghbudget.limited(err or r.stdout):
            ghbudget.refused(args, err)
        with _state() as d:
            if r.returncode != 0 and ghbudget.limited(err or r.stdout) and ghbudget.secondary(err):
                step = min(SECONDARY_MAX_MS, max(SECONDARY_FIRST_MS, int(d.get("step") or 0) * 2))
                m = RETRY_AFTER.search(err + "\n" + (r.stdout or ""))
                d.update(step=step, until=max(int(d.get("until") or 0), now() + (int(m.group(1)) * 1000 if m else step)))
            elif r.returncode == 0 and int(d.get("until") or 0) <= now():
                # a call that worked once the wait was over ends the backoff; one that began before a hold set
                # meanwhile doesn't lift it
                d.pop("step", None)
                d.pop("until", None)
            if write:
                d["last_write"] = now()
                if create and r.returncode == 0:
                    k = "bulk" if bulk else "creates"
                    made = [t for t in (d.get(k) or {}).get(repo.lower(), []) if now() - t < DAY_MS]
                    d.setdefault(k, {})[repo.lower()] = made + [now()]
        return Result(r.returncode == 0, r.stdout or "", err, sent=True, why=None if r.returncode == 0 else "failed")
    finally:
        if path:
            os.unlink(path)
        if lock:
            lock.close()


def read(args, *, repo, ctx=None):
    """A read: Result. A read never needs the pace, only the check and the budget gate."""
    return call(args, repo=repo, ctx=ctx)


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
