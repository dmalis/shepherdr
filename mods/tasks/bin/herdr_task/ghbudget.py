"""GitHub's request limit (dmalis/shepherdr#201): the account's hourly budget, shared by every task, agent and tool
signed in to it (5000 REST calls an hour, and 5000 GraphQL points apart from it). Herdr's own reads slow down while
little is left, and none goes out once GitHub said the limit was reached, until the hour resets; a refusal for the
limit is never a task's failure (its merge waits for the reset, commands.merge_now()).

What is left is read only from GitHub's documented answers: `gh api rate_limit` (which never counts against the limit)
and the GraphQL rateLimit field of Herdr's own batched read (github.pr_views()). Kept per machine in the store."""

import json
import os
import time

from .base import now, run

LIMIT = "GitHub's request limit"   # the words every wait for it starts with (merge_waits())
LOOK_EVERY = 5 * 60000              # how often the REST budget is read while Herdr reads GitHub (rate_limit is free)
SECONDARY_WAIT = 60000              # a secondary limit names no reset: GitHub's docs say wait at least a minute
LOW, VERY_LOW = 0.25, 0.10          # left of the hour's budget: reads twice, then four times as far apart
# gh's words for GitHub's refusal over the limit (REST: HTTP 403/429 "API rate limit exceeded"; GraphQL: "API rate
# limit already exceeded"; "You have exceeded a secondary rate limit")
WORDS = ("rate limit exceeded", "rate limit already exceeded", "secondary rate limit", "exceeded a rate limit",
         "http 429", "too many requests")


def path():
    from . import github
    return os.path.join(github.STORE, ".github-budget.json")


def read():
    try:
        with open(path()) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def write(d):
    p = path()
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = f"{p}.{os.getpid()}.tmp"
        with open(tmp, "w") as f:
            json.dump(d, f)
        os.replace(tmp, p)
    except OSError:
        pass  # a read-only store: no budget kept, every call goes as before


def limited(err):
    """gh's error says GitHub refused for the request limit (primary or secondary), or it is Herdr's own wait for it."""
    e = (err or "").lower()
    return e.startswith(LIMIT.lower()) or any(w in e for w in WORDS)


def resource(args):
    """Which of the hour's budgets a gh call spends: "graphql" (gh pr/issue/repo commands, gh api graphql) or "core"
    (every other REST call: gh api <path>, gh run)."""
    a = [str(x) for x in args]
    if a[:1] in (["pr"], ["issue"], ["repo"]) or a[:2] == ["api", "graphql"]:
        return "graphql"
    return "core"


def free(args):
    return [str(x) for x in args[:2]] == ["api", "rate_limit"]


def held(args):
    """The time (ms) its budget resets when GitHub said it ran out and the hour hasn't reset yet, else None."""
    if free(args):
        return None
    until = (read().get(resource(args)) or {}).get("until") or 0
    return until if until > now() else None


def clock(ms):
    """A time for the person, in this machine's local time: 04:40."""
    return time.strftime("%H:%M", time.localtime(ms / 1000))


def wait_words(until=None):
    """The merge's wait, for its card and its agent: "GitHub's request limit: merging at 04:40"."""
    until = until or reset_at()
    return f"{LIMIT}: merging at {clock(until)}" if until else f"{LIMIT}: merging once it resets"


def held_err(until):
    return f"{LIMIT}: no call to GitHub until {clock(until)}, when its hourly limit resets"


def reset_at():
    """When the budget that ran out resets (ms), the later of the two; None while neither is out."""
    d = read()
    times = [(d.get(r) or {}).get("until") or 0 for r in ("core", "graphql")]
    later = max(times)
    return later if later > now() else None


def rate_limit():
    """GitHub's documented rate_limit answer ({"core": {...}, "graphql": {...}}), or None. Never counts against it."""
    from .github import GH
    try:
        r = run([GH, "api", "rate_limit"])
    except FileNotFoundError:
        return None
    try:
        res = json.loads(r.stdout).get("resources") if r.returncode == 0 else None
    except (ValueError, AttributeError):
        return None
    return res if isinstance(res, dict) else None


