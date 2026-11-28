# Plugins

Every feature of the app is a plugin. A plugin fills named places in the shell, so one can be added without touching
the rest. [`web/plugins.json`](../web/plugins.json) is the list, in order.

| Plugin | Switch | What it is | Off means |
|---|---|---|---|
| chat | always on | A chat's messages, cards and message box; the space's menu has a Folder row while the header hides the folder (a phone, or the keyboard up; fork #105) | |
| tasks | always on | The Tasks pane, a task's thread, the review card | |
| artifacts | always on | The Artifacts pane, a page's tile in a chat, Mark up | |
| search | always on | The command palette: finds anything and runs any command (⌘K, Ctrl+K) | |
| shortcuts | always on | The shortcuts sheet (?), Settings › Shortcuts and the app's own commands ([shortcuts.md](shortcuts.md)) | |
| zoom | always on | Zoom in, out and reset on ⌘= ⌘− ⌘0, and the palette row for Settings › General's Zoom and Chat text size | |
| alerts | always on | Push alerts, one choice per device | |
| inbox | always on | The bell in the list's top row: every alert of the last 7 days, read on one device and so on all; and Settings › Notifications' check of this device and the list of the others | |
| analytics | always on | Settings › Personal analytics, kept only on your machines ([analytics.md](analytics.md)); its own switch turns recording off | |
| installed | always on | The installed app: the icon's shortcuts (Everything, Needs you, New task) and links opened in it reach the open window, the headers in a desktop window's title bar, a phone's safe areas on every screen (fork #34) | |
| whatsnew | always on | What's new under Settings › About: what changed in each version, read at build time, and the toast after an update saying what it brought (fork #70) | |
| typing | always on | While a phone's keyboard is up the chat gets the room: the bottom tabs and their home-bar band step aside, the header keeps one line, a note on top waits; the message box is one row (+, the text, send; the model line back when the keyboard closes) and suggested replies step aside once you type; all back as the keyboard closes (fork #86, #105) | |
| reading | always on | Reading back through a chat on a phone gives it the room: the bottom tabs slide away and the message box folds to one row while you scroll toward older messages, all back on a scroll toward the newest, a tap, or focus in the box; never with a draft, a chip, dictation or a card waiting at the end (fork #144) | |
| terminal | yes | Your own terminal in a space or a task, and "View as terminal" | No Terminal menu items |
| screens | yes | An agent's browser and desktop: watch, Take over, Hand back | No Screen menu item, live picture or card |
| voice | yes | Voice over the whole app, dictation in the message box, and Settings › Voice (the ElevenLabs key) | No voice or mic button, no Voice page |
| schedules | yes | Tasks › Scheduled | No Scheduled tab |
| reactions | yes | Emoji reactions on messages | No emoji row in a message's menu |
| recaps | yes | Recap in a chat's menu and the palette: a short recap, asked only when you pick it | No Recap row (an agent's own recaps still show) |
| feedback | yes | The Feedback page: problems in Shepherdr itself that your agents and you noted, under Found, Filed, Not now and Said no, each with its fix and what a check on GitHub found (Follow this one follows a match, nothing posted); the list's Feedback row counts what waits under Found, and the box at the top keeps what you write; a failed action's error has Report, which opens the box with that action's name (fork #94) | The Feedback row opens the old Feedback box; an error has no Report |
| triage | yes | Triage (fork #235): files what agents found as issues in the repos you switch it on for, and scores them (docs/settings.md, Triage). Its page is Settings › Triage; what it holds for your yes is a card under Needs you | Settings › Triage and its cards are gone, and nothing is filed, scored or started, Run now included |
| files | yes, off until switched on | Files: the shown space's folder as a tree, on its machine ([below](#files)) | No Files button, pane or bar item |
| diff | yes, off until switched on | Diff viewer: the Changes pane beside Tasks and Artifacts. What a task changed against its base, or what isn't committed in a space's folder, file by file; read only. A Ready card's files open there | No Changes button, pane or menu row |

Settings › Plugins has the switches. They are kept as `everywhere.plugins_off` in `~/.config/shepherdr/settings.json`
(`service/next.ts` `PLUGINS`). A plugin marked `offByDefault` there stays off until switched on, kept as
`everywhere.plugins_on`. An open page starts again when a switch flips.

## Files

- Off until you switch it on in Settings › Plugins. Then Files sits beside Artifacts and Tasks (the folder button in a
  chat's header, Files in a phone's bottom bar, G F).
- It shows the shown space's folder on the machine the space lives on, as a tree. Tap a file to read it (text, and
  pictures). Drop files from your computer on a folder to put them there; drag a file or folder onto another folder to
  move it (on a computer). A right click, or a long press on a phone, has Download: a file as it is, a folder as a zip.
- Only inside the space's folder: a path never leaves it, and a link that leads out of it is shown greyed and never
  followed. `.git` is left out of the tree and of a zip. Dropped folders aren't uploaded: zip them first.
- Sizes: text shows its first 400 KB. On the machine that serves Shepherdr, an upload is at most 100 MB. On another
  machine, a file or zip is at most 8 MB either way (what herdr-core carries in one call).
- Each step runs a small Python program on the space's machine through herdr-core (`service/files.ts`); nothing is
  public, the same private link as the rest of the app.

## Diff viewer

- Off until you switch it on in Settings › Plugins. Then Changes sits beside Artifacts and Tasks (the branch button in a
  chat's header, Changes in a phone's bottom bar), and a task's menu has Changes.
- Pick a task (what it changed against its base, committed or not) or a space's folder (what isn't committed). Tap a
  file for its lines. A Ready card's changed files open here too. Read only: nothing is staged, committed or edited.
