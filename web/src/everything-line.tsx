// What Everything is, in one plain line under its name in its chat's header (dmalis/shepherdr#49). Everything's agent
// is the home space's: it starts tasks in any repo or space, sees every task on every machine and reaches each space's
// own chat (templates/assistant.md, "Home space"). Its model stays in the message box, and beside this line while
// the header has room for both (ds.css).

/** the line itself: what Everything does, in everyday words, short enough to show uncut on a phone */
export const EVERYTHING_LINE = 'Starts and checks work in all your spaces'

export function EverythingLine() {
  return <span className="ev-line">{EVERYTHING_LINE}</span>
}
