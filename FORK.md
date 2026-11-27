# This repo is a fork

dmalis/shepherdr is a public fork of eliasstravik/shepherdr ("upstream"). Upstream's releases come first. Our
patches sit on top of each release and are adapted to it. On anything about this fork, this file wins over
AGENTS.md. AGENTS.md still says how to build and test Shepherdr without touching the live install.

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

  The person's own working methods and settings live in `~/.config/shepherdr/settings.json` on the serving machine.
  They never go in this repo.
- **Pull requests and issues go to dmalis/shepherdr.**
  - Before any `gh pr` or `gh issue` command, `gh repo set-default --view` must print `dmalis/shepherdr`.
  - If it prints anything else, stop and fix that first.
  - Upstream only gets what the upstream-issue skill allows.
- **Only the install step installs.**
  - Never run `shepherdr update` or `shepherdr install`, and never change the install folder.
  - Never stop or restart the live Shepherdr, herdr-core or their agents.
  - Every check runs on throwaway sessions and scratch roots, as AGENTS.md's Tests section says.
- **Never press GitHub's "Sync fork" or "Discard commits"** on dmalis/shepherdr. They reset `main` to upstream's and
  drop our patches. Releases come in only through the upstream-sync skill.

## Every piece of work is recorded on GitHub

- **Each change the person asks for starts as an issue** on dmalis/shepherdr, with:
  - why: their words and their pain;
  - what it does;
  - acceptance criteria;
  - where it lives in the code.

  The open issues labelled `patch` are the list of what we carry.
- **Each pull request names its issue** with `Closes #n` or `Part of #n`.
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

Use the fork-patch skill. In short:
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

The upstream-issue skill:
- A bug or pain goes upstream only on the person's yes.
- A design request goes upstream once, linking our pull request.
- When upstream fixes one of ours, the next sync drops our patch.

## Learning Shepherdr

Read in this order:
1. README.md.
2. templates/assistant.md, worker.md and reviewer.md.
3. docs/develop.md (its Rules), settings.md, plugins.md, upgrading.md and agents-and-terms.md.
4. AGENTS.md, for testing without touching the live install.
