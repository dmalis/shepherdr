# The guard

An agent's shell can run `hc server stop`, `systemctl --user restart shepherdr.service` or `shepherdr update`. Run
on the live session, any of those takes down the Shepherdr the person is using, with every Assistant and task agent
in it. It happened once (SHEP-321): an agent ran `export HC_SESSION=<test>` in one shell call and a bare
`hc server stop` in the next. Each call is a new shell, so the export was gone and the stop hit the live core.

The guard is a seatbelt for that: a folder of small stand-ins put **first on the PATH of every agent Shepherdr
starts**. Each runs the real command, except for the few that would stop, restart, replace or reconfigure the live
session, which it refuses with why and how to do it right. The code and its rules: `mods/tasks/bin/herdr_task/guard.py`.

## Who has it

| Agent | How it gets the guard |
| --- | --- |
| A task's agent (a schedule's run is one) | `launch.py`: `guard_argv`, after the person's shell has read its rc files |
| A task's reviewer started by herdr-task | the same |
| A reviewer or helper an agent starts itself | `hc run … --label herdr.role=reviewer` (or `helper`) `… -- <command>` on the live session: the stand-in `hc` starts `<command>` through `herdr-guard`, since hc starts a child in herdr-core's environment, not its caller's. A command that starts `env "PATH=<the CLI's folders>:$PATH" …` (as a reviewer's does) gets the guard first inside that PATH too. With `--on <machine>`, that machine's own guard folder, from its own herdr-task |
| Each space's Assistant | the one-line start in `core/clean-env.js` (`GUARD`, in `cleanCommand`): a new space, its first message |
| An Assistant restarted, switched to another agent or handed off | `service/restart.sh` (`guard`, the same line) |
| An Assistant revived after a crash or a reboot | `revive.py`: `assistant_argv` |
| An agent on another machine | the same start, run on that machine: its own herdr-task writes its own guard folder (`herdr-task _guard-dir`) |

The person's own terminals (the web app's Terminal, their shell) never have it.

## What it refuses

| Command | Refused when |
| --- | --- |
| `hc`, `herdr-core` | `server stop` or `restart`, `serve` or `hold` on a protected session; `update` anywhere; `keys` into a reviewer's or helper's own screen |
| `systemctl` | stop, restart, kill, disable, mask and the like of herdr-core's (`hc-serve*`, `hc-hold*`) or Shepherdr's (`shepherdr*`, `herdr-*`) units |
| `launchctl` | stop, kill, kickstart, bootout, unload, remove or disable of a `*shepherdr*` or `*herdr*` service (a Mac) |
| `pkill`, `killall` | a name or pattern naming herdr-core, `hc`, Shepherdr or its service |
| `kill` (the program) | a process number that is herdr-core, the install's own service (`~/.local/share/shepherdr/service/main.ts`) or herdr-task's scheduler (asked of `ps`); `kill -0` only asks, and goes through |
| `shepherdr` | `install`, `update`, `uninstall`, `migrate` on the real home (a `--root` elsewhere and `--dry-run` go through), `web` and `secrets` changes |
| `bin/shepherdr`, `./install.sh` run by their path | the same installs, refused by the installer itself |
| `cp`, `mv`, `install`, `ln` | writing, moving or linking over a live command in `~/.local/bin` or another folder on PATH that has it (hc, herdr-core, herdr-task, shepherdr and the other herdr-* helpers), or the live install's code in `~/.local/share/shepherdr` (its worktrees and task lists are not code and go through); grouped options (`cp -ft <dir>`, `install -Dm755`) count too |

The protected sessions: the one the agent runs in, Shepherdr's (`shepherdr`) and the Herdr app's (`default`). A
throwaway session named on the same command goes through: `HC_SESSION=<throwaway> hc server stop`. Everything else
passes untouched: `hc run`, `ls`, `get`, `read`, `send`, `wait`, `exec`, `kill <terminal>`, `systemctl status`,
`pkill -f vite`.

## When it lets one through

- **The install step.** A schedule the person let update Shepherdr asks for it with `herdr-task update-shepherdr
  <its task>` (`self_update.py`); `fork/bin/sync install` does the same. The update runs outside the task's terminal,
  with the guard taken off its PATH and its words out of its environment.
- **The person's own ask, to an Assistant.** An Assistant may still do one of these when the person asked for
  exactly that: it puts `HERDR_GUARD_ASKED=1` on that one command (`HERDR_GUARD_ASKED=1 hc server restart`). A task's
  agent, and the reviewers and helpers agents start, can't: nothing in their terminals speaks for the person.

## When it breaks

It fails open. A guard folder that can't be written, or a herdr-task too old to know `_guard-dir`, starts the agent
without it; a check that can't look (no `ps`, a folder it can't read) lets the command through. A broken seatbelt
that stopped agents from starting, or every `hc` call, would be worse than none.

## What it doesn't stop

It guards against mistakes, not against an agent set on getting round it:
- a full path to the real command (`~/.local/bin/hc server stop`), or an agent's own `env PATH=… hc …`;
- the shell's own `kill` builtin (`kill <pid>`, `kill $(pgrep …)`): no program on PATH can stand in for it, and
  reaching it would mean changing the agent's shell start-up, which Shepherdr doesn't touch;
- an rc file or command that puts the real folder first on PATH again;
- `hc run` of a template, or of a child with no `herdr.role` label. An Assistant revived without a resume record
  (`hc run … assistant <message>`), or restarted when its one-off template can't be written, starts from the stock
  template, whose command is the template's own;
- writing over a file with `>`, `tee` or an editor, and anything the person runs outside an agent.

It can also refuse one it shouldn't: `kill` of a throwaway herdr-core by its number (a core's process doesn't say
which session it serves). Stop a throwaway core by name: `HC_SESSION=<it> hc server stop`.

## Changing it

The stand-ins are one POSIX `sh` script in `guard.py` (`SCRIPT`). `test/test_guard.py` holds what each refuses and
passes, that every start point above keeps the guard, and, with `SHEPHERDR_REAL_CORE=1`, the real repro on a
throwaway core: a bare stop from a task, an Assistant and a reviewer, each refused while the core keeps running.
