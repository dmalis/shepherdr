"""What a task's agent is told about its hand-in and its suggested replies (dmalis/shepherdr#42). A hand-in either asks
the person something, and then the task really waits on them, or it asks nothing: never a "Decisions for you" list and
reply bubbles under a task that merges on its own. In the brief (launch.closing_line) and, as the session note, again
in every new or compacted session (reactions.agent_note): a compacted session once kept only "Suggested replies are
on" and wrote them as a plain list."""

HANDIN = ("A hand-in asks nothing: your ready summary and the message you end with after it carry no \"Decisions for "
          "you\" list, no question and no suggested replies, since the task then merges or waits for the person's Accept "
          "on its own. Optional follow-ups go in one plain line, \"Later, if you want: …\". When the person must decide "
          "something, ask with your CLI's question tool before ready and wait: the task shows under Needs you until "
          "they answer.")

FORM = ("Suggested replies (on in Settings): only when your message asks the person something, end it with one line "
        "per likely answer, each `<hc suggest=\"…\"/>` on a line of its own, last in the reply (at most 30 characters "
        "each). Never a \"Suggested replies:\" heading or a list: that shows as plain text.")

# a task's own agent: its terminal carries the task's label (launch.py)
TASK_LABEL = "herdr.task"


def is_task_agent(k):
    labels = (k or {}).get("labels") or {}
    return bool(labels.get(TASK_LABEL)) and labels.get("herdr.role") not in ("reviewer", "helper")


def suggestions_on(space=None, d=None):
    """Settings › Agents › Suggested replies for a space: its own, else Everywhere's, else on (as settings.py's line)."""
    from .settings import bare, read_settings
    d = read_settings() if d is None else d
    own = (d.get("spaces") or {}).get(bare(space)) if space else None
    for layer in (own, d.get("everywhere")):
        a = layer.get("agents") if isinstance(layer, dict) else None
        if isinstance(a, dict) and isinstance(a.get("suggestions"), bool):
            return a["suggestions"]
    return True


def session_words(k, on):
    """The session note's words for a task's own agent ("" for any other agent)."""
    if not is_task_agent(k):
        return ""
    return HANDIN + (" " + FORM if on else "")
