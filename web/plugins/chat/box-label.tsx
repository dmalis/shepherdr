// fork #105: the message box's own <label>, so iPhone Safari stops offering contact AutoFill in it (one signal Safari
// reads, shown to work in the iOS Simulator; a real iPhone is the issue's device check). Safari's AutoFill reads a
// field's <label>; a field with none (ours had only aria-label) gets its type guessed from the visible text
// around it, which in a chat is the messages above the box: a "phone", "name" or "address" in them and the bar over
// the keyboard says "AutoFill Contact", with the person's own number offered as they type. autocomplete="off" doesn't
// stop it (Apple: "Safari ignores autocomplete=off"). OpenClaw fixed the same bug this way, shown in the iOS Simulator
// before and after (openclaw/openclaw#199088). The label is for Safari only: hidden on screen and from screen
// readers, so the box's accessible name stays its aria-label, as before.

/** the words in the label: a plain name for a chat box, nothing a contact form would ask for */
export const BOX_LABEL = 'Message'

export function BoxLabel({ htmlFor }: { htmlFor: string }) {
  return (
    <label className="vh" htmlFor={htmlFor} aria-hidden="true">
      {BOX_LABEL}
    </label>
  )
}
