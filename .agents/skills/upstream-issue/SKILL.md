---
name: upstream-issue
description: Label our merged fixes, offer them to upstream Shepherdr (eliasstravik/shepherdr) in grouped upstream rounds when the person asks, and follow the person's issues there. Use after one of our fixes or patches is merged, when the person says to keep or undo a fix, when they ask to offer or file our fixes upstream (an upstream round), when Shepherdr lets the person down or confuses them, when an upstream issue of theirs gets a reply or is closed, or when asked about their upstream issues.
---

# Issues on upstream

**The person's standing rule:** our Shepherdr works for them, built in a way that fits Shepherdr for everyone. It is
a closed loop: every problem and request is filed on dmalis/shepherdr and fixed here. It covers every problem the
person filed upstream (open, or closed without a fix) and every one they find later.
1. **Shape it** (shaping-a-request skill).
2. **Fix it here** as a patch (fork-patch skill), built for every Shepherdr user (below). Skip this when upstream
   already fixed it, in a release or on its main (the upstream check, fork-patch skill, step 1); see "A fix upstream
   already has".
3. **Mark it as not offered yet** once our pull request is merged and installed ("After a fix lands"). Nothing goes
   upstream per fix, and nobody asks the person about upstream per fix.
4. **When the person asks, offer what we carry** in one upstream round ("Upstream round"), about once a week.
5. **Then the author decides:** take it as it is, do it differently, or drop it. Our Shepherdr already has it either
   way.

Upstream is someone else's public project. It hears from us only in a round the person asked for, and in a reply to
the author's question in the person's words ("When to post there").

**The person's earlier issues count too.** List them with `gh search issues -R eliasstravik/shepherdr --author dmalis`
(no `--state`: open and closed). Each one that is open, or closed with no fix in a release, and has no `patch` issue
here yet, goes through the upstream check (fork-patch skill, step 1). One upstream hasn't fixed gets an issue and goes
through steps 1–5.

## Confusion is a UX problem

When Shepherdr's behaviour confuses the person:
1. **Check the process first.** Do they know the process behind it: how tasks, settings, review and merge work?
   Judge from what they said; if it's unclear, ask one question.
   - They don't know it yet: explain it briefly. It is still friction: record it and propose its fix in the same
     reply (FORK.md: "Every friction is a candidate fix").
   - They know it and are still confused: the screen gave a wrong or missing hint, and that hint is the problem to
     fix, not something to explain away. Answer so they can carry on, then go on below.
2. **Name the gap:** what the screen showed, what the person expected from it, and the hint that was wrong or
   missing. Put this in the issue's "Why".
3. **Offer the better UX** (shaping-a-request skill): how upstream and comparable tools show the same state or
   action, and your recommended hint, label, state or default that would have prevented the confusion for any
   Shepherdr user. Offer it to the person in the same reply.
4. **Record it** under Found (FORK.md: "Record it at once"). **Fix it here** through steps 2–5 above, like any
   other fix, once the person picks it on the Feedback page or says yes in chat.

The fix is done when the screen makes the behaviour clear, not when the person has understood it.

## Built for everyone

Before ready, check the patch against every Shepherdr user, not just the person:
- Nothing in it is tied to their machines, projects, repos or habits. Upstream's default behaviour still fits a new
  user.
- What only suits the person becomes a setting (fork-patch skill: Settings): upstream's default stays, and their
  value goes in their settings file.
- What can't fit everyone says so on its issue, with why. Once merged it is `not-filed` like any other fix; the next
  round leaves it out and marks it `fork-only` ("Upstream round", step 7).

## After a fix lands

Every fix stays in sight on GitHub:
- **Every fix has its own issue** on dmalis/shepherdr. A new fix for a problem an earlier fix already covers gets
  a new issue that links the earlier one. A fix that lands without one gets one then (upstream-sync skill, step 7).
- **Its status line says in plain words what the fix does and how to try it** (fork-patch skill: "Done means").
- **It stays open.** Merging never closes it: pull requests say `Part of #n`, never `Closes`.

A fix lands when it is merged and live: the first healthy install that carries it (upstream-sync skill, step 7).
That install labels its issue `live` and `not-filed` ("not offered upstream yet"), and its status line starts
"carried since `ours-…`". So an issue's labels answer two questions: is it on the person's machine (`live`, or not
yet), and where it stands with upstream (`not-filed`, `upstream-proposed`, `fork-only`, `reverted`).

Nothing more happens until the person asks for a round, or says something about a fix:

