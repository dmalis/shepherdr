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
  - carried since `ours-…`;
  - proposed upstream (with the link);
  - fixed upstream in `vX.Y.Z`, then dropped.
- **Labels:**
  - `patch`: a change we carry.
  - `pipeline`: sync, trial and install.
  - `sync-blocked`: a release waits on a patch.
  - `upstream-proposed`: we asked upstream.
  - `fixed-upstream`: upstream shipped it.
  - `later`: not now.

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

The upstream-issue skill.
- **Fix it here first, then tell upstream:** an issue linking our merged pull request, on the person's yes. The
  person never waits on upstream.
- **When the maintainer closes one of the person's issues without a fix,** we always build our own solution.
  Once it is merged, we post one comment on that closed issue linking our pull request, for the maintainer to decide
  on. We never post a second issue for it.
- **When the maintainer proposes another approach or asks something,** it is rethought with the person. It is never
  ignored.
- **When upstream ships one of ours,** the next sync drops our patch.
- **Private context.** The planning notes are in `.private/` in this space's folder. It is git-ignored and never
  committed. Read `.private/CONTEXT.md` before your first piece of work.

## Learning Shepherdr

Read in this order:
1. README.md.
2. templates/assistant.md, worker.md and reviewer.md.
3. docs/develop.md (its Rules), settings.md, plugins.md, upgrading.md and agents-and-terms.md.
4. AGENTS.md, for testing without touching the live install.
