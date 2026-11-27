# Review records and the final check

The spec for two patches that share the reviewer's contract: #4 (record the reviewer's own findings against the
commit it reviewed) and #5 (one final check when the review rounds run out). It is designed against upstream's
`upstream/main` after v3.2.21. Where this spec names an upstream function, it means that one, as it is there.

## Why

Today the worker starts its own reviewer, writes its prompt, reads its answer and records the round with
`herdr-task reviewed --report "<a line>"`. So the round, and the card, say what the worker says the reviewer said,
on whatever commit the worker names. The person merges on that word without reading the code.

Since upstream issue 1557, a task out of rounds goes ready with its last fix unreviewed. A repo where a bad fix
costs money has no way to say "check the fix".

## How a round runs today

- **Words.** `templates/worker.md`'s Review bullet tells the worker to start the Reviewer line's CLI with `hc run`,
  write its prompt (the brief, the diff, the Must fix level, `reviewer.md`), `hc wait` it, `hc read` it, `hc kill`
  it, then record the round. `launch.closing_line()` adds the `reviewed … --report` command.
- **Record.** `commands.cmd_reviewed()` appends `{"result": "report", "text", "head", "by"}` to `t["reviews"]`. The
  text is the worker's line. The head is HEAD of the task's branch, or `--commit`.
