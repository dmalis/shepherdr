"""A Ready task whose agent pushed a fix is told to say ready again (dmalis/shepherdr: Needs you only when it's yours).

A Ready task's failed checks go to its agent (ghnews.pr_news()), and that turn takes it back to Working
(tick.back_pass()). The agent fixes them, pushes its branch itself and ends its turn without running ready: the task
stayed Working with a quiet agent (tick.settle_back() takes it back to Ready only at the commit it said ready on), a
wait under Needs you with its agent's last line, until someone told it to say ready again. Now its agent hears it from
Herdr, once per commit, as GitHub news: ready then hands it in with every check it makes (review rounds, proof), and
Merge does the rest. Nothing is said to the person."""

import os

from .agents import last_question
from .base import git, now
from .news import news_send


def due(s, t, v):
    """The new commit its agent pushed while it was back at work from Ready, when it should say ready again now:
    its agent rests and asked nothing, its worktree is clean at that commit, and GitHub shows it as the pull
    request's head. Else None."""
    pr = t.get("pr") or {}
    if t.get("state") != "running" or not (t.get("back") or {}).get("auto") or t.get("stopped_by") or t.get("kept_open"):
        return None
    head = (v or {}).get("headRefOid") or ""
    if (v or {}).get("state") != "OPEN" or not head or head == t.get("head") or pr.get("again_told") == head:
        return None
    wt = t.get("worktree") if t.get("mode") == "worktree" else None
    if not wt or not os.path.isdir(wt):
        return None
    ok, here, _ = git(wt, "rev-parse", "HEAD")
    if not ok or here != head or git(wt, "status", "--porcelain", "--untracked-files=no")[1]:
        return None
    return head


def nudge(s, t, v, report):
    """Tells its resting agent once (due()) to run its ready command again. True when told."""
    head = due(s, t, v)
    if not head:
        return False
    from .ghnews import attr, esc, resting
    k = resting(s, t)
    if not k or last_question(t, k.get("address")):
        return False
    pr = t["pr"]
    text = (f"GitHub news on pull request #{pr.get('number')} ({pr.get('url') or ''}): your new commit {head[:9]} is on "
            "it, but the task is still Working since you went back to work, and it merges only after you run your "
            "ready command again. If your fix is done, run it now with your summary (ready waits for the checks "
            "itself). If you are still on it, carry on.")
    if not news_send(k["address"], f'<herdr-github task="{attr(s.ref(t))}" pr="{pr.get("number")}">{esc(text)}</herdr-github>'):
        return False
    pr["again_told"] = head
    t["handed_at"] = now()
    s.dirty = True
    report.setdefault("github", []).append({"task": s.ref(t), "ready_again": head[:9], "to": k["address"]})
    return True
