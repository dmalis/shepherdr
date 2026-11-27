"""Work after a merge (dmalis/shepherdr#48). A task whose change merged is done, and stays done: a message to it reaches
its agent, and what that agent commits on the branch afterwards never turns it back into Working (a second pull request
for a merged one is refused, GitHub's #1497). Those commits are offered instead: the task keeps them as after_merge
({n, commits, tip, on_main, follow_up}), its card says "1 change after the merge", and `herdr-task follow-up` adds and
starts a new task from its base with them cherry-picked on top, titled from them. Main already holding the same
change (git cherry's patch-ids, or merging them would change nothing) is "Already on main", and nothing is offered.

A task stuck before this (reopened after its merge, its ready refused for a second pull request: Working again for
good) is done again at the next tick (unstick())."""

import os
import shlex
import shutil
import tempfile

from .base import Fail, git, now
from .agents import fit

LOOK_EVERY = 20000          # a Done task's branch looked at again at most this often (only its tip and base read)
ASK_EVERY = 10 * 60000      # GitHub asked again for the commit that merged, at most this often
MOST = 20                   # commits kept on the task (the count is all of them)
TITLE_MAX = 60
# the refusal of a second pull request for a merged one (github.pr_push): the stuck task's attention
STUCK = "is already merged (GitHub deleted its branch)"


def _rev(folder, ref):
    ok, out, _ = git(folder, "rev-parse", "--verify", "--quiet", ref)
    return out if ok and out else None


def _in(folder, a, b):
    return git(folder, "merge-base", "--is-ancestor", a, b)[0]


def upstream(s, t):
    """Its base as the remote has it (what merged went there), else the local branch."""
    from .github import remote_of
    main, base = s.loc["folder"], t.get("base") or "main"
    theirs = f"refs/remotes/{remote_of(main)}/{base}"
    return theirs if _rev(main, theirs) else base


def note_merged(s, t):
    """At finish: the commit that merged (its branch's tip then), so what comes after it on the branch is known."""
    if t.get("merged") and not t.get("merged_head"):
        from .github import last_tip
        tip = last_tip(s, t)
        if tip:
            t["merged_head"] = tip


def merged_head(s, t, ask=False):
    """The commit its change merged at: GitHub's word for its pull request, else the tip kept when it finished."""
    pr = t.get("pr") or {}
    if t.get("merged_head") and (t.get("merged_head_by") == "github" or not pr.get("number")):
        return t["merged_head"]
    if ask and pr.get("number") and pr.get("repo") and now() - (t.get("merged_head_asked") or 0) >= ASK_EVERY:
        from .github import pr_view
        t["merged_head_asked"] = now()
        s.dirty = True
        v = pr_view(t)
        if v and v.get("state") == "MERGED" and v.get("headRefOid"):
            t["merged_head"], t["merged_head_by"] = v["headRefOid"], "github"
            t.pop("merged_head_asked", None)
    return t.get("merged_head")


def left_after(s, t, ask=False, most=MOST):
    """The commits on its branch after its change merged: {n, commits: [{sha, s}], tip, on_main}, or None (none, no
    branch, or the merged commit unknown for a pull request: a squash merge leaves nothing else to tell by)."""
    main, br = s.loc["folder"], t.get("branch")
    if t.get("mode") != "worktree" or not br:
        return None
    tip = _rev(main, f"refs/heads/{br}")
    if not tip:
        return None
    up = upstream(s, t)
    head = merged_head(s, t, ask)
    carried = ((t.get("after_merge") or {}).get("follow_up") or {}).get("tip")
    if carried and tip == carried:
        return None
    if carried and _in(main, carried, tip):
        since = carried
    elif head:
        if tip == head or _in(main, tip, head):
            return None
        # its branch rebased since (onto its base, say): what isn't in the base is what came after
        since = head if _in(main, head, tip) else up
    elif (t.get("pr") or {}).get("number"):
        return None
    else:
        since = up  # merged here, its own commits in the base: whatever isn't came after
    ok, out, _ = git(main, "cherry", "-v", up, tip, since)
    rows = [ln.split(" ", 2) for ln in out.splitlines() if ln[:2] in ("+ ", "- ")] if ok else []
    if not rows:
        return None
    new = [{"sha": r[1], "s": r[2] if len(r) > 2 else ""} for r in rows if r[0] == "+"]
    on_main = not new or _merges_to_nothing(main, up, tip)
    shown = new if not on_main else [{"sha": r[1], "s": r[2] if len(r) > 2 else ""} for r in rows]
    return {"n": len(shown), "commits": shown[:most] if most else shown, "tip": tip, "on_main": on_main}


