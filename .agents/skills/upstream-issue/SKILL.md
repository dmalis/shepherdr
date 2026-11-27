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
3. **Mark it as not filed** once our pull request is merged ("After a fix lands"). Nothing goes upstream yet.
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
   - They don't know it yet: explain it briefly. That's all.
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

When one of our pull requests for a fix merges on dmalis/shepherdr, its issue gets `not-filed`, and its status line
says "carried since `ours-…`, not filed yet" once it is installed. Then it waits for the person. Their answer sets one
label that describes the issue as a whole:

| They say | Do | Label |
|---|---|---|
| Nothing yet | Nothing. It stays on the not-filed list | `not-filed` |
| File it | "Filing a fix", below. Their "file it" is the yes: no draft round | `upstream-proposed` |
| Keep it ours | Post nothing. Status line: "fork-only", with their reason if they gave one | `fork-only` |
| Undo it | A revert pull request (`Part of #n`) that undoes the fix and its `fork/patches.json` line. Status line: "reverting in #m". Once it has merged and the install step installed it healthily: the label, status line "reverted in #m", and close the issue | `reverted` |

- Swap the labels in one call: `gh issue edit <n> -R dmalis/shepherdr --add-label <label> --remove-label not-filed`.
  For a revert, `not-filed` stays until `reverted` goes on.
- Upstream links already on the issue stay as history. Edit the status line; never delete an upstream link.
- **Several fixes on one issue:** the status line lists each pull request with what became of it, e.g. "#8: proposed
  upstream as upstream issue 1648; #30: not filed yet". While one of them waits, `not-filed` is on the issue beside
  the earlier label. Once all are decided, the issue keeps one label: `upstream-proposed` if any fix we still carry
  was filed, else `fork-only`; `reverted` only when every fix was undone.
- **The author declines a filed fix:** the label stays `upstream-proposed`, and the status line says "declined
  upstream: <link>", with the author's reason. Our patch stays.

## The not-filed list

The Assistant gives it when the person asks which fixes aren't filed, and once a day from the schedule "Not-filed
fixes".
1. **Find them:** `gh issue list -R dmalis/shepherdr --label not-filed --json number,title,body`. Read each one's
   status line for its pull requests; an issue with several fixes may have only one still waiting.
2. **One line per fix, named by what it does** in plain words, its issue's number after it: "A settings notice no
   longer ends the Assistant's work mid-turn (#7)". Add a few words when they help the decision: upstream already
   has an issue for it, it can't fit everyone (keep it ours), or it is being reverted.
3. **Ask, fix by fix:** with the question tool, one question per fix (up to four at a time): "File it upstream",
   "Keep it ours", "Undo it", "Not yet". Then do what "After a fix lands" says for each answer. "Not yet" changes
   nothing.
4. **Nothing waits:** when asked, say so in one line. The daily run posts nothing.

## Filing a fix

Only for a fix the person said to file. Never post upstream without their yes for that fix.
1. **Find the upstream issue.** Start from our issue's "Upstream" line, then search for a duplicate:
   `gh search issues -R eliasstravik/shepherdr "<words>"`. Leave out `--state`: without it, the search covers open and
   closed issues.
2. **Pick what to post** from what you found:

   | Found | Post |
   |---|---|
   | The person's issue, open or closed (any reason) | One comment on it, linking our pull request |
   | Someone else's open issue for the same problem | One comment on it, linking our pull request |
   | Someone else's request that the author declined | Nothing: the author has decided. Tell the person, and keep it ours unless they say otherwise |
   | Nothing | One new issue, linking our pull request |

3. **Post at most once.** Read the issue's comments first: `gh issue view <n> -R eliasstravik/shepherdr --comments`.
   If one of ours already links a dmalis/shepherdr pull request, post nothing. One comment per issue, ever, and one
   issue per problem, ever.
4. **Write it** ("How to write one").
5. **Post it:** `gh issue comment <n> -R eliasstravik/shepherdr --body-file <file>`, or for a new issue
   `gh issue create -R eliasstravik/shepherdr --title "<title>" --body-file <file>`.
6. **Record it on our issue:** label it `upstream-proposed`, remove `not-filed`, and set its status line to
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

Look at `git log upstream/main` first.
- **In a release:** nothing to build. Show the person how to use it, and post nothing upstream.
- **On main, not released yet:** don't write our own fix.
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
  - Once ours is merged, it is `not-filed` like any other fix. If the person says file it, the one comment linking
    it ("Filing a fix") is the only post.
  - Ask the person only when the current release already meets the need fully and there is nothing to build. Show
    them how to use what upstream has.
- **When the author proposes another way or asks something,** rethink it with the shaping-a-request skill (step 4):
  1. Open an issue here labelled `rethink`. Give the person's need, the author's reasoning, both ways tried on the
     current release, the cost of carrying ours, and your recommendation.
  2. Ask the person one question: "Upstream's way", "Ours", or the third way you found.
  3. If the answer is theirs, the sync drops our patch.
