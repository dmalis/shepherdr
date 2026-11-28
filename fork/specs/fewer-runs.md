# Fewer agent runs

A schedule starts an agent only when there is work for one, and a burst of merges installs once. The measure is the
count of agent runs and how long each one stays open. No usage numbers are read (AGENTS.md: never read plan usage).

## The need, in the person's words

"can we optimize tokens in any way, tokens you and your monitors use here?" They agreed to a cheap check before the
"Watch upstream issues" run, so an agent starts only when something changed, and to batching "Install each merge",
so a burst of merges is one install.

After a second opinion on cost against what the person sees, the scope was narrowed (the person's yes):
- **Build:** a schedule's check command (a Shepherdr patch) and our watch's check script; a fold for bursts (one run
  at a time, what comes meanwhile is one follow-up run); and the install agent no longer waits on CI.
- **Not built:** scripting the install itself. The health check, the rollback and the device-check notices stay
  exactly as they are, walked by the install agent with the upstream-sync skill.

What it costs today, from the two schedules' own run records (one day):
- **Watch upstream issues**: 21 runs, 16 ended "nothing", 4 "told". It now runs every 4 hours at medium effort to
  save; with the check it can go back to hourly at about the cost of a few runs a day.
- **Install each merge**: 50 runs, 35 "told", 15 "nothing". The "nothing" ones found another run holding the
  install's lease, recorded their merge for it and stopped: a whole agent to write one line. And every installing
  run stays open after the install, calling `fork/bin/sync ci` again and again for up to an hour or two while
  main's CI runs.

Upstream checked: v3.2.24, main 5abe8526; related: none (searches for schedule checks, conditions, quiet periods,
debounce and skips found nothing; upstream's `automations.py` has neither).

## How others do it

- **A cheap condition before the expensive job:** systemd's `ExecCondition=` (exit 0 runs the unit, 1 to 254 skips
  it, 255 or a signal is a failure), GitHub Actions' `if:` and `paths:`, Jenkins' "Poll SCM", cron's `test … && job`.
- **Bursts, one at a time with the rest folded:** GitHub Actions' `concurrency:` (one running, one pending; a newer
  pending one replaces the older), Jenkins' queue (triggers while a build waits collapse into one build). The first
  event runs at once, with no quiet-period delay; what comes during it is one run after it. Chosen over a quiet
  period (Jenkins' quiet period, Renovate's batching), which delays every run, a lone merge too.

## 1. Shepherdr: a schedule's check (a patch, for every user)

`herdr-task auto add|edit … --check "<command>"`; `--check ""` takes it away. The command is the person's or the
Assistant's own: Shepherdr adds none. docs/settings.md says a check must not read an agent's state, usage, sign-in
or config (AGENTS.md).

**When it runs.** When the schedule is due (its time came, or an event it hears), before a task is added:
- with `sh -c`, in the folder its runs work in (`here`: that folder; `worktree`: the repo's main folder);
- for at most 120 seconds;
- with the scheduler's environment plus `HERDR_TASK_SCHEDULE` (its key), `HERDR_TASK_WHY` (what set it off, one line
  per reason: `time`, `merged: SD-12`, …) and `HERDR_TASK_LAST_RUN` (when its last run that started a task began, in
  ms; empty before the first);
- outside the task list's lock and the tick lock, in a thread of the scheduler: a slow check holds up no other
  schedule, tick or news. While it runs, the schedule is `checking` (kept in the list with its reasons); what sets it
  off meanwhile joins those reasons, so one check covers them all.

**What its answer does:**

