# Needs you only when it's yours

An item is the person's only when only they can settle it. Anything Shepherdr or the task can settle itself, it
settles, quietly. This fits the shared Needs you design (`fork/specs/needs-you.md`): owners you, Shepherdr or none,
and Ask me after. Each fix below takes one false Needs you away at its source, in herdr-task, so neither Shepherdr's
quiet line nor a hand-up at the deadline is ever made for it.

## The need, in the person's words

"which ones are … that prevent Shepherdr to notify me about what I am personally needed for … the issues that do
prevent shep from letting me know that something only I can fix versus autonomous driving through the day with its
workers". And for Needs you: "1. i get numerous notification for almost anything … 4. need ME or need ASSISTANT is
different, assistant can answer by themself, but when it cant it needs to actually need me and i get notif".

Upstream checked: v3.2.23, main 5abe8526; related: "Merge treats a superseded CANCELLED check run as failing" (fixed,
the newest run of a check counts), "'Right away' merge waits on checks from GitHub workflows that are disabled"
(fixed for workflows switched off on GitHub), "Ready task still shows Working after checks pass" (fixed). None
covers the cases below.

## 1. A run cut off at its time limit is not a failed check

Reports 7e8f14546f. **Cause:** GitHub ends a job that passes its `timeout-minutes` as CANCELLED. `latest_checks()`
keeps it when no newer run of that check exists, `pr_problem()` calls it "Checks failing", so the tick sets
attention (a wait, then a hand-up), while `pr_news()` leaves CANCELLED out, so its agent is never told: nobody but
the person can settle it. And a newer run of the same check that GitHub has queued but not started has no start time
(`0001-01-01`), so it lost to the older cut-off run: "failing" again while the newer run was on its way.