- **Gate.** `commands.review_refusal()` (called by `cmd_ready()`) passes when a round was recorded on the final
  commit, or `carried_over()` holds, or all rounds are used (#1557).
- **Carry-over.** `carried_over()` is `base_merges_only()` (only clean merges of the base since a reviewed commit)
  or `same_own_changes()` (the same added and removed lines against the base, context and line numbers ignored).
- **Merge.** `merge_now()` merges with `gh pr merge --match-head-commit <GitHub's head now>`. `github.queue_merge()`
  queues again at a given head. Neither asks whether that head was reviewed.
- **Failed reviewers.** `reviewers.reviewer_pass()` ends a reviewer that never started, froze or ended in an error,
  and tells its worker it is no round.
- **Legacy.** `commands.cmd_review()` (`review --pass|--changes`) records a pass and calls `finalize()` for anyone
  who runs it, whether or not a review is pending.

## The design in one paragraph

herdr-task starts each reviewer itself, with a unique launch id and a prompt it writes. When the reviewer's first
turn ends, herdr-task reads that reviewer's own last message from its own session log. The message ends with one
verdict line the reviewer writes. The round is recorded against the exact commit the launch named. `ready` accepts
a commit only by those records, and the merge goes through only at the commit `ready` accepted. Code reads one line
the reviewer wrote and compares shas: it never judges the work.

## 1. Settings and the switch

Two new keys in upstream's `tasks` section, so they layer Everywhere → repo → task like `review_rounds`:

| Key | `--set` | Values | Default |
|---|---|---|---|
| `tasks.review_records` | `review.records=on\|off` | on, off | off |
| `tasks.final_check` | `review.finalCheck=on\|off` | on, off | off |

- **One switch for #4.** `tasks.review_records` turns all of #4 on or off. With it off, none of our code paths run.
- **`final_check` needs records.** The final check is recorded and gated like any round, so it works only where
  records are on. With records off, `final_check` is ignored, and `herdr-task config` says so on its line.
- **Kept like Review.** A task keeps what its brief said, as `keep_review()` does for Review: the Everywhere and
  repo values are read when its brief or handoff is written and stamped on the task (`t["records"] = {"on": …,
  "final_check": …}`). A task's own `--set` wins at once, as upstream's task settings do. A change of the setting
  reaches new tasks and handoffs only.
- **The sync's switch.** `review_records.ENABLED = True` in our module. If an upstream release breaks the patch and
  it can't be adapted at once, the sync sets it to `False` in one commit: every task then behaves as upstream, also
  running ones (their brief's words still say to run `reviewed`, which then records as upstream does).
- **Where the code goes.** One appended block at the end of `settings.py` (our hook point; upstream edits lines
  above it, rarely the end):

  ```python
  # Fork (dmalis/shepherdr#4, #5): fork/specs/review-records.md
  DEFAULTS["tasks"].update(review_records=False, final_check=False)
  SET_KEYS.update({"review.records": "review_records", "records": "review_records",
                   "review.finalcheck": "final_check", "final_check": "final_check", "final-check": "final_check"})
  ```

  and one edit in `set_task()`: the on/off branch `if field in ("review", "proof"):` also takes these two fields.
  `settings_for()` already passes any `tasks` key through, and `setting_sources()` lists `DEFAULTS` keys, so
  `herdr-task config` shows both with where they come from.

## 2. herdr-task starts the reviewer

The worker no longer starts a reviewer. It runs upstream's own verb, which already runs without asking:

```
herdr-task reviewed <task> --folder <folder> [--note "<why a finding was left as is>"]
```

With records on, `cmd_reviewed()` hands over to `review_records.reviewed(args)` (one call site, its first lines).
What it does depends on the task's state:

| State | What `reviewed` does |
|---|---|
| Uncommitted changes in the worktree | Refuses, as today: a review is of a commit. |
| No launch running, the head has no record, a round is due (§6) | Starts the reviewer on HEAD and returns at once with its name: "`hc wait <name> --timeout 600`, then run reviewed again." |
| A launch running, its first turn not ended | "Your reviewer `<name>` is still at work: `hc wait` it, then run reviewed again." |
| A launch whose first turn ended | Records it (§4), prints the reviewer's words and the verdict, and ends the reviewer (`hc kill`). |
| A launch that failed (error, blank, frozen, cut off, no verdict line) | No record. Says why. The next `reviewed` starts it once more. After two failed launches on one commit it refuses: "ask the person with your question tool, saying what failed". |
| The head has a record already | Says it: a commit is never reviewed twice. Fix, commit, and run reviewed again; or say ready. |
| The head carries a passing record over (§7) | Upstream's words: "its review holds, no round used. Say ready." |
| No round is due (out of rounds, final check off or spent) | Says what ready will do (§6). |

**The launch.** herdr-task runs, from the worker's terminal:

```
hc run --bg --name <key>-review --parent <the worker's address>
  --label herdr.task=<task key> --label herdr.role=reviewer --label herdr.agent=<claude|codex>
  --label herdr.review=<launch id>
  -- <the Reviewer line's command> "<prompt>"
```

- The command is the Reviewer line's own (`task_settings()`'s Reviewer `value["command"]`, from
  `reviewer_command()`): read-only Codex, or Claude in don't-ask mode with only the reading tools. Its labels are
  the ones upstream's worker words give, so the chat shows it as a subagent and `reviewer_pass()` still watches it.
- The launch id is `rv-` and 12 random hex characters. The prompt's first line names it: `Review rv-… of "<task
  title>" at commit <sha>.`
- herdr-task keeps one launch row per start in `t["review_launches"]`: `{id, sha, base, round, final, agent, name,
  address, at, ended, session, state, log}`. `agent`, `at`, `ended` and `session` are the fields
  `sessions.find_log()` reads from a task's agent row. `state` is `running`, `recorded` or `failed`. At most one is
  `running` per task.
- **Never another CLI on its own.** herdr-task starts only the Reviewer line's CLI. It never switches CLI after a
  failure: a quota or limit refusal must not be retried on another agent (AGENTS.md). A person who wants the other
  CLI sets `--reviewer` on the task.
- **Never answers a screen.** A reviewer waiting on a trust, hooks or sign-in screen is left for the person, as
  worker.md says today; `reviewer_pass()` reports one that never starts.

## 3. The prompt: `review_prompt.py`

A module of its own, `mods/tasks/bin/herdr_task/review_prompt.py`, with one public function:

```python
def review_prompt(s, task, sha) -> str
```

It reads; it writes nothing and starts nothing. #3 (practices) builds on it, so it is the first build task. Its
parts, in this order:

1. **Which round.** "Round n of N", or "Final check: one extra round after all N" (§6). Worked out from the task:
   `rounds_used(task)` against `review_limits()`.
2. **The reviewer's words.** `practice.words(s, task, "reviewer")`, verbatim. #3 adds `practice.py`. Until it
   lands, a stand-in in `review_prompt.py` gives upstream's words:

   ```python
   try:
       from .practice import words as practice_words
   except ImportError:          # #3 not built yet: upstream's reviewer words
       def practice_words(s, task, role):
           return instructions(role)
   ```

   The contract with #3: `practice.words(s, task, role) -> str` returns the role's complete words for that task
   (upstream's `reviewer.md` when the task has no practice), and never raises for an unset practice. The verdict
   contract (part 7) is outside those words, so no practice can drop it.
3. **The brief, word for word.** The task's title and its prompt as stored (`task["prompt"]`, else the title).
4. **What to review.** Commands the reviewer runs, with the shas filled in, and `git diff --stat` of the range:
   - First round: `git diff <fork>..<sha>`, where fork is `git merge-base <base> <sha>`.
   - A later round whose last recorded commit is an ancestor of sha, with no merge of the base in between:
     `git diff <last>..<sha>`.
   - A later round after a rebase or a merge of the base: `git range-diff <old fork>..<last> <fork>..<sha>`, which
     shows only how the task's own commits changed.
   - "Read the commit by its sha (`git show <sha>:<path>`), not the working files: its worker may go on working."
5. **The Must fix level.** The Must fix line's words (`MUST_WORDS`).
6. **Earlier findings.** For a later round or the final check: the last record's text, the reviewer's own words
   (never the worker's). With it, the worker's `--note`, if it gave one, marked as the worker's words: "Your
   worker left these as they are, and says why: …". The task is to check each finding: fixed, not fixed, or the
   fix broke what it touches.
7. **The verdict contract** (§5), and "your findings are your last message".

Limits: the whole prompt stays under 100,000 characters (one argv word). Earlier findings are cut at 20,000, the
brief at 60,000, each with "(cut)".

## 4. The worker's words

What still tells the worker to start the reviewer and write its prompt, at `upstream/main`:

- `templates/worker.md`, the Review bullet: "started as your child with `hc run --bg --name …`", "Its prompt gives
  it the brief, the diff, the Must fix level and ~/.config/herdr-core/templates/reviewer.md", the first and later
  rounds' diffs, `hc wait`, `hc read … --lines 400`, `hc kill`.
- `templates/worker.md`'s "a startup dialog" sentence and "A reviewer that ends in an error … don't record it with
  `reviewed`".
- `launch.closing_line()`: "record it on the commit it reviewed with `reviewed … --report "<its findings in a
  line>"` (add `--commit <sha>` …)".
- `templates/reviewer.md`: "the diff your worker gives you" and "the Must fix level your worker names". These stay
  true enough: the prompt gives both. Nothing in `reviewer.md` needs overriding.
- `templates/assistant.md`: "herdr-task starts no reviewers". Informational for the Assistant; left as is (§10).
- `reviewers.message()`: "Start it once more …; if it fails again, review with the other CLI".

**How it's handled.** The templates stay as they are (fork-patch). worker.md's own rule is "Where the brief's own
words say otherwise, they win". So with records on, the brief carries a paragraph of ours, from
`review_records.brief_words(s, task)`, placed right after `closing_line()` in `launch.brief()` and
`launch.handoff()` (one call site in each list):

> Review here is started by Herdr, not by you: this replaces the Review rule's reviewer start and `--report` above.
> Commit, then run `<ht> reviewed <key> --folder <folder>`: Herdr starts your reviewer on that commit and writes its
> prompt. `hc wait <its name> --timeout 600`, then run reviewed again: Herdr records your reviewer's own findings
> and shows them to you. Never start a reviewer yourself, never write its prompt, and never pass `--report` or
> `--commit`. When Herdr says your reviewer failed, run reviewed again to start it once more. A finding you judge
> wrong: say why with `--note "<why>"` on your next reviewed, and in your summary.

With final check on, it adds: "Final check is on: once your rounds are used, reviewed runs one final check of your
fixes. If it finds what must be fixed, fix it, commit, set your status line to "Final check found a must-fix" and
end your turn: only the person adds a round."

## 5. The record and the verdict

**Finding the reviewer's log.** `review_log.py` (ours) gives, for one launch row, `(state, text, log)`.

1. While the reviewer is live: `hc get <address>` gives its process. `sessions.session_of(pid)` gives the log of
   exactly that process: Claude's `sessions/<pid>.json`, or the Codex rollout it holds open (subagent rollouts
   skipped). No search, so no earlier session can be picked.
2. If it already ended: `sessions.find_log(a, ref, folders, taken)` with `ref` set to the launch id. `find_log()`
   matches its ref as a whole word in a log's first message, from the launch time on. The launch id is unique, so
   only this launch's log can match: not an earlier round's, not the worker's, not another task's reviewer.
3. Either way, the log's first user message (`sessions._start()`) must contain the launch id. Otherwise: no record.

**The completed turn.** The record is the reviewer's first turn: the answer to the launch prompt. Later turns (the
person typing to it) are never the record.

- Codex: the first `event_msg` of type `task_complete`; its `last_agent_message`, else the last assistant
  `response_item` before it. A `turn_aborted` first: cut off, no record.
- Claude: the last non-sidechain `assistant` entry with text (`agents.said()`) before the next real user message,
  once `hc get` shows the reviewer idle at turn 1 or later. An API error entry (`isApiErrorMessage`), or a turn
  whose words are only in a thinking block: no record.
- hc showing `error`, or the reviewer gone before a completed turn: no record.

**The verdict line.** The prompt asks for two lists, "Must fix:" and "Follow-up:" (reviewer.md's own words), and a
last line that is exactly one of:

```
Verdict: must fix
Verdict: nothing to fix
```

herdr-task reads only that last non-empty line (case and surrounding `*` or backticks ignored). It never reads
the lists to judge them. A message without a valid last line is no record: "your reviewer gave no verdict". The
reviewer decides "must fix" against the Must fix level it was given; code only reads its decision.

**The record.** Appended to `t["reviews"]`:

```python
{"round": n, "result": "report", "launch": "rv-…", "verdict": "must_fix" | "clear",
 "text": "<the reviewer's last message>", "head": "<the launch's sha>", "log": "<its log path>",
 "at": <ms>, "by": "<reviewer address>"}
```

- `result: "report"` keeps upstream's `rounds_used()`, `rounds_this_run()` and `herdr-task show` working as they
  are. `launch` is what marks it as a record: herdr-task alone writes it.
- The final check's record has `result: "final"`. It is not in upstream's `REVIEWED`, so it never counts as an
  ordinary round (otherwise a round the person adds later would already look used).
- `text` is the reviewer's whole message up to 8,000 characters, then "(cut: the rest is in its log)".
- `head` is the sha the launch named, never HEAD at record time.
- Written by whichever comes first: `reviewed` (above), `ready` (it collects first), or a tick pass,
  `review_records.records_pass(report)`, called beside `reviewer_pass(report)` in `tick.py` (one call site), so a
  record exists even when the worker forgets.

**What this guards against.** A worker that summarises wrongly, or records a round on the wrong commit. It doesn't
guard against a worker that forges a reviewer's log file on disk: nothing on one machine can, and none is assumed.

## 6. `ready`'s check and the round limits

With records on, `cmd_ready()` calls `review_records.refusal(s, t, wt)` instead of `review_refusal(s, t, wt)` (one
call site). It first collects any finished launch. It applies to worktree tasks: a task in the folder itself has no
commit to bind, so it keeps upstream's rule.

Cases, in order. "Passing record" means a record, ordinary or final, with `verdict: "clear"`. "Head" is the commit `ready` is asked to
take (`t["head"]`).

| Case | `ready` |
|---|---|
| Review off, no `review_gate`, or nothing of its own (`in_base`) | Passes, as today. |
| A passing record on the head, or carried over to it from one (§7) | Passes. |
| A must-fix record on the head | Refuses: "Your reviewer found what must be fixed on `<sha>`: fix it, commit, run reviewed." Whatever rounds are left. |
| No record on the head, rounds left | Refuses: "run reviewed: Herdr starts your reviewer on `<sha>`." |
| No record on the head, rounds used, final check off | Passes, unreviewed (#1557). Herdr, not the worker, notes "the last fix `<sha>` wasn't reviewed" on the record page (§9). |
| No record on the head, rounds used, final check on and not spent | Refuses: "All N rounds are used; run reviewed for the final check of your fixes." |
| Final check's passing record on the head | Passes. |
| Final check's must-fix record on the head | Refuses and sets `review_out`: Needs you. |
| Final check spent, the head changed since and nothing carries over | Refuses and sets `review_out`: Needs you ("changed after the final check"). |
| Final check couldn't run (two failed launches) | Refuses. The worker asks the person (§2). |

`review_out` is upstream's own field: the task shows Needs you, "Out of review rounds", or the worker's status line.
From Needs you the person has upstream's ways out, nothing new:
- add a round (the Assistant's `review-more`, which clears `review_out`): an ordinary round reviews the fix;
- or turn the final check off for that task (`--set review.finalCheck=off`): `ready` then takes the head
  unreviewed, and the record page says so.

When `ready` passes, it stamps what it accepted: `t["review_ok"] = {"head": <sha>, "how": "reviewed" | "carried" |
"unreviewed" | "final"}`. The merge uses it (§8).

**The extra round.** Exactly one per task, ever: `t["final_check"] = {"sha", "launch"}` is set at its launch, and
`reviewed` never starts another. It reviews only the fixes since the last record, against that record's findings
(§3, parts 4 and 6). Rounds the person adds later are ordinary rounds, not final checks.

**Outcomes, every case (Codex point 19):**

| Setting | Situation | Outcome |
|---|---|---|
| Records off | any | Upstream, unchanged. Our code doesn't run. |
| Records on, final check off | rounds left | Each round is a record; `ready` needs a passing one on the head. |
| Records on, final check off | rounds used, last round passed on the head | Ready. |
| Records on, final check off | rounds used, fixes after the last round | Ready, unreviewed; the record page says which commit. |
| Records on, final check on | last ordinary round passed on the head | Ready. No final check runs. |
| Records on, final check on | rounds used, fixes after the last round | One final check. Passes: ready. |
| Records on, final check on | the final check finds must-fix | Needs you, never ready. |
| Records on, final check on | the final check can't run | No record. The worker retries once, then asks the person: Needs you. |
| Records on, final check on | changed after the final check | Needs you. |

**What changes against upstream, with records on and final check off:**
- Herdr starts the reviewer and writes its prompt; the worker no longer does.
- A round counts only with the reviewer's own verdict, read from its log; `--report` is refused.
- A must-fix verdict on the head blocks `ready` (upstream takes any recorded round).
- Carry-over is narrower (§7).
- The merge goes through only at the commit `ready` accepted (§8).
- The card links the record page (§9).

**What doesn't change:** the number of rounds, what review-more does, #1557's unreviewed last fix once rounds are
used, that a failed reviewer is no round, the Must fix levels, and the Assistant's words.

**With records off, nothing changes.** Every call site checks `on(s, t)` first and falls back to upstream's call.
A test runs upstream's own review tests (`ReviewedNamesItsCommit`, `ReviewedFindsTheTaskWorktree`, `ReviewAsAHelperAgent`
and the `review_refusal` cases) with the patch in place and the setting off, and they pass unchanged.

## 7. Carry-over: keep, narrowed

A record still counts for a later head only when it is a passing record, and:

- **Kept: clean merges of the base (`base_merges_only()`, #741).** Every commit since the record is git's own merge
  of the base, tree for tree. Nothing of the task's own changed; the merged result is what the base's checks run on.
  Dropping it would cost a round on every catch-up with main, which the brief requires before ready.
- **Narrowed: the same own changes after a rebase (`same_own_changes()`, #1178).** Upstream compares the lines
  added and removed, without the lines around them. So a change that lands next to different code still counts,
  and that is where a rebase can break it unseen. Ours compares `git patch-id --stable` of `git diff <fork>..<commit>`
  for the record and the head. It ignores line numbers and whitespace but keeps the context lines. A rebase that
  left the task's lines and their surroundings as reviewed still counts. One that changed the code around them
  needs a round (or the final check).

Ours is `review_records.carries(s, t, wt, recorded, head)`, which calls upstream's `base_merges_only()` and our
patch-id check. Upstream's `carried_over()` is not edited. `reviewed`'s "its review holds" answer uses ours too.

## 8. Merge at the accepted commit

The commit `ready` accepted (`t["review_ok"]["head"]`) is the only one that merges. With records on:

- `merge_now()`: before `gh pr merge`, `review_records.merge_refusal(t, v["headRefOid"])` (one call site). GitHub's
  head isn't the accepted one: refused, as a problem, so upstream's `merge_failed()` sends it back to its agent:
  "GitHub's head `<x>` isn't the commit Herdr accepted at ready (`<y>`): run ready again." The merge already passes
  `--match-head-commit` with that same head, so GitHub can't merge a newer one in between.
- `github.queue_merge(task, head)`: the same check first (one call site). It covers every re-queue path
  (`tick.py`, `systemic.py`).
- `cmd_accept()`'s local fast-forward: `ff_merge()` only when the branch tip is the accepted commit (one call site).
- Not gated: a local merge its agent makes by hand (no GitHub, no fast-forward), as `local_merge_msg()` asks. Its
  agent says ready again after it, and that ready is checked.

## 9. The card

No edits in upstream's web files. The review card already links a task's other artifacts
(`proof.task_artifacts()`: artifacts published for its key since it started). So herdr-task publishes one page per
task with `herdr-artifact`, titled "`<task title>` · Review", and updates it on every record:

- each round: round n (or final check), the commit's sha, the verdict, and the reviewer's words verbatim
  (HTML-escaped);
- an unreviewed final commit: "The last fix `<sha>` wasn't reviewed: all N rounds were used";
- failed launches in one line each ("round 2's reviewer froze; no record").

`herdr-task show` prints the last record's sha and verdict beside upstream's "review rounds" line. A plugin that
shows the words inline on the card can come later (docs/plugins.md, `chatCards`); it isn't needed now.

## 10. Safety (nothing that risks a ban)

- Reading the reviewer's local session log contacts no provider (docs/agents-and-terms.md, "Transcript, context and
  token estimates"). The build task adds `review_log.py` to that row's files and updates the table's date.
- The reviewer is started with the official CLI's documented start (`claude "<prompt>"`, `codex "<prompt>"`) and
  the Reviewer line's own flags, as worker.md has workers do today.
- Nothing is typed into a running reviewer. No screen is answered. herdr-task only ends a reviewer whose turn it
  recorded, with `hc kill`, as the worker does today.
- No retry on another CLI after a failure (§2).
- The Assistant's words are not changed. A task in Needs you says why through its `review_out` and status line.

## 11. Pins

Each a test in `test/test_fork_review_records.py` (a new file beside upstream's, so CI's `discover -s test` runs it;
it imports `home_guard` first). Each failure message names "dmalis/shepherdr#4" or "#5".

| What we rely on | Test |
|---|---|
| `settings_for()` passes unknown `tasks` keys through; `DEFAULTS`, `SET_KEYS`, `ONOFF` exist; `set_task(t, key, value, agent=None)` | Set the keys in a throwaway settings file; read them back at each layer. |
| `review_limits(s, t) -> (on, rounds)`; `task_settings()` has "Must fix" and "Reviewer" rows, the Reviewer value with `command` and `agent` | Call them on a made-up task. |
| `reviewer_command(who, model, effort, folder, fast)` gives `--sandbox read-only` (codex) and `--permission-mode dontAsk` (claude) | String checks. |
| `sessions.session_of(pid) -> (sid, log)`, `find_log(a, ref, folders, taken)` matching `ref` as a whole word in the first message, `_start(path, cwd)` | Made-up Claude and Codex logs in a temp HOME; an earlier log naming the task but not the launch id is not picked. |
| `agents.said(d)` | One Claude and one Codex entry. |
| `commands.REVIEWED` contains "report" and not "final"; `rounds_used(t)`; `rounds_this_run(t)`; `review_refusal(s, t, wt)`; `base_merges_only(s, t, wt, reviewed, head)`; `cmd_reviewed`, `cmd_review` | `inspect.signature` and a small call. |
| `begin()` and `_start_again()` set `t["review_gate"]` | A started made-up task. |
| `merge_now()` passes `--match-head-commit`; `queue_merge(task, head)` | Source check and signature. |
| `reviewers.reviewer_pass(report, read)` watches `herdr.role=reviewer` | Source check. |
| `proof.task_artifacts(s, t, proof)` lists a task's artifacts by its key since it started | A made-up artifact list. |
| `agents.OUT_OF_ROUNDS` shows for `review_out`; `cmd_review_more` clears `review_out` | Small calls. |
| `launch.brief()` and `handoff()` end with `closing_line()` then `settings_block()`; `closing_line()` still says `--report` | Build a brief for a made-up task. |
| `templates.instructions(role)` | Call it. |
| worker.md still has "Where the brief's own words say otherwise, they win." and the Review bullet's "hc run --bg --name" and "Its prompt gives it the brief" | Line checks. If the Review bullet is rewritten, our §4 words are checked against it again. |
| reviewer.md still has `"Must fix:"`, `"Follow-up:"` and "Your findings are your last message" | Line checks. |

## 12. Codex's points 18 and 19

| Point | Decision | Where |
|---|---|---|
| 18: log discovery can pick an earlier matching session | A unique launch id in the prompt's first line; the live process's own log first, else `find_log()` keyed on that id; the first line must name it | §2, §5 |
| 18: bind to one launch, a completed turn and the sha | Launch rows; the first turn only; the record's head is the launch's sha | §2, §5 |
| 18: a structured verdict | One last line, "Verdict: must fix" or "Verdict: nothing to fix", read and never judged | §5 |
| 18: legacy `review --pass` finalizes without a pending review | With records on, `review` is refused ("retired: rounds are the reviewer's own records"). Off: upstream's. Authenticating it is offered upstream | §13 |
| 18: `reviewed --report` is the worker's word | With records on, `--report` and `--commit` are refused | §2, §4 |
| 18: merge pins GitHub's latest head unchecked | Merge, queue and fast-forward only at the commit `ready` accepted | §8 |
| 19: records block an unreviewed last fix, while final check off promises today | Final check off: ready takes the unreviewed last fix, as #1557, and Herdr labels it. Records refuse it only while rounds are left. So #4's acceptance line "ready refuses B until a new round or #5 has checked it" holds while rounds are left, or with final check on | §6 |
| 19: outcomes for off, on, passed, unavailable, failing | The outcomes table | §6 |
| 19: keep equivalent-diff carry-over? | Keep clean merges; narrow same-changes to patch-id with context | §7 |

## 13. Build tasks

Each is small enough to review in one sitting. Edits to upstream files are only at the named call sites.

1. **The prompt** — `review_prompt.py`, with the `practice.words` stand-in. Tests: each round's range (first, later,
   after a rebase, after a base merge) on a real throwaway git repo; earlier findings come from records, never
   the worker; the note is marked as the worker's; the limits; a fake `practice` module is used when present. No
   wiring. #3 builds on it. *Parallel with 2 and 3.*
2. **Settings** — the appended block in `settings.py`, the `set_task()` on/off edit, `review_records.on()` /
   `final_check_on()`, stamping at brief and handoff. Tests: the three layers, `--set` and `=default`, `config`
   lines, final check ignored with records off; the settings pins. *Parallel with 1 and 3.*
3. **The log reader** — `review_log.py`: live log, `find_log()` by launch id, the first completed turn, the verdict
   line. Tests: made-up Claude and Codex logs (one clean, must-fix, no verdict, aborted, API error, thinking only,
   a second turn typed by the person, an earlier matching session); the sessions pins. Updates
   docs/agents-and-terms.md's row and date. *Parallel with 1 and 2.*
4. **Start and record** — `review_records.py`: `reviewed` (start and collect), launch rows, the `hc run` argv,
   `records_pass()` in `tick.py`, `brief_words()` in `brief()` and `handoff()`, `review` and `--report` refused.
   Call sites: `cmd_reviewed()`, `cmd_review()`, `tick.py`, `launch.brief()`, `launch.handoff()`. Tests: a fake
   `hc` (records its argv; plays a reviewer's states) and a throwaway git repo. *After 1, 2 and 3.*
5. **Ready and merge** — `refusal()`, `carries()` with patch-id, `review_ok`, `merge_refusal()`. Call sites:
   `cmd_ready()`, `merge_now()`, `queue_merge()`, `cmd_accept()`. Tests: every row of §6's ready table for an
   ordinary round, the carry-over cases (clean merge, rebase with the same context, rebase with changed context), a
   newer GitHub head refused at merge and at re-queue; "records off changes nothing" (upstream's review tests with
   the setting off). *After 4.*
6. **The final check (#5)** — the final round's prompt part, one ever, `result: "final"`, Needs you through
   `review_out`, the escape by `--set review.finalCheck=off`, a person's added round after it. Tests: every row of
   §6's outcomes table. *After 5.*
7. **The record page** — publish and update "`<title>` · Review" with `herdr-artifact`, and `show`'s line. Tests: the
   page's text for each case, escaping, its link on the card's evidence. *After 4; parallel with 5 and 6.*
8. **A real try** — on a throwaway session (AGENTS.md: Trying a change): one task with a real Claude reviewer and one
   with a real Codex reviewer, each with a planted bug; the worker's `--report` refused; a must-fix record blocks
   ready; the fix's round passes; a final check on a second fix; a push after ready refused at merge (a scratch
   GitHub repo or `HERDR_TASK_GH` fake). One worker is Codex, to see `reviewed`'s `hc run` work from its sandbox.
   Proof page with the record pages. *After 6 and 7.*

## 14. Upstream

Offered once each, after it is merged here, and only on the person's yes (the upstream-issue skill). Smallest and
least contested first:

1. **`review --pass` needs a pending review from its own reviewer.** A bug fix: today anyone's `review --pass`
   finalizes. Likely taken.
2. **Merge only the commit ready took.** `merge_now()` and `queue_merge()` compare GitHub's head with `t["head"]`.
   A plain fact check, like `--match-head-commit`. Likely taken.
3. **`find_log()` by a launch token.** Makes the lost-log search exact for reviewers. Small.
4. **`herdr-task review-prompt <task>`**, printing `review_prompt()`'s text for the worker to give its reviewer.
   It keeps "behaviour is words": the worker still starts the reviewer. Upstream issues 1439 and 1450 point this way
   (a round must mean a reviewer really answered).
5. **Records from the reviewer's own log, with a verdict line.** Expect pushback under "Shepherdr's code never
   judges work". Our answer: the reviewer judges; code reads one line it wrote and compares shas, as
   `review_refusal()` already gates `ready` on a recorded round.
6. **The final check.** Expect "not planned": upstream closed 1556 with "Review rounds are now handled in the
   agents' instructions". Offer only its words form: a Settings block line, "Final check: on", that tells the
   worker to run one final round. The enforcement stays ours.

How this answers 1556's need. 1556 asked for a button when rounds run out, so a fix doesn't wait on a sleeping
person. Upstream answered with words: rounds are the limit and the last fix goes unreviewed. We keep that as the
default. Final check on gets the fix checked with no person in the loop at all; only a fix that fails its check
waits, and then on upstream's own Needs you and review-more, not a new button.

## 15. Open questions for the person

1. **Turn records on Everywhere once built?** Recommended: yes, Everywhere. The code default stays off so the
   public repo and a sync stay neutral; your settings file turns it on.
2. **Where is the final check on?** Recommended: on for the repos where a bad fix costs money, off for MVPs. Each
   final check costs one more reviewer run per task that used all its rounds.
3. **A worker that disagrees with a must-fix finding.** Recommended: it can't go ready on that commit. It fixes the
   rest, says why in `--note`, and the next round's reviewer weighs its reason. If rounds are used, it is Needs you.
   The alternative, the worker overriding with its reason on the card, is exactly the self-report #4 removes.
4. **Narrower carry-over.** A rebase that changed the code next to the task's change costs a round (or the final
   check). Recommended: yes. Clean merges of main still cost nothing.
