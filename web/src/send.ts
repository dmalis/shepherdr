// Sending a message: it shows in the chat the moment you send it (the outbox), goes again by itself while the network
// is the trouble, and keeps its words for Retry when it did not go through. Files go up as they are attached; a
// message waits for its files, and for the ones sent before it in its chat.
import type { ReplyQuote } from '@shared/types.ts'
import { act, getState, holdReload, notice, setOutbox, setUI, type Outgoing } from './kernel.ts'
import { anchorOf, priorOf, reasonOf, SEND_TIMEOUT } from './outbox.ts'
import { HttpError, postFile, retrying } from './uploads.ts'
import { dropFile, fileOf, keepFile, sweepFiles, uploadedFile, whenSafe } from './draft.ts'

/** an id of the screen's own (randomUUID needs https, and a tailnet link may be plain http) */
const newCid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** up to 25 MB each */
export const MAX_FILE = 25 * 1024 * 1024

const uploads = new Map<string, Promise<string>>()
const gates = new Map<string, Promise<void>>()

/** what this screen still has of a file it put in a box: the file itself, a link to it for its picture and, once
 *  read, the picture's size (so a sent copy keeps its box before the picture has drawn) */
const local = new Map<string, { file: File; url: string; w?: number; h?: number }>()
/** the box file an uploaded path came from: the delivered message names only the path, and finds the same copy */
const fromPath = new Map<string, string>()
export const localOf = (id: string | undefined, path?: string) => (id ? local.get(id) : undefined) ?? (path ? local.get(fromPath.get(path) ?? '') : undefined)

const setBox = (key: string, fn: (fs: UIFile[]) => UIFile[]) => setUI((ui) => ({ files: { ...ui.files, [key]: fn(ui.files[key] ?? []) } }))
type UIFile = ReturnType<typeof getState>['ui']['files'][string][number]

function upload(key: string, chat: string, id: string, f: File) {
  const up = retrying(() => postFile(chat, f), Date.now())
  uploads.set(id, up)
  up.then(
    (path) => {
      fromPath.set(path, id)
      const boxed = (getState().ui.files[key] ?? []).some((x) => x.id === id)
      setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, path, failed: undefined } : x)))
      // its draft keeps the upload from now on: the bytes kept for a reload go once that is written (draft.ts). One
      // already sent keeps them until its send has the path (deliver)
      if (boxed) uploadedFile(id)
    },
    (e) => {
      // it stays in the box and says so on its tile: a tap tries again, its x takes it out
      uploads.delete(id)
      setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, failed: reasonOf(e) || 'It did not go up' } : x)))
    },
  )
}

/** put files in a message box: each shows as a thumbnail at once and goes up meanwhile */
export function attach(key: string, chat: string, files: File[]) {
  for (const f of files) {
    if (f.size > MAX_FILE) {
      notice(`${f.name} is over 25 MB.`, { tone: 'error' })
      continue
    }
    const id = newCid()
    let url = ''
    try {
      url = URL.createObjectURL(f)
    } catch {
      /* no object links here: its tile waits for the upload */
    }
    hold(id, f, url)
    // its bytes wait for a reload until its upload is done (draft.ts)
    void keepFile(id, f)
    // added again: the one a reload lost by this name goes (fork #149)
    setBox(key, (fs) => [...fs.filter((x) => !(x.lost && x.name === f.name)), { name: f.name, id }])
    upload(key, chat, id, f)
  }
}

/** this screen's own copy of a file: its picture's link and, once read, its size */
function hold(id: string, f: File, url: string) {
  const l: { file: File; url: string; w?: number; h?: number } = { file: f, url }
  local.set(id, l)
  if (url && f.type.startsWith('image/') && typeof Image === 'function') {
    const img = new Image()
    img.onload = () => {
      l.w = img.naturalWidth
      l.h = img.naturalHeight
    }
    img.src = url
  }
}
const linkOf = (f: File) => {
  try {
    return URL.createObjectURL(f)
  } catch {
    return ''
  }
}

/** after a reload, each box's files whose upload wasn't done come back from their kept bytes: one on its way goes up
 *  again, a failed one waits for Try again, and one whose bytes are gone says so on its tile (fork #149) */
