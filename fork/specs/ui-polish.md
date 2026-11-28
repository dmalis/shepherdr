# UI polish and speed

Part of #132. The audit of every page but Settings, against [docs/design.md](../../docs/design.md), and the plan
that builds its Target lines in small slices. Each slice is one task, one area, small enough to review in one sitting.
Every UI slice reads docs/design.md first and uses the UI skills (FORK.md: "All UI work uses the UI skills").

## The need

The person lives in Shepherdr all day: an iPhone home-screen app between other work, a desktop browser beside their
editor. They run several repos and spaces, a dozen-plus tasks a day across two machines, and come back to ask: what
needs me, what is stuck, what just landed, what is going on in project X. They asked for one consistent, polished,
device-fitted interface; readability and ease of writing; haptics or sounds where they help; better task filters and
per-row actions; swipe actions; and speed, "as I live inside this UI".

The two biggest daily costs found are **a message box that can lose parts of a draft** and **a Tasks list that makes
you read too much before you know where to act**. The biggest measured costs are **the uncompressed first load** and
**long chats that scroll with a p95 frame of 143 ms on a phone**. The plan starts there, ahead of the visual cleanup.

## How it was audited

- **Screenshots:** the demo build (`bun web/demo/serve.ts`), every page and state but Settings, at 390 px (touch, and
  with the keyboard up where typing), 820 px (touch) and 1440 px, in light and dark, and night for the main pages:
  258 pictures, named `<page-or-state>--<phone|tablet|desktop>--<light|dark|night>`. The contact sheets are in the
  proof page.
- **Code:** every stylesheet (`web/src/*.css`, `web/plugins/*/*.css`), the inline styles in the plugins, the motion
  code (`web/src/motion.ts`), the message box (`web/plugins/chat/client.tsx`, `web/src/kernel.ts` drafts), the task
  list and filter (`web/shared/view.ts`, `web/shared/task-filter.ts`, `web/plugins/tasks/`).
