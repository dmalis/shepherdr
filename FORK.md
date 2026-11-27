# This repo is a fork

dmalis/shepherdr is a public fork of eliasstravik/shepherdr ("upstream"). Upstream's releases come first. Our
patches sit on top of each release and are adapted to it.

This file adds the fork's own rules. It never loosens AGENTS.md's safety and test rules, or the rules for agents'
own logins and settings. It makes exactly two exceptions to AGENTS.md:
- **Upstream issues:** they are posted as the upstream-issue skill says.
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
| `main` | The newest upstream release we took, plus our patches. Changed only by pull request, once the `check` workflow passes |
| Install tags | `ours-<upstream version>-<n>`, e.g. `ours-3.2.21-1`: a commit that was tried and installed |
| This space | `~/development/projects/shepherdr-dev`. Tasks work in worktrees of it |
| Install folder | `~/development/projects/shepherdr`: the checkout the live Shepherdr is installed from, detached at the installed tag. Only the install step moves it |
| Record of all work | Issues and pull requests on dmalis/shepherdr (see below) |
| Our own files | `FORK.md`, `fork/` (specs, scripts, their tests), `.agents/skills/` (linked from `.claude/skills/`), the first line of AGENTS.md |

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

  An issue with several fixes lists each pull request on its status line, with what became of it.
- **Labels:**
  - `patch`: a change we carry.
  - `pipeline`: sync, trial and install.
  - `sync-blocked`: a release waits on a patch.
  - `fixed-upstream`: upstream shipped it.
  - `later`: not now.
- **What the person decided about a fix:** one of these describes the issue as a whole (the upstream-issue skill:
  "After a fix lands").
  - `not-filed`: the fix is merged and live, and the person hasn't decided yet.
  - `upstream-proposed`: they said file it, and we posted it upstream.
  - `fork-only`: they said keep it ours.
  - `reverted`: they said undo it, and the revert has merged and installed.

## How a change becomes a patch

First shape it (the shaping-a-request skill). Then use the fork-patch skill. In short:
- **Spec first** for anything bigger than a small fix. Write it in `fork/specs/<name>.md`; the reviewer reviews it
  like code. The building tasks are then added `--after` it.
- **Build on upstream's own extension points:** a plugin for UI (docs/plugins.md), a settings key, a new module.
  Prefer these to edits in upstream's busiest files.
- **Pin what you rely on:** a test for every upstream behaviour the patch depends on, so the next sync sees a break at
  once.

## Upstream releases

The schedule "Upstream sync" runs at 06:00 and 18:00 and follows the upstream-sync skill:
1. Take the newest upstream release whole.
2. Adapt our patches to it.
3. Check it, then try it for real on a throwaway Shepherdr.
4. Install it, and roll back if the health check fails.

A release whose patches don't fit yet waits until they do. After 24 hours waiting, the person is asked.

## Upstream issues

The upstream-issue skill. The person's standing rule: our Shepherdr works for them, built in a way that fits
Shepherdr for everyone. The person decides, fix by fix, whether we offer it upstream, and upstream's author decides
whether it goes into theirs.
- **Fix it here first.** Every problem the person filed upstream (open, or closed without a fix) and every one they
  find later is fixed here as a patch (the fork-patch skill), unless upstream's own release already fixes it. The
  person never waits on upstream.
- **Confusion is a UX problem.** When Shepherdr's behaviour confuses the person, first check whether they know the
  process behind it (how tasks, settings, review and merge work).
  - They know it and are still confused: the screen gave a wrong or missing hint. Offer them the better UX, then fix
    it here like any other fix. Explaining it away closes nothing.
  - They don't know the process yet: explain it briefly.
- **Build it for every Shepherdr user.** Nothing in it is tied to the person's machines, projects or habits. What
  only suits them becomes a setting, with their value in their settings file. What can't fit everyone says so on its
  issue, so the person can keep it ours.
- **Then the person decides, fix by fix.** Once our pull request is merged, its issue is labelled `not-filed`, and
  nothing goes upstream until the person decides that fix:
  - **File it:** that is the yes, with no draft round. After a search upstream for a duplicate, we post one comment
    on their existing issue, or one new upstream issue, linking our pull request. `upstream-proposed`.
  - **Keep it ours:** `fork-only`. Nothing is posted.
  - **Undo it:** a revert pull request first. `reverted` goes on, and the issue closes, only once the revert has
    merged and installed healthily.

  What we post always says it is the author's to take as it is, do differently or drop. One comment per issue, ever,
  and never a second issue for the same problem.
- **The person sees what waits.** The Assistant lists the `not-filed` fixes when asked, and once a day.
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
