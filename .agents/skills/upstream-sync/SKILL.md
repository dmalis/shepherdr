---
name: upstream-sync
description: Take upstream Shepherdr's newest release into this fork, adapt our patches, try it and install it. Use for the "Upstream sync" schedule's run, when asked to sync or update from upstream, or when a sync is held.
---

# Upstream sync

The procedure for one run. FORK.md's rules apply throughout; `fork/specs/sync-pipeline.md` is the reference for why
each check exists. You decide, and `fork/bin/sync` checks: every step that reads or writes the sync's state, git refs
or GitHub goes through one of its subcommands. The run ends in exactly one outcome: **nothing new**, **installed**,
**held**, **rolled back** or **unknown**.

## Calling fork/bin/sync

- Run it from this run's worktree. Every subcommand except `public-check` and `held` takes `--run <this task's key>
  --folder <this space's folder>`; the steps below leave those out.
- It prints one JSON line. `ok: true` (exit 0) means the step passed. Otherwise `why` says what it found and
  `outcome` says what to do:

| `outcome` | Do |
|---|---|
| `wait` | Call the same step again. One call waits at most 9 minutes; the state keeps the clock. |
| `held` | The run is **held** at the gate it names (`kind`, `gate`): [Held](#held). |
| `failed` (install) | The update failed: run the step `next` names (`health` anyway, which leads to the rollback, or `rollback`). |
| `rollback` (health) | Run `rollback`. |
| `unknown`, `broken` | Stop moving anything: go to step 7. The lease stays, so the next run resumes or the person looks. |
| `nothing` | Another run owns the lease and is open: go to step 7. |
| `refused` (public-check) | Rewrite the text in fixed words, without the problems it names, and check again. |
| `stop` | A step came out of order or a fact is missing. Do what `why` names first. If this run can't, go to step 7. |

- Text for GitHub (pull request bodies, issues, comments) is written to a file in your scratch folder, never the repo,
  and passes `fork/bin/sync public-check <file>` before `gh … --body-file <file>`. Outcomes are told in fixed words
  from the JSON fields: never paste installer output, log lines, paths or host names.
- Name the repo on every `gh` call: `-R dmalis/shepherdr` (the upstream search in step 3 is the one read-only
  exception).

## 1. Preflight

1. Note the worktree's HEAD before you change anything: it is the run's **start**, which held runs reset to.
2. `fork/bin/sync preflight`. It checks the repo and the machine and takes the run's lease.
3. `resume` set: an earlier run stopped mid-way. `resuming` names its `path`, `release`, `candidate` and `sync`
   branch. Carry on from its phase, never from the top:

| `resume` | Carry on with |
|---|---|
| `selected`, `branch-pushed` | Step 2 (select again). If `sync/<tag>` is already on origin, reset this worktree to it in step 3 instead of merging again; its review starts over in this run. |
| `tried` | Path `take`: step 5 with the sync's `pr`. When it is null, find it with `gh pr list -R dmalis/shepherdr --head <sync branch> --state all --json number,state` (a merge that died before it was recorded leaves it merged: `merge` verifies that). Path `install-main`: step 6. |
| `merged` | Step 5: `merge <sync's pr>` again reads main's checks. Then step 6. |
| `installing` | Step 6's `install <candidate>`: it reads the outcome of the update already asked for, and never asks twice. |
| `installed` | Step 6's `health <candidate>`. |
| `rolling-back` | Step 6's `rollback`. |

From `tried` on, the state already holds the selection: run `select` only where the table says.

## 2. Decide

1. `fork/bin/sync baseline`. The first run of all is refused with "no baseline is recorded yet": run `baseline
   --capture` once. A `held` here means the install folder moved since the last install (someone installed by hand):
   [Before a release is selected](#before-a-release-is-selected).
2. `fork/bin/sync select`. It reads upstream's newest stable release from the `upstream` remote, pinned by SHA, and
   picks the `path`:

| `path` | Do |
|---|---|
| `nothing` | **Nothing new.** Go to step 7. |
| `install-main` | Our merged patches await delivery: step 4's trial on `candidate` (origin/main's tip), then step 6. |
| `take` | Step 3. |

`held` in its line lists the blockers already holding this release: read them with `fork/bin/sync held` and carry
on from their records ([Held](#held)).

## 3. Take the release

`release` (tag and SHA) and `main` come from `select`'s line. Use the SHAs, never the names.

1. `git reset --hard <main>`, then `git merge --no-ff <release sha> -m "Take upstream <tag>"`. This run's own branch
   holds the sync's commits, so review rounds record on them.
2. Resolve each conflict upstream-first, then put our intent back on top. The resolving-merge-conflicts skill helps,
   and each patch's issue says what its patch must keep doing. A conflict you can't resolve in this run: **held**
   (kind `conflict`).
3. Our patches are the lines of `fork/patches.json` at the merge, never the open issue list. For each one:
   - read what upstream changed in its files (`git log -p <old release>..<release sha> -- <its files>`) and adapt it
     as the fork-patch skill's step 4 says;
   - upstream now does the same thing: drop the patch and its line, comment on its issue and label it
     `fixed-upstream`. It closes only after the install without it is healthy (step 7);
   - one you can't adapt in this run: **held** (kind `draft`, blocker its issue number).
4. Run each line's `tests`, `python3 -m unittest discover -s fork/tests` and `bin/sync-shared --check`. Patches that
   touch the web app also: `bun install && bun web/build-plugins.ts && bunx tsc`. Never the whole suite: CI runs it.
5. Push: `git push origin HEAD:refs/heads/sync/<tag>`. Open the **sync PR**: `gh pr create -R dmalis/shepherdr --base
   main --head sync/<tag> --title "Take upstream <tag>" --body-file <file>`. Its body:
   - the new versions' CHANGELOG lines, shortened;
   - each patch: kept as is, adapted (how), or dropped (why);
   - the person's upstream issues closed or answered since the `issue_cursor` in `preflight`'s and `select`'s lines: `gh search issues -R
     eliasstravik/shepherdr --author @me --updated ">=<issue_cursor>"` (no `--state`, so both come; a null cursor,
     the first run, leaves `--updated` out). A closed one counts as
     fixed only when its closing pull request's merge commit is an ancestor of the release SHA. Write them "upstream
     issue 1556": no `#`, no link.

## 4. Review and trial

1. `fork/bin/sync review-inputs` writes the reviewer's three files (`files` in its line): our footprint on the release,
   how our patches moved, and the conflict resolutions. It records the pushed head they cover.
2. Review as your Settings block says, with a prompt that names those three files. The reviewer reviews only our side,
   never upstream's own commits. Record each round on the head with `herdr-task reviewed … --commit <head>`.
3. Fixes: commit, push to `sync/<tag>` again, run `review-inputs` again (the new head), then review what changed.
4. A sync merges only with a round on its exact head. Rounds used up without one, or a reviewer stopped at a trust or
   sign-in prompt (never answer it for the person): **held** (kind `gate`, blocker `review`).
5. `fork/bin/trial <head>` (path `install-main`: `<candidate>`). It takes minutes, so run it in the background and
   read its last line: `PASS` records itself in the state; `FAIL: <step>: <why>` is **held** (kind `trial`).

## 5. Merge (path take)

`fork/bin/sync merge <pr>` is the only way a sync PR merges: never herdr-task's own merge (it squashes, which drops
upstream's history and makes every later sync conflict), never `gh pr merge` by hand. It checks the pull request, the
review round, the head's checks and the trial, merges with a merge commit, verifies it, then reads main's checks on
the merge commit. `wait` while checks run; its `candidate` is the merge commit. A failed ancestry check says only what
it found: report that, never a guess at why, and never repair `main` by force.

## 6. Install

1. `fork/bin/sync install <candidate>`. It checks everything before the install folder moves, holds the sync to
   other machines, moves the folder and asks for the update through `herdr-task update-shepherdr`. Never run
   `shepherdr update` or touch the install folder yourself. A `held` with kind `permission` is the schedule not yet
   allowed to update: hold it ([Held](#held)); finish then tells the person the version is ready to install.
2. `fork/bin/sync health <candidate>`. Pass: **installed**: the candidate is the new baseline, its `ours-*` tag is
   pushed, and the held records its release carries are over (`held_over`).
3. `rollback` (health said so): back to the baseline, verified by health on it. `rolled-back`: the failed commit is
   quarantined; comment `report` (after `public-check`) on the open `pipeline` issue, or open one.

## 7. Finish and report

1. After a healthy install: each issue in `fork/patches.json` at the candidate gets "carried since `<tag>`" at the
   start of its status line, in place of "building" or an older "carried since". The rest of the line stays as it
   is: what the fix does and how to try it, what the person decided, upstream links, each pull request's part. A
   `fixed-upstream` issue whose line the candidate no longer has is closed now.
   - **The fixes this install made live land now** (upstream-issue skill: "After a fix lands"). They are our pull
     requests merged since the last install's tag (`git log --merges --first-parent <last ours-* tag>..<candidate>`)
     that change Shepherdr itself: not sync pull requests, and not ones that change only `FORK.md`, `fork/` or
     `.agents/`.
   - Each one's issue gets `not-filed`, unless it already has `fork-only`, `upstream-proposed` or `reverted` and no
     pull request on its status line is "not filed yet".
   - A fix whose pull request names no issue gets its own now (fork-patch skill, step 1), labelled `patch` and
     `not-filed`, with the status line that skill's "Done means" gives. Comment its link on the pull request.
2. `fork/bin/sync finish` (an install adds `--says "<what's new, plain words>"`, with the upstream issues from step 3,
   or searched the same way on path `install-main`). Only an install moves the issue cursor, to this run's start. It checks the worktree, fetches
   origin's main when this run merged, and lets go of the lease when the phase is final.
3. Run each command in its `before` (an alert for an unknown outcome), then its `command` exactly as printed: a
   `herdr-task ready … --nothing` or `--told "…"`. Never `ready --summary` or `--pr`: the sync PR isn't this task's.

The `--told` words go to the person, who doesn't code: what's new for them and what of ours was adapted or dropped;
what waits and why; or what failed. Name the sync PR and each issue by what it is, its link after: "the install
step's terminal check (#25)". A held record the person already heard of ends `--nothing`.

## Held

1. Record it: `fork/bin/sync hold --blocker <the patch's issue number, else the line's gate> --tag <tag> --sha
   <release sha> --kind <kind> --line "<one sanitized line>"`, plus by kind:
   - `conflict`: `--files <the conflicted paths>` (`git diff --name-only --diff-filter=U`). Nothing is committed or
     pushed; then `git merge --abort`.
   - `draft`: commit what you have, push it to `sync/<tag>`, open or update the sync PR as a draft (`gh pr ready <pr>
     -R dmalis/shepherdr --undo`), and add `--branch sync/<tag> --pr <pr> --head <its SHA>`.
   - `trial`, `gate` and the rest, once a sync PR is open: turn it to a draft and add the same three.
   - `hooks`: the line says the update would change an agent's hook file, so the person reads what the new hook
     does and runs `shepherdr update` once themselves. A yes in the chat isn't enough: the run never writes an
     agent's config.
2. Open or update the `sync-blocked` issue in plain words: which patch or gate, what broke, what you tried. Add
   `--issue <n>` to the hold the first time.
3. `git reset --hard <start>`, then step 7.

A later run held by the same record carries on from it: a `draft` from its pushed head
(`git fetch origin sync/<tag>`, then `git reset --hard <head>`), a `conflict` by redoing the same merge with the
issue's notes. Turn its draft back with `gh pr ready <pr> -R dmalis/shepherdr` before step 5. A newer release held
by the same blocker moves the record there.

**The 24-hour question.** `fork/bin/sync held` marks a record `due` when it has held for more than 24 hours with no
answer. Then, once per blocker:
1. `fork/bin/sync hold --blocker <it> --asked`, before you ask.
2. Ask with your question tool: "Wait for the fix", or "Install `<tag>` without `<patch>` for now". Stay open for the
   answer.
3. `fork/bin/sync hold --blocker <it> --answer "<their answer>"`.
4. Without the patch: revert it on the sync branch and drop its line from `fork/patches.json`; its issue says "paused
   since `<tag>`"; carry on from step 4. The hold patch (`test_hold_patch.py` in `fork/patches.json`) never goes:
   install refuses a candidate without it.

### Before a release is selected

`preflight`, `baseline` and `select` can be held before there is a release to record. Nothing was written, so there
is no hold: tell the person with `herdr-task alert "<what, a few words>" --body "<why>"`, add it to the open
`pipeline` issue in fixed words unless it already says so, then step 7.