**Fix** (`mods/tasks/bin/herdr_task/cutoff.py`, called once from `tick.facts()` and `commands.merge_now()`):
- `latest_checks()`: two Actions jobs of one check go by job id (a rerun's new job has a higher one), so an older run
  still queued never hides a newer result; otherwise by start time, and a run not started yet is the newest.
- A check whose newest run ended TIMED_OUT, or CANCELLED with GitHub's annotation that the job "has exceeded the
  maximum execution time" (read once per job, `GET repos/{repo}/check-runs/{job}/annotations`), is **cut off**. A run
  someone cancelled, or one whose annotations can't be read, reads as before: only a time limit counts.
- The first time at a commit, once its whole run has ended (GitHub refuses a rerun while a sibling job runs), Herdr
  runs it again by itself, once (`gh run rerun <run id>`, GitHub's documented command), and the check reads as
  running: no attention, no news. Kept as `pr.rerun = {head, why, runs, tries, failed}`.
- A refused rerun is tried again 5 minutes later, three tries in all; GitHub's hourly request limit spends no try.
- Until a run of it ends after that rerun, the old cut-off row still reads as running (GitHub shows the new attempt a
  moment later). If GitHub never shows it, after 10 minutes (while Actions has no run on its way) it reads as cut off.
- Cut off again at the same commit (or the rerun refused three times): the row reads TIMED_OUT, so `pr_news()` hands
  it to the task's agent like any failure, saying it was cut off (and GitHub's reason when the rerun was refused), and
  the card says "Checks failing: check (cut off at its time limit)". It is the task's to fix (a test that hangs), and
  goes through the usual Shepherdr wait if its agent can't.
- A commit status (not an Actions run) can't be rerun: as before.

## 2. A ready task that pushed a fix is told to say ready again

Reports cccce5aec5. **Cause:** a Ready task's failed checks go to its agent (`pr_news()`), whose turn takes the task
back to Working (`back_pass()`). The agent fixes, pushes its branch itself and ends its turn without running ready.
`settle_back()` makes it Ready again only when its branch is where it said ready, which a new commit never is, so the
task stays Working with a quiet agent: a reply wait under Needs you, its agent's last line as the reason, until
someone tells it to say ready.

**Fix** (`mods/tasks/bin/herdr_task/ready_again.py`, from `tick.facts()`): a Working task that went back to work on
its own from Ready (`back.auto`), whose agent rests with no question asked, whose worktree is clean at a new commit
that is also its pull request's head on GitHub, hears once per commit, as GitHub news: its new commit is on the pull
request, the task merges only after its ready command runs again, so run it now (ready waits for the checks
itself). Its agent then runs ready, with every check ready makes (review rounds, proof), and Merge does the rest.
A check that already failed on that commit is told with it (to fix, push, then ready): a Working task's GitHub news
isn't passed on otherwise. Any other problem (a conflict, a cancelled run) is not said here. Nothing is said to the
person.

## 3. A read-only scheduled run is judged by its own changes

Reports 594bb1f0ac, 03bf0dbdb4, ddb89fa3f7, d3a815a64c. **Cause:** a run in the folder itself is "unchanged" only
while the folder's HEAD is the commit it started on (`commands.unchanged_folder()`). Other tasks' merges fast-forward
that folder (`github.update_main()`), so `ready --nothing` and `--told` were refused, and the run waited for the
person with a card for "nothing new".

**Fix:** `unchanged_folder()` counts only the run's own work: nothing tracked changed, the folder is on the branch
it started on (`folder_branch`, kept at start), HEAD only moved forward from where it started, and every commit since
is already on that branch's upstream (`git rev-list <start>..HEAD --not @{upstream}` is empty). A fast-forward to
others' merges is not its change; a commit of its own (pushed anywhere else or not), a move back or another branch
is. The same rule serves the review gate (`review_refusal()`).

8eab66bb32 (the "Watch upstream issues" schedule flags a fork issue a task already works on) is in that schedule's
own brief, which lives in the person's schedules, not in this repo: its brief should skip an issue that
`fork/bin/found task <n>` names a task for. The space's Assistant changes the schedule.

## 4. A merged pull request ends its task

Report d1dc02c84e. **Cause:** a task reopened after its pull request merged is kept open (`kept_open`, #844) until
its agent says ready, and reopening dropped its review rounds. In this fork a merged task's ready never opens a
second pull request (#48): it is done again, and its later commits are offered as a follow-up. So a reopened merged
task could only sit Working, "0 of 2 review rounds", until someone finished it by hand.

**Fix** (`tick.merge_held()`): a reopened task whose pull request merged is held open only while its agent is at work
(mid-turn), or while its worktree holds anything not committed, untracked files too (closing removes a worktree
with only untracked files in it). Once it rests with nothing unsaved, it is done again, merged (`finish()`: later
commits offered as a follow-up, its worktree kept while they are only there). No message to anyone.

## 5. No checks at all: Merge on its own merges

Reports a6cd92d2d7, d67983f73d. **Cause:** a repo whose workflow file runs on pull requests, but whose runs never
come (Actions off for the repo, `[skip ci]`, no minutes left), waits for checks (`checks_missing()` "waiting") for 20
minutes, then "Its checks never started on GitHub" and no merge by itself. GitHub meanwhile says the pull request is
CLEAN: nothing it requires is missing.

**Fix** (`github.checks_missing()`): with Merge on its own (Right away, or a merge by hand under it), no check listed,
Actions saying no run is on its way at its head (`runs_none`: never when Actions can't be read), 30 seconds since the
commit, and GitHub saying it can merge (CLEAN, UNSTABLE or HAS_HOOKS), nothing is missing: it merges, as merge "on its own" already does with optional checks still running (`merge_checks()`). A
required check GitHub doesn't list yet still blocks it (BLOCKED), as before. When all checks pass keeps waiting and,
when none ever start, says so once with why (its card), as before: there the person asked for checks.

## 6. Workers edit files without a prompt only the person can answer

Report e3d307e8ea. **Cause:** an agent that edits a file with `python3 -c "…"` (code quoted inside a shell command)
makes Claude Code ask "can't be sure it read this command the way the shell will", a prompt only the person may
answer (AGENTS.md: never auto-answer an agent's prompts).

**Fix:** one line in `templates/worker.md`: change files with your edit tools, or a script file you write and run by
path, never code quoted inside a shell command. A test pins the line. Nothing answers or avoids the prompt for the
agent: it simply isn't asked.

## Ban check

Only GitHub's documented `gh run rerun` and check-run annotations read with the person's own `gh` sign-in, once
per run at a commit; messages to Shepherdr's
own task agents through herdr-core's news (as `pr_deliver()` already does); no agent's interface driven, no prompt
answered, no agent settings touched. `docs/agents-and-terms.md` is unchanged: nothing here touches an agent's terms.

## Tests

`test/test_herdr_task.py::NeedsOnlyYours`, one test per fix and per review finding, with fake gh/hc as the file
does, and real throwaway git repos for 2, 3 and 4. `BackToWork` and `MergedWhileWaiting` pin the reopened task's rule.
