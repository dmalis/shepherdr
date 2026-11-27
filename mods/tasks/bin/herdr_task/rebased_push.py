"""Ready's push of a rebased branch (dmalis/shepherdr#97).

Twice ready's own push of a branch rebased onto its base was refused by GitHub with a bare "! [remote rejected] ...
(failed)", and the same push by hand a few seconds later went through. Its lease was right (the commit GitHub had);
GitHub gave no reason, a passing refusal on its side. Now a passing refusal is tried once more, after a fetch and a
short pause (push()); one that stays, or any other, says GitHub's own words, or that it gave none (said()). The lease
names the commit GitHub's branch is at whenever this task had it as its branch's (lease()), as git's own
--force-if-includes reads the reflog: a stale tracking ref is no refusal, and a commit someone else pushed still is."""

import re
import time


def git(cwd, *args):
    """github.git, the one its push and its tests go through."""
    from . import github
    return github.git(cwd, *args)


RETRY_S = 3  # GitHub's passing refusal was gone a few seconds later
# What a push refused only for now says: the remote's word for a ref it didn't update (GitHub's bare "failed", a ref it
# couldn't lock), or the link's (a dropped connection, a 5xx).
REFUSED = ("(failed)", "(failure)", "failed to lock", "cannot lock ref", "failed to update ref")
LINK = ("internal server error", "the remote end hung up unexpectedly", "rpc failed", "unexpected disconnect",
        "early eof", "returned error: 5")


def look_again(wt, remote, ref):
    """git ls-remote once more after RETRY_S, its first look having failed: (ok, out, err). Never the tracking ref
    instead: a fetch moves that to someone else's push."""
    time.sleep(RETRY_S)
    return git(wt, "ls-remote", remote, ref)


def had(wt, br, there, saved):
    """There (the commit the remote branch is at) is one this task had as its branch's: a commit Herdr saved as pushed
    there (saved), an ancestor of its tip (a fast-forward), or a commit its branch was at before a rebase (its reflog).
    Never its tracking ref alone: a fetch moves that."""
    if there in saved or git(wt, "merge-base", "--is-ancestor", there, f"refs/heads/{br}")[0]:
        return True
    ok, out, _ = git(wt, "reflog", "show", "--format=%H", f"refs/heads/{br}", "--")
    return ok and there in out.split()


def lease(wt, br, there, saved):
    """The commit its push leases on, there being the commit GitHub's branch is at: there itself when the task had it
    (had()); else, so git refuses it ("stale info": someone else pushed), the first commit Herdr saved as pushed there,
    or "" (its own branch: refused as not there; a pull request's it took: no lease, a fast-forward only). None when
    GitHub's branch isn't there (the caller's rule)."""
    if not there:
        return None
    saved = [x for x in saved if x]
    if had(wt, br, there, saved):
        return there
    return saved[0] if saved else ""


def reasons(out, err):
    """GitHub's own words in a push's answer: its "remote:" lines with something in them (progress left out)."""
    return [x.strip() for x in (out + "\n" + err).splitlines() if x.strip().lower().startswith("remote:")
            and x.strip()[7:].strip() and "resolving deltas" not in x.lower()]


def passing(out, err):
    """A refusal only for now: the link's (a dropped connection, a 5xx, whatever else it says), or the remote's bare
    word for a ref it didn't update (GitHub's "failed", a lock) with no reason given. A reason (a rule, a hook, push
    protection) is no passing one: pushing again changes nothing."""
    words = (out + "\n" + err).lower()
    if re.search(r"(returned error:|http) 4\d\d", words):
        return False  # GitHub said no (a 403, a 404): pushing again changes nothing
    if any(x in words for x in LINK):
        return True
    return "[remote rejected]" in words and any(x in words for x in REFUSED) and not reasons(out, err)


def push(wt, remote, ref, br, tip, args):
    """git push args; a passing refusal (passing()) fetched, then pushed once more after RETRY_S with the same lease,
    while its branch is still at tip (a commit made meanwhile is never pushed in its place): (ok, out, err, retried).
    A remote that has tip after all (the first push went through) is a push done."""
    ok, out, err = git(wt, "push", *args)
    if ok or not passing(out, err):
        return ok, out, err, False
    git(wt, "fetch", "-q", remote, ref)
    time.sleep(RETRY_S)
    seen, there, _ = git(wt, "ls-remote", remote, ref)
    if seen and there.split()[:1] == [tip]:
        return True, "", "", True
    if git(wt, "rev-parse", "--verify", "--quiet", f"refs/heads/{br}")[1] != tip:
        return ok, out, err, False
    ok, out, err = git(wt, "push", *args)
    return ok, out, err, True


def said(out, err, retried, lines):
    """A push that stayed refused, for ready to say: GitHub's own reason first (its "remote:" lines, never cut for
    the lines after them), or, when it gave none, that and what to do; then git's last lines (lines(): the hook's words
    too)."""
    raw = lines(out, err)
    why = reasons(out, err)
    words = (out + "\n" + err).lower()
    if "stale info" in words:
        return ("its branch on GitHub is at a commit this task never had (someone else pushed to it). Fetch it and look "
                "before pushing again; nothing was pushed.\n" + raw)
    if passing(out, err) and not why:
        return ("GitHub refused the push without giving a reason" + (", twice, a few seconds apart" if retried else "") +
                ". Nothing was pushed: run ready again in a minute.\n" + raw)
    if why and why[0] not in raw:
        return "\n".join(why[:15]) + "\n" + "\n".join(x for x in raw.splitlines() if x.strip() not in why)
    return raw
