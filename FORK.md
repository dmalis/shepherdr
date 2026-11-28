# This repo is a fork

dmalis/shepherdr is a public fork of eliasstravik/shepherdr ("upstream"). Upstream's releases come first. Our
patches sit on top of each release and are adapted to it.

This file adds the fork's own rules. It never loosens AGENTS.md's safety and test rules, or the rules for agents'
own logins and settings. It makes exactly two exceptions to AGENTS.md:
- **Upstream issues:** they are posted only in an upstream round the person asked for, and replies to the author
  only in the person's words, as the upstream-issue skill says.
- **The install step:** the "Upstream sync" schedule's run may install, once #2 has proven it, and may push
  `ours-*` tags. Install tags are not releases; AGENTS.md's release rules still hold.

## The aim

- **What runs:** upstream's newest release, plus the changes the person asked for that upstream doesn't have (yet).
  Our Shepherdr gets better every day, whether or not upstream takes our requests.
- **Stay close to upstream.**
  - A patch is small and lives in its own files where it can.
  - It is built the way upstream builds things, so upstream could take it as it is.
  - When upstream ships the same thing, ours is deleted.
- **Who does the work.** The person doesn't code. They ask the Assistant for changes, from a one-line fix to a large
  feature. Agents design, build, review, sync and install. Ask the person only for product decisions and for the
  yeses named below.
- **Think for the person.** Shape every request with the shaping-a-request skill before building:
  - find the need behind the ask;
  - research upstream and industry practice;
  - push back on an idea that won't meet the need;
  - recommend the best way, which may be upstream's.

## Where things are

| What | Where |
|---|---|
| Our repo (public) | github.com/dmalis/shepherdr: remote `origin`, and `gh repo set-default` |
| Upstream | github.com/eliasstravik/shepherdr: remote `upstream`. Releases are tags `vX.Y.Z` |
| `main` | The newest upstream release we took, plus our patches. Changed only by pull request. A sync of an upstream release merges once its checks pass; our own merges in this space merge right away, and CI reports after (see Our own merges) |
| Install tags | `ours-<upstream version>-<n>`, e.g. `ours-3.2.21-1`: a commit that was tried and installed |
| This space | `~/development/projects/shepherdr-dev`. Tasks work in worktrees of it |
| Install folder | `~/development/projects/shepherdr`: the checkout the live Shepherdr is installed from, detached at the installed tag. Only the install step moves it |
| Record of all work | Issues and pull requests on dmalis/shepherdr (see below) |
| Our own files | `FORK.md`, `fork/` (specs, scripts, their tests), `.agents/skills/` (linked from `.claude/skills/`), the fork paragraph at the top of AGENTS.md |

## Rules

- **Everything here is public.** Never put any of these in a file, commit, issue or pull request:
  - customer or project names, business data or secrets;
  - home paths (`/home/...`, `/Users/...`), host names, or the person's email;
  - their private settings.

  Commits here use the repo's no-reply email (`git config user.email`); never change it. Before `ready`, read what
  goes public (summary, details, proof titles), and paste no raw installer or log output there.
  The person's own working methods and settings live in `~/.config/shepherdr/settings.json` on the serving machine.
  They never go in this repo.
- **Pull requests and issues go to dmalis/shepherdr.**
  - `gh repo set-default --view` must print `dmalis/shepherdr`. If it prints anything else, stop and fix that first.
  - Name the repo on every `gh pr` or `gh issue` you run yourself: `-R dmalis/shepherdr`, or
    `-R eliasstravik/shepherdr` only as the upstream-issue skill allows.
  - Never open a pull request on upstream unless the person asks for that one.
- **Only the install step installs.**
  - Never run `shepherdr update` or `shepherdr install`, and never change the install folder.
  - Never stop or restart the live Shepherdr, herdr-core or their agents.
  - Every check runs on throwaway sessions and scratch roots, as AGENTS.md's Tests section says.
- **Name issues and pull requests by what they are.** The person doesn't follow numbers. In anything written for
  them (chat, `--told` words, summaries and details they read), name an issue or pull request by a short title or
  summary; its link or number may follow: "the install step's terminal check (#25)".
  - GitHub's own text keeps its numbers: a pull request's `Part of #n`, issues linking each other.
  - Upstream issues are still written as plain text, as the upstream-issue skill says.
- **Never use GitHub's fork sync buttons on dmalis/shepherdr.**
  - "Sync fork" › "Update branch" merges upstream's `main`, which isn't a release yet, into ours.
  - "Discard commits" throws our patches away.

  Releases come in only through the upstream-sync skill.

## Every piece of work is recorded on GitHub

