# Design

How Shepherdr's app looks, moves and stays fast. Every change to the app follows it; a change that needs to break a
rule changes this page in the same pull request. The values live in [`web/src/ds.css`](../web/src/ds.css) (colours,
sizes, the shared classes) and [`web/src/size.css`](../web/src/size.css) (chat text); this page names them and says
when to use each. `test/test_design.py` checks the rules a machine can check.

People keep Shepherdr open all day, on a phone between other things and on a desktop beside their editor. They come
back to ask four things: what needs me, what is stuck, what just landed, what is going on in this project. The app
answers those first, stays quiet otherwise, and never makes them wait for it.

## Principles

1. **The next action first.** Each screen, card and row leads with who has to act and what they can do now. Everything
   else is one tap away, not on the screen.
2. **Quiet by default, colour means something.** Ink and greys carry the interface. A colour is a status, a link or a
   danger, never decoration.
3. **One rhythm.** The same sizes, gaps and radii everywhere. A new screen is built from the classes in `ds.css`, not
   from new values.
4. **Fingers and keys alike.** Everything works by touch, by mouse and by keyboard, with the platform's own gestures and
   keys keeping their meaning.
5. **Fast enough to live in.** Typing, switching and scrolling never wait on the app. Motion explains a change and then
   stops.

## Information order

What a row, a card or a header shows, in this order. Leave out what doesn't help the person decide.

