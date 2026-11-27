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
| **problem** | One friction as Shepherdr records it: one row of herdr-task's feedback record, with a stable id. |
| **report** | One time a problem was noticed: by a task's agent, an Assistant, or the person. A problem keeps every report it got. |
| **the record** | `<herdr-task store>/.feedback.json`, upstream's file (`feedback.py`'s `STATE`). This spec adds fields to it; nothing new is stored anywhere else. |
| **draft** | The exact issue or comment that would be posted: destination, action, title, body, already redacted. Each change makes a new revision. |
| **approval** | The person's yes to one draft revision, recorded in the record and used once. |
| **the feedback repo** | Where problems are filed: Settings › Agents › Feedback repo (`agents.feedback_repo`), upstream Shepherdr's by default. |
| **Shepherdr's repo** | Upstream, `eliasstravik/shepherdr`. Different from the feedback repo when someone files to their own fork. |
| **the Feedback page** | The new page behind the sidebar's Feedback row: what was found, what was filed, and where each fix is. |

## Today's loop, mapped

| Step | Where it lives today | By hand? | What gets lost |
|---|---|---|---|
| **Capture: a task's agent** | `herdr-task feedback "<line>" --details …` (upstream, `feedback.py`); a reviewer's "Shepherdr feedback:" line, passed on by its worker | No: one command, returns at once | It reaches the Assistant as one news row, "Feedback noted from <task>". If the Assistant is busy or the chat moves on, the row scrolls away. The record keeps it as `told`, but nothing shows it to the person. With no Assistant running, the report is not kept at all (`feedback.py`, "no-assistant"). |
| **Capture: the Assistant** | Words: upstream's "Feedback for Shepherdr" section (real Shepherdr problems, the person's frustration); our FORK.md "Every friction is a candidate fix" (confusion, workarounds, its own misses), only in this repo's space | Yes: the Assistant has to notice | Upstream's words leave out confusion and workarounds. Ours reach only this space's Assistant, not the spaces where the person does their other work. |
| **Capture: the person** | The sidebar's Feedback box: sends "File this feedback as an issue…" to Everything's chat | No | The box closes before the send is confirmed. Nothing ties it to the record, so it isn't followed after filing. |
| **Capture: a failed action** | An error toast in the app | — | Nothing. The toast disappears and nobody is asked. |
| **Triage: dedupe** | The problem's key (the words of its line); `--file` searches the feedback repo's **open** issues | Partly | Closed issues aren't searched, so a problem fixed or declined before is filed again. Upstream's issues aren't searched when filing to a fork. The key drops "not" and every non-ASCII word: "Reply context is shown" and "Reply context is not shown" are one problem, and two unrelated reports in Japanese share the empty key. |
| **Triage: already fixed?** | Our "check upstream first" rule (#83), words only | Yes | Every user but us may file a problem a newer release already fixes. |
| **Shape** | The Assistant's own words (`--goal`, `--fix` …); for us, the shaping-a-request skill | Yes | The reporter's suggested fix sits in free text; the person never sees a fix next to the problem unless the Assistant writes one. |
| **The yes** | A question card, "Leave feedback for Shepherdr about …?" Yes / No / Edit first; for us, "File it and fix it?" in chat | Yes | No "Not now": an unanswered card is gone when the chat moves on. The yes is not tied to the text: Yes runs `--file`, which writes the body when it runs; only Edit first shows it. "Once per problem" is a 12-hour quiet time in the code (`AGAIN_MS`), so the same problem reported a day later is offered again. |
| **File** | `herdr-task feedback --file` (redacted, `gh issue create`) | No | A post that succeeded but whose answer was lost can be posted again: the state goes back when the answer is missing. |
| **Build** | For us: an issue and a task, by hand from the Assistant | Yes | A problem filed from another space never reaches this repo's space as work. |
| **Install** | Our "Install merged" schedule (upstream-sync skill) | No | — |
| **Confirm on a device** | For us: the device-check rule (#83), words and a label | Yes | Everyone else: nothing. "Merged" was read as "works" for a fix no device had seen. |
| **Upstream decision** | For us: the `not-filed` list, daily (upstream-issue skill) | Yes | — |

**The evidence.** On one machine, over the last few days, 33 problems were recorded: 17 filed, 13 told to an
Assistant and never offered, 3 offered and never answered. Half of what agents caught never reached the person, and
nothing on any screen says so.

## Research

### Industry practice

| Practice | What it does | What we take |
|---|---|---|
| **Linear's Triage inbox** ([docs](https://linear.app/docs/triage)) | Issues from outside the team wait in Triage until someone decides: Accept, Decline (with a reason), Duplicate (merged into a chosen issue), Snooze (until a time or new activity). Triage Intelligence suggests likely duplicates. | One list of undecided items, one primary action each, a decline, a snooze that comes back by itself. Duplicates suggested, linked only by a person's or agent's choice. |
| **Linear Asks** ([docs](https://linear.app/docs/linear-asks)) | A request from Slack or email becomes an issue in Triage; replies sync back, so the asker never opens Linear. | The person never opens GitHub to know where their problem is. |
| **Linear's zero-bugs policy** ([blog](https://linear.app/blog/zero-bugs-policy)) | Every incoming bug is fixed or explicitly marked won't fix. | Every problem ends in a decision the person made: filed, followed, Never, or Not now with a date. Nothing expires undecided. |
| **GitHub issue forms and duplicates** ([forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms), [creating](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue), [closing](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/closing-an-issue)) | Fixed fields for a report; up to three possible duplicates shown while writing, advisory only. Closing has a reason: completed, not planned, duplicate. | Upstream's `--goal --happened --expected --fix --repro` already is the form. Show a match's close reason (fixed before vs declined before). |
| **GitHub notifications** ([docs](https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications)), **Linear Inbox** ([docs](https://linear.app/docs/inbox)), **Superhuman** | Done, Save, Unsubscribe; snooze until a time, then back on top. | Yes / Not now / Never, with Not now coming back on its own; "Follow" an issue without writing on it. |
| **Sentry issue grouping and states** ([grouping](https://docs.sentry.io/product/issues/grouping-and-fingerprints/), [states](https://docs.sentry.io/product/issues/states-triage/)) | Events with one fingerprint are one issue; similar ones are merged by hand. Resolve "in a release"; a later event in a newer release makes it Regressed. | Identical reports count on one row. Fixed is tied to the release that has the fix; the same problem after it is "came back", not new. |
| **Sentry user feedback** ([docs](https://docs.sentry.io/product/user-feedback/)) | A widget, or a crash-report dialog right after an error, collects what the user was doing and links it to the error. | Report on the app's error toast, the person's own words prefilled with the action's name ([Report from a failed action](#report-from-a-failed-action)). |
| **Idempotent writes** ([AWS Well-Architected](https://docs.aws.amazon.com/wellarchitected/2025-02-25/framework/rel_prevent_interaction_failure_idempotent.html)) | A request carries a token, so a retry after a lost answer doesn't do it twice. | Each post carries the problem's id and draft revision; before a retry, GitHub is searched for it. |
| **Google SRE postmortems** ([book](https://sre.google/sre-book/postmortem-culture/)) | Blameless, about systems not people; follow-ups tracked; "an unreviewed postmortem might as well never have existed". | An agent's miss is recorded as what in Shepherdr led to it, never as blame, and stays visible until decided. |
| **Linear Releases** ([docs](https://linear.app/docs/releases)) | Merged is a status; Done comes when the release ships. | Closed, released, on this machine and works are separate facts, each with its evidence. Only the person's "Works" ends it. |
| **Dogfooding** (Linear's Quality Wednesdays, GitHub built on GitHub) | The team uses its own product daily and fixes small imperfections on a cadence. | Shepherdr is built with Shepherdr: friction met while doing so is the cheapest bug report there is. |

What fits a non-coding person running agents: the agents do the triage (dedupe, upstream check, the fix in plain
words); the person sees only decisions, in plain words, one tap each, with the exact text before anything goes
public; nothing asks them mid-work; and they never read GitHub to know where a fix is.

### Upstream first

- **Upstream's feature** (upstream PR 728, "agents offer feedback for Shepherdr itself, filed only on the person's
  yes") is the base. Its rules, from the maintainer's brief: never block work, never nag; only real Shepherdr-level
  problems; at most one offer per problem; "No" remembered; search for a duplicate first; redact secrets, paths,
  hosts and names; never a whole log.
- **What upstream already has:** the record (states `told`, `offered`, `declined`, `filing`, `filed`, and an unused
  `later`); `--list` (told and later only); `--dry-run` (the draft); redaction; Settings › Agents › Feedback offers
  (per space) and Feedback repo (Everywhere's); the news row; the sidebar's Feedback box.
- **What upstream doesn't have:** a place where found problems wait; Not now; a fix next to the problem; closed or
  upstream issues in the duplicate search; a release check; a yes bound to the posted text; anything after filing.
  No upstream issue asks for these (searched: feedback, file issue, triage, found).
- **Upstream's Rules** (docs/develop.md) this keeps:
  - "Behaviour is words, not code. Shepherdr's code never judges work." The code keeps, counts, searches and
    follows; deciding what is a problem, writing the fix and linking related reports stay the agents' and the
    person's.
  - "A new feature is a plugin." The page is a plugin.
  - "The app never says Assistant, worker or coordinator." The page says "your agents", a task's title, "in chat".
  - "Nothing personal": made-up examples, no paths or names.

## The design

Six principles, then each part.

1. **Nothing is lost.** Every report is saved before anyone is told, and shows on the Feedback page at once, whether
   or not an Assistant is free or running.
2. **Nothing interrupts.** Capture never asks a question mid-work. The page holds what waits, with a quiet count. An
   Assistant mentions a new problem in one line; it asks with a card only between things, as upstream says today.
3. **One tap decides.** File it, Not now, Never, or Follow an issue that already exists. Not now comes back on its
   own.
4. **Check before filing.** Duplicates (open and closed), Shepherdr's repo when filing elsewhere, and whether a newer
   release already fixes it. Advisory, shown on the row.
5. **The yes is for the exact text.** The person sees the redacted post and where it goes, and their yes is for that
   revision only, used once. Retrying never posts twice.
6. **Every status has evidence.** Closed, in a release, on this machine and works are each shown only when something
   proves them. "Works" is the person's tap.

### The record

Upstream's `.feedback.json`, under its lock. A problem keeps upstream's fields and gains these (all optional: an old
record reads as before):

| Field | What |
|---|---|
| `id` | Stable for the problem's life: its first key ([Identity](#identity)). Later reports with the same key count on it. |
| `space` | The origin: the space of its first report. Its Feedback offers setting governs the row's checks, following and posting, and its Assistant gets File it and Write it up. |
| `reports` | Each report: `{at, space, machine, from, line, details}`. `from` is `{task: "<title>"}`, `{chat: true}`, `{person: true}` or `{action: "<label>"}`, never a key. Nothing is merged away. |
| `fix`, `kind` | The proposed fix in one line, for every user; and `bug`, `confusing`, `workaround`, `manual` or `miss`, for the page's words. Written by the reporter (`--fix`, `--kind`) or the Assistant shaping it. |
| `search` | The public words a duplicate search may use, written by the agent that shapes it (component and action names, never the person's project). |
| `related` | Problems or issues an agent or the person linked (`--same-as`, Follow). Never set by word matching. |
| `decision` | The person's: `found` (none yet), `later` (with `until`, or `null` for "when it happens again"), `declined`, `approved`, `following` (an existing issue, nothing posted). |
| `draft` | `{rev, target: {repo: "owner/name", action: "create" or "comment", issue?: n}, title, body}`, redacted, the exact post. The target always names its whole repo, never a bare number. |
| `approval` | `{rev, target, at, by: "page" or "chat"}`; cleared when used, when the draft changes, or on Not now and Never. |
| `post` | The filing attempt: `{state, rev, target, started, url?, why?}`, `state` one of `waiting`, `posting`, `posted`, `refused`, `unsure`. |
| `outcome` | GitHub's side once filed or followed: `{url, state: open or closed, reason: completed, not_planned or duplicate, canonical?, checked_at}`. |
| `shipped` | The evidence it reached this machine: `{release?, build, machine, at, how: "release" or "install"}`; cleared when that build is no longer installed. `build` is a commit, from the installer's record ([Follow it to live](#follow-it-to-live)). |
| `tried` | The person's answer on a shipped build: `{result: works or broken, build, at}`. |
| `checked` | The last check: `{at, dupes: [...], upstream: [...], newest, installed}`. |

The three sides are kept apart, as Codex's second opinion asked: what the person decided (`decision`), what GitHub
says (`outcome`), and what this machine has (`shipped`, `tried`). One can change without the others: an issue
reopened upstream updates `outcome` and leaves the person's decision alone.

```
 report ──► found ──Not now──► later ──(its time, or reported again)──► found
              │  └──Never────► declined ──(Undo)──► found
              │  └──Follow───► following ─────────────┐
              │                                       │
              └──Post it, on draft rev N──► approved ──► post: waiting → posting → posted
                                                        │            ├→ refused (a clear no before any write: Post it again)
                                                        │            └→ unsure (reconciled on GitHub, never posted again)
                                                        v
                         outcome: open → closed (completed) ──► shipped (release has the fix, or an install says so)
                                                                      │
                                                     tried: works (done) / broken ──► came back: found again, linked
```

#### Identity

Upstream's key (`key_of`) drops "not" with its stop words and keeps only ASCII words, so opposite reports, and any
two reports in a script without Latin letters, collide. A new problem's id is a new key: Unicode word characters,
lower-cased, upstream's stop words except the negations (no, not, never, nothing, and the `n't` words, which are kept
as `not`), and, when no words are left, a hash of the whole line as written. Every old id still works in `--key`.
A new report joins an old problem (one keyed the old way) only when the new key of the report equals the new key of
that problem's stored line: an old collision never absorbs a different problem, nor inherits its Never. Tests, each
with a declined old row seeded: "Reply context is shown" declined, then "Reply context is not shown" reported, is a
new, found problem; two different Japanese lines are two problems; an old row still takes a report of its own line.

#### Spaces

A report is recorded only when Feedback offers is on in the space it comes from. A problem's origin is its first
report's space. A report of the same problem from another space adds a report and names its space, but the origin
stays: its setting is checked again right before every check, follow and post, and a row whose origin was switched off
is kept, shown, and does nothing more (an approval waiting on it is refused by `--file`). File it and Write it up go to
the origin's Assistant; with none running, to Everything's, which still checks the origin's setting. Tests: a problem
reported from two spaces keeps the first as origin; the origin switched off after Post it refuses the post.

The space always comes with the report, never from the caller's terminal alone: an agent's report gets its space as
today (`caller_space()`); the web app's reports name it (`--person --space <id>`). The Feedback box's space is the
space open when the person opened Feedback, shown in the box ("From Sticker shop"; from Everything: "From
Everything"), and the failed action's is the space it acted in. A web report from a space with offers off isn't
recorded, and the box says so. Test: a box report from a space with offers off is refused, even with Everywhere on.

#### Kept and read

- **Reads are reads.** `--list` and the page never rewrite the file or prune it (upstream's `problems()` does today).
  An unreadable record is kept aside (`.feedback.json.bad-<time>`), never overwritten as empty.
- **Kept:** a problem with no decision stays until the person decides; it never expires on its own. Declined ones
  and done ones lose their report text after 90 days (upstream's `KEEP_MS`) but keep their id, line, decision and
  issue link, so a later report finds its history.
- **Reported again after Never:** stays declined; its report count still grows, so the page can say it keeps
  happening.
- **Reported again after it shipped:** "came back", back to found, linked to its issue.

### Capture

| Source | How | New |
|---|---|---|
| A task's agent, a reviewer (through its worker), a schedule's run | `herdr-task feedback "<line>" --details … [--fix "<one line>"] [--kind …]` | Saved first, then told (with no Assistant running: saved, and shown on the page). `--fix` and `--kind`; the brief's feedback line and `AGENT_NOTE` mention `--fix`. |
| The Assistant | The same command, for what it notices: the person's frustration (today), **and** the person confused by a screen, working around something, an agent doing by hand what should be automatic, an agent's mistake that Shepherdr's words led to. A confused emoji reaction is a clue to look, never a report by itself. | Words ([Instructions](#instructions)). It records without asking and says so in one line ("Noted for Shepherdr: the reply bubble doesn't show which message it answers."). |
| The person | The Feedback box, at the top of the Feedback page. What they write is saved as a report (`from: person`) before anything is sent; the box keeps their text if saving fails. Filing it still takes the yes on its draft, like any other. | Saved and followed |
| A failed action | Report on its error toast opens the box prefilled with the action's name ([Report from a failed action](#report-from-a-failed-action)) | New |

Agents write reports in public-safe words: what Shepherdr did, in its own terms, never the person's project, customer
or data. Redaction is the second pass, not the first.

### Check before filing

`herdr-task feedback --key K --check`: read-only GitHub calls with the person's own `gh`, run once a problem has
`search` words (so nothing leaves the machine before an agent wrote public words), and again right before posting:

1. **The feedback repo's issues, open and closed** (today: open only). A closed match shows its reason: completed
   ("Fixed before: <title>"), not planned ("Declined before: <title>"), duplicate (followed to its canonical issue).
2. **Shepherdr's repo's issues**, when the feedback repo is another one (a fork): open and closed.
3. **The newest release** of Shepherdr's repo against the installed version (`shepherdr_version()`): "A newer
   version is out (3.2.23; you have 3.2.22)". With a closed match whose fix is in that release (below): "Fixed in
   3.2.23".
4. Short keyword searches from `search` (at most six words, then three), as upstream's `search_terms` does: a long
   quoted query finds nothing.

The result is stored (`checked`) and shown on the row. It never blocks: the person decides. A match offers
**Follow this one** (nothing posted; the problem follows that issue). A match in the feedback repo also offers **Add
to it** (a comment, as a draft to approve). A match in Shepherdr's repo, when the feedback repo is another one, is
Follow only: comments go only where you file, and for us the upstream-issue skill posts upstream only after our fix
is merged and the person says file it.

For us, the "check upstream first" rule (#83) stays in the fork's words: the agent also reads upstream's main after
the release and the maintainer's words on each match.

### Shape

The Assistant shapes a problem when it is free, never before answering the person: `herdr-task feedback --key K
--shape --fix "<one line>" --search "<public words>"` writes `fix` and `search`, and starts the check. Adding the
draft's fields (`--title … --goal … --happened … --expected … --repro …`, and `--comment owner/name#n` for a comment)
writes a new draft revision: redacted, the body `--dry-run` shows today, with its whole target. It posts nothing. A problem nobody shaped still shows with the reporter's words and their suggested fix, or "No fix
proposed yet", and offers **Write it up** instead of File it.

The fix is for every Shepherdr user: what would have prevented it on any machine, in one plain line. For us, the
shaping-a-request skill (need, research, options) does this step.

### The yes and filing

The only approval is the person's yes on a screen that shows the exact draft and where it goes. Nothing approves text
the person didn't see.

- **On the page:** a shaped problem's **File it** opens a confirmation sheet (iOS's and GitHub's "preview before you
  submit"): where it goes, in words ("A new issue in eliasstravik/shepherdr", "A comment on “<title>” in
  owner/name"), then the title and body exactly as they will be posted, redactions shown as `<name>`, `<host>`. Its
  primary button is **Post it**; Cancel closes it. A line set in Settings (`agents.feedback_note`, empty by default) shows
  above it; ours says "Posting also starts a fix in this repo's space" ([The fork's parts](#the-forks-parts)). Post it records an approval for that revision and target
  (the service runs `herdr-task feedback --key K --approve <rev>`, a command refused in any agent's terminal, as
  `fork/bin/sync clear-broken` is), then sends the origin's Assistant the person's message "Post the feedback about
  “<line>”" with a hidden `<hc feedback id="…" rev="N"/>` line, the way a reply carries `<hc reply-to>`
  (`core/send.js`, hidden by `core/chat-log.js`). It is the person's own message, sent by their tap, as a
  suggested-reply bubble is.
- **In chat:** the Assistant shows the draft (`--dry-run`) in its question card's words, with where it goes and the
  Settings line (`agents.feedback_note`) when one is set, and asks. The command's draft output always ends with that
  line, so both paths say the same before the yes.
  Yes: `--approve <rev> --by chat`, then files. An agent records a chat approval only right after the person's yes to a
  card that showed that revision; its instructions say so. This is upstream's trust model today, with the draft now in
  the card.
- **Upstream's paths still work, through the draft.** `--file` without `--rev` (upstream's card flow, the template's
  "Yes: `--file`", and the old Feedback box's message to Everything) no longer posts: it writes the draft and answers
  with the words to show it and ask again ("Show the person this draft with where it goes, then on their yes:
  `herdr-task feedback --key K --approve 3 --by chat` and `--file --rev 3`"). The words come from the command's
  output, as upstream's `offer_words` do today, so the template doesn't change.
- **Filing** (`--file --rev N`, only an Assistant, as upstream) refuses unless an approval matches that revision and
  target, the decision isn't Not now or Never, and the origin's Feedback offers is on. It posts the stored draft as it
  is, never a new body; the body ends with a hidden marker `<!-- shepherdr-feedback <id> rev <N> -->`.
  1. Before the request: `post.state = posting`, saved.
  2. Answer with a link: `posted`, approval used up, `outcome` set.
  3. A clear refusal before anything was written (gh not signed in, no permission, a 4xx answer): `refused`, with its
     words; Post it again uses the same approval.
  4. Anything else (no answer, a timeout, a crash, a `posting` older than 10 minutes found by the next `--list` or
     `--track`): `unsure`. An unsure post is never posted again, by anyone: another write is allowed only after a
     failure known to have happened before anything was written (step 3). Reconciling reads GitHub directly, not its
     search index (which can lag or miss), and reads everything since the attempt began, page by page: the
     person's own issues in the target repo created since then (`gh api "repos/<repo>/issues?creator=<login>&state=all&since=<started>"
     --paginate`), or the target issue's comments since then (`gh api "repos/<repo>/issues/<n>/comments?since=<started>"
     --paginate`), looking for the marker. Found: `posted`. Not found: it stays `unsure`, and the row says
     "Couldn't tell whether it was posted" with **Check on GitHub ›** and **Check again**, both read-only. If the
     person sees it isn't there, they can only start over: Never on this row, and a new report. Posting twice in
     public is worse than asking them to look once.
- **Not now, Never** (the service: `--later <when>`, `--no`, refused in an agent's terminal; the Assistant's existing
  `--no` stays for a No said in chat) clear any approval. An approval whose message reaches the Assistant after Never is
  refused by `--file`, and the Assistant says so in one line.
- **The page shows:** Waiting to post (approved, the Assistant hasn't started), Posting, Couldn't post (with why),
  Couldn't tell whether it was posted, Filed.
- **Honest limit:** agents run as the same user as the service, so a command "refused in an agent's terminal" stops
  mistakes, not a determined agent. The instructions forbid it, as they forbid every other person-only step.

### The Feedback page

The sidebar's Feedback row (desktop list foot; the phone's drawer) shows the number of found problems as a quiet,
neutral count (not Needs you's red: nothing here is urgent), and opens the page: on a computer in the middle column
(the `middle` place), on a phone a full-screen sheet with Back.

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
 From the task "Sticker book" · 2 h ago · 3 reports
 Maybe the same: "Reply context in chat" (open)   [ Follow this one ]
 [ File it… ]  [ Not now ▾ ]  [ Never ]

 Needs you showed a task with nothing for you to do
 Noted in chat · yesterday · A newer version is out (3.2.23; you have 3.2.22)
 No fix proposed yet
 [ Write it up ]  [ Not now ▾ ]  [ Never ]

 Filed · 5
 ─────────────────────────────────────────────────────────────
 A mention resolved to eleven tasks          On this machine
 Try it: mention a task by its title; it opens that one
 [ Works ]  [ Still broken ]                      On GitHub ›

 Ready failed to push after a rebase       Closed as fixed
 The service skipped a tick                Fixed in 3.2.23 · update to get it

 › Not now · 2        › Said no · 1
```

- **Rows** follow Linear's Triage and GitHub's notifications: the problem in plain words first, the fix under it,
  then one quiet line of where it came from, when, how many reports, and what the check found. One primary button.
- **File it…** opens the confirmation sheet (above). Its ellipsis says another step follows, as macOS menus do.
- **Write it up** sends the person's message "Write up the feedback about “<line>”" to the origin's Assistant; it
  shapes it, and File it… appears. Nothing is posted.
- **Not now** opens a menu: Tomorrow, Next week, When it happens again. Undo in the toast.
- **Filed** rows show one status in plain words, each only from its evidence: Waiting to post, Posting, Couldn't
  post, Couldn't tell whether it was posted, Open, Closed as fixed, Declined there, Closed as duplicate, Fixed in
  3.2.23 · update to get it, On this machine, Works, Came back.
- **On this machine** shows "Try it: <how>" (the shipped evidence's words, else the draft's Expected) with Works and
  Still broken. Works folds the row into a Fixed history after a day. Still broken makes it "came back" under Found;
  a comment on the issue is a new draft, through the confirmation sheet.
- **Not now** and **Said no** fold, with counts; each row says when it comes back, with Restore or Undo.
- **Another machine's** problems carry its name on their meta line ([slice 8](#slice-8-every-machines-problems)).
- **Empty:** "Nothing found. When something in Shepherdr doesn't work as it should, your agents note it here."
- **Feedback offers off** in a problem's origin: the row says so and has no actions but Never; a line at the top
  links the setting when it's off everywhere. With the plugin switched off (`service/next.ts`), the row opens
  upstream's old Feedback box, whose message now reaches the draft flow above.
- **Design:** the frontend-design skill, within `web/src/ds.css` (the list's rows, `Btn`, `Cnt`, menus, the
  existing sheet); the better-layout, better-typography and better-accessibility passes; phone and desktop, light and
  dark. A row that leaves collapses in about 150 ms, off under Shepherdr's Motion setting and the system's reduced
  motion. 44 px buttons on a phone. No new shortcuts; Esc closes the sheet. Words checked for "Assistant", "worker"
  and keys, including error and fallback words. Apps followed: Linear (Triage, Inbox), GitHub (notifications, issue
  forms and preview), Sentry (feedback, resolved in release), iOS (sheets, confirmation before sending).

### Report from a failed action

When an action in the app fails, its error toast gets a **Report** button (Sentry's crash-report pattern), through
one hook: `tryAct`'s error toast takes its `act` from the feedback plugin (`web/src/kernel.ts`). Report opens the
Feedback box prefilled with safe words only: the action's own label from the app's fixed list ("Mark as done",
"Start", "Send") and "didn't work", never the error's raw text (which can hold paths, names or a project's words).
The toast keeps showing the error to the person, who may add what they want. Nothing is sent until they press Send,
and what they send is saved as a report `from: {action: "<label>"}` and goes through the draft flow like any other.

### Follow it to live

- **The issue's state.** While a problem is filed or followed and not done, `herdr-task feedback --track` reads its
  issue at most once an hour: `gh issue view` for state and reason, and, for a duplicate, the issue's timeline
  (GitHub's GraphQL `MarkedAsDuplicateEvent`, its `canonical` issue) to follow the issue it points to. The service's
  job runner (`service/jobs.ts`) starts it only when something is followed.
- **In a release, only with evidence.** A closed issue is "Closed as fixed" until a release is shown to contain its
  fix: the commit that closed it (the timeline's `ClosedEvent` closer: a pull request's merge commit, or a commit) is
  in the release tag (`gh api repos/<repo>/compare/<tag>...<sha>`: status `behind` or `identical`). The first such
  stable release is "Fixed in". No closing commit, or a repo with no releases: it stays "Closed as fixed". A closing
  date before a release proves nothing and isn't used.
- **The installed build.** Today's installer record (`installed.json`) holds a version, a source and file hashes,
  but no commit, and several fork builds can share one version. So the installer records its build too: the commit
  it installed from (`git rev-parse HEAD` of a source checkout with nothing changed in it, or the release tag's
  commit for a release), and nothing when it can't know (a changed checkout, a copy without git). An install sent to
  another machine (`bin/shepherdr`'s `pack()` to `INSTALL_THERE`, what the web app's install-on does) carries no git
  metadata, so the pack carries the build: `pack()` writes the source's commit and whether its checkout was clean
  into the pack, and `INSTALL_THERE` records it as is. One small addition at the installer's record and the pack
  (`bin/shepherdr`), pinned by tests. An install without a build is "unknown": no "On this
  machine" from evidence, only the person's Works.
- **On this machine, only with evidence.** The installed build contains the fix commit (the same compare), or an
  install says so itself: `herdr-task feedback --installed <build> --issues <url>…` replaces the list of issues that
  build carries, and is ignored unless `<build>` is the build the installer recorded. An issue not in the newest
  list loses "On this machine" (a rollback, a dropped patch), and so does every issue when the recorded build changes
  to one that wasn't checked. For a fork whose issues stay open while a fix is carried (ours: `Part of`, never
  `Closes`), the install's list is the only signal. Our upstream-sync skill's step 7 runs it after each healthy
  install, from the installed patch list (`fork/patches/`), with each issue's Device check line (#83) as its Try it words.
- **Works / Still broken** are recorded for the build the person has (`tried.build`). A newer build doesn't undo
  Works; a report after it makes it "came back".
- **No push alerts.** A fix reaching the machine adds to the Feedback count only.

### Instructions

One place holds the words for when to capture, shape and ask: the Feedback offers line of the Assistant's "Your
settings" block (`assistant_settings.py`), which upstream already uses to tell Assistants about this setting. It says
that capture now records without asking, the Feedback page holds what waits, the question card is for between things
and always shows the draft, and that the template's "offer once" is done through the page. The command's own output
(as `offer_words` today) gives the exact next step at each point. Upstream's template section stays as it is (the
fork-patch skill: templates are upstream's); if upstream takes this, the words belong in its template instead.

For us, FORK.md's "Every friction is a candidate fix" is brought in line: the Assistant records the friction (`herdr-task
feedback`), says in the same reply what went wrong and the fix in one or two lines, and the person's yes comes on the
page or in chat, on the draft.

### The fork's parts

- **A yes means "file it and fix it".** Fork-only: our feedback repo is our fork, and our FORK.md says a yes to file is
  also the yes to build it; the confirmation sheet says so before Post it. Built in our skills and one small fork
  script, `fork/bin/found`, not in Shepherdr. Its record (`~/.local/state/shepherdr-fork/found.json`, private) holds
  one handoff per issue, keyed by the issue's whole identity (`owner/name#n`):
  1. `pending`: every `found` run first sweeps the feedback record (`herdr-task feedback --list --all --json`,
     read-only) and makes a pending handoff for each approved new issue in our repo that is `posted` and has none
     yet, however it got there: a post with an answer, or one found later by reconciling. The filing Assistant runs
     `fork/bin/found` right after it files; our daily not-filed run runs it too, so a post found by reconciling is
     handed off within a day. A comment on an existing issue makes no handoff.
  2. `sent`: `found` sends this repo's space's Assistant the issue's link with `herdr-task tell-assistant`. A send
     that fails or times out stays `pending`; every `found` run sends each pending one again.
  3. `taken`: the receiving Assistant runs `fork/bin/found took <issue> --task <task>` once the work is in a task, a
     new one or a running one it replied to (`herdr-task reply` leaves the brief as it was, so the brief can't be
     the record). `found.json` keeps that issue-to-task link, and the receiver asks `found` first (`fork/bin/found
     task <issue>`): an issue already taken is not added again, so a message that arrived twice makes one piece of
     work. A handoff `sent` but not `taken` after a day is sent again.

  That Assistant shapes it (check upstream first, #83) and adds it to a running task when it fits (FORK.md), else adds
  a task.
- **The upstream decision** stays as the upstream-issue skill has it: a live fix that works is `not-filed` until the
  person says file it, keep it ours or undo it. The page makes "Works" visible first. An "Offer it to Shepherdr's
  makers" button on a working row is left for later.

## Shepherdr or our fork

| Part | Where | Why |
|---|---|---|
| Save before telling, read-only lists, nothing expires undecided, the new identity, spaces | Shepherdr (`feedback.py`) | Every user loses reports today |
| The Feedback page, its count, Not now, Never, Follow | Shepherdr (plugin `feedback`, a hook in `list.tsx`) | Every user |
| Shaping, the checks | Shepherdr (`feedback.py`, the plugin) | Every user |
| Drafts, the confirmation sheet, approvals, filing once | Shepherdr (`feedback.py`, the plugin, `core/send.js`, `core/chat-log.js`) | Every user, and safer than today's filing |
| Report on a failed action | Shepherdr (a hook in `kernel.ts`, the plugin) | Every user |
| Following the issue, the installed build, release and install evidence, Works | Shepherdr (`feedback.py`, `bin/shepherdr`'s record, `service/jobs.ts`, the plugin) | Every user |
| Every machine's problems | Shepherdr (`service/feedback.ts`) | Anyone with linked machines |
| The settings-block words | Shepherdr (`assistant_settings.py`'s Feedback offers line) | Upstream's way to tell Assistants about a setting |
| "File it and fix it", the handoff, the task | Our FORK.md, skills, `fork/bin/found` | Only a fork builds its own fixes |
| `--installed` from the install step; Device check as Try it | Our upstream-sync skill | Our pipeline |
| Check upstream's main, the maintainer's words (#83) | Our skills | Deeper than a release check |
| File it, keep it ours or undo it upstream | Our upstream-issue skill | Our decision process |

## Ban rules and privacy

- **Nothing posts without the person's yes, for that exact text.** Every GitHub write (issue, comment) is a stored
  draft revision the person approved on a screen that showed it, posted once by an Assistant through `--file`. The
  service and the following only read (`gh issue view`, `gh issue list`, `gh search`, `gh release list`, `gh api`
  reads), with the person's own `gh`.
- **The tap is the person's message.** Post it and Write it up send a message the person chose to send, as a
  suggested-reply bubble does. Nothing types keys, slash commands or menu choices into an agent; no agent prompt is
  answered for the person. News reaches Assistants the way it does today (herdr-task's held news, sent only while the
  person isn't writing).
- **No agent internals.** Nothing reads an agent's sign-in, tokens, usage, limits or settings files, or drives its
  interface. The only outside tool is `gh`, GitHub's official CLI, with documented commands and the documented REST
  and GraphQL APIs. No agent account is touched, so docs/agents-and-terms.md needs no new row; each slice's pull
  request says so.
- **Other machines:** read with `hc exec --on <machine>`, herdr-core's own way to run a command there, never
  `herdr-task --on` (which copies its bundle over), and never installing or updating anything there.
- **The repo may be public.** Agents write reports and drafts in public-safe words first. Then upstream's `redact()`
  (secrets, tokens, emails, home paths, tailnet names, IP addresses, the machine's and account's names), plus, new:
  a whole home path is removed, not shortened to `~/…` with the rest left; and the names of the person's spaces,
  folders and repos other than the feedback repo and Shepherdr's repo. The person reads the redacted draft before
  Post it. A problem whose words can't be made public stays on the page; Never or Not now keeps it local.
- **Searches leave the machine too:** only the `search` words an agent wrote, redacted again; never the raw line or
  details.
- **Never in a report or a post:** analytics, logs pasted whole, raw error text from the app, the person's project
  code or private repo content, settings values. Upstream's rule stays.
- **Off means off** in a space: nothing new recorded from it; nothing checked, followed or posted for a problem whose
  origin it is.

## Edge and failure cases

| Case | What happens |
|---|---|
| `gh` not signed in, or offline | Check and follow say "GitHub isn't reachable here" on the row. Filing ends `refused` with gh's words when nothing went out, else `unsure`. |
| The post went through but its answer was lost | `unsure`; reconciling finds the marker in the repo's issues: `posted`. Never posted twice by itself. |
| The process died while posting | A `posting` older than 10 minutes is `unsure`, reconciled the same way. |
| The marker can't be found after an unsure post | It stays `unsure`, read-only: Check on GitHub and Check again. It is never posted again; if it truly isn't there, the person says Never and reports it anew. |
| The space has no Assistant running | The report is saved and shown. Post it and Write it up go to Everything's Assistant; the row says so. |
| Two devices tap at once | The record's lock; the second action finds the state changed and says so ("Already approved"). |
| Post it, then Never before the Assistant filed | The approval is cleared; the late `--file` is refused; the Assistant says it in one line. |
| The draft changes after Post it | A new revision: the old approval no longer matches; File it… shows again for the new text. |
| The feedback repo changes after Post it | The approval names its target: `--file` refuses; File it… shows again. |
| The origin's Feedback offers switched off after Post it | `--file` refuses; the row says offers are off there. |
| A problem reported in two spaces | One row, both reports, the first space as origin. |
| A linked machine can't be reached | Its rows show as of its last read, marked stale, with their actions off until it answers. |
| A linked machine on an older Shepherdr | Its rows show read-only, with "Update <machine> to act on these". |
| An old record (upstream's shape) | Reads as before; `told` and `offered` show as found; nothing is rewritten until a problem changes. |
| An issue closed as duplicate | Followed through its canonical issue when the timeline names one; else "Closed as duplicate". |
| Reopened upstream after "Fixed in" | `outcome` goes back to open; `shipped` and `tried` stay as they were, for their build. |
| A rollback or a dropped patch | The recorded build changes, or the next `--installed` list leaves the issue out: "On this machine" goes away. |
| The fork's handoff message is lost, or arrives twice | Pending ones are sent again; the receiver looks for a task carrying the issue first: one task. |

## Build plan

Each slice is one task, added `--after` the slice it names (or this spec), small enough to review in one sitting.
Each is a patch (fork-patch skill): its own issue labelled `patch` that links #94, its own `fork/patches/<n>.json`, tests
pinning the upstream seams it relies on, and upstream's style. UI slices use the frontend-design skill plus
better-layout, better-typography and better-accessibility, follow the Motion setting, and screenshot phone and
desktop, light and dark. Each starts with the "check upstream first" rule (#83). Slices 1 and 2 alone fix the loss in
the evidence. Each slice's demo starts from an ordinary report, not a hand-made record.

### Slice 1: every report is kept

- **After:** this spec.
- **What the person gets:** nothing visible yet; no report is ever dropped, and the next slice can show them all.
- **Files:** `mods/tasks/bin/herdr_task/feedback.py` (save the report before telling; keep it with no Assistant
  running; the new identity, matched with upstream's key; `id`, `space`, `reports`, `fix`, `kind`; a report only from
  a space with offers on; `--list --all --json` read-only, no pruning on read; an unreadable record kept aside;
  nothing undecided expires), `cli.py` (flags), `launch.py` (the brief's feedback line mentions `--fix`),
  `fork/patches/<n>.json`.
- **Tests:** a new `test/test_feedback_found.py`: a report with no Assistant is kept; a repeat adds a report and sends
  news once; with an old declined row seeded for each, "is not shown" after a declined "is shown" is a new found
  problem, and a second Japanese line after a declined first is too; an old row still takes a report of its own
  line; a report from the web app with `--space` of a space with offers off isn't recorded; a report from a space with offers off isn't recorded; a second space's report keeps
  the first as origin; `--list --all` changes nothing on disk; a corrupt record is kept aside, not overwritten; an
  undecided problem older than 90 days is still listed; an upstream-shaped record reads unchanged. Pins: `key_of`,
  the record's lock, `redact`, `--list`, `--file` and `--no` keep their names and arguments.
- **Demo:** a throwaway `HERDR_TASK_STORE`, a fake hc with no Assistant: report twice with `herdr-task feedback`;
  `feedback --list --all --json` shows one problem with two reports.

### Slice 2: the Feedback page, decisions that stay local

- **After:** slice 1.
- **What the person gets:** the Feedback row's count; the page with Found, Filed (upstream's filed ones, with their
  links), Not now, Said no; Not now, Never, Undo; Write it up. No File it yet: filing stays upstream's chat flow until
  slice 4.
- **Files:** `feedback.py` (`--later`, the person's `--no`, `--undo`, and `--person --space <id>` for what they
  write in the box, each refused in an agent's terminal), `web/plugins/feedback/`
  (`client.tsx`, `rows.tsx`, `words.ts`, `feedback.css`), `web/plugins.json`, `service/next.ts` (its switch),
  `service/feedback.ts` (reads the list on the service's tick; the actions), one case in `service/actions.ts`,
  `web/shared/types.ts`, `web/src/list.tsx` (the row's count and opening the page; upstream's box when the plugin
  is off), the Feedback box saving before it sends, `web/demo/data.ts`, `docs/plugins.md`.
- **Tests:** `service/feedback.test.ts` (list read, a failed read keeps the last list, actions, refused from a
  terminal); `web/plugins/feedback/feedback.test.tsx` (sections and counts, Not now's menu, Undo, empty and off,
  the plugin off opens the old box, no "Assistant" or keys in any words, the box keeps text when saving fails).
- **Demo:** report two problems with `herdr-task feedback` on a throwaway service (AGENTS.md: "A throwaway real
  service"), open the Feedback row: both, Not now one; then the demo's data at 390 and 1280, light and dark.

### Slice 3: shape and check

- **After:** slice 2.
- **What the person gets:** each row has its fix in one line, and says whether it was fixed or declined before,
  whether Shepherdr's makers already have it, and whether a newer version is out; Follow this one.
- **Files:** `feedback.py` (`--shape --fix --search`; `--check` run on shaping and before posting: open and closed,
  Shepherdr's repo when different, the newest release; Follow), `assistant_settings.py` (the Feedback offers line:
  record without asking, shape when free, public `search` words), `web/plugins/feedback/rows.tsx`.
- **Tests:** with a fake gh (`HERDR_TASK_GH`): shaping writes the fix and starts the check; a closed completed match
  says "Fixed before", a not-planned one "Declined before"; a fork feedback repo also searches Shepherdr's repo, and
  its matches offer Follow only; a newer release is named; no check runs without `search` words; the search sends
  only those words, redacted; gh failing leaves the row as it was; Follow posts nothing; the settings line names the
  page.
- **Demo:** report a problem, shape it as an Assistant would (`--shape --fix … --search …`) with a fake gh holding a
  closed issue and a newer release; the row shows the fix, both lines and Follow.

### Slice 4: the yes for the exact text, posted once

- **After:** slice 3.
- **What the person gets:** File it… opens the exact text and where it goes; Post it is the yes for that text only;
  it is never posted twice; the row shows each step.
- **Files:** `feedback.py` (drafts with revisions and whole targets; `--approve`; `--file --rev` posts the stored
  draft with its marker; `--file` without a revision answers with the draft and the next step; `posting`,
  `refused`, `unsure`, reconciling by the marker; Not now and Never clear approvals), `assistant_settings.py` (the
  card shows the draft), `core/send.js` and `core/chat-log.js` (the hidden `<hc feedback>` line),
  `web/plugins/feedback/rows.tsx` and `confirm.tsx` (the sheet).
- **Tests:** `--file` without a matching approval is refused; `--file` with no revision writes a draft and posts
  nothing; a changed draft needs a new approval; a changed target is refused; a comment's target names its repo
  (an upstream issue and a fork issue with one number are told apart); a successful post whose answer is lost, with
  the marker missing from search but present in the repo's issues, ends `posted` with one post; a successful post
  whose marker is absent from every reconciling read stays `unsure`, and no command or button posts it again; a
  restart from `posting` ends `unsure` and posts nothing; a 4xx before any write ends `refused`; Never after Post it
  makes the late `--file` refuse; the posted body is byte for byte the approved draft; the hidden line never shows in
  the chat; the old Feedback box's message and upstream's chat `--file` reach a draft, not a post, and the draft's
  output ends with the `agents.feedback_note` line when one is set.
- **Demo:** a fake gh that posts and then drops its answer: one issue, the row says Filed.

### Slice 5: follow the issue

- **After:** slice 4.
- **What the person gets:** Filed rows say Open, Closed as fixed, Declined there, or Closed as duplicate (and follow
  the issue it points to).
- **Files:** `feedback.py` (`--track`: state, reason, the canonical issue from the timeline), `service/jobs.ts`
  (hourly, only while something is followed), `web/plugins/feedback/rows.tsx`.
- **Tests:** a fake gh's closed completed, not planned, and duplicate with a `MarkedAsDuplicateEvent`; reopened goes
  back to open; the job doesn't run with nothing followed; gh failing keeps the last outcome.
- **Demo:** file a problem through slice 4's demo, close the fake issue, run `--track`: the row says Closed as fixed.

### Slice 6: on this machine, and works

- **After:** slice 5.
- **What the person gets:** "Fixed in 3.2.23 · update to get it", "On this machine", Try it, Works and Still broken;
  "came back".
- **Files:** `bin/shepherdr` (the installed build in its record, and carried in `pack()`), `feedback.py` (the closing commit, the compare
  against release tags and the installed build; `--installed`; `--works`, `--broken`; came back),
  `web/plugins/feedback/rows.tsx`, `test/test_install.py` (the record's build).
- **Tests:** the installer records the build of a clean checkout and none for a changed one (throwaway root); an
  install through `pack()` and `INSTALL_THERE` records the source's build, and a same-version update sent that way
  from another build records the new one; a
  closed issue with no closing commit stays "Closed as fixed"; a release whose tag contains the commit gives "Fixed
  in"; the installed build containing it gives "On this machine"; an older one says update; an install with no build
  shows no "On this machine"; `--installed` for a build that isn't the recorded one is ignored; a same-version update
  to another build clears it; a rollback's list without the issue takes it away; Still broken is found again, linked,
  and its comment is a draft; a report after Works is "came back".
- **Demo:** on a throwaway root and store: install, close the fake issue with a commit the build has, `--track`: On
  this machine, Try it.

### Slice 7: report from a failed action

- **After:** slice 4.
- **What the person gets:** a failed tap's error has Report; two taps later their words are on the Feedback page.
- **Files:** `web/src/kernel.ts` (one hook: `tryAct`'s error toast takes `act` from the plugin),
  `web/plugins/feedback/report.ts` (the action's label from the app's fixed list, the prefilled box).
- **Tests:** an error toast has Report with the plugin on and none with it off; the prefill holds the label and no
  error text; nothing is sent without Send; a sent one is a report `from: action`.
- **Demo:** a new demo case, `?case=fail`, whose actions answer with an error (`web/demo/serve.ts`; today's demo
  answers every Mark as done with success): tap Mark as done, Report, see the box with "Mark as done didn't work".

### Slice 8: every machine's problems

- **After:** slice 2 (its actions grow with slices 3 and 4).
- **What the person gets:** problems recorded on every linked machine, each with its machine named, decided from one
  page.
- **Files:** `service/feedback.ts` (each linked machine's list through `hc exec --on <machine> -- sh -c 'exec
  "$HOME/.local/bin/herdr-task" "$@"' herdr-task feedback --list --all --json`: the explicit path herdr-task's own
  remote calls use (`cli.py`), because a core started by launchd or systemd hands remote commands a bare PATH; without
  their install fallback: a machine with no herdr-task there shows "Shepherdr isn't set up on <machine>" and
  nothing is installed. Read-only; rows keyed by machine and id; actions routed the same way; a machine whose
  herdr-task lacks the command shown read-only), `web/plugins/feedback/rows.tsx` (the machine line, stale rows).
- **Tests:** two machines' lists merge, one id on both stays two rows; listing and an action work with the remote
  command's PATH set to `/usr/bin:/bin`; a machine without herdr-task installs nothing and says so; an unreachable
  machine's rows are stale and their actions off; an older machine's rows are read-only; an action goes to its row's
  machine; no call uses `herdr-task --on`.
- **Demo:** two throwaway cores (AGENTS.md: "Two throwaway cores on one VM"), a report on each, both on the page.

### Slice 9 (fork): file it and fix it

- **After:** slice 4; its `--installed` part after slice 6.
- **What the person gets:** in this fork, every yes to file becomes work in this repo's space, once, and each install
  tells the page what it carries.
- **Files:** `fork/bin/found` (the sweep, `took`, `task`, resending pending ones), `fork/tests/test_found.py`, FORK.md ("Every
  friction is a candidate fix" in line with the page), the shaping-a-request and upstream-sync skills (step 7 runs
  `--installed`), and `agents.feedback_note` (a new Everywhere text setting, empty by default: one line the
  confirmation sheet shows above Post it; ours, in the person's settings file: "Posting also starts a fix in this
  repo's space"), in `feedback.py`'s settings and the sheet.
- **Tests:** a handoff is made once per issue identity; a comment makes none; a post found `posted` only by
  reconciling gets a handoff on the next run; a failed send stays pending and is sent again; a delivered message
  whose answer was lost, sent again, makes one piece of work (`found task` answers with the first one), for a new
  task and for a reply to a running one; `took` closes it; the message holds the issue's link and no private words; `--installed` gets the installed
  patch list's issues (`fork/patches/`) with the installed build.
- **Demo:** a scratch store: approve and file a problem to a fake repo, claim it, fail the first send, run again:
  one message, one task.

### Later, not planned yet

- **Offer it to Shepherdr's makers** on a working row, for anyone who files to a fork.
- **A friction digest** for people who want one: the found count in the morning, an ordinary schedule they create.

## Second opinion

Codex (gpt-6.2-sol, high, read-only) read the first draft against `feedback.py`, the Assistant's template, FORK.md and
AGENTS.md. Its verdict: approve a narrower spec for durable capture and a quiet inbox; hold public writes and live
status until the yes survives retries and every status has evidence. What changed:

| Its point | What the spec does now |
|---|---|
| The yes wasn't tied to the posted text; `--file` rebuilds the body | Drafts with revisions; an approval for one revision, destination and action, used once; `--file` posts the stored draft byte for byte |
| Text left the machine before anyone reviewed it (background search, raw error text) | Searches use only `search` words an agent wrote, redacted; no raw error text anywhere; public-safe words first, redaction second; whole home paths removed |
| A lock and a 10-minute timer don't make filing safe to retry | Persisted post states, a hidden marker in the body, a marker search before any retry; Never after File it makes the late filing refuse |
| A filed issue isn't permission to build; several spaces may match | The generic "news to the repo's space" is gone; the fork claims an issue once through its own script, a comment claims nothing |
| Closing date plus a later release doesn't prove a release has the fix | "Fixed in" only when the release tag contains the closing commit; "On this machine" only from the installed build or an install's own list, cleared on rollback |
| Word-overlap merging could join opposite reports | Dropped: identical keys count; linking is an agent's or the person's choice; every report kept |
| Save before telling; reads rewrite the file; undecided rows expire | Saved first, kept with no Assistant; reads never write; a corrupt file kept aside; nothing undecided expires |
| No way to follow an existing issue without posting | Follow this one; decision, GitHub outcome and this machine's evidence kept apart |
| Three sets of words about when to ask | One place: the Feedback offers line; FORK.md brought in line |
| Off per space vs a global page; `--no` needs an agent | Off is the originating space's; person-only commands for Not now and Never, refused in an agent's terminal |
| The fleet view's `--on` can install on the other machine | Its own slice (8), read through `hc exec --on`, never `herdr-task --on`; stale and older machines read-only |
| Slices too big; fuzzy merging, emoji and the toast up front | Re-sliced: keep, show, shape and check, approve and post, follow, ship and works; the toast and every machine after; the fork last. Fuzzy merging dropped; an emoji is only a clue |

Where we didn't follow it: it suggested editing upstream's template alongside the settings line. Our fork-patch
rule keeps templates as upstream's, so the words go in the settings line and the command's own output, with a note
that they belong in the template if upstream takes it.

## Review

The first review round (Codex, read-only) found nine must-fix points, each now in the spec: a lost answer stays
`unsure` and is reconciled from the repo's own issues, never posted again by itself; the only approval is Post it on a
sheet that shows the exact draft, and upstream's card, template and old box reach the draft instead of posting; a
comment's target names its whole repo, and Shepherdr's-repo matches are Follow only when filing to a fork; a new
identity keeps negations and non-Latin words; each report keeps its space, and the origin's setting is checked before
every check, follow and post; the installer records the build it installed; shaping and its search words move into the
check's slice; the fork's handoff is pending until taken, sent again, and made one task at the receiver; and failed
actions and linked machines have their own slices. Its two minor points (the canonical duplicate's API, the 12-hour
offer quiet time) are fixed too.

The second and last round found four of those fixed and seven not fully, each now in the spec, not reviewed again: an
unsure post is never posted again by anyone, and reconciling reads every issue or comment since the attempt began;
the chat path shows the same Settings line as the sheet; an old row takes a new report only when the new keys match,
so an old collision never inherits a Never; the web app's reports carry their space; an install sent to another
machine carries its build in the pack; the fork's handoff is seeded from the record, so a post found by reconciling
is handed off too, and the issue-to-task link is kept in the fork's record, not read from briefs; and linked machines
are read through herdr-task's explicit remote path, with no install. Its minor point: the failed-action demo gets a
case whose actions fail.

## Not in this spec

- Automatic capture from agents' terminals, logs or crash dumps: judging work in code, and logs must never leave.
- Push alerts for found or fixed problems: nothing here is urgent.
- Voting, priorities or assignees: one person, one list.
- Changing upstream's templates.
