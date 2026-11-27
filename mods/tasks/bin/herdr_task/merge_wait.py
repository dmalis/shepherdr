"""A merge right after a push waits for GitHub to catch up (dmalis/shepherdr#74).

A task handed in again right after a rebase was merged at once: GitHub's view of its pull request could still show the
commit before the push (its merge refused: "Head branch was modified"), or the new commit with a green optional check
while a check its base branch requires isn't listed yet (not pending: absent, so BLOCKED with everything it lists
green). Both sent the task back to its agent as a failed merge. Now a merge is pinned to the commit Herdr pushed
(task["pushed"], kept by pr_push()), and until GitHub shows that commit with its required checks it waits, a bounded
while; the scheduler's retry carries on. What stays unexplained past that is still said, and GitHub never merges
before the required checks pass on the commit it merges."""

import json
from urllib.parse import quote

from . import github

WAITING = "Waiting for GitHub's checks."
HEAD_WAIT_MS = 5 * 60000  # GitHub's view shows the commit pushed within this; after it, the other commit is said
BLOCKED_WAIT_MS = 5 * 60000  # BLOCKED with every check it lists green and none named missing: this long, then merged
# (GitHub's refusal then said: another rule may block it). A required check named and not listed: CHECKS_START_MS.


def pinned(task, v):
    """The commit its merge is pinned to: the one Herdr pushed for it, else the head GitHub shows."""
    return (task.get("pushed") or {}).get("sha") or v.get("headRefOid") or ""


def head_waits(task, v):
    """GitHub's view (v) not at the commit pushed: WAITING for HEAD_WAIT_MS after the push, then what to say. None when
    it is there, or nothing was pushed by Herdr."""
    p, head = task.get("pushed") or {}, v.get("headRefOid")
    if not p.get("sha") or head == p["sha"]:
        return None
    if github.now() - (p.get("at") or 0) < HEAD_WAIT_MS:
        return WAITING
    return (f"its pull request is at {(head or 'no commit')[:9]} on GitHub, not at {p['sha'][:9]}, the commit pushed "
            "for it. Run ready again to push its branch.")


# dmalis/shepherdr#97: right after a push GitHub works out whether the pull request merges, and meanwhile says UNKNOWN,
# or for a few seconds still CONFLICTING, the answer it had for the commit before a rebase. Ready then sent a cleanly
# rebased task to Fixing for a conflict that wasn't there.
MERGEABLE_WAIT_MS = 2 * 60000  # GitHub's answer for the commit pushed comes within this; after it, what it says stands


def merges_here(s, task, head):
    """Its head merges into its base's newest here (fetched first): True when the base is in it or a real merge of the two
    is clean, False when that merge conflicts, None when this git can't say (no base, an old git without merge-tree)."""
    main = s.loc["folder"]
    ref = github.base_tip_ref(s, task, fetch=True)
    if not ref or not head:
        return None
    if github.git(main, "merge-base", "--is-ancestor", ref, head)[0]:
        return True
    r = github.run(["git", "-C", main, "merge-tree", "--write-tree", "--no-messages", ref, head])
    return True if r.returncode == 0 else False if r.returncode == 1 else None


def mergeable_waits(s, task, v):
    """True while GitHub's view (v), at the commit Herdr just pushed, hasn't worked out yet whether it merges: UNKNOWN,
    or CONFLICTING while it merges cleanly here (merges_here()). Only within MERGEABLE_WAIT_MS of the push; a conflict
    git finds too, or one GitHub keeps saying past that, is a conflict."""
    p, said = task.get("pushed") or {}, (v.get("mergeable") or "").upper()
    if said not in ("UNKNOWN", "CONFLICTING") or v.get("state") != "OPEN" or not p.get("sha") or v.get("headRefOid") != p["sha"]:
        return False
    if github.now() - (p.get("at") or 0) >= MERGEABLE_WAIT_MS:
        return False
    return said != "CONFLICTING" or merges_here(s, task, p["sha"]) is True


