---
name: upstream-issue
description: Follow the person's open issues on upstream Shepherdr until they close, and take upstream's fix when it has one. Use when one of those issues gets a reply or closes, when asked about them, or when upstream already has a fix we carry or need.
---

# The person's upstream issues

This fork is on its own path (FORK.md: "The aim"): every problem and request is found, filed, fixed and installed
here, and upstream hears nothing from us. What is left upstream is the person's issues already open there: we follow
them, read-only, until each one closes.

List them with `gh search issues -R eliasstravik/shepherdr --author dmalis --state open`. Leave `--state` out to
see closed ones too.

## What may go upstream

One thing only: **the person's own reply,** when the author asks a question on one of their open issues.
1. Weigh the question with the shaping-a-request skill (its step 4) and ask the person.
2. Post their answer in their words: `gh issue comment <n> -R eliasstravik/shepherdr --body-file <file>`, after
   `fork/bin/sync public-check <file>`. One reply per question, carrying only that answer.

Everything else stays here: no new issue, no comment offering a fix, no pull request, no reaction, no nudge. A
problem the person finds that upstream might share is filed on dmalis/shepherdr like any other.

## Following them

- **The "Watch upstream issues" schedule** reads them every 4 hours, with upstream's new releases, and tells this
  space's Assistant what changed. **Each sync's report** lists the ones closed or answered since the last sync
  (upstream-sync skill, step 3).
- **The author asks something or proposes another way:** rethink it with the shaping-a-request skill (step 4):
  1. Open an issue here labelled `decision`: the person's need, the author's reasoning, both ways tried on the
     current release, the cost of carrying ours, and your recommendation.
  2. Ask the person one question: "Upstream's way", "Ours", or the third way you found. Their reply, if the author
     asked them something, goes as above.
  3. If the answer is upstream's way, the sync drops our patch.
- **Closed with a fix:** see "Upstream already has it". The issue leaves the list; nothing is posted.
- **Closed without a fix:** our patch stays. If we haven't built it yet and the person still needs it, build it
  here (fork-patch skill), shaped by the author's reasons. Our issue gets a comment "declined upstream", with
  the reason.

## Upstream already has it

The upstream check (fork-patch skill, step 1) and each sync (upstream-sync skill, step 3) find these, whoever filed
the problem.
- **In a release:** take theirs. Nothing to build; show the person how to use it, or that the next sync brings it.
  A patch of ours for the same thing is dropped in the sync, and its issue gets `fixed-upstream`. Keep ours only
  where it is clearly better for the person, cut down to a small addition on top of theirs, and say on its issue
  why.
- **On upstream's main, not released yet:** write no fix of our own; the release brings it. Only if it hurts now,
  carry upstream's own commit as a temporary patch (`git cherry-pick -x`), labelled `fixed-upstream`; the release
  replaces it.

## Naming upstream issues

From our issues and pull requests, write them as plain text: "upstream issue 1556". A `#1556` links our own repo's
#1556, and a full link or `eliasstravik/shepherdr#1556` shows on upstream's issue as a mention. For the person, name
one by its title (FORK.md: Rules).
