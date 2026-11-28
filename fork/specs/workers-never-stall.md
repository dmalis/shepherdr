# Workers never stall (dmalis/shepherdr#215)

A space's Assistant drives its task agents through the day on its own. A task must never get stuck on a step Herdr
itself got wrong, nor merge before it should.

## The rule

- **A step Herdr can redo safely, it redoes.** A push it made after a rebase is tried again with its lease; a
  conflict GitHub hasn't worked out yet is looked at again after the push lands; a wait that ended on an agent's
  startup is waited again.
- **A step that is the person's waits for them, with why.** The card says what it waits for; the agent hears what it
  can still do.
- **A merge happens only when** the Merge setting allows it, the checks its base requires ran on the commit it
  merges, and, when Proof is on, after the proof.

## The reports

Each was reproduced or checked again against this tree (v3.2.22 plus our patches) and upstream (v3.2.24, released while this was built: main 5abe8526; it changes only machines.py of herdr-task).

### Already fixed here: checked, nothing to build

| Report | Cause | Fixed by |
|---|---|---|
| `2460624572` push after a rebase refused with a bare "(failed)" | GitHub's passing refusal | #97 `rebased_push.py`: one more try after a fetch and a pause, GitHub's words said |
| `d6bd75a699` conflict right after a clean rebase and push | GitHub's mergeable still UNKNOWN or the old CONFLICTING | #97 `merge_wait.mergeable_waits()`: waits while GitHub works it out |
| `1612fbff62` merge right after the push, before the required checks ran | GitHub's view at the old commit, or a required check not listed yet | #74 `merge_wait.py`: the merge is pinned to the commit pushed (`--match-head-commit`), and waits while GitHub's view is at another commit or BLOCKED with a required check not listed yet. That the required checks passed is GitHub's own rule: it never says CLEAN while one is missing, and gh refuses a BLOCKED merge |
| `a8c06c6022` ready refuses a follow-up on a Done task | A merged task stayed Done with no way on | #48 `after_merge.py`: ready offers the `follow-up` command |

All four were filed before their fix merged. Their tests (`ReadyAfterARebase`, `PushedForItsMerge`, `RebasedPush`,
`MergeableAfterAPush`, `WorkAfterTheMerge`) pass on this branch.

### Proof before merge (`e1a79c9dc8`)

**Cause.** ready with Proof on and no proof found only adds "No proof artifact found … run ready again with --proof".
finalize() opens the pull request and, with Merge on its own, merges it at once (or the tick merges it once its checks
pass). The task is Done before the agent's second ready, which is then refused as already done.

**Fix** (`proof_hold.py`, one call in finalize()). Proof on, no proof found, and Merge would merge on its own (on its
own, or after checks): the pull request opens, and the merge waits for the person, as Merge "ask me first" does. Its
card says "Waits for you to merge it: Proof is on and it has none yet." The agent hears: publish the proof, then run
ready again with --proof <its id>; it then merges as Merge says. Not refused: a change too small to show has no
proof, as the worker template allows, and the person can still accept it as it is.

A ready that finds a proof clears the hold. Merging stays the person's to choose: their own Accept merges a held task,
and so does a merge they asked for before (the merge queue an Accept put it in, a Mark as done that failed): Herdr
never merges a held task on its own.

### Review rounds the brief names (`ddc42234cd`)

**Cause.** The Assistant wrote "At most 2 review rounds" in the brief's words, and the task's setting stayed 5. The
brief's words win for the agent (the Settings block says so), but ready counts the setting's rounds, so after two
rounds ready asked for a third.

**Fix** (`brief_rounds.py`, calls in add, edit and ready). A brief that caps its review rounds in one clear phrase
("at most 2 review rounds", "up to two rounds of review", "only one review round", "Review rounds: 2") sets the
task's Review rounds to it, as `--set review.rounds=2` would, unless the Assistant's `--set review.rounds` or
`review=off` is given. add says so. Only a cap: a floor ("at least 2"), a bare count, "review round 2", a phrase
with a no before it in its sentence, two different numbers or one out of 1 to 10 set nothing. An edit of the brief reads
it again (a cap it no longer names is taken back), and ready reads it for a task added before this.

### The hand-in flags ready names (`816c43c6fc`)

**Cause.** A brief told a task no schedule started to hand in with `ready --told`. ready refused, naming only
`ready --summary "…"`, so the agent had to work out the rest.

**Fix** (quiet_ready()'s refusal). It names the exact command for this task:
`<herdr-task> ready <key> --folder <folder> --summary "<what the person now sees or can do>"`, and
`--details "…"` for the rest.

### `hc wait` ends on a reviewer's startup (`a45736998c`)

**Cause, reproduced** on a throwaway herdr-core with real codex 0.172 and hc 0.1.22. `hc run --bg -- codex … "<the
prompt>"`, then `hc wait <it> --timeout 120` at once: the wait ended after 1.3 s with `status: idle, turn: 0`, while
`hc read` said "it is working". Sampling `hc get` every half second showed none, working at turn 0 for 30 s, then idle
at turn 1. Codex shows its idle prompt for a moment before it sends the prompt it was started with; herdr-core reports
that moment as idle, and `hc wait <t>` ends on idle at turn 0 (its help: "Without a launch task, idle still counts as
stopped"). herdr-core's state is right for that moment; its wait has no way to know a prompt is on its way. The fix
belongs in herdr-core: a terminal started with an agent's prompt in its argv should count as having a launch task. The
person reports that to herdr-core's project.

**Fix meanwhile** (`helper_wait.py`, `herdr-task wait-for <name>`). It runs `hc wait <name> --timeout <s>` and, while
the result is idle at turn 0 and the terminal still lives, waits again (a short pause first), until the timeout. It
prints hc's last result. A reviewer on a startup screen (trust, sign-in) is never answered: wait-for waits on it as hc
wait does, and ends when Herdr's reviewer watch (reviewers.py, unchanged here) tells the worker and ends it. Only a
helper the worker started itself (named `<key>-review` or `-helper`, its hc parent the caller), and it runs without
asking (launch.py's OWN). The Reviewer line in the Settings block names it: "wait for it with
`herdr-task wait-for <its name> --timeout 600`". Upstream's worker template still says `hc wait`, which still works
when the agent waits again by hand as it says.

## Nothing that risks a ban

No key is typed into an agent, no prompt is answered, no agent setting is read or written. `wait-for` only runs `hc
wait` and `hc get`, herdr-core's documented commands. The repro used Codex's documented CLI, its own trust setting in
a scratch CODEX_HOME (never `~/.codex`), and a throwaway session.

## Tests

`test/test_herdr_task.py`: `WorkersNeverStallProof`, `WorkersNeverStallRounds`, `WorkersNeverStallTold`,
`WorkersNeverStallWait`.
