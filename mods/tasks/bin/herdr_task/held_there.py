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
import sys

from .base import Fail, guard

RECEIVE = 'p=$(command -v herdr-task || echo "$HOME/.local/bin/herdr-task"); exec "$p" _receive -- "$1" "$2"'
OLDER = "older"  # the receiver's herdr-task has no _receive (or none at all): nothing ran there


def receive_there(names, hows, address, text):
    """Runs _receive on the receiver's machine. -> {"got": "sent"|"held"|"no-agent"|None, "why": ...}, or OLDER."""
    from .machines import _hops
    guard(["hc"])
    env = {k: v for k, v in os.environ.items() if k != "HC_TERMINAL_ID"}
    try:
        r = subprocess.run(_hops(names, hows, ["sh", "-c", RECEIVE, "sh", address, text]), env=env, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, universal_newlines=True, timeout=30)
    except subprocess.TimeoutExpired:
        raise Fail(UNKNOWN.format("in 30 s")) from None
    for line in reversed((r.stdout or "").strip().splitlines()):
        try:
            got = json.loads(line)
        except ValueError:
            continue
        if isinstance(got, dict) and "got" in got:
            return got
    if r.returncode == 127 or "invalid choice: '_receive'" in f"{r.stdout}{r.stderr}":
        return OLDER
    # it may have been held there before something failed: never "not delivered", so nobody sends it twice
    raise Fail(UNKNOWN.format(f"({(r.stderr or '').strip()[-200:] or f'exit {r.returncode}'})"))


UNKNOWN = "no answer from that machine's herdr-task {}, so it may have arrived or be held there; check that Assistant before sending again"


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
    from .news import send_or_hold
    got = send_or_hold(args.address, args.text, "news")
    why = None
    if got == "held":
        # once held it is held: what follows only helps, and never turns it into a failure the sender would retry
        try:
            from .machines import _held_why
            why = _held_why(args.address)
        except Exception:  # noqa: BLE001
            pass
        try:
            ensure_runner()
        except Exception:  # noqa: BLE001
            pass
    print(json.dumps({"got": got, "why": why}))


def ensure_runner():
    """held_pass runs in the scheduler. Shepherdr keeps one only where tasks, automations or the web app are
    (scheduler.ensure_scheduler): an Assistant's machine with none of them, reached over more than one hop (the web
    app ticks only its direct links), would hold the message for good. So one is started here, the way
    ensure_scheduler starts it; once running it keeps going."""
    from .base import ENTRY, HOME, hc_json, run
    from .scheduler import SCHEDULER, ensure_scheduler
    if ensure_scheduler(quiet=True).get("running"):
        return
    k = hc_json("get", SCHEDULER)
    if k:  # its program was lost (a restart left a shell): replace it, as ensure_scheduler does
        run(["hc", "kill", SCHEDULER])
        run(["hc", "rm", SCHEDULER])
    run(["hc", "run", "--bg", "--json", "--keep", "--no-parent", "--no-notify", "--name", SCHEDULER, "--cwd", HOME,
         "--", sys.executable, ENTRY, "scheduler"])
