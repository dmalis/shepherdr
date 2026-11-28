"""A Codex reviewer's sandbox: read everything, write only its task's own temp folder (dmalis/shepherdr#250).

A read-only Codex sandbox refuses every write, /tmp and $TMPDIR included, so a reviewer could never run a test that
makes a temporary file (pytest's tmp_path, Python's tempfile, bun's tests): "No usable temporary directory found".
Workspace-write would let it change the worktree. Like a CI runner's read-only checkout with a writable RUNNER_TEMP,
the reviewer gets a Codex permission profile instead, given on its command line with Codex's documented `-c`
overrides (learn.chatgpt.com/codex/permissions: `default_permissions`, `[permissions.<name>.filesystem]`, `:root`,
an absolute path), so nothing in ~/.codex changes:

  :root        read: it reads what it read before.
  the folder   write: its task's own temp folder (task_tmp.py), by its path, as herdr-task names it, never the
               worker's $TMPDIR as such. Only a folder Shepherdr names (task_tmp.roots(), task_tmp.NAME) that neither
               holds nor sits in the task's folder gets one; otherwise the line stays `--sandbox read-only`.
               The worktree, its .git, /tmp, the home and every other folder stay read-only; the network stays off.
               A folder that's missing, or a $TMPDIR elsewhere, leaves it read-only (seen in `codex sandbox`).

The profile replaces `--sandbox read-only`, never joins it: Codex's flag wins over a profile (seen with 0.172.0's
TUI: the profile was then ignored), and its docs say not to combine `default_permissions` with `sandbox_mode`. A Codex
too old for profiles never runs it: `--no-daemon`, which the line starts with, came later (0.160.0 has both, 0.150.0
neither), and Shepherdr already refuses a Codex without it (settings.codex_too_old)."""

import json
import os
import re

from . import task_tmp

PROFILE = "shepherdr-reviewer"
READ_ONLY = ["--sandbox", "read-only"]
SELECT = f'default_permissions="{PROFILE}"'
FILESYSTEM = re.compile(rf'permissions\.{re.escape(PROFILE)}\.filesystem=\{{":root"="read",("(?:[^"\\]|\\.)*")="write"\}}')


def _inside(a, b):
    return a == b or a.startswith(b.rstrip(os.sep) + os.sep)


def writable(path, folder=None):
    """The task temp folder a reviewer may write, or None: absolute, one Shepherdr names in its own root, and not
    holding nor inside the task's folder (its worktree)."""
    if not isinstance(path, str) or not os.path.isabs(path) or not task_tmp.NAME.match(os.path.basename(path)):
        return None
    real = os.path.realpath(path)
    if os.path.dirname(real) not in {os.path.realpath(r) for r in task_tmp.roots()}:
        return None
    if folder:
        f = os.path.realpath(os.path.expanduser(folder))
        if _inside(real, f) or _inside(f, real):
            return None
    return os.path.normpath(path)


def folder_of(s, task, folder=None):
    """The task's temp folder for its reviewer: the one recorded on it (a start's brief makes it first, launch.brief()),
    when writable(); None when there's none."""
    return writable(task.get("tmp"), folder)


def args(tmp):
    """The reviewer's sandbox words: the profile when it has a temp folder, else read-only as before."""
    if not tmp:
        return list(READ_ONLY)
    return ["-c", f'permissions.{PROFILE}.filesystem={{":root"="read",{json.dumps(tmp)}="write"}}', "-c", SELECT]


def as_read_only(cmd):
    """A Codex worker's allow-list (launch.helper_hc): a reviewer line with the profile, written as args() writes it
    for a folder writable() takes, as its read-only line; anything else as it is."""
    if cmd[:2] != ["codex", "--no-daemon"] or len(cmd) < 6 or cmd[2] != "-c" or cmd[4:6] != ["-c", SELECT]:
        return cmd
    m = FILESYSTEM.fullmatch(cmd[3])
    try:
        tmp = json.loads(m.group(1)) if m else None
    except ValueError:
        return cmd
    if not tmp or writable(tmp) != tmp or args(tmp) != cmd[2:6]:
        return cmd
    return cmd[:2] + READ_ONLY + cmd[6:]