| Exit | Then |
|---|---|
| 0: there is work | The run starts as it would without a check. Its brief gets "The schedule's check found:" and its output (stdout, the last 4000 characters). |
| 1 to 125: nothing to do | No task, no agent, no news. Its runs record `{at, why, nothing: "check"}` and its first output line. |
| 126 to 255 (126 and 127: can't run, not found), a signal, the time limit, or it can't start: the check failed | Said, never silent (below). |

126 and 127 (can't run, not found) are failures, not "nothing": under systemd a typo in the path would skip every run
quietly.

**A failed check is said, never silent.** An outage (GitHub down, the network gone) must not hide an upstream reply:
- The first failure after a check that worked starts the run anyway, with "The schedule's check failed: <why>" in its
  brief, so its agent does the run as it did before checks and tells the person.
- Further failures in a row start nothing (one outage, one run): each is in its runs as `check_failed`, and the
  schedule's `last_error` (kind `check`) says "Its check failed since 14:00: <why>" in `auto show` and the Scheduled
  tab, until a check works again.
- The check script keeps its own last good checkpoint (section 3), so what moved during the outage is found by the
  first check that works.

**Where people see it.**
- `auto show` / `auto list`: "; checks first" in its line, then "; last checked 14:00: nothing to do" or the error.
  `auto_view` gains `check`, and a checked run reads `ended: "nothing"` (`check_failed`: "check failed").
- The Scheduled tab: History lists a checked run as "Nothing to do · checked first" and a failed one as "Check
  failed · <why>" (today a run without a task reads "Done"); its row shows the schedule's error. No new form field:
  the person sets a check by asking the Assistant, as with `--match` today.
- `Run now` skips the check: the person asked for a run.

**Restart safety.** The scheduler re-execs itself when its code changes. A `checking` schedule that no thread of this
scheduler runs is checked again with the same reasons: no reason is lost, and one task starts at most. Schedules off
(Settings or the plugin), a paused schedule or a stopped space: no check runs, as no run would.

## 2. Shepherdr: one run at a time (fold)

`herdr-task auto add|edit … --fold` (`--no-fold` takes it away). While its last run is open (its task queued,
scheduled or running, waiting on the person too), what sets the schedule off doesn't start another run: it is kept as
`folded: {since, whys, briefs}`. When that run ends (ready, done, or its task removed), one run starts with every
folded reason: its brief's "Set off by" lists each one ("the task "A" was merged … ; the task "B" was merged …").
A check, if it has one, runs first, as for any run.

- The first event starts at once: no delay for a lone merge.
- Its own runs ending never set it off (as today).
- `auto show` says "; one run at a time", and "; 2 waiting for its run to end" while some are folded. The Scheduled
  tab's row shows the same words.
- Kept in the list, so a scheduler restart keeps what is folded.

**Where both live.** A new module `mods/tasks/bin/herdr_task/schedule_gate.py` (the check's run and answer, the fold,
their records and words), called from `automations_pass()` at its one call of `fire()` and from `cmd_scheduler()`
after `one_pass()` (start the check threads); `--check` and `--fold` in `set_auto_fields()` and the `auto` parser
(`cli.py`); `run_ended()` and `auto_line()` for the new records; History's words in `web/plugins/schedules/client.tsx`
and `service/next.ts`'s `ENDED`; docs/settings.md's schedules part. Registered in `fork/patches/<issue>.json`.

**Acceptance.**
- A check that exits 1 starts no task and no agent, and `auto show` says it found nothing to do.
- A check that exits 0 starts its task, and the brief has the check's output.
- A check that fails (127, the time limit) starts the run once and says why; a second failure in a row starts
  nothing and shows the error; a check that works clears it.
- What sets a schedule off while its check runs makes one task at most.
- A check running 100 seconds delays no other schedule's run.
- A scheduler restart in the middle of a check starts one task at most.
- With `--fold`: three merges while its run is open start one run after it, naming all three; a lone merge starts at
  once.

**Tests** (`test/test_herdr_task.py`, new classes `ScheduleCheck` and `ScheduleFold`, a throwaway store and fake hc,
reusing Scheduled's helpers as class attributes): each acceptance line, `Run now` skipping the check, the
`HERDR_TASK_*` variables, and a pin that `automations_pass()` still calls `fire(s, a, why, brief)`.

## 3. Our pipeline (fork-only, labelled `pipeline`)

### The watch's check: `fork/bin/watch-check`

Run in the space's folder by the "Watch upstream issues" schedule. Exit 0 with one line per thing that moved, 1 when
nothing did, 255 on any gh or git error (a failed check: 1 to 125 would read as nothing to do).

It compares with two files in `.private/` (git-ignored, never committed):
- the watch agent's own view, `.private/upstream-watch.json` (written by the agent only after a run succeeded);
- its own last good checkpoint, `.private/upstream-watch-check.json`: `{"since": <ISO time>}`, the start of the last
  check that worked and found nothing. Everything updated before it is in the agent's view. A check that finds work,
  or fails, leaves it as it was, so a run that failed, and anything that moved during an outage, is seen again by the
  next check that works.

The steps:
1. No agent view: exit 0 (the first run records everything).
2. One call: `gh api 'repos/eliasstravik/shepherdr/issues?state=all&since=<since>&per_page=100'` (`--paginate`).
   Work when a number the view watches has a newer `updated_at` than the view keeps, or an issue by the person (`gh
   api user --jq .login`, not written anywhere) isn't in the view.
3. `git fetch -q upstream --tags` (git, no API call): work when there is a `v*` tag the view's `upstream_head`
   doesn't contain, or `git log <upstream_head>..upstream/main -i --grep <n>` finds a commit for a watched number.
4. One call: `repos/dmalis/shepherdr/issues?state=open&since=<since>`. Work when an issue isn't in the view's
   `fork_seen` and has none of the labels `patch`, `pipeline` or `handover`.
5. Nothing: write the checkpoint (this check's start time), exit 1.

Three gh calls a check (the login, two lists) against about ten per agent run. With no checkpoint yet, `since` is
the newest `updatedAt` the view keeps. The watch's brief gains one line: "The schedule's check lists what moved:
look at those first, and still end `--nothing` when none of it is news."

### Install each merge: fold, and no waiting on CI

- **The schedule:** `--fold`. The first merge starts the install at once. Merges that land during it don't start
  agents; when the run ends, one follow-up run installs them all (its `settle` pins main's tip then). The 15 runs a
  day that only recorded a merge go. `preflight --pending` and `finish`'s `again` stay as they are for merges a run
  from elsewhere records (the twice-daily "Upstream sync" holding the lease).
- **No waiting on CI.** Today `finish` says `next: ci` while main's CI hasn't answered for this run's installs, and
  the agent calls `ci` until it does: an hour or two of an open run, which with `--fold` would also hold back the
  next install. Shepherdr already watches main for three hours after each merge and tells the space's Assistant once
  if it goes red, with the failing check and what merged, to open a fix task (`ghnews.main_pass`, the main-red
  notice). So:
  - `finish` gives the completion command at once. The run's installs stay tracked, unresolved.
  - `settle` and `select` (every later run) read main's runs once, without waiting (`merged.ci_read`, one call), when
    an install is unresolved, so the recovery point (the newest install whose CI passed) still moves on.
  - A red or missing verdict that read finds is told once in that run's finish words, as `ci` told it. Shepherdr's
    main-red notice may tell a red main first, but the pipeline can't see that it reached anyone (its watch ends after
    three hours, and GitHub may be down meanwhile), so it never counts as told (review round 1).
  - `fork/bin/sync ci` stays, with `finish --wait-ci` to hand a run to it, for a run that wants the verdict now (the person's ask); no step calls them. The glance (`merged.ci_glance`) never stops a run: a read that fails is left for the next.
  - FORK.md's "Our own merges" step 3 and the upstream-sync skill's step 7 and "CI after the install" say this.
- **Unchanged:** preflight, baseline, settle, the rehearsal, install, health, rollback, issues, `found installed`,
  `found`, the device-check words, and the run's told message. The install agent still follows the skill.

The pipeline's own code changes (`fork/sync`), so the rehearsal runs on a scratch root before it installs (FORK.md: a
change to the pipeline's own code).

### What this task sets, once merged and installed

- Watch upstream issues: `auto edit 1 --check "fork/bin/watch-check"` and its brief's one line. It stays every 4
  hours: going back to hourly is the person's call, and costs about one run per hour that something moved.
- Install each merge: `auto edit 4 --fold`, and its brief loses nothing (the skill's step 7 changes).

The checks run from the space's folder, the main checkout, so they run main's scripts once merged.

## Safety (AGENTS.md: nothing that risks a ban)

- The watch's check calls gh's documented commands with the person's own gh sign-in, read-only, and git. No check
  Shepherdr runs reads an agent's state, usage, sign-in or config; Shepherdr adds no check of its own.
- Nothing drives an agent's interface. The install still goes only through the install step's path (`herdr-task
  update-shepherdr` from `fork/bin/sync install`), with its health check and rollback as they are.
- Fewer agents start, and those that do are briefed as before. CI reads go down (no minute-by-minute `ci` loop).

## Later

- A check for "Install each merge" (main's tip not yet installed), so a follow-up run whose merges the first run
  already pinned starts no agent.
- A quiet period (debounce) for an event schedule, if one needs it.
