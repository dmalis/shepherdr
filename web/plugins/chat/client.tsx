// The chat: an agent's messages (formatted text, code, tables, pictures), one quiet line while it works saying what
// it is doing, one small folded row per turn ("Ran 4 commands · edited 2 files"), cards where it needs you, and the
// message box. The same parts draw a space's chat and a task's thread.
import { Fragment, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { copyText } from '@client/copy.ts'
import { dictatedInto, TEXT_IN_CALL, useDictating } from '@client/dictate.tsx'
import { attr } from '@client/attr.ts'
import { boxPart, focusBox, focusChat } from '@client/commands.ts'
import { act, attempt, definePlugin, getDraft, getState, has, notice, openTask, registry, retryNow, setDraft, setUI, tryAct, useChat, useDraft, useSnap, useStore, useUI, type MenuRow, type Thread } from '@client/kernel.ts'
import { endComposition, isEcho, type Sent } from './echo.ts'
import { partsOf, placeOutgoing, placesOf, keyOf, readNow, showsAs, type Outgoing } from '@client/outbox.ts'
import { confirm, openMenu } from '@client/overlay.tsx'
import { AgentLine, openPicker, pickFor, pickWords, reportedPick, type Pick } from '@client/picker.tsx'
import { attach, detach, dropOut, retry, reupload, send, type Posted } from '@client/send.ts'
import { whenSafe } from '@client/draft.ts'
import { calm } from '@client/motion.ts'
import { ActBtn, ActError, Btn, cx, Empty, Failed, I, IB, Loading, useCardActs, useGrow } from '@client/ui.tsx'
import { say } from '@client/live.ts'
import type { IconName } from '@client/icons.ts'
import { isImage, isVideo } from '@shared/files.ts'
import type { Chat, Message, Relay, Snapshot, Task, TaskBrief, TurnActivity } from '@shared/types.ts'
import { isEverything, placeOf, spaceLabel, statusWord, taskChat, taskOf } from '@shared/view.ts'
import { StatusIcon } from '@plugins/tasks/icon.tsx'
import { DoneRow, QuestionCard, SecretCard } from './cards.tsx'
import { briefFrom, deliveryWord, looksLong, startWords } from './brief.ts'
import { relayLabel, relayState, relayWhy } from './relay.ts'
import { quickFit, type QuickFit } from './press.ts'
import { replyToTask, SlideHint, useSlide } from './slide.tsx'
import { dayLabel } from './days.ts'
import { Markdown, withLinks } from './markdown.tsx'
import { useNewestFirst } from './first-rows.ts'
import { dropPicks, expandPicked, useMentions } from './mentions.tsx'
import { KindLine, KindName } from './kind.tsx'
import { taskKind } from '@shared/kinds.ts'
import { modelTyped, useSlash } from './slash.tsx'
import { dropped, pasted } from './paste.ts'
import { addPaste, dropPaste, getPastes, isLongMessage, isLongPaste, outgoing, peekOf, putBack, setPastes, sizeOf, typedEdit, usePastes, type Paste } from './fold.ts'
import { fineOnly, touch } from './clip.ts'
import { AddButtons } from './attach.tsx'
import { useFileDrag } from './attach.tsx'
import { holdSuggestion } from './edit-keeps.tsx'
import './phone-bar.css'
import './rhythm.css'
import { landLaunchShare, putAway, useLanded, watchLastChat } from './share.ts'
import { openSendTo } from './sendto.tsx'
import { ReplyPress, repliesHidden, suggestionOf, suggestionsOn } from './suggest.ts'
import { bubbleQuote, ReplyingTo } from './reply-bubbles.tsx'
import { taskReplies } from './task-replies.ts'
import { UpdateHint, updateRows } from './update.tsx'
import { endRows, restartRows } from './restart.tsx'
import { BoxThumb, openPreview, SentThumb, sourcesOf } from './thumbs.tsx'
import { imagesLine, lostLine, useLost } from './sent-images.ts'
import { heldStep, signOf } from './typing.ts'
import { BoxLabel } from './box-label.tsx'
import { enterHint, sendsNow } from '@client/enter.ts'
import { folderRows } from './folder-row.tsx'
import { Jobs } from './jobs.tsx'
import { newsRow, type NewsRow } from './news.ts'
import { waitsOnPerson } from '@shared/needs-you.ts'
import { cardsAfter, cardsNow, stillLoading, TRIES, wantsEarlier } from './hold.ts'
import { onPageReturn } from '@client/viewport.ts'
import { keepAtEnd, movedUp, rowEdges } from './stick.ts'
import { OFF_PX, asksBelow, isOffEnd, newSince, onAsk, onEnd, questionsBelow, setOffEnd, toAsk, toEnd, useOffEnd } from './newest.ts'
import { editedDraft, heldOf, isHeld } from './queued.ts'
import { AskLine, afterOf, boxLine } from './asking-box.tsx'
import { commandMode, commandOf, commandWord, type CommandState } from './command.ts'
import { toggleSpaceTerm, toggleTaskTerm } from '@plugins/terminal/menu.ts'

export { fileUrl } from './thumbs.tsx'

const clock = (at: number) => {
  const d = new Date(at)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** a new time divider after this long without a message */
const QUIET = 30 * 60_000

/** "Ran 4 commands · edited 2 files": what a turn did, in one line */
export function didWords(a: TurnActivity): string {
  if (a.summary) return a.summary
  const n: Record<string, number> = {}
  for (const r of a.rows) n[r.kind] = (n[r.kind] ?? 0) + Math.max(1, r.steps.length)
  const say = (k: string, one: string, many: string) => (n[k] ? `${one} ${n[k]} ${n[k] === 1 ? many.replace(/s$/, '') : many}` : '')
  const parts = [say('run', 'ran', 'commands'), say('edit', 'edited', 'files'), say('read', 'read', 'files'), say('search', 'searched', 'times'), say('web', 'opened', 'pages'), say('agent', 'started', 'helpers'), say('other', 'took', 'steps')].filter(Boolean)
  const t = parts.join(' · ') || `${a.steps} ${a.steps === 1 ? 'step' : 'steps'}`
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** one small folded row per turn; it opens to list what it did */
function Did({ a }: { a: TurnActivity }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <I n={open ? 'down' : 'right'} c="s16" />
        {didWords(a)}
      </button>
      {open && (
        <div className="files">
          {a.rows.map((r) => (
            <span key={r.key}>
              {r.text}
              <em>{[r.added ? `+${r.added}` : '', r.removed ? `−${r.removed}` : '', r.failed ? 'failed' : ''].filter(Boolean).join(' ')}</em>
            </span>
          ))}
          {a.more ? <span>and {a.more} more</span> : null}
        </div>
      )}
    </>
  )
}

/** one quiet row, as a turn's "Ran 4 commands", never a bubble: an icon, its words, then muted ones (its time, a
 *  state); with a body, a tap opens it under the row (a long one scrolls in place) and a tap again folds it. Task news
 *  (SHEP-365) and messages between agents (SHEP-368) are drawn with it, one style for both. */
function QuietRow({ icon, label, meta = [], body, startOpen = false, kind }: { icon: IconName; label: string; meta?: { word: string; tone?: 'red' | 'amber' }[]; body?: ReactNode; startOpen?: boolean; kind: string }) {
  const [open, setOpen] = useState(startOpen)
  const words = (
    <>
      <I n={icon} c="s16" />
      <span className="ql">
        {label}
        {meta.filter((x) => x.word).map((x, i) => <span key={i} className={cx('qm', x.tone === 'red' && 'c-red', x.tone === 'amber' && 'c-ask')}>{x.word}</span>)}
      </span>
    </>
  )
  // its own icon stands in the chat's one icon column (SHEP-383), so its words line up with every other row's; the
  // fold's chevron trails the words
  if (!body) return <div className={cx('fold quiet', kind)}>{words}</div>
  return (
    <>
      <button type="button" className={cx('fold quiet', kind)} aria-expanded={open} onClick={() => setOpen(!open)}>
        {words}
        <I n={open ? 'down' : 'right'} c="s16 qv" />
      </button>
      {open && <div className={cx('quietb', `${kind}b`)}>{body}</div>}
    </>
  )
}

/** a recap of what happened while you were away: a quiet block of its own, its words in the chat's size, labelled */
function RecapNote({ text, at, place }: { text: string; at?: number; place: string }) {
  return (
    <section className="recap" aria-label="Recap">
      <div className="rh">
        <I n="clock" c="s16" />
        <span>Recap</span>
        {at ? <span className="qm">{clock(at)}</span> : null}
      </div>
      <Markdown text={text} place={place} />
    </section>
  )
}

/** a task's news as one quiet row (news.ts newsRow); longer words wait behind its fold */
function NewsLine({ row, at }: { row: NewsRow; at?: number }) {
  return <QuietRow kind="news" icon="note" label={row.label} meta={at ? [{ word: clock(at) }] : []} body={row.body ? <div className="qt">{row.body}</div> : undefined} />
}

/** a message between agents (SHEP-368), in the sender's chat and the receiver's: whom it went to or who sent it, when,
 *  and whether it got there; it opens to its words (and the files it came with), and why it waits or didn't go */
export function RelayRow({ r, text, at, startOpen = false }: { r: Relay; text: string; at?: number; startOpen?: boolean }) {
  const why = relayWhy(r)
  return (
    <QuietRow kind="relay" icon={r.dir === 'to' ? 'send' : 'chat'} label={relayLabel(r)} startOpen={startOpen} meta={[{ word: at ? clock(at) : '' }, relayState(r)]}
      body={
        <>
          {why && <p className={cx('qw', r.state === 'failed' ? 'c-red' : 'c-ask')}>{why}</p>}
          <div className="qt">{text}</div>
          {r.files?.length ? (
            <ul role="list" className="qf">
              {r.files.map((f, i) => <li key={i}><I n="doc" c="s16" />{f}</li>)}
            </ul>
          ) : null}
        </>
      } />
  )
}

/** the line naming the task above messages that came from it */
/** a quiet "how it closed" line's words: what closed and how ("Fix login · Run: npm test · Allowed"); none when it
 *  has no words (a bare "Ended" says nothing) or is the same as the line right above it */
export function endedLine(text: string, above: string): string | null {
  const line = text.trim()
  return line && line !== above.trim() ? line : null
}

function TaskRef({ id, title, t }: { id: string; title: string; t?: Task }) {
  // a slide to the right replies to the task here, as to a message
  const { on, slide, armed, skip, moving } = useSlide(() => replyToTask({ id, name: title }))
  return (
    <button type="button" className="ref tslide" {...on} onClick={() => (skip.current ? void (skip.current = false) : openTask(id))}>
      <SlideHint slide={slide} armed={armed} />
      <span className={cx('tmv', moving.className)} style={moving.style} onTransitionEnd={moving.onTransitionEnd}>
        {t ? <StatusIcon t={t} time="side" /> : <I n="chat" c="s16" />}
        <KindName t={t} name={title} state={t ? statusWord(t).word : undefined} />
      </span>
    </button>
  )
}

/** the task a message replies to, above its words: its state and title; a tap opens it */
function TaskQuote({ id, title }: { id: string; title: string }) {
  const snap = useSnap()
  const t = snap ? taskOf(snap, id) : undefined
  const word = t ? statusWord(t).word : ''
  return (
    <button
      type="button"
      className="quote qtask"
      aria-label={`Replying to the ${taskKind(t).toLowerCase()} ${t?.name ?? title}${word ? `, ${word}` : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        openTask(id)
      }}
    >
      {t ? <StatusIcon t={t} time="none" /> : <I n="tasks" c="s16" />}
      <KindName t={t} name={t?.name ?? title} state={word} />
    </button>
  )
}

/** the message a reply answers, quoted above its words: a tap goes to it and lights it, while the chat still has it */
function Quote({ q }: { q: NonNullable<Message['reply']> }) {
  if (!q.id) return <span className="quote">{q.text}</span>
  return (
    <button
      type="button"
      className="quote"
      onClick={(e) => {
        e.stopPropagation()
        setUI({ jump: q.id!, chatLink: null })
      }}
    >
      {q.text}
    </button>
  )
}

/** reply to a message: a quote of it goes in the box, and the box takes the keyboard */
export function replyTo(msg: Message, key: string) {
  const text = msg.text ?? msg.file?.name ?? ''
  setUI((ui) => ({ reply: { ...ui.reply, [key]: { id: msg.id, who: msg.who, text: text.slice(0, 200) } } }))
  document.querySelector<HTMLTextAreaElement>(`textarea[data-box="${attr(key)}"]`)?.focus()
}

function msgMenu(anchor: Element, msg: Message, chat: Chat, thread: Thread, select: () => void, reply?: () => void) {
  const key = thread.chat
  const text = msg.text ?? msg.file?.name ?? ''
  const rows: MenuRow[] = [
    // Reply puts a quote of the message in the box
    { icon: 'reply', label: 'Reply', run: () => (reply ? reply() : replyTo(msg, key)) },
    { icon: 'copy', label: 'Copy', run: () => void copyText(text).then((ok) => ok && notice('Copied')) },
    // Select text makes that message's text selectable
    { icon: 'select', label: 'Select text', run: select },
    // Share opens the device's share sheet, or copies on a desktop
    { icon: 'share', label: 'Share', run: () => (navigator.share ? void navigator.share({ text }).catch(() => undefined) : void copyText(text).then((ok) => ok && notice('Copied'))) },
    ...registry.messageMenu.flatMap((m) => m.rows?.(msg, chat) ?? []),
  ]
  const tops = registry.messageMenu.filter((m) => m.Top)
  openMenu(anchor, rows, { label: 'Message', top: tops.length ? (close) => tops.map((m, i) => (m.Top ? <m.Top key={i} msg={msg} chat={chat} close={close} /> : null)) : undefined })
}

/* ---------- acting on a message (SHEP-332) ---------- */

/** the one message whose quick bar a tap opened: `y`, where on it the tap was (px from its top) */
let quickNow: { id: string; y: number | null } | null = null
const quickSubs = new Set<() => void>()
function setQuick(q: typeof quickNow) {
  quickNow = q
  quickSubs.forEach((f) => f())
}
const quickSub = (f: () => void) => {
  quickSubs.add(f)
  return () => void quickSubs.delete(f)
}
const useQuick = (id: string) => useSyncExternalStore(quickSub, () => (quickNow?.id === id ? quickNow : null))

/** The quick bar beside a message, on its open side: add a reaction, reply, more (the whole menu); on a narrow screen
 *  only the first. `y`: where to centre it, for a message taller than the screen. */
function QuickBar({ msg, chat, mine, wrap, y, done, more, reply: onReply }: { msg: Message; chat: Chat; thread: Thread; mine: boolean; wrap: HTMLElement; y: number | null; done: () => void; more: (el: Element) => void; reply: () => void }) {
  const phone = useUI((u) => u.phone)
  const [fit, setFit] = useState<QuickFit | null>(null)
  useLayoutEffect(() => {
    const w = wrap.getBoundingClientRect()
    const m = (wrap.parentElement ?? wrap).getBoundingClientRect()
    setFit(quickFit(mine ? w.left - m.left : m.right - w.right, !phone))
  }, [wrap, mine, phone])
  const quick = registry.messageQuick
  const reply = (
    <button key="reply" type="button" className="qbtn" aria-label="Reply" onClick={() => { done(); onReply() }}>
      <I n="reply" />
    </button>
  )
  const buttons = [
    ...quick.map((q, i) => <q.View key={`q${i}`} msg={msg} chat={chat} />),
    reply,
    <button key="more" type="button" className="qbtn" aria-label="More" aria-haspopup="menu" onClick={(e) => more(e.currentTarget)}>
      <I n="dots" />
    </button>,
  ]
  // centred on the bubble (not its reactions); on one taller than a phone's thumb reach, where it was touched
  const b = wrap.querySelector<HTMLElement>('.b')
  const h = b?.offsetHeight ?? wrap.offsetHeight
  const top = y === null || h <= 120 ? `${(b?.offsetTop ?? 0) + h / 2}px` : `${Math.min(Math.max(y, 24), h - 24)}px`
  return (
    <div
      className={cx('qb', mine ? 'l' : 'r', fit?.over && 'over')}
      role="toolbar"
      aria-label="Message actions"
      style={{ top, visibility: fit ? undefined : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="qbx">{fit?.actions === 'react' ? buttons[0] : buttons}</div>
      {fit?.time && msg.at ? <span className="qt">{clock(msg.at)}</span> : null}
    </div>
  )
}

/** a `!` command you ran in the agent's shell: the command in monospace with how it went (sending, running, done,
 *  failed), and what it printed under it; one that didn't go has Retry and Remove, as a message has */
function CommandRow({ msg, state, failed, gap }: { msg: Message; state: CommandState; failed?: string; gap: boolean }) {
  const out = msg.command?.out ?? ''
  const tone = state === 'failed' || state === 'unsent' ? 'c-red' : state === 'running' || state === 'sending' ? 'c-ask' : 'c-mute'
  // how it went reaches screen readers through the app's one live region (live.ts), once per change: not sent is
  // said there by the outbox already (kernel.ts), so not again here
  const was = useRef(state)
  useEffect(() => {
    if (was.current === state) return
    was.current = state
    if (state === 'running' || state === 'done' || state === 'failed') say(`${(msg.text ?? '').replace(/^\s*!\s*/, '')}: ${commandWord[state]}`)
  }, [state, msg.text])
  return (
    <div className={cx('cmdrow', gap && 'gap', (state === 'sending' || state === 'running') && 'live')} data-msg={msg.id} data-state={state}>
      <div className="cmdh">
        <I n="prompt" c="s16" />
        <code className="cmdc">{(msg.text ?? '').replace(/^\s*!\s*/, '')}</code>
        <span className={cx('cmds', tone)}>{commandWord[state]}{state === 'unsent' && failed ? ` · ${failed}` : ''}</span>
      </div>
      {out && <pre className="cmdo">{out}</pre>}
      {state === 'unsent' && msg.cid && (
        <div className="cmdf">
          <span className="lk" role="button" tabIndex={0} onClick={() => retry(msg.cid!)}>Retry</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => dropOut(msg.cid!)}>Remove</span>
        </div>
      )}
    </div>
  )
}

type BubbleProps = { msg: Message; chat: Chat; thread: Thread; gap: boolean; pending?: boolean; failed?: string; mark?: Shown['mark']; onReply?: () => void }
/** a bubble reads only its thread's chat and space: a thread made again for the same chat is the same to it */
const sameBubble = (a: BubbleProps, b: BubbleProps) =>
  a.msg === b.msg && a.chat === b.chat && a.gap === b.gap && a.pending === b.pending && a.failed === b.failed && a.mark === b.mark && a.onReply === b.onReply &&
  a.thread.chat === b.thread.chat && a.thread.place === b.thread.place
// redrawn only when what it shows changes: a long chat filling in, or a live update, leaves the drawn ones alone
const Bubble = memo(function Bubble({ msg, chat, thread, gap, pending, failed, mark, onReply }: BubbleProps) {
  const [sel, setSel] = useState(false)
  const jump = useUI((u) => u.jump === msg.id)
  const mine = msg.who === 'you'
  const qid = `${chat.key}\n${msg.id}`
  const quick = useQuick(qid)
  const [hover, setHover] = useState<number | null | false>(false)
  const wrap = useRef<HTMLDivElement>(null)
  const full = (el: Element) => {
    if (sel) return
    setQuick(null)
    msgMenu(el, msg, chat, thread, () => setSel(true), onReply)
  }
  const reply = () => {
    setQuick(null)
    if (onReply) onReply()
    else replyTo(msg, thread.chat)
  }
  // a slide to the right replies, a press held still opens the whole menu (the click after either is not a tap)
  const { on, slide, armed, skip, pressing, moving } = useSlide(reply, { hold: full, off: sel })
  // a tap anywhere else (or Escape) puts the quick bar away
  useEffect(() => {
    if (!quick) return
    const away = (e: Event) => {
      const t = e.target as Element | null
      if (t && (wrap.current?.contains(t) || t.closest('.pop'))) return
      setQuick(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setQuick(null)
    addEventListener('pointerdown', away, true)
    addEventListener('keydown', esc)
    return () => {
      removeEventListener('pointerdown', away, true)
      removeEventListener('keydown', esc)
    }
  }, [quick])
  const yIn = (clientY: number) => clientY - (wrap.current?.getBoundingClientRect().top ?? 0)
  const bar = quick ?? (hover !== false && !quickNow ? { y: hover } : null)
  return (
    <>
      <div
        ref={wrap}
        className={cx('bw', mine && 'mine', gap && 'gap', !!bar && 'qon')}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(yIn(e.clientY))}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      >
        <SlideHint slide={slide} armed={armed} />
        <div className={cx('bmv', moving.className)} style={moving.style} onTransitionEnd={moving.onTransitionEnd}>
          <div
            className={cx('b', mine && 'mine', sel && 'sel', pending && 'pending', jump && 'jump')}
            role="button"
            tabIndex={0}
            aria-haspopup="menu"
            data-msg={msg.id}
            data-chat={chat.key}
            data-menu
            {...on}
            onContextMenu={(e) => {
              // a finger's hold is ours (above); a right click opens the whole menu
              e.preventDefault()
              if (pressing() || skip.current) return
              full(e.currentTarget)
            }}
            onClick={(e) => {
              if (skip.current) return void (skip.current = false)
              // a tap on a link follows the link, not the message's quick actions
              if ((e.target as Element).closest('a[href]')) return
              if (sel || getSelection()?.toString()) return
              setQuick(quick ? null : { id: qid, y: yIn(e.clientY) })
            }}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), full(e.currentTarget))}
          >
            {msg.reply?.task ? <TaskQuote id={msg.reply.task} title={msg.reply.text} /> : msg.reply && <Quote q={msg.reply} />}
            <Folded text={msg.text ?? ''}>
              {mine ? <div className="md" style={{ whiteSpace: 'pre-wrap' }}>{withLinks(msg.text ?? '', thread.place)}</div> : <Markdown text={msg.text ?? ''} mentions={msg.mentions} place={thread.place} />}
            </Folded>
          </div>
          {registry.messageEdge.map((x, i) => <x.View key={i} msg={msg} chat={chat} />)}
        </div>
        {bar && wrap.current && !slide && (
          <QuickBar msg={msg} chat={chat} thread={thread} mine={mine} wrap={wrap.current} y={bar.y} done={() => { setQuick(null); setHover(false) }} more={full} reply={reply} />
        )}
      </div>
      {mark && <div className="seen" role="status">{mark === 'read' ? 'Read' : 'Sent'}</div>}
      {failed !== undefined && msg.cid && (
        <div className="ref" style={{ justifySelf: 'end', marginTop: 0 }}>
          <span className="c-red">Not sent{failed ? ` · ${failed}` : ''}</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => retry(msg.cid!)}>Retry</span>
          <span className="lk" role="button" tabIndex={0} onClick={() => dropOut(msg.cid!)}>Remove</span>
        </div>
      )}
    </>
  )
}, sameBubble)

/** a very long message (a pasted JSON, a log) shows its first lines and Show more. All its words are on the page, so
 *  copy and the browser's find still see them; find scrolling into the folded part opens it. */
export function Folded({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const was = useRef(open)
  // folded again: it shows its first lines (not where it was scrolled to), its start in view. Not when it first comes
  // in: a folded reply drawn above the reader (older rows coming in, an earlier page) leaves them where they are
  useLayoutEffect(() => {
    const el = box.current
    const folded = was.current && !open
    was.current = open
    if (!el || !folded) return
    el.scrollTop = 0
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'nearest' })
  }, [open])
  if (!isLongMessage(text)) return <>{children}</>
  return (
    <>
      <div ref={box} className={cx('mfold', !open && 'clip')} onScroll={(e) => !open && e.currentTarget.scrollTop > 0 && setOpen(true)}>
        {children}
      </div>
      <button
        type="button"
        className="fold mmore"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <I n={open ? 'up' : 'down'} c="s16" />
        {open ? 'Show less' : `Show more · ${sizeOf(text)}`}
      </button>
    </>
  )
}

/** the long pastes waiting in the message box: each a chip with its first words and size; a tap opens it to read,
 *  Edit puts it back in the box as text, its x takes it out */
function PasteChips({ pastes, onRemove, onEdit }: { pastes: Paste[]; onRemove: (id: string) => void; onEdit: (p: Paste) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const shown = pastes.find((p) => p.id === open)
  return (
    <>
      <div className="fchips" role="list" aria-label="Pasted text to send">
        {pastes.map((p) => (
          <span key={p.id} role="listitem" className={cx('fchip paste', open === p.id && 'on')}>
            <button type="button" className="pk" aria-expanded={open === p.id} aria-label={`Pasted text, ${sizeOf(p.text)}: ${open === p.id ? 'close' : 'open'}`} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <I n="paste" c="s16 c-mute" />
              <span className="pw">{peekOf(p.text, 60)}</span>
              <span className="pz">{sizeOf(p.text)}</span>
            </button>
            <button type="button" aria-label="Remove the pasted text" onClick={() => { if (open === p.id) setOpen(null); onRemove(p.id) }}><I n="x" c="s16" /></button>
          </span>
        ))}
      </div>
      {shown && (
        <div className="pview">
          <pre tabIndex={0} aria-label="Pasted text">{shown.text}</pre>
          <div className="pbar">
            <span className="pz">{sizeOf(shown.text)}</span>
            <span className="sp" />
            <button type="button" className="fold" onClick={() => { setOpen(null); onEdit(shown) }}><I n="pen" c="s16" />Edit in the box</button>
          </div>
        </div>
      )}
    </>
  )
}

/** A task's brief, the first message of its chat (SHEP-330): from its space's Assistant, the task's title and the prompt
 *  as written, a few lines with Show all when long, its Settings folded away, and under it whether its agent has it. */
export function BriefMessage({ msg, b, space }: { msg: Message; b: TaskBrief; space?: string }) {
  const [all, setAll] = useState(false)
  const [settings, setSettings] = useState(false)
  const [long, setLong] = useState(() => looksLong(b.text))
  const body = useRef<HTMLDivElement>(null)
  // long: its words run past the clipped height (measured, so a short brief shows no Show all)
  useLayoutEffect(() => {
    const el = body.current
    if (el && !all) setLong(el.scrollHeight > el.clientHeight + 1)
  }, [b.text, all])
  return (
    <>
      <div className="bfrom">{briefFrom(space)}</div>
      <div className="b mine brief" data-msg={msg.id}>
        <p className="bt">{b.title}</p>
        <div ref={body} className={cx('bbody', !all && 'clip', !all && long && 'fade')}>
          <Markdown text={b.text} />
        </div>
        {(long || all) && (
          <button type="button" className="fold" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'Show less' : 'Show all'}
          </button>
        )}
        {!!b.settings?.length && (
          <>
            <button type="button" className="fold" aria-expanded={settings} onClick={() => setSettings(!settings)}>
              <I n={settings ? 'down' : 'right'} c="s16" />
              Settings
            </button>
            {settings && (
              <ul role="list" className="bset">
                {b.settings.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
      {/* SHEP-329's Sent / Read under a sent message */}
      <div className="seen" role="status">{deliveryWord(b.state)}</div>
    </>
  )
}

export function FileRow({ msg, chat, gap }: { msg: Message; chat: Chat; gap: boolean }) {
  const f = msg.file! as NonNullable<Message['file']> & { id?: string }
  const mine = msg.who === 'you'
  const { small, full, box } = sourcesOf(chat.key, f)
  // one that can't be read (its machine is away, its log moved on): a plain line that says so, never a broken link; it comes back once it loads (#56)
  const [lost, onLost] = useLost(small)
  if (lost && isImage(f.name)) return <div className={cx('ref', mine && 'mine')} data-msg={msg.id}><I n="image" c="s16" /><span>{lostLine}</span></div>
  // a picture or video shows itself (this screen's own copy while it still goes up); a tap opens the preview
  if (full && (isImage(f.name) || isVideo(f.name)))
    return (
      <a
        className={cx('pic', mine && 'mine', gap && 'gap')}
        href={full}
        target="_blank"
        rel="noreferrer"
        aria-label={f.alt || f.name}
        data-msg={msg.id}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || isVideo(f.name)) return
          e.preventDefault()
          openPreview(chat.key, f)
        }}
      >
        {isVideo(f.name) ? <video src={full} controls playsInline preload="metadata" /> : <img src={small} alt={f.alt || f.name} loading="lazy" style={box} onError={onLost} />}
      </a>
    )
  return (
    <div className={cx('athr', mine && 'mine')} data-msg={msg.id}>
      <SentThumb chat={chat.key} f={f} />
    </div>
  )
}

interface Shown {
  msg: Message
  /** dimmed: not in the agent yet (still on its way, or held on purpose for its turn) */
  pending?: boolean
  failed?: string
  /** under your message (SHEP-329): sent (in the agent's terminal, or its CLI's own queue, which takes it within
   *  seconds), then read (the agent took it in), on your latest until the agent answers */
  mark?: 'sent' | 'read'
}

/** the chat's messages with what you sent that it does not show yet, in the order things were sent */
function shownOf(chat: Chat | undefined, key: string, outbox: Outgoing[]): Shown[] {
  let rows: Shown[] = (chat?.messages ?? [])
    .filter((m) => !(m.waiting && m.waitsFor === 'turn' && m.cid && outbox.some((o) => o.cid === m.cid)))
    .map((msg) => (msg.waiting && msg.waitsFor === 'queue' ? { msg, mark: 'sent' } : { msg, pending: !!msg.waiting }))
  // held for the agent's turn (Ctrl+Enter, a long press on Send): a row over the box (Held), not in the chat yet
  const mine = outbox.filter((o) => o.chat === key && !isHeld(o))
  if (mine.length) {
    const at = placesOf(rows.map((r) => ({ id: r.msg.id, cid: r.msg.cid })), mine)
    rows = placeOutgoing(rows, mine.map((o) => ({ at: at.get(o.cid) ?? rows.length, rows: partsOf(o, chat).map((msg) => ({ msg, ...showsAs(o) })) })))
  }
  // your latest message, taken in and not answered yet: read
  const last = rows[rows.length - 1]
  if (last && readNow(last.msg) && !last.pending && !last.mark && last.failed === undefined) rows[rows.length - 1] = { ...last, mark: 'read' }
  return rows
}

function Messages({ thread }: { thread: Thread }) {
  const chat = useChat(thread.chat)
  const snap = useSnap()
  const outbox = useStore((s) => s.outbox)
  const offline = useUI((u) => !!u.offline)
  const rows = useMemo(() => shownOf(chat, thread.chat, outbox), [chat, thread.chat, outbox])
  const end = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const link = useUI((u) => {
    const to = u.chatLink
    return to && (to.task ? to.task === thread.task?.id : !thread.task && (!to.place || to.place === thread.place)) ? to : null
  })
  const covered = useUI((u) => u.phone && (!!u.drawer || !!u.settings || (thread.where === 'chat' && !!u.pane)))
  const jump = useUI((u) => u.jump === u.chatLink?.focus && !link ? null : u.jump)
  const view = useRef({ covered, link })
  const focused = useRef<string | null>(null)
  const edge = useRef(0)
  /** the scroll as this code last left or saw it: below it, the reader has moved up (stick.ts movedUp) */
  const seenTop = useRef(0)
  /** the reader's hand was on the chat (a wheel, a touch, a key, a pointer) since their last scroll event came. Only
   *  then is a scroll below `seenTop` theirs: without it, the chat got shorter and longer again in between (a long
   *  reply folding after its first layout), which leaves the scroll lower too */
  const hand = useRef(false)
  const away = (el: HTMLElement) => hand.current && movedUp(el, seenTop.current)
  const first = chat?.messages[0]?.id
  const earlierAnchor = useRef<{ first: string | undefined; row: HTMLElement; top: number } | null>(null)
  const looked = useRef<{ link: typeof link; first: string | undefined } | null>(null)
  const highlight = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // #1504: the rows as the jump button counts them, and the row that was last when you scrolled away from the end
  const seen = useRef<{ id: string; mine: boolean }[]>([])
  seen.current = rows.map((r) => ({ id: keyOf(r.msg), mine: r.msg.who === 'you' }))
  const left = useRef<string | null>(null)
  // a long chat opens on its newest rows and draws the older ones right after (first-rows.ts); the reader's row stays
  // in place as they come in above it
  const filling = useRef<{ row: HTMLElement; offset: number; start: number } | null>(null)
  /** where the last step left the reader's row (its offset, aimed at, and the scroll that gave): the next step aims at
   *  the same offset while the reader hasn't moved, so whole-pixel scrolls don't add up over the steps */
  const aim = useRef<{ row: HTMLElement; offset: number; scrollTop: number } | null>(null)
  const start = useNewestFirst(thread.chat, seen.current.map((r) => r.id), !!jump || !!link?.focus)
  const drawnFrom = useRef({ chat: thread.chat, start })
  const scroller = end.current?.closest<HTMLElement>('.scroll')
  if (scroller && drawnFrom.current.chat === thread.chat && start < drawnFrom.current.start && filling.current?.start !== start) {
    // This render draws a step of older rows. The page still shows the last one: where the reader is goes with it.
    // They may have scrolled up in this very frame, before their scroll event came: the step mustn't put them back
    if (stuck.current && away(scroller)) stuck.current = false
    // kept by hand, as for an earlier page below (anchoring isn't in WebKit, and Chromium's skips the very top)
    const was = aim.current
    const row = stuck.current ? null : was && was.scrollTop === scroller.scrollTop && was.row.isConnected ? was : rowAtTop(scroller)
    filling.current = row && { row: row.row, offset: row.offset, start }
  }
  // This render puts in rows above the reader that are then kept in place by hand (an earlier page, a step of a long
  // chat): the browser's own anchoring is off until then, or both would move them, as Chromium does at times
  const keeping = filling.current?.start === start || (!!earlierAnchor.current && earlierAnchor.current.first !== first)
  if (keeping && scroller) scroller.style.overflowAnchor = 'none'
  // the newest page held only task rows (SHEP-445): earlier pages, by themselves, until a few real messages are in
  const [, bump] = useState(0)
  const tried = opened.get(thread.chat) ?? 0
  useEffect(() => {
    if (covered || loading.has(thread.chat)) return
    // A linked message can be in an older page. Ask once per oldest message while the link is unresolved.
    const seek = !!jump && link?.focus === jump && focused.current !== jump && chat?.earlier &&
      (looked.current?.link !== link || looked.current.first !== first)
    const load = wantsEarlier(chat, tried)
    if (!seek && !load) return
    const key = thread.chat
    if (seek) looked.current = { link, first }
    loading.add(key)
    void act({ type: 'earlier', chat: key })
      .catch(() => undefined)
      .finally(() => {
        loading.delete(key)
        if (load) opened.set(key, (opened.get(key) ?? 0) + 1)
        bump((n) => n + 1)
      })
  })

  // Reset on entry and on return. Geometry changes while following (history, media or keyboard) keep the foot in view.
  useLayoutEffect(() => {
    const sc = end.current?.closest<HTMLElement>('.scroll')
    const box = end.current?.parentElement
    if (!sc || !box) return
    const reopen = () => {
      stuck.current = true
      left.current = null
      earlierAnchor.current = null
      setOffEnd(thread.chat, null)
      sc.scrollTo({ top: sc.scrollHeight, behavior: 'instant' })
      edge.current = sc.scrollHeight - sc.clientHeight
      seenTop.current = sc.scrollTop
      hand.current = false
    }
    reopen()
    focused.current = null
    // at the foot, unless the reader has just moved up from it (their scroll event may come after what grew)
    const following = () => {
      if (stuck.current && away(sc)) stuck.current = false
      return stuck.current
    }

    const on = () => {
      if (!sc.clientHeight) return
      const max = sc.scrollHeight - sc.clientHeight
      const at = following()
      // their scroll event has come: where they are says the rest
      hand.current = false
      if (at && max !== edge.current) {
        reopen()
        return
      }
      edge.current = max
      seenTop.current = sc.scrollTop
      const off = max - sc.scrollTop
      stuck.current = off <= 2
      if (stuck.current) {
        left.current = null
        setOffEnd(thread.chat, null)
      } else {
        left.current ??= seen.current.at(-1)?.id ?? ''
        if (off > OFF_PX) setOffEnd(thread.chat, { count: newSince(seen.current, left.current), asks: asksBelow(sc).length })
      }

      const key = thread.chat
      // A short chat is already at its newest. Only a scroll into older history asks for an earlier page.
      if (!stuck.current && sc.scrollTop < 40 && getState().chats[key]?.earlier && !loading.has(key)) {
        // The reader's row stays in place when the page is prepended. Kept by hand in every browser: scroll anchoring
        // isn't in WebKit, and Chromium's skips a scroller at its very top, where a wheel or a fling ends up
        // (dmalis/shepherdr#190). Where the browser did keep it, the hand finds nothing to move.
        const top = sc.getBoundingClientRect().top
        const row = [...box.querySelectorAll<HTMLElement>('[data-msg], [data-card]')].find((row) => row.getBoundingClientRect().bottom > top)
        if (row) earlierAnchor.current = { first: getState().chats[key]?.messages[0]?.id, row, top: row.getBoundingClientRect().top - top + sc.scrollTop }
        loading.add(key)
        void act({ type: 'earlier', chat: key })
          .catch(() => undefined)
          .finally(() => loading.delete(key))
      }
    }
    sc.addEventListener('scroll', on, { passive: true })
    const touched = () => { hand.current = true }
    const HAND = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const
    for (const e of HAND) sc.addEventListener(e, touched, { passive: true })
    const stopKeeping = keepAtEnd(sc, box, () => stuck.current, () => {
      edge.current = sc.scrollHeight - sc.clientHeight
      seenTop.current = sc.scrollTop
    }, () => away(sc))
    const stopReturning = onPageReturn(reopen)
    const off = onEnd(thread.chat, reopen)
    const offAsk = onAsk(thread.chat, () => {
      asksBelow(sc)[0]?.scrollIntoView({ block: 'center', behavior: calm() ? 'instant' : 'smooth' })
    })
    return () => {
      sc.removeEventListener('scroll', on)
      for (const e of HAND) sc.removeEventListener(e, touched)
      stopKeeping()
      stopReturning()
      offAsk()
      off()
      clearTimeout(highlight.current)
      setOffEnd(thread.chat, null)
    }
  }, [thread.chat])

  useLayoutEffect(() => {
    const sc = end.current?.closest<HTMLElement>('.scroll')
    const reopened = (view.current.covered && !covered) || (link && view.current.link !== link)
    view.current = { covered, link }
    if (!sc || covered) return
    // drawn again (more rows, a card's news) just as the reader moved up, before their scroll event: they stay there
    if (stuck.current && away(sc)) stuck.current = false
    if (reopened) {
      stuck.current = true
      left.current = null
      earlierAnchor.current = null
      focused.current = null
      setOffEnd(thread.chat, null)
    }
    if (!jump) focused.current = null
    if (jump && focused.current !== jump) {
      const el = sc.querySelector<HTMLElement>(`[data-msg="${attr(jump)}"], [data-card="${attr(jump)}"]`)
      if (el && el.getClientRects().length) {
        focused.current = jump
        stuck.current = false
        edge.current = sc.scrollHeight - sc.clientHeight
        const target = el.getBoundingClientRect()
        const viewport = sc.getBoundingClientRect()
        sc.scrollBy({ top: target.top - viewport.top + (target.height - viewport.height) / 2, behavior: 'instant' })
        seenTop.current = sc.scrollTop
        // Only the highlight expires. The position is set in this same layout, before it is drawn.
        clearTimeout(highlight.current)
        highlight.current = setTimeout(() => {
          if (getState().ui.jump === jump) setUI({ jump: null })
        }, 2500)
        return
      }
    }
    edge.current = sc.scrollHeight - sc.clientHeight
    const place = filling.current?.start === start ? filling.current : null
    aim.current = null
    if (place && !stuck.current && sc.contains(place.row)) {
      const moved = place.row.getBoundingClientRect().top - sc.getBoundingClientRect().top - place.offset
      sc.scrollBy({ top: moved, behavior: 'instant' })
      aim.current = { ...place, scrollTop: sc.scrollTop }
      // an earlier page asked for before this step: its row's place counts the step's rows as kept already
      if (earlierAnchor.current) earlierAnchor.current.top += moved
    }
    const anchor = earlierAnchor.current
    if (anchor && anchor.first !== first) {
      earlierAnchor.current = null
      if (!stuck.current && sc.contains(anchor.row)) {
        const moved = anchor.row.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - anchor.top
        sc.scrollBy({ top: moved, behavior: 'instant' })
      }
    }
    if (stuck.current) sc.scrollTo({ top: sc.scrollHeight, behavior: 'instant' })
    else if (left.current != null && edge.current - sc.scrollTop > OFF_PX) {
      setOffEnd(thread.chat, { count: newSince(seen.current, left.current), asks: asksBelow(sc).length })
    }
    seenTop.current = sc.scrollTop
  })
  // the rows are in and kept in place: the browser's anchoring is back on (after the effect above, whatever it did,
  // which may have returned early)
  useLayoutEffect(() => {
    if (keeping && scroller) scroller.style.overflowAnchor = ''
    filling.current = null
    drawnFrom.current = { chat: thread.chat, start }
  })

  if (!snap) return null
  const out: ReactNode[] = []
  let prev = ''
  let lastAt = 0
  /** the task the last line named: its next message or card needs no second line */
  let lastRef = ''
  /** the last quiet "how it closed" line, so a twin right under it doesn't show */
  let lastEnded = ''
  // the app's own cards (a review, a stopped agent), each where it came up among the messages
  // none while its messages are still on their way: never a wall of task rows standing in for the chat (SHEP-445)
  const cards = cardsAfter(cardsNow(registry.chatCards.flatMap((c) => c.cards(snap, thread)), chat, tried), rows.map((r) => r.msg)).sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
  // what you sent still shows at once; the rest waits with the cards
  const held = stillLoading(chat, tried)
  const cardsUntil = (at: number) => {
    while (cards.length && (cards[0]!.at ?? Infinity) <= at) {
      const c = cards.shift()!
      out.push(<Fragment key={`c:${c.key}`}>{c.node}</Fragment>)
      prev = 'a'
      lastEnded = ''
    }
  }
  const stub: Chat = chat ?? { key: thread.chat, messages: [], cli: '' }
  // while it fills in: only the newest rows, with the cards among them; the older cards come in with their rows
  const from = rows[start]?.msg.at
  if (start && from) while (cards.length && (cards[0]!.at ?? Infinity) < from) cards.shift()
  for (const { msg: m, pending, failed, mark } of start ? rows.slice(start) : rows) {
    if (held && m.who !== 'you') continue
    if (m.at) cardsUntil(m.at)
    const who = m.who === 'you' ? 'me' : 'a'
    const k = keyOf(m)
    if (m.at && (!lastAt || new Date(m.at).toDateString() !== new Date(lastAt).toDateString() || m.at - lastAt > QUIET)) out.push(<div key={`t:${k}`} className="time">{dayLabel(m.at)} {clock(m.at)}</div>)
    if (m.at) lastAt = m.at
    const gap = !!prev && prev !== who
    // a `!` command you ran: its own row (CommandRow)
    const cmd = commandOf(m, { pending, failed, mark })
    if (m.newSession) {
      out.push(<div key={k} className="time" role="separator">New session</div>)
      continue
    }
    if (m.taskBrief) out.push(<BriefMessage key={k} msg={m} b={m.taskBrief} space={placeOf(snap, thread.place)?.name} />)
    else if (m.activity) out.push(<Did key={k} a={m.activity} />)
    else if (m.question) {
      // a question from a task, shown in this chat: under a line naming the task (once), and it says where that task runs
      const from = m.question.by && !thread.task ? taskIdOf(snap, m.question.by.chat) : null
      if (from && from !== lastRef) out.push(<TaskRef key={`r:${k}`} id={from} title={m.question.by!.title ?? m.question.by!.ref} t={taskOf(snap, from)} />)
      if (from) lastRef = from
      const place = (from && taskOf(snap, from)?.place) || thread.place
      if (m.question.title && !m.question.login && !m.question.trust && !m.question.command && !m.question.plan && !m.question.parts?.length && m.question.sent === undefined && !m.question.closed) out.push(<div key={`q:${k}`} className={cx('b', gap && 'gap')}>{m.question.title}</div>)
      out.push(<QuestionCard key={k} q={m.question} chat={m.question.by?.chat ?? thread.chat} place={place} />)
    } else if (m.secret) out.push(<SecretCard key={k} ask={m.secret} chat={thread.chat} />)
    else if (m.news) {
      // Herdr's news of a task, never a message (SHEP-365): one quiet row under the task's line, or nothing for what
      // the app shows by itself from the task's status (its review card, its Done line)
      const t = taskOf(snap, m.news.task)
      const row = newsRow(m.news, t ? `the ${taskKind(t).toLowerCase()} ${t.name}` : '', !!t && !!m.news.live && waitsOnPerson(snap, t.id))
      if (!row) continue
      if (t && !thread.task && t.id !== lastRef) out.push(<TaskRef key={`r:${k}`} id={t.id} title={t.name} t={t} />)
      if (t) lastRef = t.id
      out.push(<NewsLine key={k} row={row} at={m.at} />)
    } else if (m.card) {
      const t = taskOf(snap, m.card.task)
      if (t && !thread.task && t.id !== lastRef) out.push(<TaskRef key={`r:${k}`} id={t.id} title={t.name} t={t} />)
      if (t) lastRef = t.id
      const text = m.card.text ?? m.text ?? ''
      if (text) out.push(<Bubble key={k} msg={{ ...m, text }} chat={stub} thread={thread} gap={false} onReply={t && !thread.task ? () => replyToTask(t) : undefined} />)
    }
    // a message between agents, in the sender's chat and the receiver's: its own quiet row (SHEP-368)
    else if (m.relay) out.push(<RelayRow key={k} r={m.relay} text={m.text ?? ''} at={m.at} />)
    // when its agent was started again, earlier messages stay, above a thin "New session" line
    else if (m.brief && thread.task && !/new session/i.test(m.brief.label)) continue
    else if (m.brief) out.push(/new session/i.test(m.brief.label) ? <div key={k} className="time" role="separator">New session</div> : <div key={k} className="ref"><I n="note" c="s16" /><span>{m.brief.label}</span></div>)
    // what closed and how ("Fix login · Run: npm test · Allowed"); the same line twice in a row shows once
    else if (m.ended !== undefined) {
      const line = endedLine(m.ended, lastEnded)
      if (!line) continue
      // dmalis/shepherdr#45: an answered permission says when, in the reader's clock; one nobody answered here, a warning
      out.push(<DoneRow key={k} icon={m.endedWaits ? 'warn' : 'check'}><span className="kline"><KindLine text={line} />{m.endedAt ? ` at ${clock(m.endedAt)}` : ''}</span></DoneRow>)
    }
    // a recap of what happened (the agent's own, or its answer to Recap), and a heads-up its CLI wrote: never bubbles
    else if (m.recap === 'heads') out.push(<QuietRow key={k} kind="heads" icon="info" label={m.text ?? ''} meta={m.at ? [{ word: clock(m.at) }] : []} />)
    else if (m.recap) out.push(<RecapNote key={k} text={m.text ?? ''} at={m.at} place={thread.place} />)
    else if (m.error) out.push(<div key={k} className="ref c-red"><I n="warn" c="s16" /><span>{m.text}</span></div>)
    else if (m.file) out.push(<FileRow key={k} msg={m} chat={stub} gap={gap} />)
    // pictures the chat can't show yet (still in its CLI's queue: they show once it takes them), and an artifact on its way
    else if (m.images) out.push(<div key={k} className={cx('ref', m.who === 'you' && 'mine')} data-msg={m.id}><I n="image" c="s16" /><span>{imagesLine(m.images, m.waiting)}</span></div>)
    else if (m.publishing) out.push(<div key={k} className="ref" role="status" data-msg={m.id}><I n="doc" c="s16" /><span>Publishing an artifact…</span></div>)
    else if (cmd) {
      lastRef = ''
      out.push(<CommandRow key={k} msg={m} state={cmd} failed={failed} gap={gap} />)
    }
    else if (m.text) {
      lastRef = ''
      out.push(<Bubble key={k} msg={m} chat={stub} thread={thread} gap={gap} pending={pending} failed={failed} mark={mark} />)
    }
    for (const [i, p] of registry.messageParts.entries()) out.push(<p.View key={`${k}:p${i}`} msg={m} chat={stub} thread={thread} />)
    // In the fictional shop conversation the review follows the mock-up, before the later task messages.
    if (snap.demo && !thread.task && m.artifact?.id === 'a-mock') cardsUntil(Infinity)
    if (!m.activity) prev = who
    // dmalis/shepherdr#45: a line with its own time (an answered permission) is never the same line twice
    lastEnded = m.endedAt ? '' : m.ended ?? ''
  }
  const empty = !rows.length && (!chat || chat.fresh || chat.notice === 'none' || chat.top !== false)
  const every = isEverything(snap, thread.place)
  return (
    <>
      {empty && !thread.task && chat && (
        <Empty title={every ? 'Welcome to Shepherdr' : `Nothing in ${spaceLabel(snap, thread.place)} yet`} act={{ label: 'Write a message', run: () => void focusBox(thread.chat) }}>
          Tell me what you want done{every ? ', here or in a space.' : ' here.'}
        </Empty>
      )}
      {/* a chat not read yet: Loading… while it comes, or why it can't while the link is down (ui.tsx) */}
      {!chat && !rows.length && !thread.task && (offline ? <Failed title="Can't show this chat" why="Shepherdr can't be reached. It tries again by itself." again={retryNow} /> : <Loading />)}
      {out}
      {thread.task && <StartLine chat={chat} thread={thread} />}
      {cards.map((c) => <Fragment key={`c:${c.key}`}>{c.node}</Fragment>)}
      {registry.chatTail.map((t, i) => <t.View key={i} chat={chat} thread={thread} />)}
      <div ref={end} className="mend" />
    </>
  )
}
/** the reader's row: the first one reaching into the scroller, and how far its top is from the scroller's */
function rowAtTop(sc: HTMLElement): { row: HTMLElement; offset: number } | null {
  const top = sc.getBoundingClientRect().top
  const row = [...sc.querySelectorAll<HTMLElement>('.msgs [data-msg], .msgs [data-card]')].find((row) => row.getBoundingClientRect().bottom > top)
  return row ? { row, offset: row.getBoundingClientRect().top - top } : null
}

const loading = new Set<string>()
/** how many earlier pages a chat read by itself when it opened (SHEP-445), so opening it again doesn't read more */
const opened = new Map<string, number>()

/** held for the agent's turn: a row each over the box, its words, Send now, Edit (back in the box) and Remove */
function Held({ thread }: { thread: Thread }) {
  const key = thread.chat
  const chat = useChat(key)
  const outbox = useStore((s) => s.outbox)
  const rows = heldOf(outbox, key, chat)
  if (!rows.length) return null
  // taken back from Shepherdr's line first: one that went in meanwhile stays (it says so)
  const take = (o: Outgoing, then?: () => void) =>
    void act({ type: 'held-drop', cid: o.cid } as never).then(() => (dropOut(o.cid), then?.()), (e) => notice(e instanceof Error ? e.message : 'That did not work.'))
  return (
    <div className="held" role="list" aria-label="Waiting to send">
      {rows.map((o) => (
        <div key={o.cid} className="hrow" role="listitem">
          <I n="clock" c="s16 c-mute" />
          <span className="hw">
            <span className="ht">{o.text || o.files.map((f) => f.name).join(', ')}</span>
            {/* waiting for its agent's answer (dmalis/shepherdr#59): it can't go before, so no Send now */}
            <span className="hs">{o.waitsFor === 'answer' ? afterOf(chat) : 'Queued'}</span>
          </span>
          {o.waitsFor !== 'answer' && <button type="button" className="fold" onClick={() => void tryAct({ type: 'held-now', cid: o.cid } as never)}>Send now</button>}
          <button type="button" className="fold" onClick={() => take(o, () => { const now = getDraft(key) ?? ''; setDraft(key, editedDraft(o.text, now), { from: 0, to: now.trim() ? 0 : now.length }); focusBox(key) })}>Edit</button>
          <IB icon="x" label="Remove" onClick={() => take(o)} />
        </div>
      ))}
    </div>
  )
}

/** a round ↓ above the box while the chat is scrolled away from its end, with how many messages came since; a tap
 *  goes back to the newest (#1504) */
function ToEnd({ thread }: { thread: Thread }) {
  const off = useOffEnd(thread.chat)
  if (!off) return null
  const n = off.count
  // questions wait below: the pill says so and goes to the first of them
  if (off.asks)
    return (
      <button type="button" className="toend asks" onClick={() => {
        if (!toAsk(thread.chat)) toEnd(thread.chat)
      }}>
        <span className="dot" aria-hidden="true" />
        {questionsBelow(off.asks)}
      </button>
    )
  return (
    <button type="button" className="toend" aria-label={n ? `${n} new ${n === 1 ? 'message' : 'messages'}, go to the newest` : 'Go to the newest message'} onClick={() => toEnd(thread.chat)}>
      <I n="toend" />
      {n > 0 && <span className="cnt">{n > 99 ? '99+' : n}</span>}
    </button>
  )
}

/** a task's id from its chat's key ("vm:SHOP-12/worker") */
const taskIdOf = (snap: Snapshot, chatKey: string) => snap.tasks.find((t) => t.agent?.chat === chatKey)?.id ?? chatKey.replace(/\/[^/]+$/, '')

/** Before a task's agent is at work, what it waits for, in words under its brief (SHEP-330): never an empty page */
function StartLine({ chat, thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  const t = snap && thread.task ? snap.tasks.find((x) => x.id === thread.task!.id) ?? thread.task : thread.task
  const words = t ? startWords(t, chat) : ''
  if (!words) return null
  return (
    <div className="ref" role="status">
      <I n="clock" c="s16" />
      <span>{words}</span>
    </div>
  )
}

/** The working sign at the chat's end (SHEP-313, SHEP-343), as Claude Duet shows its agent at work: three dots that
 *  bounce in turn inside a small agent-side speech bubble, where its words will land. The step it is on, when Shepherdr
 *  knows it, stays quiet text beside the bubble, never in it (nothing the agent wrote), in plain words: a task's own
 *  status line, else the tool at work (typing.ts stepWords), never a command line. When words arrive the bubble
 *  goes and they take its place; keyed on the message count, a new one comes back under them a beat later if it still
 *  works, so the bubble seems to turn into the message. */
export function WorkingSign({ chat, thread }: { chat: Chat | undefined; thread?: Thread }) {
  // a task's own status line, what its agent last said it does (not while it waits on you)
  const report = thread?.task?.report
  const sign = signOf(chat, report && !report.paused ? report.msg : undefined)
  // SHEP-421: the line stays while the sign shows, the last step held until the next fades in over it
  const step = chat ? heldStep(chat.key, sign, chat) : ''
  if (!sign) return null
  const n = chat?.messages.length ?? 0
  const el = (
    <div key={n} className="wsign" role="status" aria-label={step}>
      <span className="b wbub" aria-hidden="true"><span className="wdots"><i /><i /><i /></span></span>
      <span key={step} className="wstep">{step}</span>
    </div>
  )
  // SHEP-363: Stop sits on the working row (the box's round button is the voice call while it is empty), at its right
  // end over that round button, outside the sign's grow-in so it is its full size from the start
  if (!chat || !has('voice')) return el
  return (
    <div key={n} className="wrow">
      {el}
      <IB icon="stop" label="Stop" className="wstop" onClick={() => void tryAct({ type: 'stop', chat: chat.key }, undefined, 'Stopping…')} />
    </div>
  )
}

/** Its turn is over but work of its own still runs in the background (a watcher, a server): one quiet line under its
 *  last message, "1 background command running". No dots, no Stop: nobody is writing. Once that work wakes it, the
 *  working sign takes over as usual. */
export function BackgroundNote({ chat }: { chat: Chat | undefined }) {
  if (chat?.settingsUpdate) return <p className="bgnote" role="status">{chat.settingsUpdate}</p>
  if (!chat?.bgNote || chat.working || signOf(chat)) return null
  return <p className="bgnote" role="status">{chat.bgNote}</p>
}

/** a tap on it takes no focus: the box's focus (and a phone's keyboard) stays as it was */
export const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

/** A chat's own agent that crashed or was cut off is treated like a task's: a card in that chat with the reason and
 *  Restart. Shepherdr never starts it again on its own. */
function StoppedChat({ chat, thread }: { chat: Chat | undefined; thread: Thread }) {
  const snap = useSnap()
  const acts = useCardActs(`stopped:${thread.chat}`, `${chat?.notice ?? ''}|${chat?.note ?? ''}`)
  if (!chat || !snap || thread.task || (chat.notice !== 'ended' && chat.notice !== 'gone')) return null
  const pick = pickOf(snap, chat, thread)
  return (
    <div className="card" data-card={`stopped:${chat.key}`}>
      <span className="t c-red">Stopped</span>
      <span>{chat.note || 'Its agent is no longer running.'}</span>
      <div className="acts">
        <ActBtn acts={acts} id="restart" kind="pri" busy="Restarting…" run={() => attempt({ type: 'restart', chat: chat.key, kind: pick.agent, model: pick.model ?? undefined, effort: pick.effort ?? undefined, speed: speedForAction(pick) })}>Restart</ActBtn>
      </div>
      <ActError acts={acts} />
    </div>
  )
}

/* ---------- the message box ---------- */

/** a tapped suggested reply's lift away before it sends (ds.css .sug.go) */
const SUG_GO_MS = 140

/** suggested replies already used: gone once you send something */
const spent = new Set<string>()

/** The agent's suggested replies as bubbles above the box (SHEP-186), in its order, all alike (no first pick): a tap
 *  sends one as it is, a press held (or a right-click) puts it in the box to edit instead (ReplyPress). One line each; the
 *  row scrolls sideways when they don't fit. */
export function Replies({ texts, onSend, onEdit }: { texts: string[]; onSend: (t: string) => void; onEdit: (t: string) => void }) {
  const row = useRef<HTMLDivElement>(null)
  // a new set starts at its first bubble, fully in view; a soft fade where more continues sideways
  const all = texts.join('\n')
  useLayoutEffect(() => (row.current ? rowEdges(row.current) : undefined), [all])
  // fork #186: the keyboard's way to edit one, read out with each bubble
  const how = useId()
  return (
    <div className="sugs" ref={row} role="group" aria-label="Suggested replies">
      {texts.map((t, i) => <Reply key={`${i}:${t}`} text={t} onSend={onSend} onEdit={onEdit} how={how} />)}
      <span id={how} className="vh">Enter sends it. Shift+Enter puts it in the box to edit.</span>
    </div>
  )
}

function Reply({ text, onSend, onEdit, how }: { text: string; onSend: (t: string) => void; onEdit: (t: string) => void; how?: string }) {
  const edit = useRef(onEdit)
  edit.current = onEdit
  const press = useMemo(() => new ReplyPress(() => edit.current(text)), [text])
  useEffect(() => () => press.stop(), [press])
  // a tap sends it: the bubble lifts away first (SUG_GO_MS), so the tap is seen to go; with reduced motion it sends at once
  const [going, setGoing] = useState(false)
  const leave = () => {
    if (going) return
    if (calm()) return onSend(text)
    setGoing(true)
    setTimeout(() => onSend(text), SUG_GO_MS)
  }
  return (
    <button
      type="button"
      className={going ? 'sug go' : 'sug'}
      onMouseDown={keepFocus}
      onPointerDown={(e) => press.down(e.clientX, e.clientY)}
      onPointerMove={(e) => press.move(e.clientX, e.clientY)}
      onPointerUp={() => press.stop()}
      onPointerCancel={() => press.stop()}
      onPointerLeave={() => press.stop()}
      onContextMenu={(e) => {
        e.preventDefault()
        press.menu()
      }}
      onClick={() => press.click() && leave()}
      // fork #186: Shift+Enter (or the menu key, as a right-click) puts it in the box to edit, as a hold does
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || !e.shiftKey) return
        e.preventDefault()
        edit.current(text)
      }}
      aria-describedby={how}
      aria-keyshortcuts="Shift+Enter"
    >
      {text}
    </button>
  )
}

/** what a chat runs on now: its agent's own report; before its chat came, its space's (an Assistant's chat: what its
 *  Assistant runs, else what its first message starts it on, SHEP-298); else what is set for its kind */
export function pickOf(snap: Snapshot, chat: Chat | undefined, thread: Thread): Pick {
  const a = thread.task ? thread.task.agent?.settings : snap.places.find((p) => p.id === thread.place && p.chat === thread.chat)?.agent
  return reportedPick(chat?.agent ?? a) ?? thread.task?.plannedAgent
    ?? pickFor(snap, isEverything(snap, thread.place) ? 'all' : thread.place, thread.task ? 'Tasks' : 'Chats')
}

const speedForAction = (pick: Pick) => pick.fast === 'ultrafast' ? 'ultrafast' : pick.fast ? 'fast' : 'normal'

/** A new model, effort or permission mode applies from your next message. A different agent restarts that chat, after
 *  you confirm; earlier messages stay. */
export function applyPick(chat: string, was: Pick, now: Pick, names: { agent: string }) {
  const same = (a: Pick, b: Pick) => a.agent === b.agent && (a.model ?? null) === (b.model ?? null) && (a.effort ?? null) === (b.effort ?? null) && (a.fast ?? false) === (b.fast ?? false) && (a.perm ?? null) === (b.perm ?? null)
  if (same(was, now)) return
  const run = () => void tryAct({ type: 'restart', chat, kind: now.agent, model: now.model ?? undefined, effort: now.effort ?? undefined, speed: speedForAction(now), perm: now.perm ?? undefined })
  if (was.agent === now.agent) return run()
  confirm({ title: `Switch to ${names.agent}?`, body: 'This chat starts again on the new agent. Earlier messages stay, above a "New session" line.', ok: 'Switch', run })
}

/** fork #149: a sent draft leaves its box once its send is safe: kept by the outbox now, or delivered later */
function once(r: Posted | undefined, clear: () => void) {
  if (!r) return
  if (r.kept) clear()
  else whenSafe(r.cid, clear)
}
/** "a", "a and b", "a, b and c" */
const listed = (names: string[]) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

function Box({ thread, placeholder }: { thread: Thread; placeholder: string }) {
  const key = thread.chat
  const snap = useSnap()!
  const chat = useChat(key)
  const [text, setText] = useDraft(key)
  const pastes = usePastes(key)
  const files = useUI((u) => u.files[key])
  const reply = useUI((u) => u.reply[key])
  const phone = useUI((u) => u.phone)
  const ref = useRef<HTMLTextAreaElement>(null)
  // fork #186: the chat whose words the caret was put in (a held suggestion goes there; before that, after the words)
  const placed = useRef<string | null>(null)
  // fork #186: what was selected as an edit began, so a folded paste moves with exactly what it replaced
  const pre = useRef<{ start: number; end: number; undo: boolean; ime: boolean } | null>(null)
  useEffect(() => {
    const box = ref.current
    if (!box) return
    const note = (e: InputEvent) => {
      pre.current = { start: box.selectionStart, end: box.selectionEnd, undo: e.inputType.startsWith('history'), ime: e.inputType.includes('Composition') }
    }
    box.addEventListener('beforeinput', note)
    return () => box.removeEventListener('beforeinput', note)
  }, [])
  const boxId = useId()
  // #1538: what Send just sent, so the keyboard writing it back into the empty box is dropped
  const sentRef = useRef<Sent | null>(null)
  const composing = useRef(false)
  // a finger (a phone, a tablet): + opens the camera, photos and files (attach.tsx)
  const finger = useMemo(touch, [])
  const shared = useLanded() === key
  useGrow(ref, text)
  // #1550: on a desktop, a chat switched to takes the keyboard, its draft kept, unless you're typing somewhere else (a
  // dialog, another box); never on a phone or tablet, where it would bring up the keyboard
  useEffect(() => {
    if (!fineOnly()) return
    const a = document.activeElement
    if (a && a !== document.body && (a.matches('input, textarea, select, [contenteditable]') || a.closest('[role="dialog"], dialog'))) return
    const box = ref.current
    if (!box) return
    box.focus({ preventScroll: true })
    box.setSelectionRange(box.value.length, box.value.length)
  }, [key])
  const ment = useMentions(key, thread.task?.place ?? thread.place, text, setText, ref)
  const slash = useSlash(key, text, setText, ref)
  // a task's chat: only while the task waits on the person (dmalis/shepherdr#42)
  const sg = taskReplies(suggestionOf(chat, suggestionsOn(snap.settings)), thread.task && (snap.tasks.find((x) => x.id === thread.task!.id) ?? thread.task))
  const busy = !!chat?.working && !chat.finished
  const call = useUI((u) => u.call)
  const dictating = useDictating()
  const sending = useStore((s) => s.outbox.some((o) => o.chat === key))
  const sug = sg && !repliesHidden({ dictating, call, working: busy, sending, spent: spent.has(sg.id) }) ? sg : null
  const machine = snap.places.find((p) => p.id === thread.place)?.machine ?? snap.host
  const pick = pickOf(snap, chat, thread)
  // its agent asks something (a question, a permission, a plan): you can still write and send; it waits over the box
  // and goes by itself once the card is answered (dmalis/shepherdr#59), and the line says so
  const hint = placeholder
  // a message sent while the agent works goes in at once (it steers); only Ctrl/Cmd+Enter asks it to wait its turn.
  // The round button and Enter send only what is in the box, never a suggested reply (those are their own bubbles).
  // In a voice call the box takes no text (TEXT_IN_CALL).
  // a line starting with `!` runs as a command in the agent's own shell (Claude Code, Codex); another agent has none,
  // so its words don't go and the box offers your own terminal
  const mode = commandMode(text, pick.agent)
  const openAgent = (typed?: string) => {
    const live = chat && !chat.fresh && !chat.finished && !!chat.agent
    openPicker({ title: thread.task ? 'This task runs on' : 'This chat runs on', machine, pick, typed, onChange: () => undefined,
      ...(live ? { live: {
        chat: key,
        update: (now: Pick) => act({ type: 'restart', chat: key, kind: now.agent, model: now.model ?? undefined,
          effort: now.effort ?? undefined, speed: speedForAction(now), perm: now.perm ?? undefined, live: true }),
      } } : { onClose: (now: Pick) => applyPick(key, pick, now, { agent: pickWords(now).agent }) }),
    })
  }
  const go = (wait = false) => {
    if (getState().ui.call && !TEXT_IN_CALL) return
    // a long paste folded into a chip goes as text, exactly as pasted, where it was pasted (fork #186)
    const t = outgoing(text, pastes)
    if (!t && !files?.length) return
    if (mode === 'cant') return
    if (sg) spent.add(sg.id)
    if (mode === 'run') {
      // the command alone, first in the box: a quoted reply, files or a folded paste would go with it and it would be
      // a message. Those stay in the box for the next message
      const typed = text
      once(send(key, key, text.trim(), false, true, dictatedInto.delete(key) ? 'dictated' : 'typed'), () => getDraft(key) === typed && setDraft(key, ''))
      return
    }
    // /model never reaches the agent: it opens the agent picker, the model it names picked (3.1's, GitHub #1560)
    const model = files?.length || pastes.length ? undefined : modelTyped(t)
    if (model !== undefined) {
      setText('')
      openAgent(model)
      return
    }
    if (composing.current) endComposition(ref.current)
    sentRef.current = { text, at: Date.now() }
    const typed = text
    const went = new Set(pastes.map((p) => p.id))
    once(send(key, key, expandPicked(key, t), wait && busy, false, dictatedInto.delete(key) ? 'dictated' : 'typed'), () => {
      // what was typed after Send (storage was full, so the box waited) stays
      if (getDraft(key) !== typed) return
      setDraft(key, '')
      dropPicks(key)
      setPastes(key, (ps) => ps.filter((p) => !went.has(p.id)))
    })
    if (shared) putAway()
  }

  /** a suggested reply tapped: exactly its text sent at once as its own message (no keyboard comes up: its bubble takes
   *  no focus). Whatever is in the box (text, files, a quoted reply) is neither sent nor merged: it stays as it was */
  const sendSug = (t: string) => {
    if (!sug || (getState().ui.call && !TEXT_IN_CALL)) return
    spent.add(sug.id)
    // dmalis/shepherdr#51: a reply to the message the bubble came with
    send(key, key, t, false, true, undefined, bubbleQuote(chat, sug.id))
  }
  /** fork #186: a suggested reply held (or Shift+Enter on it): into the box at its caret, or over only what is
   *  selected, your words kept; a reply to the message it answers, asked first when the box replies to another */
  const editSug = (t: string) => sug && holdSuggestion(key, t, bubbleQuote(chat, sug.id), ref.current, placed.current === key)
  const filled = !!text.trim() || !!files?.length || !!pastes.length
  // fork #149: a file whose bytes didn't come back after a reload is named, never sent as if it were there
  const lost = files?.filter((f) => f.lost) ?? []
  const addAgain = () => ref.current?.closest('.cbox')?.querySelector<HTMLInputElement>('input[type="file"]:not([data-pick])')?.click()
  const after = boxLine(chat, filled)
  const BoxEnd = has('voice') ? registry.views.boxEnd : undefined
  const stop = busy && !filled
  /** a paste's chip opened to edit: its text goes back into the box where it was pasted, a blank line around it as it
   *  is sent (fork #186), the caret after it */
  const editPaste = (p: Paste) => {
    const r = putBack(text, p.at ?? text.length, p.text)
    // the other pastes at its place stay before or after it, as they were
    const ps = getPastes(key)
    const i = ps.findIndex((x) => x.id === p.id)
    const place = new Map<string, number>()
    ps.forEach((x, j) => j !== i && x.at !== undefined && x.at === p.at && place.set(x.id, j < i ? r.from : r.end))
    dropPaste(key, p.id)
    setText(r.text, { from: r.from, to: r.to })
    if (place.size) setPastes(key, (now) => now.map((x) => (place.has(x.id) ? { ...x, at: place.get(x.id)! } : x)))
    const box = ref.current
    if (!box) return
    box.focus()
    requestAnimationFrame(() => box.setSelectionRange(r.end, r.end))
  }
  // fork #186: while a file is dragged over the page, the box shows where it goes
  const cbox = useRef<HTMLDivElement>(null)
  const drag = useFileDrag(cbox)
  return (
    <>
    <Jobs chat={chat} />
    <Held thread={thread} />
    {sug && <ReplyingTo chat={chat} id={sug.id} />}
    {sug && <Replies texts={sug.texts} onSend={sendSug} onEdit={editSug} />}
    <div
      ref={cbox}
      className={cx('cbox', drag && 'drop', drag === 'over' && 'over')}
      onDragOver={(e) => {
        e.preventDefault()
        if (drag) e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        const f = dropped(e.dataTransfer)
        if (!f.length) return
        e.preventDefault()
        attach(key, key, f)
      }}
    >
      {drag && (
        <div className="cdrop" aria-hidden="true">
          <I n="plus" c="s16" />
          <span>Drop to add to your message</span>
        </div>
      )}
      {shared && (
        <div className="fchips">
          <SharedChip chat={key} thread={thread} />
        </div>
      )}
      {reply && (
        <div className="fchips">
          <span className="fchip" aria-label={reply.task ? `Replying to the task ${reply.text}` : undefined}>
            <I n="reply" c="s16" />
            {reply.task && <I n="tasks" c="s16 c-mute" />}
            <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{reply.text}</span>
            <button type="button" aria-label="Don't reply to it" onClick={() => setUI((ui) => { const { [key]: _, ...rest } = ui.reply; return { reply: rest } })}><I n="x" c="s16" /></button>
          </span>
        </div>
      )}
      {!!files?.length && (
        <div className="athr box" role="list" aria-label="Files to send">
          {files.map((f, i) => (
            <div role="listitem" key={f.id ?? i}>
              <BoxThumb chat={key} f={f} onRetry={() => f.id && reupload(key, key, f.id)} onRemove={() => detach(key, i)} onAdd={addAgain} />
            </div>
          ))}
        </div>
      )}
      {!!lost.length && (
        <p className="alost" role="status">
          <I n="warn" c="s16" />
          <span>{listed(lost.map((f) => f.name))} {lost.length === 1 ? "wasn't" : "weren't"} kept when the page reloaded. Add {lost.length === 1 ? 'it' : 'them'} again, or remove {lost.length === 1 ? 'it' : 'them'}.</span>
        </p>
      )}
      {!!pastes.length && <PasteChips pastes={pastes} onRemove={(id) => dropPaste(key, id)} onEdit={editPaste} />}
      {mode && (
        <div className="fchips" role="status">
          {mode === 'run' ? (
            <span className="fchip cmdchip"><I n="prompt" c="s16" />Run as a command</span>
          ) : (
            <>
              <span className="fchip cmdchip cant"><I n="warn" c="s16" />{pickWords(pick).agent} can't run ! commands</span>
              {has('terminal') && (
                <button type="button" className="fchip" onClick={() => (thread.task ? toggleTaskTerm(thread.task.id) : toggleSpaceTerm())}>
                  <I n="prompt" c="s16" />Open your terminal{!phone && <kbd>Ctrl+`</kbd>}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {ment.list}
      {slash.list}
      {after && <AskLine id={`ask-${key}`} words={after} />}
      <div className="crow">
        <BoxLabel htmlFor={boxId} />
        <textarea
          {...ment.box}
          {...(slash.list ? slash.box : {})}
          ref={ref}
          id={boxId}
          className={cx('cin', mode && 'mono')}
          rows={1}
          name="message"
          data-box={key}
          aria-label={hint}
          aria-describedby={after ? `ask-${key}` : undefined}
          placeholder={hint}
          enterKeyHint={enterHint()}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const echo = isEcho(sentRef.current, text, e.target.value, Date.now())
            sentRef.current = null
            // what the edit replaced (fork #186: a folded paste keeps its place)
            const b = pre.current
            pre.current = null
            const edit = !b || b.ime ? undefined : b.undo ? ({ undo: true } as const) : typedEdit(text, e.target.value, b, e.target.selectionEnd)
            if (!echo) setDraft(key, e.target.value, edit)
          }}
          onFocus={(e) => {
            ment.box.onFocus()
            placed.current = key
          }}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onPaste={(e) => {
            const f = pasted(e.clipboardData)
            if (f.length) {
              e.preventDefault()
              attach(key, key, f)
              return
            }
            // a long paste (a log, a JSON) folds into a chip instead of filling the box
            const t = e.clipboardData?.getData('text/plain') ?? ''
            if (!isLongPaste(t)) return
            e.preventDefault()
            // fork #186: it folds where it was pasted, over what was selected, as a paste replaces a selection
            const box = e.currentTarget
            const at = box.selectionStart
            if (box.selectionEnd > at) setDraft(key, text.slice(0, at) + text.slice(box.selectionEnd), { from: at, to: box.selectionEnd })
            addPaste(key, t, at)
            requestAnimationFrame(() => box.setSelectionRange(at, at))
          }}
          onKeyDown={(e) => {
            // the # or @ list takes its keys first: Up, Down, Enter or Tab to pick, Escape
            if (ment.onKey(e)) return
            // the / list the same way
            if (slash.onKey(e)) return
            // Enter sends and Shift+Enter makes a new line; fork #118: on a phone's on-screen keyboard Return makes a new
            // line and the send button sends, as iMessage and WhatsApp do (enter.ts; a hardware keyboard still sends)
            if (sendsNow(e, getState().ui.keyboard)) {
              e.preventDefault()
              go(e.ctrlKey || e.metaKey)
            }
          }}
        />
      </div>
      <div className="cbar">
        <AddButtons finger={finger} onFiles={(f) => attach(key, key, f)} />
        <AgentLine
          pick={pick}
          machine={machine}
          onClick={() => openAgent()}
        />
        <UpdateHint chat={chat} />
        <span className="sp" />
        {registry.boxButtons.map((b, i) => <b.View key={i} thread={thread} setText={setText} />)}
        {BoxEnd ? (
          <BoxEnd thread={thread} setText={setText} filled={filled} send={() => go()} later={busy && mode !== 'run' ? () => go(true) : undefined} />
        ) : stop ? (
          <button type="button" className="send" aria-label="Stop" onClick={() => void tryAct({ type: 'stop', chat: key }, undefined, 'Stopping…')}>
            <I n="square" c="s16" />
          </button>
        ) : (
          <button type="button" className="send" aria-label="Send" disabled={mode === 'cant'} onClick={() => go()}>
            <I n="send" c="s16" />
          </button>
        )}
      </div>
    </div>
    </>
  )
}