def mergeable_now(s, task, v):
    """v as the tick reads it: CONFLICTING that is only GitHub catching up (mergeable_waits()) reads UNKNOWN, so nothing
    sends it back to its agent; it waits as any UNKNOWN does (github.pr_wait())."""
    if (v.get("mergeable") or "").upper() == "CONFLICTING" and mergeable_waits(s, task, v):
        return {**v, "mergeable": "UNKNOWN"}
    return v


def _json(out):
    try:
        return json.loads(out)
    except ValueError:
        return None


def required_names(repo, base):
    """The checks its base branch requires (its rulesets, its branch protection), named even before GitHub lists them on
    a commit; None when GitHub couldn't say."""
    if not repo:
        return None
    names, read, b = set(), False, quote(base, safe="")
    ok, out, _ = github.gh("api", f"repos/{repo}/rules/branches/{b}")
    rules = _json(out) if ok else None
    if isinstance(rules, list):
        read = True
        for r in rules:
            if isinstance(r, dict) and r.get("type") == "required_status_checks":
                names |= {c.get("context") for c in (r.get("parameters") or {}).get("required_status_checks") or []
                          if isinstance(c, dict)}
    ok, out, _ = github.gh("api", f"repos/{repo}/branches/{b}")
    found = _json(out) if ok else None
    if isinstance(found, dict):
        read = True
        rsc = (found.get("protection") or {}).get("required_status_checks") or {}
        if rsc.get("enforcement_level") != "off":
            names |= set(rsc.get("contexts") or []) | {c.get("context") for c in rsc.get("checks") or [] if isinstance(c, dict)}
    names.discard(None)
    return names if read else None


def missing_required(task, v):
    """The required checks GitHub doesn't list on its pull request's head yet ([] none), or None when it can't say."""
    names = required_names((task.get("pr") or {}).get("repo"), task.get("base") or "main")
    if names is None:
        return None
    listed = {c.get("name") or c.get("context") for c in v.get("statusCheckRollup") or []} | set(v.get("optional_checks") or [])
    return sorted(names - listed)


def blocked(v):
    """GitHub blocks the merge while every check it lists has settled and no review holds it: a required check that
    isn't there yet, or another rule."""
    return (v.get("state") == "OPEN" and v.get("mergeStateStatus") == "BLOCKED" and not github.needs_approval(v)
            and bool(v.get("statusCheckRollup") or v.get("optional_checks")) and not v.get("checks_unknown")
            and not github.pr_pending(v))


def blocked_waits(s, task, v):
    """Its merge waits (True) while GitHub blocks it at a commit it only just showed: CHECKS_START_MS for a required
    check not listed yet, BLOCKED_WAIT_MS for a block nothing names."""
    if not blocked(v):
        return False
    gone = github.now() - github.checks_since(s, task, v)
    if gone < BLOCKED_WAIT_MS:
        return True
    return gone < github.CHECKS_START_MS and bool(missing_required(task, v))


def after_refusal(s, task, again, err):
    """A merge GitHub refused, read again (again: a fresh pr_view): True when it only waits on GitHub catching up (its
    checks run, a required one isn't listed yet, its head isn't the commit pushed yet); False: a refusal to say."""
    if not again or again.get("state") != "OPEN":
        return False
    again = github.merge_checks(task, again, now_=task.get("auto_merge") == "auto")
    if github.pr_pending(again) or head_waits(task, again) == WAITING:
        return True
    p = task.get("pushed") or {}
    if "head branch was modified" in (err or "").lower() and p.get("sha") and github.now() - (p.get("at") or 0) < HEAD_WAIT_MS:
        return True
    since = github.checks_since(s, task, again)
    if github.checks_missing(again, since) == "waiting":
        return True  # none listed yet while some will come (an empty BLOCKED: a required one), as before its merge
    if blocked(again):
        return github.now() - since < github.CHECKS_START_MS and bool(missing_required(task, again))
    return False
