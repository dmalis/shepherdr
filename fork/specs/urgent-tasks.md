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
- **Upstream [issue 1193](https://github.com/eliasstravik/shepherdr/issues/1193) and its
  [pull request 1196](https://github.com/eliasstravik/shepherdr/pull/1196)** proposed P0 Urgent to P4 Backlog flags,
  a sort, and colour settings: about 28 files, both closed by their author unmerged, with no maintainer comment.
- **Upstream [issue 1195](https://github.com/eliasstravik/shepherdr/issues/1195)** asked for queue jump and start
  order. The maintainer: "since 3.2.0 tasks start as soon as they're asked, so start order no longer applies. We're
  leaving queue jump and queue position out to keep Shepherdr small." The code mostly agrees: `tick.py` (~547–590)
  walks each list's queued tasks by `queued_at`, samples the machine's start limits once for the run, and starts
  every task that waits for nothing. The order still decides one thing: which tasks get the run's three checks of
  tasks on other machines they come after (`budget`), so a later one may wait a pass longer. A second `herdr-task
  start` of a queued task goes past a busy machine but still after the tasks it comes after (`commands.py` ~593);
  the app's Start on a queued task passes `--now`, which skips both, as its dialog says
  (`web/plugins/tasks/client.tsx` ~251).
- **Upstream main since v3.2.22** (68be7817): nothing on priority or urgency (`git log -i --grep 'urgent|priorit'`).
- So we build our own, shaped by the maintainer's reasoning: one flag, a handful of files, nothing that reorders
  starts or merges.

### Industry practice

| Product | What urgent changes | What it never changes, or its guard | What we take |
|---|---|---|---|
| **Linear** ([issue properties](https://linear.app/docs/issue-property), [notifications](https://linear.app/docs/notifications), [SLAs](https://linear.app/docs/sla)) | Urgent sorts first (no priority sorts last); marking an issue Urgent notifies its assignee; when a workspace turns SLAs on (a paid plan), the default rules give Urgent a 24-hour SLA and High a week ([default SLAs](https://linear.app/docs/sla)). | No overuse guard; levels are fixed. | Sorts first. The notification goes to the one who acts: here that is Shepherdr, the one who acts first, not the person who set the mark. |
| **Jira, Jira Service Management** ([impact × urgency](https://support.atlassian.com/jira-service-management-cloud/docs/how-do-i-create-a-matrix-using-impact-and-urgency-values/), [SLA goals](https://support.atlassian.com/jira-service-management-cloud/docs/use-priority-to-group-sla-goals)) | In plain Jira, priority is only a field. Service Management derives it from impact and urgency and ties SLA goals to it. | Priority is separate from severity. | Five levels with no distinct consequence are colour and sort only. |
| **Todoist** ([priorities](https://www.todoist.com/help/articles/set-a-priority-in-todoist-Wy82Jp)) | P1 is red, sorts first, filters across projects. | No reminder or notification change. | Same as above: levels that change nothing but colour. |
| **Asana** ([My tasks](https://help.asana.com/s/article/my-tasks?language=en_US)) | Priority is a custom field a team makes; My tasks can group or sort by it, and a team's own rules can act on the field (assign or move work when it changes). | Nothing follows from it unless a team writes a rule. | The same: on its own, a field to sort by. |
| **Gmail** ([importance markers](https://support.google.com/mail/answer/186543)) | Gmail guesses importance from what you open, reply to and star, and shows a marker; a click corrects it. The person can choose to be notified only of mail marked important. | The person chooses whether importance decides their notifications. | The opposite of ours: a guess the person corrects. Ours is only ever the person's own mark; Shepherdr never guesses it. Only the wording "Mark as important" is borrowed. |
| **PagerDuty** ([urgency](https://docs.pagerduty.com/incident-management/services/configurable-service-settings), [alert fatigue](https://www.pagerduty.com/resources/digital-operations/learn/alert-fatigue/)) | Two levels only, high and low. Urgency decides the notification rules and escalation; low never escalates. | Warns that constant alerts make people miss real ones. | Binary is enough to carry real behaviour. The person's notification choices stay theirs. |
| **Opsgenie** ([alert priorities](https://support.atlassian.com/jira-service-management-cloud/docs/what-are-alert-priorities/), [update priority](https://support.atlassian.com/opsgenie/docs/update-alert-priority-level/), [notification rules](https://docs.opsgenie.com/docs/notification-rule-api)) | Five levels, P1 Critical to P5 Informational (default P3). Priority decides who is notified, how, and how fast; raising it restarts the notification flow. Each person's notification rules can filter on it. | The person's own rules decide what reaches them. | Where levels do carry behaviour, they do it through each person's own notification rules, which Shepherdr leaves to the device's choice. |
| **Kanban's expedite class of service** ([Kanban University glossary](https://kanban.university/glossary/), [classes of service](https://businessmap.io/kanban-resources/getting-started/kanban-classes-of-service)) | For work where "the impact of delay is both high and immediate": pulled first. In common practice it gets a WIP limit of one and may exceed the board's WIP limit. | The limit of one is the only real guard against "everything is urgent" we found (secondary source). | The meaning. Not the limit-breaking: Shepherdr has no WIP limit since 3.2, and its machine start limits protect the machine (a full disk), not a policy. |
| **Buildkite job priority** ([docs](https://buildkite.com/docs/pipelines/configure/workflows/job-priority.md)), **Jenkins Priority Sorter** ([plugin](https://plugins.jenkins.io/PrioritySorter)) | Reorders only what waits. | Never overrides dependencies or concurrency limits, never interrupts running work. | Urgent reorders attention, never gates. It never interrupts a running agent. |
| **GitHub merge queue jump** ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | Puts a pull request at the front of the queue. | It "will cause a full rebuild of all in-progress pull requests" and slows merges. | Left out, as upstream decided: it costs every other task. |
| **Slack** ([pause notifications](https://slack.com/help/articles/214908388)), **Microsoft Teams** ([messaging policies](https://learn.microsoft.com/en-us/microsoftteams/messaging-policies-in-teams)) | Slack: a sender may notify through Do Not Disturb once. Teams: an urgent message's priority notifications come "every 2 minutes for 20 minutes or until" it is read; admins can turn the option off for a policy, and a recipient can't turn it off for themselves. | Both are one deliberate send, not a lasting mark. | A lasting mark is no licence to interrupt. No repeats. |
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
   the sidebar's counts and the phone feed also follow), so counts, cards and links never disagree; this spec never
   reorders it. Done and Archived keep newest first.
2. **The mark.** One icon before the title on its row, and "Urgent" in its task header (below).
3. **Shepherdr takes its task news first.** A task-status news line (`news_pass`'s `<herdr-news>` lines to a space's
   Shepherdr) about an urgent task carries `urgent="yes"` on its tag (`<herdr-news task="…" event="…"
   urgent="yes">`). The flag is noted on the outbox entry when the line is queued, and read again from the task's
   record when the message goes for every list that pass has open; an entry from a list the pass didn't read (a
   folder-scoped pass) keeps what was noted. In each message to one Shepherdr, urgent tasks' lines come first. The
   line's text is unchanged, so the chat's news rows read as before (`core/chat-log.js` `newsOf` reads `task` and
   `event` by name from the tag; a test pins that an extra attribute changes nothing). Not covered: Everything's
   overview of other machines (`home.py`'s `<herdr-overview>`, which rewrites news in its own shape), GitHub news
   (`<herdr-github>`), and alerts.
4. **Shepherdr knows what it means.** One new row in Shepherdr's settings note (the "Your settings" block every
   Shepherdr chat gets at each start, resume, compaction and handoff, `assistant_settings.py` `rows`): "Urgent
   tasks: the person marks a task urgent (`urgent: true` in `herdr-task list --json`; `urgent="yes"` on its news).
   Handle its news before other tasks', and hand it to the person as soon as only they can settle it. Mark or unmark
   one only when the person asks (`herdr-task edit <id> --urgent` / `--urgent off`)." Because it's a row with its
   own key, a Shepherdr chat already running when the update lands gets it once as a settings notice, through the
   same `settings_pass` that tells running chats a changed setting (its digest gains the new key). Meaning before
   mark: task news goes before `settings_pass` in a tick (`news.py` ~262), so a message with an urgent line to a
   chat whose `herdr.settings` label doesn't have the row's key yet starts with the row's settings notice, and the
   label is updated with it; `settings_pass` then has nothing left to say. Either way it goes only to a running
   agent (Ban rules, below). Behaviour stays
   words (docs/develop.md): the code carries the mark; Shepherdr decides what to do.

That is all: four changes, no setting, and no new kind of message: the only new send is the settings notice running chats already get when a setting changes.

### What it never changes

| Never | Why |
|---|---|
| **Review**: on or off, rounds, Must fix, the reviewer and its model | Skipping or shortening review on "urgent production fixes" is how outages happen. An urgent fix needs the second pair of eyes most. |
| **Merge**: the Merge setting, required checks, the destructive guard, the merge queue | GitHub's own jump rebuilds every other pull request; upstream left it out. |
| **Provider prompts**: permission, trust, sign-in | Only the person answers those (AGENTS.md: Nothing that risks a ban). |
| **The agent's model, effort or speed** | Fast mode costs extra usage credits on a subscription, and Codex's faster tiers cost more. The picker is one tap away; Shepherdr changes them only when the person asks, by restarting with documented flags, as today. |
| **The brief** | No "urgent" line for the worker: "smallest safe change" can narrow the work, and "ask sooner" brings questions Shepherdr could settle. |
| **A running agent** | Marking never sends anything to a task's agents and never restarts one. |
| **Start order and start limits** | Every task that waits for nothing starts in the same pass (3.2); the limits protect the machine (a nearly full disk). Nothing jumps a queue, the queue's walk keeps `queued_at` order, and a held urgent task waits in Up next with its reason like any other. Starting it anyway stays the person's own Start, as today (the app's Start passes `--now`). |
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

All UI follows FORK.md's "Industry standard first" and "All UI work uses the UI skills", within `web/src/ds.css`;
slice 2 names the skills.

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
- **What slices 1 and 2 ship, and what they don't.** They ship: the meaning, in every Shepherdr chat's settings
  note (running ones get it once); the mark on every task-status news line queued after it; urgent lines first in
  each message; the mark in `herdr-task list` whenever Shepherdr looks. They don't: marking a task sends nothing, so
  a task that already waits With Shepherdr, with no news left to come, is seen as urgent only at its next news or
  when Shepherdr lists its tasks. The settings note's line tells Shepherdr to check `urgent` when it does; the
  person can also say so in chat, as today.
- **Slice 3 orders, it doesn't tell.** Once Needs you's action records and hand-up exist (parts 5, 6a and 6b),
  urgent orders Shepherdr's own open waits in the one action list. That alone tells a running Shepherdr chat
  nothing new: a wait open before the mark is still found only when Shepherdr next lists its tasks, until the
  separate re-telling part in slice 3 is built. The person's Needs you list keeps its own order
  (oldest first); nothing in this spec reorders the person's cards, counts or phone feed.
- The words module (`web/shared/needs-words.ts`) gets nothing new: "Urgent" is a property of the task, shown by its
  mark, not a kind of wait.

### Data

| Where | Field | Notes |
|---|---|---|
| herdr-task's task record | `urgent`: when it was marked (ms); removed by `--urgent off` | Old task files have none: not urgent. Kept when a task moves to another folder or machine. |
| `herdr-task show`, `list --json` | `urgent: true` only when `urgent_now(t)` | `output.py` copies the record, so it drops the raw field and writes this one. `show` adds the line "Urgent: yes". |
| The service | `Task.urgent?: true` only when `isUrgent(raw)` | `service/model.ts` reads the raw lists and builds each task's row, keeping only the fields it names (~340–380): the row gets `urgent` there, through `isUrgent(task)` on the raw task. `service/compat.ts` (~488) copies it from the row onto the web's `Task`. Old clients ignore it. |
| The web action | `{type: "task-urgent", chat, on: boolean}` | `service/actions.ts`: the case, `on` checked to be a boolean, and the chat-to-task resolution beside `task-rename` (~773). `service/main.ts`: the type in `TASK_ACTS` (~726), so the task's list is read again at once after the edit, remote ones too (~926). Runs `herdr-task edit <ref> --urgent` or `--urgent off` on the task's own machine, found from the snapshot, never by ref alone. |

No settings key. Nothing people's state hangs on beyond the task field.

### Ban rules and privacy

- Nothing reads or drives an agent: no keys, no slash commands, no prompts answered, no restarts, no config files.
- Shepherdr hears of urgency only through what it already gets: one more attribute on the news it is sent, one more
  row in the settings note its own session hook asks for, and that row once as a settings notice to a chat already
  running. Neither is ever delivered by starting or restarting a chat: only to a Shepherdr whose agent is running
  now (a terminal showing a shell is not), else it waits for that chat's next start. Slice 1 still adds a dated line
  to docs/agents-and-terms.md's table for the new row and its one notice, as AGENTS.md asks of any change to what
  agents are told.
- Model, effort and speed change only by the person's pick, by restarting with documented flags, as today.
- No sharing or rotating of accounts, no retry elsewhere.
- Examples in code, tests and the demo are made up ("Fix checkout", vm-a).

## Edge and failure cases

| Case | What happens |
|---|---|
| Marking a Done or archived task | Refused, with why; the menu doesn't offer it there. |
| `edit --urgent` together with `--move-to` | `cmd_edit` moves a task (`move_task`, `commands.py` ~1489) before it opens the store for the other changes (~1543), so the urgency checks run first, under the source list's lock, before any move: a refused mark moves nothing. |
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

Each slice is its own task, branch and pull request, `Part of #119`, and checks upstream first again when it starts
(the fork-patch skill). They are one patch, carried and dropped together, so they share one patch file,
`fork/patches/119.json`: slice 1 creates it, and each later slice adds its own files and tests to it. That's safe
because they run one after the other, each branching from main only after the slice before it has merged: slice 2
is added `--after` slice 1, and slice 3 `--after` slice 2 as well as after Needs you parts 5, 6a and 6b.

### 1. Urgent: the mark in herdr-task and Shepherdr's news

- **What:** the task field and its one rule; `add --urgent`, `edit --urgent [on|off]`; the refusals (done, archived,
  a task's own agents), checked before any remote dispatch and before any move; `show` ("Urgent: yes") and
  `list --json`; the `urgent="yes"` attribute, noted when a line is queued and read again when it goes; urgent lines
  first in each message; the settings note's row.
- **Files:** a new `mods/tasks/bin/herdr_task/urgent.py` (the field, `urgent_now(t)`, the caller check, the row's
  words); one call site each in `cli.py` (the flag on `add` and `edit`, and the caller check before `--on` and
  `--detach` dispatch), `commands.py` (`cmd_add`; `cmd_edit`, its checks before `move_task`; `cmd_show`'s line),
  `news.py` (the attribute in `news_line`'s tag, the outbox entry's note, the batch's order), `output.py` (the JSON
  field), `assistant_settings.py` (the row in `rows`, and the notice it leads a message with); a dated line in `docs/agents-and-terms.md`.
- **Tests:** `test/test_herdr_task.py::Urgent` with a real throwaway store and a faked hc: mark, unmark, the
  refusals (also from a fake task terminal, before `--on`, and with `--move-to`: nothing moves), done by each path
  ends it, reopen, resume and switch don't bring it back, `show` and `list --json`, the attribute, a line queued and
  then marked or unmarked before a folder-scoped send, the order in a batch, the settings row and its one notice to a
  running chat, the notice leading the first message with an urgent line, none to a chat whose agent has ended (a shell in front), and no restart for it. A pinning test that fails if `news_line`'s tag shape, `browser_env`'s variable, `move_task`'s place
  in `cmd_edit` or `settings_pass`'s digest compare change. A `core/chat-log.test.js` case: a news tag with an extra
  `urgent` attribute reads the same.
- **Demo:** none (no UI).

### 2. Urgent: in the app

- **What:** the snapshot field; the `task-urgent` action, routed to the task's machine and read again at once; in the
  Tasks plugin, the menu rows, the row icon, the header word, and urgent first in Working and Up next.
- **Files:** `service/model.ts` (the row's field, through `isUrgent` on the raw task), `service/compat.ts` (copies it
  onto the `Task`), `service/actions.ts` (the case and the chat-to-task resolution), `service/main.ts` (the type in
  `TASK_ACTS`), `web/shared/types.ts` (one field), a new `web/shared/urgent.ts` (`isUrgent(raw)`, `urgentFirst(tasks)`:
  a stable partition), a new `web/plugins/tasks/urgent.tsx` (the icon, the two menu rows, the header word), with one
  call each in `web/plugins/tasks/client.tsx` (the menu rows, `TaskRow`'s title, the header's facts, `urgentFirst` on
  Working and Up next where `Now` renders them); the icon in `web/src/icons.ts`; two urgent tasks in
  `web/demo/data.ts` and the action in `web/demo/serve.ts`, so the proof clicks the real menu. Everything sits in the
  Tasks plugin: it owns the title, the facts line and both menus (docs/plugins.md), so no new Registry place and no
  second plugin.
- **UI skills:** `frontend-design:frontend-design`, `better-ui`, `better-colors`, `better-layout` (the changed order,
  the title's room), `better-accessibility`, `mobile-responsiveness` and `mobile-ios-design` (the phone row), and
  `web-design-guidelines` before ready.
- **Tests:** `web/shared/urgent.test.ts` (the rule's table, the same cases as slice 1's; the order, stable ties, Needs
  you and Done untouched), `web/plugins/tasks/urgent.test.tsx` (menu rows per state, the action sent, none on Done,
  the row's accessible name, the Needs you count unchanged by a mark), a `service` test for the snapshot field from a
  raw list and for the action's route (two machines with the same key; a remote toggle read again at once; an older
  herdr-task refusing the flag), `bunx tsc`, `bun run build`.
- **Proof:** the demo at 390 px and 1280 px, light, dark and night: Tasks with two urgent tasks first in Working, the
  menu, the header.

### 3. Urgent: first among Shepherdr's waits (after Needs you parts 5, 6a and 6b)

- **What:** in the one action list (`service/attention.ts` `projectAttention`), Shepherdr's own open waits (owner
  "Shepherdr") on urgent tasks come first, with ids, owners, counts and deadlines unchanged. The person's Needs you
  list, counts and phone feed keep their order. This orders the list; it reaches Shepherdr only when it next
  lists its tasks.
- **Telling Shepherdr about a wait that was already open** is its own part, if it's still wanted after the above is
  tried: a second delivery of the same wait id with `urgent="yes"`, sent only after a fresh check that the wait is
  still open, still Shepherdr's and still the same generation, never to a Shepherdr chat whose agent has ended
  (`news_send` can start one again), deduplicated across passes and machines, with race tests, and the dated
  update to docs/agents-and-terms.md, since it is a new kind of message to an agent.
- **Files and tests:** named once parts 5, 6a and 6b have merged, in their own shapes.
- **As built:** `web/shared/attention.ts` `inOrder` is the one list's order: oldest first (ties by id), then
  `web/shared/urgent.ts` `urgentWaitsFirst` moves each action Shepherdr owns on an urgent task (by any task it holds)
  ahead of the rest, a stable partition. `projectAttention` and `service/attention.ts` `keepLast` (a machine that can't
  be read keeps its last actions) both end with it. A wait handed up to the person (asked, its deadline passed, no
  Shepherdr) is the person's and keeps its age order. Every reader of the person's actions (`yours`, push, Glance, the
  badge, voice, Tasks' Needs you) filters to them, so nothing they see moves. Tests:
  `service/urgent-waits.test.ts`. The re-telling part is not built.

### Not in this spec

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
  shared list (counts, the sidebar's taps, the phone feed) another. Urgent sorts only Working and Up next; Needs you
  keeps its order, and slice 3 orders only Shepherdr's own waits.
- **No new Registry place, no second plugin** (minor). The Tasks plugin owns the title and both menus; the palette
  picks up menu rows. The demo gets the action, so the proof clicks the real menu.
- **The refusal covers add too, before remote dispatch** (blocker), and the spec says plainly it guards against
  mistakes only.

## Review

The spec was reviewed like code (Codex, gpt-6.2-sol, high, read-only). Round 1 found eight majors, all fixed above:
the service seams the mark passes through (`model.ts` builds the row, `main.ts`'s `TASK_ACTS` reads it again); how a
running Shepherdr chat learns the meaning (a settings row, so `settings_pass` tells it once) and what slices 1 and 2
can't do (a wait open before the mark); the send-time promise scoped to task-status batches, with the overview,
GitHub news and alerts named as not covered; slice 3 cut to Shepherdr's own waits, after Needs you's hand-up too,
with any re-telling as its own part; a refused mark that `--move-to` could still have moved; the start-order wording
(the queue's order still sets which other-machine checks a pass makes, and the app's Start passes `--now`); the
missing research (Opsgenie, Asana, Gmail, Teams from Microsoft's own page, Linear's 24 hours from its SLA page, links
to upstream's issues); and one shared patch file for the slices. Two minors were taken too: the retired window Tasks
panel is out of the plan, and the review's base is the merge base.

Round 2 (the last) confirmed findings 1 and 3 to 6 fixed and found four still short; all fixed above without a third
round: the settings notice goes only to a running agent, never by a restart, and leads the first message with an
urgent line, with a dated line in the terms table; slice 3 says plainly it orders and doesn't tell; the Gmail, Asana
and Linear rows say when their behaviour applies; and each slice branches from main after the one before it merged.
