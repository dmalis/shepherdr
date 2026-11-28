"""Each inferred wait, kept where it happens (dmalis/shepherdr "Needs you 6a: wait lifecycle"; the design:
fork/specs/needs-you.md).

An inferred wait is a task waiting on its space's Shepherdr first: it went quiet waiting for a reply, its checks failed
or it conflicts (attention), it ran out of review rounds, or it stopped on an error. Herdr keeps one record of it on the
task (`task["wait"]`), written by news_pass inside the tick lock and the task list's own lock (and its hand-up, `up`, by herdr-task alert
--task in that same lock: hand_up.py), so changes to a wait never race:

    {"id": "<16 hex, minted here>", "gen": 3, "kind": "reply" | "attention" | "stopped", "why": "<its words>",
     "mark": "<what makes it this question>", "first": <ms, first confirmed>, "deadline": <ms>,
     "outcome": {"how": "moved-on" | "paused" | "person" | "gone", "at": <ms>},  # once it closed
     "prev": {"id": "<the wait before>", "how": "replaced" | <its outcome's how>, "at": <ms>},
     "up": {...}}  # Shepherdr handed it up to the person (hand_up.py); a new question starts without it

- **id** is minted here, at the source, so it never depends on a task ref or a machine's alias; the service's open
  action is `wait:<id>` (web/shared/attention.ts).
- **gen** counts the task's waits. A new question in the same status (its mark changed) is a new generation, with a
  new id, a new first and a new deadline: nothing of the old one carries over.
- **first** is when Herdr first confirmed it, and **deadline** first + "Ask me after" (tasks.ask_after, minutes; 5
  until its setting row comes). A restart, a reply from Shepherdr or a held send never moves either.
- **outcome**: confirmed progress past it, a replacement, the person's Stop, a prompt only the person can answer (it
  is theirs then), or the task gone. Only a fresh read of herdr-core closes or replaces one: when hc can't be read,
  every record stays as it was.
"""

import secrets

from .base import now

ASK_AFTER_MIN = 5          # "Ask me after"'s default (its row: Settings › Notifications, and a repo's Tasks page)
REOPEN_MS = 60_000         # closed this recently and back with the same mark: the same wait (a status flicker), even
                           # past its deadline
KINDS = ("reply", "attention", "stopped")
# a reply wait's words that say nothing of which question it is (agents.py REASONS["reply"], OUT_OF_ROUNDS, and news'
# plain form)
STOCK = ("Waits for your reply", "Waits for a reply", "Out of review rounds")


def ask_after_ms(settings):
    """tasks.ask_after as ms: minutes, or 0 for right away ("now", "right away", 0). Anything else: the default."""
    v = ((settings or {}).get("tasks") or {}).get("ask_after")
    if isinstance(v, str) and v.strip().lower().replace("_", " ") in ("now", "right away", "0"):
        return 0
    if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 24 * 60:
        return int(v * 60_000)
    return ASK_AFTER_MIN * 60_000


def inferred(v):
    """The kind of the inferred wait this view says (reply, attention, stopped), else None: a prompt on its agent's own
    screen (asks) is the person's, and a task the person stopped is no one's."""
    if v.get("status") != "needs" or v.get("needs") not in KINDS:
        return None
    if v.get("stopped_by") == "you":
        return None
    return v["needs"]


def mark_of(t, v, live, kind, began=lambda: None):
    """What makes this wait this one question, from the task's own facts. reply: its question or its agent's own words
    for why it waits, so the same question asked again after a reply from Shepherdr is the same wait (a reply never
    moves its deadline); with only the stock words, when someone last wrote to its agent (its log, so a herdr-core
    restart keeps it), else its agent's terminal and turn. attention: when Herdr found the problem. stopped: when it
    stopped, else when its last agent started. began(): when someone last wrote to its agent (read only when needed)."""
    if kind == "attention":
        return f"attention:{t.get('attention_at') or 0}"
    if kind == "stopped":
        last = (t.get("agents") or [{}])[-1] or {}
        return f"stopped:{t.get('stopped_at') or last.get('at') or 0}"
    why = " ".join(str(v.get("why") or "").split())
    if why and why not in STOCK:
        return f"words:{why.lower()}"
    when = began()
    if t.get("review_out"):
        return f"rounds:{when or ''}"
    if when:
        return f"reply:{when}"
    k = next((k for k in live if (k.get("labels") or {}).get("herdr.role") != "reviewer"), None)
    if k:
        return f"reply:{k.get('address')}:{k.get('turn') or 0}"
    return "reply:"


def open_wait(t):
    """The task's open wait record, else None."""
    w = t.get("wait")
    return w if isinstance(w, dict) and w.get("id") and not w.get("outcome") else None


def track(t, v, live, settings=lambda: None, read_ok=True, began=lambda: None):
    """Keep the task's wait record in step with what news_pass just read. Returns (changed, superseded id or None):
    changed when the record was written; the id of an open wait this replaced (its queued news goes unsaid).
    settings(): the task's settings (read only for a new wait). read_ok: herdr-core answered this pass; when it didn't,
    nothing changes (unknown keeps the deadline)."""
    if not read_ok:
        return False, None
    w = t.get("wait") if isinstance(t.get("wait"), dict) else None
    gone = t.get("archived") or t.get("state") in ("done", "gone") or t.get("state") not in ("running", "ready")
    kind = None if gone else inferred(v)
    at = now()
    if not kind:
        if not open_wait(t):
            return False, None
        how = ("gone" if gone else "paused" if v.get("stopped_by") == "you"
               else "person" if v.get("status") == "needs" and v.get("needs") == "asks" else "moved-on")
        w["outcome"] = {"how": how, "at": at}
        return True, None
    mark = mark_of(t, v, live, kind, began)
    why = str(v.get("why") or "")[:200]
    if w and w.get("kind") == kind and w.get("mark") == mark:
        out = w.get("outcome")
        if not out:
            if w.get("why") != why and why:
                w["why"] = why  # the same question, its words read better now
                return True, None
            return False, None
        if out.get("how") in ("moved-on", "person") and (at - (out.get("at") or 0) < REOPEN_MS or at < (w.get("deadline") or 0)):
            # back with the same question, within a moment or before its deadline (a reply from Shepherdr that didn't
            # settle it): the same wait, its first and deadline kept
            w.pop("outcome")
            return True, None
    superseded = open_wait(t)["id"] if open_wait(t) else None
    gen = (int(w.get("gen") or 0) if w else 0) + 1
    t["wait"] = {"id": secrets.token_hex(8), "gen": gen, "kind": kind, "why": why, "mark": mark,
                 "first": at, "deadline": at + ask_after_ms(settings()),
                 # the one before and how it ended, so a late tap on it can say so
                 **({"prev": {"id": w["id"], **(w.get("outcome") or {"how": "replaced", "at": at})}} if w and w.get("id") else {})}
    return True, superseded
