# Needs you, v2: the shared design every Needs you part builds from

This replaces the first design. It came from three Codex rounds (gpt-6.2-sol, high) against the code, the research and the person's words, and the person said: "implement the best one, even if totally different from how Shepherdr works now. All the Needs you issues are super important to work together, coherent and consistent." It must fit every Shepherdr user, not only this person. Part 5 commits this file as `fork/specs/needs-you.md`.

## The need, in the person's words

1. "I get numerous notifications for almost anything." 2. "I can't click a notification to get to what needs me directly." 3. "Sidebars nor task list don't always show needs me." 4. "Need ME or need ASSISTANT is different: the Assistant can answer by itself, but when it can't it needs to actually need me and I get a notification." Also: "me being near the loop while the Assistant is answering for me, otherwise it needs to ping me", and "Your need me is not mine to see until it's mine."

## The model

**Needs you means the person has a next action.** One open action is one record with a stable id (keyed by the source core's identity plus the prompt id or the wait's generation, never by task ref or machine alias), an owner, a reason and an eventual outcome. One open action gives one card, one count per scope it belongs to, and one notification event.

- **Owner: you (red, notifies).** Permission, trust, sign-in, secret and terminal-only prompts (only the person may answer those, by the provider rules), plan approvals and merge approvals the person asked for, decisions only the person can make, an explicit hand-up from Shepherdr (`herdr-task alert --task` with the wait id, optional choices on the card), no Shepherdr (the space's Assistant) running or confirmed stopped, and an inferred wait still open when the hand-up time passes.
- **Owner: Shepherdr (quiet, never counted, never notifies).** Inferred waits the space's Assistant can act on within the brief: a task went quiet waiting for a reply, checks failed, a conflict, review rounds out, a recoverable error stop. Shown only in context: a quiet line on that task's row, its header and its card in that space's chat ("With Shepherdr · Investigate failed checks"). This is how the person stays near the loop without it reading as theirs. No grey count anywhere.
- **No owner (neutral):** Working, Waiting for GitHub's checks, Paused, Waiting for the brief.
- **Closing:** an accepted answer, a withdrawal, or confirmed progress past the wait closes it everywhere. Reading or dismissing an alert never closes an action. A read failure (a machine can't be reached) keeps the last known row, labelled "Can't check <machine> right now", and is reconciled before any new ping.
- **Hand-up:** a fixed deadline from when the wait was first confirmed (the "Ask me after" setting). A reply from Shepherdr, a queued send or a busy Assistant never extends it. Explicit hand-up, or Shepherdr confirmed stopped or missing (by a fresh herdr-core read, not cached data), hands up at once. A new question in the same status gets a new id (a new generation). No claims, leases or renewals.
- **Shepherdr's own words:** Shepherdr writes to the person when something becomes theirs (through `herdr-task alert --task`, which makes the card and the ping) or when something they'd want lands. Its other messages (status, merged, installed) are quiet: they never push, whatever they contain. A wait it settles gets no message.

## Words (all copy in one module, `web/shared/needs-words.ts`)

The app never says Assistant, worker or coordinator (upstream rule, `docs/develop.md` Rules): it says Shepherdr, Everything, space, task, schedule.

| Situation | Words |
|---|---|
| The person owns it | **Needs you · <what>** (e.g. "Needs you · Choose a migration plan") |
| Nothing open | **Nothing needs you** |
| Shepherdr owns it | **With Shepherdr · <what>** (e.g. "With Shepherdr · Investigate failed checks") |
| An old news line whose owner is unknown | **Waiting** |
| A machine can't be read | **Can't check <machine> right now** |
| A late tap on a closed action | **Answered** / **Task moved on** |
| No Shepherdr running in the space | **No Shepherdr chat is running here · Start it** (Needs you) |
| Neutral | **Working** / **Paused** / **Waiting for GitHub's checks** / **Waiting for the brief** |

## Places

- **Tasks › Needs you** is the one action list. Everything covers every machine and Shepherdr's own asks; a space's badge counts only that space. One action counts once even when linked to several tasks.
- **Red counts** (part 1, merged): the space's count, Everything, the Tasks icon, the app badge. One item opens its card; several open the scoped Needs you list; the space's name opens its chat.
- **Notifications** carry the action's id and open its exact card, or its outcome after it closed (cold start, warm app, late tap, another machine). Foreground toast, push and Glance share one event per action per device; a card already on screen needs none. Restart or reconnect never replays one.
- **The bell** is history only.
- **Chat news rows** (Herdr's news to the space's Assistant) render with the same words: "With Shepherdr · …" for its waits, "Needs you · …" only for the person's, "Waiting" for old lines.
- **Feedback › Found** (the friction loop) holds problems and filing decisions, quietly. Device checks and upstream decisions stay on their issue. No general Decisions inbox, no "For later" tier.

## Settings

| Setting | Choices | Default | Where |
|---|---|---|---|
| Alerts on this device | Needs you / Needs you and done / Off | Needs you (after the device opts in) | Settings › Notifications |
| Space alerts | On / Muted (inherited) | On | the space's menu and settings |
| Ask me after (`tasks.ask_after`) | Right away / 2 / 5 / 10 / 15 / 30 minutes | 5 minutes | Settings › Notifications (Everything) and a repo's own settings |

Migration: device "Needs me" → Needs you; "Everything" → Needs you and done; Off, device removals and mutes kept. Space presets: All and Needs me → On, Off → Muted. Ordinary new-message push is retired; operational alerts (memory, reboot, schedule failed) go to the bell only. "Right away" means every inferred wait goes straight to the person (for people who run no Assistant, or want it so). Quiet hours are left to the phone's Focus modes. Review, Merge, Permissions, suggestions, reactions, feedback and backup-agent settings keep their jobs; the permission picker may explain that Claude Code's Auto and Codex's Approve for me cut routine approval prompts (Shepherdr starts agents with documented flags only; never edits their config).

## Events and compatibility

Herdr's news to an Assistant: `waiting` for an inferred wait (with its reason and wait id), `working-again` when it clears. Saved schedules that trigger on `needs-you` keep firing on the same conditions (they read task status). Old URLs and old news lines keep working; new fields are added compatibly.

## Red team: failures to design out

| Failure | Fix |
|---|---|
| Push diffs reset on restart; visibility suppresses a push though no toast showed; Glance's grace swallows alerts; the bell dedupes separately | Persist one event per action; one delivery path per device; suppress only when that exact card is visible or delivery was acknowledged; the bell is passive |
| Push skips assistantFirst but counts and Glance still use task status; a queued question counts twice | Counts, rows, Glance and push eligibility all come from the same action ids; mutes and reads affect delivery and history only |
| A label outlives its wait; a new question in the same status inherits old news | Reconcile each wait against fresh source facts; new generation per question; drop queued work for superseded ids |
| A reply path reports success after only holding a send | The deadline is fixed; sends never extend it |
| Aliases and task refs merge distinct prompts; two Assistants act on the same news | Key by core identity + prompt id or wait generation; serialize wait changes at the source and recheck the assigned Assistant and generation before delivery |
| A live terminal holding a shell reads as a running Assistant; a failed lookup leaves cached data | Fresh herdr-core read for foreground; definitely stopped or missing hands up at once; unknown keeps the deadline |
| Old `needs-you` news, old clients' coarse links, schedules on `needs-you` | Old lines render "Waiting"; ownership from live records; keep old URLs and schedule predicates |

## Build order (each its own task, branch and fork issue; `Part of #<its own issue>`)

1. **News words** (task "News: not 'needs you' if mine", running): `waiting` news, shared copy, old lines render "Waiting", the chat news rows and Shepherdr's template rule.
2. **Notifications page** (part 3, running): the page, the three device choices and migration, Space alerts, retire ordinary new-message push and operational push, no withdrawal push. No bursts. Delivery keeps today's single decision function until part 5.
3. **One list** (part 5): `service/attention.ts` `projectAttention` with action ids for typed prompts, manual Ready, and Shepherdr's waits; Tasks, sidebar, badge, Glance and push eligibility all read it. Commits this design as `fork/specs/needs-you.md`.
4. **Exact links** (part 4): one target per alert on every surface including Done; closed links resolve to their outcome; one event per action per device.
5. **Wait lifecycle** (part 6a): inferred waits persisted at the source with generation, first-seen, deadline and outcome.
6. **Hand-up** (part 6b): the Ask me after setting, escalation at the deadline or at once, `herdr-task alert --task` with wait id and choices, Shepherdr's template rule for when it hands up.

## Rules for every part

- Read FORK.md, AGENTS.md ("Nothing that risks a ban", Tests, Plugins, Trying a change) and `.agents/skills/fork-patch/SKILL.md`. Register the patch in its own file, `fork/patches/<issue>.json`.
- Provider prompts (Claude Code's and Codex's permission, trust and sign-in prompts) are only ever answered by the person; nothing in Shepherdr answers or drives them.
- All UI work uses the UI skills: frontend-design:frontend-design plus the fitting better-* skills, mobile-ios-design, and web-design-guidelines as a review pass; motion follows the Motion setting and prefers-reduced-motion.
- Proof: the demo, 390 px and desktop, light and dark, for any UI. Run only the tests for what you touched. Never touch the live install, service or task store. The repo is public: made-up names only.

## As built: part 5, one list

- The rule lives in `web/shared/attention.ts` (`projectAttention`), shared by the page and the service; `service/attention.ts` stamps it on each snapshot (`snapshot.attention`, and `task.action`, each task's lead action) before push, Glance and the badge read it.
- Action ids: `need:<chat>:<prompt id>`, `hands:<task>`, `review:<task>:<since>`, `alert:<alert id>`, `wait:<task>:<since>`, `chat:<space>`. The snapshot carries no core identity yet, so ids use the machine-qualified chat and task ids (two machines with the same task ref stay two); part 6a swaps `<since>` for the wait's persisted generation.
- Owner you: typed prompts and cards, a step for the person's hands, Ready for review, a standing hand-up (`herdr-task alert --task`), a space's own Shepherdr asking, and a Shepherdr wait in a space where no Shepherdr chat runs (read fresh: stopped, or none started). A task under Needs you that says nothing of whose it is stays the person's, as before.
- Owner Shepherdr: herdr-task's inferred waits (`assistantFirst`) and error or limit stops. Quiet: "With Shepherdr · …" on the row, header and stop card, under Working; never counted or pushed.
- Paused (stopped by the person) has no owner: under Working, never counted.
- A machine that can't be read keeps its rows and actions as last read (`service/model.ts` keeps its rows, `service/attention.ts` its actions), labelled "Can't check <machine> right now". They send nothing new. When it is read again, an alert first seen while it was away goes out once; one already sent does not go again.
- Voice calls say only the person's fresh actions (`service/voice-hear.ts`). Kept ones stay listed but unsaid, so one said before a machine dropped out isn't said again; Glance keeps a device's seen marks the same way.
- Left for part 6a: a machine the list says is back while its task list still can't be read shows its last rows as fresh until the next read (as before this part). Part 6a's read-generation marks fix it.
- Left for part 6a: ids keyed by the source core's identity. Today, moving the serving role to another machine renames that machine's chat and task ids, so its open actions look new once.
- Left for later: a folded machine header sums its spaces' counts, so a task shared by two of its spaces through `also` counts twice there.
- Not in part 5: the Ask me after deadline. An inferred wait hands up only by an explicit alert or no Shepherdr running, until parts 6a and 6b persist first-seen times and add the deadline.

## As built: part 6a, wait lifecycle

- **Kept where it happens.** herdr-task keeps each inferred wait on its task as `wait` (`mods/tasks/bin/herdr_task/wait_record.py`), written only by the news pass, inside the tick lock and the task list's own lock, so changes to a wait never race. Its fields: `id` (16 hex, minted there), `gen` (the task's waits counted), `kind` (reply, attention, stopped), `why`, `mark`, `first` (first confirmed), `deadline` (`first` + Ask me after), `outcome` once it closed, and `prev` (the wait before it and how that ended).
- **Inferred** means herdr-task's Needs you of kind reply (a quiet agent, rounds out), attention (checks, a conflict, a failed merge) or stopped (an error, a limit, its agent gone), never a prompt on the agent's own screen (asks) and never the person's Stop.
- **A new question is a new wait.** Its mark says which question it is: reply, its question's own words (so the same question asked again after a reply from Shepherdr is the same wait), and with only the stock "Waits for your reply", when someone last wrote to its agent (its session log, so a herdr-core restart keeps it; else its terminal and turn); attention, when Herdr found the problem; stopped, when it stopped. A new mark while the task still reads Needs you is a new generation with a new id, first and deadline, told to Shepherdr again as `waiting` news; nothing carries over. Back with the same mark within a minute (a status flicker) or before its deadline (a reply that didn't settle it) is the same wait, its first and deadline kept.
- **Closing:** confirmed progress (`moved-on`), a prompt only the person may answer (`person`), the person's Stop (`paused`), the task done, archived or removed (`gone`), or replaced by a new question (`prev.how` is `replaced`). Only a fresh herdr-core read closes or replaces one: when herdr-core can't be asked about a task, its record, its fields and its queued news stay as they were, and its news waits for a pass that reads it.
- **Ask me after** is read from `tasks.ask_after` (minutes, or `now`/0 for right away), 5 minutes when unset; part 6b adds its row in Settings and the hand-up at the deadline. A restart of herdr-task, the scheduler or the service keeps `first` and `deadline`, and a reply from Shepherdr or a held send never moves them.
- **News:** `waiting` and `failed` lines carry `wait="<id>"`. A queued line whose wait was replaced or closed goes unsaid, and so does a line about a replaced wait still queued for the home Assistant's overview (`home.py`).
- **The service** passes the record on as `task.wait` (`service/wait-record.ts`) only while it is open and of the kind the service reads now, and `projectAttention` keys the action `wait:<id>`, with `since` = `first`, `gen` and `deadline`. A task list that keeps records says so (`wait_records: 1`): there a wait the service sees before the tick wrote its record stays Shepherdr's and quiet (`waitPending`) until the record lands, so it is told once, under the id that lasts. A source that keeps no records (an older herdr-task on another machine) keeps the old key `wait:<task>:<since>`.
- **A machine that can't be read** keeps its last rows, records and all, so its wait keeps its id while it is away and comes back as the same action: nothing is sent again.
- **A machine back on the list** reads as connecting until its task list is read (`service/model.ts`), so its last rows stay "Can't check" and send nothing on old facts.
- Left for later: core-identity keys for the other action kinds (`need:`, `review:`, `hands:`): only waits are keyed by an id minted at the source.

## As built: part 6b, hand-up

- **Ask me after** (`tasks.ask_after`, minutes): Right away (0), 2, 5, 10, 15, 30; 5 when unset (`web/shared/ask-after.ts`). Everything's row is on Settings › Notifications, under the device's choice. A repo's own row is on its Tasks page, with Same as Everything or Set here · Reset (`web/plugins/alerts/ask-after.tsx`; `setConfig` takes only the row's choices). herdr-task reads it when it records a wait, so a change applies to waits from then on. Right away writes `deadline == first`: the wait is the person's as soon as its record lands, and quiet only for the moment before that (`waitPending`, at most `PENDING_MAX_MS`, 2 minutes: a record that never lands, its scheduler stopped, then hands it up as a deadline passed).
- **When a wait is the person's** (`projectAttention`, the one rule):
  - its hand-up stands (`up: 'asked'`);
  - a fresh read says no Shepherdr chat runs in its space, stopped or none (`'no-shepherdr'`);
  - its deadline passed with the wait still open (`'deadline'`). The deadline is fixed when the wait was first confirmed: a reply, a held send or a busy Shepherdr never moves it.
  - A machine that can't be read hands nothing up; its last read stands.