export async function restoreFiles() {
  const boxes = getState().ui.files
  const mark = (key: string, id: string, p: Partial<UIFile>) => setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  await Promise.all(
    Object.entries(boxes).flatMap(([key, fs]) =>
      fs.map(async (f) => {
        if (f.path || f.lost || !f.id || local.has(f.id)) return
        const file = await fileOf(f.id)
        if (!file) return mark(key, f.id, { lost: true, failed: undefined })
        hold(f.id, file, linkOf(file))
        if (!f.failed) upload(key, key, f.id, file)
      }),
    ),
  )
}

/** try a failed upload again */
export function reupload(key: string, chat: string, id: string) {
  const l = local.get(id)
  if (!l) return
  setBox(key, (fs) => fs.map((x) => (x.id === id ? { ...x, failed: undefined } : x)))
  upload(key, chat, id, l.file)
}

export function detach(key: string, index: number) {
  const gone = getState().ui.files[key]?.[index]
  if (gone?.id) {
    const l = local.get(gone.id)
    if (l?.url) URL.revokeObjectURL(l.url)
    local.delete(gone.id)
    uploads.delete(gone.id)
    dropFile(gone.id)
  }
  setBox(key, (fs) => fs.filter((_, i) => i !== index))
}

/** what the server is asked: the message, by its id (asked again, the same id gets the same answer) */
const sendOf = (o: Outgoing) => ({ type: 'send', chat: o.chat, text: o.text, attachments: o.files.map((f) => f.path), cid: o.cid, ...(o.reply?.task ? { replyTask: o.reply.task } : { reply: o.reply?.id }), human: true, ...(o.hold ? { hold: true } : {}), ...(o.was ? { was: o.was } : {}), ...(o.how ? { how: o.how } : {}) })

async function deliver(cid: string, pending: Promise<string>[]) {
  const first = getState().outbox.find((x) => x.cid === cid)
  if (!first || first.state !== 'sending') return
  let opened!: () => void
  const mine = new Promise<void>((r) => (opened = r))
  const before = getState()
    .outbox.filter((x) => x.chat === first.chat && x.cid !== cid && x.state === 'sending' && x.at <= first.at)
    .map((x) => gates.get(x.cid))
    .filter(Boolean)
  gates.set(cid, mine)
  const patch = (p: (x: Outgoing) => Partial<Outgoing>) => setOutbox((all) => all.map((x) => (x.cid === cid && x.state === 'sending' ? { ...x, ...p(x) } : x)))
  try {
    // fork #149: each upload's path is kept in the outbox as it lands, and only then are its kept bytes let go, so a
    // reload while another file is still going up loses neither
    const paths = await Promise.all(
      pending.map((p, i) =>
        p.then((path) => {
          const id = first.files[i]?.id
          if (path && !first.files[i]?.path) {
            const kept = patch((x) => ({ files: x.files.map((f, j) => (j === i ? { ...f, path } : f)) }))
            if (kept && id) dropFile(id)
          }
          return path
        }),
      ),
    )
    const files = first.files.map((f, i) => ({ ...f, path: paths[i] ?? f.path }))
    await Promise.all(before)
    const o = getState().outbox.find((x) => x.cid === cid)
    if (!o || o.state !== 'sending') return
    // a reload now would cut it off on its way
    const release = holdReload()
    let r: { waiting?: boolean; waitsFor?: Outgoing['waitsFor']; at?: number }
    try {
      r = await retrying(
        () => act<typeof r>(sendOf({ ...o, files }), AbortSignal.timeout(SEND_TIMEOUT)),
        first.at,
        { onWait: (offline) => patch((x) => (!!x.offline === offline ? {} : { offline: offline || undefined })) },
      )
    } finally {
      release()
    }
    const serverAt = typeof r?.at === 'number' ? r.at : undefined
    patch((x) => ({ state: 'sent', error: undefined, offline: undefined, serverAt, ...(x.queued || x.wentAt ? {} : { waiting: r?.waiting || undefined, waitsFor: (r?.waiting && r.waitsFor) || undefined }) }))
  } catch (e) {
    patch(() => ({ state: 'failed', error: reasonOf(e), offline: undefined }))
    void act({ type: 'analytics', do: 'event', event: 'message.failed', fields: { chat: first.chat } }).catch(() => undefined)
  } finally {
    gates.delete(cid)
    opened()
  }
}

