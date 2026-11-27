# Friction loop

Part of #94. The spec for one loop that catches every likely bug, confusion or workaround met while using Shepherdr,
checks it, proposes a fix, takes the person's one yes, and follows the fix until it works on their device. It is built
for every Shepherdr user, on upstream's own feedback feature. The fork's own parts (a yes means "file it and fix it",
the upstream decision) stay in FORK.md and our skills.

The building tasks follow this spec, one per slice ([Build plan](#build-plan)).

## Words

| Word | Meaning |
|---|---|
| **friction** | Anything in Shepherdr that cost the person: a bug, a screen that confused them, a workaround, a step an agent did by hand that should happen on its own, a mistake Shepherdr's own words led an agent into. Never the person's own project's bugs. |
| **problem** | One friction as Shepherdr records it: one row of herdr-task's feedback record (`feedback.py`'s `STATE`), keyed by the words of its one line (`key_of`). |
| **report** | One time a problem was noticed: by a task's agent, an Assistant, the person, or a failed action. Several reports can be one problem. |
| **the record** | `<herdr-task store>/.feedback.json`, upstream's file. This spec adds fields and states to it; nothing new is stored anywhere else. |
| **the feedback repo** | Where problems are filed: Settings › Agents › Feedback repo (`agents.feedback_repo`), upstream Shepherdr's by default. |
| **Shepherdr's repo** | Upstream, `eliasstravik/shepherdr`. Different from the feedback repo when someone files to their own fork. |
| **the Feedback page** | The new page behind the sidebar's Feedback row: what was found, what was filed, and where each fix is. |

## Today's loop, mapped

| Step | Where it lives today | By hand? | What gets lost |
|---|---|---|---|
| **Capture: a task's agent** | `herdr-task feedback "<line>" --details …` (upstream, `feedback.py`); a reviewer's "Shepherdr feedback:" line, passed on by its worker | No: one command, returns at once | It reaches the Assistant as one news row, "Feedback noted from <task>". If the Assistant is busy or the chat moves on, the row scrolls away. The record keeps it as `told`, but nothing shows it to the person. |
| **Capture: the Assistant** | Words: upstream's "Feedback for Shepherdr" section (real Shepherdr problems, the person's frustration); our FORK.md "Every friction is a candidate fix" (confusion, workarounds, its own misses), only in this repo's space | Yes: the Assistant has to notice | Upstream's words leave out confusion and workarounds. Ours reach only this space's Assistant, not the spaces where the person does their other work. |
| **Capture: the person** | The sidebar's Feedback box: sends "File this feedback as an issue…" to Everything's chat | No | Fine for what they type. Nothing ties it to the problem record, so it isn't followed after filing. |
| **Capture: a failed action** | An error toast in the app (`tryAct`), an error line in an agent's terminal | — | Nothing. The toast disappears and nobody is asked. |
| **Capture: reactions** | The person's emoji reaction reaches the agent as an `<hc reaction>` line | — | Nothing turns a 😕 on an answer into a look at what confused them. |
| **Triage: dedupe** | `key_of` (same words, same problem); `--file` searches the feedback repo's **open** issues | Partly | Closed issues aren't searched, so a problem fixed or declined before is filed again. Upstream's issues aren't searched when filing to a fork. Two reports in different words are two problems. |
| **Triage: already fixed?** | Our FORK.md and the "check upstream first" rule (#83), words only | Yes | Every user but us files a problem a newer release already fixes. |
| **Shape** | The Assistant's own words (`--goal`, `--fix` …); for us, the shaping-a-request skill | Yes | The reporter's suggested fix sits in free text (`--details`); the person never sees a fix next to the problem unless the Assistant writes one. |
| **The yes** | A question card, "Leave feedback for Shepherdr about …?" Yes / No / Edit first; for us, "File it and fix it?" in chat | Yes | No "Not now": an unanswered card or a "later" is gone. 3 of the 32 problems on one machine this month were offered and never answered. |
| **File** | `herdr-task feedback --file` (redacted, `gh issue create`) | No | — |
| **Build** | For us: an issue and a task, by hand from the Assistant | Yes | A problem filed from another space never reaches this repo's space as work. |
| **Install** | Our "Install merged" schedule (upstream-sync skill) | No | — |
| **Confirm on a device** | For us: the device-check rule (#83), words and a label | Yes | Everyone else: nothing. "Merged" was read as "works" for a fix no device had seen. |
| **Upstream decision** | For us: the `not-filed` list, daily (upstream-issue skill) | Yes | — |

**The evidence.** On one machine this month, 32 problems were recorded: 17 filed, 12 told to an Assistant and never
offered, 3 offered and never answered. Half of what agents caught was lost, and nothing on any screen says so.

## Research

### Industry practice

| Practice | What it does | What we take |
|---|---|---|
| **Linear's Triage inbox** ([docs](https://linear.app/docs/triage)) | Issues from outside the team wait in Triage until someone decides: Accept, Decline (with a reason), Duplicate (merged into another), Snooze (until a time or new activity). Triage Intelligence suggests likely duplicates. | One list of undecided items, each with one primary action, a decline, and a snooze that comes back by itself. Duplicates suggested, never blocking. |
| **Linear Asks** ([docs](https://linear.app/docs/linear-asks)) | A request from Slack or email becomes an issue in Triage; replies sync back, so the asker never opens Linear. | The person never opens GitHub: the page shows where their problem is. |
| **Linear's zero-bugs policy** ([blog](https://linear.app/blog/zero-bugs-policy)) | Every incoming bug is fixed or explicitly marked won't fix; nothing sits undecided. | Every problem ends in a decision: filed, Never, or Not now with a date. None waits forever unseen. |
| **GitHub issue forms and duplicates** ([forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms), [creating](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)) | Fixed fields for a report; up to three possible duplicates shown while writing, advisory only. Closing has a reason: completed, not planned, duplicate. | Upstream's `--goal --happened --expected --fix --repro` already is the form. Show the close reason of a matching issue (fixed vs declined). |
| **GitHub notifications** ([docs](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)), **Superhuman**, **Linear Inbox** ([docs](https://linear.app/docs/inbox)) | Done, Save, Unsubscribe; snooze until a time, then back on top. | Yes / Not now / Never, with "Not now" coming back on its own. |
| **Sentry issue grouping and states** ([grouping](https://docs.sentry.io/product/issues/grouping-and-fingerprints/), [states](https://docs.sentry.io/product/issues/states-triage/)) | Events with one fingerprint are one issue; similar issues can be merged. Resolve "in next release"; a later event makes it Regressed. | Reports of one problem count up on one row. Fixed is tied to a release; the same problem after a fix is "came back", not a new problem. |
| **Sentry user feedback** ([docs](https://docs.sentry.io/product/user-feedback/)) | A widget, or a crash-report dialog right after an error, collects what the user was doing and links it to the error. | A Report button on the app's error toast, prefilled with what failed. |
| **Google SRE postmortems** ([book](https://sre.google/sre-book/postmortem-culture/)) | Blameless, about systems not people; follow-up actions are tracked; "an unreviewed postmortem might as well never have existed". | An agent's own miss is recorded as a Shepherdr problem (what in Shepherdr's words or screens led to it), never as blame. Every problem has a follow-up that stays visible until done. |
| **Linear Releases** ([docs](https://linear.app/docs/releases)) | Merged is a status; Done comes when the release ships. | Merged, released and "on this machine" are different states. Only the person's "Works" ends it. |
| **Dogfooding** (Linear's Quality Wednesdays, GitHub built on GitHub) | The team uses its own product daily and fixes small imperfections on a cadence. | Shepherdr is built with Shepherdr. Every friction met while doing so is the cheapest bug report there is. |

What fits a non-coding person running agents: the agents do the triage (dedupe, upstream check, the fix in plain
words); the person sees only decisions, in plain words, with one tap each; nothing asks them mid-work; and they never
have to read GitHub to know where a fix is.

### Upstream first

- **Upstream's feature** (upstream issue/PR 728, SHEP-78, "agents offer feedback for Shepherdr itself, filed only on
  the person's yes") is the base. Its rules, from the maintainer's brief: never block work, never nag; only real
  Shepherdr-level problems; at most one offer per problem; "No" remembered; search for a duplicate first; redact
  secrets, paths, hosts and names; never a whole log.
- **What upstream already has:** the record (`.feedback.json`, states `told`, `offered`, `declined`, `filing`,
  `filed`, and an unused `later`); `--list` (told and later only); `--dry-run` (the draft); redaction; Settings ›
  Agents › Feedback offers and Feedback repo; the news row; the sidebar's Feedback box.
- **What upstream doesn't have:** a place where found problems wait; Not now; a fix next to the problem; closed or
  upstream issues in the duplicate search; a release check; anything after filing. No upstream issue asks for these
  (searched: feedback, file issue, triage, found).
- **Upstream's Rules** (docs/develop.md) this must keep:
  - "Behaviour is words, not code. Shepherdr's code never judges work." The code records, counts, searches and
    follows; deciding what is a problem and writing the fix stay the agents' words.
  - "A new feature is a plugin." The page is a plugin.
  - "The app never says Assistant, worker or coordinator." The page says "your agents", a task's title, "in chat".
  - "Nothing personal": made-up examples, no paths or names.

## The design

Six principles, then each part.

1. **Nothing is lost.** Every report lands in the record and shows on the Feedback page at once, whether or not an
   Assistant is free.
2. **Nothing interrupts.** Capture never asks a question mid-work. The page holds what waits, with a quiet count.
   An Assistant mentions a new problem in one line; it asks with a card only between things, as upstream says today.
3. **One tap decides.** File it, Not now, Never. Not now comes back on its own.
4. **Check before filing.** Duplicates (open and closed), Shepherdr's repo when filing elsewhere, and whether a newer
   release already fixes it. Advisory, shown on the row: the person decides.
5. **Follow it to live.** Filed, fixed, released, on this machine, works. "Works" is the person's tap, never a guess.
6. **Nothing public without the person's yes,** and nothing private in what goes public. The person can read exactly
   what will be posted before they tap.

### The record

Upstream's `.feedback.json`, under its lock, grows these fields on a problem (all optional; an old record reads as
before):

| Field | What |
|---|---|
| `fix` | The proposed fix in one line, for every user. From the reporter's `--fix`, or the Assistant's when it shapes it. |
| `kind` | `bug`, `confusing`, `workaround`, `manual` (done by hand, should happen on its own), `miss` (an agent's mistake that Shepherdr's words led to). The page words it; the code doesn't judge it. |
| `from` | Where it came from, for the page: `{task: "<title>"}`, `{chat: true}`, `{person: true}`, `{action: "<what failed>"}`. Never a key. |
| `seen`, `last` | How many reports, and when the last came. |
| `also` | Other one-lines merged into this problem (reports in other words). |
| `draft` | The issue as `--file` would post it (title and redacted body), written when shaped, so the page can show it. |
| `checked` | The last check: `{at, dupes: [{url, title, state, reason}], upstream: [...], newest, installed}`. |
| `until` | Not now: when it comes back (`null`: when it is reported again). |
| `issue` | Once filed: `{url, repo, state, reason, fixed_in, live_at, checked_at}`. |
| `tried` | The person's answer once it is live: `works` or `broken`, with when. |

States, adding `found`, `later` (now used), and the ones after filing. `told` and `offered` read as `found`: the 15
lost ones on today's machines show up on the page the first day.

```
            report ─────────────┐
                                v
   ┌──────────────────────── found ◄────────── came back (reported again after fixed, or "Still broken")
   │  Not now                │   │  Never
   v                         │   v
 later ── its time, or ──►   │  declined  (Undo: back to found)
          reported again     │
                             │ File it (the person)
                             v
                          filing ──► filed ──► fixed ──► live ──► works (done)
                                   (open)   (closed as    (on this   │
                                            completed,    machine)   └► Still broken: came back
                                            or --shipped)
```

- **One problem, many reports.** A report with the same key adds to `seen`. A report whose words overlap an open
  problem's closely (most of its telling words shared, at least three) is merged into it as `also`; the Assistant can
  merge or split by hand (`--same-as <key>`, `--split`). A reporter is told "already noted, seen N times" and carries
  on; only the first report sends news.
- **Reported again after Never:** stays declined; `seen` still counts it (the person can see it keeps happening).
- **Reported again after fixed or live:** "came back", back to found, linked to its issue.
- **Kept:** undecided and declined problems 90 days after their last report (upstream's `KEEP_MS`); filed ones until
  30 days after "Works".

### Capture

| Source | How | New |
|---|---|---|
| A task's agent, a reviewer (through its worker), a schedule's run | `herdr-task feedback "<line>" --details … [--fix "<one line>"] [--kind …]` | `--fix`, `--kind`; the brief's feedback line and upstream's `AGENT_NOTE` mention `--fix` |
| The Assistant | The same command, for what it notices: the person's frustration (today), **and** the person confused by a screen, working around something, an agent doing by hand what should be automatic, an agent's mistake that Shepherdr's words led to | The words, delivered through the Feedback offers line of the Assistant's "Your settings" block (`assistant_settings.py`), not the template. It records without asking and says so in one line ("Noted for Shepherdr: the reply bubble doesn't show which message it answers."). |
| The person | The Feedback box, now at the top of the Feedback page (and still the sidebar row's first thing). What they write is their own yes: it is recorded `from: person` and sent to Everything to file, as today. | Recorded, so it is followed after filing |
| A failed action | A **Report** button on the app's error toast (Sentry's crash-report pattern). It opens the Feedback box prefilled: "<what I did> didn't work: <what it said>". Nothing is sent until the person sends it. | Toast `act` from a kernel hook |
| A reaction | Words only: a 😕, 👎 or 🤔 on an agent's answer about Shepherdr is a sign the person was confused; the Assistant looks and, if Shepherdr's screen or words caused it, records it. | In the same settings-block words |

Not captured automatically: errors in agents' terminals, crashes, logs. Reading those would mean judging work in code
or sending logs; agents report what they see in words instead.

### Check before filing

`herdr-task feedback --key K --check` (run in the background when a problem is first recorded, and again right before
filing; read-only GitHub calls with the person's own `gh`):

1. **The feedback repo's issues, open and closed** (today: open only). A closed match shows its close reason:
   completed ("Fixed before: <title>"), not planned ("Declined before: <title>"), duplicate.
2. **Shepherdr's repo's issues**, when the feedback repo is another one (a fork): open and closed.
3. **The newest release** of Shepherdr's repo against the installed version (`shepherdr_version()`). A newer one,
   with a closed match since the installed release: "Maybe fixed in 3.2.23 (you have 3.2.22)".
4. Short keyword searches (the line's telling words, at most six, then three), as `search_terms` does today: a long
   quoted query finds nothing.

The result is stored on the problem (`checked`) and shown on its row. It never blocks: like GitHub's duplicate
suggestions, the person decides. When it finds a match, File it offers "Add to <title>" (a comment, upstream's
`--comment`) beside "File new".

For us, the "check upstream first" rule (#83) stays in the fork's words: the agent also reads upstream's main after
the release and the maintainer's words on each match.

### Shape

The Assistant shapes a problem when it is free (not before it says anything else): `herdr-task feedback --key K
--shape --fix "<one line>" --title … --goal … --happened … --expected … --repro …`. This writes `fix` and `draft`
(the same body `--dry-run` shows today, redacted) without filing. A problem nobody shaped still shows on the page
with the reporter's words and their suggested fix, or "No fix proposed yet".

The fix is for every Shepherdr user: what would have prevented it on any machine, in one plain line. For us, the
shaping-a-request skill (need, research, options) does this step.

### The yes

On the Feedback page, each found problem has **File it**, **Not now** and **Never**.

- **File it** sends the person's message to the Assistant of the problem's space (Everything when there is none):
  "File it: “<line>”", carrying a hidden `<hc feedback key="…" do="file"/>` line, the way a reply carries
  `<hc reply-to>`. The tap is the person's own message, like a suggested-reply bubble. The Assistant files it with
  `--file` (duplicate check, redaction) and the row shows Filing… until the record says filed. Filing stays an
  Assistant's step, as upstream has it: the code never posts on its own.
- **Not now** opens a menu: Tomorrow, Next week, When it happens again. The service records it (`--later
  <when>`); nothing is sent to an agent. Undo in the toast.
- **Never** records the person's No (`--no`, upstream's). Undo in the toast; later, from the Said no section.
- **Edit first** (a quiet link on the row) opens the space's chat with "Let's change the feedback about “<line>”
  before filing" in the box, unsent.
- **In chat**, the person can still say yes, no or later in words; the Assistant runs the same commands. Upstream's
  question card stays for an Assistant that asks between things.

For us, a yes means "file it and fix it" (FORK.md). The fork part: when a problem is filed to the feedback repo, and a
space works on that repo, that space's Assistant gets a `feedback-filed` news line ([slice 4](#slice-4-a-filed-problem-reaches-its-repos-space)). Our
FORK.md says: that line is the person's yes to fix it; shape it (check upstream first) and add the task.

### The Feedback page

The sidebar's Feedback row (desktop list foot; the phone's drawer) shows the number of found problems as a quiet,
neutral count (not Needs you's red: nothing waits urgently), and opens the page. On a computer it takes the middle
column (the `middle` place, as an expanded artifact does); on a phone it is a full-screen sheet with Back.

```
 Feedback
 ┌───────────────────────────────────────────────────────────┐
 │ What should be better?                               🎤   │
 │                                                    [Send] │
 └───────────────────────────────────────────────────────────┘

 Found · 3
 ─────────────────────────────────────────────────────────────
 The reply bubble doesn't show which message it answers
 Fix: show the first line of the message it answers above it
 From the task "Sticker book" · 2 h ago · seen 3 times
 Maybe related: "Reply context in chat" (open)
 [ File it ]  [ Not now ▾ ]  [ Never ]        What will be posted ›

 Needs you showed a task with nothing for you to do
 Fix: …
 Noted in chat · yesterday · Maybe fixed in 3.2.23 (you have 3.2.22)
 [ File it ]  [ Not now ▾ ]  [ Never ]        What will be posted ›

 Filed · 5
 ─────────────────────────────────────────────────────────────
 A mention resolved to eleven tasks          On this machine
 Try it: mention a task by its title; it opens that one
 [ Works ]  [ Still broken ]                      On GitHub ›

 Ready failed to push after a rebase                    Fixed
 The service skipped a tick                   In 3.2.23 · update to get it

 › Not now · 2        › Said no · 1
```

- **Rows** follow Linear's Triage and GitHub's notifications: the problem in the person's words first, the fix under
  it, then one quiet line of where it came from, when, how often, and what the check found. The actions sit under it,
  File it as the one primary button.
- **What will be posted ›** opens the draft exactly as it will go public (title and body, redactions shown as
  `<name>`, `<host>`), so the person sees there is nothing private in it. No draft yet: "Not written yet; your agents
  write it when you say File it."
- **Filed** rows show one status, in plain words: Filing…, Open, Fixed, In 3.2.23 · update to get it, On this
  machine, Works, Came back, Declined there (the repo closed it as not planned). "On GitHub ›" opens the issue.
- **On this machine** shows "Try it: <how>" (the problem's `try`, else its Expected words) with Works and Still
  broken. Works folds the row into a "Fixed" history after a day. Still broken makes it "came back", back under Found.
- **Not now** and **Said no** fold, with their counts; each row says when it comes back, with Restore or Undo.
- **Empty:** "Nothing found. When something in Shepherdr doesn't work as it should, your agents note it here."
- **Feedback offers off:** a line at the top says so, with a link to the setting; nothing new is recorded, and what
  is there still shows.
- **Design:** the frontend-design skill, within `web/src/ds.css` (the existing list rows, `Btn`, `Cnt`, menus); the
  better-layout, better-typography and better-accessibility passes; screenshots at phone and desktop width, light and
  dark. A row that leaves (filed, snoozed) collapses in about 150 ms, off under Shepherdr's Motion setting and the
  system's reduced motion. Buttons are 44 px tall on a phone. No new shortcuts; Esc closes the sheet, as everywhere.
  Apps followed: Linear (Triage, Inbox), GitHub (notifications, issue forms), Sentry (feedback, resolved in release),
  iOS (sheets).

### Follow it to live

- **Reading the issue.** Once filed, the service asks herdr-task to follow it: `herdr-task feedback --track` at most
  once an hour while any filed problem isn't done (a job in `service/jobs.ts`; herdr-task does the `gh issue view`
  and `gh release list` reads). Closed as completed is **fixed**; closed as not planned is **declined there**.
- **Released.** For a fixed issue in a repo with releases, the first release published after it closed is its
  `fixed_in`, shown as "In 3.2.23". The installed version at or past it is **live** ("On this machine").
- **A pipeline can say so itself:** `herdr-task feedback --issue <url> --shipped <version> [--try "<how>"]` marks it
  live at once. For anyone who installs from their own fork, where issues stay open while a fix is carried (ours:
  `Part of`, never `Closes`), this is the only true signal. Our upstream-sync skill's step 7 calls it for each issue
  it labels `live`, passing the issue's Device check line (#83) as `--try`.
- **Works / Still broken** are the person's taps (or words in chat: `--works`, `--broken`). Still broken on a filed
  issue offers, on File it, one comment on that issue ("Still happens in <version>: <what they saw>"), never a second
  issue.
- **No push alerts.** A fix reaching the machine adds to the Feedback count only. Nothing about feedback is urgent.

### The upstream decision (fork)

Ours stays as the upstream-issue skill has it: a fix that is live and works is `not-filed` until the person says file
it, keep it ours or undo it, and the daily list shows what waits. The page helps by making "Works" visible first; a
later, optional slice ([slice 8](#slice-8-optional-offer-it-to-shepherdrs-makers)) puts "Offer it to Shepherdr's makers"
on a row that works, for anyone who files to a fork.

## Shepherdr or our fork

| Part | Where | Why |
|---|---|---|
| The record's new fields and states, `--fix`, `--later`, `--shape`, `--check`, `--track`, `--shipped`, `--works`, `--broken` | Shepherdr (`feedback.py`, a patch) | Every user loses reports today; upstream's own file and command |
| The Feedback page, its count, the Report button | Shepherdr (a plugin `feedback`, two one-line hooks) | Every user |
| The settings-block words (record without asking; confusion and workarounds too) | Shepherdr (`assistant_settings.py`'s Feedback offers line) | Upstream's way to tell Assistants about a setting; templates stay as they are |
| `feedback-filed` news to the space that works on the feedback repo | Shepherdr | Anyone filing to a repo they develop with Shepherdr, upstream's maintainer too |
| A yes means "file it and fix it"; that news becomes a shaped task | Our FORK.md and shaping-a-request skill | Only a fork builds its own fixes |
| Check upstream's main, read the maintainer's words (#83) | Our skills | Deeper than a release check; agents' words |
| `--shipped` from the install step; Device check as Try it | Our upstream-sync skill | Our pipeline |
| File it / keep it ours / undo it upstream | Our upstream-issue skill (slice 8 optional) | Our decision process |

## Ban rules and privacy

- **Nothing posts without the person's yes.** Every GitHub write (issue, comment) happens only from an Assistant
  acting on the person's own message or tap, through upstream's `--file`. The service and herdr-task's following only
  read (`gh issue view`, `gh search`, `gh release list`), with the person's own `gh` sign-in. Not now, Never, Works
  and Still broken write only the local record.
- **The tap is the person's message.** File it sends a message the person chose to send, as a suggested-reply bubble
  does; nothing types into an agent's terminal that didn't come from the person, no slash commands, no keys, no
  menus. News reaches Assistants the way it does today (herdr-task's held news).
- **No agent internals.** Nothing reads an agent's sign-in, tokens, usage, limits or settings files, or drives its
  interface. The only outside tool is `gh`, GitHub's official CLI, with its documented commands. No agent account is
  touched, so docs/agents-and-terms.md needs no new row; the slices say so in their pull requests.
- **The repo may be public.** What goes out passes upstream's `redact()` (secrets, tokens, emails, home paths, tailnet
  names, IP addresses, the machine's and account's names), plus, new: the names of the person's spaces and folders
  and their repos other than the feedback repo and Shepherdr's repo (a private project's name must never reach a
  public issue). The page shows the redacted draft before File it.
- **Never in an issue:** analytics, logs pasted whole, the person's project code, private repo content, settings
  values. Upstream's rule stays.
- **Search terms leave the machine too:** they are redacted first (`search_terms` does this today) and are only the
  line's telling words.
- **Off means off:** Feedback offers off records nothing new, files nothing, offers nothing.

## Edge and failure cases

| Case | What happens |
|---|---|
| `gh` not signed in, or offline | Check and follow say "GitHub isn't reachable here" on the row; nothing else changes. Filing fails as today, with its words. |
| The space has no Assistant running | File it goes to Everything's; its row says so. |
| Two devices tap at once | The record's lock; the second sees the new state (the snapshot), its action refused with "Already filed" or similar. |
| The Assistant never files after File it | The row says Filing… with when it was asked; after 10 minutes (`FILING_MS`) it shows File it again. |
| A problem reported in another space | It shows on the page with its space named. The yes goes to that space's Assistant. |
| Another machine's tasks | They report to their space's Assistant on their machine, into that machine's record. Slice 7 reads every machine's records into the page. Until then the page shows the serving machine's, and says so. |
| The feedback repo changed | Filed problems keep their own repo. New checks and filings use the new one. |
| An old record (upstream's shape) | Reads as before; `told` and `offered` show as found. Nothing is rewritten until a problem changes. |
| An issue closed as duplicate | Followed through the issue it points to, when GitHub says. Else shown as "Closed as duplicate". |
| A repo with no releases | Fixed stays the last state until `--shipped` or the person's Works. |
| A fork's issue that stays open while carried | Only `--shipped` makes it live (ours: the install step). |

## Build plan

Each slice is one task, added `--after` this spec, small enough to review in one sitting. Each is a patch (fork-patch
skill): its own issue labelled `patch`, `Part of #94` and its own number, a `fork/patches.json` line, tests pinning the
upstream seams it relies on, and upstream's style throughout. UI slices use the frontend-design skill plus
better-layout, better-typography and better-accessibility, follow the Motion setting, and screenshot phone and desktop,
light and dark. Each starts with the "check upstream first" rule (#83).

### Slice 1: the record keeps everything

Every report is kept and listable, nothing silently dropped; Not now exists.
- **Files:** `mods/tasks/bin/herdr_task/feedback.py` (fields, states, `--list --all --json`, `--fix`, `--kind`,
  `--later`, `--shape`, `--same-as`, `seen` counting, word-overlap merging), `cli.py` (flags), `launch.py` (the
  brief's feedback line mentions `--fix`), `fork/patches.json`.
- **Tests:** a new `test/test_feedback_found.py`: a repeat report counts up and sends news once; a near-duplicate in
  other words merges; `told`/`offered` list as found; `--later tomorrow` comes back at its time and on a new report;
  `--no` after later; `--shape` writes a redacted draft and files nothing; an upstream-shaped record reads unchanged.
  Pin: `key_of`, `problems()`, `redact`, `--list` and `--file` still exist with their arguments.
- **Demo:** with a throwaway `HERDR_TASK_STORE`, a fake hc and a fake gh: report the same problem three times in two
  wordings, `feedback --list --all --json` shows one problem, seen 3; `--later tomorrow` hides it from found.

### Slice 2: the Feedback page

The person sees what was found and decides with one tap.
- **Files:** `web/plugins/feedback/` (`client.tsx`, `rows.tsx`, `words.ts`, `feedback.css`), `web/plugins.json`,
  `service/feedback.ts` (reads `feedback --list --all --json` on the service's tick, cached; the Not now / Never /
  Undo actions run herdr-task), one case in `service/actions.ts`, `web/shared/types.ts` (`FoundItem` in the
  snapshot), `web/src/kernel.ts` (`views.feedback`), `web/src/list.tsx` (the Feedback row's count and opening the
  view; the old dialog when the plugin is off), `web/demo/data.ts` (found, filed, later rows), `docs/plugins.md`.
- **Tests:** `service/feedback.test.ts` (list read, actions, a failed read keeps the last list);
  `web/plugins/feedback/feedback.test.tsx` (sections, counts, File it sends the person's message with the hidden key
  line, Not now's menu, Undo, the empty and off states, no "Assistant" in any words).
- **Demo:** `bun run build`, `bun web/demo/serve.ts`, open the Feedback row: three found, one filed, the folds;
  screenshots at 390 and 1280 width, light and dark.

### Slice 3: check before filing

A problem shows what GitHub already knows before the person taps File it.
- **Files:** `feedback.py` (`--check`: the feedback repo open and closed, Shepherdr's repo when different, the newest
  release against the installed version; stored as `checked`; run in the background on a new problem and before
  filing; `--file` uses closed matches too), `web/plugins/feedback/rows.tsx` (the check's line; File it's "Add to …"
  choice).
- **Tests:** in `test/test_feedback_found.py` with a fake gh (`HERDR_TASK_GH`): a closed-completed match gives
  "Fixed before"; a not-planned one "Declined before"; a fork feedback repo also searches Shepherdr's repo; a newer
  release with a closed match says "Maybe fixed in"; gh failing leaves the problem as it was; search terms are
  redacted.
- **Demo:** a fake gh with one closed issue and a newer release; the row shows both lines.

### Slice 4: a filed problem reaches its repo's space

For anyone who files to a repo they work on in Shepherdr; for us, every yes becomes a task.
- **Files:** `feedback.py` (after filing, the space whose folder's `origin` is the feedback repo gets
  `<herdr-news event="feedback-filed">` with the issue's link and words; not the filing space's own Assistant twice),
  `FORK.md` (that line is the person's yes to fix it: shape it, check upstream first, add the task), the
  shaping-a-request skill (one line).
- **Tests:** a space on a scratch repo with that origin gets the news; no space on it, nothing sent; the filing
  space is that space, one message only.
- **Demo:** two throwaway spaces, one on a scratch clone whose origin is the feedback repo; file from the other; the
  first one's Assistant gets the line.

### Slice 5: follow it to live

The person sees where each fix is and confirms it on their device.
- **Files:** `feedback.py` (`--track`, `--shipped`, `--works`, `--broken`, came back on a new report), `service/jobs.ts`
  (hourly `--track` while something is followed), `web/plugins/feedback/rows.tsx` (Filed statuses, Try it, Works,
  Still broken), `.agents/skills/upstream-sync/SKILL.md` (step 7 calls `--shipped` with the Device check line).
- **Tests:** a fake gh: closed completed → fixed; a release after it, installed version older → "In 3.2.23 · update";
  installed at it → live; `--shipped` → live at once on an open issue; Still broken → found, linked, and its File it
  comments on the same issue; reported again after live → came back; the job doesn't run with nothing followed.
- **Demo:** demo data with one row in each state; on a throwaway store, `--shipped` then the page shows Try it.

### Slice 6: report from a failed action

A failed tap in the app can become feedback in two taps.
- **Files:** `web/src/kernel.ts` (one hook: `tryAct`'s error toast takes `act` from `registry.reportError`),
  `web/plugins/feedback/report.ts` (Report opens the Feedback box prefilled with the action's words and the error).
- **Tests:** an error toast has Report when the plugin is on and none when it's off; the box holds the prefill and
  sends nothing by itself; a sent one is recorded `from: action`.
- **Demo:** the demo's `?case=down`, tap an action, Report, see the box.

### Slice 7: every machine's problems

The page shows problems recorded on every machine, each with its machine named.
- **Files:** `service/feedback.ts` (each reachable machine's list, as the service reads other machines' tasks), the
  row's machine line, the actions routed `--on <machine>`.
- **Tests:** two machines' lists merge; a machine that can't be reached keeps its last list and says so; an action
  goes to the row's machine.
- **Demo:** two throwaway cores (AGENTS.md: "Two throwaway cores on one VM"), a report on each, both on the page.

### Slice 8 (optional): offer it to Shepherdr's makers

For anyone who files to a fork: once a fix works, one tap offers it upstream.
- **Files:** `web/plugins/feedback/rows.tsx` ("Offer it to Shepherdr's makers" on a Works row when the feedback repo
  isn't Shepherdr's: sends "File it upstream: “<line>”" as the person's message), our upstream-issue skill (that
  message is the "file it").
- **Tests:** shown only for a fork feedback repo and a works row; sends the person's message; never posts by itself.
- **Demo:** demo data with a fork feedback repo.

## Second opinion

Codex (gpt-6.2-sol, high) read the draft read-only. What changed: see the pull request, which lists each point and
what this spec did with it.

## Not in this spec

- Automatic capture from agents' terminals, logs or crash dumps: judging work in code, and logs must never leave.
- Push alerts for found or fixed problems: nothing here is urgent.
- Voting, priorities or assignees: one person, one list.
- Changing upstream's templates: the words go through the settings block.