- **Each change the person asks for starts as an issue** on dmalis/shepherdr, with:
  - why: their words and their pain;
  - what it does;
  - acceptance criteria;
  - where it lives in the code.

  The open issues labelled `patch` are the list of what we carry and build.
- **Each pull request names its issue** with `Part of #n`, never `Closes`. A patch's issue stays open while we carry
  it. It closes only when the patch is retired, after a healthy install without it.
- **The issue keeps a short status line**, one of:
  - building;
  - carried since `ours-…`, not filed yet;
  - proposed upstream (with the link), or declined upstream (with the link);
  - fork-only (with why);
  - reverted (with the revert's pull request);
  - fixed upstream in `vX.Y.Z`, then dropped.

  After it, in plain words: what the fix does and how to try it. An issue with several fixes lists each pull
  request on its status line, with what became of it.
- **Labels:**
  - `patch`: a change we carry.
  - `pipeline`: sync, trial and install.
  - `sync-blocked`: a release waits on a patch.
  - `fixed-upstream`: upstream shipped it.
  - `later`: not now.
  - `device-check`: a live fix only a real device can confirm (an iPhone's home screen, a real keyboard, push on a
    device, haptics), not confirmed by the person yet. The install puts it on, from the issue's "Device check" line.
    It comes off only when they confirm. If they say it's still wrong, that fix's part of the status line goes back
    to building, with what they saw, and a fix task starts; the label stays until they confirm the new fix.
- **Is it on the person's machine:** `live`, installed and running on their Shepherdr. The install step puts it on
  every issue its installed patch list (`fork/patches/`) names, and takes it off one whose fix left (upstream-sync skill,
  step 7). No `live`: not installed yet.
- **Where a fix stands with upstream:** one of these describes the issue as a whole (the upstream-issue skill:
  "After a fix lands").
  - `not-filed`: the fix is merged and live, and not offered upstream yet. The next upstream round picks it up.
  - `upstream-proposed`: an upstream round offered it.
  - `fork-only`: it stays ours: the person said keep it ours, it can't fit everyone, or it changes only our own
    files.
  - `reverted`: the person said undo it, and the revert has merged and installed.

## How a change becomes a patch

First shape it (the shaping-a-request skill). Then use the fork-patch skill. In short:
- **Check upstream first,** before an issue here for a bug or fix in Shepherdr, and again when its task starts
  building. It may be fixed already. The commands are in the fork-patch skill, step 1.
  1. **Are we up to date?** Upstream's newest release against the one our main carries, and upstream's main since
     then, on the files involved. Fixed there: nothing to build. Say so and let the sync bring it, or carry upstream's
     own commit early if it hurts now (upstream-issue skill: "A fix upstream already has").
  2. **Is it reported upstream?** A few short keyword searches of upstream's issues, open and closed. Read the close
     reason and the maintainer's words of each match.
  3. **Then file here,** with one line: "Upstream checked: v<release>, main <short sha>; related: <upstream issues as
     plain text, or none>". A match declined upstream is built our own way; one fixed upstream is not built.
- **Spec first** for anything bigger than a small fix. Write it in `fork/specs/<name>.md`; the reviewer reviews it
  like code. The building tasks are then added `--after` it.
- **Build on upstream's own extension points:** a plugin for UI (docs/plugins.md), a settings key, a new module.
  Prefer these to edits in upstream's busiest files.
- **Pin what you rely on:** a test for every upstream behaviour the patch depends on, so the next sync sees a break at
  once.
- **Register it in its own file:** `fork/patches/<issue>.json` names its files and tests. A patch writes only its own
  file, so patches built side by side merge without a conflict.

## Upstream releases

The schedule "Upstream sync" runs at 06:00 and 18:00 and follows the upstream-sync skill:
1. Take the newest upstream release whole.
2. Adapt our patches to it.
3. Check it, then try it for real on a throwaway Shepherdr.
4. Install it, and roll back if the health check fails.

A release whose patches don't fit yet waits until they do. After 24 hours waiting, the person is asked.

## Our own merges

Our merges in this space merge right away, without waiting for CI, and install right away. The schedule "Install
each merge" runs each time a task here is merged, and follows the upstream-sync skill's install-merged steps:
1. Take main's tip as it is now. Fixes merged during an install go in with the next one, right after.
2. Install it with no trial and no wait for CI. Its health check also reads the web app and herdr-task. Roll back if
   the health check fails. A fix only a device can confirm is never told as fixed: "not seen on a device yet: please
   check <its Device check line>" (`device-check`).
3. Then CI on main reports. A red result is told once, to open a fix task. Nothing rolls back on it. The last install
   whose CI passed is kept, to go back to on the person's request.

A change to the pipeline's own code (`fork/bin`, `fork/sync`) is rehearsed on a scratch root before it installs.

## Upstream issues

The upstream-issue skill. The person's standing rule: our Shepherdr works for them, built in a way that fits
Shepherdr for everyone. It is a closed loop: every problem and request is filed here and fixed here. Upstream hears
from us only in an upstream round the person asks for, or in their own reply to the author's question, and upstream's
author decides what goes into theirs.
- **Fix it here first.** Every problem the person filed upstream (open, or closed without a fix) and every one they
  find later is fixed here as a patch (the fork-patch skill), unless upstream already fixed it ("Check upstream
  first"). The person never waits on upstream.
- **Confusion is a UX problem.** When Shepherdr's behaviour confuses the person, first check whether they know the
  process behind it (how tasks, settings, review and merge work).
  - They know it and are still confused: the screen gave a wrong or missing hint. Offer them the better UX, then fix
    it here like any other fix. Explaining it away closes nothing.
  - They don't know the process yet: explain it briefly. It is still friction (below): record it and propose its
    fix in the same reply.
- **Every friction is a candidate fix.** Every agent watches for friction all the time, the Assistant and task
  agents alike, not only when the person asks. Friction is when:
  - the person is confused, misreads a screen or asks "what is this";
  - they work around something, or answer something they shouldn't need to;
  - an agent did by hand what should happen on its own: started a task that should have started, recovered lost
    work, re-ran a step;
  - an agent got something wrong, or met a likely bug in Shepherdr.
- **Record it at once.** Each friction is recorded the moment it's noticed, so it lands under Found on the Feedback
  page, the person's pick list:
  `herdr-task feedback "<the problem in one line>" --kind <bug|confusing|workaround|manual|miss> --details "<goal;
  what happened; what was expected>" --fix "<the fix for every user, in one line>"`. A report keeps `--details`;
  `--goal`, `--happened` and `--expected` count only when filing.
  - Task agents already report Shepherdr problems with the feedback command at the end of every brief (upstream's
    worker template). They also report, the same way, every Shepherdr step that confused them or that they did by
    hand. Tasks in this repo read that here. For every other space, it goes in the Everywhere "When a task starts"
    notes (`tasks.start_notes`), never in `templates/worker.md`: "Also report with the feedback command at the end
    of your brief every Shepherdr step that confused you or that you did by hand."
- **Propose it, don't promise.** In the same reply, the Assistant says the friction and its fix in one or two plain
  lines: what went wrong, the fix for every user, and whether it would be a patch. It asks "File it and fix it?"
  only when it hurts now, even when the feedback command says to offer it. Otherwise the row waits on the Feedback
  page for the person to pick. A yes to file is also the yes to fix it: an issue here, in our fork, and a fix task.
  - "I'll do better next time" is never the whole answer.
  - When the miss was the Assistant's own and its instructions already cover it, it says so, and still looks for a
    product fix that makes the miss impossible or visible.
  - **The yes is for the exact text.** On the page: File it… shows the draft and where it goes, and Post it is the
    yes. In chat: a question card that shows the draft (`herdr-task feedback --file` writes it), then `--approve <rev>
    --by chat` and `--file --rev <rev>`. The Feedback note (`agents.feedback_note`, Everywhere's, in the person's
    settings file) says before every post that posting also starts a fix here: "Posting also starts a fix in this
    repo's space". An Assistant sets it once, with the person's yes, when it is missing.
  - **Every post becomes work here, once** (`fork/bin/found`). The filing Assistant runs `fork/bin/found` right after
    it files, and every run of the upstream-sync skill does too (its step 7), so a post found later still goes within
    a day. It hands each new issue posted on our repo to this space's Assistant (`herdr-task tell-assistant`), sends
    again until it is taken, and makes nothing for a comment.
  - **On a handoff message** (it names the issue's link): first `fork/bin/found task <issue>`. It names a task: the
    work is there, add nothing. Else shape it (shaping-a-request, check upstream first), add it to a running task
    when it fits (below) or add a task, then `fork/bin/found took <issue> --task <its key>`. Put the issue in our
    shape on the way: the labels, why, what it does, acceptance criteria, where it lives (fork-patch skill).
  - On a pick or a yes in chat that posted nothing (the person asked for a fix without filing), the usual way: an
    issue here, a task with a brief (shaping-a-request first), an install right after the merge.
    - A change to Shepherdr is a patch (fork-patch skill): labelled `patch`, then `not-filed` once live, until an
      upstream round offers it.
    - A change to only our own files (`FORK.md`, `fork/`, `.agents/`) has nothing to file: its issue is `fork-only`
      from the start, with why.
  - When the fix belongs to a running task's area, the Assistant adds it to that task (`herdr-task reply`) instead of
    opening a new one, and says so.
- **Collect what's left.** When the person asks "what else did we find", the Assistant first records any friction
  from the session it hasn't yet, then lists what waits under Found on the Feedback page, each with its proposed
  fix: from `herdr-task feedback --list --all --json`, every row the page puts under Found. That leaves out a row
  filed or being filed (state `filed` or `filing`, or a `url`), declined (state or decision `declined`), or put off
  (decision `later` with no `until`, or an `until` still ahead).
- **Industry standard first.** Every UI and UX change follows the industry standard and the common pattern of
  well-known apps: browsers, Slack, Linear, GitHub, Figma, Notion, VS Code, and the iOS and macOS conventions. Name the
  apps you followed in the pull request.
  - Standard keys keep their standard meaning, on every keyboard layout. Match a shortcut by the character it types,
    not only by the key's place. For example, Cmd/Ctrl with −, + or 0 zooms, ? or Cmd/Ctrl / opens the shortcuts
    sheet, Esc closes, Cmd/Ctrl K searches.
  - Never move a standard key or pattern to make room for ours. Where Shepherdr breaks a standard today, that's a UX
    bug: fix it here like any other fix.
  - **All UI work uses the UI skills** (the Skill tool), within Shepherdr's own design system (`web/src/ds.css`) and
    these standard patterns. Every task brief that touches UI says so.
    - **Read [docs/design.md](docs/design.md) first.** It is the one design document: tokens, sizes, surfaces,
      colour roles, motion, writing, touch and the performance budgets. Its rules hold today and a change keeps to
      them; its Target lines are where the app is going, built by fork/specs/ui-polish.md's slices. A deliberate
      change to the shared design updates the page in the same pull request, never just to get around a rule, and
      `test/test_design.py`'s counts only go down.
    - Always `frontend-design:frontend-design`.
    - Plus every one that fits the change: `better-ui` (surfaces, radii, shadows, icon states), `better-layout`
      (grouping, responsive, phone), `better-typography`, `better-colors` (tokens, contrast in light, dark and
      night), `better-accessibility` (focus, ARIA, screen readers, zoom), `design-motion-principles` and
      `emil-design-eng` (any animation or transition; `fixing-motion-performance` if it could jank),
      `mobile-responsiveness` and `mobile-ios-design` (phone layouts).
    - `web-design-guidelines` as a review pass before ready.
    - **Motion:** every animation follows Shepherdr's Motion setting (Settings › General › Motion: Reduced sets
      `html[data-motion="reduced"]`, `web/src/prefs.ts`) as well as `prefers-reduced-motion`. When either asks for
      less, nothing moves: the change is instant or opacity only.
    - **Check the result** in screenshots at 390px and desktop width, light and dark. The summary names the skills
      used.
- **Build it for every Shepherdr user.** Nothing in it is tied to the person's machines, projects or habits. What
  only suits them becomes a setting, with their value in their settings file. What can't fit everyone says so on its
  issue: no upstream round offers it, and the first round marks it `fork-only`.
- **Every fix stays in sight here.** Every fix has its own issue, and its status line says in plain words what the
  fix does and how to try it. Once a patch is merged and live (the install that carries it), its issue is labelled
  `not-filed` and stays open. Nobody asks the person about upstream per fix, and no list of waiting fixes is sent.
  At any time they may say about a fix:
  - **Keep it ours:** `fork-only`. No round offers it.
  - **Undo it:** a revert pull request first. `reverted` goes on, and the issue closes, only once the revert has
    merged and installed healthily.
- **Upstream rounds, only when the person asks** (about once a week). Their ask is the yes for that round. The round
  gathers every live fix not offered yet, checks upstream first for each, and groups them by theme: one
  self-contained upstream issue per theme, a few in a round, never one per fix and never one mega issue. The person
  sees the round's plan in one message, and their "go" posts it. Each fix it offered gets `upstream-proposed`.

  What we post always says it is the author's to take as it is, do differently or drop. One offering comment per
  upstream issue, ever, and never a second issue for the same problem. A reply to the author's question carries only
  the person's answer, never another fix.
- **Our pull request stays in our fork,** linked from upstream. No pull request on upstream unless the person asks
  for that one.
- **When the author fixes it their own way,** the next sync drops our patch and keeps theirs.
- **When the author proposes another approach or asks something,** it is rethought with the person. It is never
  ignored.
- **Private context.** The planning notes are in `.private/` in this space's folder. It is git-ignored and never
  committed. Read `.private/CONTEXT.md` before your first piece of work.

## Learning Shepherdr

Read in this order:
1. README.md.
2. templates/assistant.md, worker.md and reviewer.md.
3. docs/develop.md (its Rules), settings.md, plugins.md, upgrading.md and agents-and-terms.md.
4. AGENTS.md, for testing without touching the live install.
