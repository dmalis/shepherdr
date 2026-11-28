// fork #279 (and #235's "Triage: one card, not 150"): a run of one kind of chat card shown as one card, as iOS stacks a
// run of notifications from one app, GitHub and Slack group a run of notifications into one row, and Linear's inbox
// lists a batch of the same thing: more than GROUP_OVER of one kind in one chat are one card that says how many, and
// its Show them opens a sheet (a dialog on a desktop) of each card as it was, answered one by one. A sheet may carry a
// bulk action above them (`bulk`), only where answering the set at once is safe and the person's own call: never an
// agent's own prompt (AGENTS.md: no auto-answering an agent's prompts).
//
// Two ways in: a plugin whose chat cards group only in the chat wraps its card function in withGroups (one call at its
// registration); one whose grouping counts elsewhere too (Triage: one Needs you row) groups by itself and draws
// GroupCard and GroupSheet.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { GROUP_OVER } from '@shared/card-group.ts'
import type { Message, Snapshot } from '@shared/types.ts'
import { useSnap, useUI, type Thread, type UI } from './kernel.ts'
import { focusables } from './layer-focus.ts'
import { openDialog } from './overlay.tsx'
import { Btn } from './ui.tsx'
import './card-group.css'

export { GROUP_OVER }

/** one chat card, as a plugin's chatCards give it (kernel.ts Registry.chatCards) */
export type ChatCardOf = { key: string; at?: number; past?: boolean; after?: (m: Message) => boolean; node: ReactNode }
type CardsFn = (snap: Snapshot, thread: Thread) => ChatCardOf[]

/** The one card: how many wait, why, and Show them, which opens their sheet. `sheet` is drawn live (it reads the
 *  snapshot itself), so an answered card leaves it while it is open. `single` names the cards left when the group goes
 *  (a selector): the sheet closed after its one card went, focus goes to the first of them, not lost with the button. */
export function GroupCard({ id, title, peek, sub, label, sheet, single, ask = true }: {
  id: string
  title: ReactNode
  /** what the first of them are about (their names, oldest first): the card says some of each, as Android's group
   *  summary must, so it is more than a count */
  peek?: string[]
  sub?: ReactNode
  /** the sheet's name, for screen readers */
  label: string
  sheet: (close: () => void) => ReactNode
  single?: string
  /** it asks the person (data-ask: "1 question below" counts it) */
  ask?: boolean
}) {
  const hid = `cgrp-${id.replace(/[^\w-]/g, '-')}`
  return (
    <section className="card cgrp" data-card={id} {...(ask ? { 'data-ask': '' } : {})} aria-labelledby={`${hid}-q`} {...(sub ? { 'aria-describedby': `${hid}-s` } : {})}>
      <span className="t" id={`${hid}-q`}>{title}</span>
      {!!peek?.length && <span className="cgrp-peek">{peekWords(peek)}</span>}
      {sub && <span className="s" id={`${hid}-s`}>{sub}</span>}
      <div className="acts">
        <Btn kind="pri" onClick={(e) => { const opener = e.currentTarget; openDialog(sheet, { wide: true, label, onClose: () => focusLeft(opener, single) }) }}>Show them</Btn>
      </div>
    </section>
  )
}

/** the first two names and how many more: "Fix login, Faster search and 3 more" */
export function peekWords(names: string[]): string {
  const [a, b] = names
  if (names.length <= 2) return names.join(' and ')
  return `${a}, ${b} and ${names.length - 2} more`
}

/** the sheet closed after its one card went (answers left GROUP_OVER or fewer, each its own card again): focus goes to
 *  the first of them */
function focusLeft(opener: Element | null, single?: string) {
  if (!single) return
  setTimeout(() => {
    if (opener?.isConnected) return
    const card = document.querySelector<HTMLElement>(single)
    if (card) (focusables(card)[0] ?? card).focus()
  })
}

/** what the sheet's place is: a change of it (a card's own link opened a task, a screen or a file) closes the sheet, as
 *  a tap in an iOS stack opens its app and the stack goes */
const where = (u: UI) => [u.at, u.pane, u.task, u.max, u.art, u.scr?.key, u.settings?.sec].join('\n')

/** The sheet: its words, an optional bulk action, then each card as it is in the chat, one under the other, oldest
 *  first. Once one is answered and leaves, focus goes on to the card now in its place (the next one), as a mail app
 *  moves to the next message once one is archived; the last answered, to Close. Empty, it says so and keeps Close. */
