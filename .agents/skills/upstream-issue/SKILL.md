---
name: upstream-issue
description: File, link or follow an issue on upstream Shepherdr (eliasstravik/shepherdr) for this fork's person. Use when Shepherdr lets the person down, when one of our patches could go upstream, when an upstream issue of theirs is fixed or our fork fixes it, or when asked about their upstream issues.
---

# Issues on upstream

Upstream is someone else's public project. It hears only from the person, and only what they said yes to.

## When to write there

| What | When | Yes needed |
|---|---|---|
| A pain or bug the person hit | After Shepherdr's own Feedback question ("Leave feedback for Shepherdr about …?"), or the person asks | Their Yes to that one issue |
| A design request, for something we carry as a patch | Once per patch, after its pull request is merged here | Their Yes to your short draft (title and 3–6 lines) |
| A link to our fix on one of the person's open upstream issues | When our fork fixes it and upstream still hasn't, after 3 days open, or at once if the person asked | No: they asked for these links. One comment per issue, ever |

Nothing else goes there. Never open a pull request on upstream unless the person asks for that one.

## How to write one

1. **Look for a duplicate first:** `gh search issues -R eliasstravik/shepherdr "<words>" --state all`.
   - A closed one can say "by design". Then we keep the patch and don't ask again.
   - An open one gets one comment adding what's new, instead of a second issue.
2. **Write it in upstream's own words:**
   - its terms (docs/agents-and-terms.md);
   - what happened, what they expected, the smallest repro;
   - the version (`shepherdr version`).

   No private names, paths, hosts, data or settings. Everything upstream gets is public.
3. **Link our work:** "We carry a fix in our fork: <link to the dmalis/shepherdr pull request>". Say it's there for
   reference, not as a request to merge.
4. **Respect upstream's stated design** (docs/develop.md Rules, docs/settings.md, README):
   - Ask for the smallest change that would let us drop our patch.
   - Never argue against a principle.
   - Never ask twice after a "not planned".
5. **File it:** `gh issue create -R eliasstravik/shepherdr`. Then label our issue `upstream-proposed`, and put the
   upstream link in its status line.

## Following them

- Each sync lists the person's upstream issues closed since the last one, with how each was resolved. That is the
  maintainer's closing words and the first release that has the fix.
- **Closed as not planned: rethink it, don't just carry it.**
  1. Open an issue here labelled `rethink`. It holds:
     - the person's need;
     - upstream's reason, in the maintainer's words;
     - upstream's way of meeting the need, if any, tried for real on the current release;
     - our way, and what a patch would cost to carry;
     - your recommendation.
  2. Ask the person one question with the question tool: "Upstream's way", or "Ours as a patch".
  3. Theirs: close the rethink issue, and say how to use upstream's way. Ours: the rethink issue becomes a `patch`
     issue (fork-patch skill).
- When upstream ships a fix for one of our patches, the sync drops our patch (upstream-sync skill, step 3).
- An upstream reply that asks something goes to the person as one plain question. Never answer for them.
