"""Why a Ready task waits for the person, and when a task with nothing to merge needs no one at all.

A task whose branch has no commits beyond its base (a check that found its bug already fixed, research, an artifact
only) follows the Merge setting like any other: with Right away or When all checks pass it is done at ready, no card,
and its Assistant hears what it found (news.py's "done" line). With When I mark it as done it waits for the person,
and its card says so. A task that worked in the folder itself always waits: its changes aren't apart from the
person's. Every Ready task that waits keeps one line, waits_why, that its card shows: what made it wait, and where that
setting comes from (herdr-task show's sources)."""

from .base import git
from .settings import setting_sources

# The Merge setting's names as Settings › Tasks › Merge shows them (web/src/settings.tsx).
MERGE_NAMES = {"ask": "When I mark it as done", "checks": "When all checks pass", "auto": "Right away"}
# Where a Merge value comes from (settings.setting_sources, or "task" for its own --set), as the card says it.
MERGE_FROM = {"task": "This task's Merge (set by its Assistant)", "repo": "Merge in this repo", "space": "Merge in this space",
              "machine": "Merge on this machine", "Everywhere": "Merge Everywhere", "default": "Merge"}


def merge_source(s, t):
    """Where this task's Merge comes from: "task", "repo", "space", "machine", "Everywhere" or "default"."""
    if "merge" in (t.get("set") or {}):
        return "task"
    return setting_sources(s, t.get("space")).get("tasks.merge", "default")


def left_files(wt):
    """New files left in its worktree that git doesn't ignore and nobody committed: closing the task deletes them
    (github.remove_worktree), so a task that left some is never closed on its own."""
    ok, out, _ = git(wt, "status", "--porcelain", "--untracked-files=all")
    return [line[3:] for line in out.splitlines() if line.startswith("?? ")] if ok else []


def closes_alone(t, policy):
    """A task in its own worktree with nothing to merge and nothing left uncommitted, and Merge says no one needs to
    look: done at ready."""
    return (bool(t.get("nothing_to_merge")) and t.get("mode") == "worktree" and not t.get("left_files")
            and policy in ("auto", "checks"))


def in_folder(t):
    return t.get("mode") != "worktree" or not t.get("worktree")


# Where the Merge rule that holds it comes from, said in a sentence (fork UI 15, dmalis/shepherdr#184): "in this repo,
# tasks merge only when you say so", never the setting's name and value.
MERGE_WHERE = {"repo": "in this repo", "space": "in this space", "machine": "on this machine",
               "Everywhere": "in every space", "default": "by default"}


def waits_why(s, t, policy, by=None):
    """The one line its card shows on why it waits for the person: what waits on them for this card's own action (a
    merge, a close with nothing to merge, a close that deletes the files it left, a folder's work to mark as done),
    then why, in a sentence (fork UI 15, dmalis/shepherdr#184)."""
    if in_folder(t):
        return "Waits for you to mark it as done: it worked in the folder itself, not on a branch of its own."
    if t.get("nothing_to_merge") and t.get("left_files"):
        names = ", ".join(t["left_files"][:3]) + (" and more" if len(t["left_files"]) > 3 else "")
        return f"Waits for you to close it: it left new files it didn't commit ({names}), and closing deletes them."
    close = bool(t.get("nothing_to_merge"))
    what = "Waits for you to close it" if close else "Waits for you to merge it"
    if policy != "ask":  # Right away or When all checks pass never hold it for the person: the action alone
        return what + "."
    by, verb = by or merge_source(s, t), "finish" if close else "merge"
    rule = (f"its Assistant set this one to {verb} only when you say so" if by == "task" else
            f"{MERGE_WHERE.get(by, 'here')}{'' if close else ','} tasks {verb} only when you say so")
    return f"{what}: " + ("it has nothing to merge, and " if close else "") + rule + "."


# The line a Ready card kept before fork UI 15: "Waits for you: Merge in this repo is When I mark it as done.", or
# "Waits for you: it worked in the folder itself…". The tick gives such a card the new line (renewed()).
OLD = "Waits for you: "


def renewed(s, t):
    """A Ready task's saved line in the old words, said again in the new ones, for the same Merge rule and source it
    named; else None."""
    old = t.get("waits_why") or ""
    if not old.startswith(OLD):
        return None
    by = next((k for k, v in MERGE_FROM.items() if old.startswith(f"{OLD}{v} is ")), None)
    policy = next((k for k, v in MERGE_NAMES.items() if f" is {v}" in old), None)
    if policy is None:
        from .settings import merge_policy
        policy = merge_policy(s, t)
    return waits_why(s, t, policy, by)


def closed_words(s, t, policy):
    """What ready says to the agent of a task closed this way."""
    by = merge_source(s, t)
    return (f"{s.name(t)} is done: nothing to merge (no commits beyond its base), and {MERGE_FROM.get(by, 'Merge')} is "
            f"{MERGE_NAMES.get(policy, policy)}, so it closed without a card. Its summary goes to its Assistant. End your turn.")


def waits_now(s, t):
    """Why a Ready task kept no why line (it said ready before there was one) waits, when that is still true now:
    it works in the folder itself, or Merge is When I mark it as done and nothing else will merge it; else None."""
    from .settings import merge_policy
    if t.get("auto_merge") or t.get("merge_requested") or t.get("attention"):
        return None
    policy = merge_policy(s, t)
    return waits_why(s, t, policy) if in_folder(t) or policy == "ask" else None
