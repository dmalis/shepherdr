# Urgent tasks

Part of #119. The spec for one mark on a Shepherdr task, **Urgent**: what it means, who sets it, what it changes and
what it never changes, how it shows, and how it fits the Needs you design (`fork/specs/needs-you.md` once its part 5
commits it). It is built for every Shepherdr user. The building tasks follow it, one per slice
([Build plan](#build-plan)).

## The need

The person: "Let's check about urgent tasks, whether there is such a thing, and if not we need a way to mark it
urgent and decide what this means actually."

Shepherdr 3.2 has no such thing. Every open task looks and behaves the same. Its row sits where it happens to fall,
its news reaches Shepherdr in the order it settles, and nothing tells Shepherdr which one to handle first. When one
fix can't wait (a broken checkout, a release blocker), the person watches it by hand and says so again in each chat.

The need behind the ask: **"this one first, and don't make me chase it."** The cost of delay on this task is high
and immediate (Kanban's definition of the expedite class, below). It does not mean "this one with fewer checks".

## Words

| Word | Meaning |
|---|---|
| **urgent** | A task the person marked so. One flag: a task is urgent or it isn't. No levels. |
| **the mark** | How an urgent task shows: one small icon, and the word "Urgent" where there's room. |
| **open task** | To do, queued, scheduled, working or ready. Done and archived tasks are never urgent. |
| **Needs you**, **With Shepherdr**, **hand-up**, **Ask me after** | As the Needs you design defines them: Needs you is the person's next action (red, notifies); With Shepherdr is a wait Shepherdr can settle (quiet); the hand-up passes a wait to the person at its deadline. |

The app never says Assistant, worker or coordinator (docs/develop.md, Rules). It says Shepherdr, task, space.

## Research

### Upstream first

- **Shepherdr has no task priority or urgency.** `urgent` in `service/glance.ts` means "what notifies" in the
  phone feed; `machine.low_priority` is the CPU priority of agents; Codex's `priority` tier and Claude Code's fast
  mode are speeds. None of these says which task matters.
- **Upstream issue 1193 and its pull request 1196** proposed P0 Urgent to P4 Backlog flags, a sort, and colour
  settings: about 28 files, both closed by their author unmerged, with no maintainer comment.
- **Upstream issue 1195** asked for queue jump and start order. The maintainer: "since 3.2.0 tasks start as soon as
  they're asked, so start order no longer applies. We're leaving queue jump and queue position out to keep Shepherdr
  small." The code agrees: `tick.py` (~555) samples the machine's start limits once per pass and starts every
  startable queued task in that pass, so a place in the queue changes nothing.
- **Upstream main since v3.2.22** (68be7817): nothing on priority or urgency (`git log -i --grep 'urgent|priorit'`).
- So we build our own, shaped by the maintainer's reasoning: one flag, a handful of files, nothing that reorders
  starts or merges.

### Industry practice

| Product | What urgent changes | What it never changes, or its guard | What we take |
|---|---|---|---|
| **Linear** ([issue properties](https://linear.app/docs/issue-property), [notifications](https://linear.app/docs/notifications), [SLAs](https://linear.app/changelog/2023-03-16-slas)) | Urgent sorts first (no priority sorts last); marking an issue Urgent notifies its assignee; the default SLA rule is "Urgent: 24 hours". | No overuse guard; levels are fixed. | Sorts first. The notification goes to the one who acts: here that is Shepherdr, the one who acts first, not the person who set the mark. |
| **Jira, Jira Service Management** ([impact × urgency](https://support.atlassian.com/jira-service-management-cloud/docs/how-do-i-create-a-matrix-using-impact-and-urgency-values/), [SLA goals](https://support.atlassian.com/jira-service-management-cloud/docs/use-priority-to-group-sla-goals)) | In plain Jira, priority is only a field. Service Management derives it from impact and urgency and ties SLA goals to it. | Priority is separate from severity. | Five levels with no distinct consequence are colour and sort only. |
| **Todoist** ([priorities](https://www.todoist.com/help/articles/set-a-priority-in-todoist-Wy82Jp)) | P1 is red, sorts first, filters across projects. | No reminder or notification change. | Same as above: levels that change nothing but colour. |
| **PagerDuty** ([urgency](https://docs.pagerduty.com/incident-management/services/configurable-service-settings), [alert fatigue](https://www.pagerduty.com/resources/digital-operations/learn/alert-fatigue/)) | Two levels only, high and low. Urgency decides the notification rules and escalation; low never escalates. | Warns that constant alerts make people miss real ones. | Binary is enough to carry real behaviour. The person's notification choices stay theirs. |
| **Kanban's expedite class of service** ([Kanban University glossary](https://kanban.university/glossary/), [classes of service](https://businessmap.io/kanban-resources/getting-started/kanban-classes-of-service)) | For work where "the impact of delay is both high and immediate": pulled first. In common practice it gets a WIP limit of one and may exceed the board's WIP limit. | The limit of one is the only real guard against "everything is urgent" we found (secondary source). | The meaning. Not the limit-breaking: Shepherdr has no WIP limit since 3.2, and its machine start limits protect the machine (a full disk), not a policy. |
| **Buildkite job priority** ([docs](https://buildkite.com/docs/pipelines/configure/workflows/job-priority.md)), **Jenkins Priority Sorter** ([plugin](https://plugins.jenkins.io/PrioritySorter)) | Reorders only what waits. | Never overrides dependencies or concurrency limits, never interrupts running work. | Urgent reorders attention, never gates. It never interrupts a running agent. |
| **GitHub merge queue jump** ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | Puts a pull request at the front of the queue. | It "will cause a full rebuild of all in-progress pull requests" and slows merges. | Left out, as upstream decided: it costs every other task. |
| **Slack** ([pause notifications](https://slack.com/help/articles/214908388)), **Microsoft Teams** (urgent messages, secondary sources) | Slack: a sender may notify through Do Not Disturb once. Teams: an urgent message notifies again every 2 minutes for 20, through Do Not Disturb; admins can turn it off. | Both are one deliberate send, not a lasting mark. | A lasting mark is no licence to interrupt. No repeats. |
| **Apple** ([interruption levels](https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel), [HIG: managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications), [web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)) | Time Sensitive breaks through Focus, "only for notifications that are relevant in the moment". | "Build trust by accurately representing the urgency of each notification." A home-screen web app has no documented interruption level, only the `Urgency` header, which Shepherdr's push already sends as `high` (`service/push.ts` ~328). | Nothing to add on iOS, and nothing that would bend Apple's rule. |
| **Android** ([channels](https://developer.android.com/develop/ui/views/notifications/channels), [full-screen intent policy](https://support.google.com/googleplay/android-developer/answer/13392821)) | A channel's importance, owned by the person once created; full-screen intents only for calls and alarms. | The person controls each channel. | The phone app keeps its own channels; nothing here asks for more. |

What goes wrong elsewhere: everything becomes urgent, and an urgent mark that interrupts trains people to ignore
it. The guards that work are few: only the person sets it, it ends with the task, and it never interrupts anyone.

### Second opinion

Two rounds with Codex (gpt-6.2-sol, high), read-only, against the code, the research and the Needs you design. See
[Second opinion](#second-opinion) at the end for what each round changed.

## The design

### What urgent means

**Urgent means "this task first": Shepherdr takes its news before any other task's, and the person finds it at the
top of the lists of what's running and waiting to start.** It says which work goes first. It never lowers the bar
the work must pass, and it never interrupts the person more.

### Who sets it

| Who | How |
|---|---|
| **The person, in the app** | A task's menu (its row's More menu, the task header's menu): **Mark as urgent** / **Mark as not urgent** (Gmail's "Mark as important" wording). The command palette lists the same row, as it lists every task menu row. |
| **Shepherdr, on the person's word** | `herdr-task add … --urgent`, `herdr-task edit <task> --urgent` / `--urgent off`, when the person says so in chat ("this one's urgent"). Never on its own judgement: that is a rule in Shepherdr's words (below), since no flag can prove who asked. |
| **A task's own agents (worker, reviewer, their helpers)** | Never. `add` and `edit` with `--urgent` are refused before any `--on` or `--detach` dispatch when the caller is a task's agent: `HERDR_BROWSER_TASK` set (the launcher sets it for a task's worker and reviewer and their children, `browsers.py` `browser_env`; Shepherdr's chat has none), or the caller's terminal labelled `herdr.task`. It guards against mistakes, not against an agent that sets out to get round it. The refusal: "Only the person marks a task urgent." |

Only an open task can be marked: a Done or archived one is refused ("Fix checkout is done: only an open task can be
urgent"). A task on another machine is marked there, through `edit`'s usual remote route; the app says it's marked
only once that machine confirms.

### What it changes

1. **First in Tasks' Working and Up next.** Inside those two groups, urgent tasks come first, in their usual order
   among themselves. Needs you keeps its own order (oldest first, the shared list in `web/shared/needs-you.ts`, which
   the sidebar's counts and the phone feed also follow); urgent joins that order only in slice 3, through the Needs
   you design's one action list, so counts, cards and links never disagree. Done and Archived keep newest first.
2. **The mark.** One icon before the title on its row, and "Urgent" in its task header (below).
3. **Shepherdr takes its news first.** Every news line about an urgent task carries `urgent="yes"` on its tag
   (`<herdr-news task="…" event="…" urgent="yes">`), read at the moment the batch goes, not when the line was
   queued. In each message to one Shepherdr, urgent tasks' lines come first. The line's text is unchanged, so the
   chat's news rows read as before (`core/chat-log.js` reads the tag's attributes one by one; a test pins that an
   extra one is ignored).
4. **Shepherdr knows what it means.** One line in Shepherdr's settings note (the "Your settings" block every
   Shepherdr chat gets at each start, resume, compaction and handoff, `assistant_settings.py`): "Urgent tasks: the
   person marks a task urgent (`urgent: true` in `herdr-task list --json`; `urgent="yes"` on its news). Handle its
   news before other tasks', and hand it to the person as soon as only they can settle it. Mark or unmark one only
   when the person asks (`herdr-task edit <id> --urgent` / `--urgent off`)." Behaviour stays words
   (docs/develop.md): the code carries the mark; Shepherdr decides what to do.

That is all: four changes, no setting, no new message to anyone.

### What it never changes

| Never | Why |
|---|---|
| **Review**: on or off, rounds, Must fix, the reviewer and its model | Skipping or shortening review on "urgent production fixes" is how outages happen. An urgent fix needs the second pair of eyes most. |
| **Merge**: the Merge setting, required checks, the destructive guard, the merge queue | GitHub's own jump rebuilds every other pull request; upstream left it out. |
| **Provider prompts**: permission, trust, sign-in | Only the person answers those (AGENTS.md: Nothing that risks a ban). |
| **The agent's model, effort or speed** | Fast mode costs extra usage credits on a subscription, and Codex's faster tiers cost more. The picker is one tap away; Shepherdr changes them only when the person asks, by restarting with documented flags, as today. |
| **The brief** | No "urgent" line for the worker: "smallest safe change" can narrow the work, and "ask sooner" brings questions Shepherdr could settle. |
| **A running agent** | Marking never sends anything to a task's agents and never restarts one. |
| **Start order and start limits** | Every startable task already starts at once (3.2); the limits protect the machine (a nearly full disk). Nothing jumps a queue, and a held urgent task waits in Up next with its reason like any other. Starting it anyway stays the person's own Start. |
| **`--after`** | An urgent task still waits for the tasks it comes after. |
| **Hand-up time (Ask me after)** | A wait's deadline is set when the wait is first confirmed and stays fixed (Needs you design); marking never changes a wait's id, owner or deadline. Someone who wants every wait at once already has "Right away". |
| **Notifications** | The device's choice (Needs you / Needs you and done / Off) and space mutes hold for urgent tasks too. Its Ready notifies on Needs you, as every Ready does; its Done on Needs you and done. No repeats, no Time Sensitive, no extra sound. |
| **Needs you, its red and its counts** | An urgent task counts only when it has an open action for the person, like any other. The mark is never red. |
| **Schedules** | A schedule has no urgent mark. One of its runs can be marked like any task; the next run starts unmarked. |

### When it ends

One rule, the same in herdr-task and the service: **a task is urgent when its `urgent` time is set, it is open, it
isn't archived, and it hasn't been done since it was marked** (`urgent > done_at`). So Done by any path (merged,
closed, Mark as done) ends it, and no path that reopens a task (reopen, resume, switch, a reply to a Done task) can
bring it back: each would have to mark it again. `urgent.py` `urgent_now(t)` and `web/shared/urgent.ts`
`isUrgent(raw)` are the only readers, tested against the same table of cases. There's no timer and no cap: only the
person sets it, so a cap would get in their way in the one hour two things really are urgent.

### How it shows

All UI follows FORK.md's "Industry standard first" and "All UI work uses the UI skills": `frontend-design`,
`better-ui`, `better-colors`, `better-accessibility`, `mobile-responsiveness`, and `web-design-guidelines` before
ready, within `web/src/ds.css`.

- **The icon:** Linear's urgent shape, an exclamation mark in a filled rounded square, 16 px, before the title on the
  row's first line. A new `urgent` icon in `web/src/icons.ts` (the bolt is taken: it means a faster speed).
- **Its colour:** the text colour (`--fg`), never `--red` (Needs you's) nor `--amber` (Working's). The shape and its
  label carry it, so colour is never the only signal, and it reads the same in light, dark and night.
- **Screen readers:** the row's name reads "Urgent, Fix checkout"; the icon itself is hidden from them.
- **The task header:** "Urgent" first in the header's facts line, with the same icon.
- **The menu rows:** Mark as urgent (with the icon) on an open task that isn't, Mark as not urgent on one that is,
  none on a Done or archived one. After a tap, the row takes its new place at once. Nothing animates, so Shepherdr's
  Motion setting and `prefers-reduced-motion` have nothing to hold back.
- **No filter, no sort menu, no count** in this spec: the order is the sort, and a filter can come later if people
  ask.
- **Phone (390 px):** the icon takes 20 px before the title; long titles cut as today.

### How it fits the Needs you design

- Needs you stays the person's next action. Urgent is not one: marking a task urgent creates no card, no count and
  no notification event, and toggling it never changes a wait's id, owner or deadline.
- Shepherdr's waits on an urgent task stay Shepherdr's, quiet, with their usual deadline. Shepherdr takes them first
  because their news says urgent and its settings note says what that means.
- What this build can't do yet: a wait that was open before the task was marked sends no new news, so Shepherdr
  learns of the mark at that task's next news, or when it lists its tasks. Slice 3 closes that once Needs you's
  action records exist (part 5, one list; part 6a, waits kept with their generation): urgent then orders Shepherdr's
  open waits and the Needs you list in that one projection.
- The words module (`web/shared/needs-words.ts`) gets nothing new: "Urgent" is a property of the task, shown by its
  mark, not a kind of wait.

### Data

| Where | Field | Notes |
|---|---|---|
| herdr-task's task record | `urgent`: when it was marked (ms); removed by `--urgent off` | Old task files have none: not urgent. Kept when a task moves to another folder or machine. |
| `herdr-task show`, `list --json` | `urgent: true` only when `urgent_now(t)` | `output.py` copies the record, so it drops the raw field and writes this one. `show` adds the line "Urgent: yes". |
| The service (`service/model.ts` reads the raw lists, `service/compat.ts` builds the web's `Task`) | `Task.urgent?: true` only when `isUrgent(raw)` | Old clients ignore it. |
| The web action | `{type: "task-urgent", chat, on: boolean}` | In `TASK_ACTS` and the chat-to-task resolution beside `task-rename` (`service/actions.ts`); `on` must be a boolean. Runs `herdr-task edit <ref> --urgent` or `--urgent off` on the task's own machine, found from the snapshot, never by ref alone. |

No settings key. Nothing people's state hangs on beyond the task field.

### Ban rules and privacy

- Nothing reads or drives an agent: no keys, no slash commands, no prompts answered, no restarts, no config files.
- Shepherdr hears of urgency only through what it already gets: one more attribute on the news it is sent, and one
  more line in the settings note its own session hook asks for. No new message, no new channel, so
  docs/agents-and-terms.md's table needs no change. Any later slice that sends Shepherdr a new kind of message
  updates that table.
- Model, effort and speed change only by the person's pick, by restarting with documented flags, as today.
- No sharing or rotating of accounts, no retry elsewhere.
- Examples in code, tests and the demo are made up ("Fix checkout", vm-a).

## Edge and failure cases

| Case | What happens |
|---|---|
| Marking a Done or archived task | Refused, with why; the menu doesn't offer it there. |
| A task's own agent runs `add` or `edit` with `--urgent` | Refused before anything is sent anywhere: "Only the person marks a task urgent." |
| The task's machine can't be reached | The action fails with the usual "Can't reach vm-a"; nothing changes on screen. |
| The reply is lost after the other machine saved it | The app doesn't claim either result: the next snapshot shows the truth, and the menu row follows it. |
| The other machine runs a herdr-task without `--urgent` | Its refusal of an unknown flag shows as "vm-a needs Shepherdr's update to mark tasks urgent". |
| Two machines with the same task key | The action names the machine from the snapshot, so it marks the right one. |
| Marked twice, or from two devices | The same result; the first time sets the time, a second leaves it. |
| Marked while its agent works | Nothing is sent to the agent; the row moves; Shepherdr sees it on the task's next news. |
| Marked while Ready | Its place in Needs you, its card and its notification are as they were. |
| Marked, done, then reopened or resumed | Not urgent: it was done after it was marked. |
| Many tasks urgent | They come first among themselves, in their usual order. Nothing else changes. |
| Shepherdr not running in the space | The news waits like any news; the order and mark still show. |
| An old client, or an old task file | No field: not urgent; nothing breaks. |

## Build plan

Each slice is its own task, branch and pull request, `Part of #119`, with its own `fork/patches/<issue>.json` (the
fork-patch skill), and checks upstream first again when it starts. Slice 2 is added `--after` slice 1. Slice 3
waits for Needs you parts 5 and 6a.

### 1. Urgent: the mark in herdr-task and Shepherdr's news

- **What:** the task field and its one rule; `add --urgent`, `edit --urgent [on|off]`; the refusals (done, archived,
  a task's own agents, checked before remote dispatch); `show` and `list --json`; the `urgent="yes"` attribute, read
  at send time, and urgent lines first in each message; the settings note's line.
- **Files:** a new `mods/tasks/bin/herdr_task/urgent.py` (the field, `urgent_now(t)`, the caller check, the note's
  words); one call site each in `cli.py` (the flag on `add` and `edit`, and the refusal before `--on`/`--detach`),
  `commands.py` (`cmd_add`, `cmd_edit`), `news.py` (the attribute in `news_line`'s tag, the batch's order),
  `output.py` (the JSON field), `assistant_settings.py` (the note's line).
- **Tests:** `test/test_herdr_task.py::Urgent` with a real throwaway store and a faked hc: mark, unmark, refusals
  (also from a fake task terminal, and before `--on`), done by each path ends it, reopen and resume don't bring it
  back, `list --json`, the attribute, the order in a batch, the note's line. A pinning test that fails if
  `news_line`'s tag shape, `browser_env`'s variable or the settings note's hook change. `core/chat-log` test: a news
  tag with an extra `urgent` attribute reads the same.
- **Demo:** none (no UI).

### 2. Urgent: in the app

- **What:** the snapshot field; the `task-urgent` action, routed to the task's machine; in the Tasks plugin, the menu
  rows, the row icon, the header word, and urgent first in Working and Up next.
- **Files:** `service/compat.ts` (one field, through `isUrgent`), `service/actions.ts` (one case and its
  `TASK_ACTS` entry), `web/shared/types.ts` (one field), a new `web/shared/urgent.ts` (`isUrgent(raw)`,
  `urgentFirst(tasks)`: a stable partition), a new `web/plugins/tasks/urgent.tsx` (the icon, the two menu rows, the
  header word), with one call each in `web/plugins/tasks/client.tsx` (the menu rows, `TaskRow`'s title, the header's
  facts, `urgentFirst` on Working and Up next where `Now` renders them); the icon in `web/src/icons.ts`; two urgent
  tasks in `web/demo/data.ts` and the action in `web/demo/serve.ts`, so the proof uses the real menu. Everything in
  the Tasks plugin: it owns the title, the facts line and both menus (docs/plugins.md), so no new Registry place and
  no second plugin.
- **Tests:** `web/shared/urgent.test.ts` (the rule's table shared with slice 1's, the order, stable ties, Needs you
  and Done untouched), `web/plugins/tasks/urgent.test.tsx` (menu rows per state, the action sent, none on Done, the
  row's accessible name, the Needs you count unchanged by a mark), a `service` test for the action's route (two
  machines, same key; a refused flag), `bunx tsc`, `bun run build`.
- **Proof:** the demo at 390 px and 1280 px, light, dark and night: Tasks with two urgent tasks first in Working, the
  menu, the header. The UI skills above named in the summary.

### 3. Urgent: first among Shepherdr's waits (after Needs you parts 5 and 6a)

- **What:** in the one action list (`service/attention.ts` `projectAttention`), urgent tasks' actions first: in the
  Needs you list, its sidebar taps and the phone feed alike, with ids, counts and deadlines unchanged. Marking a task
  urgent while one of its waits is open With Shepherdr makes that wait's news go again, once, with `urgent="yes"`
  (a new delivery of the same wait id, never a new wait). Updates docs/agents-and-terms.md if that resend is a new
  kind of message.
- **Files and tests:** named when parts 5 and 6a have merged, in that part's own shapes.

### Not in this spec

- The Herdr window's own Tasks panel (`mods/tasks`): a later slice once the web one is tried.
- A mark on the phone feed's task items (`service/glance.ts`; its own `urgent` field means "what notifies", so the
  mark would need another name), if the phone app asks for it.
- A Tasks filter for urgent ones.
- Voice ("mark this urgent"), through `service/voice-tools.ts`, once slice 2 is in.

## Second opinion

Codex, gpt-6.2-sol at high effort, read-only, from the repo root; a fresh session each round with the last answer
pasted in.

**Round 1** (the need and the research). My first idea gave urgent five changes: hand-up "Right away", Done
notifying on Needs you devices and through a space's mute, first in Tasks with an "Urgent" lead on its news, a held
task becoming Needs you with "Start anyway", and an "Urgent: yes" line in the worker's brief. Codex agreed on one
flag, set only by the person, ending at Done, with no cap or timer, and pushed back on the rest. What changed:

- **Shepherdr stays first.** Right away would send a failed check on urgent work to the person when that's exactly
  what Shepherdr should start fixing at once. Urgent makes Shepherdr take its waits first; the deadline stays.
- **Mutes and device choices hold.** Slack's "notify anyway" is a single deliberate send, not a lasting mark. Ready
  is already Needs you for every task.
- **A hold stays in Up next.** A hold can mean the disk is nearly full; an optional override isn't the person's next
  action. (Codex also noted that the queued Start dialog passes `--now`, which skips the tasks a task comes after as
  well as the hold. That is the dialog's stated meaning, "the person's Start is their go", so urgent leaves it be.)
- **No brief line.** "Smallest safe change" narrows scope; "ask sooner" makes questions Shepherdr could answer.

**Round 2** (red team of the first full draft against the code and the Needs you design). That draft added two
news lines (a task "was marked urgent", and "is held" once per reason), a hidden `--by you` flag from the app, a
new Registry place for the row icon, an "Urgent · " lead on news text, a sort inside `nowGroups`, and clean-up at
reopen only. What changed:

- **No new news lines, no hidden flag** (blocker and majors). A flag edit changes no status, so a "marked" line
  would compete with that task's queued news and need its own outbox identity; a "held" line would repeat each time
  a percentage moved; and `--by you` can't prove the person asked. Cut. Shepherdr learns the meaning from its
  settings note, the supported hook for its words, and the mark from an attribute read when news goes. Re-telling an
  open wait waits for slice 3, which has the wait's id to do it safely.
- **The text stays title-first.** The chat's news rows split the text after the title, so the mark rides on the tag.
- **One rule for when it ends** (major). Resume, switch and a reply reopen a task without `cmd_state`, and the
  service reads raw lists, so a clean-up at reopen would let the mark come back. "Marked after it was last done",
  in one reader per language, closes every path.
- **Remote marking named in full** (major): `TASK_ACTS`, the machine from the snapshot, an older install, a lost
  reply.
- **Needs you keeps its order** (major). Sorting inside `nowGroups` would give Tasks one Needs you order and the
  shared list (counts, the sidebar's taps, the phone feed) another. Urgent sorts only Working and Up next now, and
  Needs you in slice 3, in the one action list.
- **No new Registry place, no second plugin** (minor). The Tasks plugin owns the title and both menus; the palette
  picks up menu rows. The demo gets the action, so the proof clicks the real menu.
- **The refusal covers add too, before remote dispatch** (blocker), and the spec says plainly it guards against
  mistakes only.
