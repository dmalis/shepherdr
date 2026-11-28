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
