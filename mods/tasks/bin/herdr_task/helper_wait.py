"""A worker's wait on its own reviewer or helper (dmalis/shepherdr#215, "Workers never stall").

`hc wait <t>` ends when the agent is idle, and an agent started with its prompt in its argv (`hc run --bg -- codex …
"<prompt>"`) shows its idle prompt for a moment before it sends that prompt: herdr-core says idle at turn 0, and the
wait ends in a second while the agent goes on to work (hc's help: "Without a launch task, idle still counts as
stopped"). Its worker then read a report that wasn't there. `herdr-task wait-for <name>` waits again while hc says
idle at turn 0 and the terminal lives, until its timeout: a turn that ended is turn 1 or more. A reviewer on a startup
screen (trust, sign-in) is never answered: it waits as hc wait does. Only a helper the caller started, and only
herdr-core's documented `hc wait` and `hc get`; the fix itself belongs in herdr-core's wait."""

import json
import os
import time

from .base import Fail, run
from .launch import HELPER  # a worker's own helpers, as it may wait on them (<its key>-review, -helper)

PAUSE_S = 2  # before waiting again on an agent still at its startup idle


def hc(*args):
    """hc's JSON answer, or None (it failed, or printed none)."""
    r = run(["hc", *args, "--json"])
    try:
        d = json.loads(r.stdout or "")
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


def at_startup(res):
    """A wait that ended only on the agent's startup idle: idle, no turn yet, still running."""
    if (res or {}).get("status") != "idle" or (res or {}).get("turn") or res.get("exit_code") is not None or res.get("signal"):
        return False
    t = hc("get", res.get("terminal") or "")
    return bool(t) and t.get("state") == "live" and not t.get("turn")


def wait_for(name, timeout, clock=time.monotonic, sleep=time.sleep):
    """hc wait on name until it really stops, or timeout seconds: hc's last answer, with "startup": how many startup
    idles it waited through, and "still_startup" when it was still at one when the time ran out."""
    end, seen = clock() + timeout, 0
    while True:
        left = max(1, int(end - clock()))
        res = hc("wait", name, "--timeout", str(left))
        if res is None:
            raise Fail(f"hc wait {name} failed: is it a terminal of yours? (hc ls shows them)")
        if not at_startup(res):
            return {**res, "startup": seen}
        seen += 1
        if clock() + PAUSE_S >= end:
            return {**res, "startup": seen, "still_startup": True}
        sleep(PAUSE_S)


def cmd_wait_for(args):
    if not HELPER.fullmatch(args.name or ""):
        raise Fail("wait-for is for your own reviewer or helper (<your task's key, lower case>-review or -helper).")
    me, t = os.environ.get("HC_TERMINAL_ID"), hc("get", args.name)
    if me and t and t.get("parent") not in (me, None):
        raise Fail(f"{args.name} isn't yours (another agent started it): wait-for is for the reviewer or helper you started.")
    out = wait_for(args.name, max(1, int(args.timeout)))
    if out.get("still_startup"):
        out["note"] = (f"{args.name} is still at turn 0 after the whole wait: `hc read {args.name}` to see why (a startup "
                       "screen is the person's to answer: tell them).")
    print(json.dumps(out))
