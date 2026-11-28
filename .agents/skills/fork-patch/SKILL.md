---
name: fork-patch
description: Build or adapt one of this fork's own patches on top of upstream Shepherdr. Use when the person asks for a change to Shepherdr (a fix, UI, a feature), when writing a patch's spec, or when an upstream release breaks one of our patches.
---

# A patch on top of upstream

Every change we make is a patch that has to survive every upstream release. Upstream merges dozens of commits a day,
so the cost of a patch is how often a release breaks it. Build for that.

## 1. Upstream, then the issue

1. **Check upstream first** (FORK.md: "Check upstream first"), before you open the issue, and again when its task
   starts building:
   - **Up to date?** `git fetch -q origin && git fetch -q upstream --tags`. Upstream's newest release is
     `gh release list -R eliasstravik/shepherdr --limit 1`; ours is
     `git describe --tags --match 'v*' --abbrev=0 origin/main`. Then upstream's main since our base, on the files
     involved: `git log --oneline $(git merge-base origin/main upstream/main)..upstream/main -- <files>`, and
     `git log upstream/main --oneline -i --grep <word>`. A matching commit is released when
     `git tag --contains <sha> --list 'v*'` lists a tag, and only on upstream's main when it lists none.
   - **Reported?** `gh search issues -R eliasstravik/shepherdr <word> <word>`, a few times, two or three words each:
     a long query often finds nothing. No `--state`, so closed ones come too. For each match, read the close reason
     and the maintainer's words: `gh issue view <n> -R eliasstravik/shepherdr --json state,stateReason,comments`
     (`--comments` alone drops the state when its output is read by a tool).
   - **Fixed in a release or on upstream's main:** stop here. There is nothing to build and no `patch` issue to
     open: say so, and the sync brings it. Only if it hurts now, carry upstream's own commit (upstream-issue skill:
     "Upstream already has it"). We write no fix of our own.
   - **Declined upstream:** we build our own, shaped by the maintainer's reasons (upstream-issue skill).
   - **Reported upstream by someone else, still open:** we build our own here. Nothing is posted there.
2. Open or update an issue on dmalis/shepherdr, labelled `patch`. It holds:
   - **Why:** the person's words and their pain.
   - **What it does.**
   - **Acceptance criteria:** things a person can see or do.
   - **Where it lives:** files and seams.
   - **Tests:** the test files the sync must run (the same ones as its `fork/patches/<n>.json`).
   - **Upstream:** "Upstream checked: v<release>, main <short sha>; related: <upstream issues as plain text, or
     none>".

## 2. Spec, for anything bigger than a small fix

1. Write `fork/specs/<name>.md`: behaviour, acceptance criteria, edge and failure cases, and where the code goes.
2. It is a task of its own, reviewed like code. The reviewer checks it against the issue and against upstream's
   Rules (docs/develop.md).
3. The building tasks are added `--after` it, each small enough to review in one sitting. A brief that touches UI
   names the UI skills that fit it (step 3).

## 3. Build it to survive

- **For every Shepherdr user** where that costs nothing extra. Nothing in it is tied to the person's machines,
  projects or habits, and upstream's default still fits a new user. What only suits them is a setting (below).
- **UI follows the industry standard** (FORK.md: "Industry standard first"): the common pattern of well-known apps,
  standard keys kept on every keyboard layout, and the apps you followed named in the pull request.
- **UI work uses the UI skills** (FORK.md: "All UI work uses the UI skills"), within Shepherdr's design system
  (`web/src/ds.css`) and those standard patterns: always `frontend-design:frontend-design`, plus every one that fits
  the change, and `web-design-guidelines` before ready. Every animation follows Shepherdr's Motion setting as well as
  `prefers-reduced-motion`. Check it in screenshots at 390px and desktop, light and dark, and name the skills used in
  the summary. Every task brief that touches UI says all of this, naming the skills that fit.
- **New files over edits.** Put our code in our own modules: a new Python module beside upstream's, a plugin under
  `web/plugins/<name>/` (docs/plugins.md), our scripts in `fork/`. Edit upstream's files only at one call site or one
  hook point.
- **Keep the templates as they are** (`templates/*.md`): upstream rewrites them several times a week. Deliver our
  words from our own files, through the brief, the settings block or the session note.
- **Upstream's conventions, not ours.** Its Rules in docs/develop.md, its plain wording, its test style. A patch that
  reads like upstream wrote it is one the next release's changes break least.
- **Pin the seams.** Write a test that fails when upstream changes something the patch relies on, such as a
  function's name and arguments or a line a template must still contain. The test names the patch's issue.
- **Settings.** A new setting is a new key in upstream's existing hierarchy (Everywhere, repo, task `--set`), never
  a second config file. The person's private values stay in their settings file, never in this repo.