- **The service wakes at the next deadline** (`service/attention.ts wakeForHandUp`): one timer at the earliest deadline of a wait Shepherdr holds, which reads those tasks' machines again and then rebuilds the snapshot (a wait closed there meanwhile, archived or moved on, is not handed up on an old read). A deadline that passed just after the snapshot was worked out still wakes it. So the wait turns red, and its one alert goes, at its time and not at the next unrelated change.
- **A wait escalates once** (`service/alert-ledger.ts`, `alerted`): each wait action that reached the person is kept a week, so it never pushes again under any key: its question's lead task done, its tasks in another order, Shepherdr back after a no-Shepherdr escalation and then its deadline, a restart.
- **The hand-up** (`herdr-task alert "<the ask>" --task <task> --wait <id> [--choice "<a>" ...]`, `mods/tasks/bin/herdr_task/hand_up.py`): it writes `wait.up = {at, what, why?, choices?, lead, alert}` on each named task's open wait, inside that task list's lock.
  - `--wait` names the wait the Assistant saw (news `wait="…"`, one per task). A wait that is over or was replaced is late: nothing is written, labelled or sent.
  - Every named task is found and its wait read before anything is written, so a name that fits nothing writes nothing. The lead is the one a hand-up of them already has, else the smallest wait id: the same whatever order the tasks are named in, or by whom.
  - A second hand-up of the same wait keeps its `lead`, `at` and `alert`: the same action, no new label, no second alert (`"again": true`). A deadline escalation followed by a hand-up keeps the same action id too.
  - `--settled [--wait <id>]` takes it back (`up.settled`): the wait is Shepherdr's again, and quiet; its deadline no longer hands it up. With `--wait` (the wait's id or its question's lead) only while it is that question: an old card never settles a newer one. A hand-up of an answered wait is late: it never opens again.
  - The label it still sets (`herdr.alert`, with `waits`) is history only: the bell keeps it, push and the counts skip it, and its wait's action is the one.
