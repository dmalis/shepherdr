# Practices: a way of working per project

Spec for patch #3 (issue #3 on dmalis/shepherdr). It designs against `upstream/main` as of 27 Nov (`7bee4709`, just
after v3.2.21). Line numbers below are from that commit. The building tasks come after this spec is merged.

## The need

The person runs quick MVPs and production shops through the same Shepherdr. Today every project gets Shepherdr's one
way of working, word for word, for the Assistant, the workers and the reviewers. A repo's AGENTS.md can only argue
with those words; it can't remove them. For example, the reviewer is told that contrived timing is "minor at most",
while in a shop double submits and retried webhooks happen every day.

Upstream keeps it this way on purpose. docs/settings.md: "How agents should work is not a setting". So we carry it.

## What the person gets

- **A library of named practices**, written once in their settings file. Each has words for some or all of the three
  roles: the Assistant, the worker and the reviewer.
- **One setting picks one:** `tasks.practice`, set Everywhere, per repo, or per task.
- **The practice's words take the place of Shepherdr's own way-of-working lines.** They are not added on top.
  Everything else Shepherdr tells its agents (commands, status, ready, review records, secrets, safety, wording)
  stays upstream's and keeps updating with every release.
- **A task keeps the practice it started with.** A change reaches new tasks and the space's Assistant.
- **One command says what applies:** `herdr-task practice`.

With no practice set, nothing changes: every agent gets exactly upstream's words.

## How this differs from what upstream removed

