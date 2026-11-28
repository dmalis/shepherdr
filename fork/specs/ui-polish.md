# UI polish and speed

Part of #132. The audit of every page but Settings, against [docs/design.md](../../docs/design.md), and the plan
that builds it in small slices. Each slice is one task, one area, small enough to review in one sitting. Every UI
slice reads docs/design.md first and uses the UI skills (FORK.md: "All UI work uses the UI skills").

## The need

The person lives in Shepherdr all day: an iPhone home-screen app between other work, a desktop browser beside their
editor. They run several repos and spaces, a dozen-plus tasks a day across two machines, and come back to ask: what
needs me, what is stuck, what just landed, what is going on in project X. They asked for one consistent, polished,
device-fitted interface; readability and ease of writing; haptics or sounds where they help; better task filters and
per-row actions; swipe actions; and speed, "as I live inside this UI".

## How it was audited

- **Screenshots:** the demo build (`bun web/demo/serve.ts`), every page and state but Settings, at 390 px (touch, and
  with the keyboard up where typing), 820 px (touch) and 1440 px, in light and dark, and night for the main pages:
  258 pictures, named `<page-or-state>--<phone|tablet|desktop>--<light|dark|night>`. The contact sheets are in the
  proof page.
- **Code:** every stylesheet (`web/src/*.css`, `web/plugins/*/*.css`), the inline styles in the plugins, the motion
  code (`web/src/motion.ts`), the task filter (`web/shared/task-filter.ts`).
- **Measurements:** headless Chrome over CDP on the demo build, a phone profile (4× slower CPU, 1.6 Mbps and 150 ms),
  event timing for input, frame times while scrolling, Performance metrics for idle and live updates, the bundle's
  source map per module.
- **Co-designed with Codex** (GPT-6.2 Sol, high effort), three rounds: the audit, a red team of the draft against the
  code, a final pass. [Codex rounds](#codex-rounds) says what each changed.
- **Upstream checked:** v3.2.22, main 68be781. Related and closed: "Typing in the message box lags on a phone: layouts
  on each letter", "Scrolling the board is slow: every frame draws every row", and upstream's "Even spacing of chat
  rows: one rhythm and one left edge". Nothing open on a design document or app speed. Upstream's main adds an
  MCP Apps plugin (new CSS) after v3.2.22: the next sync brings it, and `test/test_design.py` counts its raw values.

## Findings

FINDINGS

## Performance, measured

PERF

## Build plan

SLICES

## Codex rounds

ROUNDS