/** Send what a box holds: its words, its files and the message it replies to. `hold`: the agent is working, so it
 *  waits its turn and is delivered when the agent is free. `quote`: what a message sent alone replies to (a tapped
 *  suggested reply: the message it came with, dmalis/shepherdr#51). */
export function send(key: string, chat: string, text: string, hold = false, alone = false, how?: 'typed' | 'dictated' | 'bubble', quote?: ReplyQuote & { id: string }): Posted | undefined {
  const s = getState()
  // one that failed to go up stays out of it (its tile said so). Alone (a suggested reply tapped): only the text, the
  // box's files and quoted reply stay where they are for the draft
  const boxed = alone ? [] : (s.ui.files[key] ?? []).filter((f) => !f.failed && !f.lost)
  const reply = alone ? quote : (s.ui.reply[key] as (ReplyQuote & { id: string }) | undefined)
  if (!text.trim() && !boxed.length) return
  const cid = newCid()
  const pending = boxed.map((f) => (f.path ? Promise.resolve(f.path) : (uploads.get(f.id ?? '') ?? Promise.reject(new Error('The file is gone.')))))
  const out: Outgoing = {
    cid,
    chat,
    text: text.trim(),
    files: boxed.map((f) => ({ name: f.name, path: f.path ?? '', ...(f.id ? { id: f.id } : {}) })),
    reply,
    at: Date.now(),
    prior: priorOf(s.chats[chat]),
    after: anchorOf(s.chats[chat]),
    before: s.outbox.filter((x) => x.chat === chat).map((x) => x.cid),
    state: 'sending',
    ...(hold ? { hold: true } : {}),
    // personal analytics: how it was written (typed, dictated or a suggested reply's bubble), never what
    how: how ?? (alone ? 'bubble' : 'typed'),
  }
  const kept = setOutbox((all) => [...all, out])
  // fork #149: the box lets go of what was sent only once the send is safe: kept by the outbox, or, when storage is
  // full, delivered. A file that failed to go up or that a reload lost stays, with its Try again or its words
  if (!alone) {
    const sent = new Set(boxed.map((f) => f.id))
    const clear = () =>
      setUI((ui) => {
        const left = (ui.files[key] ?? []).filter((f) => !sent.has(f.id))
        const { [key]: _f, ...files } = ui.files
        const { [key]: _r, ...replies } = ui.reply
        return { files: left.length ? { ...files, [key]: left } : files, reply: ui.reply[key]?.id === reply?.id ? replies : ui.reply }
      })
    if (kept) clear()
    else whenSafe(cid, clear)
  }
  if (!kept && out.how !== 'bubble') notice("Storage is full: what you sent stays in the box until it's delivered.", { tone: 'error' })
  void deliver(cid, pending)
  return { cid, kept }
}

/** a send made: its id, and whether the outbox could keep it (else the box keeps its draft until it's delivered) */
export type Posted = { cid: string; kept: boolean }

/** send again what didn't go through: it moves down to the end, like a new message */
export function retry(cid: string) {
  const s = getState()
  const o = s.outbox.find((x) => x.cid === cid)
  if (!o) return
  // one that went in but didn't show up goes as a new message, naming the first: the server sends it again only when
  // the agent's log doesn't have the first after all (it came back late: never twice)
  const again: Outgoing = { ...o, cid: o.lost ? newCid() : o.cid, was: o.lost ? (o.was ?? o.cid) : o.was, state: 'sending', error: undefined, lost: undefined, waiting: undefined, waitsFor: undefined, queued: undefined, serverAt: undefined, wentAt: undefined, busyAt: undefined, pastAt: undefined, offline: undefined, at: Date.now(), prior: priorOf(s.chats[o.chat]), after: anchorOf(s.chats[o.chat]), before: s.outbox.filter((x) => x.chat === o.chat && x.cid !== cid).map((x) => x.cid) }
  setOutbox((all) => all.map((x) => (x.cid === cid ? again : x)))
  // fork #149: one whose files never went up (a reload cut them off) takes them from their kept bytes
  resume(again)
}