- **Its own file in the patch list**, in the patch's pull request: `fork/patches/<n>.json`, `<n>` its issue
  number, holding `{"issue": <n>, "name": "<short name>", "files": [...], "tests": [...]}`, its files and test files
  as paths in the repo.
  - Write only that one file. Never edit another patch's file or `fork/tests/test_patches.py` to register yours, so
    patches built side by side merge without a conflict.
  - The sync reads the list at the commit it installs: a patch without its file is neither tested nor counted as
    carried.
  - `fork/bin/sync patch-tests --issue <n>` checks your file against the tree and runs its tests.
  - A branch from before still adds a line to `fork/patches.json`: on rebase, move that line to
    `fork/patches/<n>.json` and drop the old file.
- **Tests before ready.** Run only the patch's own tests, plus `bunx tsc` or a build when it could break one
  (AGENTS.md: Tests). The pull request's CI runs the rest.

## 4. Adapt one after a release broke it

1. Read what upstream changed: `git log -p <old>..<new> -- <the patch's files>`.
2. Keep the patch's behaviour, as its issue states it, in upstream's new shape. Don't keep its old code.
3. If upstream now does the same thing, take theirs: delete the patch and its `fork/patches/<n>.json` instead, and
   label its issue `fixed-upstream`; the install without it says so on the issue. Keep ours only where it is clearly
   better for the person, cut down to a small addition on top of upstream's, with why on its issue.
4. Update the issue's "Where it lives", its pinning test and its `fork/patches/<n>.json`.

## 5. Done means

- The pull request links the issue with `Part of #n` (never `Closes`) and adds its `fork/patches/<n>.json`, CI's
  `check` passed, and the reviewer had no must-fix finding left. A slice of a bigger issue names it in its patch
  file as `"umbrella": <n>`, and its pull request says `Part of #<umbrella>` too. `herdr-task ready` writes its own
  description: give it the line with `--pr-body`, or add it after with `gh pr edit <pr> -R dmalis/shepherdr
  --body-file <file>`. The fork check fails a pull request that changes a patch file without the line, and names
  the line to add.
- UI work: its proof has the 390px and desktop screenshots, light and dark, and its summary names the UI skills used.
- **Only a real device can confirm it** (iOS home-screen behaviour, a real keyboard, push on a device, haptics:
  anything our headless checks can't show): the summary and the issue both say what to do on the device and what
  to see. The issue gets it as a line "Device check: <what to do>: <what to see>", e.g. "Device check: open the app
  from the iPhone home screen: the header's first row is sharp, with no gap above it". The proof lists it under "Not proven". The install then asks the person to check it (FORK.md:
  `device-check`).
- Every fix has its own issue, and merging never closes it. A new fix for a problem an earlier fix covers gets a
  new issue that links the earlier one, even when the earlier one is closed.
- Before ready, the issue says in plain words what the fix does and how to try it ("What it does: <one line>. Try
  it: <what to open or do, and what you should see>"), in its body or a comment. Nothing rewrites it later.
- The install that makes it live comments "Live since `ours-…` (#m)" on the issue, once per install tag
  (`fork/bin/sync issues`, never by hand). It closes the issue only when Triage's fix linked to it is live; the
  person closes the rest. An issue with a "Device check" line gets `device-check` and stays open.

## 6. The record on GitHub

The open issues are what we build and what waits on the person; the patch list (`fork/patches/`) is what we carry.
The full design: fork/specs/issue-loop.md ("Close and tell", "Labels").

**An issue's body stays the person's words** (or its filer's). What became of each fix is said in comments: the
install's "Live since `ours-…` (#m)", once per issue and install tag, and "Fixed upstream in `vX.Y.Z`; ours was
dropped" when a release ships it. Upstream links already on an issue stay as history.

**Closing:** the install closes an issue as completed only when Triage's fix linked to it merged and is live. It
reads the issue again just before, and leaves one that was reopened or edited after that merge, or waits on a device
check. Every other issue is closed by the person (completed, not planned or duplicate: GitHub's own reasons).

**Undoing a fix,** when the person says so: a revert pull request (`Part of #n`) that undoes it and its part of its
`fork/patches/<n>.json`, keeping every path and test another carried fix still needs. Reopen the issue first if it
is closed (`gh issue reopen <n> -R dmalis/shepherdr`) and say in a comment what is being undone and why.

**Labels** (one of each family, at most one flow label; `fork/sync/labels.py` holds the set):
- Kind: `bug` (something is broken) or `enhancement` (something new).
- Area: `patch` (Shepherdr's code, a change we carry) or `pipeline` (this fork's own machinery).
- Score: `score:1` to `score:5`, from Triage only.
- Flow: `needs-triage` (new, not scored), `ready` (the go: start a fix), `fixing` (a task is on it), `decision`
  (only the person can settle it), `blocked` (tried and couldn't), `later` (not now). The issue forms set the kind
  and `needs-triage`; an issue opened another way gets them when it is filed.
- `device-check`: a live fix only a real device can confirm (an iPhone's home screen, a real keyboard, push on a
  device, haptics), not confirmed by the person yet. The install puts it on, from the issue's "Device check" line,
  and the issue stays open. It comes off only when they confirm, and then they close it. If they say it's still
  wrong, a fix task starts with what they saw; the label stays until they confirm the new fix.
- `sync-blocked`: an upstream release waits on this patch. `fixed-upstream`: upstream shipped it; ours was dropped.
