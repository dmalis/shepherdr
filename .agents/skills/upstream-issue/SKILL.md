---
name: upstream-issue
description: Label our merged fixes for the person's decision, list the ones not filed yet, file the ones they say to file with upstream Shepherdr (eliasstravik/shepherdr), and follow the person's issues there. Use after one of our fixes or patches is merged, when the person says to file, keep or undo a fix, when asked which fixes aren't filed (and for the daily list), when Shepherdr lets the person down or confuses them, when an upstream issue of theirs gets a reply or is closed, or when asked about their upstream issues.
---

# Issues on upstream

**The person's standing rule:** our Shepherdr works for them, built in a way that fits Shepherdr for everyone. The
person decides, fix by fix, whether we offer it upstream, and upstream's author decides whether it goes into theirs.
It covers every problem the person filed upstream (open, or closed without a fix) and every one they find later.
1. **Shape it** (shaping-a-request skill).
2. **Fix it here** as a patch (fork-patch skill), built for every Shepherdr user (below). Skip this only when
   upstream's own release already fixes it; see "A fix upstream already has".
3. **Mark it as not filed** once our pull request is merged and installed ("After a fix lands"). Nothing goes
   upstream yet.
4. **The person decides:** file it, keep it ours, or undo it. They see what waits in the not-filed list ("The
   not-filed list").
5. **If they file it, the author decides:** take it as it is, do it differently, or drop it. Our Shepherdr already
   has it either way.

Upstream is someone else's public project. It hears from us only what the person said to file.

**The person's earlier issues count too.** List them with `gh search issues -R eliasstravik/shepherdr --author dmalis`
(no `--state`: open and closed). Each one that is open, or closed with no fix in a release, and has no `patch` issue
here yet, gets one (fork-patch skill, step 1), and goes through steps 1–5.

## Confusion is a UX problem

When Shepherdr's behaviour confuses the person:
1. **Check the process first.** Do they know the process behind it: how tasks, settings, review and merge work?
   Judge from what they said; if it's unclear, ask one question.
   - They don't know it yet: explain it briefly. It is still friction: propose its fix in the same reply (FORK.md:
     "Every friction is a candidate fix").
   - They know it and are still confused: the screen gave a wrong or missing hint, and that hint is the problem to
     fix, not something to explain away. Answer so they can carry on, then go on below.
2. **Name the gap:** what the screen showed, what the person expected from it, and the hint that was wrong or
   missing. Put this in the issue's "Why".
3. **Offer the better UX** (shaping-a-request skill): how upstream and comparable tools show the same state or
   action, and your recommended hint, label, state or default that would have prevented the confusion for any
   Shepherdr user. Offer it to the person in the same reply.
4. **Fix it here** through steps 2–5 above, like any other fix.

The fix is done when the screen makes the behaviour clear, not when the person has understood it.

## Built for everyone

Before ready, check the patch against every Shepherdr user, not just the person:
- Nothing in it is tied to their machines, projects, repos or habits. Upstream's default behaviour still fits a new
  user.
- What only suits the person becomes a setting (fork-patch skill: Settings): upstream's default stays, and their
  value goes in their settings file.
- What can't fit everyone says so on its issue, with why. It is still `not-filed` once merged, and its line in the
  not-filed list recommends keeping it ours.

## After a fix lands

The person tries each fix they use for a day or two, then decides. So every fix stays in sight on GitHub until then:
- **Every fix has its own issue** on dmalis/shepherdr. A new fix for a problem an earlier fix already covers gets
  a new issue that links the earlier one. A fix that lands without one gets one then (upstream-sync skill, step 7).
- **Its status line says in plain words what the fix does and how to try it** (fork-patch skill: "Done means").
- **It stays open with `not-filed` until the person decides.** Merging never closes it: pull requests say
  `Part of #n`, never `Closes`.

A fix lands when it is merged and live: the first healthy install that carries it (upstream-sync skill, step 7).
That install labels its issue `live` and `not-filed`, and its status line starts "carried since `ours-…`". So an
issue's labels answer two questions: is it on the person's machine (`live`, or not yet), and what about upstream
(`not-filed`, `upstream-proposed`, `fork-only`, `reverted`). Then it waits for the
person. Their answer for that fix sets the label:

| They say | Do | Label |
|---|---|---|
| Nothing yet | Nothing. It stays on the not-filed list | `not-filed` |
| File it | "Filing a fix", below. Their "file it" is the yes: no draft round | `upstream-proposed`, once it is posted |
| Keep it ours | Post nothing. Status line: "fork-only", with their reason if they gave one | `fork-only` |
| Undo it | A revert pull request (`Part of #n`) that undoes the fix and its part of the `fork/patches.json` line. Status line: "reverting in #m". The healthy install that carries the revert (upstream-sync skill, step 7) makes it "reverted in #m", puts the label on and closes the issue | `reverted` |

- Swap the labels in one call: `gh issue edit <n> -R dmalis/shepherdr --add-label <label> --remove-label not-filed`.
  For a revert, `not-filed` stays until `reverted` goes on.
- Upstream links already on the issue stay as history. Edit the status line; never delete an upstream link.
- **Several fixes on one issue** (older issues; a new fix gets its own): the status line lists each pull request
  with what became of it, e.g. "#8: proposed upstream as upstream issue 1648; #30: not filed yet". A decision or an
  install changes only that pull request's part. A part is "building" until its own install, so a fix is never
  offered before the person can try it.
  - **Set the labels from all the parts** after every change, never from the last action, removing any label that
    no longer fits: `not-filed` while any part is "not filed yet" or "reverting"; beside it, one label for the
    issue as a whole: `upstream-proposed` if any fix we still carry was filed (proposed or declined upstream), else
    `fork-only` if any carried fix is kept ours, else none; `reverted`, alone, only once every fix was undone.
  - **Undoing one of them** reverts only that pull request. The `fork/patches.json` line keeps every path and test
    another carried fix still needs. The issue closes only once every fix was undone.
