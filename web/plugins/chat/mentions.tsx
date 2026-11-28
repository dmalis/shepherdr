// # and @ in the message box (GitHub #1552, back from 3.1): "#" lists the spaces this chat's agent can reach (its
// machine's reach map, what tell-assistant follows, from /api/reach), "@" the tasks in those spaces. Up/Down and
// Enter or Tab pick, Escape closes, a tap picks (the box keeps the keyboard). The box shows the short "#shop" or
// "@SHEP-4"; at send each picked one becomes the link the agent and the chat read: [#shop](space:…) or
// [@Fix login](task:…) (core/mentions.js).
import { useEffect, useLayoutEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import * as MN from '@core/mentions.js'
import { go, notice, openTask, useSnap } from '@client/kernel.ts'
import { draftOf, keepDraft } from '@client/draft.ts'
import { Row } from '@client/ui.tsx'
import { SpaceIcon } from '@client/space-icon.tsx'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import type { Place, Snapshot, Task } from '@shared/types.ts'
import { machineLabel, spaceName, taskRef } from '@shared/view.ts'
import { KindWord } from './kind.tsx'
import { taskKind } from '@shared/kinds.ts'
import { composingKey, useListFit } from './list-fit.ts'
import './mentions.css'

const M = MN as any

/** as: the word the box writes for it when its name alone is another space's too ("shop.vm", sharedName()) */
export type Reach = { id: string; name: string; route: string; machine: string; target: string; emoji?: string; as?: string }
export type Got = { from: string | null; spaces: Reach[]; checked: number | null }
type TaskPick = { ref: string; route: string; folder: string; title: string }

/* ---------- what this chat's agent reaches: asked for when a list first opens, kept a minute ---------- */

const asked = new Map<string, number>()
const known = new Map<string, Got>()
const listeners = new Set<() => void>()

function load(chatKey: string) {
  if (Date.now() - (asked.get(chatKey) ?? 0) < 60_000) return
  asked.set(chatKey, Date.now())
  fetch(`api/reach?chat=${encodeURIComponent(chatKey)}`, { headers: { 'x-shepherdr': '1' } })
    .then((r) => r.json())
    .catch(() => ({ from: null, spaces: [], checked: null }))
    .then((g: Got) => {
      known.set(chatKey, { ...g, spaces: g?.spaces ?? [] })
      listeners.forEach((f) => f())
    })
}

function useReach(chatKey: string, want: boolean): Got | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!want) return
    const on = () => tick((n) => n + 1)
    listeners.add(on)
    load(chatKey)
    return () => void listeners.delete(on)
  }, [chatKey, want])
  return known.get(chatKey) ?? null
}

/* ---------- the lists ---------- */

export type Item = { kind: 'space'; key: string; space: Reach; place?: Place } | { kind: 'task'; key: string; task: Task; pick: TaskPick; where: string }

/** a space by its own id (another machine's place ids are "machine/id") */
const placeById = (snap: Snapshot, id: string) => snap.places.find((p) => p.id === id || p.id.endsWith(`/${id}`))
const bare = (id: string) => id.split('/').pop()!

/** "shop", or "shop · vm-demo" for another machine's, or where another machine has a space of the same name */
function whereOf(snap: Snapshot, t: Task) {
  const p = snap.places.find((x) => x.id === t.place)
  if (!p) return ''
  const name = spaceName(snap, p)
  const mine = p.machine ?? snap.host
  const twin = snap.places.some((x) => x.id !== p.id && (x.machine ?? snap.host) !== mine && spaceName(snap, x) === name)
  return mine !== snap.host || twin ? `${name} · ${machineLabel(snap, mine)}` : name
}

/** Two spaces with one name keep their machine (fork, "Writing: the @, # and / lists fit the room"): in the # list
 *  each such row names its machine, and one on another machine goes in the box as "#shop.vm", as GitHub writes
 *  another repo's "owner/repo#12", so "#shop" stays this machine's and each pick sends its own space. */
export function sharedName(spaces: Reach[]): Reach[] {
  return spaces.map((s) => {
    if (!spaces.some((x) => x !== s && x.name === s.name && x.target !== s.target)) return s
    return s.route ? { ...s, as: `${s.name}.${s.machine.replace(/[^\w.-]+/g, '-')}` } : s
  })
}
const twinned = (s: Reach, all: Reach[] | undefined) => !!all?.some((x) => x.target !== s.target && x.name === s.name)

/** what the box is typing before its cursor: a "#word" (spaces) or an "@word" (tasks), else null */
export function typed(before: string): { kind: '#' | '@'; q: string } | null {
  const t = M.typingTask(before)
  if (t !== null) return { kind: '@', q: t }
  const s = M.typing(before)
  return s !== null ? { kind: '#', q: s } : null
}

/** the list for what is typed. Spaces: the ones this chat's agent reaches. Tasks: the ones in those spaces (before
 *  that list comes, the chat's own space's), waiting on you and at work first, Done last. */