// + (attach.tsx): files at once on a desktop, Apple's menu at once on iOS, a Camera / Photos / Files sheet on Android
export { AddButtons }

/** what Android's Share sheet put in this box: where it goes, and Change to send it to another space or task */
function SharedChip({ chat, thread }: { chat: string; thread: Thread }) {
  const snap = useSnap()!
  const t = thread.task
  const where = t ? t.name : spaceLabel(snap, thread.place)
  return (
    <span className="fchip shared">
      <I n="share" c="s16" />
      <span className="where">Shared to {where}</span>
      <button type="button" className="chg" onClick={() => openSendTo(chat)}>Change</button>
      <button type="button" aria-label="Keep it here" onClick={putAway}><I n="x" c="s16" /></button>
    </span>
  )
}

export default definePlugin({
  name: 'chat',
  setup(reg) {
    // R puts the cursor in the message box (Gmail's, Superhuman's reply); Cmd+Shift+M opens the agent line's model and
    // effort picker (T3 Code's, Claude's)
    reg.commands.push(
      { id: 'chat.reply', title: 'Write in the chat', area: 'Chat', icon: 'reply', keys: ['R'], words: 'reply message box type focus compose', when: () => !!focusChat(), run: () => void focusBox() },
      { id: 'chat.end', title: 'Go to the newest message', area: 'Chat', icon: 'toend', keys: ['End'], words: 'jump bottom latest scroll down end', when: () => isOffEnd(focusChat()), run: () => void toEnd(focusChat()) },
      { id: 'chat.model', title: 'Change model, effort or speed', area: 'Chat', icon: 'agent', keys: ['Mod+Shift+M'], words: 'agent picker claude codex fast ultra-fast tier', when: () => !!boxPart('button.agent'), run: () => boxPart('button.agent')?.click() },
    )
    // Share into Shepherdr (SHEP-345): a share lands in the chat open last
    watchLastChat()
    void landLaunchShare()
    reg.views.messages = Messages
    reg.views.box = Box
    reg.chatTail.push({ order: 15, View: StoppedChat }, { order: 95, View: WorkingSign }, { order: 96, View: BackgroundNote })
    reg.aboveBox.push({ order: 5, inPane: true, View: ToEnd })
    // Update <agent> (update.tsx): a row in the space's header menu and in a task's ⋯, while a newer version is out
    reg.spaceMenu.push({ order: 7, rows: (p, head) => (head ? updateRows(p.chat) : []) })
    reg.taskMenu.push({ order: 7, rows: (t, where) => (where === 'thread' ? updateRows(taskChat(t)) : []) })
    // Restart and End (restart.tsx): a way out for a running, even stuck, agent, beside Update in the chat's menu
    reg.spaceMenu.push({ order: 8, rows: (p, head) => (head ? [...restartRows(p.chat), ...endRows(p)] : []) })
    reg.taskMenu.push({ order: 8, rows: (t, where) => (where === 'thread' ? restartRows(taskChat(t)) : []) })
    // fork #105: a phone's header has no folder; its space's menu has it
    reg.spaceMenu.push({ order: 30, rows: (p, head) => (head ? folderRows(p) : []) })
  },
})

export { Box, Messages }
