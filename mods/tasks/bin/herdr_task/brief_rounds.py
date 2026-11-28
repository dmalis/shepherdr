"""The review rounds a brief names (dmalis/shepherdr#215, "Workers never stall").

An Assistant wrote "At most 2 review rounds" in a task's brief while its Review rounds setting stayed 5. The brief's
words win for its agent (the Settings block says so), but ready counts the setting's rounds: after two rounds it asked
for a third, and the agent had to break its brief or record a round that never ran. Now a brief that names its rounds
in one clear phrase sets the task's Review rounds, as --set review.rounds=N does, unless the Assistant set them."""

import re

WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
         "a single": 1}
N = r"(\d+|" + "|".join(sorted(WORDS, key=len, reverse=True)) + r")"
# "at most 2 review rounds", "up to two rounds of review", "one review round", "review rounds: 2", "Review rounds: at
# most 2" (a Settings line copied in); never "review round 2" (the second one)
SAID = [re.compile(r"\b(?:at most|up to|no more than|max(?:imum)?(?: of)?|only)?\s*" + N + r"\s+(?:review rounds?|rounds? of review)\b", re.I),
        re.compile(r"\breview rounds\s*(?:[:=]\s*(?:at most|up to|max(?:imum)?)?|:?\s*(?:at most|up to|max(?:imum)?))\s*" + N + r"\b", re.I)]


def named(brief):
    """The number of review rounds the brief names, 1 to 10, or None (none named, or more than one number)."""
    found = set()
    for rx in SAID:
        for m in rx.finditer(brief or ""):
            w = m.group(1).lower()
            found.add(int(w) if w.isdigit() else WORDS[w])
    return found.pop() if len(found) == 1 and 1 <= next(iter(found)) <= 10 else None


def apply(t, brief):
    """Sets the task's Review rounds from its brief's words, unless --set gave them. The number set, or None."""
    sets = t.get("set") or {}
    if "review_rounds" in sets or sets.get("review") == "off":
        return None
    n = named(brief)
    if n is None:
        return None
    t.setdefault("set", {})["review_rounds"] = n
    return n
