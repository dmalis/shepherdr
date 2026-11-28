// fork #279: the tasks plugin's chat cards that pile up in a space's chat (Everything's most of all), grouped by the
// shared group card (web/src/card-group.tsx): more than 3 reviews waiting for you are one card, as are more than 3
// stopped agents; Show them lists each card as it was, answered one by one. No Accept all: each merge is its own
// judgment and one can conflict with the next (GitHub and Linear merge one pull request at a time). No Restart all:
// an agent stopped at its plan's limit is never started again by Shepherdr in a batch (AGENTS.md: nothing that risks a
// ban). A review being merged and a done task's line stay where they are: they wait for no one.
import type { CardKind } from '@client/card-group.tsx'
import type { Snapshot } from '@shared/types.ts'
import { tstate } from '@shared/view.ts'

/** the task a card is about, from its key (review:<id>, stopped:<id>) */
const taskOf = (snap: Snapshot, key: string) => snap.tasks.find((t) => t.id === key.slice(key.indexOf(':') + 1))

export const TASK_KINDS: CardKind[] = [
  {
    id: 'reviews',
    is: (c, snap) => {
      if (!c.key.startsWith('review:') || c.past) return false
      const t = taskOf(snap, c.key)
      return !!t && tstate(t) === 'ready' && t.status !== 'merging' && !t.accepting
    },
    name: (c, snap) => taskOf(snap, c.key)?.name,
    title: (n) => (n === 1 ? '1 task waits for your review' : `${n} tasks wait for your review`),
    none: 'Nothing waits for your review',
    sub: 'Each waits for its own answer.',
    note: 'Look at each one and answer it on its own, oldest first.',
    label: 'Tasks to review',
    single: '[data-card^="review:"]',
    ask: false,
  },
  {
    id: 'stops',
    is: (c) => c.key.startsWith('stopped:'),
    name: (c, snap) => taskOf(snap, c.key)?.name,
    title: (n) => (n === 1 ? '1 task stopped' : `${n} tasks stopped`),
    none: 'Nothing is stopped',
    sub: 'Their agents are no longer running. Restart each one that should carry on.',
    note: 'Shepherdr never starts a stopped agent again on its own. Restart each one that should carry on.',
    label: 'Stopped tasks',
    single: '[data-card^="stopped:"]',
    ask: false,
  },
]
