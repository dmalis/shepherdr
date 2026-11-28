"""A Codex reviewer's sandbox: read everything, write only its own temp folder (dmalis/shepherdr#250).

A read-only Codex sandbox refuses every write, /tmp and $TMPDIR included, so a reviewer could never run a test that
makes a temporary file (pytest's tmp_path, Python's tempfile, bun's tests): "No usable temporary directory found".
Workspace-write would let it change the worktree. Like a CI runner's read-only checkout with a writable RUNNER_TEMP,
the reviewer gets a Codex permission profile instead, given on its command line with Codex's documented `-c`
overrides (learn.chatgpt.com/codex/permissions: `default_permissions`, `[permissions.<name>.filesystem]`, `:root`,
`:tmpdir`), so nothing in ~/.codex changes:

  :root    read: it reads what it reads today.
  :tmpdir  write: its own $TMPDIR, the task's temp folder (task_tmp.py), wherever that folder lives; none when
           TMPDIR is unset. The worktree, its .git, /tmp and the home stay read-only, and the network stays off.

Its `--sandbox read-only` flag goes: Codex's flag wins over a profile (seen with 0.172.0's TUI: the profile was then
ignored). `sandbox_mode="read-only"` stays as a `-c` instead, below the profile: a Codex without profiles ignores
them and stays read-only (0.100.0), one that can't apply this one refuses to start (0.120.0); every Codex that knows
`--no-daemon` applies it (0.160.0 to 0.172.0).
"""

PROFILE = "shepherdr-reviewer"
ARGS = ["-c", 'sandbox_mode="read-only"',
        "-c", f'permissions.{PROFILE}.filesystem={{":root"="read",":tmpdir"="write"}}',
        "-c", f'default_permissions="{PROFILE}"']
# the line before it, as a brief written then still gives it: a Codex worker may still start that reviewer
BEFORE = ["--sandbox", "read-only"]
