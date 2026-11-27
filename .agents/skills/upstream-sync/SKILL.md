---
name: upstream-sync
description: Take upstream Shepherdr's newest release into this fork, adapt our patches, try it and install it. Use for the "Upstream sync" schedule's run, when asked to sync or update from upstream, or when a sync is blocked.
---

# Upstream sync

**Status: draft until #2 is done.** Until then:
- run only steps 1–4;
- the schedule has no permission to update;
- steps 5–6 change only as #2 settles them. Its issue lists the review findings they must answer: the exact
  commit, serialised runs, resumable holds, failed and unknown outcomes, and a verified rollback.

The procedure for one run. FORK.md's rules apply throughout. The run ends in one of four states, each named below:
- nothing new;
- installed;
- held;
- rolled back.

## 1. Preflight

- `gh repo set-default --view` prints `dmalis/shepherdr`. Otherwise stop.
- `git fetch upstream --tags` and `git fetch origin --tags`.
- `new` is the newest stable release on upstream's main:
  `git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --merged upstream/main --sort=-v:refname | head -1`.
  Never take upstream's untagged `main`.
- `installed` is the newest `ours-*` tag (`git tag -l 'ours-*' --sort=-creatordate | head -1`). A tag is pushed only
  after a healthy install, so it always names what really runs.
- Count the open `sync-blocked` issues. If one is open, resume from what it records; don't start over.
- Check that the newest release we took is still an ancestor of origin/main: `git merge-base --is-ancestor <it>
  origin/main`. If it isn't, stop and open a `pipeline` issue with what you found, without guessing at the cause.
  Never repair `main` by force.

## 2. Decide

| `new` already in origin/main? | origin/main beyond `installed`? | Do |
|---|---|---|
| yes | no | **Nothing new.** Report one line, and end |
| yes | yes | Go to 5: our merged patches still need a trial and an install |
| no | – | Go to 3 |

## 3. Take the release

1. Branch `sync/<new>` from origin/main.
2. `git merge --no-ff <new> -m "Take upstream <new>"`.
3. Resolve each conflict upstream-first, then put our intent back on top. The resolving-merge-conflicts skill helps,
   and each `patch` issue says what its patch must keep doing.
4. Find what upstream changed in our areas:
   - `git range-diff <old release>..origin/main <new>..HEAD` shows how our patches moved;
   - `git diff <new>..HEAD --stat` is our whole footprint, and it should stay small.
5. If upstream now does what one of our patches does:
   - drop the patch;
   - say so in its issue;
   - label the issue `fixed-upstream` and close it.
6. Run the tests each `patch` issue lists, plus `bin/sync-shared --check`.
   - If our patches touch the web app: `bun install && bun web/build-plugins.ts && bunx tsc`.
   - Never run the whole suite here. CI runs it on the pull request.
7. Push. Open a pull request into `main`, titled "Take upstream <new>". Its body:
   - the new versions' CHANGELOG lines, shortened;
   - the person's upstream issues this release fixed (`gh issue list -R eliasstravik/shepherdr --author dmalis
     --state closed`, from the last sync on);
   - each patch: kept as is, adapted (how), or dropped (why).
8. The reviewer reviews only our side: the range-diff and the conflict resolutions, never upstream's own commits.
9. **Merge with a merge commit, never squash.**
   - Use `gh pr merge <n> --merge --match-head-commit <sha>`, once CI's `check` has passed.
   - herdr-task's own merge squashes (github.py:702). A squashed sync drops upstream's history, and every later sync
     then conflicts on everything.
   - So this task merges its own pull request, and finishes the way #2 settled.

**Held.** A patch you can't adapt in this run:
1. Merge nothing.
2. Leave `sync/<new>` pushed, with a draft pull request.
3. Open or update the `sync-blocked` issue: which patch, what broke, what you tried.
4. The next run picks it up again.
5. When that issue is older than 24 hours, ask the person one question with the question tool:
   - "Wait for the fix", or
   - "Install `<new>` without `<patch>` for now". In that case, revert the patch on the sync branch, and its issue
     says "paused since `<new>`".

## 4. After the merge

`git fetch origin` and work from `origin/main` from here on.

## 5. Try it for real

Run `fork/bin/trial` on `origin/main`. It is built and maintained under the `pipeline` issue. It runs a throwaway
Shepherdr, which:
- has its own herdr-core session, data folder and scratch repo;
- starts one task with a stand-in agent;
- has it reviewed and marked ready.

It must never touch the live session, the real install or other people's tasks (AGENTS.md: "A throwaway real
service"). A failed trial is **held**. Open or update a `sync-blocked` issue with the trial's output.

## 6. Install

1. Tag the tried commit locally: `ours-<upstream version>-<n>`. `n` counts installs of the same upstream version.
   Push the tag only after step 4 passes. If the install fails, delete the tag and record the failed sha in the
   `pipeline` issue, so no later run installs it again unchanged.
2. `git -C ~/development/projects/shepherdr fetch origin --tags && git -C ~/development/projects/shepherdr checkout
   --detach <tag>`. The folder must be clean; if it isn't, stop, which is **held**.
3. `herdr-task update-shepherdr <this task> --folder <this space's folder>`. This works only in this schedule's run;
   never run `shepherdr update` yourself. Then wait for the outcome:
   `herdr-task update-shepherdr <this task> --folder <folder> --status`.
4. Health: `shepherdr doctor` passes, and `herdr-task assistants` still lists the spaces.
5. If either fails, **roll back**:
   - check out the previous `ours-*` tag in the install folder;
   - run `herdr-task update-shepherdr` again;
   - open an issue labelled `pipeline` with both outputs.

## 7. Report

One short message for the card, in plain words, for someone who doesn't code:
- **Installed:** what's new for them, and what of ours was adapted or dropped.
- **Held:** what waits, and why.
- **Rolled back:** what failed.

Link the pull request and any issue. Nothing more.
