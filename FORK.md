# This repo is a fork

dmalis/shepherdr is a public fork of eliasstravik/shepherdr ("upstream"). Upstream's releases come first; our patches
sit on top of each release, adapted to it. This file adds the fork's rules and never loosens AGENTS.md's safety and
test rules, or the rules for agents' own logins and settings. Its two exceptions to AGENTS.md:
- **Upstream issues:** the only thing posted upstream is the person's own reply, in their words, when the author asks
  something on one of their open upstream issues (upstream-issue skill).
- **The install step:** the "Upstream sync" schedule's run may install, once #2 has proven it, and may push `ours-*`
  tags. Install tags are not releases; AGENTS.md's release rules still hold.

## The aim

- **Our own Shepherdr:** faster than upstream and shaped for the person, on top of every upstream release.
- **A closed loop:** every problem and request is found here, filed here, fixed here and installed here. Upstream
  hears nothing from us ("Upstream issues").
- **Every upstream release comes in.** When it ships what we carry, we take theirs by default: carrying less is
  cheaper. Ours stays only where it is clearly better for the person, as a small addition on top of theirs.
- **Cheap to carry:** a patch is small, lives in its own files where it can, is built the way upstream builds things
  and has a test for every upstream behaviour it relies on, so each sync stays cheap. It is built for every Shepherdr
  user where that costs nothing extra; what suits only the person is a setting.
- **The person doesn't code.** Agents design, build, review, sync and install. Ask the person only for product
  decisions and the yeses named here.
- **Think for the person:** shape every request with the shaping-a-request skill before building (the need behind
  the ask, upstream and industry practice, push back, recommend the best way, which may be upstream's).

## Where things are

| What | Where |
|---|---|
| Our repo (public) | github.com/dmalis/shepherdr: remote `origin`, and `gh repo set-default` |
| Upstream | github.com/eliasstravik/shepherdr: remote `upstream`. Releases are tags `vX.Y.Z` |
| `main` | The newest upstream release we took, plus our patches. Changed only by pull request. A sync of an upstream release merges once its checks pass; our own merges in this space merge right away, and CI reports after (upstream-sync skill, "Schedules") |
| Install tags | `ours-<upstream version>-<n>`, e.g. `ours-3.2.21-1`: a commit that was tried and installed |
| This space | `~/development/projects/shepherdr-dev`. Tasks work in worktrees of it |
| Install folder | `~/development/projects/shepherdr`: the live Shepherdr's checkout, detached at the installed tag. Only the install step moves it |
| Record of all work | Issues and pull requests on dmalis/shepherdr |
| Our own files | `FORK.md`, `fork/` (specs, scripts, their tests), `.agents/skills/` (linked from `.claude/skills/`), the fork paragraph at the top of AGENTS.md |

## Rules

- **Nothing that risks a ban:** every task checks it before ready (AGENTS.md: "Nothing that risks a ban").
- **Everything here is public.** No customer or project names, business data or secrets, home paths (`/home/...`,
  `/Users/...`), host names, the person's email or their private settings, in any file, commit, issue or pull
  request. Commits use the repo's no-reply email (`git config user.email`); never change it. Before `ready`, read
  what goes public (summary, details, proof titles); paste no raw installer or log output there. The person's
  working methods and settings live in `~/.config/shepherdr/settings.json` on the serving machine, never in this repo.
- **Pull requests and issues go to dmalis/shepherdr.** `gh repo set-default --view` must print `dmalis/shepherdr`
  (else stop and fix that first). Name the repo on every `gh pr` or `gh issue`: `-R dmalis/shepherdr`, or
  `-R eliasstravik/shepherdr` only to read, or for the one reply the upstream-issue skill allows. Never open a pull
  request or an issue on upstream.
- **Only the install step installs.** Never run `shepherdr update` or `shepherdr install`, never change the install
  folder, never stop or restart the live Shepherdr, herdr-core or their agents. Every check runs on throwaway
  sessions and scratch roots (AGENTS.md: Tests).
- **Name issues and pull requests by what they are** in anything the person reads: a short title, its link or
  number after: "the install step's terminal check (#25)". GitHub's own text keeps its numbers (`Part of #n`, issues
  linking each other); upstream issues are plain text (upstream-issue skill).
- **Releases come in only through the upstream-sync skill.** Never GitHub's fork sync on dmalis/shepherdr: "Update
  branch" merges upstream's unreleased `main`, "Discard commits" throws our patches away.

## Every piece of work is recorded on GitHub

- Each change the person asks for starts as an issue on dmalis/shepherdr (fork-patch skill, step 1).
- Each pull request names its issue with `Part of #n`, never `Closes`: an issue closes once its fix is live and the
  install is healthy (a device check waits for the person), never at merge.
