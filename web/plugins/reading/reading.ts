// fork #144: while you read back through a chat on a phone, the chat gets the room. The rules, with no page in them:
// when the bottom tabs and the message box's second row step aside, and when they come back.

/** the class on <html> while you read back (reading.css, and typing.css's one-row box) */
export const READING = 'reading'

/** scrolled this far back toward older messages in one go: the tabs step aside (Safari and iOS 26's tab bar wait for
 *  a deliberate scroll, never a nudge) */
export const HIDE_PX = 40
/** scrolled this far toward the newest message in one go: they come back (a small move, as in Safari and X) */
export const SHOW_PX = 24
/** still this far from the newest message once the chat has grown by the room it gains: the same line as the
 *  jump-to-newest button (newest.ts's OFF_PX), so its ↓ stays, and the view is never pulled down to the end */
export const FAR_PX = 240
/** at the newest message: everything is back */
export const END_PX = 2

export interface Reading {
  /** stepped aside now */
  on: boolean
  /** the last scroll position seen */
  y: number
  /** the chat's whole height then: an earlier page loading above moves the position without a scroll of yours */
  h: number
  /** how far the chat has moved in one direction since it last turned: below 0 toward older messages */
  run: number
}

export const START: Reading = { on: false, y: 0, h: 0, run: 0 }

/** What a scroll to `y` makes of `s`: `h` is the chat's whole height, `end` how far it still is from its newest
 *  message, `may` whether anything may step aside now (allowed()), `room` how much taller the chat gets when they do. Scrolling back far enough steps aside; a little the
 *  other way, the newest message itself, or anything that forbids it brings all back. A scroll that came with a new
 *  height (an earlier page loaded above, kept in place; a message came) is no move of yours: it only starts from there.
 *  The same answer keeps the same object. */
export function step(s: Reading, y: number, h: number, end: number, may: boolean, room = 0): Reading {
  const d = h === s.h ? y - s.y : 0
  const run = d === 0 ? s.run : d < 0 ? Math.min(s.run, 0) + d : Math.max(s.run, 0) + d
  let on = s.on
  if (!may || end <= END_PX) on = false
  else if (!on && run <= -HIDE_PX && end - room > FAR_PX) on = true
  else if (on && run >= SHOW_PX) on = false
  // a change starts a new run, so turning back needs the full distance again
  const next = { on, y, h, run: on === s.on ? run : 0 }
  return next.on === s.on && next.y === s.y && next.h === s.h && next.run === s.run ? s : next
}

/** what the box and its column hold now (from the page, client.tsx) */
export interface Box {
  /** text in the box */
  text: boolean
  /** anything over the box's text row: a reply chip, files, pastes, a command chip, a mention or slash list */
  extras: boolean
  /** dictating, or in a voice call: the box's bar is that surface */
  voice: boolean
  /** the chat's newest row is an open question card, waiting for an answer */
  ask: boolean
  /** the on-screen keyboard is up (typing.ts) */
  keyboard: boolean
  /** the box or the tabs have focus (VoiceOver, a keyboard, a tap) */
  focus: boolean
}

/** Whether anything may step aside: never while you are writing or about to (text, a chip, files, dictation, the
 *  keyboard, focus in the box), nor while the newest row is a question waiting on you. */
export const allowed = (b: Box) => !(b.text || b.extras || b.voice || b.ask || b.keyboard || b.focus)