- **Measurements:** `web/demo/perf-check.ts` (added here), below.
- **Co-designed with Codex** (GPT-6.2 Sol, high effort), three rounds: the audit, a red team of the drafts against the
  code, a final pass. [Codex rounds](#codex-rounds) says what each changed.
- **Compared with** Linear, GitHub (Primer, notifications, pull request lists), Vercel's Geist, VS Code, Raycast,
  Slack, Figma, Notion, Things, Apple's HIG, Material 3, Radix and shadcn, Refactoring UI; for writing, ChatGPT,
  Claude, Slack, iMessage, Linear's comments and GitHub's editor.
- **Upstream checked:** v3.2.22, main 68be781. Related and closed: "Typing in the message box lags on a phone: layouts
  on each letter", "Scrolling the board is slow: every frame draws every row", "Scrolling up into a folded long reply
  makes the chat list go blank", and upstream's "Even spacing of chat rows: one rhythm and one left edge". Nothing
  open on a design document or app speed.

## Findings

Each finding names its screenshots (`<scene>--<width>--<theme>`, in the proof page) or its code, and the slice that
fixes it. **High** hurts every day, **medium** is visible and inconsistent, **low** is polish.

### Writing

| | Finding | Evidence | Slice |
|---|---|---|---|
| high | Holding a suggested reply to edit it replaces the whole draft, and only a long press reaches it | `editSug` calls `setText(t)`, `web/plugins/chat/client.tsx` | 8 |
| high | A reloaded draft keeps its words and folded pastes but loses its attachments, the message it replied to and what each `@`/`#` pointed at, so it can look ready and send less. A file's bytes and its upload live only in memory; a failed upload is dropped | `web/src/kernel.ts` drafts hold text and folds | 7 |
| high | With the keyboard up and a long draft, the words get about 210 of the box's 358 px: the + and the mic keep their own columns, about 25 characters a line | `box-long-draft-keyboard--phone--light`, `box-long-draft--phone--light` | "Chat box: two rows again" is fixing it now |
| medium | A long paste folds into a chip but is sent, and put back by Edit, at the end of the draft, not where it was pasted | `web/plugins/chat/fold.ts`, `editPaste` | 8 |
| medium | "Replying to …" above suggested replies reads as part of the chat, and stays while typing hides the replies | `space-chat--phone--light`; `.sugfor` in `web/plugins/chat/reply-bubbles.css` | 8 |
| medium | The @, # and / lists are capped at `40dvh` whatever the keyboard leaves and don't scroll the chosen row into view | `box-at-list--*`, `box-hash-list--*`, `web/plugins/chat/mentions.css` | 9 |
| low | Typing a 2000-character draft is in budget today (p98 32 ms at 4×), but each key press writes every chat's drafts to storage | `store('shepherdr.drafts', …)` in `web/src/kernel.ts` | 7 |

### Tasks for a day of many projects

| | Finding | Evidence | Slice |
|---|---|---|---|
| high | The Needs you group, the State filter's "Needs you" and the counts use different rules: a ready task shows under Needs you and vanishes when you pick "Needs you" | `nowGroups()` in `web/shared/view.ts`, `web/shared/task-filter.ts`, `web/src/needs-count.tsx` | "Needs you 5: one list" |
| high | Within Needs you, five green reviews sit above the first red question: what blocks an agent comes last | `tasks-now--phone--light`, `tasks-everything--phone--dark` | "Needs you 5: one list" |
| high | Every filter is in one long sheet: State, Machine, Space, then Repo below the fold; 3 taps on a phone, no one-tap views for the day's questions; counts are for everything, not the current view | `tasks-filter-menu--phone--light` | 12 |
| medium | "This space only" counts tasks that work for the space (`t.also`), the Space filter counts where they were asked, and Repo is `machine:folder`: the person read "#space only" as a repo filter | `web/shared/task-filter.ts` | 12 |
| medium | A row on a phone is 3 to 4 lines (~100 px) | `tasks-everything--phone--dark` | 13 |
| medium | A task's header cuts its status and keeps the model whole: "Ready for revi…" beside "Opus 5.5 · High" | `task-ready-review--phone--light` | 13 |
| medium | Opening the pull request or replying from the list takes the row's menu: 2 to 3 taps | `tasks-now--desktop--light`, `taskRows()` | 13 |
| medium | The merge card's words read like a setting ("Merge in this repo is When I mark it as done"); its buttons stack ragged and right-aligned on a phone; "Not now" leaves it under Needs you without saying so | `task-ready-review--*`; `web/shared/ready-words.ts` | 14 |
| medium | A slide right replies; nothing slides left, as Mail and Things do | `web/plugins/chat/slide.tsx` | 16 |
| medium | Alert rows cut the task's name while the kind and status keep their room; the row's `aria-label` replaces its body, place and status | `alerts-bell--desktop--light`; `web/plugins/inbox/client.tsx` | 15 |

### Readability and colour

| | Finding | Evidence | Slice |
|---|---|---|---|
| high | Light `--muted` (#737373) is 4.35:1 on an agent's bubble and 3.76:1 on your own: fails AA | contrast table below | quick win, here |
| high | A row dimmed with `opacity: .6` (a machine that can't be reached) takes its second line to 2.30:1 in light, 3.41 in dark | `.row.dim` in `web/src/ds.css`; `case-down--*` | 11 |
| medium | Control edges drawn with `--line2` alone (an unticked filter box) are 1.32 to 1.44:1, under the 3:1 a control needs | `tasks-filter-menu--*` | 11 |
| medium | Red means Needs you, and also Stopped, recording, errors, danger and deleted lines, in the same places | `ds.css`, `dictate.css`, `diff.css` | 11 |
| medium | Code is 13 px on touch and a diff 12 px; markdown h1 to h4 look the same; a wide table in a phone's bubble cuts its next column with no sign there is more | `everything--phone--light`; `web/src/styles.css` `.md` | 11 |
| medium | Type sizes beside the scale: 10, 11 and 15 px in places; monospace written out 9 times; icons at 14, 16 and 20 for one role | `test/test_design.py`; inventory | 6 |
| low | Dark and night demo artifacts show light words on a white page | `artifact-open--phone--dark` | 18 |

### Rhythm, surfaces and states

| | Finding | Evidence | Slice |
|---|---|---|---|
| medium | Chat news rows have uneven gaps (12 px pads on touch around 20 px lines); a task's choice chips sit 4 px from the next, unrelated bubble | `space-chat--phone--light`, `space-chat--desktop--dark` | 10 |
| medium | The "waiting at a prompt" banner cuts its words to "is waiting at a…" while "View as terminal" takes a third of it; several stack above the box | `space-chat--phone--*`; `Stuck` in `web/plugins/terminal/client.tsx` | 10 |
| medium | Hover styles on `.row`, `.btn`, `.ib`, `.tile` are unconditional, so a tap can leave one lit; a press shows on some controls and not others | `web/src/ds.css` | 6 |
| medium | Radii in 15 values, gaps in 12, z-index in 9 with no scale, transitions in 5 durations with mixed easings, 59 inline styles | inventory | 6 |
| low | The 16 px content edge is made of different sums per pane; an empty Files folder's note starts 30 px further in | `files--*`; `web/plugins/files/client.tsx` | 17 |
| low | Day labels clip under the header at the top of a chat on a desktop | `space-chat-top--desktop--light` | 10 |
| low | Files, Changes and chat each say "empty", "loading" and "offline" their own way | `case-empty--*`, `case-empty-tasks--*`, `changes--*` | 17 |

### Motion and feedback

| | Finding | Evidence | Slice |
|---|---|---|---|
| high | A waiting picture pulses its colour forever (`.prev.wait`): ~60 style recalculations a second while it shows, off screen too, and it ignores Motion › Reduced | `web/src/styles.css`; `web/plugins/artifacts/client.tsx` `Preview` | 2 |
| high | About 10 CSS rules follow Motion › Reduced; list reordering and the keyboard's glide check only the device's setting (`still()`) | `web/src/motion.ts`, `web/src/viewport.ts` | 5 |
| medium | A pushed screen (440 ms) and a sheet (460 ms) are long for things done many times a day | `PUSH_MS`, `SHEET_MS` | 5 |
| medium | `buzz()` gets an iPhone haptic by clicking a hidden native switch from script when a machine's heading is held to drag: not documented behaviour | `web/src/motion.ts`, `web/src/list.tsx` | 19 |
| low | The slide's `tick()` vibrates on Android with no setting | `web/plugins/chat/slide.tsx` | 19 |

## Performance, measured

**How:** `bun run build`, a fresh `bun web/demo/serve.ts 7841`, then `bun web/demo/perf-check.ts 7841`, at commit
c7b2c53e, headless Google Chrome 158 (playwright-core) on a 4-core Linux VM. Each run starts with empty storage and a
cold cache, except the warm load. "Phone" is a 390 × 844 touch context with 4× slower CPU over 1.6 Mbps down,
750 kbps up and 150 ms. The demo serves files uncompressed and without caching, as the service does today, so the
cold load is the service's too. One run each; the slices re-measure with three runs and report the middle one.

- **Loads:** bytes on the wire (CDP `encodedDataLength`), first contentful paint, and "ready" (the first message or
  empty state on screen). The bundle's split by module is from the build's source map (raw bytes), and its
  compressed size is gzip −9.
- **Typing and switching:** Event Timing (`interactionId`, duration from the input to the next paint, in steps of
  8 ms): typing a 90-character line at 60 ms a key into the space's box, with an empty and a 2000-character draft;
  switching opens 12 spaces from the list once each, at 4× slower CPU.
- **The long chat:** 400 messages sent to the demo's #blog by the API (a short line, bold, a list with code, a
  6-sentence paragraph, in turn) on top of its 11, then opened at full speed (time to its first bubble), then
  scrolled up 120 px a frame for 120 frames at 4× slower CPU; frame times are the time between animation frames.
- **Live updates:** 300 messages sent to two other spaces while one space is open; script per message handler call,
  DOM changes per update, and the heap after a forced GC.
- **Idle:** 20 s with nothing happening, Performance metrics (style recalculations, layouts, task time).

| What | Before | Budget (docs/design.md) |
|---|---|---|
| Cold load on a phone | ~1 MB over 12 requests; first paint 6.2 s, ready 6.3 s; 3 long tasks (215 ms) | first screen's script 250 kB sent |
| Main script | 847 kB raw, 283 kB gzip: react-dom 202, `web/src` 174, chat 84, core 45, marked 45, screens 36, tasks 31, shared 29, dompurify 29, voice 28 (raw kB) | 250 kB sent |
| A key press, phone | p98 32 ms with an empty and a 2000-character draft | p98 50 ms |
| Switching spaces, phone | p98 104 ms (32 ms at full speed) | p95 100 ms, warm |
| Scrolling the 411-message chat, phone | frames p50 17 ms, p95 143 ms; 43 of 120 over 33 ms; 9 long tasks (506 ms) | p95 33 ms |
| Opening that chat | 785 ms, 1839 nodes | measured apart (a first load) |
| 300 live updates | 0.22 ms per message, ~1 ms of script, ~9 changes in the page each; no long task | p95 4 ms |
| Memory over those updates | heap 4.1 → 6.2 MB, nodes and listeners flat | no growth after the first minutes |
| An idle page with a waiting picture | ~60 style recalculations a second, ~486 ms of work per 20 s | none |
| A hidden page | not measured: headless Chrome keeps it visible | none |

Contrast of `--muted`, by surface (WCAG ratio; AA needs 4.5):

| | Page | Field | Bubble | Your bubble |
|---|---|---|---|---|
| Light, today (#737373) | 4.74 | 4.54 | **4.35** | **3.76** |
| Light, this pull request (#666666) | 5.74 | 5.50 | 5.27 | 4.56 |
| Dark | 7.43 | 7.85 | 6.61 | 5.01 |
| Night | 8.33 | 7.85 | 7.11 | 5.77 |

**The speed order:** compression (1) and the still waiting picture (2) at once, both small; then the startup chain
(3) and profiling the long chat (4); then the long chat's fix and any further splitting, each only as far as its
measurement shows.

## Build plan

Each slice is one task. Every UI slice: read docs/design.md first, use the UI skills (FORK.md), check it as
docs/design.md's "Check it" says, lower `test/test_design.py`'s counts for what it removes, and turn the Target lines
it builds into rules in docs/design.md in the same pull request. "After" names what to wait for; a slice without one
can start at once. "Task row: name its space" and "Urgent 1: the mark" have merged.

**Quick win in this pull request:** light theme's `--muted` from #737373 to #666666 (`web/src/ds.css`), so the page, a
field and both bubbles pass AA (table above). Dark and night already pass.

### Speed

1. **Sent compressed, cached right.** The service sends the app's files compressed: brotli, else gzip, else plain, by
   `Accept-Encoding` with its q-values (`q=0` refuses, `*` counts), `Vary: Accept-Encoding` on every answer, made at
   build time beside each hashed file (or a bounded cache keyed by file and encoding) and never for `index.html`'s
   stale copy. A missing `assets/` file answers 404, not `index.html` marked immutable (`file()` in
   `service/main.ts` does that today). No ETag today; if one is added, one per encoding, with a conditional GET test.
   Files: `service/main.ts`, `web/build-plugins.ts` or the build script. Tests: service tests for brotli, gzip,
   plain, `q=0`, HEAD, the decoded body equal to the file, MIME and security headers kept, cache headers, a stale
   asset's 404; the same through a throwaway service and `web/demo/live.ts`, and through `/shepherdr/` behind
   tailscale serve on the dev machine. The demo's own handler (`web/demo/serve.ts`) stays plain. Before: 283 kB gzip
   sent as 847 kB; first paint 6.2 s on a phone. After: sent compressed; first paint re-measured. After: none.
2. **A still waiting picture.** `.prev.wait` gets a still placeholder and fades in once loaded, its retry and its
   first-lines fallback kept. Files: `web/src/styles.css`, `web/plugins/artifacts/client.tsx`. Tests: a demo check
   with the pictures blocked (`?case=nopics`): no running animation (`document.getAnimations()`), style
   recalculations near zero over 10 s; `test_design.py`'s endless count down. Before: ~60 recalculations a second.
   After: none. After: none.
3. **Start without waiting in line.** The page today loads every plugin statically in one script, and `start()`
   (`web/src/main.tsx`) would await lazy plugins one by one before asking `/api/me`, connecting and drawing. Ask
   `/api/me` and connect while plugins load; each plugin keeps its registrations, shortcuts, routes and on/off
   switch, and loads its heavy views (voice and dictation, screens, Settings, the model picker) when first opened;
   xterm's stylesheet comes with the terminal, not in `styles.css`. Files: `web/src/main.tsx`,
   `web/build-plugins.ts`, `web/src/styles.css`, the plugins it splits. Tests: the plugin tests; a build check of the
   first screen's script size with room; turning a plugin off still removes it. Before: one 847 kB script. After: the
   first screen's script under 250 kB sent. After: 1.
4. **Long chats stay smooth.** First a profile of the 411-message scroll, split into scroll handlers (the normal path
   reads the scroller, scans question cards and walks the row model away from the end; the prepend scan runs only
   without native scroll anchoring), React mounting, markdown and snapshot work; then the fix for what it shows.
   Skipping off-screen rendering (`content-visibility` on stable groups with held sizes) is one option to prove;
   jump-to-quote centres by a measured height and the reply slide can be clipped by paint containment, so both are
   tested. Files: `web/plugins/chat/client.tsx`, `web/plugins/chat/*.css`, `web/demo/scroll-check.ts`. Tests:
   `scroll-check.ts` extended with the long chat (keeping your place on prepend, jump to a quote, find in page,
   selection and copy, the fold upstream fixed in "Scrolling up into a folded long reply makes the chat list go
   blank"), in Chromium and WebKit; the perf check's long part. Before: p95 frame 143 ms. After: p95 33 ms. After:
   none to profile; the fix after "Chat box: two rows again" and 7 (they share `chat/client.tsx`).

### Motion and the design system

5. **Reduced means reduced.** Every CSS animation and transition is covered by both Motion › Reduced and the device's
   setting; list reordering and the keyboard's glide use `calm()`; what a tap starts many times a day drops to 200 to
   300 ms. `useArrive()` and `useFlip()` have no callers: removed. Files: `web/src/ds.css`, `web/src/styles.css`,
   `web/src/dictate.css`, `web/src/motion.ts`, `web/src/viewport.ts`. Tests: a browser check that opens a menu, a
   sheet and a pushed screen under each setting alone and finds no transform animation
   (`getAnimations()`, computed `transition-duration`). Before: ~10 rules follow Reduced. After: all. After: 2.
6. **Tokens for what is written by hand.** New tokens only, in `ds.css`: monospace (`--mono`, 13/20, 14/20 on touch),
   a z-index scale, durations, icon sizes by role; hover styles under `@media (hover: hover)` and one press style.
   Each area moves its own raw values to them in its own slice, not here. Tests: a ratchet for unconditional `:hover`;
   `test_design.py`'s ds.css counts down. After: "Needs you 5: one list" (it changes `ds.css` rows).

### Writing

7. **A draft is never lost.** One durable record per chat: words, folded pastes, picks (what each `@` and `#` points
   at), the message it replies to, and its files (kept as blobs in IndexedDB, or as their upload once it is done), with
   today's text and folds moved into it. It is written once typing pauses and when the page hides, and stays until its
   send is safely in the outbox, which already holds the send before the box clears. A file that can't come back
   after a reload is named in the box, not dropped silently; a failed upload stays with Try again. Files:
   `web/src/kernel.ts`, `web/plugins/chat/client.tsx`, `web/src/send.ts`, `web/plugins/chat/attach.tsx`. Tests: a
   draft with a file, a paste, a pick and a reply survives a reload; one with a lost file says so; the draft clears
   only when the outbox has the send; a 2000-character draft's typing stays in budget. After: "Chat box: two rows
   again", "Phone box: automatic check".
8. **Edits keep what you wrote.** A suggested reply held to edit goes in at the caret (or replaces only a selection),
   and can be reached by the keyboard too; a suggestion for another reply asks before changing the reply. A folded
   paste is sent and put back where it was pasted, through later edits. "Replying to" and the suggested replies show
   and hide together. Files: `web/plugins/chat/client.tsx` (`editSug`, `editPaste`), `web/plugins/chat/fold.ts`,
   `web/plugins/chat/reply-bubbles.css`. Tests: holding a suggestion keeps the draft; a paste in the middle is sent in
   the middle after more typing; the reply and its suggestions hide together. After: 7.
9. **Lists fit the room.** The @, # and / lists fit the room left above the box with the keyboard up and keep the
   chosen row in view as the arrows move; safe with an input method; two spaces with one name keep their machine.
   Files: `web/plugins/chat/mentions.tsx`, `mentions.css`. Tests: the list's height with the keyboard up (the phone
   box's check); the chosen row in view after 20 arrow presses. After: "Chat box: two rows again", "Phone box:
   automatic check".

### The chat and readability

10. **One rhythm in the chat.** News rows, chips and day labels on docs/design.md's spacing, written in the chat's
    tokens; a question and its choice chips one group; the day label clear of the header. The prompt banners (`Stuck`
    in the terminal plugin) lead with their words, wrap their button under them on a phone, and several fold into one
    that still reaches each prompt. Files: `web/plugins/chat/*.css`, `web/plugins/terminal/client.tsx`,
    `web/src/ds.css` (`.banner`). Screens: `space-chat--*`, `space-chat-top--desktop--*`, at each Chat text size.
    After: "Phone: room while reading".
11. **Readable everywhere.** Dimmed and switched-off rows dim their icon, not their words; control edges at 3:1;
    red's roles as docs/design.md says; code 14/20 on touch with a Copy; markdown headings that step down; wide tables
    in a scroll box that is named, reachable by keyboard and fades at its cut. Files: `web/src/ds.css`,
    `web/src/styles.css` (`.md`), `web/plugins/diff/diff.css`. Tests: contrast measured in the browser on a real dim
    row, a ticked and unticked checkbox and a focus ring in each theme; a table's scroll box reachable by Tab. After: 6.

### Tasks

Needs you's order and count (blockers first, one item list for the group, the count and the filter) are "Needs you 5:
one list"'s, not a slice here: its brief already owns that list. This plan's Tasks slices build around it.

12. **Views for the day.** Now and Scheduled stay as they are. Above the list, one row: **All**, **Needs you** (the
    same items as Needs you 5's list) and a compact picker for **Working**, **Stopped** and **Done today** (finished
    since local midnight, by `doneAt`). The filter sheet starts with **Project** (the repo a task works in, a machine
    and a folder; the machine is named when one folder name is on two), then **Space** (where it was asked), then
    machine and state. Counts per choice for the view you're in; one tap back to All; the view kept on this device;
    a red count always opens what it counts, whatever view is saved. Urgent joins once "Urgent 2: in the app" lands.
    Files: `web/shared/task-filter.ts`, `web/plugins/tasks/client.tsx`. Tests: per view, the day's rollover, a repo on
    two machines, filters combined with their counts, a saved view and the red count. After: "Needs you 5: one list".
13. **Rows and headers that read in one look.** A row: status mark, name, one line of what it needs or just did, then
    where it works, quiet, keeping "from #space" and the machine where it tells two apart; the model and the pull
    request in the header. The header keeps its status whole and cuts the model. At most one shortcut button per row
    on a desktop, the one its state calls for (Reply in its chat for a question, Open the pull request for a review),
    named with the task, in the menu too; on touch the menu and, later, the swipe. Files: `web/plugins/tasks/client.tsx`
    (`TaskRow`, `TaskHead`), `web/plugins/tasks/*.css`. After: "Needs you 5: one list", "Needs you 4: exact links".
14. **The review card says what happens.** Its words say what Accept does ("Merges into main when you accept"), its
    buttons share the card's width on a phone with the primary last, and "Not now" says it stays under Needs you.
    Files: `web/plugins/tasks/client.tsx` (`ReviewCard`), `web/shared/ready-words.ts`. After: 13.
15. **Alerts read whole.** An alert's name is the task's name, and its body, place and status are its description
    (`aria-describedby`), not replaced by an `aria-label`; the row cuts its kind before the task's name. Files:
    `web/plugins/inbox/client.tsx`. Tests: the row's accessible name and description. After: none.
16. **Swipe actions, a pilot on Tasks.** On touch, a swipe left on a Tasks row shows one or two of its menu's safe
    actions (Open, Review the changes), each tapped to act; right still replies. A full swipe only for Archive, and
    only with Undo working, its pending and failed states shown and focus moved on when the row leaves. Locks to
    sideways first; one row open; never in the left edge's strip (`EDGE`); every action also in the menu. Alerts and the
    sidebar wait for the pilot. Files: `web/plugins/chat/slide.tsx`, `web/plugins/chat/press.ts`,
    `web/plugins/tasks/client.tsx`. Tests: thresholds, the edge strip, vertical scrolling, a cancelled pointer, a second
    row opening, long press and Reduced, in unit tests (as `edge-swipe.test.ts`) and a CDP touch run. After: 13,
    "Urgent 2: in the app".

### States

17. **Empty, loading and offline.** One empty layout (a line, one action) for a space, Tasks, Artifacts, Files and
    Changes; loading, saved-from-before, offline and try-again said apart; one content edge per pane. Files:
    `web/src/ds.css` (`.empty`), `web/plugins/files/`, `web/plugins/diff/`. Screens: `case-*`, `files--*`,
    `changes--*`. After: 6.
18. **The demo's pages in dark.** First reproduce why the demo's artifacts show light words on white in dark and
    night (the page or the frame), then fix it there. Files: `web/demo/`, possibly the artifact frame. After: none.

### Feel

19. **Haptics and sounds.** `buzz()`'s hidden switch goes. One setting in Settings › General below Motion,
    **Haptics and sounds**: Off, Haptics (the default), or Haptics and sounds. Haptics only where the browser has
    `navigator.vibrate` (Android): your send entering the outbox, a gesture crossing its point (the slide's `tick()`
    moves under it), a failed send. An iPhone has no haptic a page can call; its native switches give their own when
    the person flips them, which the app neither adds nor can take away. Sounds: one very quiet short tick on your own
    send and on a failed one, never for what arrives, reorders or retries, muted by an iPhone's silent switch
    (`navigator.audioSession.type = 'ambient'` where the browser has it). Motion › Reduced or the device's setting turn
    the app's haptics off. Files: `web/src/motion.ts`, `web/plugins/chat/slide.tsx`, `web/src/prefs.ts`,
    `web/src/settings.tsx`, `web/src/list.tsx`, `web/src/send.ts`. Tests: no `vibrate` under Reduced or with the
    setting off; no hidden switch in the source; the setting's default. After: 16.

Not in this plan: Settings' own pages (left out by the person's ask; slice 19 adds one row there); a new typeface or
palette (Inter and the neutral greys stay); a virtual list library unless slice 4's profile shows it is needed.

## Codex rounds

ROUNDS
