// fork #86: while you type on a phone, the chat gets the room. With the on-screen keyboard up (the UI's `keyboard`,
// from viewport.ts: the visible height well under the page's while a text field has focus), <html> is marked kb-up and
// typing.css steps the bottom tabs, the header's second line and the notes on top aside. The mark goes on as the state
// changes, in the same frame as the new size, so the tabs never show over the keyboard first; it comes off once the
// keyboard has finished going down, so nothing climbs back while it slides away. iOS Messages, WhatsApp, Telegram and
// Slack do the same: the tab bar stays behind the keyboard.
import './typing.css'
import { definePlugin, getState, subscribe } from '@client/kernel.ts'
import { markTyping } from './typing.ts'

export default definePlugin({
  name: 'typing',
  setup() {
    markTyping(document.documentElement, () => getState().ui.keyboard, subscribe, window.visualViewport ?? null)
  },
})
