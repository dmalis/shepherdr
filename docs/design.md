# Design

How Shepherdr's app looks, moves and stays fast. Every change to the app reads it first. The values live in
[`web/src/ds.css`](../web/src/ds.css) (colours, sizes, the shared classes) and [`web/src/size.css`](../web/src/size.css)
(chat text); this page names them and says when to use each, and the source is the truth for every number.

Two kinds of line here:

- **Rules** hold in the app today. A change keeps to them; a change that has to break one updates this page in the
  same pull request, saying why.
- **Target** lines (marked so) say where the app is going. The plan that builds them is
  [fork/specs/ui-polish.md](../fork/specs/ui-polish.md). A change doesn't have to build a target, but never moves away
  from one.

`test/test_design.py` checks a few rules a machine can: raw colours, font sizes off the scale, endless animations,
hover outside `@media (hover: hover)`, a monospace stack written out and a z-index layer written as a number may only
get fewer in stylesheets and inline styles, the grey of second lines passes contrast on its main surfaces, and whatever
moves stops under each reduced-motion switch alone.

People keep Shepherdr open all day, on a phone between other things and on a desktop beside their editor. They come
back to ask four things: what needs me, what is stuck, what just landed, what is going on in this project. The app
answers those first, stays quiet otherwise, and never makes them wait for it.

## Principles

1. **The next action first.** Each screen, card and row makes clear who has to act and what they can do now.
   Everything else is one tap away, not on the screen.
2. **Quiet by default, colour means something.** Ink and greys carry the interface. A colour is a status, a link or a
   danger, never decoration.
3. **One rhythm.** The same sizes, gaps and radii everywhere. A new screen is built from the classes in `ds.css`, not
   from new values.
4. **Fingers and keys alike.** Everything works by touch, by mouse and by keyboard, with the platform's own gestures and
   keys keeping their meaning.
5. **Fast enough to live in.** Typing, switching and scrolling never wait on the app. Motion explains a change and then
   stops.

## Making a change

- **Where it goes:** a feature is a plugin that fills a place in the `Registry` (`web/src/kernel.ts`,
  [docs/plugins.md](plugins.md)).
- **Controls:** `I` (an icon), `IB` (an icon button), `Btn`, `Row` (`web/src/ui.tsx`), before any new element.
- **Layers:** `openMenu`, `openDialog`, `openForm`, `confirm` and `Overlay` (`web/src/overlay.tsx`). A menu is a
  popover at its button with a mouse and a sheet from the bottom on a phone; a dialog can become a sheet on a phone.
  Plain menus move with the arrow keys and close on Tab; a form keeps Tab inside and gives focus back when it closes
  (`web/src/layer-focus.ts`).
- **Words:** the vocabulary of [docs/develop.md](develop.md); keys as [docs/shortcuts.md](shortcuts.md) lists them.
- **A new colour token** gets a value in light (`:root`), the device's dark (`prefers-color-scheme: dark`), Dark
  (`[data-theme="dark"]`) and Night (`[data-theme="night"]`), measured for contrast on the surfaces it sits on in each,
  a see-through one as painted over them.
- **Check it** on the built demo (`bun run build`, then `bun web/demo/serve.ts`), in a clean browser profile:
  - at 390 px with touch, a touch tablet (820 px) and a desktop (1440 px);
  - in light, dark and night, at a larger Chat text size and at Zoom 150%;
  - with the keyboard alone, and with Motion › Reduced;
  - anything that moves: `bun web/demo/motion-check.ts` (either reduced-motion switch alone stops it);
  - anything that can move or wait on its own: `bun web/demo/still-check.ts` (a still page does no work);
  - the demo's cases where they apply: `?case=empty`, `down`, `more`, `long` (long names), `one`, `five`; a task or
    artifact by `?task=<id>` or `?artifact=<id>`;
  - and on a real iPhone home-screen app for anything about the keyboard, gestures or the screen's edges.

## Information order