| What happens | Do | Label |
|---|---|---|
| Nothing | Nothing. The next round picks it up | `not-filed` |
| An upstream round offers it | "Upstream round", step 7 | `upstream-proposed` |
| They say keep it ours | Post nothing. Status line: "fork-only", with their reason if they gave one | `fork-only` |
| They say undo it | A revert pull request (`Part of #n`) that undoes the fix and its part of its `fork/patches/<n>.json`. Status line: "reverting in #m". The healthy install that carries the revert (upstream-sync skill, step 7) makes it "reverted in #m", puts the label on and closes the issue | `reverted` |

- Swap the labels in one call: `gh issue edit <n> -R dmalis/shepherdr --add-label <label> --remove-label not-filed`.
  For a revert, `not-filed` stays until `reverted` goes on.
- Upstream links already on the issue stay as history. Edit the status line; never delete an upstream link.
- **Several fixes on one issue** (older issues; a new fix gets its own): the status line lists each pull request
  with what became of it, e.g. "#8: proposed upstream as upstream issue 1648; #30: not filed yet". A round or an
  install changes only that pull request's part. A part is "building" until its own install, so a fix is never
  offered before the person can try it.
  - **Set the labels from all the parts** after every change, never from the last action, removing any label that
    no longer fits: `not-filed` while any part is "not filed yet" or "reverting"; beside it, one label for the
    issue as a whole: `upstream-proposed` if any fix we still carry was offered (proposed or declined upstream),
    else `fork-only` if any carried fix is kept ours, else none; `reverted`, alone, only once every fix was undone.
  - **Undoing one of them** reverts only that pull request. Its `fork/patches/<n>.json` keeps every path and test
    another carried fix still needs. The issue closes only once every fix was undone.
- **The author declines an offered fix:** the label stays `upstream-proposed`, and the status line says "declined
  upstream: <link>", with the author's reason. Our patch stays.

## Upstream round

Only when the person asks ("offer ours upstream", "file them with the author"), which they expect about once a week.
Their ask is the yes for this round; their "go" on the plan (step 5) is the yes for its exact posts. Nothing in a
round is posted before that "go".
1. **Gather** every fix we carry, live and not offered yet:
   `gh issue list -R dmalis/shepherdr --label patch --label live --label not-filed --limit 200 --json
   number,title,body`, each checked against the patch list of what runs now: the install folder's commit
   (`git -C <install folder> rev-parse HEAD`, FORK.md: "Where things are"), read with
   `fork/bin/sync patch-list --at <that commit>`. Go by each fix's part of the status line, never by the issue's
   labels alone: take only the parts "not filed yet". A part that is fork-only, reverting, still "building" or
   already proposed stays out, even on an issue that also has `not-filed`.
2. **Check upstream first** for each (fork-patch skill, step 1), from its issue's "Upstream checked" line:
   - fixed upstream since, in a release or on main: leave it out; the sync drops ours;
   - an upstream issue for the same problem: read its comments first
     (`gh issue view <n> -R eliasstravik/shepherdr --comments`), then:

   | Found | In this round |
   |---|---|
   | The person's issue, open or closed (any reason), with no comment of ours yet | One comment on it, linking our pull request |
   | Someone else's open issue for the same problem, with no comment of ours yet | One comment on it, linking our pull request |
   | An issue where one of ours already links this fix's pull request | No post: it was offered. Record it (step 7) |
   | An issue where one of ours links another pull request | No post: say so in the plan. It stays `not-filed` |
   | Someone else's request that the author declined | No post: the author has decided |
   | Nothing | Part of a theme issue (step 3) |

   Group these by upstream issue: several fixes that match one issue share its one comment, which names each of
   them.

3. **Group by theme,** never one issue per fix and never one mega issue. A theme is one bigger picture as a user
   meets it, e.g. "Needs you and notifications", "Typing and the message box on a phone", "Task list and filters",
   "Install and sync reliability". Each theme becomes one self-contained upstream issue; a short round has 3 to 8.
   - **Why themes:** a maintainer can't act on, discuss or close a 100-item issue, and five separate issues hide
     that they are parts of one picture. A theme groups those parts and stays answerable.
   - **What the author takes well:** a multi-idea issue from real use. Upstream issue 1195, "Ideas from running a
     merge-queue repo overnight", had most of its ideas shipped in 3.1.45. What makes Shepherdr bigger is declined
     ("to keep Shepherdr small"). So lead each theme with the problem, keep the fork's own habits out, and say which
     parts stand alone.
   - **A theme posted in an earlier round** and still open takes this round's fixes for it as one comment, if we
     haven't commented there yet; else they go in a new theme issue for the new problem.
4. **Write each post** ("How to write one").
5. **Show the person the plan** in one message, before anything is posted:
   - each theme issue's title and the fixes in it, each by what it does, with our issue's link;
   - each comment on an existing upstream issue, named by that issue's title;
   - what's left out and why: fixed upstream since, declined by the author, one of ours there already, can't fit
     everyone.

   Their "go" posts it. A change they ask for changes the plan: show it again. Nothing to offer: say so in one line.