- **One question over several tasks** shares its lead wait: one action (`wait:<lead>`, `tasks` lists what it holds), one card and one alert. Each task it holds shows under Needs you and counts once, so the list still lists what the count says (`yours()` gives one entry a task; only the lead's carries the need, so the alert and Glance's alerting row are the lead's alone). The alert names the first task, and its body names the others.
- **Its card** (`web/plugins/alerts/hand-up.tsx`, `handup:<lead>`), in each task it holds, built like a question card:
  - "Needs you · <the ask>", its line of why, "Also holds <task>";
  - its choices as chips. A choice is sent to Shepherdr's chat as the person's own reply about that task (the reply tag line first), then the hand-up is taken back on every task it holds, each on its own machine (`task-handup-settled` with the lead). Its send id is fixed for that answer to that question, so a second tap after a lost reply finds the first send (`send-state`) and never sends again. An answer that waits its turn (Shepherdr asks something now) is not taken back by the card: Shepherdr takes it back once it has it;
  - "Answer in chat" puts the reply chip in Shepherdr's chat.
  - Its alert's Reply goes to Shepherdr's chat too.
- **Alert producers audited:**
  - a task's agent's alert, one naming a task, a helper's (a sign-in) and the provider ones still reach the person;
  - an Assistant's own alert about no task stays in the bell: only a hand-up pings for Shepherdr;
  - need, review, stopped-wait and machine alerts are unchanged.
  - Provider prompts never pass through Shepherdr: they stay the person's own, and nothing answers them.
- **Shepherdr's rule** (`templates/assistant.md`):
  - it hands up only what only the person can decide, as a one-line ask naming the decision, with choices when the answers are clear;
  - it doesn't repeat the question in chat, never alerts for a wait the deadline or no-Shepherdr already hands up, and never alerts for a prompt that is already the person's;
  - it takes a hand-up back once answered. Its other messages stay quiet.
- Left for later: the card's words for a wait whose deadline passed (it shows as red with its agent's words, without a card of its own); Undo on a choice sent.