export function GroupSheet({ title, note, items, bulk, head, headId, foot, actions, close }: {
  title: ReactNode
  note?: ReactNode
  items: { key: string; node: ReactNode }[]
  /** above the cards: the part a bulk action works on (Triage's ticked batch) */
  bulk?: ReactNode
  /** right above the cards (a heading for them under a bulk part), and its id, which names their section */
  head?: ReactNode
  headId?: string
  /** the bar at the sheet's foot, which stays in view while it scrolls (Gmail's and GitHub's bulk bars): what it says
   *  (an error, a list that changed) and its buttons after Close (a Post for the ticked ones) */
  foot?: ReactNode
  actions?: ReactNode
  close: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const done = useRef<HTMLDivElement>(null)
  const at = useRef(-1)
  const ids = items.map((c) => c.key).join(' ')
  useLayoutEffect(() => {
    const f = document.activeElement
    if (at.current < 0 || (f && f !== document.body && f.isConnected)) return
    const cards = box.current?.children
    const next = cards?.[Math.min(at.current, cards.length - 1)] as HTMLElement | undefined
    ;((next && focusables(next)[0]) ?? done.current?.querySelector('button'))?.focus()
  }, [ids])
  const place = useUI(where)
  const first = useRef(place)
  useEffect(() => { if (place !== first.current) close() }, [place, close])
  return (
    <>
      <h2>{title}</h2>
      {note && <p>{note}</p>}
      {bulk}
      {items.length > 0 && (
        <section className="cgrp-items" {...(headId ? { 'aria-labelledby': headId } : {})}>
          {head}
          <div className="cgrp-list" ref={box} onFocus={(e) => void (at.current = [...e.currentTarget.children].findIndex((c) => c.contains(e.target)))}>
            {items.map((c) => <div className="cgrp-item" key={c.key}>{c.node}</div>)}
          </div>
        </section>
      )}
      <div className="cgrp-foot">
        {foot}
        <div className="acts" ref={done}>
          <Btn onClick={close}>Close</Btn>
          {actions}
        </div>
      </div>
    </>
  )
}

/** one kind of card a plugin groups in the chat */
export interface CardKind {
  /** the group card's data-card */
  id: string
  /** is this card one of the kind (a review waiting for you, a stopped agent) */
  is: (card: ChatCardOf, snap: Snapshot) => boolean
  /** the group card's words for n, and the sheet's (none left: `none`) */
  title: (n: number) => string
  none: string
  sub?: string
  note?: string
  label: string
  /** what one is about, in a few words (its task's name): the group card names the first of them */
  name?: (card: ChatCardOf, snap: Snapshot) => string | undefined
  /** a single card of the kind, as a selector, for focus once the group goes */
  single?: string
  ask?: boolean
}

/** the cards of `kind` among a plugin's cards, oldest first */
const ofKind = (cards: ChatCardOf[], snap: Snapshot, kind: CardKind) => cards.filter((c) => kind.is(c, snap)).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))

/** a plugin's chat cards with each kind grouped: more than GROUP_OVER of it in one chat are one card, where the newest
 *  of them came up (below the newest later message any of them waits under); 3 or fewer stay as they are */
export function groupCards(cards: ChatCardOf[], snap: Snapshot, thread: Thread, kinds: CardKind[], all: CardsFn): ChatCardOf[] {
  let out = cards
  for (const kind of kinds) {
    const run = ofKind(out, snap, kind)
    if (run.length <= GROUP_OVER) continue
    const times = run.map((c) => c.at).filter((x): x is number => x !== undefined)
    const at = times.length ? Math.max(...times) : undefined
    const one: ChatCardOf = {
      key: kind.id,
      ...(at !== undefined ? { at } : {}),
      after: (m) => run.some((c) => !!c.after && (c.at === undefined || (m.at ?? 0) > c.at) && c.after(m)),
      node: <GroupCard id={kind.id} title={kind.title(run.length)} peek={kind.name ? run.map((c) => kind.name!(c, snap)).filter((x): x is string => !!x) : undefined} sub={kind.sub} label={kind.label} single={kind.single} ask={kind.ask} sheet={(close) => <KindSheet kind={kind} thread={thread} all={all} close={close} />} />,
    }
    const first = out.indexOf(run[0]!)
    out = [...out.slice(0, first).filter((c) => !run.includes(c)), one, ...out.slice(first).filter((c) => !run.includes(c))]
  }
  return out
}

/** a kind's sheet: the plugin's own cards of that kind, read live */
function KindSheet({ kind, thread, all, close }: { kind: CardKind; thread: Thread; all: CardsFn; close: () => void }) {
  const snap = useSnap()
  const items = snap ? ofKind(all(snap, thread), snap, kind) : []
  return <GroupSheet title={items.length ? kind.title(items.length) : kind.none} note={items.length ? kind.note : undefined} items={items} close={close} />
}

/** a plugin's card function with its kinds grouped: the one call at its registration
 *  (`reg.chatCards.push({ order, cards: withGroups(taskCards, KINDS) })`) */
export const withGroups = (cards: CardsFn, kinds: CardKind[]): CardsFn => (snap, thread) => groupCards(cards(snap, thread), snap, thread, kinds, cards)
