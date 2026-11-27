"""dmalis/shepherdr#45: a task's prompt answered, told to its Assistant.

herdr-core tells a task's Assistant at once that its worker is "blocked (permission)" (its own note to a parent). The
prompt is often answered before the person or the Assistant gets there: on a card, in the terminal pane, anywhere. The
news pass's own "working again" line needs a tick to have seen the wait, and a prompt answered within seconds never
was. So each prompt that closed with an answer (the chat hook's end/<id>: hooks/ask-hook.sh, the service's answer) is
told once, as that task's "working again" line: "<task> is working again: its prompt was answered (Allowed on the
web)". A Codex agent reads working while its hook waits, so herdr-core told nobody it was blocked: nothing to answer.
"""
import json
import os
import re

from .base import APP_HOME, STORE, now

END = os.path.join(APP_HOME, "data", "chat-asks", "end")
TOLD = os.path.join(STORE, ".answered.json")
FRESH_MS = 10 * 60000      # an answer older than this is no news
KEEP_MS = 24 * 3600000     # told ids are kept this long (the hook keeps end/ files a day)
# the end words that say it was answered (core/asks.js howAnswered, hooks/ask-hook.sh how()), and where
ANSWER = re.compile(r"^(Allowed|Approved|Answered|Denied|Dismissed|Declined(?: or interrupted)?)\b\s*(.*)$", re.I)


def answered_words(how):
    """'its prompt was answered Yes on the web' from its end words, or None when nobody answered it."""
    m = ANSWER.match(how.strip())
    if not m:
        return None
    verb, where = m.group(1).lower(), m.group(2).strip()
    if verb == "declined or interrupted":  # an Esc as much as a No: the hook's own words
        return f"its prompt was declined or interrupted{' ' + where if where else ''}"
    choice = " Yes" if verb in ("allowed", "approved") else "" if verb == "answered" else " No"
    return f"its prompt was answered{choice}{' ' + where if where else ''}"


def _told():
    try:
        with open(TOLD) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def _save(told):
    tmp = f"{TOLD}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w") as f:
            json.dump({k: v for k, v in told.items() if now() - v < KEEP_MS}, f)
        os.replace(tmp, TOLD)
    except OSError:
        pass


def _ends():
    """[(id, terminal, how, at ms)] of the prompts that closed lately, oldest first."""
    try:
        names = os.listdir(END)
    except OSError:
        return []
    out = []
    for n in names:
        if n.endswith(".tmp") or "/" in n or n.count(".") < 2:
            continue
        try:
            p = os.path.join(END, n)
            at = os.path.getmtime(p) * 1000
            with open(p) as f:
                how = f.read().strip()
        except OSError:
            continue
        out.append((n, n.split(".")[0], how, at))
    return sorted(out, key=lambda x: x[3])


def prompt_answered(t, v, live):
    """The words of this task's "working again" line when a prompt of one of its live agents was just answered and it is
    back at work, else None. Each prompt is told once; the first look only notes the ones already there."""
    if v.get("status") != "working" or not live:
        return None
    told = _told()
    ends = _ends()
    if told is None:  # first look: old answers aren't news
        _save({e[0]: now() for e in ends})
        return None
    mine = {k.get("address"): k for k in live if k.get("address")}
    words, changed = None, False
    for id_, term, how, at in ends:
        k = mine.get(term)
        if id_ in told or not k:
            continue
        told[id_], changed = now(), True
        said = answered_words(how)
        if now() - at > FRESH_MS or not said:
            continue
        if ((k.get("labels") or {}).get("herdr.agent") or "") == "codex":
            continue
        words = said
    if changed:
        _save(told)
    return words