def _merges_to_nothing(main, up, tip):
    """Merging its tip into the base would change nothing (its later commits squash-merged by another task)."""
    ok, tree, _ = git(main, "merge-tree", "--write-tree", up, tip)
    have = _rev(main, f"{up}^{{tree}}")
    return bool(ok and tree and have and tree.split()[0] == have)


def record(s, t, ask=False, force=False):
    """Keeps after_merge on a merged Done task up to date (cheap: only its tip and base are read while neither
    moved). Returns it, or None."""
    if not t.get("merged") or t.get("state") != "done":
        return None
    main = s.loc["folder"]
    br = t.get("branch")
    tip = _rev(main, f"refs/heads/{br}") if br else None
    key = f"{tip}:{_rev(main, upstream(s, t)) if tip else ''}"
    had = t.get("after_merge")
    if not force and (t.get("after_merge_key") == key):
        return had
    got = left_after(s, t, ask)
    follow = (had or {}).get("follow_up")
    if got is None and follow and follow.get("tip") == tip:
        got = {k: had[k] for k in ("n", "commits", "tip", "on_main") if k in had}  # carried by its follow-up: still said
    if got is not None and follow:
        got["follow_up"] = follow
    if got != had:
        if got is None:
            t.pop("after_merge", None)
        else:
            t["after_merge"] = got
    t["after_merge_key"] = key
    s.dirty = True
    return got


def unsaved(s, t):
    """Commits after its merge that only its branch holds (none on its base, no follow-up has them): its worktree and
    branch are kept (github.tidy_done)."""
    got = left_after(s, t)
    return bool(got and not got["on_main"])


def watch(s, t, report):
    """The tick: a merged Done task whose worktree is still there, its branch looked at (its agent may commit there
    after a message)."""
    if t.get("state") != "done" or not t.get("merged") or t.get("archived") or t.get("mode") != "worktree":
        return
    wt = t.get("worktree")
    if not wt or not os.path.isdir(wt) or now() - (t.get("after_merge_looked") or 0) < LOOK_EVERY:
        return
    t["after_merge_looked"] = now()
    had = t.get("after_merge")
    got = record(s, t, ask=True)
    if got and got != had and not got.get("on_main") and not got.get("follow_up"):
        report.setdefault("after_merge", []).append({"task": s.ref(t), "commits": got["n"]})


def close(s, t):
    """Done again, merged (its pull request merged before): never Working again. Its worktree stays while its agent
    runs or its later commits are only there (tidy_done)."""
    t["merged"] = True
    t["state"], t["done_at"] = "done", now()
    for k in ("attention", "attention_at", "attention_head", "merge_requested", "queue", "queued_at", "merge_queued",
              "kept_open", "merge_failed", "merge_failed_at", "merge_asked", "auto_merge", "ready_turns", "back",
              "progress", "handed_at", "fix_requested", "review_out", "waits_why", "nothing_to_merge", "stopped_by",
              "stopped_why", "stopped_at", "stopped_turns", "after_merge_key"):
        t.pop(k, None)
    s.dirty = True
    return record(s, t, ask=True, force=True)