6. **Post it:** `gh issue create -R eliasstravik/shepherdr --title "<title>" --body-file <file>` for a theme issue,
   `gh issue comment <n> -R eliasstravik/shepherdr --body-file <file>` for a comment.
7. **Record it on our issues,** only once a post links that fix's pull request: label each `upstream-proposed`,
   remove `not-filed` unless another fix on it still waits, and set the fix's part of the status line to "proposed
   upstream: <link>". A fix the plan left out as can't fit everyone gets `fork-only` and "fork-only: <why>" in
   its part. Nothing closes: an issue closes only when its fix is retired.
8. **Tell the person** in one message what was posted, each by its title with its link.

Our pull requests stay in our fork. Never open a pull request on upstream unless the person asks for that one.

## When to post there

| What | When | Yes needed |
|---|---|---|
| A theme issue or a comment, in an upstream round | Only for fixes merged and live here | The person's ask for the round, then their "go" on its plan. One comment per issue, ever; one issue per problem, ever |
| A reply to the author | Only when the author asked a question on an issue we posted or commented on, with the person's answer (shaping-a-request, step 4). One reply per question | Their words for that reply |

Nothing else goes there: no fix outside a round, no rewording, no follow-up nudges.

**Mentioning upstream from our issues and pull requests.** Write upstream issues as plain text: "upstream issue
1556". A `#1556` would link to our own repo's #1556. A full link or `eliasstravik/shepherdr#1556` would show up on
upstream's issue as a mention. The only links that may show up there are the ones this skill posts on purpose. For
the person, name an upstream issue by its title (FORK.md: Rules).

## A fix upstream already has

The upstream check (fork-patch skill, step 1) finds these.
- **In a release:** nothing to build. Show the person how to use it (or that the next sync brings it, when our main
  doesn't carry that release yet), and post nothing upstream.
- **On main, not released yet:** don't write our own fix. The release brings it. Only if it hurts now:
  - Carry upstream's own commit as a temporary patch (`git cherry-pick -x`).
  - Label its issue `fixed-upstream`.
  - The next release replaces it.

## How to write one

1. **Write it in upstream's own words.**
   - Use its terms (docs/agents-and-terms.md).
   - Include no private names, paths, hosts, data or settings. Everything upstream gets is public.
2. **A theme issue:**
   - **Title:** the problem as a user meets it, not our fixes' names.
   - **The problem,** a few lines in a user's words: what hurts and when.
   - **What we built,** one short bullet per part: how it behaves, and whether it stands alone or needs another part.
   - **Links** to our pull requests and their commits on dmalis/shepherdr, and the release it runs on.
   - **The closing line:** "We built these in our fork. They're yours to take as they are, do differently or drop,
     part by part."
3. **A comment** is two or three lines: what our fix does, then "We fixed this in our fork: <link to the
   dmalis/shepherdr pull request>. It's yours to take as it is, do differently or drop."
4. **Respect upstream's stated design.** It is in the Rules of docs/develop.md, in docs/settings.md and in the
   README.
   - Offer each part as the smallest change that would let us drop our patch.
   - Never argue against a principle or with a decision already made. After a "not planned", the one comment linking
     our fix is all.

## Following them

- **Each sync lists the person's upstream issues** that were closed or got a reply since the last sync. Find them
  with `gh search issues -R eliasstravik/shepherdr --author dmalis --updated ">=<last sync date>"`. For each one,
  give:
  - the author's words, shortened;
  - the release that has the fix.
- **When the author fixes it, their way or ours,** the sync drops our patch and keeps theirs (upstream-sync skill,
  step 3).
- **When the author closes one of the person's issues without a fix,** our patch stays, or we build it now if we
  haven't yet, after the upstream check (fork-patch skill, step 1) finds it isn't fixed on upstream's main.
  - Don't ask the person whether to build it: the standing rule covers every decline.
  - Let the author's reasons shape how it's built (shaping-a-request).
  - Our issue's status line says "declined upstream: <link>", with the author's reason.
  - Once ours is merged and installed, it is `not-filed` like any other fix. The next round offers it with the one
    comment on that issue that links it, if we haven't commented there yet.
  - Ask the person only when the current release already meets the need fully and there is nothing to build. Show
    them how to use what upstream has.
- **When the author proposes another way or asks something,** rethink it with the shaping-a-request skill (step 4):
  1. Open an issue here labelled `rethink`. Give the person's need, the author's reasoning, both ways tried on the
     current release, the cost of carrying ours, and your recommendation.
  2. Ask the person one question: "Upstream's way", "Ours", or the third way you found.
  3. If the answer is theirs, the sync drops our patch.