- Status lines and labels (`patch`, `live`, `device-check` and the rest): fork-patch skill, "The record on GitHub".
- **Check upstream first,** before an issue for a change to Shepherdr and again when its task starts building:
  fork-patch skill, step 1. Then shape it (shaping-a-request) and build it (fork-patch).

## Upstream issues

This fork is on its own path: we file nothing upstream and offer it nothing, and the person never waits on it. The
person's issues already open there are followed until they close; the only post is the person's own reply when the
author asks something on one of them. Following them, and taking upstream's fix when a release has it:
upstream-issue skill.

## Every friction is a candidate fix

Every agent watches for friction all the time, the Assistant and task agents alike. Friction is when:
- the person is confused, misreads a screen or asks "what is this" (confusion is a UX problem: fix the screen, don't
  explain it away; shaping-a-request skill);
- they work around something, or answer something they shouldn't need to;
- an agent did by hand what should happen on its own (started a task that should have started, recovered lost work,
  re-ran a step);
- an agent got something wrong, or met a likely bug in Shepherdr.

**Record it at once,** so it lands under Found on the Feedback page, the person's pick list:
`herdr-task feedback "<the problem in one line>" --kind <bug|confusing|workaround|manual|miss> --details "<goal;
what happened; what was expected>" --fix "<the fix for every user, in one line>"`. A report keeps `--details`;
`--goal`, `--happened` and `--expected` count only when filing. Task agents report this way, at the end of every
brief, every Shepherdr step that confused them or that they did by hand.

**Propose it, don't promise.** In the same reply, say the friction and its fix in one or two plain lines: what went
wrong, the fix for every user, whether it would be a patch. Ask "File it and fix it?" only when it hurts now; else the
row waits for the person's pick. A yes to file is also the yes to fix it. "I'll do better next time" is never the
whole answer. When the miss was your own and your instructions already cover it, say so, and still look for a
product fix that makes the miss impossible or visible.
Filing, the yes for the exact text, and what a post starts: shaping-a-request skill, "Filing and the handoff".

**Every post becomes work here, once** (`fork/bin/found`). A handoff message ("Posted on the person's yes, to fix
here: <issue link>. First run fork/bin/found task …"): open the shaping-a-request skill, section "Filing and the
handoff". So does the person's "what else did we find".

## Industry standard first

Every UI and UX change follows the industry standard and the common pattern of well-known apps: browsers, Slack,
Linear, GitHub, Figma, Notion, VS Code, and the iOS and macOS conventions. Name the apps you followed in the pull
request.
- Standard keys keep their standard meaning on every keyboard layout: match a shortcut by the character it types,
  not only the key's place (Cmd/Ctrl with −, + or 0 zooms, ? or Cmd/Ctrl / opens the shortcuts sheet, Esc closes,
  Cmd/Ctrl K searches). Never move a standard key or pattern to make room for ours; where Shepherdr breaks a
  standard today, that's a UX bug to fix here.
- **All UI work uses the UI skills** (the Skill tool), within Shepherdr's design system (`web/src/ds.css`) and these
  patterns. Every task brief that touches UI says so.
  - **Read [docs/design.md](docs/design.md) first:** the one design document (tokens, sizes, surfaces, colour roles,
    motion, writing, touch, performance budgets). Its rules hold today; its Target lines are built by
    fork/specs/ui-polish.md's slices. A deliberate change to the shared design updates it in the same pull request,
    never just to get around a rule, and `test/test_design.py`'s counts only go down.
  - Always `frontend-design:frontend-design`, plus every one that fits: `better-ui` (surfaces, radii, shadows, icon
    states), `better-layout` (grouping, responsive, phone), `better-typography`, `better-colors` (tokens, contrast in
    light, dark and night), `better-accessibility` (focus, ARIA, screen readers, zoom), `design-motion-principles`
    and `emil-design-eng` (any animation or transition; `fixing-motion-performance` if it could jank),
    `mobile-responsiveness` and `mobile-ios-design` (phone layouts). `web-design-guidelines` as a review pass before
    ready.
  - **Motion** follows Shepherdr's Motion setting (Settings › General › Motion: Reduced sets
    `html[data-motion="reduced"]`, `web/src/prefs.ts`) as well as `prefers-reduced-motion`: when either asks for
    less, the change is instant or opacity only.
  - **Check the result** in screenshots at 390px and desktop width, light and dark. The summary names the skills used.

## Private context and reading order

- The planning notes are in `.private/` in this space's folder, git-ignored and never committed. Read
  `.private/CONTEXT.md` before your first piece of work.
- Learning Shepherdr: README.md; templates/assistant.md, worker.md and reviewer.md; docs/develop.md (its Rules),
  settings.md, plugins.md, upgrading.md and agents-and-terms.md; AGENTS.md, for testing without the live install.
