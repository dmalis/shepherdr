"""The review rounds a brief names (dmalis/shepherdr#215, "Workers never stall").

An Assistant wrote "At most 2 review rounds" in a task's brief while its Review rounds setting stayed 5. The brief's
words win for its agent (the Settings block says so), but ready counts the setting's rounds: after two rounds it asked
for a third, and the agent had to break its brief or record a round that never ran. Now a brief that caps its rounds
in one clear phrase sets the task's Review rounds, as --set review.rounds=N does, unless the Assistant set them: at
add, again when edit changes the brief, and at ready for a task added before (apply())."""

import re

WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
         "a single": 1}
N = r"(\d+|" + "|".join(sorted(WORDS, key=len, reverse=True)) + r")"
CAP = r"(?:at most|up to|no more than|max(?:imum)?(?: of)?|only)"
# A cap only: "at most 2 review rounds", "up to two rounds of review", "Review rounds: 2", "Review rounds: at most 4"
# (a Settings line copied in). Never a floor or a count ("at least 2 review rounds", "review round 2", "5 review
# rounds" alone), and never one said with a no ("don't run more than 3 review rounds" is no cap of 3 either).
SAID = [re.compile(r"\b" + CAP + r"\s+" + N + r"\s+(?:review rounds?|rounds? of review)\b", re.I),
        re.compile(r"\breview rounds\s*[:=]\s*(?:" + CAP + r"\s+)?" + N + r"\b", re.I)]
NO = re.compile(r"\b(?:not|no|never|don'?t|doesn'?t|isn'?t|aren'?t|won'?t|nor|without)\b|n't\b", re.I)


def named(brief):
    """The cap on review rounds the brief names, 1 to 10, or None (none, a no before it, or more than one number)."""
    found = set()
    for rx in SAID:
        for m in rx.finditer(brief or ""):
            start = max((brief or "").rfind(c, 0, m.start()) for c in ".!?\n;") + 1
            if NO.search(brief[start:m.start()]):
                return None  # said with a no: unclear, nothing set
            w = m.group(1).lower()
            found.add(int(w) if w.isdigit() else WORDS[w])
    return found.pop() if len(found) == 1 and 1 <= next(iter(found)) <= 10 else None


def apply(t, brief):
    """The task's Review rounds from its brief's cap, unless --set gave them (a value the brief set is t["brief_rounds"],
    so an edited brief sets it again, or takes it back). The number set, or None."""
    sets = t.get("set") or {}
    mine = t.get("brief_rounds")
    if sets.get("review") == "off" or ("review_rounds" in sets and sets["review_rounds"] != mine):
        return None  # the Assistant's own --set wins
    n = named(brief)
    if n is None:
        if mine is not None and sets.get("review_rounds") == mine:
            sets.pop("review_rounds")
            if not sets:
                t.pop("set", None)
        t.pop("brief_rounds", None)
        return None
    t.setdefault("set", {})["review_rounds"] = t["brief_rounds"] = n
    return n