1. **Who must act**, as the status mark and its words: Needs you, Ready for review, Working, Stopped, Done.
2. **The name**: the task, space or page, in the person's words.
3. **Where**: its space, and its folder when that differs from the space's (a task can work in another folder).
4. **When**: how long ago it last changed, in short form (`8h`, `2d`).
5. **The one next action**: Reply, Accept, Allow, Open.
6. **The rest** (the agent's model and effort, the branch, the machine when there is one): in the thread, a menu or
   the pane's header, not in every row.

A status beats a model: when a line runs short, the model goes first and the status stays whole.

## Sizes

One scale in three steps, set on `.app` ([`ds.css`](../web/src/ds.css), "sizes"):

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
| Side gutter | `--gut` 16 | 16 | 16 |

- **A finger gets 44.** On `.tap` every tappable thing is at least `--hit` (44 px) across, itself or through its
  invisible `::before` pad, with no neighbour's pad over it. `web/demo/tap-check.ts` measures it.
- **Chat text follows Settings › General › Chat text size** through `--chat`, `--chat2` and `--chatm` (size.css).
  Never set a message's size in px.
- **Zoom multiplies every px** (`web/zoom-css.ts`), so sizes stay in px. Never use rem or vw for text.
- The chat column is `--chat-w` wide (Settings › General › Chat width): 720, 880 or 1040 px.

## Type

- **One family:** Inter (InterVariable) with its `cv02 cv03 cv04 cv11` features, and the system monospace for code,
  paths, commands and terminals.
- **Sizes:** 12, 13, 14, 16, 18, 20 and 24 px, and the tokens above. 12 is for counts, times and captions only, never
  for something to tap or read at length. 18 is a page or sheet title (`.h2`); 20 and 24 are for empty states and
  numbers that are the point of a screen.
- **Weights:** 400 for reading, 500 for controls and labels, 600 for names and titles. Nothing lighter, nothing bolder.
- **Line height:** 24 for 16, 20 for 13 to 15, 16 for 12. Text that wraps to three lines or more never gets less than
  1.4.
- **Numbers that change** (counts, times, sizes, prices) use `font-variant-numeric: tabular-nums` (`.num`, `.cnt`).
- **Monospace** is 13/20 (12/18 in tight rows). Code is a `--well` block with a `--line` edge; inline code is a
  `--control` pill with a 6 px radius.
- **Measure:** a message bubble stops at 560 px, about 70 characters, whatever the chat width. A page of prose
  (an artifact's text, a long brief) stops at 72 characters.
- **Truncation:** one line with `…` for names in rows, the start of a path cut rather than its end (`.hp.cut`). A cut
  value always has a way to the whole: its row opens it, or the menu shows it.

## Readability

- **Secondary text stays readable.** `--muted` measures at least 4.5:1 on every surface it sits on, in every theme. A
  surface where it can't (your own bubble, `--mine`) uses `--sub` instead.
- **Hierarchy by weight and colour, not size:** a row is the name (600, `--fg`) over one second line (400,
  `--muted`). Two second lines at most.
- **Words:** sentence case, plain verbs, no jargon, nothing the app's own code calls it. The app never says Assistant,
  worker or coordinator (docs/develop.md). Buttons say what happens ("Merge into main", not "OK"). Errors say what
  went wrong and what to do.
- **Tables and code scroll sideways in their own box,** never the page. A table's header row is 600 and `--sub`.

## Spacing

- **A 4 px grid:** 2, 4, 8, 12, 16, 24, 32, 48. 6 only inside small controls (a chip's gap, an icon beside its words).
- **Inside:** a row pads 8 across, a card 12 by 16, a sheet or dialog 16, a banner 12 on its words' side.
- **Between:** 4 between the messages of one turn, 8 between turns, 12 around a day's time and a card. Rows in a list
  touch (their own height is their rhythm); groups of rows are 12 apart under a 13/18 `--muted` label (`.lab`).
- **One left edge:** in a chat, bubbles, cards, news rows and folds share the same left edge, and so do their icons.
- **The side gutter** is `--gut` (16) on every width; on a phone the safe areas are added to it, never instead of it.

## Surfaces and levels

From lowest to highest; each level has one token and one use.

| Level | Token | What sits there |
|---|---|---|
| Well | `--well` | Fields, the message box, code, quiet folded content: things you put something into |
| Page | `--canvas` | The page: the list, the chat, the panes |
| Raised | `--raised` | The agent's bubbles, thin bars, a picture's frame |
| Overlay | `--overlay` | Menus, sheets, dialogs, toasts, the quick bar |
| Scrim | `--scrim` | The shade behind a sheet or dialog |

- **Edges, not shadows, in dark and night.** An overlay has a 1 px `--line2` inset edge and `--shadow`, which is only
  a shadow in light; dark and night step their surfaces up instead (night's canvas is true black, so every layer is
  lighter than it).
- **Fills for controls:** `--control` for a button's or a selected row's fill, `--control2` for its pressed or
  stronger state. A control has a fill or an edge, not both.
- **Cards are an edge, not a fill:** `.card` is a `--line2` inset line on the page, 12 px radius.

## Colour

- **Text in three steps:** `--fg` (names, what you read), `--sub` (body of secondary blocks, menu icons), `--muted`
  (second lines, times, placeholders, quiet icons).
- **One accent, the ink.** The primary button is `--fg` on `--canvas` (`.btn.pri`), one per card or sheet. There is no
  brand hue.
- **Status colours are only for status:** `--green` ready and done, `--amber` working, waiting and warnings, `--red`
  needs you, errors and danger, `--blue` information and your own choice (a picked reaction). Each comes with an icon
  or words; colour is never the only sign.
- **Red is Needs you.** A red count (`.cnt.needs`, `--needs-fill` with `--needs-ink`) means a person has to act; every
  other count is quiet (`.cnt`). An error is red words, not a red count.
- **Links** are `--link`, underlined, and only links.
- **Themes:** light, dark and night, each a full set of the tokens above (`:root`, `prefers-color-scheme: dark`,
  `[data-theme]`). A new colour token gets a value in all three, measured for contrast in each.
- **The terminal** is always dark (`--term`), in every theme.

## Shape

- **Radii by size:** 4 for inline marks, 6 for segments and inline code, 8 for controls, rows and fields, 12 for cards,
  banners and sheet rows, 16 for the message box and a sheet's top, 18 for bubbles, 999 for chips, pills and counts,
  50% for round buttons. Something inside a rounded box takes the box's radius less its padding.
- **Dividers are rare.** Whitespace separates groups. A hairline (`--line`) only where two regions scroll apart (the
  list's edge, a pane's edge, a header once its content scrolls under it, `.hd.sc`) and between groups in a menu.
  Never a line and a gap for the same break.
- **Icons:** the app's own set (`web/src/icons.ts`), 1.5 stroke, `--ic` square, `--muted` unless they carry a status.
  An icon button's label is its `aria-label`; an icon alone never stands for something the person hasn't seen named.

## Components

Use these before making anything new; each has its states in `ds.css`.

- **Rows** (`.row`, `.row2`, `.rowx`): a status mark, the name, one second line, a value at the end (`.v`). Hover and
  current share `--control`. Its menu is `⋯` on desktop and a long press on touch, and has every action the row has.
- **Cards** (`.card`): a title, at most two quiet lines, the content, then the actions (`.acts`) at the end, the
  primary last. On a phone, two or more actions share the card's width, the primary at the bottom.
- **Chips** (`.chip`): suggested replies and choices. A row of chips is 8 apart and 8 from what follows.
- **Counts** (`.cnt`): quiet; `.needs` is red. On a button they sit on the icon's corner.
- **Banners** (`.banner`): one line, its words first, one button. A long line wraps to two before its button shrinks.
- **Menus, sheets and dialogs**: one system (`web/src/overlay.tsx`, `web/src/sheets.css`): a popover at its button on
  a desktop, a sheet from the bottom on a phone, a dialog in the middle. Esc and a tap outside close it.
- **Empty states** (`.empty`): what this place is, in one line, and the one thing to do. **Errors** say what happened
  and what to do, with a Try again where it can help. **Offline**: the last thing known stays, dimmed, with when it was
  seen.
- **Toasts**: one line, gone on their own, never the only record of something that needs the person.

## Writing

The message box is where people spend their day. It never loses words, never lags and never hides what they write.

- **Room:** it grows with the draft up to half the visible height, then scrolls inside itself; the chat above shrinks,
  not the box.
- **Lines:** Enter sends on a desktop; Shift+Enter is a new line. On a phone Return makes a new line and the send
  button sends, as in Messages and Slack.
- **Never lost:** a draft is kept per chat on this device until it is sent, across reloads, switching chats and
  closing the app. A send that fails comes back into the box, or waits in the outbox with Try again.
- **The keyboard stays put:** sending, picking from a list or attaching never closes the phone's keyboard.
- **Lists:** `@` tasks, `#` spaces, `/` commands, each filtered as you type, with the arrow keys, Enter and Esc.
- **Attachments:** paste, drop or pick; each shows as a chip with its own Remove before sending.
- **Replying:** the quoted message shows above the box with a way to drop it.
- **Dictation** writes into the box, never sends by itself.
- **Fast:** a key press paints in under 50 ms on a mid-range phone, with a long draft too. Nothing on the page reflows
  per letter.

## Motion

Motion shows where something came from or went. It is short, it stops, and it never delays the next tap.

- **Durations:** 120 to 200 ms for a press, a fade or a small change; 280 to 320 ms for a menu or a reply sliding back;
  440 to 460 ms for a pushed screen or a sheet (`PUSH_MS`, `SHEET_MS`).
- **Easings** (`web/src/motion.ts`): `OUT` for what opens, `AWAY` for what leaves, `IOS` for sheets and pushed
  screens, `SPRING` for a menu growing from its button and a reply snapping back.
- **Only transform and opacity move.** No animated colour, size, shadow or layout.
- **Nothing runs forever.** A waiting mark (a spinner, a pulse) runs only while it waits and only while it can be seen,
  and never on a colour. An endless animation is a cost all day long.
- **Reduced motion:** when the device asks for less (`prefers-reduced-motion`) or Settings › General › Motion is
  Reduced (`html[data-motion="reduced"]`), nothing slides, grows or spins: the change is instant or a short fade. Every
  animation is covered by both; in script, check `calm()`.

## Haptics and sounds

Rare, quiet and only for a moment that matters, as in Messages and Slack. Never on scrolling, typing or a routine tap.

- **Moments:** your message is sent; a card you answered went through; a swipe crossed the point where it acts; a sheet
  snapped shut by a drag; something failed.
- **Haptics** only through documented web features: `navigator.vibrate` (Android), and on an iPhone only the native
  switch (`<input type="checkbox" switch>`) the person flips themselves. Never a hidden control clicked by script to
  fake one.
- **Sounds** are short, very quiet and off by default.
- Reduced motion turns haptics off.

## Touch, gestures and keys

- **No hover-only.** Anything a mouse reveals on hover is always visible on touch, or in the item's menu.
- **Swipes are shortcuts.** A row's swipe (reply, and the actions of its menu) is never the only way: the same action
  is in its menu, with a name screen readers can reach. A row's swipe starts away from the screen's left edge, which
  belongs to the back and list gestures.
- **Safe areas:** headers, the bottom bar, sheets and the message box add `env(safe-area-inset-*)` to their own
  padding.
- **Fields are 16 px** on a phone, so iOS never zooms the page.
- **Standard keys keep their meaning** on every keyboard layout: Esc closes, Cmd/Ctrl K searches, ? shows the
  shortcuts, Cmd/Ctrl with + − 0 zooms (docs/shortcuts.md). Focus is always visible (`:focus-visible`, 2 px ring).

## Performance

The app is open all day. These are budgets, measured on the built app with a phone profile (4× slower CPU, a slow
4G network) unless they say otherwise.

| What | Budget |
|---|---|
| A key press in the message box, to its paint | 50 ms, with a 2000-character draft too |
| Switching chats or opening a task | 100 ms |
| Scrolling a chat of 400 messages or a list of 200 tasks | no frame over 33 ms |
| A live update from the service | 4 ms of script, and it touches only what changed |
| An idle page | no style or layout work, nothing animating |
| A hidden page | no timers faster than once a minute, no animation |
| Script for the first screen | 250 kB compressed; a feature you open (voice, screens, the terminal, Settings) loads when opened |
| Memory | flat after an hour of updates |

- **Compressed over the network,** cached for good by the hashed file name.
- **Long lists** render what is near the screen: `content-visibility: auto` on rows and messages, with their size held
  by `contain-intrinsic-size`.
- **Pictures** have a width and height, load lazily and come in the size they show at.

## Do and don't

| Do | Don't |
|---|---|
| `var(--muted)` for a second line | `#737373`, or `opacity: .6` on text |
| `--sec`/`--secl` for small text | `font-size: 13px` beside a token |
| Red for Needs you | Red for a count of unread things |
| One primary button per card | Two black buttons side by side |
| Whitespace between groups | A divider and a gap for the same break |
| A fade under reduced motion | A slide that ignores Motion › Reduced |
| A spinner while waiting, stopped after | A pulse that runs for as long as the page is open |
| An action in the row's menu, and a swipe for it | A swipe or a hover as the only way to do something |
| A status whole, the model cut | `Ready for revi…` beside `Opus 5.5 · High` |
