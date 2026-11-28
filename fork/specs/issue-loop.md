# The issue loop

Part of #235. The spec for one loop that runs without the person. The agents find a problem in Shepherdr and record
it. It becomes an issue here in plain words, gets a score for how much it hurts, and the important ones are fixed,
reviewed, merged and installed by themselves. The person reads one short message a week and answers only product
decisions.

It builds on the friction loop (#94, `fork/specs/friction-loop.md`): its record, drafts, post marker, reconciliation
and `fork/bin/found`. What changes is who says yes. There, the person's yes was needed for every post. Here, a
standing yes covers a post that passes the public check, and a person's yes is needed only for a product decision.

Each phase is a task and a pull request of its own ([Build plan](#build-plan)). **One part is open for the person:
how they see the loop** ([The person's view](#the-persons-view)). Nothing in that part is built until they decide.

## The need, in the person's words

- "we don't need feedback at all in ui. Agents in this repo discover the issues like you already are and file them
  and you raise them and there is automation that just gets the loop going without me."
- "I don't even read the feedback on my own because it's too technical."
- "it's a public repo, just don't expose my business or personal info."
- "no info/data we already collected is lost by this task: maybe thrown away because it's irrelevant, but not lost
  by mistake."

## Words

| Word | Meaning |
|---|---|
| **finding** | One problem in Shepherdr an agent recorded: one row of herdr-task's feedback record (`.feedback.json`, friction loop). |
| **report** | One time a finding was noticed. A finding keeps all of its reports. |
| **fingerprint** | The finding's identity for dedupe. It names the part of Shepherdr and the action that failed, never the words of one report ([Fingerprints](#fingerprints)). |
| **public draft** | The issue text exactly as it will be posted: a plain title and allowed fields, in public words. |
| **the public check** | The code check every public draft, search and comment passes before it leaves the machine ([Public safety](#public-safety)). |
| **score** | 1 to 5: how much the finding hurts the person's day ([Triage](#triage)). |
| **auto-fix** | A task the loop started by itself for one issue. |
| **the loop's schedule** | "Fix what we found", one schedule in this space. Its Pause is the loop's stop switch ([Stop switches](#stop-switches-and-gates)). |
| **trusted issue** | An issue this machine's own publisher posted. The local record proves it, not the issue's text or labels ([Trusted intake](#trusted-intake)). |

## Today, mapped

| Step | Today | What goes wrong |
|---|---|---|
| Record | `herdr-task feedback` (friction loop slice 1): saved at once, whether or not an Assistant runs | Nothing. Kept as it is. |
| Shape | An Assistant writes the fix and search words (`--shape`) when it's free | Lines stay technical ("ready refuses a reviewed HEAD …"): the person doesn't read them. |
| Yes | The person's Post it on the Feedback page, or a yes to a card that showed the draft | The person doesn't open the page. The backlog grows. |
| Post | `feedback_post.py`: the exact draft, a hidden marker, `posting`, `posted`, `refused`, `unsure`, reconciled from GitHub, never posted twice | Nothing. Reused as it is. |
| Hand-off | `fork/bin/found`: each new issue becomes work in this space, once | It runs only after a person's yes. |
| Fix, merge, install | Tasks, Merge on its own, "Install each merge" | Starting the work is by hand. Merge waits only on the checks the base requires: a non-required check had already failed when one merge went through (a recorded finding). |

**The evidence.** Across the person's two machines the record holds 135 findings. 20 were filed (17 to upstream
before the closed loop, 3 here) and 115 never were. That is the "115 ideas". One machine holds 43, and about 20 of
those are one problem reported again by different tasks in different words: `ready` refusing a commit whose review
was recorded on it. The friction loop's identity counts identical lines as one finding. It never joins different
words, so the same failure reported in new words became a new row each time.

## Research

### Industry practice

| Source | What it does | What we take |
|---|---|---|
| **GitHub Agentic Workflows** ([architecture](https://github.github.com/gh-aw/introduction/architecture/), [safe outputs](https://github.github.com/gh-aw/reference/safe-outputs/), [staged mode](https://github.github.com/gh-aw/reference/staged-mode/), [issue triage](https://github.github.com/gh-aw/gallery/ai-issue-triage/)) | The agent runs read-only. Its writes are buffered as "safe outputs", filtered and sanitised by code, and applied by a separate job. Each write kind has a `max` (one issue by default) and can dedupe by title. Labels come only from a fixed list. Staged mode runs everything but shows the writes as a preview. The triage example says "Prefer leaving a label unset over applying one speculatively". | The agent writes words. Code checks and applies every write (public check, labels from a fixed list, a cap per hour). The triage phase runs a preview first: labels and scores written to the private record, nothing started. |
| **Phoenix: Safe GitHub Issue Resolution via Multi-Agent LLMs** ([arXiv 2606.20243](https://arxiv.org/abs/2606.20243)) | A label state machine: labels are the only persistent state, and an issue carries at most one AI-state label, changed atomically. A lock keeps one issue in work at a time. Issue bodies are cut to 1,500 characters, with code blocks folded to one line and tracebacks stripped, before any prompt. Retries are capped (two rounds) and a no-progress detector stops a stuck attempt. | One loop-state label per issue ([Labels](#labels)). One auto-fix at a time. A fix task's brief takes the approved draft from the local record, at most 1,500 characters, never a raw log. One retry, then it waits. A stuck fix frees its slot. |
| **Cloud Security Alliance: "Who Owns the Bad Patch? Agentic Auto-Remediation Accountability"** ([research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-agentic-autofix-remediation-accountability/)) | "Issues, comments, and third-party files" are potential injection input. Agents should not hold organisation-wide write tokens or deployment secrets. Someone must own an AI-authored fix before it scales. A clean rescan is not proof of a fix. Try a new remediation on a small set first, and set explicit batch limits. | Tasks start only from trusted issues, and a brief never carries text someone else posted. Each auto-fix names its issue and is labelled as one. The person owns the loop and has one switch. The fix still needs the reviewer and every check. Limits: one at a time, three a day. |
| **Sentry grouping and fingerprints** ([grouping](https://docs.sentry.io/concepts/data-management/event-grouping/), [fingerprint rules](https://docs.sentry.io/concepts/data-management/event-grouping/fingerprint-rules/), [states](https://docs.sentry.io/product/issues/states-triage/)) | Events with one fingerprint are one issue. A custom fingerprint "overrides the default grouping entirely", so a loose one merges unrelated events, and volatile values make "really bad groups". A resolved issue that comes back is Regressed. | A fingerprint names the part and the failing action, never volatile values (commit hashes, times, task keys), and never only a part. The same fingerprint again is counted, not filed again. Again after its fix is live: "came back", linked, scored one higher. |
| **GitHub REST API best practices** ([best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)) | "Make requests serially instead of concurrently". For many writes, "wait at least one second between each request". Content creation is limited to 80 requests a minute and 500 an hour. A conditional request answered 304 doesn't count. Obey `retry-after`, else wait a minute and back off. | One writer at a time, at least two seconds apart, at most 10 new issues an hour and 30 a day. Reads are conditional (ETag) where `gh api` allows it. A limit answer stops the run until `retry-after`. |
| **GitHub Acceptable Use Policies** ([AUP](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)) | Section 4 forbids "excessive automated bulk activity" and spam. It sets no number. | A handful of issues a day on our own repo, with the person's own login, is far inside it. The caps above keep it that way, and nothing is posted on anyone else's repo. |
| **Renovate** ([configuration options](https://docs.renovatebot.com/configuration-options/)), and its Dependency Dashboard | `prConcurrentLimit` (default 10) and `prHourlyLimit` (default 2) cap automated pull requests. One issue lists what is open, pending and rate-limited. | Precedent for hard caps on automatic starts, and for one place that lists what waits. |
| **Google SRE: Example Error Budget Policy** ([workbook](https://sre.google/workbook/error-budget-policy/)) | Over budget: "halt all changes and releases other than P0 issues or security fixes" until back within the objective. | Red main halts routine auto-fixes. One recovery attempt is allowed, then the pause latches until the person resumes. |

### Upstream first

- **Checked:** v3.2.24 (our main is on v3.2.22). Upstream's main since our base changes neither `feedback.py` nor
  `web/src/list.tsx`. Searches for feedback filing, triage and auto-fix find nothing.
- **Upstream had an "Autopilot" and removed it.** In 3.1 it woke the Assistant on a timer to unblock work and start
  the next most valuable tasks (3.1.5: "at most 2 a wake"). 3.2 took it out: "Autopilot. A repeating schedule does that
  now, and a schedule can also start on an event, such as a merge" (CHANGELOG, 3.2.0; docs/upgrading.md). Three
  more facts follow from that:
  - its settings key, `autopilot`, is "ignored from 3.2 on, wherever a file still has" it (docs/settings.md);
  - the Assistant's template tells it never to say "Autopilot" or "automation" to the person;
  - every schedule already has Pause and Resume in Tasks › Scheduled, on a phone too.

  So upstream's way to automate is schedules. This loop is built on them: one schedule does the work, and its Pause
  is the stop switch.
- **Upstream's Rules kept:**
  - "Behaviour is words, not code. Shepherdr's code never judges work." Agents write the words, the score and the
    fingerprint. Code only checks them, counts and applies limits.
  - "A new feature is a plugin." Any page for the loop is one ([The person's view](#the-persons-view)).
  - "Nothing personal." The public check enforces it.

## The design

Seven principles.

1. **Nothing is lost.** Every finding stays in the record. Dropping one is a decision with a private reason, never a
   deletion. Before the first change, everything is backed up ([Data](#data-nothing-lost-by-mistake)).
2. **Nothing private goes public.** Agents write public words first. Code then blocks, never rewrites, any draft,
   search or comment the public check flags. A flagged finding stays private.
3. **One problem, one issue.** A fingerprint per problem. The same problem again is counted privately. A comment goes
   on the issue only when the count changes the score.
4. **Agents judge, code limits.** The score, the plain words and "is this a product decision" are an agent's words.
   Code enforces the caps, the gates, the label set and the trusted intake.
5. **Only our own issues start work.** A fix starts only from an issue this machine posted. Text someone else wrote
   never enters a brief.
6. **One switch stops it all.** Pausing the loop's schedule stops new starts, the merge of an auto-fix and its
   install. Red main latches the same switch.
7. **The person sees outcomes, not rows.** One plain message a week. The only questions are product decisions, one
   card each, with a recommendation.

### Intake

Unchanged: `herdr-task feedback "<line>" --details … --fix … --kind …`, recorded at once (friction loop slice 1).
Agents keep reporting the way FORK.md says. Feedback offers stays on in every space during the move. Turning it off
stops reports being saved.

### Shaping: plain words, a score, a fingerprint

An Assistant shapes a finding when it is free, as today (`herdr-task feedback --key K --shape …`). Shaping gains
three fields, each an agent's words:

- `--fingerprint <part>/<action>[/<symptom>]`, in lower-case words joined by dashes. The part comes from a fixed list
  in `feedback_loop.py`: tasks, review, merge, ready, chat, phone, web, install, sync, schedules, browser, artifacts,
  secrets, machines, settings, agents. Examples:
  - `ready/reviewed-head-refused`;
  - `merge/non-required-check-failed`;
  - `phone/keyboard-covers-box`.
- `--score 1..5` with `--why "<one line>"` ([Triage](#triage)).
- `--product` when the fix is a product decision: a new layout, or behaviour the person would notice. It never starts
  on its own ([What happens by score](#what-happens-by-score)).

The public draft is shaping's existing draft fields: `--title`, `--goal`, `--happened`, `--expected`, `--repro`, and
`--fix` as Suggested fix. The title is plain words about what the person meets, not the code: "A finished review isn't
recognised after a rebase", not "ready refuses HEAD b6c1dc8". The body uses the friction loop's sections. The
Environment section is reduced to the Shepherdr version.

**Unshaped findings don't wait forever.** Once a day, the loop's run counts findings a day old or more with no draft.
When there are any, this space's Assistant gets one news row: "N findings wait to be written up" (`herdr-task
tell-assistant`). That Assistant shapes them, whichever space they came from.

### Fingerprints

- **The fingerprint is the dedupe key** for publishing, not the report's words. Two findings with one fingerprint
  are one problem.
- **Never too broad.** Code refuses a fingerprint without an action (`ready` alone), and one that holds a volatile
  value: a hex run of 7 or more, a number of 4 or more digits, a task key (`ABC-12`), a date or a time. As in Sentry,
  a fingerprint that merges unrelated failures hides new ones. When in doubt, the agent's words say what failed more
  narrowly.
- **Same fingerprint, open issue:** no new issue. The finding links to that issue (`related`, as Follow does today),
  and its reports count there privately.
- **Same fingerprint, issue closed as fixed and its fix live** (`live`, or closed after it): **came back**. A new issue
  "Came back: <title>" links the old one, with the score one higher (at most 5). This is Sentry's Regressed.
- **Same fingerprint, issue closed as not planned:** counted privately. Nothing is posted. The weekly digest says
  when it keeps happening.

**Seen again, and when it is said.** Reports count only when they are independent: each distinct task or chat
counts once a day. Agents echoing one failure in one task count once. A comment goes on the issue only when the
count changes the score ([Triage](#triage)): "Seen again 3 times since <date>, in 3 tasks; now scored 4". At most one
comment per issue a day.

### Public safety

Only these fields go out:

- the plain title;
- goal, what happened, expected, steps to reproduce and suggested fix, from the shaped draft;
- the kind;
- the Shepherdr version.

Never the report's raw line or details, a log, the space, the machine, a task's title or key, or the person's
project.

**The public check** (`feedback_public.py`, new, in herdr-task) runs on every public draft, search query and comment,
right before it leaves the machine. It reports what kind of thing it found and on which line, never the text itself.
It refuses:

- what `fork/sync/public.py` refuses today: home paths (whole or written with a tilde), emails, tailnet and `.local` names, IP addresses,
  this machine's name, installer output and tracebacks. Ported, not imported: herdr-task can't import `fork/`.
- phone numbers: runs of 9 or more digits, with spaces, dashes or a leading `+` allowed;
- the names of every linked machine (`hc machine ls`) and the configured hostname;
- from the person's settings file: every space's name, every folder's last part and every repo's name except the
  feedback repo and Shepherdr's own (as words, of 4 letters or more, not case-sensitive);
- the git author name and email of the space's repo, and the person's own GitHub login when it isn't the repo owner;
- `agents.private_words`: a new Everywhere list in the person's settings file, for names only they know, such as a
  company or a customer. It is empty by default and has no row in the web app.
- anything `redact()` would change. If redaction would rewrite it, it isn't public-safe.

**A flagged draft stays private.** Its finding is `held` with the kinds found. Its Assistant is told once to rewrite
it in public words ("the serving machine", "a production project", "a space"). A second flag on the new revision
leaves it held. The weekly digest then says "1 note couldn't be made public", and the person decides in chat:
rewrite, keep it private, or drop it. Search terms leave the machine only after the same check.

**Honest limit:** the check catches names it knows and common shapes. A new customer's name, written by an agent
before anyone listed it, is caught only by the agent's own instruction to write public words. The draft is the
agent's words, never pasted text, which keeps that risk small. Adding the name to `agents.private_words` closes it for
good.

### Publishing

`herdr-task feedback --publish`: code, no agent. It runs on the service's tick, at most every 10 minutes, and only
while something is shaped and not posted. It goes through the friction loop's posting, unchanged (`feedback_post.py`:
the stored draft, its marker, `posting`, `posted`, `refused`, `unsure`, reconciliation), with one new approver:

- **The standing yes.** `agents.feedback_publish`: `ask` (the default, today's behaviour) or `auto`. Only the person
  sets it, in the settings file or in Settings. It is refused from an agent's terminal, like `--may-update-shepherdr`.
  With `auto`, a shaped draft that passes the public check is approved for its revision and target by the policy
  (`approval.by: "policy"`). It is then posted like any other.
- **The destination is pinned.** `auto` posts only when `agents.feedback_repo` is set in the settings file. The
  default, upstream Shepherdr's repo, is never auto-posted to. The approval names its target, and a changed feedback
  repo refuses the post, as today.
- **Labels at creation:** `found`, the kind (`bug`, `confusing`, `workaround`, `manual`, `miss`), and `p<score>`.
  Labels missing from the repo are created once by the publisher, from this fixed list only.
- **Pace:** one write at a time, at least two seconds apart, at most 10 new issues an hour and 30 a day. Above that,
  posts wait for the next tick. A rate-limit answer stops the tick until `retry-after`, or for a minute.
- **One at a time per fingerprint:** a finding whose fingerprint is being posted waits. That rules out a race between
  two findings of one problem.
- **Unsure posts stay unsure.** They are never posted twice. They are reconciled from the repo's own issues, as
  today.
- **Other machines' findings:** each machine's service publishes its own record, with its own public check. Both
  machines file to the same repo, so the fingerprint is checked against the repo's open `found` issues before a
  create. A short `gh api` search by the fingerprint's hidden line (below) finds a twin from the other machine. The
  search is the repo's issues by label `found`, since a given time, read directly rather than through search,
  which can lag.
- **The fingerprint goes in the body**, hidden, beside the marker:
  `<!-- shepherdr-fingerprint ready/reviewed-head-refused -->`. That is how either machine finds it.

### Triage

The score is how much the finding hurts the person's day:

| Score | Meaning | Examples |
|---|---|---|
| **5** | Work stops, or a real project is at risk | the app can't be reached from the phone; installs broken; tasks can't merge; an agent near a live project's secrets; **any ban risk** |
| **4** | The loop itself stalls or lies | stalled workers; a false Needs you or alert; red main blocking installs; the serving machine filling up; wasted runs at scale |
| **3** | An agent did by hand what should be automatic | re-running a step, recovering lost work, a manual workaround |
| **2** | Looks or wording on rarely used screens | |
| **1** | An idea | |

**Tie-breakers, applied by the agent and written in `--why`:**

- On the phone: +1.
- On the serving machine: +1.
- A production project's space ranks above an MVP's, and above this repo's own test tooling.
- A 3 seen three times independently ([Fingerprints](#fingerprints)) becomes a 4. Code applies this one, since it
  is a count. It is the only score code changes.
- At most 5.

### Labels

Labels follow Phoenix's state machine. Each issue keeps its kind and score labels, plus **at most one loop-state
label**. Code changes it in one edit (remove the old label, add the new one):

```
 posted ──► found + p<score>
             │
             ├─(score ≥ threshold, not a product decision, gates open)──► fixing ──► merged: the install's `live`
             │                                                            ├─► stuck (no progress 4 h: slot freed, one alert)
             │                                                            └─► auto-failed (2nd failure: waits for the person)
             ├─(--product)──► decision ──(the person's yes)──► fixing …   (no: `later`, or closed as not planned)
             └─(score 3)──► waits: joins a running task in its area, or the weekly batch
```

`fixing`, `stuck`, `auto-failed` and `decision` are the loop-state labels. The install's own labels (`patch`, `live`,
`not-filed` and the rest, fork-patch skill) carry on as before. The loop never writes them.

### What happens by score

- **4 and 5 start a task by themselves** ([Starts](#starts)).
- **3** joins a running task in the same area when one is open. The loop's run adds it with `herdr-task reply`, as
  the shaping-a-request skill says today. Otherwise it waits for **the weekly batch**: once a week, the loop's run
  starts one task for up to five waiting 3s, the most-seen first, in one area.
- **1 and 2** wait. The weekly digest counts them. They are fixed when a task touches their screen, or when the person
  picks one.
- **A product decision never starts on its own.** The loop labels it `decision` and hands it to this space's
  Assistant (`herdr-task tell-assistant`). The Assistant asks the person one question card, between other things,
  with its recommendation first. The answer is recorded on the issue. A yes makes it a normal start, under the same
  gates.
- **A ban risk** (scored 5, `--why` naming it) starts nothing by itself. It sends the person one alert at once
  (`herdr-task alert`) and pauses the loop's schedule. The fix waits for the person's go. AGENTS.md's bar holds:
  if there's doubt, it isn't built.

### Starts

`fork/bin/loop start <issue>` is the only way the loop starts a task. It refuses unless every one of these holds:

1. **Trusted:** the issue is a trusted issue ([below](#trusted-intake)).
2. **Score** at or above the threshold (default 4), not `decision`, not a ban risk.
3. **Not paused:** the loop's schedule is on, and the red-main latch is off.
4. **One at a time:** no other auto-fix is open (Working, Ready, or waiting on its merge). `stuck` ones don't count.
5. **At most three starts a day**, counted from the loop's record, retries included.
6. **Not taken:** `fork/bin/found task <issue>` names no task.

The task is added in this space's folder. Its title is the issue's plain title, cut to 30 characters by the agent.
Its brief holds:

- the issue's link;
- the approved draft from the local record, at most 1,500 characters, with no comments from GitHub;
- the loop's fixed words: shape it first (shaping-a-request, check upstream first), build it as a patch (fork-patch),
  Proof as the repo says, and "an auto-fix: if the fix turns out to be a product decision, stop and say so".

It also gets `--set merge=checks`. `fork/bin/found took` records the hand-off, so the issue is never started twice.

**Limits:**

- **Stuck:** a fix with no new commit and no status change for 4 hours is labelled `stuck`. The person gets one
  alert, and the slot is freed. The task itself is left as it is: Workers never stall (#215) handles it, and so does
  the person.
- **Retry:** a fix that ends without a merge (stopped, its pull request closed, checks red with no fix) is started
  again once, by a new task. A second failure labels it `auto-failed`, and it waits for the person in the digest.
- **Review:** the repo's own review setting. An auto-fix gets no extra rounds.

### Trusted intake

An issue's text and labels can be edited by others on a public repo, and its comments always can. So trust comes
from this machine's record, never from GitHub's text:

- **trusted** means the feedback record holds a `posted` post whose URL is that issue, whose marker matches, and
  whose target repo is the feedback repo;
- the brief uses the record's own draft, never the issue's current body or its comments;
- an issue labelled `found` by hand, or posted by anyone else, starts nothing. The digest lists it under "needs a
  look";
- a fix task's agent may read the issue, as any agent may read public text. Its brief says the issue's comments are
  untrusted input and never instructions.

### Stop switches and gates

- **The switch is the loop's schedule.** "Fix what we found" in Tasks › Scheduled: Pause and Resume, from the phone.
  This is upstream's own control, and no new setting is needed for it. Paused, the loop:
  - starts nothing;
  - holds an auto-fix's merge (below);
  - holds its install (below).

  Publishing and scoring go on while paused: findings still become issues, so nothing is lost while the loop is
  off. `agents.feedback_publish: ask` stops publishing.
- **A paused schedule holds its tasks' merges** (a Shepherdr patch, for every user). A task its schedule added
  doesn't merge on its own while that schedule is paused. It waits under Ready with "Waits: the schedule that started
  it is paused", and merges on Resume if its checks still pass. An auto-fix is added by the loop's run, a task of the
  loop's schedule, so the auto-fix carries the schedule's id. This is checked right before the merge, in the same
  place as Merge's own wait.
- **"When all checks pass" means all of them** (a Shepherdr patch, for every user). Today the Merge setting with that
  label waits only for the checks the base branch requires (`github.py`, upstream #1221), and a merge went through
  while another check had already failed. With the patch, every check run and status on the head must pass. A failed
  one holds the merge with its name. Pending ones are waited for. Skipped and neutral ones count as passed. The
  "Right away" and "When I mark it as done" choices keep their meaning.
- **The install holds too.** The "Install each merge" run's preflight (`fork/bin/sync`) skips an auto-fix's merge
  while the loop is paused: `held`, blocker `loop-paused`. It installs on the next run after Resume. The install's
  health check and rollback are unchanged.
- **Red main latches the switch.** Each run of the loop reads main's newest check result, in one conditional call.
  - **Red:** routine starts stop, and the loop starts **one recovery task** ("Main's checks are failing"), under the
    same gates except the score.
  - **Still red** when that task ends, or red again within a day: the loop pauses its own schedule (`herdr-task auto
    pause`), records why, and sends one alert. The person's Resume clears the latch.
  - **The score 5 exception:** in Google's error-budget words, only P0 and security fixes go on while over budget.
    So while main is red, only a 5 may start, and only as the recovery task.

### The loop's schedule

"Fix what we found", in this space. It runs every hour, with a check first (the schedule check from "Fewer agent
runs", #229: `--check`). `fork/bin/loop due` exits 0, so an agent starts, only when there is work for one:

- a trusted issue at or above the threshold, not started, with the gates open;
- a decision not yet handed to the Assistant;
- a weekly batch due;
- main red with no recovery tried;
- findings a day old with no draft.

Otherwise it exits 1: no task and no agent. With `--fold`, what comes up during a run becomes one run after it. The
run's agent does the judgement: it shapes each task's brief and checks upstream first. Then it calls `fork/bin/loop
start` and the other subcommands, which do the checking. It ends with `herdr-task ready --nothing`, or `--told` when
it has something to say.

### The person's view

**What the person gets in every option:** the old Feedback page leaves the UI, and one plain digest arrives a week.

- **The Feedback page goes.** The `feedback` plugin is switched off in Settings › Plugins
  (`everywhere.plugins_off`, in the person's settings file). That plugin is untouched otherwise.
- **The sidebar's Feedback row follows that switch.** With the plugin off, the row isn't there. Today it falls back
  to the old Feedback box. This is one line in `web/src/list.tsx`, and docs/plugins.md's "Off means" for feedback
  becomes "No Feedback row; your agents' reports are still kept".
- **The weekly digest.** One plain message in this space's chat, on the person's chosen day, in this order:
  - what got fixed and is live;
  - what is being fixed now;
  - what waits, by score, with the top three titles;
  - what's paused, and why;
  - what needs the person: decisions, notes that couldn't be made public, `auto-failed` issues.

  No issue numbers, labels or keys: each item is named by its plain title, its link after. It is sent by a weekly
  schedule, "Weekly digest", whose run says it with `ready --told`. Its words come from `fork/bin/loop digest`, fixed
  words over the issue titles, so the run only passes them on.

**Open for the person: is there also a page?** The person asked for one: a Settings section, a pane and a Pause
command, as a plugin of our own called "Autopilot". The research found three things against that name and some
against the page. Options, in the order recommended:

| Option | What the person would notice | Cost | Fit with upstream |
|---|---|---|---|
| **A. Schedules only (recommended to start)** | The switch is "Fix what we found" in Tasks › Scheduled (Pause, Resume). The fixes show where tasks always do: Working, Ready and Needs you. Decisions come as question cards. The digest sums up the week. | Nothing new to build or carry. | Upstream's way since 3.2: "A repeating schedule does that now". |
| **B. A page of our own, as a plugin** | A Settings section: on or paused (with why, and Resume), auto-fix from score, starts a day, digest day. A page in the middle column on a computer, or the whole screen on a phone: Now fixing, Needs your decision, Waiting by score, Recently live, Paused and why. A Pause or Resume command in ⌘K, and the sidebar's foot row with a quiet status. Patterns: Renovate's Dependency Dashboard, GitHub Actions' "Disable workflow", Linear's Triage, Vercel's paused deployments, iOS settings for the switch. | The largest: `web/plugins/<name>/`, `service/<name>.ts`, one new Registry place for the list's foot row (`kernel.ts`, `list.tsx`), settings keys, tests and proofs. Carried across every release. | A plugin in its own files, as docs/plugins.md says. It brings back by another name the feature upstream removed. |
| **C. A then B** | A now. B only if a few weeks of digests show the person wants to look more often. | A's now, B's later. | As A, then as B. |

**If B, not under the name "Autopilot":**

- upstream used it for the feature it removed;
- its settings key `autopilot` is ignored from 3.2 on, so old files still carry it and it can't be ours;
- upstream's Assistant is told never to say "Autopilot" to the person.

A plain name says what it holds: **"Fixes"** (Now fixing, Needs you, Waiting, Live). Its settings would sit under
`everywhere.fixes`. Recommended: **C**, the person's call.

## Data: nothing lost by mistake

- **The backup, done first** (28 Nov): both machines' feedback records and install lists, this machine's handoff
  record, and every issue and pull request on dmalis/shepherdr (bodies, labels, states, comments), as JSON. They are
  in this space's private folder (`.private/issue-loop-backup-2026-11-28/`, git-ignored, owner-only). They stay until
  the reconciliation's counts add up and the person has seen them.
- **Every row gets an outcome, and a dry run comes first.** Each of the 135 rows becomes one of:
  - **filed:** shaped and posted as a new issue;
  - **linked:** to an existing issue, or to the merged pull request that fixed it. The 20 already filed are linked;
    so are those today's merges fixed (rate limit, screenshots, install messages, false Checks failing, temp folders,
    Needs you, Workers never stall);
  - **dropped:** with a private reason: duplicate of another row (named), irrelevant, or obsolete under the closed
    loop (only upstream's business).

  The dry run is a private table (`.private/issue-loop-reconcile.md`): row, machine, outcome, target, reason. Its
  counts must add up to 135, per machine and in total, before anything is applied.
- **Dropped is a decision, not a deletion.** A dropped row gets `decision: declined` with `why: "dropped: <reason>"`,
  in its own machine's record. The row stays, and a later report of it finds its history. Nothing is removed from any
  record by this work.
- **Applied at the publisher's pace.** Filed rows are shaped (fingerprints first, so duplicates fold), then posted
  through the publisher, 10 an hour at most. The table is updated with each outcome.
- **Consolidating the open issues** on dmalis/shepherdr comes after the task "Our own path" merges (it closes issues
  whose fix is live and drops the upstream labels). It works on what's left:
  - duplicates are closed as duplicate of the one kept (GitHub's "duplicate" reason), with a comment linking it;
  - the kept issue gets a line listing what it absorbed;
  - no issue's earlier decisions or links are edited away.

  Dry run first, as above.

## Shepherdr or our fork

| Part | Where | Why |
|---|---|---|
| The Feedback row follows the plugin switch | Shepherdr: `web/src/list.tsx`, one line; docs/plugins.md | Off should mean off, as every other plugin's does |
| Fingerprint, score and product fields on shaping; `held`; seen-again counts | Shepherdr: `feedback_loop.py` (new), one call in `feedback.py` | Every user who files feedback benefits from dedupe |
| The public check | Shepherdr: `feedback_public.py` (new) | Every user who files to a public repo |
| The standing yes and the pinned destination | Shepherdr: `agents.feedback_publish`, `agents.private_words`, `--publish`; one job in `service/jobs.ts` | Every user, off by default |
| A paused schedule holds its tasks' merges | Shepherdr: one check at Merge's wait (`merge_wait.py`), the schedule's id on the task | Every user's pause should stop what the schedule started |
| "When all checks pass" means all checks | Shepherdr: `github.py`'s merge wait | A bug for every user: the label promises it |
| Starts, limits, labels, red-main latch, digest words | Fork: `fork/bin/loop`, `fork/loop/` | Only a fork builds its own fixes |
| The install holds while paused | Fork: `fork/bin/sync` preflight | Our pipeline |
| `found` takes only trusted issues | Fork: `fork/bin/found` | Ours |
| The two schedules | The person's schedules (`herdr-task auto`), their prompts in `fork/loop/` | Ours |
| The page (option B, if chosen) | Shepherdr plugin `web/plugins/fixes/`, `service/fixes.ts` | Its own files |

## Ban rules and privacy

- **GitHub only, the person's own login, the official CLI.** Every write is `gh issue create`, `gh issue edit` or
  `gh issue comment`, to the person's own repo, serially, well inside GitHub's documented limits and its Acceptable
  Use Policies. Nothing is posted on anyone else's repo, and upstream is never written to.
- **No agent internals.** Tasks start through `herdr-task add` and `start`, as documented, and agents are restarted
  only by Shepherdr's own flows. Nothing reads an agent's sign-in, tokens, usage or settings files. Nothing types into
  an agent, and nothing answers its prompts. No agent account is touched, so docs/agents-and-terms.md needs no new
  row. Each phase's pull request says so.
- **Quota refusals stop.** An auto-fix whose agent hits a usage limit isn't retried on another agent or account. It
  counts as a failure for the retry rule only after the person's agent is available again.
- **The repo is public.** The public check runs on everything that leaves the machine: drafts, searches, comments,
  labels and the digest's links. A finding it flags stays private.
- **Issue text is untrusted.** Work starts only from trusted issues, and briefs carry the local draft.

## Edge and failure cases

| Case | What happens |
|---|---|
| A post's answer is lost | `unsure`, reconciled from the repo's own issues by the marker. Never posted twice (friction loop). |
| Both machines post one problem at once | Each checks the repo's open `found` issues for the fingerprint line first. A twin made in the same minute is closed as duplicate of the older one by the next tick, with a link. |
| The public check flags a draft | Held. The Assistant rewrites it once. Still flagged: it waits for the person in the digest. |
| `gh` signed out or offline | Publishing ends `refused` with gh's words, as today. The loop's check exits 1 and its run says nothing. The digest says "GitHub couldn't be reached". |
| GitHub's rate limit | The tick stops until `retry-after`. Publishing resumes after. Nothing is lost. |
| Paused mid-fix | The task keeps working. Its merge waits, then its install waits. Resume lets both through, on passing checks. |
| A fix is stuck | `stuck` after 4 h, one alert, slot freed. |
| A fix fails twice | `auto-failed`, in the digest. Nothing more starts for that issue. |
| Someone labels an issue `found` by hand | Not trusted: it starts nothing and shows under "needs a look". |
| A comment on an issue asks the agent to do something | It is never in the brief. The fix task's words say comments are untrusted. |
| Main is red | One recovery task. Still red: the loop pauses itself, with one alert. |
| A product decision is unanswered | It stays `decision`. The digest lists it each week. It never starts on its own. |
| The same problem after its fix is live | A new "Came back" issue linking the old one, scored one higher. |
| The record is unreadable | Kept aside, as the friction loop does. The publisher stops and the digest says so. |
| A finding comes from a space with Feedback offers off | Not recorded, as today. |

## Build plan

Each phase is one task, added `--after` the one before, and one pull request: `Part of #235`. Each Shepherdr part
registers `fork/patches/235.json`, with its test classes. Each phase starts with the "check upstream first" rule.

1. **The spec** (this). Already done with it: the backup.
2. **The view, part one.**
   - The `feedback` plugin is switched off in the person's settings file.
   - The sidebar row follows the switch (`web/src/list.tsx`, docs/plugins.md, a test in
     `web/plugins/feedback/feedback.test.tsx` that the row is gone with the plugin off).
   - The "Weekly digest" schedule: at first an agent's run reads the issues' labels; `fork/bin/loop digest` takes over
     in phase 6.

   UI work: docs/design.md and the UI skills, proofs at 390 px and desktop, light and dark.
3. **Reconcile and consolidate.** The dry-run table for the 135 rows, then the open issues, after "Our own path". Then
   apply, counts reconciled. The 115 unfiled rows are shaped here. They are posted only once phase 4's publisher is
   on, at its pace.
4. **Publishing on, starts still off.**
   - `feedback_public.py`;
   - `feedback_loop.py` (fingerprints, score fields, `held`, seen again);
   - `--publish` with `agents.feedback_publish` and the pinned destination, plus its service job;
   - `fork/bin/found` taking only trusted issues.

   Tests: retries never post twice; one fingerprint makes one issue, across two stores; a came-back issue; the public
   check's every kind; the pace caps; a flagged draft never leaves; the default repo is never auto-posted to.
5. **Triage in preview, a day.** Scores and labels on posted issues. `fork/bin/loop` runs with `--preview`: every gate
   evaluated and written to its record and the digest, nothing started. Then the "Fix what we found" schedule, paused.
6. **Gates, then starts on.**
   - The paused-schedule merge hold and the all-checks merge gate (Shepherdr patches, tests in `test_herdr_task.py`
     classes);
   - the install hold (`fork/bin/sync`, its tests);
   - the red-main latch;
   - `fork/bin/loop start` with every limit;
   - `fork/bin/loop digest`.

   Each gate is proven on a throwaway store before the schedule is resumed. The schedule check from "Fewer agent
   runs" must have merged.
7. **The words.** FORK.md ("Every friction is a candidate fix", "Every piece of work is recorded on GitHub"), the
   shaping-a-request skill's "Filing and the handoff", the fork-patch skill's record, the upstream-sync skill's step 7
   and the agents' feedback instructions say the new loop. Written with the writing-for-agents skill.
8. **The page, only if the person picks B or C** ([The person's view](#the-persons-view)).

## Not in this spec

- Posting anywhere but our own repo; anything upstream.
- An agent reading logs or terminals to find problems by itself: reports stay the agents' own words.
- Assignees, milestones or votes: one person, one list.
- Changing upstream's templates.