def merged_before(s, t):
    """At ready: its own pull request merged already and its branch has commits since (ready would push a second one,
    refused): done again, its later commits offered. Returns after_merge ({} when none is left), or None."""
    pr = t.get("pr") or {}
    if not pr.get("number") or not pr.get("repo"):
        return None
    from .github import pr_view
    v = pr_view(t)
    head = (v or {}).get("headRefOid")
    if not v or v.get("state") != "MERGED" or not head:
        return None
    main, br = s.loc["folder"], t.get("branch")
    tip = _rev(main, f"refs/heads/{br}") if br else None
    if not tip or tip == head or _in(main, tip, head):
        return None  # nothing since: merged at its tip (ready finishes it as any merged task)
    t["merged_head"], t["merged_head_by"] = head, "github"
    return close(s, t) or {}


def unstick(s, t, report):
    """The tick: a task left Working again by a refused second pull request (before #48) is done again."""
    if t.get("state") not in ("running", "ready") or STUCK not in str(t.get("attention") or ""):
        return
    if now() - (t.get("unstick_looked") or 0) < ASK_EVERY:
        return
    t["unstick_looked"] = now()
    s.dirty = True
    if merged_before(s, t) is not None:
        t.pop("unstick_looked", None)
        report["done"].append(t["id"])


def counted(n):
    return f"{n} {'change' if n == 1 else 'changes'}"


def follow_up_command(s, t):
    from .launch import own_path
    return f"`{own_path()} follow-up {s.ref(t)} --folder {shlex.quote(s.loc['folder'])}`"


def ready_words(s, t, got):
    """What ready says to an agent whose task merged already, its later commits now offered."""
    pr = t.get("pr") or {}
    lead = (f"Pull request #{pr['number']} already merged, so {s.name(t)} is done and stays done"
            if pr.get("number") else f"{s.name(t)}'s change already merged: it is done and stays done")
    if not got:
        return lead + ". Nothing on its branch came after it. End your turn."
    if got.get("follow_up"):
        return lead + f". Its follow-up task {fit(got['follow_up'].get('title'), TITLE_MAX)} carries its later commits. End your turn."
    if got["on_main"]:
        return lead + f". Its {counted(got['n'])} since {'is' if got['n'] == 1 else 'are'} already on {t.get('base') or 'main'}: nothing to carry. End your turn."
    subjects = "; ".join(f"\"{c['s']}\"" for c in got["commits"][:3]) + (" and more" if got["n"] > 3 else "")
    return (lead + f", never a second pull request. Its branch has {counted(got['n'])} since that {t.get('base') or 'main'} "
            f"doesn't have ({subjects}). Start a follow-up task that carries {'it' if got['n'] == 1 else 'them'} from "
            f"{t.get('base') or 'main'}: {follow_up_command(s, t)}. Its card offers the same to the person.")


def reply_note(s, t):
    """Said to a merged Done task's agent under the person's message: the task stays done."""
    return (f"(Herdr: {s.name(t)} is done, its change merged, and it stays done. Commits you make on its branch now are "
            f"offered to the person as a follow-up task; to start it yourself once they're committed: {follow_up_command(s, t)}.)")


def follow_title(got):
    first = fit(got["commits"][0]["s"] or "Follow-up", TITLE_MAX)
    return first if got["n"] == 1 else fit(f"{first} and {got['n'] - 1} more", TITLE_MAX)


def follow_prompt(s, t, got, base, picked, conflict):
    lines = "\n".join(f"- {c['sha'][:9]} {c['s']}" for c in got["commits"])
    ref = s.ref(t)
    how = (f"This task's branch starts from {base}'s newest with {'it' if got['n'] == 1 else 'them'} cherry-picked on top."
           if picked else
           f"Herdr couldn't cherry-pick {'it' if got['n'] == 1 else 'them'} onto {base}'s newest"
           + (f" (conflicts in {', '.join(conflict[:8])})" if conflict else "") +
           f", so this branch starts from {base} alone: carry them over yourself with `git cherry-pick "
           f"{' '.join(c['sha'] for c in got['commits'])}`, resolving what collides.")
    return (f"A follow-up to {s.name(t)} ({ref}): its pull request merged, and its branch {t.get('branch')} got "
            f"{counted(got['n'])} after that, not on {base} yet:\n{lines}\n\n{how} Check that they still fit {base} as it "
            f"is now, run the tests for what they touch, and hand it in as usual.")


