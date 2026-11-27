---
name: fork-patch
description: Build or adapt one of this fork's own patches on top of upstream Shepherdr. Use when the person asks for a change to Shepherdr (a fix, UI, a feature), when writing a patch's spec, or when an upstream release breaks one of our patches.
---

# A patch on top of upstream

Every change we make is a patch that has to survive every upstream release. Upstream merges dozens of commits a day,
so the cost of a patch is how often a release breaks it. Build for that.

## 1. Issue first

1. Open or update an issue on dmalis/shepherdr, labelled `patch`. It holds:
   - **Why:** the person's words and their pain.
   - **What it does.**
   - **Acceptance criteria:** things a person can see or do.
   - **Where it lives:** files and seams.
   - **Tests:** the test files the sync must run.
   - **Upstream:** the matching upstream issue, if any, from `gh search issues -R eliasstravik/shepherdr <words>`.
2. Before building, check whether upstream already has it, or nearly:
   - `git log upstream/main --oneline -i --grep <words>`;
   - the upstream issue's state.

   If upstream fixed it on main but hasn't released yet, the issue says so, and we wait for the release instead of
   building it.

## 2. Spec, for anything bigger than a small fix

1. Write `fork/specs/<name>.md`: behaviour, acceptance criteria, edge and failure cases, and where the code goes.
2. It is a task of its own, reviewed like code. The reviewer checks it against the issue and against upstream's
   Rules (docs/develop.md).
3. The building tasks are added `--after` it, each small enough to review in one sitting.

## 3. Build it to survive

- **New files over edits.** Put our code in our own modules: a new Python module beside upstream's, a plugin under
  `web/plugins/<name>/` (docs/plugins.md), our scripts in `fork/`. Edit upstream's files only at one call site or one
  hook point.
- **Keep the templates as they are** (`templates/*.md`): upstream rewrites them several times a week. Deliver our
  words from our own files, through the brief, the settings block or the session note.
- **Upstream's conventions, not ours.** Its Rules in docs/develop.md, its plain wording, its test style. A patch that
  reads like upstream wrote it is one upstream could take.
- **Pin the seams.** Write a test that fails when upstream changes something the patch relies on, such as a
  function's name and arguments or a line a template must still contain. The test names the patch's issue.
- **Settings.** A new setting is a new key in upstream's existing hierarchy (Everywhere, repo, task `--set`), never
  a second config file. The person's private values stay in their settings file, never in this repo.
- **Tests before ready.** Run only the patch's own tests, plus `bunx tsc` or a build when it could break one
  (AGENTS.md: Tests). The pull request's CI runs the rest.

## 4. Adapt one after a release broke it

1. Read what upstream changed: `git log -p <old>..<new> -- <the patch's files>`.
2. Keep the patch's behaviour, as its issue states it, in upstream's new shape. Don't keep its old code.
3. If upstream now does the same thing, delete the patch instead. Close its issue as `fixed-upstream`.
4. Update the issue's "Where it lives" and its pinning test.

## 5. Done means

- The pull request links the issue, CI's `check` passed, and the reviewer had no must-fix finding left.
- The issue's status says "carried since `ours-…`" once it is installed.
- Offer it upstream when the upstream-issue skill says to.