def keep(res, d=None):
    """Notes what GitHub said is left ({"core": {"limit", "remaining", "reset" (s)}, ...}) in the budget file."""
    d = read() if d is None else d
    for name in ("core", "graphql"):
        r = res.get(name)
        if not isinstance(r, dict) or not isinstance(r.get("remaining"), int):
            continue
        b = d.setdefault(name, {})
        b.update({"limit": r.get("limit") or b.get("limit") or 5000, "remaining": r["remaining"], "at": now()})
        reset = int(r.get("reset") or 0) * 1000
        if reset:
            b["reset"] = reset
        if r["remaining"] <= 0 and reset > now():
            b["until"] = reset
        elif (b.get("until") or 0) > now() and r["remaining"] > 0:
            b.pop("until")  # it reset early, or a secondary wait is over
    write(d)
    return d


def refused(args, err):
    """GitHub refused a call for the limit: no call that spends the same budget goes out until it resets (read from
    rate_limit; a secondary limit, which names no reset: a minute)."""
    name = resource(args)
    d = read()
    res = rate_limit()
    if res:
        d = keep(res, d)
    b = d.setdefault(name, {})
    if (b.get("until") or 0) <= now():
        b["until"] = now() + SECONDARY_WAIT
    write(d)


def look():
    """The REST budget read from GitHub every LOOK_EVERY while Herdr reads it (the tick's prefetch): free."""
    d = read()
    if now() - ((d.get("core") or {}).get("at") or 0) < LOOK_EVERY:
        return
    res = rate_limit()
    if res:
        keep(res, d)
    else:
        d.setdefault("core", {})["at"] = now()  # couldn't say: asked again later, not every pass
        write(d)


def graphql_left(rl):
    """The GraphQL rateLimit field of Herdr's own query ({"limit", "remaining", "resetAt"}), noted."""
    if not isinstance(rl, dict) or not isinstance(rl.get("remaining"), int):
        return
    import datetime
    try:
        reset = int(datetime.datetime.strptime(str(rl.get("resetAt")), "%Y-%m-%dT%H:%M:%SZ")
                    .replace(tzinfo=datetime.timezone.utc).timestamp())
    except ValueError:
        reset = 0
    keep({"graphql": {"limit": rl.get("limit"), "remaining": rl["remaining"], "reset": reset}})


def slow():
    """How many times further apart Herdr's reads of GitHub go now: 1, or 2 and 4 while little of either budget is left
    (LOW, VERY_LOW) until it resets."""
    d, factor = read(), 1
    for name in ("core", "graphql"):
        b = d.get(name) or {}
        if not b.get("limit") or not isinstance(b.get("remaining"), int) or (b.get("reset") or 0) <= now():
            continue
        left = b["remaining"] / b["limit"]
        factor = max(factor, 4 if left < VERY_LOW else 2 if left < LOW else 1)
    return factor


NO_WATCH = ("GitHub's request limit is the account's, shared by every task and agent: don't watch GitHub runs or checks "
            "yourself (no `gh run watch`, `gh pr checks --watch` or a loop that polls): after you say ready, Herdr reads your "
            "pull request's checks and tells you when one fails. A wait that must happen (a run outside your pull request) "
            "uses `--interval 60` or more.")


def brief_line(s, task):
    """dmalis/shepherdr#201: a task in a GitHub repo hears, in its brief, not to watch GitHub itself (a gh run watch polls
    every 3 s by default, several calls each time); None elsewhere."""
    from . import github
    if task.get("mode") != "worktree" or s.loc.get("kind") != "repo":
        return None
    known = (s.data.get("github") or {}).get("repo")
    return NO_WATCH if known or github.on_github(s.loc["folder"]) else None


def every(ms):
    """An interval between reads of GitHub, stretched while little of the budget is left (slow())."""
    return ms * slow()
