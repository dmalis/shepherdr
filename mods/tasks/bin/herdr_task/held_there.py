"""A message to an Assistant on another machine, held there while it's busy (dmalis/shepherdr#80).

tell-assistant to an Assistant on this machine goes through news.send_or_hold: sent now, or held while it works, asks
something or the person writes to it, and held_pass sends it once it's free. To another machine it typed with hc send
there and failed while that Assistant worked, so the sender had to try again by hand. Now the receiving machine's own
herdr-task runs send_or_hold (`herdr-task _receive <address> <message>`, over the same hops as the send) and says
"sent" or "held" and why; its scheduler's held_pass delivers it later, the original <herdr-assistant> tag as it was.
A receiver whose herdr-task is older (no _receive) is sent to as before (machines._deliver)."""
import json
import os
import subprocess

from .base import Fail, guard

RECEIVE = 'p=$(command -v herdr-task || echo "$HOME/.local/bin/herdr-task"); exec "$p" _receive -- "$1" "$2"'
OLDER = "older"  # the receiver's herdr-task has no _receive (or none at all): nothing ran there


def receive_there(names, hows, address, text):
    """Runs _receive on the receiver's machine. -> {"got": "sent"|"held"|"no-agent"|None, "why": ...}, or OLDER."""
    from .machines import _hops
    guard(["hc"])
    env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
    r = subprocess.run(_hops(names, hows, ["sh", "-c", RECEIVE, "sh", address, text]), env=env, stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, universal_newlines=True, timeout=30)
    for line in reversed((r.stdout or "").strip().splitlines()):
        try:
            got = json.loads(line)
        except ValueError:
            continue
        if isinstance(got, dict) and "got" in got:
            return got
    if r.returncode == 127 or "invalid choice: '_receive'" in f"{r.stdout}{r.stderr}":
        return OLDER
    raise Fail(f"no answer from that machine's herdr-task ({(r.stderr or '').strip()[-200:] or f'exit {r.returncode}'})")


def deliver(names, hows, address, text):
    """tell()'s send to another machine. -> (ok, held, why): held while it's busy, as on this machine."""
    from .machines import HELD_WHY, _deliver
    from .news import NO_AGENT
    got = receive_there(names, hows, address, text)
    if got == OLDER:
        return _deliver(names, hows, address, text), False, None
    if got.get("got") == NO_AGENT:
        raise Fail("its agent isn't running there (its terminal is a plain shell now), so nothing was typed into it. "
                   "Restart the agent from its chat, then send again")
    held = got.get("got") == "held"
    return bool(got.get("got")), held, held and (got.get("why") or HELD_WHY[None])


def cmd_receive(args):
    """On the receiving machine: send it now or hold it (news.send_or_hold), and say which, one JSON line."""
    from .machines import _held_why
    from .news import send_or_hold
    got = send_or_hold(args.address, args.text, "news")
    print(json.dumps({"got": got, "why": _held_why(args.address) if got == "held" else None}))