export function mentionItems(snap: Snapshot, here: string, kind: '#' | '@', q: string, got: Got | null): Item[] {
  if (kind === '#') return ((got ? M.match(sharedName(got.spaces), q, 8) : []) as Reach[]).map((s) => ({ kind: 'space', key: `s:${s.target}`, space: s, place: placeById(snap, s.id) }))
  const reachOf = (t: Task): Reach | null => got?.spaces.find((s) => s.id === bare(t.place)) ?? (!got && t.place === here ? { id: bare(here), name: '', route: '', machine: '', target: bare(here) } : null)
  const live = snap.tasks.filter((t) => !t.archived && t.place && /^[\w.-]+$/.test(taskRef(t)) && reachOf(t))
  const rows = live.map((t) => ({ ref: taskRef(t), title: t.name, status: t.status, at: t.at, space: snap.places.find((p) => p.id === t.place)?.name, machine: t.on, t }))
  return (M.matchTasks(rows, q, 8) as typeof rows).map(({ t }) => {
    const r = reachOf(t)!
    return { kind: 'task', key: `t:${t.id}`, task: t, where: whereOf(snap, t), pick: { ref: taskRef(t), route: r.route, folder: t.place === here ? '' : (t.taskFolder ?? ''), title: t.name } }
  })
}

/* ---------- what was picked in each chat's box: its full link goes in at send ---------- */

// kept with the rest of its box's draft, so a reloaded draft still sends what each one points at (draft.ts, fork #149)
const spacesOf = (chatKey: string) => (draftOf(chatKey).picks?.spaces ?? []) as Reach[]
const tasksOf = (chatKey: string) => (draftOf(chatKey).picks?.tasks ?? []) as TaskPick[]

function remember(chatKey: string, i: Item) {
  const spaces = i.kind === 'space' ? [...spacesOf(chatKey).filter((x) => (x.as ?? x.name) !== (i.space.as ?? i.space.name)), i.space] : spacesOf(chatKey)
  const tasks = i.kind === 'space' ? tasksOf(chatKey) : [...tasksOf(chatKey).filter((x) => x.ref !== i.pick.ref), i.pick]
  keepDraft(chatKey, 'picks', { spaces, tasks })
}

/** the words to send: each picked "#name" and "@REF" as its link. The picks stay with the draft until it is safely
 *  sent (dropPicks) */
export function expandPicked(chatKey: string, text: string): string {
  const spaces = spacesOf(chatKey)
  // "#shop.vm" is that space's word in the box only: its link reads "#shop", as every space's does
  let out: string = M.expand(text, spaces.map((s) => (s.as ? { ...s, name: s.as } : s)))
  for (const s of spaces) if (s.as) out = out.split(`[#${s.as}](space:${s.target})`).join(`[#${s.name}](space:${s.target})`)
  return M.expandTasks(out, tasksOf(chatKey))
}
/** the picks are spent: their draft was sent */
export const dropPicks = (chatKey: string) => keepDraft(chatKey, 'picks', undefined)

/** the box after a pick: the "#word" or "@word" before the cursor swapped for "#name " or "@REF " (its link goes in
 *  at send) */
export function takeItem(chatKey: string, before: string, after: string, i: Item): { text: string; caret: number } {
  remember(chatKey, i)
  const b = i.kind === 'space' ? M.pickInto(before, { name: i.space.as ?? i.space.name }) : M.pickTaskInto(before, i.pick)
  const a = /^\s/.test(after) ? after.replace(/^ /, '') : after
  return { text: b + a, caret: b.length }
}

/* ---------- the box's side ---------- */