- git runs on the task's or space's machine through herdr-core (`service/worktree.ts`, `GET /api/worktree`).

## Screens

- Each space has one browser with one profile, so its agents share the sign-ins. Each chat and each task has its own
  page in it: `herdr-browser <agent-browser command>`.
- Each agent has a desktop too: `herdr-desktop <agent-desktop command>`. On Linux it is the agent's own virtual
  display (Xvnc, or Xvfb with x11vnc). A Mac has one real screen, shared by its agents one at a time.
- You watch a screen live and Take over; the agent's commands are refused until you Hand back. An agent asks for a
  step only a person can do with `herdr-browser hands "<what>"`.
- For now, live views and actions work only for agents on the machine that serves Shepherdr.
- The streams listen on the machine itself only (127.0.0.1) and reach the page through the Shepherdr service.

## The places

`Registry` in [`web/src/kernel.ts`](../web/src/kernel.ts) names every place a plugin can fill. The shell
(`web/src/App.tsx`) only lays them out.

| Place | What goes there |
|---|---|
| `views` | The parts of a thread: `messages`, `box`, `taskHead`, `taskTop`, `scheduled`, `tile`, `search`; and `about`, under Settings › About's version rows; and `feedbackRow`, the list's Feedback row |
| `header`, `taskHeader` | Buttons in a chat's or a task's header (Artifacts, then Tasks last where its pane's Close lands; Terminal and Screen are menu rows) |
| `panes` | What the right-hand pane can show |
| `bar` | The phone's bottom bar |
| `spaceMenu`, `taskMenu`, `messageMenu` | Rows of a space's, a task's and a message's menu |
| `messageParts`, `messageEdge` | Drawn under a message, and the reaction chips on its bubble's lower edge |
| `messageQuick` | First in the quick bar a tap or a mouse over a message shows (add a reaction) |
| `chatCards`, `chatTail`, `chatBody` | Cards put in a chat from a task's status, what follows the messages, what takes the chat's place |
| `aboveBox`, `boxButtons`, `drawer` | Above the message box, inside its bar, and under the column |
| `sideHead`, `middle`, `overlays`, `topBars` | The list's top row, the whole middle column, whole-screen layers, thin lines at the top |
| `settings` | Sections of the settings window, for everything, a space, or both |
| `commands` | What the palette lists and the shortcuts run: each with its default keys ([shortcuts.md](shortcuts.md)) |
| `keys` | Raw key handlers that run before the commands' shortcuts |
| `afterUpdate` | The line after the page updated itself (none: the plain "Updated to …") |
| `failAct` | A button on a failed action's error notice, by the action (feedback: Report, which opens the Feedback box with the action's name); none: the notice alone |

## Add one

1. Make `web/plugins/<name>/client.tsx`. Its default export is `definePlugin({ name, setup(reg) { ... } })`. In
   `setup`, push into the places it fills. Give each entry an `order`.
2. Add `<name>` to `web/plugins.json`.
3. Run `bun web/build-plugins.ts`. It writes `web/generated/client-plugins.ts`, which the app imports.
4. For a switch, add it to `PLUGINS` in `service/next.ts` without `always`. In the plugin, `has('<name>')` from the
   kernel says whether another plugin is on.

A plugin reads the server's data with `useSnap()` and `useChat(key)`, what is on screen with `useUI()`, and acts
with `act()` or `tryAct()`. What the person sees for a status comes from `web/shared/view.ts`, by plain rules.
