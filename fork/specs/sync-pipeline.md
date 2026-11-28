# Upstream sync pipeline

Part of #2. The spec for the "Upstream sync" schedule's run: take upstream's newest release, adapt our patches, try
it on a throwaway Shepherdr, install it, and roll back when it isn't healthy. The upstream-sync skill is the procedure
an agent follows; this spec is what the code under `fork/` does for it, and the rules it keeps.

Nothing here loosens AGENTS.md. Where the install path touches its rules, [Narrow exceptions](#narrow-exceptions) says
exactly how far, and what stays forbidden.

## Words

| Word | Meaning |
|---|---|
| **run** | One task the schedule started. It ends with one outcome. |
| **release** | An upstream tag `vX.Y.Z`, read from the `upstream` remote, pinned by its commit SHA. |
| **sync branch** | `sync/vX.Y.Z` on origin: origin/main with the release merged in and our patches adapted. Its pull request is the **sync PR**. |
| **candidate** | The exact commit a run tries and installs. Always a SHA, never a branch or tag name. |
| **baseline** | The last commit proven healthy on this machine, with its version and install source. Rollback returns to it. |
| **quarantine** | SHAs that failed an install or a trial. No run installs one again unchanged. |
| **state** | The run's private record on the serving machine ([Where things live](#where-things-live)). |
| **install folder** | The checkout the live Shepherdr is installed from (FORK.md's table). Only the install step moves it. |

## The pieces

| Piece | What it does |
|---|---|
| `fork/bin/sync` | One Python command, subcommands below. Every step that reads or writes state, git refs or GitHub goes through it, so the agent decides and the code checks. |
| `fork/bin/trial <sha>` | A throwaway Shepherdr built from one commit. Prints `PASS` or `FAIL: <step>: <why>`. |
| `fork/sync/` | The Python modules both commands use: `state.py`, `release.py`, `gate.py`, `install.py`, `public.py`. |
| `fork/tests/` | Their tests. Run with `python3 -m unittest discover -s fork/tests`. |
| `.github/workflows/fork-check.yml` | Our own workflow, job `fork-check`: the fork's tests and script checks on every pull request and push to main. |
| The upstream-sync skill | The words the run's agent follows. It names each `fork/bin/sync` call. |

`fork/bin/sync` subcommands, each printing one JSON line and exiting 0 only when its step passed:

| Subcommand | Step |
|---|---|
| `preflight` | Checks the repo, takes the run's lease, reads state, resumes an unfinished phase. |
| `baseline [--capture]` | Reads what is installed and proves it matches the install folder. `--capture` writes it as the baseline (first run only). |
| `select` | Finds the newest stable release and decides the outcome path. |
| `review-inputs` | Writes the reviewer's three diffs for the sync branch to files in the run's worktree's git dir, and records the pushed head they cover as the state's expected head. |
| `merge <pr>` | The one merge route for a sync PR ([Merge and finish](#merge-and-finish)). |
| `install <sha>` | Moves the install folder and asks for the update, then reads its outcome. |
| `health <sha>` | The health check. Runs again by itself after a rollback, against the baseline. |
| `rollback` | Back to the baseline, verified. |
| `hold` / `held` | Writes or reads the held record. |
| `public-check <file>` | Refuses text with paths, hosts, emails or raw output before it goes to GitHub. |
| `finish` | Prints the exact completion command for the run's outcome ([Completion commands](#completion-commands)). |
| `clear-broken` | The person's only: clears a `broken` phase. Refused in a task's terminal. |
| `settle` | For "Install merged": origin/main's tip pinned now, and the run's path: nothing, skip or install-merged ([Installing our own merges](#installing-our-own-merges)). |
| `ci` | After `finish` says `next: ci`: CI's verdict on installs of our merges with none yet (waiting on the run's own), read with the lease let go, then the completion command. |

## Where things live

| What | Where | Public? |
|---|---|---|
| Pipeline config: the expected machine (hostname), the install folder, the expected time zone | `~/.config/shepherdr-fork/sync.json`, written once by the person's Assistant | No |
| State: phase, lease, baseline, candidate, quarantine, held record, issue cursor, rehearsals passed, pending merges, installs (each with its run and path), CI's verdict after each install of ours, the recovery point (the newest install CI passed) | `~/.local/state/shepherdr-fork/sync/state.json` (written atomically: temp file, then rename) | No |
| Lock | `~/.local/state/shepherdr-fork/sync/lock` (`flock`) | No |
| Held and failed runs, for people | A `sync-blocked` or `pipeline` issue on dmalis/shepherdr, in sanitized words | Yes |
| What was installed when | `ours-<version>-<n>` tags, pushed only after a healthy install | Yes |

The config is not a Shepherdr setting: Shepherdr never reads it, so it stays out of upstream's settings file. It holds
facts about the person's machine, so it never goes in the repo.

## One run

Each step names its `fork/bin/sync` call. A step that fails ends the run in the outcome it names.

1. **Preflight** (`preflight`).
   - `gh repo set-default --view` prints `dmalis/shepherdr`, and `origin`'s URL is that repo. Else **held**
     (pipeline), nothing written.
   - The space folder is on `main` (tasks take its current branch as their base).
   - This machine is the config's machine: `socket.gethostname()` matches. Else stop, nothing written.
   - Take the lease ([Serialised runs](#serialised-runs)). Another run owns it and is still open: **nothing new**
     quietly (`--nothing`).
   - State has an unfinished phase: resume there ([Phases](#phases)).
2. **Baseline** (`baseline`). Reads the live install and proves it matches the state's baseline
   ([Install and rollback](#install-and-rollback)). The first run captures it. A mismatch is **held** (pipeline):
   someone installed by hand, and the person decides.
3. **Select** (`select`): the newest release, the decision.

   | Release already in origin/main? | origin/main beyond the baseline? | Path |
   |---|---|---|
   | yes | no | **Nothing new.** One line, `--nothing`. |
   | yes | yes | Trial origin/main's SHA, then install (our merged patches await delivery). |
   | no | – | Take the release (step 4). |

   A held record for this release: resume it ([Held runs](#held-runs-codex-point-15)).
4. **Take the release.** As the skill's step 3: branch from the pinned origin/main SHA, `git merge --no-ff <release
   sha>`, resolve upstream-first, adapt patches, run each patch's tests. The task's own branch holds the same commits,
   so `herdr-task reviewed` can record rounds on them. Push as `sync/vX.Y.Z` and open the sync PR with
   `gh pr create -R dmalis/shepherdr --base main --head sync/vX.Y.Z`. herdr-task never learns this pull request (it
   looks for one by the task's own branch name), so it can never arm its squash merge on it.
5. **Review.** The run's reviewer gets the files `review-inputs` wrote ([Merge and finish](#merge-and-finish)).
   Rounds are recorded with `herdr-task reviewed` on the commit reviewed, as for any task.
6. **Trial** the sync PR's head SHA (`fork/bin/trial <head>`). The head contains origin/main's tip, so the merge
   commit's tree will be the tried tree. `FAIL` is **held** (trial).
7. **Merge** (`merge <pr>`). Its gates pass or the run is **held**. It records the merge commit as the candidate.
8. **Install** (`install <candidate>`), only when the schedule may update. Without that permission the run ends
   **held** with "ready to install" (see [The schedule](#the-schedule-codex-point-13)).
9. **Health** (`health <candidate>`). Pass: **installed**. Fail: **rollback**.
10. **Rollback** (`rollback`). Verified healthy on the baseline: **rolled back**. Not verified: **unknown**.
11. **Record and report.** Tag and push only after health passed; update issues; then the completion command.

## Outcomes

| Outcome | When | What is recorded | Completion |
|---|---|---|---|
| **Nothing new** | Release in main, main not beyond baseline; or another run owns the lease | Nothing (the lease is untouched) | `ready --nothing` |
| **Installed** | Health passed on the candidate | Baseline := candidate. Tag `ours-<v>-<n>` pushed. Patch issues' status lines updated; retired patches closed. | `ready --told "<what's new>"` |
| **Held** | A gate, a trial or a patch stopped it; or no update permission yet | Held record ([Held runs](#held-runs-codex-point-15)); `sync-blocked` issue | Draft pushed or merge aborted, own branch reset, then `ready --told "Held: …"` |
| **Rolled back** | Health failed; rollback verified on the baseline | Candidate quarantined; `pipeline` issue with sanitized outcomes | `ready --told "Rolled back: …"` |
| **Unknown: update** | The update's state can't be read, or still says running 40 minutes after it began | Phase stays `installing`; lease kept | `herdr-task alert`, then `ready --told "Update outcome unknown: …"`. The next run resumes. |
| **Unknown: rollback failed** | The rollback's update failed, or health fails on the baseline too | Phase `broken`; both SHAs quarantined; lease kept | `herdr-task alert`, then `ready --told`. No later run installs anything until the person clears the phase. |

The 24-hour question is the one outcome that waits: the run asks with its question tool and stays open
([Held runs](#held-runs-codex-point-15)).

### Phases

The state's `phase` is written before each step acts, so a run that dies is resumed, never repeated blindly:

`selected → branch-pushed → tried → merged → installing → installed → healthy`, with side exits `held`,
`rolling-back → rolled-back`, and `broken`. Installing our own merges has its own way in: `settled → installing`
(no trial, no wait for main's checks; [Our merges' install policy](#installing-our-own-merges)).

On resume:
- `installing`: read the update's outcome from the task that asked for it (`herdr-task update-shepherdr <that task>
  --status --json`; `--status` works on a finished task). Running: wait as in [Reading the outcome](#reading-the-outcome).
  Then health, as if this run had asked.
- `installed`: run health.
- `rolling-back`: read the rollback's update outcome, then health against the baseline.
- `broken`: stop. Only the person clears it (`fork/bin/sync clear-broken`, refused in a task's terminal the way
  `--may-update-shepherdr` is: `HERDR_GUARD_SESSION` set).

### Serialised runs

Each time the schedule fires it starts a new task, whatever the last one is doing (`automations.py`: each due time
calls `fire`). The serial point is ours:

- Every `fork/bin/sync` call holds the `flock` while it reads and writes state.
- The state's `lease` names the run's task key and when it took it. A run takes the lease in `preflight`. Another
  run's lease holds while `herdr-task show <its key> --json` says that task isn't done. A done or missing owner with an
  unfinished phase: this run takes over and resumes. The run record (its path, merge and sync branch) becomes this
  run's, and the merge's review gate reads the rounds of the run that recorded the sync branch's head.
- The lease is let go at the end of a run whose phase is final (`healthy`, `rolled-back`, `held`), never on
  `installing`, `rolling-back` or `broken`.
- A manual run (the person asks the Assistant to sync now) is a task like any other and takes the same lease.

## fork/bin/trial

`fork/bin/trial <sha>` builds a throwaway Shepherdr from that one commit, drives one task through its gates, and
removes everything it made. It never touches the live session, the install, or other tasks.

### What it isolates

| What | How |
|---|---|
| Code | `git archive <sha>` into `<scratch>/src`, then `bun install --frozen-lockfile && bun web/build-plugins.ts`. Wrappers for `herdr-task`, `herdr-artifact` and `shepherdr` in `<scratch>/bin` run the candidate's copies. Nothing runs from the live install. |
| Environment | Every child starts from `env -i` with only `HOME` (the real one, as AGENTS.md's recipes say), `TERM`, `PATH=<scratch>/bin:<the dirs of hc, git, gh, bun, python3>`, and the variables below. No `HC_SOCKET`, `HC_TERMINAL_ID`, `HC_TERMINAL_SOCKET`, `HERDR_*` of the caller, `CLAUDE_*` or `CODEX_*`. |
| herdr-core | `HC_SESSION` and `SHEPHERDR_SESSION` both `fork-trial-<8 hex>`. Every `hc` call names it. |
| Data | `SHEPHERDR_DATA`, `HERDR_TASK_STORE`, `HERDR_TASK_SETTINGS`, `HERDR_TASK_TEMPLATES` under scratch; `SHEPHERDR_NO_MIGRATE=1`; `TMPDIR=<scratch>/tmp`. |
| Worktrees | The scratch settings set `tasks.worktree_root` to `<scratch>/worktrees`, so nothing lands under `~/.local/share/shepherdr/worktrees/`. |
| Templates | `HERDR_TASK_TEMPLATES=<scratch>/templates`: starting a worker writes its role templates there, not into `~/.config/herdr-core/templates`. |
| Service | `SHEPHERDR_PORT=<a free port>`, `SHEPHERDR_WEB=off`: on 127.0.0.1 only, never shared on the tailnet. |
| GitHub | The scratch repo has no remote, so tasks merge locally. `HERDR_TASK_GH` points at a stub that fails every call, so a stray call shows as a `FAIL`. |
| Other machines | The throwaway core has no linked machines (checked: `hc machine ls --json` is empty), and `$HERDR_TASK_STORE/.remote/` stays empty. No bundle can go anywhere. |
| Scratch repo | `<scratch>/fork-trial-<same hex>`, a unique name. |

### What it does

1. **Before.** Records the live session's terminal ids (`HC_SESSION=shepherdr hc ls --json`, read only).
2. **Core and service.** Starts the throwaway core, then the candidate's service (`bun service/main.ts`) with the
   variables above; waits until `GET /api/state` answers with the scratch token (`Authorization: Bearer`, `x-shepherdr:
   1`).
3. **The task.** In the scratch repo (one commit, fixed author and dates), scratch settings: worktrees on, Review on
   with 2 rounds, Merge `ask`. `herdr-task add` then `start --argv '["sh","-c","<stand-in>"]'`. The stand-in agent
   writes `trial.txt` with fixed words and commits it with fixed `GIT_AUTHOR_*`/`GIT_COMMITTER_*` names and dates, so
   its tree is always the same. The trial checks that tree hash.
4. **The review gate** (Codex point 12):
   - `ready --summary` is refused, and its words say the final commit isn't reviewed.
   - A stand-in reviewer starts as the task's child (`hc run --bg --name <key>-review --label herdr.task=<key>
     --label herdr.role=reviewer -- sh -c 'echo "No findings."'`); the trial waits for it and kills it.
   - `reviewed --commit <the start commit>` records a round on the wrong commit. `ready` is still refused.
   - `reviewed` on the stand-in's commit. `ready` is accepted and the task is Ready.
5. **Accept.** `herdr-task accept`: the local merge lands the commit in the scratch repo's `main`, the task is done,
   its worktree is gone.
6. **Result.** `PASS`, or `FAIL: <step>: <one line why>`. Exit 0 or 1.
7. **Cleanup**, also after a failure or Ctrl-C (a `finally` and a signal handler): stop the service by its own pid
   (`lsof -t -i:<port> -sTCP:LISTEN`, never `pkill -f`); `HC_SESSION=<name> hc server stop`; remove
   `~/.local/state/herdr-core/<name>` if this trial created it; remove `<scratch>`. Then check: no `fork-trial-<hex>`
   session, no scratch folder, no `~/.local/share/shepherdr/worktrees/fork-trial-<hex>`, and the live session's
   terminal ids are what step 1 saw (allowing only terminals that ended on their own). A leftover is a `FAIL`.

The trial removes only paths it made. Each is recorded in `<scratch>/made.json` as it is made, and cleanup reads that
list; it never globs.

## Install and rollback

### Before anything moves

`install <sha>` checks, in order, and stops with nothing changed when one fails:

1. The machine is the config's machine.
2. The installed CLI: `shepherdr`, looked up on the `PATH` the runner will have, resolves into
   `~/.local/share/shepherdr/bin/`. That `PATH` is the run's own with the guard's folder taken out, built by the
   installed herdr-task's own `self_update.clean_env`, not the run's `PATH` (whose first `shepherdr` is the guard's).
3. The recorded source: `~/.local/share/shepherdr/installed.json`'s `source` is the config's install folder (realpath),
   and its `root` is the home. `shepherdr update` installs from exactly that folder (`cmd_install`, `hand_over`).
4. The install folder is clean (`git status --porcelain` empty) and its HEAD is the baseline SHA.
5. The candidate: not quarantined; its tree equals the tree the trial passed; the release SHA is its ancestor; its
   checks passed ([Main's checks](#mains-checks)).
6. The candidate's installer would write nothing to an agent's config ([Narrow exceptions](#narrow-exceptions)).
7. The candidate carries the hold patch ([Narrow exceptions](#narrow-exceptions)), checked by its test's name in
   the patch list at that SHA (`fork/patches/<issue>.json`, or an older SHA's `fork/patches.json`).
8. Before-pictures for health: the Assistants (`herdr-task assistants --json`, their targets), and the sha256 of the
   two agent hook files (read only).

### The first run's baseline (Codex point 1)

No `ours-*` tag exists, and the install folder is on a plain `main` branch at an upstream release. The first run's
`baseline --capture` records, without moving anything:
- `installed.json`'s `version`, `source`, `at` and `whole`;
- the install folder's HEAD SHA and branch;
- that HEAD's `VERSION` (in `bin/shepherdr`) equals the installed `version`.

If they disagree (the folder moved after its last install), there is no trustworthy baseline: **held**, and the person
decides. Rollback from the first install goes back to that captured SHA, by SHA. The state's baseline, not the newest
tag, is what "installed" means from then on.

### Moving the install folder

```
git -C <install folder> remote add fork https://github.com/dmalis/shepherdr.git   # first install only
git -C <install folder> fetch fork main
git -C <install folder> cat-file -e <sha>^{commit}
git -C <install folder> checkout --detach <sha>
```

The run writes its own sync hold first ([Narrow exceptions](#narrow-exceptions)). The folder's `main` branch is left
where it was. Only this step and rollback move HEAD.

### Asking for the update

`herdr-task update-shepherdr <run> --folder <space> --no-wait`, from the run's own terminal. It is refused anywhere
else (`self_update.py`): only a run of a schedule the person allowed, from that run's terminal. The runner calls
`shepherdr update`, which hands over to the install folder's own installer (`hand_over`). The run never calls
`shepherdr update` itself.

### Reading the outcome

Exit codes say little: `--status` always exits 0, and the installer can print `NOT DONE` and exit 0. So:

1. Poll `herdr-task update-shepherdr <run> --folder <space> --status --json` every 10 s. Its JSON is the task's
   `shepherdr_update`: `state` is `running`, `ok` or `failed`.
2. Still `running` 40 minutes after its `at` (the runner stops an update after 30): **unknown: update**.
3. `failed`: health still runs (the install may have half-landed), then rollback.
4. `ok`: health.

### Health (Codex point 3)

`health <sha>` passes only when every line holds:

1. `installed.json`: `version` is the candidate's `VERSION`, `source` is the install folder, `at` is later than the
   update's start, `whole` is `true`.
2. The installed files are the candidate's: each file `installed.json` lists under `.local/share/shepherdr/` that comes
   from a tracked file has that file's content at the SHA (`git show <sha>:<path>`). Built files (`web/dist`) are
   skipped.
3. The web app: the built page is installed (`web/dist/index.html`) and, live, the running service serves it at `/`
   (its health's id matches its `service.json`, and the page isn't the "isn't built" one). The installed herdr-task
   answers `herdr-task list --json` in a scratch store. These two take seconds and cover what the trial covered for
   our merges, which skip it. A rehearsal run with `--no-build` doesn't ask for the built page.
3. `herdr-task assistants --json` lists every target the before-picture had.
4. The scheduler runs the new code: the `hash` in herdr-task's `.scheduler.json` equals `scheduler.script_hash()`
   computed by the installed herdr-task itself. (`herdr-task --version` is no use here: it prints the bundle's own
   `VERSION`, `1`.) The scheduler re-execs (`os.execv`, the same pid, the file rewritten) only between its rounds,
   after a round and its 15 s nap, and a round that starts and checks tasks can take minutes. So health tells three
   cases apart, from the file's pid (`ps -o command=` names a `scheduler`) and its hash:
   - **running, still on the old code**: waited for up to 5 minutes. Only then it fails, as "still on the old code"
     or, when the file was rewritten since the update began, "re-execed onto other code".
   - **not running** (the pid is gone or isn't a scheduler, or there's no file): fails after 30 s, the time for one
     started again to come up on the new code.
   - **ended during the wait**: a re-exec that failed, after the same 30 s.

   The quarantine's step names which: `health (scheduler: still on the old code)`.
5. The two agent hook files have the sha256 they had before. A change is not undone by the pipeline (it never writes
   them): **unknown**, with an alert that says which file.
6. `shepherdr doctor` exits 0. It checks the files, links, helpers, the service unit and that the service answers.
   Its words stay private.

Doctor runs last, and without the hold variable: it lets go of the sync hold when the install is whole, so the
candidate reaches other machines only after every other line passed.

### Rollback

`rollback` is the install step aimed at the baseline, with its own checks before it moves anything:

1. The machine, the runner's CLI and the recorded source, as for an install.
2. The state's phase is `installing`, `installed` or `rolling-back`, and names the candidate.
3. The install folder's HEAD is that candidate or the baseline (a rollback that died after its checkout), and
   `git status --porcelain` is empty. Anything else is someone else's change: **unknown: rollback failed**, nothing
   moved.
4. The baseline SHA is in the folder (`cat-file -e`).

Then it writes phase `rolling-back`, runs `checkout --detach <baseline sha>`, asks for a second `update-shepherdr`
from the same run (allowed: its last update is no longer `running`), reads the outcome the same way, and runs
`health <baseline sha>`. The hooks check isn't needed: the baseline's installer is the one that ran last time. Only
health passing makes **rolled back**. Anything else is **unknown: rollback failed**.

Then the failed SHA goes into quarantine with the step that failed, and the `pipeline` issue gets a comment in
sanitized words (which step, which check failed, the versions), never the installer's output or its log path.

A quarantined SHA stays out until a new commit replaces it. A fix is a new SHA, so it is tried like any candidate.

## Narrow exceptions

FORK.md lets this schedule's run install. This is everything that permission covers, and nothing else:

- **The service restart.** `shepherdr update` stops the Shepherdr service while files change and starts it again
  (`stop_service`, `install_service`; it waits for a voice call to end). That restart, through `herdr-task
  update-shepherdr` only, is the one allowed. The pipeline never runs `systemctl`, `launchctl`, `kill`, `pkill`, `hc
  server` or `hc update`. herdr-core and the agents keep running (docs/upgrading.md, "Later updates").
- **Agents' hooks.** The installer edits `~/.claude/settings.json` and `~/.codex/hooks.json` (`set_hooks`) whenever
  one of its entries is missing from the file, or a 3.1 entry (`OLD_HOOK`) is in it. Which entries `installed.json`
  records says nothing about what the files hold now. An unattended run must not be what edits an agent's config, so
  before installing, `install` runs the candidate's own rule on copies:
  1. It reads the two files (read only, as `shepherdr doctor`'s hook check does) and copies them into scratch.
  2. It loads the candidate's `bin/shepherdr` as a module, from `git show <sha>:bin/shepherdr`, and calls its
     `set_hooks(r, {}, add=True)` with an `r` whose paths point at the copies and whose share path is the real one,
     so the command strings are the ones a real update would compare.
  3. Any byte of either copy changed: the update would write an agent's config. **Held** (kind `hooks`).

  Health's line 5 checks the real files after the update as a tripwire. So the scheduled install changes no agent
  config. If upstream changes the installer so it always writes those files, every release holds, which is the safe
  failure. Hooks are a documented feature of both CLIs (docs/agents-and-terms.md, "Approvals, trust and reviews"), and
  the person's own install put these in; adding or removing one stays the person's own `shepherdr update`.
- **Codex's hook trust.** A new Codex hook asks once to be trusted. That is a prompt for the person; nothing answers it.
  The check above means a scheduled install never adds one.
- **Propagation to other machines.** While the installer replaces helpers it holds the sync to other machines
  (`sync-hold`), and at its end it lets go when the install is whole (`finish_install` calls `release_hold`;
  `base.sync_held` also clears a hold whose stamp is a whole install's). Our health check runs after that, so without a
  change the candidate's helpers could reach linked machines before it passes. The installer's own stamped hold can't do it: `finish_install` saves the candidate's
  stamp before its whole check, while `whole` still reads `true` from the last install, and in that gap
  `base.sync_held` clears a stamped hold. So the run holds the sync itself, and one fork patch keeps the installer off
  that hold:
  1. Before the install folder moves, the run writes both hold paths (`~/.herdr/sync-hold` and the state folder's
     `sync-hold`) with the line `held by the fork's sync until its health check passes: run shepherdr doctor`. It has no
     `install at <stamp>:`, so `base.sync_held` never clears it (`_install_done` is false), and `machines.sync` and
     `cli.remote_run` copy nothing while it is there. This is Shepherdr's own state file, not an agent's.
  2. The patch, at one call site, `bin/shepherdr`'s `hold_paths`: with `SHEPHERDR_KEEP_SYNC_HOLD=1` in its
     environment it returns one side file, the state folder's `sync-hold.install`, which herdr-task never reads. So the
     installer writes its stamped hold there and removes it there, and never touches the run's hold, wherever it stops.
  3. The run sets the variable only on its `update-shepherdr` call. The runner keeps the run's environment
     (`self_update.clean_env`) and `hand_over` keeps it for the install folder's installer.
  4. Health's last line, `shepherdr doctor` without the variable, reads the real paths and lets go when the install is
     whole. A failed health keeps the hold through the rollback; the baseline's doctor lets go once the baseline is
     healthy. An unknown outcome keeps it until the person looks.
  - A rollback to a baseline without the patch (the first install's, v3.2.20) writes and releases the real paths
    itself: what goes out then is the baseline, the code that ran before.
  - The patch has its own `patch` issue and tests (build task 5), and `install` refuses a candidate without it.

Nothing in this path reads plan usage, uses an agent's sign-in, drives an agent's interface, or edits an agent's config.
The two hook files are read, never written. The update itself is upstream's installer doing what it does for the
person by hand.

## Release selection (Codex point 9)

- Releases come from `git ls-remote --tags upstream 'refs/tags/v*'`, never from local tags (`git tag -l` sees both
  remotes' tags). Keep names matching `^v\d+\.\d+\.\d+$` exactly; take the highest by version.
- Its SHA is the peeled one (`^{}`). Fetch only that tag: `git fetch --no-tags upstream
  refs/tags/vX.Y.Z:refs/tags/vX.Y.Z`. A local tag of that name at another SHA is a stop (**held**, pipeline).
- It must be on upstream's main: `git fetch upstream main`, then `merge-base --is-ancestor <sha> upstream/main`.
- Upstream's untagged main is never taken, even when origin/main's cached history has commits beyond the last tag.
- The SHA, not the name, goes through the PR checks, the trial, the merge's ancestry check and the install.
- The first run records the release already in main: today origin/main is `v3.2.21` plus our commits. `select`
  proves `v3.2.21`'s SHA is an ancestor of origin/main before any deployment is allowed.

## Merge and finish

### The reviewer's inputs (Codex point 11)

`review-inputs` writes three files for the reviewer, and the brief names them:

1. **Our footprint**: `git diff <release sha>..<sync head>`: everything of ours on top of the new release.
2. **How our patches moved**: `git range-diff <old release>..<old main> <release sha>..<sync head>`.
3. **The conflict resolutions**: `git show --remerge-diff <the sync's merge commit>` (git 2.36 or later), which
   `range-diff` leaves out because it skips merges. Plus `git log -p <merge>..<sync head>` for the adaptations after it.

The reviewer reviews only our side. Upstream's own commits are not reviewed.

### The one merge route (Codex point 10)

`merge <pr>` is the only way a sync PR merges. It checks, then merges, then verifies:

1. `gh pr view <pr> -R dmalis/shepherdr --json`: open, not draft, base `main`, head `sync/vX.Y.Z` in the same repo, head
   SHA equal to the state's expected head.
2. **Review**: `herdr-task show <run> --json`'s last recorded round (`review_rounds.last.head`) is exactly that head
   SHA. A round on an earlier commit doesn't count, even when the rounds are used up: then the run is **held** and the
   person decides.
3. **Up to date**: origin/main's tip is an ancestor of the head, so the merge commit's tree is the head's tree.
4. **Ancestry**: the release SHA is an ancestor of the head.
5. **Checks**: the check runs named `check` and `fork-check` for exactly the head SHA (`gh api
   repos/dmalis/shepherdr/commits/<sha>/check-runs`) all ended `success`. Still running: wait, up to 30 minutes.
   One call waits at most 9 minutes (a shell call's limit), then ends `wait`; called again, it counts the 30 minutes
   from the first wait, which the state keeps.
6. **Trial**: the state says `fork/bin/trial` passed on that head SHA. The trial records each PASS there itself,
   with the commit's tree; nothing else writes it.
7. Merge: `gh pr merge <pr> -R dmalis/shepherdr --merge --match-head-commit <sha>`.
8. Verify: the PR's `mergeCommit`, after `git fetch origin main`, is origin/main's tip or its ancestor; its parents are
   the old main tip and the head; its tree is the head's tree; the release SHA is its ancestor. The state records it as
   the candidate and the release as merged.
9. **Main's checks** on the merge commit, as below, before install.

A failed ancestry check says only what it found ("<release sha> is not an ancestor of <sha>"), never a guess at why.
Nothing repairs main by force.

### Main's checks

A release sync's candidate on main (its merge commit, or main's tip on the install-main path) installs only after its
checks on that exact SHA, read from `gh api repos/dmalis/shepherdr/commits/<sha>/check-runs`. Our own merges don't
wait for them: CI reports after the install ([Installing our own merges](#installing-our-own-merges)).

- `fork-check` always. Our workflow has no `paths-ignore`, so a push run always comes.
- `check` when a run is expected. Upstream's push trigger skips a push whose every changed file matches its
  `paths-ignore` (`**/*.md`, `docs/**`, read from the candidate's own `check.yml`). The run lists the files changed
  between main's old tip and the candidate. Any file outside those patterns means a run is expected.
- A later commit of main's first-parent line that contains the candidate covers it too, as for [CI after the
  install](#installing-our-own-merges): for each check, the newest finished run there counts. A failure there holds,
  and so does the candidate's own failure: a newer pass never clears it.
- A cancelled `check` run counts as never run: upstream's workflow cancels a push run when main moves again, and the
  newer push's run covers the same code. The newest finished run after the candidate then decides. Until one
  finishes, the gate waits and says "waiting for the newer run". `fork-check` runs once per SHA on main, so no newer
  push cancels it: a cancelled one is a failure.
- An expected run that hasn't appeared or ended after 30 minutes (a newer run included), ended other than `success`,
  or can't be read: **held** (kind `gate`).
- No `check` run expected: the candidate's diff from the last SHA whose `check` passed touches only those ignored
  paths, or a later commit's newer run covers it (as above), and the trial still runs on the candidate. Neither (no
  such SHA, and no later commit on main yet once `fork-check` passed): **held**. For a sync, the merge commit's tree
  is also the PR head's, whose `check` passed (step 5).

### Finishing the run (Codex points 10 and 14)

The sync PR is not the task's own pull request, so the run can't finish through `ready`'s pull request path:

- `ready --summary` after the merge leaves the task Ready as "nothing to merge", waiting for the person's Accept.
- `ready --pr <n>` refuses a merged pull request (upstream issue 1595's case: "only an open one can be taken").
- `ready --nothing` and `--told` refuse a branch with commits that origin/main, as the worktree last fetched it,
  doesn't hold.

What works: `git fetch origin main` in the run's worktree after the merge, then `ready --told "<report>"`. The
branch's commits are then in `origin/main`, the run counts as unchanged, and it is done without review or merge
(`quiet_ready`). The review gate was ours (`merge`, step 2).

`commands.in_base` also accepts the local `main`, which herdr-task fast-forwards after merges, and `merged_here` reads
the task's recorded own work. So in some histories `--told` would pass without the fetch, or `--summary` would finish
at once. The fetch makes the route the same in all of them, and the run never uses `--summary`. Build task 3's tests
run the table with local main stale and fast-forwarded, with and without recorded own work, and through
`tick.facts` as the tick would see the run.

#### Completion commands

| Outcome | Before it | Command |
|---|---|---|
| Nothing new | — | `herdr-task ready <run> --folder <space> --nothing` |
| Installed, after a merge this run | `git fetch origin main` | `… --told "<what's new>"` |
| Installed, no merge this run | — | `… --told "<what's new>"` |
| Held, pushable draft | push to `sync/vX.Y.Z`, open or update the draft PR, `git reset --hard <the run's start>` | `… --told "Held: …"` |
| Held, unresolved merge | `git merge --abort`, then reset as above | `… --told "Held: …"` |
| Held, no update permission | merged already: `git fetch origin main` | `… --told "<version> is ready to install"` |
| Rolled back | as installed | `… --told "Rolled back: …"` |
| Unknown | `herdr-task alert`, as installed | `… --told "…"` |

`finish` prints the right one from the state, runs the `git fetch origin main` itself when the run merged, and checks
the branch is in a state the command accepts.

#### What was tried

On a throwaway git repo (a bare repo standing in for GitHub, `gh` faked, herdr-task's own `cmd_ready`,
`review_refusal` and `quiet_ready` called in-process with the task store and agent lookups mocked, as
`test/test_herdr_task.py`'s `MergedOnlyWithOwnWork` does). No hc, no live session, no GitHub. Each case's result:

| Case | Result |
|---|---|
| Review gate, no round | refused: "your final commit … isn't reviewed" |
| Review gate, a round on another commit | refused |
| Review gate, a round on the head | passes |
| `ready --summary` after a merge-commit merge | accepted, but left Ready, "nothing to merge" (not done) |
| `ready --pr 5` after the merge | refused: "Pull request #5 is merged: only an open one can be taken." |
| `ready --nothing` / `--told` after the merge, before a fetch | refused: "its branch … has commits of its own" |
| `git fetch origin main`, then `ready --told` | done (quiet: told) |
| `ready --told` with the branch not merged | refused |
| Held: pushed `sync/…`, branch reset to its start, `ready --told` | done |
| Held: `ready --told` during an unresolved merge | refused (uncommitted changes); after `git merge --abort`: done |
| `ready --nothing` / `--told` on an untouched worktree | done |

Not tried: the same on a real throwaway core with a real worker (the first build task's tests do it), and the real
`gh pr merge --merge` on GitHub.

## Held runs (Codex point 15)

The held record, in state, one per blocker:

| Field | Meaning |
|---|---|
| `release` | tag and SHA |
| `kind` | `conflict` (unresolved local merge), `draft` (pushed branch and draft PR), `trial`, `gate`, `install`, `hooks`, `permission` |
| `blocker` | the patch's issue number when a patch blocks, else the gate's name; plus one sanitized line |
| `branch`, `pr`, `head` | for `draft` |
| `files` | for `conflict`: the conflicted paths; nothing is committed or pushed |
| `first_seen` | when this blocker first held a release |
| `question` | `null`, or `{asked_at, run, answer}` |
| `issue` | the `sync-blocked` issue |

- An unresolved merge is never committed or pushed. The next run redoes the same merge from the recorded SHAs and meets
  the same conflict; what the last run tried is in the `sync-blocked` issue, in plain words.
- A pushable draft lives on `sync/vX.Y.Z` with a draft PR. The next run checks it out and carries on.
- A newer release while held: the record moves to the new release when the same blocker holds it, and keeps its
  `first_seen` and `question`. Another blocker starts its own record.
- **The 24-hour question**, once per blocker: when `now - first_seen > 24 h` and `question` is null, the run asks with
  its question tool ("Wait for the fix" / "Install `<release>` without `<patch>` for now"), records `asked_at` first,
  and waits. Later runs see the asking run open and end `--nothing`. An answer is kept; "wait" isn't asked again until
  the blocker changes. If the asking run ended without an answer, the next run asks once more, never more.
- The person hears of a held record once: the run that first holds it ends `--told "Held: …"`. Later runs held by
  the same record, with nothing new to say, end `--nothing`.

## Patch inventory and issue follow-up

Only as far as the sync run needs them.

**Inventory (Codex point 16).** What we carry is what the candidate carries, not the open issue list:
- Each patch, once merged, has its own file in the patch list at main, `fork/patches/<issue>.json`: its issue, files
  and test files. One file per patch, so patches built side by side merge without a conflict (before, they all
  appended to one `fork/patches.json`, and every rebase conflicted there). The sync run reads the list at the
  candidate SHA (`fork/sync/patches.py`'s `read`, the one loader, which still reads an older SHA's
  `fork/patches.json`). Patches still being built aren't in it, so they are neither tested nor counted.
- A patch dropped in the sync PR leaves the list there, and its issue gets `fixed-upstream`. It is closed only after the
  install that no longer has it is healthy.
- After a healthy install, `fork/bin/sync issues` puts "carried since `ours-…`" on each listed issue's status line that
  lacks it, in one pass that writes only the issues whose line or labels change (`fork/sync/issues.py`). The tag is
  the first install that carried the fix; later installs leave it.
- Our pull requests say `Part of #n`, never `Closes`, so no merge closes a carried patch's issue.

**Upstream issues (Codex point 17).** The run's report lists the person's upstream issues closed or answered since the
state's `issue_cursor`:
- `gh search issues -R eliasstravik/shepherdr --author @me --updated ">=<cursor>"`: no `--state`, so both states come.
- A closed one counts as fixed only when its closing pull request's merge commit is an ancestor of the release taken.
- Upstream issues are written "upstream issue 1556": no `#`, no link (the upstream-issue skill).
- A rethink question is keyed by the upstream issue's URL in state, so it is asked once.
- The cursor moves to the run's start time (its `select`) only when the run ends installed: that report lists the
  issues, so a run that tells nothing never skips a reply. `preflight` and `select` print it.

## GitHub destinations and public text (Codex points 7 and 8)

- Every `gh` call in `fork/` names `-R dmalis/shepherdr`. The only exception is the read-only search above
  (`-R eliasstravik/shepherdr`). Nothing in the run writes to upstream; posting there stays with the upstream-issue
  skill, which says what needs the person's yes.
- The run never says ready with a summary, so herdr-task's cached repo (`github.py`'s `github()`) opens no pull request
  for it. Other fork tasks: `preflight`'s repo check is the same one their briefs ask for.
- Built-in feedback (`herdr-task feedback`) goes to the Assistant, who asks the person; its repo is the person's
  `feedback_repo` setting (upstream by default). The run never files it.
- Everything bound for GitHub (PR bodies, issue text and comments) passes `public-check` first. It refuses home
  paths, `~/` paths, host and machine names (the config's hostname among them), emails, tailnet host names, and installer
  or log lines (`NOT DONE`, `✗`, `(all its output:`). Outcomes are written in fixed words from the state's fields.
- `--told` text goes to the space's chat, not GitHub; it follows the same words anyway.

## The schedule (Codex point 13)

"Upstream sync", created by the person's Assistant on the serving machine:

```
herdr-task auto add "Upstream sync" --when "daily 6:00,18:00" --space <the space> --worktree \
  --prompt "Follow the upstream-sync skill."
```

It starts with update permission off: the person turns it on later with `herdr-task auto edit <it>
--may-update-shepherdr on` (refused in a task's terminal). Times are the machine's local time (`automations.py`).

**Before it is created:** the pipeline config exists; `fork/bin/sync preflight` and `baseline` pass by hand from the
space's own folder.

**Before update permission goes on**, each checkable:
1. Every build task below is merged, and `fork-check` and `check` are green on main.
2. `fork/bin/trial` passed on origin/main, and failed once on a branch with a deliberately broken herdr-task.
3. The rehearsal passed on main's exact SHA.
4. The machine: the schedule's runs show the config's hostname; `date +%Z` there gives the config's time zone; `herdr-task
   auto show <it> --json`'s `next_run` is the next 06:00 or 18:00 in that zone.
5. One real scheduled run, permission off, ended **held** "`<version>` is ready to install", naming main's SHA as the
   candidate and the captured baseline (the live install is behind main today, so "nothing new" can't come first).
   Its trial passed and nothing moved. The "nothing new" path is proven by build task 3's tests on throwaway state,
   and for real by the first run after the first healthy install, which must end `--nothing` in one line.
6. A real reviewer started in a sync run's worktree, with the run's reviewer settings, came up without a prompt nobody
   answered ([Open questions](#open-questions), 1).
7. The install folder is clean, the baseline is captured, and the repo allows merge commits.
8. The person says yes.

## Installing our own merges

Once the pipeline is proven, an improvement merged into main is installed soon after, not only at 06:00 and 18:00.

**The trigger.** A second schedule in the same space, "Install merged":

```
herdr-task auto add "Install merged" --when "when a task is merged" --space <the space> --worktree \
  --prompt "Follow the upstream-sync skill's install-merged steps."
```

Every task merged in this space's folder starts one run (`automations.py`: the `merged` event). A schedule's own runs
never set it off, and sync runs end with `--told`, which isn't a merge event, so it can't loop. It is a second
schedule rather than an event added to "Upstream sync" so that its update permission is the person's own switch, and
its runs never take a release.

**What its run does.** The same commands and the same state as the release sync, minus release selection, and with
our merges' own install policy:

1. `preflight --pending "<the merged task's title>"`: the same lease. A run that finds the lease taken (or the
   pipeline `broken`) records the merge in `pending` (its time and title), in the same lock, and ends `--nothing`. The
   lease's owner installs it (step 6). A run that takes the lease over records its merge too, since it first resumes
   the old owner's candidate. A title that fails the public check is kept as "a merged task".
2. `baseline`, as in [One run](#one-run).
3. `settle`: origin/main's tip, fetched now and pinned by SHA. No waiting: each install takes whatever main holds when
   it starts, so merges that land during an install go in together with the next one, which starts right after it.
   The pin also clears the `pending` merges recorded before it (main held them by then). Its path:
   - **nothing**: main's tip is installed (an ancestor of the baseline), quarantined (below), or already held on a
     gate.
   - **skip**: every path changed since the baseline is under `fork/`, `docs/`, `.agents/`, `.claude/`, `.github/`,
     `test/`, or is a Markdown file at the root. Nothing is installed and the baseline stays. A test
     (`fork/tests/test_merged.py`) pins this list against the installer's `share_items` and `source_items`, so a new
     shipped folder breaks it.
   - **install-merged**: phase `settled`, the candidate is the tip, and the release is the newest upstream release
     main holds.

   A `settled` run that stopped settles again at main's new tip. When that finds nothing or a skip, nothing was
   installed, so the phase goes back to the finished one it settled from.
4. The rehearsal, when `settle` says `rehearse` (below).
5. `install <tip>`, `health <tip>`, and `rollback` when health fails, with quarantine and tag as for a sync.
6. `finish`. It reads `pending` under the same lock that lets go of the lease. When a merge is pending it keeps the
   lease and says **again**: the run goes back to step 3. This also holds after a skip, a nothing, or a release-sync
   run that owns the lease: no merge is stranded. A release sync may take the lease between two installs. A run that
   went more than once tells every round in one `--told`, and its last words follow what is installed now: a
   rollback before the run's last healthy install is over, said once as "An earlier try rolled back; the next install
   is healthy." after what's new, never as "Rolled back: … back on <the old version>". A hold still standing goes
   before what's new; one a later healthy install cleared is over, and not told. CI's words come after (below).
7. `ci`, when `finish` says `next: ci` (below). It gives the completion command.

**Our merges' install policy.** `install` has two policies, chosen from the run's state:
- **release** (a release sync's paths): phase `tried` or `merged`. The trial passed on the candidate's tree, and
  main's checks passed on that exact SHA (waited for, as in [Main's checks](#mains-checks)). Unchanged.
- **ours** (`install-merged`): phase `settled`, its own way into `installing`. No trial, and no wait for main's
  checks: in this space, our merges merge and install right away, and CI reports afterwards. Everything else stays:
  the folder at the baseline, the quarantine, the release's ancestry, the rehearsal gate, the hooks check, the hold
  patch and the update permission.

`install` refuses a policy that doesn't fit the state. An `install-merged` run that isn't `settled`, or a release
sync's state that is `settled`, installs nothing.

**What health reads instead of the trial.** Two health lines, for every install and rollback, that take seconds:
- **web**: the built web app is in Shepherdr's folder (`web/dist/index.html`). Live, the running service also serves
  it: its health says the id in its `service.json`, and `/` (asked on 127.0.0.1 with the service's own token, as the
  CLI asks) is the built page, not its "isn't built" page.
- **tasks**: the installed herdr-task answers `herdr-task list --json` in a scratch store and folder of its own. It
  never touches the person's task lists or hc.

**Quarantine without a trial.** A tip whose shipped files are the same as a quarantined commit's stays out: every
path between them is one that installs nothing (the skip list). So a docs-only merge on top of a failed install
doesn't clear it, but a change to a shipped file does. `settle` ends such a run as nothing, and `install` refuses it
(gate `quarantine`).

**CI after the install.** CI on main reports after our merges install:
- What counts for an installed SHA is, for `check` and `fork-check` each, the newest finished run on that SHA or on a
  later commit of main's first-parent line. A `cancelled`, `skipped` or `stale` run doesn't count: CI cancels older
  main runs when main moves, and a later run covers the SHA. When `check`'s push trigger skips the SHA's push
  (`paths-ignore`), an older commit with the same code counts.
- `finish` reads nothing from GitHub and lets go of the lease first, so the next install never waits for CI. While
  any install of ours has no final verdict, it says `next: ci`. Each install of ours is recorded in `ci` as pending
  when it goes in, and stays there until its verdict is final, however far the installs history moves on. Then `ci` reads every such install's verdict, however
  many installs came after it, and waits for the run's own, in calls of at most 9 minutes, for up to 30 minutes after
  the install. It then gives the completion command.
- A red result is told once per failure, in the run's `--told` words: which check failed and on which commit, that
  CI never rolls back, and the recovery point. One failed run on a later merge decides the verdict of every install
  before it, so those installs share one sentence ("CI on main failed after 5 installs of …: fork-check failed on
  <commit>"), and a failure (check and commit) another run already told is said no more. The person's Assistant can
  then open a fix task. A result that comes later, or no finished run within 2 hours (missed), is told by a later
  run. Telling and marking told happen under one lock, the words made again there, so two runs never both tell it.
- Nothing rolls back on red CI. The newest install whose CI passed is kept as `recovery`: its tag and SHA. A release
  sync's install counts, since its checks passed before it installed. The person can ask to go back to it. Going back
  is an ordinary update of the install folder to that tag, run by the person or under their yes.

**How often.** As soon as possible, with no quiet wait, no gap between installs, and no daily or per-run cap. Only
one install runs at a time (the lease). Each install restarts the service for a few seconds, which the person accepts
for having every fix at once. `broken`, a quarantined tip, or a held gate stops it the same way as the release sync.

**The rehearsal stays the gate for the pipeline's own code.** `install` refuses unless the state records a passing
rehearsal for the pipeline's own code at the candidate (a hash of `fork/bin/` and `fork/sync/` there). This holds for
every install, ours too. The first install of all waits for the rehearsal in [The rehearsal](#the-rehearsal). After
that, `settle` says `rehearse: true` when the tip's pipeline code has no passing rehearsal. The run then rehearses
the tip with its own code: `fork/bin/rehearse <tip> --own-code`, from the run's worktree checked out at the tip, on a
scratch root only. `--own-code` refuses at once when the code running isn't the tip's. Then it installs. A failed
rehearsal: **held** (gate `main-rehearsal`).

**Held records of this path** name their gate with a `main-` prefix (`main-rehearsal`, `main-hooks`,
`main-permission`, ...) and the held tip as `--head`. A release sync's `select` doesn't count them, and no 24-hour
question is asked about them: a new merge is the fix. A healthy install clears them as it does a release's.

**Turning it on.** Created with update permission off, like "Upstream sync", and only after that schedule's
conditions all hold and one release-sync run has installed for real. Its permission goes on with the person's own
yes, a separate one.

## Codex's points

| # | Point | Decision | Where |
|---|---|---|---|
| 1 | A failed candidate becomes the recorded install | Baseline in state; first run captures the live SHA and source; tag pushed only after health; failed SHA quarantined | [First run's baseline](#the-first-runs-baseline-codex-point-1), [Rollback](#rollback); `fork/sync/state.py` |
| 2 | Updater may install another checkout or machine | Machine, installed CLI, recorded source and candidate checked before anything moves | [Before anything moves](#before-anything-moves); `install.py` |
| 3 | Failure, unknown outcome, failed rollback | JSON state read, not exit codes; 40-minute unknown; health; rollback verified separately; `unknown` and `broken` outcomes | [Reading the outcome](#reading-the-outcome), [Health](#health-codex-point-3), [Outcomes](#outcomes) |
| 4 | Install vs live-service and agent-config rules | One restart, by the update only; hook writes simulated on copies and held; propagation held by the run's own hold until health, the installer kept off it by one patch at `hold_paths` | [Narrow exceptions](#narrow-exceptions); build task 5 |
| 5 | Two runs move the same checkout | `flock` plus a lease by task; phases resume | [Serialised runs](#serialised-runs), [Phases](#phases) |
| 6 | Trial isolation incomplete | Named core and session, clean env, scratch templates and worktree root, candidate executables, localhost, no machines, made-list cleanup | [fork/bin/trial](#forkbintrial) |
| 7 | Alternate GitHub write paths | `-R` on every call; no `ready` PR for syncs; feedback never filed by the run | [GitHub destinations](#github-destinations-and-public-text-codex-points-7-and-8) |
| 8 | Private details and raw output going public | `public-check` before GitHub; fixed words from state | same |
| 9 | Unreleased upstream deployed | Tags from `ls-remote upstream`, exact pattern, peeled SHA, on upstream main; baseline release checked | [Release selection](#release-selection-codex-point-9) |
| 10 | Merge route, completion, final check | `merge <pr>` with its gates; `fetch` then `--told`; main's check or tree equality | [Merge and finish](#merge-and-finish) |
| 11 | Ancestry diagnosis, hidden resolutions | Expected release SHA recorded; findings stated without causes; remerge diff for the reviewer | [Reviewer's inputs](#the-reviewers-inputs-codex-point-11) |
| 12 | Review gate untested; tests outside CI | Deterministic commit; refuse, wrong-commit refuse, accept; `fork-check` workflow | [What it does](#what-it-does), build task 1 |
| 13 | Update permission before readiness | Created off; eight conditions | [The schedule](#the-schedule-codex-point-13) |
| 14 | Setup branch and lifecycle | Space on `main` checked; milestones in phases; tested completion commands | [Completion commands](#completion-commands) |
| 15 | Held runs not resumable | Held record per blocker; conflict vs draft; question once | [Held runs](#held-runs-codex-point-15) |
| 16 | Patch list loses patches | The patch list (`fork/patches/<issue>.json`) at the candidate; retire after a healthy install; `Part of` | [Patch inventory](#patch-inventory-and-issue-follow-up) |
| 17 | Issue follow-up misses or repeats | No `--state`; cursor; fix proven by ancestry; keyed by URL | same |

## Build tasks

In order, each its own pull request, `Part of #2`, reviewable in one sitting. Ours go under `fork/`; Python tests
import `test/home_guard.py` first (`sys.path` gets `test/`). No upstream file changes except the ones named.

1. **CI and the state module.** `.github/workflows/fork-check.yml` (job `fork-check`: `python3 -m unittest discover -s
   fork/tests -v`, `python3 -m py_compile` on `fork/bin/*` and `fork/sync/*.py`, `bash -n` on any shell script under
   `fork/`). `fork/sync/state.py`: atomic writes, `flock`, lease, phases. `fork/tests/test_state.py`: two writers, a
   crash between phases, lease takeover only from a done owner.
2. **The trial.** `fork/bin/trial`, `fork/tests/test_trial.py` (env building, made-list cleanup, fakes for hc and the
   service). The real run, by hand on this task's machine: PASS on origin/main; FAIL on a branch whose
   `review_refusal` always passes; nothing left behind. Pins: a test that `review_refusal`, `HERDR_TASK_TEMPLATES` and
   `tasks.worktree_root` still exist under those names.
3. **Release and gates.** `fork/sync/release.py`, `fork/sync/gate.py`, `fork/sync/public.py`, the `select`,
   `review-inputs`, `merge`, `public-check` and `finish` subcommands. Tests with a real scratch git repo and bare
   remote, `gh` faked: tag selection (a fork-side tag, a non-release name, untagged commits), every merge gate,
   `public-check`'s refusals. A pin test that runs the completion table's cases against herdr-task (the try above).
4. **Install, health and rollback.** `fork/sync/install.py`, the `baseline`, `install`, `health`, `rollback`
   subcommands. Tests with `update-shepherdr` and `shepherdr doctor` faked: every outcome row, resume from each phase,
   the hooks check, quarantine, and the refusal to install without a passing rehearsal recorded for the candidate's
   pipeline code. A pin test on `installed.json`'s keys and `update-shepherdr --status --json`'s fields.
5. **The hold patch**, the one upstream edit: `bin/shepherdr`'s `hold_paths` ([Narrow exceptions](#narrow-exceptions)),
   with its own `patch` issue (the fork-patch skill), and the run's own hold in `fork/sync/install.py`. Tests in
   `fork/tests/test_hold_patch.py`, on a throwaway root, with the run's hold written first and
   `SHEPHERDR_KEEP_SYNC_HOLD=1` on the update: after a whole update, after an update stopped between `finish_install`'s
   first `save_record` and its `release_hold`, and after a failed one, both real hold files still carry the run's line
   and `base.sync_held` returns it; without the variable the hold behaves as upstream's; `shepherdr doctor` without it
   lets go. Also `fork/patches.json`, its first line this patch.
6. **The rehearsal** (below), as `fork/bin/rehearse <sha>`, with its test.
7. **The skill.** Rewrite `.agents/skills/upstream-sync/SKILL.md` steps 1–7 around these commands; take out its
   "draft" status. The fork-patch skill's step to add a line to `fork/patches.json`.
8. **Turn on.** No code: the person's Assistant writes the config, creates the schedule (permission off), and the
   conditions in [The schedule](#the-schedule-codex-point-13) are checked one by one. Then the person's yes.
9. **Install merged.** The `settle` and `ci` subcommands, `pending` and `finish`'s `again`, the skip list with its
   pin test, our merges' install policy (phase `settled`), the web and tasks health lines, the quarantine by shipped
   files, CI's verdict after the install and the recovery point, and the run's own rehearsal (`fork/bin/rehearse
   --own-code`; the rehearsal-hash gate in `install` is task 4's). The skill's install-merged steps. Then the person's
   Assistant creates the "Install merged" schedule, permission off, and later on with the person's yes.

## The rehearsal

`fork/bin/rehearse <sha>` must pass on main's exact SHA before update permission goes on. Everything is under one
scratch root; nothing touches the live install, the real home's files or the live session.

1. A scratch clone of the space (`git clone --shared`), detached at the baseline: the stand-in install folder.
2. `./install.sh --root <root>` from it: a whole install under `<root>` (no service, no hooks: a scratch root gets
   neither).
3. `baseline --capture` against `<root>` (the commands take `--root`, used only here and in tests).
4. Install `<sha>` the live way, except the update itself: `<root>/.local/bin/shepherdr update --root <root>` (the
   installed copy, which hands over to the clone's installer, as live), because `update-shepherdr` only runs inside a
   real schedule's run. With `SHEPHERDR_KEEP_SYNC_HOLD=1`, as live.
5. Before health: both hold files under `<root>` carry the run's line, and `sync-hold.install` is gone. `health <sha> --root <root>`: must pass, and
   after its doctor the hold files are gone. The hooks simulation ran against `<root>`'s hook files and found nothing
   to write.
6. A forced failure: health is told to fail (a test flag, `FORK_SYNC_FORCE_HEALTH_FAIL=1`, which only a scratch root
   obeys), so `rollback` runs: back to the baseline, updated, and `health <baseline>` passes. `installed.json`'s
   version and files are the baseline's again.
7. A second rehearsal where the update itself fails (a candidate commit that breaks `herdr-task`'s compile): the
   outcome is read, health fails, rollback is verified. The installer prints `NOT DONE` and exits 0 for that commit,
   so the runner reads it as `ok`, as live; health's `whole` line is what fails it.
8. Remove `<root>` and the clone.

Steps 6, 7 and 4–5 run in that order on the one root, each a first run of the pipeline (a fresh sync state under
`<root>`, with the gates the rehearsal isn't about, the trial, the checks and the release, recorded there), since a
healthy install makes the candidate the baseline. The stand-in for `update-shepherdr` runs the update the way its
runner does (`self_update.run_update`: in its own process session, `ok` only on exit 0), and the fork's main is
fetched from the space through an `insteadOf` rule, not from GitHub.

The pipeline code that runs is the checkout's own `fork/bin/sync`. A pass is recorded in the state's `rehearsals`
under that code's hash, as committed (`install.pipeline_hash`), with the commit it installed; code with uncommitted
changes is rehearsed but never recorded. So a pull request's rehearsal covers main after the merge, whose pipeline
code is the same, and the run that rehearses a candidate (Installing our own merges) runs the candidate's own code.

What the rehearsal can't show, the first real installing run shows: `update-shepherdr`'s runner, the service restart,
and the live health lines (Assistants, service answering).

The rehearsal skips the live terminal check (`may_ask`: its updater is its own), so unit tests in `fork/tests/` cover it instead.

## Open questions

1. **The run's reviewer and its trust prompt.** Each run has a new worktree. A reviewer CLI may ask to trust it, and
   nothing may answer that for the person (AGENTS.md). docs/agents-and-terms.md also took out pre-trusting a Codex
   reviewer with `-c projects=…`. **Recommendation:** before update permission goes on, start the run's real
   reviewer once in a sync worktree and see. If it asks, the person picks, in the CLI itself, a documented way that
   covers every run's worktree (for example trusting the worktrees' parent folder, if that CLI documents it); until
   then a run that meets the prompt is **held** at review. Never a pre-trust flag or written trust.
2. **When the rounds run out on a sync.** Ordinary tasks may merge a last fix unreviewed. **Recommendation:** a sync
   never does: no round on the exact head means held, and the person is asked. The sync installs itself onto the
   tool they use every day.
3. **Built-in feedback's repo.** It defaults to upstream. **Recommendation:** set the person's `feedback_repo` to
   dmalis/shepherdr, so Shepherdr feedback lands in our issues first and reaches upstream only through the
   upstream-issue skill.
4. **How soon, and how often, merged work installs.** Each install restarts the service for a few seconds.
   **Answered:** as soon as possible. No quiet wait, no gap, and no daily or per-run cap. One install at a time, each
   taking main's tip when it starts. Our merges skip the trial and don't wait for main's checks. Health covers what
   the trial did (the web app served, herdr-task answering). CI reports afterwards: a red result is told once per
   failure, nothing rolls back on it, and the newest install CI passed is kept as the recovery point.
5. **A hooks change in a release.** When a release adds a hook, the scheduled run holds it. **Recommendation:** the
   held message tells the person to run `shepherdr update` once themselves after reading what the hook does; a yes in
   the chat is not enough, because the run must not write an agent's config.
