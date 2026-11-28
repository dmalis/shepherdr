---
name: shaping-a-request
description: Turn what the person asks for into the right change, before any spec or code. Use whenever the person asks for a change, fix, feature or setting in Shepherdr, says how something should work, reports a pain, or when upstream declines or answers one of their requests. Also use when you notice friction yourself: the person is confused or works around something, you did by hand what should happen on its own, or you or a task got something wrong.
---

# Shaping a request

The person doesn't code, and they know their idea of a solution may not be the best one. They count on you to be
smarter about it than they are. Find what they really need, learn how others solve it, and guide them to the best
way. That may be their way, upstream's, or a third.

**Don't wait to be asked.** Every friction is a candidate fix (FORK.md: "Every friction is a candidate fix"). Record
it at once with `herdr-task feedback` (FORK.md: "Record it at once"), so it waits under Found on the Feedback page.
In the same reply, say the fix in one or two plain lines: what went wrong, the fix for every user, and whether it
would be a patch. Ask "File it and fix it?" only when it hurts now. "I'll do better next time" is never the whole
answer. Filing means an issue on dmalis/shepherdr, never upstream, and the person's yes is for the exact draft: Post
it on the Feedback page, or a yes to a question card that showed the draft. `fork/bin/found` then hands the issue to
this space's Assistant, once (FORK.md: "Every post becomes work here, once"). Shape it here like any other request:
`fork/bin/found task <issue>` first, and `fork/bin/found took <issue> --task <key>` once the work is in a task.

## 1. Find the need behind the ask

- **Restate the request as the problem it solves.** Say what goes wrong or what should happen, and for whom.
  - "Up to ten review rounds" is a solution.
  - "Bugs still reach production after review" is the need.
- **Look at the evidence yourself before you ask.** It is in:
  - the tasks, cards and review records;
  - the logs and the repo;
  - the upstream issue they filed.
- **Ask the person only what the evidence can't tell you.** Ask one question at a time, with the question tool,
  your recommended answer first.

## 2. Research before you propose

- **Upstream first.**
  - Does Shepherdr already do it? Check docs/, Settings and the templates.
  - Is it fixed or reported upstream already? Check upstream first (FORK.md, and the fork-patch skill's step 1 for
    the commands): our release against upstream's, upstream's main since then on the files involved, and short
    keyword searches of its issues, open, closed and not planned.
  - Read the maintainer's reasoning. Read upstream's stated principles: the Rules in docs/develop.md,
    docs/settings.md and the README.
- **Industry practice.**
  - How do mature teams and tools meet this need? For example: code review, CI gates, release engineering, agent
    orchestration.
  - Search the web for current, primary sources: official docs and well-known engineering writing.
  - Note where the person's idea departs from that practice, and whether it still fits their situation.
- **The cost of carrying it.**
  - Which upstream files a patch would touch.
  - How often those files change: `git log upstream/main --since=30.days --oneline -- <file> | wc -l`.

## 3. Propose and guide

- **Give 2–3 options.** Include "upstream's way" when there is one, and "change nothing" when the need is already
  met. For each option, say:
  - what the person would notice;
  - what it costs;
  - how it fits upstream.
- **Recommend one,** and say why in plain words.
- **Push back when the idea won't meet the need.** For example: "More rounds won't stop this. Rounds keep finding
  new edge cases (upstream #1557). What stops it is a CI gate on the paths that move money."
  - Never just build what was asked when you believe it is wrong.
  - Never refuse it either: the person decides.
- **Zoom out** when several asks share one cause. Propose the one fix for the cause.
- **Ask with the question tool:** one question, your recommendation first.

## 4. Then

- **Record the decision in the issue:** the need, the options, the choice and why.
- **If they chose our way,** the fork-patch skill builds it.
- **If they chose upstream's way,** show the person how to use it. There is no patch.
- **When upstream declines one of their requests,** we build our own; the person decided that once, for every
  decline. Use the maintainer's reasoning to shape how it's built (the upstream-issue skill).
- **When upstream proposes another approach or asks a question,** come back here.
  1. Weigh the maintainer's reasoning against the need and the research.
  2. Recommend: adopt upstream's way and drop ours, keep ours, or a third way.