- **SHEP-319** (#1299) removed Settings › Instructions: free text *added on top of* every agent's words, Everywhere
  and per space. Upstream's reason: agents already read AGENTS.md, so a second place for rules was noise. Practices
  add no second place for repo rules (those stay in AGENTS.md). They *replace* a few of Shepherdr's own lines, which
  nothing else can do, and they are chosen per repo through the settings hierarchy upstream already has.
- **Upstream issue 714** (agent profiles, declined: "We keep Shepherdr thin: roles live in skills and each task's
  brief, and Settings picks the CLI and model"). A practice has no CLI, model or launch flags, and adds no role. It is
  words for the three roles Shepherdr already has.

## Settings

### The library

In `~/.config/shepherdr/settings.json`, under `everywhere.practices`:

```json
{
  "everywhere": {
    "practices": {
      "sprint": {
        "worker": "Ship the smallest change that shows the idea works. Run the tests next to what you changed.",
        "reviewer": ["Look for what would stop a first user.", "Leave polish for later."]
      },
      "steady": {
        "assistant": "Plan every change with the person before you start it. ...",
        "worker": "Write a failing test first. Run the whole suite before ready. ...",
        "reviewer": "Treat a double submit or a retried webhook as major. ..."
      }
    },
    "tasks": { "practice": "sprint" }
  },
  "repos": {
    "~/dev/a-shop": { "tasks": { "practice": "steady" } }
  }
}
```

(The repo key is the folder's full path, as for every repo setting; it is shortened here.)

- **Why under `everywhere`:** the web app's push to other machines sends only `everywhere`, `machines`, `spaces` and
  `repos` (`service/settings.ts` `pushBody`). A top-level `practices` would never reach a repo on another machine.
  Only Everywhere's `practices` is read; a `practices` key in a repo or space is ignored.
- **A role's words** are a string, or a list of strings (one per line, easier to write by hand in JSON).
- **A role left out**, or set to `null`, `""` or `[]`, gets upstream's words for that role.
- **Names** are matched without regard to case. `upstream` and `default` can't be practice names: an entry with
  either name is ignored, and `herdr-task practice` says so.
- **Keys other than** `assistant`, `worker` and `reviewer` are ignored, and `herdr-task practice` says so.
- The library and the setting never go in this repo. Every practice in its tests and docs is made up.

### The setting

`tasks.practice` resolves like every task setting (`settings.settings_layers`): Everywhere, then the machine layer
(only for old files), then the repo, then the task's own `--set`. The most specific wins.

| Value | Meaning |
|---|---|
| unset | Inherit from the wider scope. Unset everywhere: upstream's words |
| `upstream` | Upstream's own way of working, even when a wider scope names a practice |
| a name | That practice from the library |

On a task:
- `herdr-task add|edit … --set practice=<name>` sets the task's own. `--set practice=upstream` picks upstream's.
- `--set practice=default` or `--set practice=` removes the task's own, so it inherits again. This is what `default`
  already means for every `--set` key (`settings.set_task`, line 445). That is why upstream's own way of working
  is `upstream`, never `default` (point 21).
- `add` and `edit` refuse a name that isn't in the library, at once, listing the names there are.
- Schedules pass it on like any `--set` key: `herdr-task auto add … --set practice=steady`.

The web app's settings window doesn't show practices. Its save keeps them (`readSettings` then `writeSettings` keeps
everything it doesn't know; pinned below).

## The cut: which of upstream's lines a practice replaces

Each template line is one unit: a bullet, or a paragraph (each is one physical line in the templates). A line is
either **way of working** (cut when a practice gives that role words) or **operational** (always kept).

**The rule.**
- A line is **way of working** when a project could rightly want it different while Shepherdr still works the same:
  how to plan and split work, what to test, how hard to review and what counts as a finding, how much to ask the
  person.
- A line is **operational** when Shepherdr breaks, or a setting stops meaning what it says, without it: commands and
  flags, status and Needs you, ready and its records, what Review, Review rounds, Must fix, Proof and Merge mean,
  secrets, safety on the live session, wording and screen limits (titles, summaries, replies), other machines.
- **A line that is both stays**, unless way of working is most of it. A practice never has to restate a command.
- The knobs Shepherdr already has stay settings. A practice pairs with them: a careful repo sets Must fix and Merge,
  a quick one turns Proof off. A practice is only the words.

**The sort at `7bee4709`.** Cut:

| Role | Line | Opening words | Why |
|---|---|---|---|
| worker | 15 | "Before you say you're done, run only the tests for what you touched" | What to test |
| worker | 22 | "Check every page you publish before ready" | How to check |
| reviewer | 8 | "Report only what could plausibly go wrong in this repo" | How hard to look, what counts |
| assistant | 16 | "Ask the person before anything risky or anything you are unsure they want" | How much to ask |
| assistant | 38 | "Split the ask into tasks." | How to plan, what each brief asks to test |
| assistant | 87 | "For a task's plain question, answer it yourself" | How much to ask |

Every other line is operational. The ones that are both, kept on purpose, so their way-of-working part stays in:

| Role | Line | Opening words | Way-of-working part left in | Who governs it |
|---|---|---|---|---|
| worker | 19 | "Review, when the Settings block says Review: on." | Later rounds see only what changed; level meanings | Review, Must fix and Review rounds; #4 and #5 |
| worker | 21 | "Proof, as the Settings block's Proof line says." | A bug fix reproduces first; a mocked test is no proof | The Proof setting (off: the line doesn't apply) |
| worker | 24 | "Browser: you have your own tab" | Check a page really works before saying so | Nothing; fine for any practice |
| reviewer | 7 | "Read the task, then the diff your worker gives you" | Run the project's checks; later rounds check the fixes | Review rounds; #5 |
| reviewer | 9 | "Report each finding with a level" | The level meanings | Must fix uses these words |
| assistant | 42 | "Where tasks work:" | Tasks run in parallel by default | Worktrees; in-folder tasks must queue |
| assistant | 91 | The `main-red` news line | Fix forward with a small task | Nothing yet |

The cut is small on purpose. Most of upstream's words are how Shepherdr works, and they must keep updating.

**Where the practice goes.** In place of the first line cut, under one lead line:

> How to work here: practice "steady" (this repo's setting). It takes the place of Shepherdr's own way of working.

The other cut lines go. A `##` heading left with nothing under it goes too. If no listed line is found (an older or
hand-edited template), nothing is cut and the practice part goes at the end; `herdr-task practice` says which lines
weren't found.

**How it is matched.** `practice.py` holds the cut list as each line's opening words, per role. A line matches when,
without leading spaces, it starts with them. It runs on the template herdr-core reads on that machine
(`~/.config/herdr-core/templates/<role>.md`, through `templates.instructions` for the worker and reviewer, and read
directly for the Assistant: `instructions()` has no head for it). Lines it doesn't know are always kept: the cut never
drops what it can't name.

**How a sync notices a changed template.** `test/test_practice.py` sorts every bullet and paragraph line of
`templates/*.md`: each must match exactly one entry of the cut list (in `practice.py`) or of a kept list (in the
test). Headings and lines inside code fences are exempt. When upstream adds, removes or reopens a line, the test fails
and names the line. The sync then sorts it by the rule above (fork-patch §4). Changed words inside a known line don't
fail the test; the sync reads `git diff <old>..<new> -- templates/` anyway, since the templates are in this patch's
files.

## Delivery per role

`practice.py` is a new module beside upstream's. Its public calls:

- `pick(s, task=None, space=None) -> {"name", "by", "words": {role: text or None}, "problems": [...]}`: the practice
  that applies and where it comes from (`task`, `repo`, `Everywhere`, or `None` for upstream's).
- `words(s, task, role, fresh=False) -> str`: the role's whole text as Shepherdr delivers it: upstream's template for
  that role with the cut made and the practice's words in its place. With no practice, or the role left out, it is the
  template unchanged. `fresh=True` (a new brief) resolves the practice now and keeps it on the task; otherwise the
  task's kept practice is used, and resolved and kept if it has none yet.
- `assistant_template(folder, space=None) -> str`: the name of the template an Assistant in that folder starts from
  (below).
- `note(terminal, k) -> str` and `notice_pass(d, report)`: the Assistant's note and live notice (below).

### Keeping it on the task

The first fresh brief keeps the practice on the task as `brief_practice`: `{"name", "by", "words": {"worker",
"reviewer"}}`, the words as they were then. This mirrors `brief_review` (`settings.keep_review`). A handoff, a review
round and `herdr-task practice <task>` all use it. Upstream's template part is read fresh each time, so its
operational fixes reach running tasks; only the practice's words are fixed.

### Worker

Two edits in `mods/tasks/bin/herdr_task/launch.py`:

- `brief()`, line 676: `instructions("worker")` becomes `practice.words(s, task, "worker", fresh=True)`.
- `handoff()`, line 681: `instructions("worker")` becomes `practice.words(s, task, "worker")`.

`brief()`'s own `instructions("reviewer")` call (line 669) stays: it still installs the reviewer's file.

A name not in the library stops the start: `words()` raises `Fail` with "No practice named "x" in your settings
(everywhere.practices). Pick one of: sprint, steady, upstream." The task waits with that reason, as with any start that
fails.

### Reviewer

The reviewer gets its words in the prompt herdr-task writes for it, never by reading `templates/reviewer.md`. #4
defines that prompt in `review_prompt.py` (`review_prompt(s, task, sha) -> str`) and its first build task builds it.
This patch adds one call there: the prompt includes `practice.words(s, task, "reviewer")`. With no practice, that is
the reviewer template's text, so the prompt never needs the file's path. The rest of the prompt is #4's.

Until #4's reviewer start is built, the worker still starts the reviewer and points it at the template file, so the
reviewer part of this patch can't land before it (point 20). The worker and Assistant parts don't depend on it.

### Assistant (point 20)

An Assistant is started in four places, each with the stock `assistant` template:

| Start path | Where | Edit |
|---|---|---|
| New space | `service/spaces.ts:163`, `execTemplate(hub, "assistant", …)` | name from `assistantTemplate()` |
| First message to a space with none running | `service/actions.ts:254`, same call | the same |
| Restart, fresh handoff | `service/restart.sh:134` `tpl=$tdir/assistant.md`, and line 145 `… assistant "$handoff"` | name from `herdr-task _assistant-template` |
| Crash revive without a known session | `mods/tasks/bin/herdr_task/revive.py:336` `[*base, "assistant", message]` | name from `practice.assistant_template(cwd)` |

**Start.** `herdr-task _assistant-template --folder <folder>` resolves the practice for that folder. With no practice,
or one without Assistant words, it prints `assistant`: the start is exactly upstream's. Otherwise it writes
`herdr-practice-assistant-<hash>.md` beside `assistant.md` (the same frontmatter with its own `name:`, and the composed
body), removes older ones it made, and prints that name. Each start path uses the name it gets, and `assistant` if the
command fails or the file isn't there. A new `service/practice.ts` holds `assistantTemplate(hub, machine, folder)`,
which runs it on the Assistant's machine. Everything after (the agent's command from the pick, `tpl.words`, the
one-off copy) works unchanged. Only the three stock templates are synced between machines (`service/sync.ts`), so
these files stay on the machine that made them.

**Resume and compaction.** A resumed session keeps its conversation, and compaction keeps only a summary. Both fire
the SessionStart hook (`matcher: ^(startup|resume|clear|compact)$`, `bin/shepherdr` line 494), which already gives
every Assistant its "Your settings" block (`assistant_settings.session_note`). One edit there, line 249, appends
`practice.note(terminal, k)`:

- When a practice applies with Assistant words: "How to work here: practice "steady" (this repo's setting). It takes
  the place of Shepherdr's own way of working, and of any you were given before:" and the words.
- When none applies, but this Assistant was told one before (its `herdr.practice` label): the same lead, then
  upstream's own cut lines, so it learns the way of working it never had.
- When the library isn't empty: one line naming the practices, that tasks added here get this one, that
  `--set practice=<name>` gives one task another, and that `herdr-task practice` shows what applies.
- Otherwise nothing: an Assistant with no practices gets exactly today's note.

It sets the label `herdr.practice=<name>:<hash of the words>` on the terminal, as `session_note` sets
`herdr.settings`. On a fresh start the words then appear twice (in the first message and the note). That costs a few
hundred tokens once and keeps the first message whole if the hook fails.

**A change while it runs.** One line in `assistant_settings.settings_pass`, after `d = read_settings()` (line 284),
calls `practice.notice_pass(d, report)`. For each live Assistant here whose label differs from what applies now (the
name changed, or the library's words did), it sends one hidden line, as for settings:

```
<herdr-setting name="practice" value="steady" scope="repo">Your way of working is now practice "steady" (this repo's setting). It takes the place of the one you had: … Running tasks keep theirs; tasks you add from now on get it. {NOTICE_END}</herdr-setting>
```

`NOTICE_END` is `assistant_settings.NOTICE_END`, whatever upstream and our other patches make it. A busy Assistant is
told on a later pass, as settings are.

**An Assistant started before this patch was installed** has upstream's lines in its first message. Its next note or
notice gives it the practice with "takes the place of"; its next fresh start has none of upstream's cut lines.

### One command: `herdr-task practice`

```sh
herdr-task practice <task>                    # what this task runs with
herdr-task practice --folder <folder>         # what new tasks and the Assistant there get
herdr-task practice --folder <folder> --full  # with each role's whole composed text
herdr-task practice ... --json
herdr-task --on <machine> practice --folder <folder>   # a repo on another machine, through the usual --on
```

It says: the practice and its scope; per role, whether it gets the practice's words or upstream's (and why: unset,
`upstream`, or the role left out); which upstream lines were cut, by their opening words, and any listed line that
wasn't found; problems (an unknown name, a reserved name in the library, a role's words of the wrong type, unknown
keys). For a task it shows what it kept, and says so when new tasks there would now get another. One line in
`cli.py` registers it (`practice.add_commands(sub)`), with the hidden `_assistant-template`.

## Acceptance

All with made-up practices.

1. **A repo set to a practice.** A repo has `tasks.practice: "steady"`.
   - A new task's worker brief has steady's worker words, and not worker lines 15 or 22.
   - Its reviewer's prompt has steady's reviewer words, and not reviewer line 8 (once #4's reviewer start is built).
   - That space's Assistant has steady's Assistant words, and not Assistant lines 16, 38 or 87: in its first message
     on start, and in its note on resume and after compaction.
2. **A repo left unset** gets upstream's words, byte for byte as today, in all three.
3. **A role the practice leaves out** gets upstream's words for that role.
4. **`upstream` wins over a wider scope.** Everywhere is `sprint`, the repo is `upstream`: upstream's words.
5. **`default` removes a task's own.** `--set practice=steady`, then `--set practice=default`: the task inherits the
   repo's again.
6. **A change of practice reaches new tasks only.** A task started on `sprint` keeps sprint's words after the repo
   changes to `steady`, through a handoff and its review rounds. A task added after gets steady's. The running
   Assistant gets one notice.
7. **An unknown name** is refused by `add --set`; named by the repo, it stops a task's start with the reason.
8. **The command** shows, for a task and for a folder, the practice, its scope and each role's words.
9. **Operational lines stay upstream's.** A test changes an operational line in a scratch copy of a template; the
   composed text has the change.
10. **The repo stays impersonal.** No practice words, names or settings of the person's are in it.

## Edge and failure cases

| Case | What happens |
|---|---|
| A task's `--set` names no practice in the library | `add`/`edit` refuse at once, with the names there are |
| The repo's or Everywhere's setting names none | Tasks there don't start; each waits with why. The Assistant starts with upstream's words, and its note says the name is missing so it tells the person. `herdr-task practice` shows it |
| A role's words are empty (`""`, `[]`, `null`) | Upstream's words for that role |
| A role's words aren't a string or a list of strings | As left out; `herdr-task practice` says so |
| A library entry named `upstream` or `default` | Ignored; `herdr-task practice` says so |
| The library's words change while tasks run | Running tasks keep theirs (`brief_practice`); new tasks get the new; the Assistant gets a notice |
| A task is started again with a fresh brief | It takes today's practice, as it takes today's Review |
| A repo on another machine | Resolved there, from its pushed settings copy, which carries `everywhere` and its `repos`. That machine needs this fork's herdr-task: a stock one ignores the setting and gives upstream's words, and its `practice` command doesn't exist, which shows it |
| The person edited a template | The cut works on their file; lines it doesn't know stay; missing listed lines are shown |
| Upstream changed a template | At run time, an unmatched listed line just stays. The sort test fails at the sync and names it |
| The SessionStart hook fails | The Assistant keeps its composed first message; the next note or notice brings the words back |
| A Codex Assistant | The same start paths and hook (`.codex/hooks.json` SessionStart). Whether Codex fires it after its own compaction is not proven here |
| Research-only and schedule tasks | They are tasks: the worker practice applies |
| The home space (Everything) | Its folder is the home folder: Everywhere's practice, unless that folder has a repo entry |

## Pins

Each is a test in `test/test_practice.py` (or `service/practice.test.ts`) whose name or docstring says "#3", so a sync
sees the break at once. Python tests import `test/home_guard.py` first.

| Upstream thing relied on | Test |
|---|---|
| `templates/worker.md`, `reviewer.md`, `assistant.md`: each cut entry matches exactly one line; every bullet and paragraph line is sorted | The sort test |
| `templates/assistant.md` has frontmatter with a `command:` line | Frontmatter test |
| `templates.instructions(role)` returns the body without frontmatter, for `worker` and `reviewer` | Call it on a scratch `HERDR_TASK_TEMPLATES` |
| `settings.TEMPLATES` is the folder herdr-core reads | Path test |
| `launch.brief(s, task, parent, space, argv)` and `launch.handoff(s, task, prev, parent, argv)` begin with the worker's role text | A brief with a made-up practice holds its words and not worker line 15 |
| `settings.SET_KEYS`, and `set_task`'s `""`/`default` meaning "remove this task's own" | `--set practice=default` removes it (point 21) |
| `settings.settings_layers(s, space)` returns Everywhere, machine, repo | Resolution test |
| `settings.keep_review` keeps `brief_review` on a fresh brief | The pattern `brief_practice` follows |
| `assistant_settings.session_note(terminal)`, `settings_pass(report, quiet)`, `NOTICE_END` | Note and notice tests |
| `hooks/session-note.sh` calls `herdr-task _session-note "$HC_TERMINAL_ID"`; `bin/shepherdr`'s SessionStart matcher has `resume` and `compact` | Text pins |
| `revive.restart_assistant` starts `hc run … <template> message` | Pin on the call |
| `service/restart.sh`'s `tpl=` line and its plain `… <template> "$handoff"` start | Text pins, plus `bash -n` |
| `execTemplate(hub, name, machine, pick)` in `service/spaces.ts`, called from `spaces.ts` and `actions.ts` | bun test |
| `pushBody` sends `everywhere` whole; `writeSettings` after `readSettings` keeps unknown keys | bun test with `everywhere.practices` |
| `review_prompt(s, task, sha)` (#4) includes `practice.words(s, task, "reviewer")` | Once both exist |

## Points 20 and 21

| Point | Settled |
|---|---|
| 20. The Assistant gets the stock template at launch and fresh handoff; `session_note` only adds text | Each role's text is composed before delivery (`practice.words`). The Assistant starts from a composed template at all four start paths (one name changed at each). On resume and after compaction, the SessionStart note gives the practice's words, saying they take the place of any before; a change while it runs comes as one notice |
| 20. The reviewer's prompt depends on #4, though Practice was to ship first | herdr-task's `review_prompt.py` is #4's first build task, and whichever patch is built first builds it. Practice's reviewer part lands with or after #4's reviewer start; its worker and Assistant parts ship first |
| 21. `default` has two meanings | `upstream` picks upstream's own way of working. Unset, `""` and `default` keep meaning "inherit" / "remove this task's own" |

## Build tasks, in order

Each is one pull request, small enough to review in one sitting. Each runs only its own tests (AGENTS.md: Tests).

1. **Review prompt (shared with #4).** `review_prompt.py` as the review-records spec defines it, if #4 hasn't built
   it yet. Nothing of Practice in it yet.
2. **The core.** New `mods/tasks/bin/herdr_task/practice.py`: reading the library, names, `pick()`, the cut list,
   composing, `words()` with `brief_practice`. `settings.py`: `practice` and `task.practice` in `SET_KEYS`; one line
   in `set_task` refusing an unknown name. New `test/test_practice.py`: resolution (every row of the settings table),
   the cut and lead line, empty and missing roles, reserved names, unknown name, the sort test and the settings pins.
3. **The worker.** `launch.py`'s two edits. Tests: brief and handoff with a made-up practice; a task keeps its
   practice after the repo changes; an unknown repo practice stops the start with the reason; no practice gives
   today's brief exactly.
4. **The command.** `herdr-task practice` and its line in `cli.py`; a short how-to in `fork/docs/practices.md` (where
   to write a practice, how to pick one, the cut list). Tests: text and JSON for a task and a folder, problems shown.
5. **The Assistant's start.** `_assistant-template`, `service/practice.ts`, and the edits in `spaces.ts`,
   `actions.ts`, `restart.sh` and `revive.py`. Tests: Python (the file written and pruned, `assistant` when no
   practice), bun (callers use the helper; `assistant` when herdr-task fails), `bash -n service/restart.sh`. One real
   try on a throwaway core and service (AGENTS.md: Trying a change): start a space's Assistant with a made-up practice
   and read its first message.
6. **The Assistant's note and notice.** `assistant_settings.py`'s two one-line calls, `note()` and `notice_pass()`.
   Tests: the note with and without a practice (none: today's note exactly), one notice on a change and none without,
   the label, an Assistant told before and now on upstream's.
7. **The reviewer.** The one call in `review_prompt.py`, after #4's reviewer start is built. Test: the prompt holds the
   made-up reviewer words and not reviewer line 8, and no template path.

After 7, update issue #3's "Where it lives" and "Tests" with these files.

**Ban check.** Nothing here reads usage, uses an agent's sign-in or private endpoints, drives an agent's screen, or
edits an agent's own config. The composed template is a herdr-core template in Shepherdr's templates folder, as
`execTemplate`'s one-off copies are. `docs/agents-and-terms.md` needs no change.

## Offering it upstream later

Only after it is merged here, and only on the person's yes. The smallest ask is a **practice slot**:

- Upstream moves its own way-of-working lines (the six above, or its own sort) out of the three templates into
  `templates/practice/<role>.md`, delivered where they were.
- One setting, `tasks.practice`, names a replacement from `everywhere.practices`, with `upstream` for its own.

With the slot upstream, our cut list and the sort test go, and the patch shrinks to nothing. Expect "not planned",
given #714 and SHEP-319: the argument is that the slot replaces Shepherdr's own lines, which AGENTS.md can't, and adds
no second place for repo rules.

## Open questions for the person

1. **A repo set to a practice that isn't in the library: should its tasks stop, or run on upstream's words?**
   Recommendation: stop, with the reason on the card. A careful repo should never quietly get the quick words because
   of a typo. The cost: one typo at Everywhere stops every new task until it is fixed.
2. **Should each task's Settings block (and so its card) name its practice?** Recommendation: not now. It needs an
   edit in upstream's busiest function (`task_settings`); `herdr-task practice <task>` and the Assistant can say it.
   Add it if you find yourself asking which practice a task ran with.