What a row, a card or a header shows. Leave out what doesn't help the person decide.

- **A task's row:** its status mark, its name, then one quiet line of what it needs or just did, then where it works.
  How long it has waited (or since it finished) at the end. The agent's model, the branch and the pull request belong
  in the task's header and thread, not in every row (Target: today a row can run to four lines).
- **A task's header:** the name, then the status in words, then the agent. A status beats a model: when the line runs
  short, the model is cut and the status stays whole (Target).
- **A card that asks something:** the question or decision first, what happens when you answer, then the buttons.
- **Where:** a task lives in the space that asked for it and works in a folder, a repo on a machine. Where those
  differ, both are named (`from #space`), and the machine is named when it tells two apart.
- **Reading order** matches what the eye sees and what Tab reaches. Drawing a quiet line above the name it belongs to
  while it is read after the name (the project line, `web/plugins/tasks/where.css`) is a deliberate exception, not a
  pattern to copy.

### What needs the person

**Needs you** is the list of things waiting on a person: a task's question or permission, a task ready for review, a
space's own chat that asks, a queued question. One task can have more than one. The red count is how many there are,
and pressing it shows exactly those. What is in it, how its items are told apart and in what order is decided by the
Needs you work (`web/shared/needs-open.ts`, `web/src/needs-count.tsx`); a change elsewhere doesn't count them its own
way. The Tasks list's **Needs you** view shows the same items as the group and its red count; the filter sheet has no
Needs you of its own. Target: what blocks an agent (a question, a permission) comes before what waits for a review.

### Views for the day