## As built: Shepherdr's asks in plain words, and idle spaces (#416)

- **Why:** a space's Shepherdr ended its turn on "the next step is your call" with reply bubbles, in plain words, not a card. Nothing counted it, and with nothing running the person read it as work stopped.
- **Prevent:** every Shepherdr chat's settings note has a row, "Asking the person" (`mods/tasks/bin/herdr_task/asking.py`, as urgent.py's row): wait on the person with the question tool, optional choices too, never only in plain words. `templates/assistant.md` stays upstream's.
- **A plain ask is the person's** (owner you, kind `chat`, id `chat:<space>`, `plain: true`; `web/shared/plain-ask.ts` asksYou). The service reads each Shepherdr chat whose turn ended once a turn, from its own log (`service/plain-ask.ts`), and keeps its newest words on the space as `asks`, with the turn read. It counts while:
  - Shepherdr's turn has ended (running, not at work, not at a prompt), and its words are the chat's newest turn's, with nothing from the person after them;
  - and they close on a direct question with its answers offered (two or more bubbles, or none with suggested replies off), or offer two or more choices while nothing runs in the space (no task there Working, merging or queued).
  - Bubbles alone never count, nor one bubble on "Anything else?", nor choices offered while work runs.
- **Quiet in delivery:** counted everywhere (the space, Everything, the Tasks icon, the badge, Glance) and listed as "#space asks you" with its question, but never pushed: it is read off words, and the message already reached the bell. A question card or a stopped Shepherdr is the one action, as before.
- **Until answered:** it clears when the person writes (Shepherdr's next turn reads again), not when the chat is read, as GitHub keeps a review request until you act on it.
- **Idle** (`spaceIdle`): a space with nothing running and tasks Up next of its own shows a grey "Idle" on its row (its count in the spoken label), and only while it has no red count. Never counted, never pushed.
- Left for later: open work outside tasks (a repo's GitHub issues) doesn't make a space idle; Shepherdr starting work within its remit on its own.