export const dropOut = (cid: string) => setOutbox((all) => all.filter((x) => x.cid !== cid))

/** a reload (or the phone dropping the page) cut these off on their way: they go on with the same id, which the
 *  server answers once (a send asked again never goes twice). Ones whose files had not gone up yet fail in time. */
export function resumeSending() {
  for (const o of getState().outbox) {
    if (o.state !== 'sending' || gates.has(o.cid)) continue
    resume(o)
  }
}
/** fork #149: one whose files were still going up goes on from their kept bytes (draft.ts), or this screen's own copy
 *  (a Retry); its place in line is taken at once, before they are read */
function resume(o: Outgoing) {
  const pending = o.files.map(async (f) => {
    if (f.path) return f.path
    const file = (f.id && local.get(f.id)?.file) || (f.id ? await fileOf(f.id) : null)
    if (!file) throw new Error(`${f.name} wasn't kept when the page reloaded.`)
    hold(f.id!, file, linkOf(file))
    const path = await retrying(() => postFile(o.chat, file), Date.now())
    fromPath.set(path, f.id!)
    return path
  })
  void deliver(o.cid, pending)
}
/** the kept bytes no box and no send names any more go */
export function sweepKept() {
  const s = getState()
  const live = new Set<string>()
  for (const fs of Object.values(s.ui.files)) for (const f of fs) if (f.id && !f.path) live.add(f.id)
  for (const o of s.outbox) for (const f of o.files) if (f.id && !f.path) live.add(f.id)
  return sweepFiles(live)
}
if (typeof window !== 'undefined')
  setTimeout(() => {
    resumeSending()
    void restoreFiles().then(sweepKept)
  }, 0)

/** dmalis/shepherdr#59: ones waiting for their agent's answer are asked about now and then, by their id: still waiting,
 *  went in (it then shows in the chat like any sent message, timed from now), failed (Retry is the person's), or
 *  unknown to the server (a restart lost it): only then is it sent again, by its id, so never twice. Asking never sends
 *  anything itself. A failed ask changes nothing; the next one tries again. */
export async function recheckWaiting() {
  for (const o of getState().outbox) {
    if (o.state !== 'sent' || !o.waiting || o.waitsFor !== 'answer' || gates.has(o.cid)) continue
    const set = (p: Partial<Outgoing>) => setOutbox((all) => all.map((x) => (x.cid === o.cid && x.state === 'sent' && x.waitsFor === 'answer' ? { ...x, ...p } : x)))
    try {
      const s = await act<{ state?: string; at?: number; error?: string }>({ type: 'send-state', cid: o.cid }, AbortSignal.timeout(SEND_TIMEOUT))
      if (s?.state === 'went') set({ waiting: undefined, waitsFor: undefined, wentAt: Date.now(), serverAt: typeof s.at === 'number' ? s.at : o.serverAt })
      else if (s?.state === 'failed') set({ state: 'failed', error: s.error || 'It did not go in.', waiting: undefined })
      else if (s?.state === 'unknown') {
        const r = await act<{ waiting?: boolean; waitsFor?: Outgoing['waitsFor']; at?: number }>(sendOf(o), AbortSignal.timeout(SEND_TIMEOUT))
        set({ waiting: r?.waiting || undefined, waitsFor: (r?.waiting && r.waitsFor) || undefined, ...(r?.waiting ? {} : { wentAt: Date.now() }), serverAt: typeof r?.at === 'number' ? r.at : o.serverAt })
      }
    } catch (e) {
      // the server's own no (its agent is gone): Retry is the person's; out of reach: asked again next time
      if (e instanceof HttpError && e.status >= 400 && e.status < 500) set({ state: 'failed', error: reasonOf(e), waiting: undefined })
    }
  }
}
export const RECHECK = 30_000
if (typeof window !== 'undefined') setInterval(() => void recheckWaiting(), RECHECK)