Tasks › Now has one row above the list for the day's questions (`web/plugins/tasks/views.tsx`): **All**, **Needs
you**, and a compact picker for **Working**, **Stopped**, **Done today** (finished since this device's midnight) and
**Urgent**. It is a segmented control: one is always picked, All is one tap back, and the view is kept on this device.
When it is narrow (a phone at a big zoom), More is its chevron alone and a picked view keeps its name whole beside
"Needs" and the red count; a word that still can't fit ends in an ellipsis inside its segment. A red count opens what
it counts whatever view was kept. The filter sheet narrows any view: **Project** first (the repo or folder a task works
in; the machine is named only when one name is on two), then **Space** (where the task was asked), then Machine and
State. A choice's count is what the list would show with it, in the view you're in and with the other groups' picks
(`web/shared/task-filter.ts`): in Needs you, its rows, a space's chat question among them. A choice with none is left
out unless it is picked, and a group shows when a pick in it would change the list. A view with nothing in it says so
and offers All.

## Sizes

One scale in three steps, set on `.app` ([`ds.css`](../web/src/ds.css), "sizes"). These are the defaults; the source
has the exceptions (a header while the phone's keyboard is up, a sheet's rows).

| | Desktop with a mouse (`.app`) | A finger (`.app.tap`) | A phone (`.app.phone`) |
|---|---|---|---|
| Interface text | `--ui` 14/20 (`--uil`) | 16/24 | as `.tap` |
| Second lines | `--sec` 13/18 (`--secl`) | 14/20 | as `.tap` |
| Chat text | `--chat` 15/22 (`--chatl`) | 16/24 | as `.tap` |
| A list row | `--row` 32, `--row2` 52 | 44, 56 | 48, 56 |
| Buttons | `--btn` 32, `--btns` 28, `--ib` 28 | 40, 36, 44 | as `.tap` |
| Header | `--hd` 48 | 56 | 52 |
| Fields | `--field` 32 | 44 | as `.tap` |
| Icons | `--ic` 16 | 20 | as `.tap` |
| Code | `--code` 13/20 (`--codel`) | 14/20 | as `.tap` |
| Side gutter | `--gut` 16 | 16 | 16 |

- **Which step applies:** `.app.phone` is the phone layout, up to 767 px wide (moved by Zoom, `widthUpTo()` in
  `web/src/prefs.ts`); 1023 px is the narrow layout's edge. `.app.tap` is the phone layout or a device whose main
  pointer is a finger. A button's touch pad follows `(pointer: coarse)` on its own.
- **A finger gets 44.** On `.tap` a control you tap on its own is at least `--hit` (44 px) in both directions, itself
  or through its invisible `::before` pad, with no neighbour's pad over it. `web/demo/tap-check.ts` measures it on its
  scenes, with its listed exceptions.
- **Chat text follows Settings › General › Chat text size** through `--chat`, `--chat2` and `--chatm` (size.css), each
  with its line height. Never set a message's size in px.
- **Zoom** (Settings › General) multiplies every lowercase `px` over 1 in the app's CSS and rewrites width queries
  (`web/zoom-css.ts`); `rem` scales through the root. So sizes are written in px. An uppercase `PX` is left alone on
  purpose (the message box's 16 px floor, which keeps iOS from zooming). Sizes set from script are outside it: measure
  the page instead, and use `--app-h` (`web/src/viewport.ts`) for the visible height.
- **Icons by role:** `--ic` for a control's or a row's icon; `--ic-sm` (14, 16 on touch: the second line's height less
  4) for an icon inside a second line, a chip or a strip; `--ic-xs` (12, 14 on touch) for a mark inside a small control,
  a checkbox's tick or a remove ×; `--ic-chat` (16, every size) for the chat's icon column. The `.i.s16`, `.s20` and
  `.s22` classes are for an icon whose size is the point (an empty state, a picture's mark).
- The chat column is `--chat-w` wide (Settings › General › Chat width): 720, 880 or 1040 px.

## Type

- **One family:** Inter (InterVariable) with its `cv02 cv03 cv04 cv11` features, and the system monospace for code,
  paths, commands and terminals.
- **Sizes:** the tokens above first; otherwise 12, 13, 14, 16, 18, 20 and 24 px. 12 is for counts, times and captions
  only, never for something to tap or read at length. 18 is a page or sheet title (`.h2`); 20 and 24 are for empty
  states and numbers that are the point of a screen.
- **Weights:** 400 for reading, 500 for controls and labels, 600 for names and titles. Nothing lighter, nothing bolder.
- **Line height:** each size token comes with its own (`--uil`, `--secl`, `--chatl`). Text that wraps to three lines or
  more never gets less than 1.4.
- **Numbers that change** (counts, times, sizes) use tabular figures: `.num` (which also sets their weight) and
  `.cnt` have them.
- **Monospace** is `--mono` (the system's monospace), never the stack written out, at `--code`/`--codel`: 13/20, 14/20
  on touch. A terminal keeps its own metrics, and a small output (a job's lines, a key cap) 12. Code is a `--well` block
  with a `--line` edge and its own sideways scroll; inline code is a `--control` pill. Target: a reply's code
  (`styles.css`'s `.md`) moves to `--code` too, with a Copy on every block, and a diff's 12/18 only on a desktop.
- **Headings in a reply** step down (Target: today h1 to h4 look the same in a chat).
- **Measure:** in the main chat a bubble stops at 560 px, about 70 characters, whatever the chat width; in a task's
  pane bubbles and cards take 92% of its width. A page the app writes (a proof, a plan) keeps prose to about 72
  characters a line.
- **Truncation:** one line with `…` for names in rows; a path in a header is cut at its start (`.hp.cut`). A quiet
  label beside a name (a task's kind) gives way whole before the name is cut, and is still read by screen readers
  (an alert's title, `web/plugins/inbox/fit.ts`). A cut value always has a way to the whole: its row opens it, or the
  menu shows it.

## Readability

- **Second lines read at 4.5:1.** `--muted` passes on the page, a field, an agent's bubble and your own bubble in every
  theme (`test/test_design.py`). On any other surface or state (a tint, a pressed row, an overlay) measure the pair as
  it is painted.
- **Dim the mark, not the words.** A row that can't be reached or is switched off dims its icon and says why in words;
  its text keeps its contrast. Target: today `.row.dim` and `.row.off` dim the whole row (`opacity` takes `--muted` to
  2.3:1 in light).
- **Controls you need to find** have an edge or fill of at least 3:1 against what is around them (WCAG 2.2, non-text
  contrast). A `--line2` hairline alone is about 1.4:1, so it can't be the only sign of a checkbox or a field
  (Target).
- **Hierarchy by weight and colour before size:** a row is the name (600, `--fg`) over a second line (400,
  `--muted`).
- **Words:** sentence case, plain verbs, no jargon, nothing the app's own code calls it. The app never says Assistant,
  worker or coordinator (docs/develop.md). It speaks to "you" and never says "I". Buttons say what happens ("Merge into
  main", not "OK"). Errors say what went wrong and what to do. Something under way ends with an ellipsis character
  ("Merging…"), and quotes are curly.
- **Tables and code scroll sideways in their own box,** never the page. Target: a wide table in a narrow chat shows
  there is more (a fade at its cut edge), its scroll box can be reached and named for the keyboard, and it can be
  opened wider.

## Spacing

- **Steps of 4:** 4, 8, 12, 16, 24, 32, 48, with 2 and 6 inside small controls (a chip's gap, an icon beside its
  words). Chat spacing scales with the chat's text size (`size.css`), so it is written in its tokens, not in px.
- **Inside:** a row pads 8 across, a card 12 by 16, a sheet or dialog 16.
- **Between:** rows in a list touch (their height is their rhythm); groups of rows sit under a `.lab` label (`--sec`).
  In a chat, a question and its choice chips are one group, set apart from the next message (Target).
- **One left edge:** in a chat, bubbles, cards, news rows and folds share the same left edge, and so do their icons.
  In a pane, content starts on one edge whatever pads it (Target: today some panes reach 16 px by different sums).
- **The side gutter** is `--gut` (16) on every width; on a phone the safe areas are added to it, never instead of it.

## Surfaces

Each surface has one token and one use. In light they step from the page; in dark and night the raised ones are
lighter than the page, but they are roles, not a strict ladder (Night's overlay is darker than its raised surface).

| Surface | Token | What sits there |
|---|---|---|
| Well | `--well` | Fields, the message box, code, quiet folded content: things you put something into |
| Page | `--canvas` | The page: the list, the chat, the panes |
| Raised | `--raised` | The agent's bubbles, thin bars, a picture's frame |
| Overlay | `--overlay` | Menus, sheets, dialogs, toasts, the quick bar |
| Scrim | `--scrim` | The shade behind a sheet or dialog |

- **Overlays** have a 1 px `--line2` inset edge and `--shadow`, which is only a shadow in light; a sheet has its own
  shadow (`sheets.css`).
- **Fills for controls:** `--control` for a button's or a selected row's fill, `--control2` for a stronger state.
- **Cards are an edge, not a fill:** `.card` brings its own `--line2` inset edge and 12 px radius.

## Colour

- **Text in three steps:** `--fg` (names, what you read), `--sub` (body of secondary blocks, menu icons), `--muted`
  (second lines, times, placeholders, quiet icons).
- **One accent, the ink.** The primary button is filled with `--fg` and written in `--canvas` (`.btn.pri`), one per
  card or sheet. There is no brand hue.
- **Status colours are only for status:** `--green` ready and done, `--amber` working, waiting and warnings, `--red`
  needs you, errors and danger, `--blue` information and your own choice (a picked reaction). Each comes with an icon
  or words; colour is never the only sign.
- **Red is Needs you.** In navigation and in lists of work, a red mark or count (`.cnt.needs`, `--needs-fill` with
  `--needs-ink`) means a person has to act; every other count is quiet (`.cnt`). Red keeps its other meanings only
  where the context says so: a danger row in a menu, an error's words, recording, a deleted line in a diff. Target:
  today a task's ring is red for a stopped task and failed checks too.
- **Links** are `--link`, underlined, and only links (`web/src/link-color.test.ts`).
- **The terminal** is always dark (`--term`), in every theme.

## Shape

- **Radii by role:** 4 for inline marks, 6 for segments and inline code, 8 for controls, rows and fields, 12 for cards,
  banners and sheet rows, 16 for the message box and a sheet's top, 18 for bubbles (it grows with chat text), 999 for
  chips, pills and counts, 50% for round buttons. Something inside a rounded box takes the box's radius less its
  padding.
- **Dividers are rare.** Whitespace separates groups. A hairline (`--line`) only where two regions scroll apart (the
  list's edge, a pane's edge, a header once its content scrolls under it, `.hd.sc`), between groups in a menu, and
  between a table's rows. Never a line and a gap for the same break.
- **Icons:** the app's own set (`web/src/icons.ts`, drawn on 20 units at a 1.5 stroke), shown through `I` at `--ic`,
  `--muted` unless they carry a status. An icon button's name is its `aria-label`; an icon alone never stands for
  something the person hasn't seen named.

## Layers

What sits over other parts of the page takes a layer from the scale in `ds.css` (`:root`), never a number of its
own. Inside a component, 1 to 3 (and -1 behind) order its own pieces.

| Layer | Token | What |
|---|---|---|
| A dragged row | `--z-drag` 5 | a row or a machine's heading lifted above its list |
| An edge | `--z-edge` 15 | a pane's or the terminal's resize handle |
| A floating chip | `--z-float` 19 | a chip over the chat, under every layer |
| Menus, sheets, dialogs | `--z-layer` 20 | `.layer` and the lists over the message box |
| Full screen | `--z-full` 30 | a screen shown full size |
| Toasts | `--z-toast` 60 | toasts, and a leaving part's still copy (`motion.ts`) |

## Components

Use these before making anything new; each has its states in `ds.css`.

- **Rows** (`.row`, `.row2`): a status mark, the name, a second line, a value at the end (`.v`). `.rowx` wraps a row
  with its own buttons beside it. A row's menu is `⋯`, there on touch too, and has every action the row has.
- **Cards** (`.card`): the question or title, at most two quiet lines, the content, then its buttons (`.acts`, a row
  at the end that wraps). Target: on a phone, a card's two or more buttons share its width, the primary last, as a
  sheet's do.
- **Chips** (`.chip`): suggested replies and choices.
- **Counts** (`.cnt`): quiet; `.needs` is red.
- **Banners** (`.banner`): its words first, one button. Target: on a phone the words wrap to two lines and the button
  goes under them before the words are cut.
- **Menus, sheets and dialogs:** one system (above, Making a change). Esc and a tap outside close them.
- **Empty, loading, offline:** an empty place says what it is in one line and offers the one thing to do (`.empty`).
  Loading, saved-from-before, offline and "try again" are each said in their own words. An error says what happened and
  what to do. Offline, the last thing known stays, with when it was seen.
- **Toasts:** one line, gone on their own, never the only record of something that needs the person. An Undo toast
  stays at least 5 seconds.
- **Names for screen readers:** a row's name is its title; what else it shows (why, where, when) is its description
  (`aria-describedby` on the words it shows), not left out or replaced by an `aria-label`. A short form on screen
  (`5m ago`) is read in words (`5 minutes ago`). The alerts list's rows are the model (`web/plugins/inbox/client.tsx`).
- **Pages the app writes** (a proof, a plan) set their own background and text colours for light and dark.
- **An artifact's frame** is the app's own page colour under the page (`.page`, `background: var(--canvas)`), never a fixed
  white: a page that says it can be dark and paints no background of its own reads in every theme, and a light-only
  page keeps its white. A document with no link catcher (an SVG or a picture opened from a link) gets white (`.bare`).
  `web/demo/artifact-check.ts` measures every demo artifact's words in its frame, as painted, at 4.5:1 in light,
  dark and night, against the device's own scheme too, at 390 px and on a desktop.

## Writing

The message box is where people spend their day. It never loses words, never lags and never hides what they write.

- **Keys** ([docs/chat.md](chat.md), `web/src/enter.ts`): Enter sends and Shift+Enter makes a new line; on a phone's
  on-screen keyboard Return makes a new line and the send button sends (a tablet with a hardware keyboard sends on
  Enter). Ctrl/⌘+Enter sends and holds it until the agent's turn ends. A word being composed with an input method is
  never sent. A line that starts with `!` runs as a command and goes alone: a quote or files in the box stay for the
  next message.
- **Room:** the box grows with the draft, then scrolls inside itself; the chat above shrinks, not the box. Target: once
  a draft wraps on a phone, its words take the box's whole width and the buttons sit under them, the same field keeping
  its caret and selection.
- **Never lost:** a send goes into the outbox (`web/src/outbox.ts`) before the box clears, and one that fails waits
  there with Try again; one that went out but never came back is sent again under a new id that names the first
  (`was`), so it isn't shown twice. A draft is the whole message, kept per chat across reloads in one record
  (`web/src/draft.ts`): its words, folded pastes, what each `@` and `#` points at, the message it replies to and
  its files (their bytes in IndexedDB until the upload is done, then the upload). It is written once typing pauses
  and when the page hides, never on every key press. When storage can't keep the outbox (it is full), the stored
  draft stays as it was until the send is delivered. A file a reload can't bring back is named in the box and left
  out of the send, never dropped silently; a failed upload keeps Try again after a reload, and a send cut off while
  its file was going up goes on from the kept copy. `web/demo/draft-check.ts` checks it with real reloads.
  Target: nothing writes over a draft (a suggested reply held to edit goes in at the caret, and can be reached by
  keyboard).
- **The keyboard stays put** for what happens in place: sending, picking from a list, removing a chip. A file picker or
  a sheet may take it.
- **Lists:** `@` tasks, `#` spaces, `/` commands, each filtered as you type, with the arrow keys, Enter and Esc, safe
  with an input method mid-word, naming the machine beside a space on another one. Target: a list fits the room left
  above the box with the keyboard up and keeps its chosen row in view.
- **Attachments:** paste, drop or pick; each shows as a chip with its own Remove. Target: while dragging, the box shows
  where to drop; a long paste folded into a chip is sent where it was pasted, not at the end.
- **Replying:** the message replied to shows with a way to drop it. Target: suggested replies and the message they
  answer show and hide together.
- **Dictation** writes at the caret, never sends by itself, and a cancel or a refused microphone leaves the draft as it
  was.
- **Fast:** see Performance. Nothing outside the box reflows per letter; the box itself grows by measuring its
  height on each change, its frame held meanwhile so nothing around it moves (`fitBox()`, `web/src/grow.ts`).

## Motion

Motion shows where something came from or went. It is short, it stops, and it never delays the next tap.

- **Durations:** 120 to 200 ms for a press, a fade, a small change or a menu (a menu grows from its button in 180 ms
  with `OUT`), from the tokens: `--dur-s` 120 ms (a fade, something leaving), `--dur-m` 180 ms (a menu, a toast, a
  small change), `--dur-l` 240 ms (something that arrives on its own, the working sign); `PUSH_MS` and `SHEET_MS` (`web/src/motion.ts`, 300 ms) only for a screen pushed in or a sheet coming up, which go out in 240.
  What a tap starts many times a day stays within 200 to 300 ms: the spaces list slides in by its button in 300. What
  a finger drags follows it, can be let go of or taken back mid-way, and settles from its own speed.
- **A press shows at once** on every control, by finger, mouse or keyboard, with no transition: one press style
  (`ds.css`, after the touch reset). A control drawn as a surface (a row, an icon button, a tab, a tile) lays `--press`
  over its own fill, whatever that fill is (`--control2`, or a dark bar's own), as a state layer does (a sheet's rows
  and its Cancel too); a filled round button, a chip or a picture dims to .6; a word that rests quiet (`--muted`,
  `--sub`) lifts to `--fg`, as its hover does, so it keeps 4.5:1 while held. `.btn` and `.chip` darken and shrink a
  touch (to .97), by `--press-scale`, which is 1 (no shrink) under either reduced-motion switch. A new control joins one of the three lists,
  never a press of its own.
- **Easings** come from `web/src/motion.ts` (`OUT`, `AWAY`, `IOS`, `SPRING`), not new curves.
- **Only transform and opacity move.** No animated colour, size, shadow or layout (Target: an attachment chip still
  fades its colour, `web/plugins/chat/attach.css`). A transition names its properties, never `all`, and a new tap or
  drag takes over from it.
- **Nothing runs forever.** A waiting mark runs only while it waits and while it can be seen, and never animates a
  colour. A picture that waits is still: an artifact's tile shows a sketch of a page's first lines, painted once
  (`.psk`), and its picture fades in over it once loaded. `web/demo/still-check.ts` holds it: no running animation and
  almost no style work on a still page while pictures are blocked, hung or served, and nothing moved as they come in.
- **Reduced motion:** when the device asks for less (`prefers-reduced-motion`) or Settings › General › Motion is
  Reduced (`html[data-motion="reduced"]`), nothing slides, grows or spins: the change is instant or a short fade. Each
  switch alone is enough. In CSS, a rule that moves something (a transform, or a box's size or place) has a rule that
  stops it under each: an `@media (prefers-reduced-motion: reduce)` one and an `html[data-motion="reduced"]` one with
  the same selectors, beside it. In script, ask `calm()` (`web/src/motion.ts`), which reads both; the device's own
  query stays inside it. `test/test_design.py` holds both in the source, and `web/demo/motion-check.ts` plays a menu,
  a sheet, the spaces list, a fold, a drag and a suggested reply under each switch alone and finds nothing moving.

## Haptics and sounds

Rare, quiet and only for a moment the person caused, as in Messages. Never on scrolling, typing, a routine tap, or
something that arrives, reorders or retries on its own.

- **Haptics** only through documented web features: `navigator.vibrate` where the browser has it (Android). An iPhone
  gives a haptic only when the person flips a native switch (`<input type="checkbox" switch>`, Safari 18). Never a
  hidden control clicked by script to fake one (Target: `buzz()` in `web/src/motion.ts` still does).
- **Where it fits:** a gesture crossing the point where it acts (the reply slide does, `tick()`), and as the plan adds
  them, your send entering the outbox and a failed send.
- **Sounds** are short and very quiet, follow the device's silent switch, and only play for your own send.
- Reduced motion turns the app's own haptics off (Target: the reply slide's and a held press's don't check it yet,
  `web/plugins/chat/slide.tsx`).

## Touch, gestures and keys

- **No hover-only.** Anything a mouse reveals on hover is always visible on touch, or in the item's menu. Hover styles
  sit under `@media (hover: hover)`, so a tap never leaves one lit, and a touch screen sees the press instead.
  `test/test_design.py` holds the few still outside it (in `styles.css`, `dictate.css` and the task's place
  line) to their count.
- **Swipes are shortcuts.** A swipe is never the only way: its action is in the row's menu too. Today a row slides
  right to reply. Target: left shows one or two of the row's actions that are safe to undo, each tapped to act; merging,
  stopping, allowing and deleting are never on a swipe. A swipe locks to sideways before it takes over, so the list
  still scrolls; one row is open at a time; it never starts in the left edge's strip (`EDGE`, `web/src/edge.ts`), which
  opens the spaces list.
- **Safe areas:** headers, the bottom bar, sheets and the message box add `env(safe-area-inset-*)` to their own
  padding.
- **Fields are 16 px** on a phone, so iOS never zooms the page, and the page never turns off pinch zoom.
- **Taps are immediate** (Target: most controls don't yet): controls have `touch-action: manipulation` and the app's own press style instead of the
  browser's grey tap flash. Sheets, menus and panes that scroll keep their scroll to themselves
  (`overscroll-behavior: contain`).
- **What changes on its own is announced** (Target): a toast, a failed send, a filter's new count reach screen readers through a
  polite live region.
- **Undo or confirm:** an action that loses something (delete, discard, close without merging) asks first or offers
  Undo. Target: one that can be undone (archive, mark read) offers Undo instead of asking.
- **Standard keys keep their meaning** on every keyboard layout: Esc closes, Cmd/Ctrl K searches, ? shows the
  shortcuts, Cmd/Ctrl with + − 0 zooms ([docs/shortcuts.md](shortcuts.md)). Focus is always visible on what the
  keyboard reached (`:focus-visible`), and goes back where it was when a layer closes.

## Performance

The app is open all day. These are the budgets, all Targets until the plan's measurements pass them, on the built app
with a phone profile (4× slower CPU, 1.6 Mbps and 150 ms) unless they say otherwise.

| What | Budget |
|---|---|
| A key press in the message box, to its paint | p98 50 ms, with a short and a 2000-character draft |
| Switching to a space or task already loaded | p95 100 ms (a first load of its history is measured apart) |
| Scrolling a 400-message chat or a 200-task list | p95 frame 33 ms, with the slower frames and long tasks counted |
| A live update from the service | p95 4 ms of script per update |
| An idle page, and a hidden one | no repeating visual work: nothing animating, no style or layout per second |
| Script for the first screen | 250 kB sent, compressed, counting every script it loads before it can be used |
| Memory | no growth in retained memory after the first minutes of live updates |

- **Cached for good by the hashed file name;** the page itself is checked each load. A hashed file that isn't there
  is a 404, never the page.
- **Sent compressed:** brotli, else gzip, by the browser's `Accept-Encoding` and its q-values, with
  `Vary: Accept-Encoding`. The build writes both copies beside each hashed file (`web/compress.ts`) and the service
  picks one (`service/static.ts`); the page itself is sent as it is. A proxy in front passes the bytes on as they are
  (`web/demo/live.ts` fetches with `decompress: false`).
- **Features you open** load when opened, as the terminal does. Target: voice, screens and Settings too (today every
  plugin is in the first script).
- **Long lists:** measure first. Skipping off-screen rows (`content-visibility`) or rendering only what is near the
  screen are options to prove against find, copy, jump-to-quote and keeping your place.
- **Pictures keep their room before they load,** so nothing moves as they come in: a frame of a fixed shape that the
  picture fills without taking part in its size (an artifact's tile at 16:10, a screen's picture at 16:8, logos and
  space icons at their size, a picture opened in Files fitted into the pane), or the size this screen already knows (a
  picture you sent from it, while its own copy is kept). One that may sit below the first screen (a tile, a picture in
  a chat, a screen's picture) loads lazily. Target: a picture in a chat without this screen's own copy (from an agent,
  another device, or yours after a reload) has no size until it loads; the service gives its size with the message.
- **An idle page does no visual work** (the idle row above): `web/demo/still-check.ts` measures it on the demo with
  its pictures blocked, hung and served. A hidden page isn't measured (headless Chrome keeps it visible).

## Do and don't

| Do | Don't |
|---|---|
| `var(--muted)` for a second line | A hex grey, or `opacity: .6` on text |
| `--sec`/`--secl` for small text | `font-size: 13px` beside a token |
| Red for Needs you | Red for a count of unread things |
| One primary button per card | Two black buttons side by side |
| Whitespace between groups | A divider and a gap for the same break |
| A fade under reduced motion | A slide that ignores Motion › Reduced |
| A spinner while waiting, stopped after | A pulse that runs for as long as the page is open |
| An action in the row's menu, and a swipe for it | A swipe or a hover as the only way to do something |
| A status whole, the model cut | `Ready for revi…` beside `Opus 5.5 · High` |
