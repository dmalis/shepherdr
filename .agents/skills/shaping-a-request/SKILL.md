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
`fork/bin/found task <issue>` first, and `fork/bin/found took <issue> --task <key>` once the work is in a task (a
new one carries the issue's link in its brief). The issue's text stays as approved: your shaping goes in the brief.

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
  - what it costs to build and to carry through upstream's releases;
  - whether upstream already has it, or a part of it we could build on.
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
- **When upstream declines one of the person's open upstream issues,** we build our own; the person decided that
  once, for every decline. Use the maintainer's reasoning to shape how it's built (the upstream-issue skill).
- **When upstream proposes another approach or asks a question** on one of them, come back here.
  1. Weigh the maintainer's reasoning against the need and the research.
  2. Recommend: adopt upstream's way and drop ours, keep ours, or a third way.

Nothing is offered upstream (FORK.md: "Upstream issues"): researching upstream is how we find what it already has.

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
3. **Offer the better UX:** how upstream and comparable tools show the same state or action, and your recommended
   hint, label, state or default that would have prevented the confusion for any Shepherdr user. Offer it in the
   same reply.
4. **Record it** under Found (FORK.md: "Record it at once"), and fix it here (fork-patch skill) once the person
   picks it on the Feedback page or says yes in chat.

The fix is done when the screen makes the behaviour clear, not when the person has understood it.

## Filing and the handoff

- **The yes is for the exact text.** On the Feedback page: File it… shows the draft and where it goes, and Post it is
  the yes. In chat: a question card that shows the draft (`herdr-task feedback --file` writes it), then `--approve
  <rev> --by chat` and `--file --rev <rev>`.
- **The Feedback note** (`agents.feedback_note`, Everywhere's, in the person's settings file) says before every post
  what posting starts here: "A new issue posted here also starts a fix in this repo's space" (a comment starts none).
  An Assistant sets it once, with the person's yes, when it is missing.
- **Every post becomes work here, once** (`fork/bin/found`). The filing Assistant runs `fork/bin/found` right after it
  files, and every run of the upstream-sync skill does too (its step 7), so a post found later still goes within a
  day. It hands each new issue posted on our repo to this space's Assistant (`herdr-task tell-assistant`), sends again
  until it is taken, and makes nothing for a comment.
- **On a handoff message** (it names the issue's link): first `fork/bin/found task <issue>`. It names a task: the work
  is there, add nothing. Else shape it (check upstream first), add it to a running task when it fits (below) or add a
  task with the issue's link in its brief, then `fork/bin/found took <issue> --task <its key>`. A task added before a
  lost `took` is still found by that link; a repeated reply lands in the same running task. The issue's text stays as
  the person approved it: the why, acceptance criteria and where it lives go in the task's brief, and only its labels
  go on the issue (fork-patch skill).
- **A pick or a yes in chat that posted nothing** (the person asked for a fix without filing): an issue here, a task
  with a brief (this skill first), an install right after the merge.
  - A change to Shepherdr is a patch (fork-patch skill): labelled `patch`.
  - A change to only our own files (`FORK.md`, `fork/`, `.agents/`) has no patch file: its issue is labelled
    `pipeline`.
  - Either way it also gets its kind (`bug` or `enhancement`) and `needs-triage`, and it closes once its fix is
    live, by the install for a Triage fix, else by the person (fork-patch skill, "The record on GitHub").
- **When the fix belongs to a running task's area,** add it to that task (`herdr-task reply`) instead of opening a new
  one, and say so.
- **Other spaces' task agents** get the friction rule from the Everywhere "When a task starts" notes
  (`tasks.start_notes`), never from `templates/worker.md`: "Also report with the feedback command at the end of your
  brief every Shepherdr step that confused you or that you did by hand."
- **"What else did we find":** first record any friction from the session not recorded yet, then list what waits
  under Found on the Feedback page, each with its proposed fix: from `herdr-task feedback --list --all --json`, every
  row the page puts under Found. That leaves out a row filed or being filed (state `filed` or `filing`, or a `url`),
  declined (state or decision `declined`), or put off (decision `later` with no `until`, or an `until` still ahead).
