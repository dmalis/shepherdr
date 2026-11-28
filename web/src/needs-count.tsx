// Needs you 1/6, red counts and taps (dmalis/shepherdr, "Needs you: one happy path"). Red is Needs you: the one red
// count in the app, and a tap on it takes you to what needs you. One thing: its card, ready to answer. Two or more:
// Tasks, filtered to that scope's Needs you. The count is its own button beside the row (44px on a phone), never a
// button inside the row's button, so the row's name still opens the chat (Slack, Linear).
import type { Snapshot } from '@shared/types.ts'
import { clean, type TaskFilter } from '@shared/task-filter.ts'
import { itemLink, needsChats, needsFilter, needsWords, oneTarget, type NeedItem } from '@shared/needs-open.ts'
import { spaceLabel } from '@shared/view.ts'
import { getState, go, openLink, setUI } from './kernel.ts'
import { Row } from './ui.tsx'

/** open what needs you among these items: the one card, or the Needs you list of these spaces */
export function openNeeds(items: NeedItem[], scopes: string[], goTo?: string) {
  const one = oneTarget(items)
  if (one) return openItem(one)
  listNeeds(scopes, goTo)
}

/** the one thing, at its card: the app's own link to it, so a maximized task or a chat shown as a terminal gives way */
export const openItem = (i: NeedItem) => openLink(itemLink(i), true)

/** the Needs you list of these spaces, and only it, is what Tasks shows now */
const shown = (scopes: string[], goTo?: string) => {
  const ui = getState().ui
  return ui.pane === 'tasks' && !ui.task && ui.tab === 'Now' && (!goTo || ui.at === goTo) && JSON.stringify(clean(ui.tf)) === JSON.stringify(needsFilter(scopes))
}

/** Tasks, filtered to these spaces' Needs you (a chip, one tap to take off). False when it is already on screen, so a
 *  second tap does what the button always did; a drawer over it (the phone's Spaces) closes. */
export function listNeeds(scopes: string[], goTo?: string): boolean {
  if (shown(scopes, goTo)) {
    if (!getState().ui.drawer) return false
    setUI({ drawer: false })
    return true
  }
  if (goTo && getState().ui.at !== goTo) go(goTo)
  setUI({ tf: needsFilter(scopes), pane: 'tasks', task: null, art: null, artWide: false, tab: 'Now', drawer: false })
  return true
}

/** the chats among the filter's spaces that ask you themselves: they have no task row, so the Needs you group adds one */
export const needsAsks = (snap: Snapshot, f: TaskFilter, at: string) => (f.needs?.length ? needsChats(snap, f.needs, f, at) : f.view === 'needs' ? needsChats(snap, [''], f, at) : [])
export const AskRow = ({ snap, i }: { snap: Snapshot; i: NeedItem }) => (
  <Row icon="chat" label={i.title || `${spaceLabel(snap, i.place)} asks you`} sub={i.sub ?? (i.title ? `${spaceLabel(snap, i.place)}, in its chat` : 'In its chat')} onClick={() => openItem(i)} />
)

/** the red count: its own button, beside the row it counts for. Nothing when nothing needs you. */
export function NeedsCount({ n, onOpen, of }: { n: number; onOpen: () => void; of?: string }) {
  if (n <= 0) return null
  return (
    <button type="button" className="ncnt" aria-label={of ? `${of}: ${needsWords(n)}` : needsWords(n)} onClick={onOpen}>
      <span className="cnt needs">{n}</span>
    </button>
  )
}