- **The author declines a filed fix:** the label stays `upstream-proposed`, and the status line says "declined
  upstream: <link>", with the author's reason. Our patch stays.

## The not-filed list

The person gets it when they ask which fixes aren't filed, and once a day from a schedule the Assistant set up.
1. **Find them:** `gh issue list -R dmalis/shepherdr --label not-filed --limit 200 --json number,title,body`. Read
   each one's status line for its pull requests; an issue with several fixes may have only one still waiting.
2. **One line per fix, named by what it does** in plain words, then how to try it (from its status line), its
   issue's number last: "A settings notice no longer ends the Assistant's work mid-turn; try it: change a setting
   while it works (#7)". Add a few words when they help the decision: upstream fixed it since, in a release or on
   main (nothing to file: the sync drops ours), upstream has an issue for it, it can't fit everyone (keep it ours),
   or it is being reverted. Find the first two with the upstream check (fork-patch skill, step 1).
3. **End with the link** that opens exactly those issues on GitHub:
   https://github.com/dmalis/shepherdr/issues?q=is%3Aissue+is%3Aopen+label%3Anot-filed
4. **When the person asked:** the Assistant gives the list, then asks with the question tool, one question per fix
   (up to four at a time): "File it upstream", "Keep it ours", "Undo it", "Not yet". It does what "After a fix
   lands" says for each answer. "Not yet" changes nothing. Nothing waits: say so in one line.
5. **The daily run** is a task of its own: it changes nothing and asks nothing. It ends with
   `ready --told "<the list and the link, then: say file it, keep it ours or undo it for any of them>"`, or
   `ready --nothing` when none waits. The Assistant tells the person those words, and their answer comes to the Assistant like any message.

## Filing a fix

Only for a fix the person said to file. Never post upstream without their yes for that fix.
1. **Find the upstream issue.** Start from our issue's "Upstream checked" line, then search again for a duplicate
   filed since, as the fork-patch skill's step 1 does: a few short keyword searches, open and closed.
2. **Pick what to post** from what you found:

   | Found | Post |
   |---|---|
   | The person's issue, open or closed (any reason) | One comment on it, linking our pull request |
   | Someone else's open issue for the same problem | One comment on it, linking our pull request |
   | Someone else's request that the author declined | Nothing: the author has decided |
   | Nothing | One new issue, linking our pull request |

3. **Post at most once.** Read the issue's comments first: `gh issue view <n> -R eliasstravik/shepherdr --comments`.
   One comment per issue, ever, and one issue per problem, ever.
   - One of ours already links this fix's pull request: post nothing; it is already filed (step 6).
   - One of ours links another pull request, or the table above says nothing: post nothing, and tell the person why
     it can't be filed. The fix stays `not-filed` for them to keep it ours or undo it.
4. **Write it** ("How to write one").
5. **Post it:** `gh issue comment <n> -R eliasstravik/shepherdr --body-file <file>`, or for a new issue
   `gh issue create -R eliasstravik/shepherdr --title "<title>" --body-file <file>`.
6. **Record it on our issue,** only once a post links this fix's pull request (step 5's, or the one found in step
   3): label it `upstream-proposed`, remove `not-filed` unless another fix still waits, and set the fix's status to
   "proposed upstream: <link>".

Our pull request stays in our fork. Never open a pull request on upstream unless the person asks for that one.

## When to post there

| What | When | Yes needed |
|---|---|---|
| A comment linking our fix, on an upstream issue for the same problem | Once our fix is merged here | The person's "file it" for that fix. One per issue, ever |
| A new issue linking our fix, when upstream has none for the problem | Once our fix is merged here | The person's "file it" for that fix. One per problem, ever |
| A reply to the author | Only with the person's answer to the author's question (shaping-a-request, step 4) | Their words |

Nothing else goes there: no fix the person hasn't said to file, no rewording, no follow-up nudges.

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
2. **A comment** is two or three lines: what our fix does, then "We fixed this in our fork: <link to the
   dmalis/shepherdr pull request>. It's yours to take as it is, do differently or drop."
3. **A new issue** is a title and 3–6 lines:
   - what happened and what was expected;
   - the smallest repro;
   - the version (`shepherdr version`);
   - the same closing line as a comment, linking our pull request.
4. **Respect upstream's stated design.** It is in the Rules of docs/develop.md, in docs/settings.md and in the
   README.
   - Ask for the smallest change that would let us drop our patch.
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
  haven't yet.
  - Don't ask the person whether to build it: the standing rule covers every decline.
  - Let the author's reasons shape how it's built (shaping-a-request).
  - Our issue's status line says "declined upstream: <link>", with the author's reason.
  - Once ours is merged and installed, it is `not-filed` like any other fix. If the person says file it, the one comment linking
    it ("Filing a fix") is the only post.
  - Ask the person only when the current release already meets the need fully and there is nothing to build. Show
    them how to use what upstream has.
- **When the author proposes another way or asks something,** rethink it with the shaping-a-request skill (step 4):
  1. Open an issue here labelled `rethink`. Give the person's need, the author's reasoning, both ways tried on the
     current release, the cost of carrying ours, and your recommendation.
  2. Ask the person one question: "Upstream's way", "Ours", or the third way you found.
  3. If the answer is theirs, the sync drops our patch.
