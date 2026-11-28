"""A reviewer still on its CLI's start screen is waiting on the person, not frozen (dmalis/shepherdr#212).

Codex 0.172's folder-trust screen ("Folder access … Trust this folder?") and Claude Code's --add-dir one ("Is this a
directory you created or one you trust?") hold a reviewer before it reads its prompt, and herdr-core reports no status
for either. reviewers.py counted that as frozen after 5 minutes: it ended the reviewer and told its worker it "froze
before its first answer", so the worker started it again, switched CLI, then answered the next trust screen itself.

Now such a reviewer is left running and its worker hears once, at once, what it waits on and that the screen is the
person's to answer (Shepherdr's trust card, or its terminal). One that reported no status at all for START_MS on an
unchanged screen nobody recognises is told early too ("screen"), but stays bounded: still ended as frozen at
reviewers.FROZEN_MS, as before (a Codex "Working" that never moves can report no status). A notice still held for a
busy worker is withdrawn once its reviewer moved on (withdraw).
Nothing here presses a key or answers a screen (AGENTS.md "Nothing that risks a ban").
"""

from .agents import startup_reason, status_word

# Still the same screen this long and no status ever reported: it hasn't begun its session (both CLIs report working
# within seconds of reading their prompt).
START_MS = 90 * 1000
# What these verdicts are: the person's to answer, so the reviewer is never ended for them.
WAITS = ("startup", "screen")
CLI = {"codex": "Codex", "claude": "Claude Code"}


def cli_of(k):
    return (k.get("labels") or {}).get("herdr.agent") or ("codex" if "codex" in str(k.get("agent") or "") else "claude")


def start_screen(k, text):
    """("startup", its reason) while reviewer k shows a start screen the person answers (trust, hooks, sign-in), else
    None. Only before its session began: a reported status means it is past its start screens."""
    if status_word(k) not in (None, "", "blocked") or not text:
        return None
    reason = startup_reason(cli_of(k), text)
    return ("startup", reason) if reason else None


def before_session(k):
    """It has reported no status at all: still before its session (a start screen, or a slow start)."""
    return not status_word(k)


def message(k, why, words, end_ms=5 * 60 * 1000):
    """What its worker hears: what it waits on, that it is the person's, that it was left running and what to do."""
    name = k.get("name") or k["address"]
    cli = CLI.get(cli_of(k), "Its CLI")
    if why == "startup":
        return (f'Herdr: your reviewer {name} hasn\'t begun its review: {cli} is waiting on its start screen ("{words}") '
                "and hasn't read your prompt yet. That screen is the person's to answer: Shepherdr shows them a card for "
                "it under Needs you, and they can answer it in its terminal. Never press keys in it yourself, and don't "
                "start another reviewer to get around it: it would stop on the same kind of screen. I left it running. "
                f"Wait for it (`hc wait {name} --timeout 600`): it begins once they answer. If it ends because they said "
                "No, ask the person with your question tool how to review.")
    return (f"Herdr: your reviewer {name} hasn't begun its session: {cli}'s screen has stayed the same for "
            f"{START_MS // 1000} s before it read your prompt" + (f' (its last line: "{words}")' if words else "") + ". "
            "It may be waiting on a start screen (trust, hooks, imports or sign-in), which is the person's to answer: "
            f"read it (`hc read {name}`) and, if it asks something, tell the person \"Your reviewer is waiting on a "
            "startup screen; answer it in its terminal\", then wait again. Never press keys in it yourself. I left it "
            f"running for now; if its screen still hasn't changed {end_ms // 60000} minutes in, I'll end it as frozen. "
            f"If it shows no question, end it now (`hc kill {name}`) and start it once more; it is no review round.")


def withdraw(seen):
    """Drops the wait notice (message) still held for its worker (news.hold: a Codex worker busy in `hc wait` gets
    held messages only once it's idle): once the reviewer moved on, it would tell the worker of a screen that's gone.
    seen: the reviewer's kept state ({asked, parent, name}); its notice keys are cleared."""
    parent, name = seen.pop("parent", None), seen.pop("name", None)
    seen.pop("asked", None)
    if not parent or not name:
        return
    from .news import held_messages
    head = (f"Herdr: your reviewer {name} hasn't begun its review:", f"Herdr: your reviewer {name} hasn't begun its session:")
    with held_messages() as held:
        items = held.get(parent)
        if items:
            items[:] = [x for x in items if not str(x.get("text") or "").startswith(head)]
            if not items:
                held.pop(parent)
