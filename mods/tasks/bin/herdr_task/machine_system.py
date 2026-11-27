"""A machine's system facts for Settings > Machines, run on each machine through herdr-core as machine.py is: its OS,
how long it has been up, whether a restart is needed to finish updates, and which Shepherdr and herdr-core it runs.

Every fact is a plain file read or a documented command an ordinary user may run: no sudo, no network, nothing of an
agent's own. A fact that can't be read here is left out (null), never guessed:
- restart needed: Debian and Ubuntu write /var/run/reboot-required when an update needs one; other Linux has no such
  file, and macOS has no documented way short of `softwareupdate --list` (slow, and it asks Apple's servers), so null.
- Shepherdr: its install record (~/.local/share/shepherdr/installed.json); a machine without Shepherdr installed: null.
- herdr-core: `hc --version`."""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time

HOME = os.path.expanduser("~")
MAC = sys.platform == "darwin"
RECORD = os.path.join(HOME, ".local", "share", "shepherdr", "installed.json")
# hc's usual folders when herdr-core's exec gives a bare PATH (as machine.py's PATHS)
PATHS = [os.path.join(HOME, ".local", "bin"), "/usr/local/bin", "/opt/homebrew/bin"]
REBOOT_FILE = "/var/run/reboot-required"


def _run(argv, timeout=10):
    try:
        return subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, universal_newlines=True,
                              timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _read(path):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return ""


def os_release(text=None):
    """/etc/os-release as a dict (its quotes taken off)."""
    out = {}
    for line in (_read("/etc/os-release") if text is None else text).splitlines():
        k, eq, v = line.partition("=")
        if eq and k.strip():
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def os_name():
    """"Ubuntu 24.04.1 LTS", "macOS 15.1"."""
    if MAC:
        name = _run(["sw_vers", "-productName"]).strip() or "macOS"
        ver = _run(["sw_vers", "-productVersion"]).strip()
        return f"{name} {ver}".strip()
    rel = os_release()
    if rel.get("PRETTY_NAME"):
        return rel["PRETTY_NAME"]
    if rel.get("NAME"):
        return " ".join(x for x in (rel["NAME"], rel.get("VERSION_ID", "")) if x)
    return f"{platform.system()} {platform.release()}".strip()


def boot_seconds(text):
    """`sysctl -n kern.boottime` ("{ sec = 1700000000, usec = 12 } Tue Nov 14 ...") as seconds, or None."""
    m = re.search(r"sec\s*=\s*(\d+)", text or "")
    return int(m.group(1)) if m else None


def uptime():
    """Seconds since it started, or None."""
    if MAC:
        boot = boot_seconds(_run(["sysctl", "-n", "kern.boottime"]))
        return max(0, int(time.time()) - boot) if boot else None
    first = _read("/proc/uptime").split()
    try:
        return int(float(first[0])) if first else None
    except ValueError:
        return None


def restart_needed(rel=None, exists=os.path.exists):
    """True when an update waits for a restart, False when this system would say so and doesn't, None when it can't
    say (macOS, and Linux without Debian's flag file)."""
    if MAC:
        return None
    if exists(REBOOT_FILE):
        return True
    rel = os_release() if rel is None else rel
    family = f"{rel.get('ID', '')} {rel.get('ID_LIKE', '')}".lower().split()
    return False if ("debian" in family or "ubuntu" in family) else None


def version_in(text):
    m = re.search(r"(\d+\.\d+\.\d+)", text or "")
    return m.group(1) if m else None


def hc_version():
    hc = shutil.which("hc", path=os.pathsep.join([os.environ.get("PATH", ""), *PATHS]))
    return version_in(_run([hc, "--version"])) if hc else None


def shepherdr_version():
    try:
        v = json.loads(_read(RECORD) or "null")
    except ValueError:
        return None
    return v.get("version") if isinstance(v, dict) and isinstance(v.get("version"), str) else None


def system():
    return {"os": os_name(), "arch": platform.machine() or None, "up": uptime(), "restart": restart_needed(),
            "hc": hc_version(), "shepherdr": shepherdr_version()}


def main(argv):
    sys.stdout.write(json.dumps({"system": system()}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
