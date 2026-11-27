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


def waits_why(s, t, policy):
    """The one line its card shows on why it waits for the person."""
    if in_folder(t):
        return "Waits for you: it worked in the folder itself, not on a branch of its own, so only you can close it."
    if t.get("nothing_to_merge") and t.get("left_files"):
        names = ", ".join(t["left_files"][:3]) + (" and more" if len(t["left_files"]) > 3 else "")
        return f"Waits for you: it committed nothing but left new files ({names}); closing it deletes them."
    by = merge_source(s, t)
    return (f"Waits for you: {MERGE_FROM.get(by, 'Merge')} is {MERGE_NAMES.get(policy, policy)}"
            + (" (the default)" if by == "default" else "") + ".")


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
