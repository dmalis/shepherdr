// fork #86: the keyboard's mark on <html> (typing.css reads it).

/** the class on <html> while the on-screen keyboard is up */
export const TYPING = 'kb-up'

/** Keeps `root` marked while `up()` says the keyboard is up: at once, then on every change the store reports. */
export function markTyping(root: { classList: { toggle(c: string, on: boolean): unknown } }, up: () => boolean, subscribe: (f: () => void) => () => void) {
  let was: boolean | null = null
  const mark = () => {
    const now = up()
    if (now === was) return
    was = now
    root.classList.toggle(TYPING, now)
  }
  mark()
  return subscribe(mark)
}
