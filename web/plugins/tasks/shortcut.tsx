// fork UI 14 (Tasks: rows and headers that read in one look): a task row's one shortcut, the action its state calls
// for: Reply for a task that asks you something (its chat, at what it asks), Open PR for one ready for review with a
// pull request. As Gmail's and Linear's inbox rows, a mouse sees it on the row's hover (and a keyboard on its focus),
// in the place of the row's time; it is in the row's menu too, and on touch only there (later a swipe). Its name says
// the task, so a screen reader's list of buttons tells the rows apart.
import { Btn, I, cx } from '@client/ui.tsx'
import { openItem } from '@client/needs-count.tsx'
import { getState, type MenuRow } from '@client/kernel.ts'
import type { Snapshot, Task } from '@shared/types.ts'
import { tstate } from '@shared/view.ts'
import './rows.css'

export interface Shortcut {
  /** what the button says */
  label: string
  /** its accessible name: its words first, then the task */
  name: string
  icon: 'reply' | 'pr'
  /** its menu row's words */
  menu: string
  run: () => void
  /** a shortcut that goes to a page is a link, so Cmd/Ctrl-click and a middle click work as on any link */
  href?: string
}

/** the one shortcut a task's state calls for, or none */
export function shortcutOf(_snap: Snapshot, t: Task): Shortcut | null {
  const s = tstate(t)
  // ready for review with an open pull request: the pull request on GitHub, where it is reviewed
  if (s === 'ready' && t.pr && !t.pr.closed && !t.merged) {
    const url = t.pr.url
    return { label: 'Open PR', name: `Open PR #${t.pr.number} for ${t.name}`, icon: 'pr', menu: `Open PR #${t.pr.number}`, href: url, run: () => void window.open(url, '_blank', 'noopener,noreferrer') }
  }
  // its lead action is yours and asks something (a question, a prompt, a permission, a sign-in, a hand-up), in any
  // state the task shows (a working task's secret request too): its own chat, at that action's card, the exact link a
  // tap on the red count opens. A stopped task's card is its own (Restart), not a reply.
  if (t.action?.owner === 'you' && t.action.kind !== 'review' && !t.stopped && s !== 'done' && s !== 'archived') {
    const id = t.action.id
    return { label: 'Reply', name: `Reply to ${t.name}`, icon: 'reply', menu: 'Reply in its chat', run: () => openItem({ task: t.id, place: t.place, card: cardOf(id) }) }
  }
  return null
}

/** the action's card as it is when pressed (a menu or a row can outlive the snapshot it was drawn from): none when it
 *  was answered meanwhile, so the task opens at its newest instead */
export function cardOf(id: string): string | null {
  return getState().snap?.attention?.actions.find((a) => a.id === id)?.card ?? null
}

/** the shortcut's row in the task's menu, first: the same action, by touch and by the menu's keys */
export function shortcutRow(snap: Snapshot, t: Task): MenuRow[] {
  const sc = shortcutOf(snap, t)
  return sc ? [{ icon: sc.icon, label: sc.menu, run: sc.run }] : []
}

/** the button on a row (a link for a page): only with a mouse (a touch screen has the menu) */
export function ShortcutBtn({ sc, className, style }: { sc: Shortcut; className?: string; style?: React.CSSProperties }) {
  if (sc.href) {
    return (
      <a className={cx('btn s tsc', className)} style={style} href={sc.href} target="_blank" rel="noopener noreferrer" aria-label={sc.name} onClick={(e) => e.stopPropagation()}>
        <I n={sc.icon} />
        {sc.label}
      </a>
    )
  }
  return (
    <Btn small className={cx('tsc', className)} style={style} aria-label={sc.name} onClick={(e) => { e.stopPropagation(); sc.run() }}>
      <I n={sc.icon} />
      {sc.label}
    </Btn>
  )
}
