"""Ready's push of a rebased branch (dmalis/shepherdr#97).

Twice ready's own push of a branch rebased onto its base was refused by GitHub with a bare "! [remote rejected] ...
(failed)", and the same push by hand a few seconds later went through. Its lease was right (the commit GitHub had);
GitHub gave no reason, a passing refusal on its side. Now a passing refusal is tried once more, after a fetch and a
short pause (push()); one that stays, or any other, says GitHub's own words, or that it gave none (said()). The lease
names the commit GitHub's branch is at whenever this clone had it as the branch's (lease_on()), as git's own
--force-if-includes reads the reflog: a stale tracking ref is no refusal, and a commit someone else pushed still is."""

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


def lease_on(wt, br, there, tracking, pushed):
    """There (the commit the remote branch is at, from ls-remote) when this clone had it as the branch's: its tracking
    ref, the commit Herdr pushed last, an ancestor of its tip (a fast-forward), or a commit its branch was at before a
    rebase (its reflog). None: a commit this clone never had (someone else's push), for the lease to refuse."""
    if not there:
        return None
    if there in (tracking, pushed) or git(wt, "merge-base", "--is-ancestor", there, f"refs/heads/{br}")[0]:
        return there
    ok, out, _ = git(wt, "reflog", "show", "--format=%H", f"refs/heads/{br}", "--")
    return there if ok and there in out.split() else None


def passing(out, err):
    """A refusal GitHub gave only for now: its bare "failed" (no "remote:" reason with it), a lock, a dropped link."""
    words = (out + "\n" + err).lower()
    if any(line.strip().startswith("remote:") and line.strip()[7:].strip() and "resolving deltas" not in line
           for line in words.splitlines()):
        return False  # GitHub said why (a rule, a hook, push protection): pushing again changes nothing
    return ("[remote rejected]" in words and any(x in words for x in REFUSED)) or any(x in words for x in LINK)


def push(wt, remote, ref, tip, args):
    """git push args; a passing refusal (passing()) fetched, then pushed once more after RETRY_S, the same lease:
    (ok, out, err, retried). A remote that has tip after all (the first push went through) is a push done."""
    ok, out, err = git(wt, "push", *args)
    if ok or not passing(out, err):
        return ok, out, err, False
    git(wt, "fetch", "-q", remote, ref)
    time.sleep(RETRY_S)
    seen, there, _ = git(wt, "ls-remote", remote, ref)
    if seen and there.split()[:1] == [tip]:
        return True, "", "", True
    ok, out, err = git(wt, "push", *args)
    return ok, out, err, True


def said(out, err, retried, lines):
    """A push that stayed refused, for ready to say: GitHub's own reason (its "remote:" lines, its word in brackets),
    or, when it gave none, that and what to do; then git's last lines (lines(), the hook's words too)."""
    raw = lines(out, err)
    words = (out + "\n" + err).lower()
    if "stale info" in words:
        return ("its branch on GitHub is at a commit this task never had (someone else pushed to it). Fetch it and look "
                "before pushing again; nothing was pushed.\n" + raw)
    if passing(out, err):
        return ("GitHub refused the push without giving a reason" + (", twice, a few seconds apart" if retried else "") +
                ". Nothing was pushed: run ready again in a minute.\n" + raw)
    return raw
