"""Asking the person (dmalis/shepherdr, "Shepherdr's asks in Needs you"): a space's Shepherdr that waits on the person
asks with its CLI's question tool, a card that shows under Needs you and can be answered from anywhere, never only in
plain chat words, which can go unseen.

Delivered as one row of Shepherdr's settings note (assistant_settings.rows), as urgent.py's is, so upstream's
templates/assistant.md stays as it is. No setting sets it. The service also shows a plain-words ask under Needs you
(web/shared/plain-ask.ts) for one that slips through."""

# The settings note's row, for every Shepherdr chat
KEY, LABEL = "asking", "Asking the person"
TEXT = ("when you wait on the person for a decision or an answer, ask with your question tool (Claude Code: "
        "AskUserQuestion), a card that shows under Needs you and can be answered from anywhere, never only in plain chat "
        "words: reply bubbles don't replace it. This holds for optional choices too, such as what to work on next once "
        "everything is done: name the choice on the card, your recommendation first. Only if your CLI has no such tool, "
        "end your message with one full question.")
NOTICE = f"New in Shepherdr: {LABEL}: {TEXT}"


def row():
    """assistant_settings.rows' line: (key, label, text, value, parts). No setting sets it."""
    return (KEY, LABEL, TEXT, "on", [])


def for_running(changed, k):
    """settings_pass, the whole block (it goes anyway): this row only to a chat whose agent is running now, never to one
    a shell is in front of (its next start's settings note has the row). The other rows as they are; None when nothing
    is left."""
    if not changed or not any(r.get("key") == KEY for r in changed):
        return changed
    from .urgent import running
    if running(k):
        return changed
    return [r for r in changed if r.get("key") != KEY] or None


def not_alone(changed, k):
    """settings_pass, the rows that changed: this row never sends a message of its own, so it can never reach or start
    again a chat that is stopped or about to be (its next start's settings note has the row). It rides along only when
    another row goes to a running agent anyway; alone, it is just noted ([]: labelled, nothing sent). changed may be
    None already (urgent.for_running)."""
    if not changed or not any(r.get("key") == KEY for r in changed):
        return changed
    from .urgent import running
    rest = [r for r in changed if r.get("key") != KEY]
    return changed if rest and running(k) else rest