def carry(main, start, shas, branch):
    """Makes `branch` at `start` with `shas` cherry-picked on top, in a scratch worktree of its own (the task's own
    worktree is made at its start, as any task's, so its setup runs there). Returns (picked, conflicting files)."""
    tmp = tempfile.mkdtemp(prefix="herdr-follow-up-")
    path = os.path.join(tmp, "w")
    try:
        ok, _, err = git(main, "worktree", "add", "--quiet", "--no-track", "-b", branch, path, start)
        if not ok:
            raise Fail(f"Couldn't make the follow-up's branch {branch}: {err}")
        ok, _, _ = git(path, "cherry-pick", "--allow-empty", *shas)
        if ok:
            return True, []
        files = git(path, "diff", "--name-only", "--diff-filter=U")[1].split()
        git(path, "cherry-pick", "--abort")
        git(path, "reset", "--quiet", "--hard", start)
        return False, files
    finally:
        git(main, "worktree", "remove", "--force", path)
        shutil.rmtree(tmp, ignore_errors=True)
        git(main, "worktree", "prune")


def cmd_follow_up(args):
    """A merged task's commits after its merge, as a new task from its base (above): added and started (or queued, as
    start would)."""
    from .commands import begin
    from .launch import branch_for, default_space, fresh_start
    from .output import say, view
    from .queues import queue_reason
    from .settings import check_automatic_agent, worker_argv
    from .store import open_store
    with open_store(args) as s:
        t = s.find(args.id)
        if t["state"] != "done" or not t.get("merged"):
            raise Fail(f"{s.name(t)} hasn't merged yet: what's on its branch goes in with its own ready.")
        got = record(s, t, ask=True, force=True)
        if not got:
            raise Fail(f"Nothing on {s.name(t)}'s branch came after its merge.")
        if got.get("follow_up"):
            raise Fail(f"Its follow-up {got['follow_up'].get('title')} ({got['follow_up'].get('ref')}) has them already.")
        if got["on_main"]:
            raise Fail(f"Already on {t.get('base') or 'main'}: {s.name(t)}'s {counted(got['n'])} after its merge {'is' if got['n'] == 1 else 'are'} there. Nothing to carry.")
        main, base = s.loc["folder"], t.get("base") or "main"
        title = follow_title(got)
        n = s.new(title, "", "worktree")
        space = t.get("space") or default_space()
        if t.get("space"):
            n["space"] = t["space"]
        if t.get("base_set"):
            n["base"], n["base_set"], n["base_by"] = t["base"], True, t.get("base_by") or "task"
        else:
            n["base"] = base
        n["follows"] = s.ref(t)
        start = fresh_start(main, base)
        n["start"] = _rev(main, start)
        branch = branch_for(s, n)
        n["branch"] = branch
        every = left_after(s, t, most=None) or got
        picked, conflict = carry(main, n["start"], [c["sha"] for c in every["commits"]], branch)
        n["prompt"] = follow_prompt(s, t, got, base, picked, conflict)
        t["after_merge"]["follow_up"] = {"id": n["id"], "ref": s.ref(n), "title": title, "tip": got["tip"], "at": now()}
        s.dirty = True
        argv = worker_argv(s, n, space)
        check_automatic_agent(argv)
        reason = queue_reason(s, n)
        if reason:
            n["state"], n["queued_at"] = "queued", now()
            n["queue"] = {"argv": argv, "space": space, "parent": None}
        else:
            begin(s, n, argv, space)
        v = view(s, n)
    words = (f"Follow-up {s.name(n)} added (its key, for commands only: {s.ref(n)}), from {base} with "
             f"{counted(got['n'])} of {s.name(t)}" + (" cherry-picked" if picked else ": they didn't cherry-pick cleanly, its agent carries them")
             + (f"; queued ({reason})." if reason else "; started."))
    say(args, {**v, "follows": s.ref(t), "picked": picked, **({"conflict": conflict} if conflict else {})}, words)
