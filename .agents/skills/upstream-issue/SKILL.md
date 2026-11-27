---
name: upstream-issue
description: Post, follow and learn from the person's issues on upstream Shepherdr (eliasstravik/shepherdr). Use after one of our fixes or patches is merged, when Shepherdr lets the person down, when an upstream issue of theirs gets a reply or is closed, or when asked about their upstream issues.
---

# Issues on upstream

**Fix it here first, then tell upstream.** The person never waits on upstream for a fix.
1. A pain or a wish is shaped (shaping-a-request skill).
2. It is fixed or built here as a patch (fork-patch skill).
3. Once merged, it goes to upstream as an issue that links our pull request.
4. Upstream can then take it, do it their way, or decline it. Either way our Shepherdr already has it.

Upstream is someone else's public project. It hears from the person only what they said yes to.

**Never ask upstream for something it already said no to.** Before you draft anything, search upstream's issues,
open and closed, the person's and anyone else's. If the maintainer already declined the same need ("not planned",
"by design", "we keep Shepherdr thin"), we build it in our fork and post nothing upstream. Not a new issue, not a
comment, and not an issue worded differently. Put the decline's link and the maintainer's reason in our issue's
status line: "upstream declined: <link>".

**Mentioning upstream from our issues and pull requests.** Write upstream issues as plain text: "upstream issue
1556". A `#1556` would link to our own repo's #1556. A full link or `eliasstravik/shepherdr#1556` would show up on
upstream's issue as a mention. The only links that may show up there are the ones this skill posts on purpose.

## When to post there

| What | When | Yes needed |
|---|---|---|
| An issue for a fix or patch of ours | Once its pull request is merged here | The person's yes to your short draft (title and 3–6 lines) |
| A comment linking our fix, on one of the person's open upstream issues | Once our fix is merged here | No: they asked for these links. One comment per issue, ever |
| A reply to the maintainer | Only with the person's answer to the maintainer's question (shaping-a-request, step 4) | Their words |

Nothing else goes there. Never open a pull request on upstream unless the person asks for that one.

## A fix upstream already has

Look at `git log upstream/main` first. If upstream has fixed it on main but hasn't released it yet, don't write our
own fix:
- carry upstream's own commit as a temporary patch (`git cherry-pick -x`);
- label its issue `fixed-upstream`;
- the next release replaces it.

## How to write one

1. **Look for a duplicate first:** `gh search issues -R eliasstravik/shepherdr "<words>"` (no `--state`: it searches open and closed).
   - A closed one may say "by design". Then don't ask again: bring the reasoning to the person (shaping-a-request).
   - An open one gets one comment linking our fix, instead of a second issue.
2. **Write it in upstream's own words.**
   - Use its terms (docs/agents-and-terms.md).
   - Say what happened, what was expected, and the smallest repro.
   - Give the version (`shepherdr version`).
   - Include no private names, paths, hosts, data or settings. Everything upstream gets is public.
3. **Link our work:** "We carry a fix in our fork: <link to the dmalis/shepherdr pull request>." Say it's there for
   reference, not as a request to merge.
4. **Respect upstream's stated design.** It is in the Rules of docs/develop.md, in docs/settings.md and in the
   README.
   - Ask for the smallest change that would let us drop our patch.
   - Never argue against a principle.
   - Never ask twice after a "not planned".
5. **File it** with `gh issue create -R eliasstravik/shepherdr`. Then:
   - label our issue `upstream-proposed`;
   - put the upstream link in its status line.

## Following them

- **Each sync lists the person's upstream issues** that were closed or got a reply since the last sync. Find them
  with `gh search issues -R eliasstravik/shepherdr --author dmalis --updated ">=<last sync date>"`. For each one,
  give:
  - the maintainer's words, shortened;
  - the release that has the fix.
- **When upstream fixes one of ours,** the sync drops our patch (upstream-sync skill, step 3).
- **When the maintainer declines, proposes another way or asks something,** don't just keep our patch. Rethink it
  with the shaping-a-request skill (step 4):
  1. Open an issue here labelled `rethink`. Give the person's need, the maintainer's reasoning, both ways tried on
     the current release, the cost of carrying ours, and your recommendation.
  2. Ask the person one question: "Upstream's way", "Ours", or the third way you found.
  3. If the answer is theirs, the sync drops our patch.