/** the # and @ list of a chat's message box: what it shows over the box, and what the box's textarea gets */
export function useMentions(chatKey: string, here: string, text: string, setText: (t: string) => void, ref: RefObject<HTMLTextAreaElement | null>) {
  const snap = useSnap()
  const [caret, setCaret] = useState<number | null>(null)
  const [shut, setShut] = useState<string | null>(null)
  const [at, setAt] = useState(0)
  const before = caret === null ? null : text.slice(0, caret)
  const t = before === null ? null : typed(before)
  const got = useReach(chatKey, !!t)
  const items = useMemo(() => (t && snap ? mentionItems(snap, here, t.kind, t.q, got) : []), [t?.kind, t?.q, snap?.tasks, snap?.places, got, here])
  // nothing matching a typed word (an issue's #12) shows nothing; a bare # or @ says what is coming
  const open = !!t && before !== shut && (items.length > 0 || t.q === '')
  useLayoutEffect(() => setAt(0), [t?.kind, t?.q])
  const sel = Math.min(at, items.length - 1)
  const id = `ml-${chatKey.replace(/[^\w-]/g, '_')}`
  const fit = useListFit(open, sel, `${t?.kind}${t?.q}`)

  const sync = () => {
    const el = ref.current
    setCaret(el && document.activeElement === el && el.selectionStart === el.selectionEnd ? el.selectionStart : null)
  }
  const pick = (i: Item | undefined) => {
    if (!i || before === null) return
    const now = takeItem(chatKey, before, text.slice(before.length), i)
    setText(now.text)
    setCaret(now.caret)
    const el = ref.current
    if (!el) return
    el.focus()
    requestAnimationFrame(() => el.setSelectionRange(now.caret, now.caret))
  }
  /** true when the list took the key */
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || composingKey(e)) return false
    const n = items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (n) setAt((sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      if (!n) return false
      pick(items[sel])
    } else if (e.key === 'Escape') {
      setShut(before)
      e.stopPropagation()
    } else return false
    e.preventDefault()
    return true
  }

  const list = open && t ? (
    <div ref={fit.ref} className="pop mlist" role="listbox" id={id} aria-label={t.kind === '#' ? 'Mention a space' : 'Mention a task'}>
      <div className="lab">{t.kind === '#' ? (got?.from ? `Spaces ${got.from} can reach` : 'Spaces this agent can reach') : 'Tasks this agent can reach'}</div>
      {!items.length && <p className="hint">{t.kind === '#' && !got ? 'Looking for spaces…' : t.kind === '#' ? 'No spaces it can reach yet.' : 'No tasks yet.'}</p>}
      {items.map((i, n) => (
        <Row
          key={i.key}
          id={`${id}-${n}`}
          role="option"
          aria-selected={n === sel}
          tabIndex={-1}
          lead={i.kind === 'space' ? (i.place && snap ? <SpaceIcon snap={snap} id={i.place.id} /> : <span className="mhash" aria-hidden="true">{i.space.emoji ?? '#'}</span>) : <StatusIcon t={i.task} time="none" />}
          label={i.kind === 'space' ? i.space.name : i.task.name}
          sub={i.kind === 'space' ? (i.space.route || twinned(i.space, got?.spaces) ? i.space.machine : undefined) : [i.task.schedule ? taskKind(i.task) : '', taskRef(i.task), i.where].filter(Boolean).join(' · ')}
          onMouseDown={(e) => e.preventDefault()}
          onMouseMove={() => n !== sel && (fit.onHover(), setAt(n))}
          onClick={() => pick(i)}
        />
      ))}
    </div>
  ) : null

  return {
    list,
    onKey,
    box: {
      // where the cursor is: typing doesn't always fire select, so input and key-up say it too
      onSelect: sync,
      onInput: sync,
      onKeyUp: sync,
      onFocus: sync,
      onBlur: () => setCaret(null),
      'aria-controls': open ? id : undefined,
      'aria-activedescendant': open && items.length ? `${id}-${sel}` : undefined,
    },
  }
}

/* ---------- in your own message ---------- */

/** A bare key prefers the chat's space, then its machine. A picked link carries its own route. */
export function taskFor(snap: Snapshot | null, target: string, place?: string, picked = true): Task | undefined {
  if (!snap) return
  const { ref, route, folder } = M.parseTask(target)
  const here = snap.places.find((p) => p.id === place)?.machine
  const hop = route.split('>').at(-1)
  const machine = hop ? snap.machines.find((m) => [m.machine, m.ownName, m.name].includes(hop))?.machine ?? hop : here
  const all = snap.tasks.filter((t) => taskRef(t) === ref && (!folder || t.taskFolder === folder ||
    (folder.startsWith('~/') && t.taskFolder?.endsWith(folder.slice(1)))))
  const sameMachine = all.filter((t) => t.on === machine)
  const sameSpace = sameMachine.filter((t) => t.place === place || t.asked === place)
  const matches = sameSpace.length ? sameSpace : sameMachine.length || (picked && machine !== undefined) ? sameMachine : all
  return matches.length === 1 ? matches[0] : undefined
}

function MentionLink({ kind, name, target, here }: { kind: 'space' | 'task'; name: string; target: string; here?: string }) {
  const snap = useSnap()
  const task = kind === 'task' ? taskFor(snap, target, here) : undefined
  const place = kind === 'space' && snap ? placeById(snap, bare(target)) : undefined
  const open = () => {
    if (kind === 'task') return task ? openTask(task.id) : notice('That task is not in your lists here.')
    return place ? go(place.id) : notice('That space is not in your list here.')
  }
  return (
    <a className="lk" role="link" tabIndex={0}
      onClick={(e) => { e.stopPropagation(); open() }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); open() } }}>
      {kind === 'space' ? `#${name}` : <><KindWord t={task} />{task?.name ?? name}</>}
    </a>
  )
}

/** your words with each picked [#space](space:…) and [@task](task:…) as a link to it; `rest` draws the words between */
export function withMentions(text: string, rest: (t: string, key: string) => ReactNode[], here?: string): ReactNode[] {
  if (!M.hasMention(text)) return rest(text, '')
  return (M.split(text) as ({ text: string } | { mention: { name: string; target: string } } | { task: { name?: string; ref: string; target: string } })[]).flatMap((p, i) =>
    'mention' in p ? [<MentionLink key={`m${i}`} kind="space" name={p.mention.name} target={p.mention.target} />]
      : 'task' in p ? [<MentionLink key={`m${i}`} kind="task" name={p.task.name ?? p.task.ref} target={p.task.target} here={here} />]
        : rest(p.text, `${i}.`),
  )
}

// for tests
export const _reach = { known, asked }
