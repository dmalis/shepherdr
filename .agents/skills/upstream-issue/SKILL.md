---
name: upstream-issue
description: Offer our merged fixes to upstream Shepherdr (eliasstravik/shepherdr) and follow the person's issues there. Use after one of our fixes or patches is merged, when Shepherdr lets the person down or confuses them, when an upstream issue of theirs gets a reply or is closed, or when asked about their upstream issues.
---

# Issues on upstream

**The person's standing rule:** our Shepherdr works for them, built in a way that fits Shepherdr for everyone, and
upstream's author decides whether it goes into theirs. It covers every problem the person filed upstream (open, or
closed without a fix) and every one they find later.
1. **Shape it** (shaping-a-request skill).
2. **Fix it here** as a patch (fork-patch skill), built for every Shepherdr user (below). Skip this only when
   upstream's own release already fixes it; see "A fix upstream already has".
3. **Offer it** once our pull request is merged ("Offering a fix"). Ask for no yes: the person gave it once, for
   every fix.
4. **The author decides:** take it as it is, do it differently, or drop it. Our Shepherdr already has it either way.

Upstream is someone else's public project. It hears from us only what this skill posts.

**The person's earlier issues count too.** List them with `gh search issues -R eliasstravik/shepherdr --author dmalis`
(no `--state`: open and closed). Each one that is open, or closed with no fix in a release, and has no `patch` issue
here yet, gets one (fork-patch skill, step 1), and goes through steps 1–4.

## Confusion is a UX problem

The person knows how Shepherdr works. When its behaviour confuses them, the screen gave a wrong or missing hint, and
that hint is the problem to fix. Answer their question so they can carry on, then:
1. **Name the gap:** what the screen showed, what the person expected from it, and the hint that was wrong or
   missing. Put this in the issue's "Why".
2. **Find the better UX** (shaping-a-request skill): how upstream and comparable tools show the same state or action.
   Recommend the hint, label, state or default that would have prevented the confusion for any Shepherdr user.
3. **Fix it here and offer it** through steps 2–4 above, like any other fix.

The fix is done when the screen makes the behaviour clear, not when the person has understood it.

## Built for everyone

Before ready, check the patch against every Shepherdr user, not just the person:
- Nothing in it is tied to their machines, projects, repos or habits. Upstream's default behaviour still fits a new
  user.
- What only suits the person becomes a setting (fork-patch skill: Settings): upstream's default stays, and their
  value goes in their settings file.
- What can't fit everyone stays **fork-only**. Its issue's status line says "fork-only, not offered upstream" and why,
  and nothing is posted upstream for it.

## Offering a fix

Once our pull request is merged on dmalis/shepherdr:
1. **Find the upstream issue.** Start from our issue's "Upstream" line, then search:
   `gh search issues -R eliasstravik/shepherdr "<words>"`. Leave out `--state`: without it, the search covers open and
   closed issues.
2. **Pick what to post** from what you found:

   | Found | Post |
   |---|---|
   | The person's issue, open or closed (any reason) | One comment on it, linking our pull request |
   | Someone else's open issue for the same problem | One comment on it, linking our pull request |
   | Someone else's request that the author declined | Nothing: the author has decided. Our patch stays |
   | Nothing | One new issue, linking our pull request |

3. **Post at most once.** Read the issue's comments first: `gh issue view <n> -R eliasstravik/shepherdr --comments`.
   If one of ours already links a dmalis/shepherdr pull request, post nothing. One comment per issue, ever, and one
   issue per problem, ever.
4. **Write it** ("How to write one").
5. **Post it:** `gh issue comment <n> -R eliasstravik/shepherdr --body-file <file>`, or for a new issue
   `gh issue create -R eliasstravik/shepherdr --title "<title>" --body-file <file>`.
6. **Record it on our issue:** label it `upstream-proposed`, and set its status line to "proposed upstream: <link>".

Our pull request stays in our fork. Never open a pull request on upstream unless the person asks for that one.

## When to post there

| What | When | Yes needed |
|---|---|---|
| A comment linking our fix, on an upstream issue for the same problem | Once our fix is merged here | No: the standing rule. One per issue, ever |
| A new issue linking our fix, when upstream has none for the problem | Once our fix is merged here | No: the standing rule. One per problem, ever |
| A reply to the author | Only with the person's answer to the author's question (shaping-a-request, step 4) | Their words |

Nothing else goes there: no fork-only patch, no rewording, no follow-up nudges.

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
  - Don't ask the person whether: the standing rule covers every decline.
  - Let the author's reasons shape how it's built (shaping-a-request).
  - Our issue's status line says "upstream declined: <link>", with the author's reason.
  - Once ours is merged, the one comment linking it ("Offering a fix") is the only post.
  - Ask the person only when the current release already meets the need fully and there is nothing to build. Show
    them how to use what upstream has.
- **When the author proposes another way or asks something,** rethink it with the shaping-a-request skill (step 4):
  1. Open an issue here labelled `rethink`. Give the person's need, the author's reasoning, both ways tried on the
     current release, the cost of carrying ours, and your recommendation.
  2. Ask the person one question: "Upstream's way", "Ours", or the third way you found.
  3. If the answer is theirs, the sync drops our patch.
