// A draft is never lost (fork dmalis/shepherdr#149): one record per chat of everything its message box holds, kept
// across reloads: the words, the folded pastes, what each # and @ points at, the message it replies to and its files.
// Each part keeps its own home on the page (the words in kernel.ts, the pastes in fold.ts, the picks in mentions.tsx,
// the files and the reply in the UI state); each hands its changes here, and the record goes to storage once typing
// pauses and when the page hides, only for the chats that changed, never on every key press. A tab writes only the
// parts it changed over what storage holds now, and never brings back a draft another tab sent.
// A file's bytes wait in IndexedDB until the draft or the send that names its upload is kept (send.ts). A box clears
// on Send only once its send is safe: kept by the outbox, or, when storage is full, delivered (`whenSafe`).

/** a file in a message box: `lost` when its bytes didn't come back after a reload */
export type DraftFile = { name: string; path?: string; id?: string; failed?: string; lost?: boolean }
export type DraftPaste = { id: string; text: string }
export type DraftReply = { id: string; text: string; who?: string; task?: string }
/** what each # and @ picked points at: kept as mentions.tsx made them */
export type DraftPicks = { spaces?: unknown[]; tasks?: unknown[] }

export interface Draft {
  text?: string
  pastes?: DraftPaste[]
  picks?: DraftPicks
  reply?: DraftReply
  files?: DraftFile[]
}
type Part = keyof Draft

export const PREFIX = 'shepherdr.draft:'
/** where 3.2's words and pastes were kept, each for every chat at once: moved into the records, chat by chat */
const OLD_TEXT = 'shepherdr.drafts'
const OLD_PASTES = 'shepherdr.pastes'
/** written once typing pauses this long, and at least this often while it goes on */
export const IDLE = 400
export const MAX_WAIT = 2000

const empty = (d: Draft) => !d.text && !d.pastes?.length && !d.picks?.spaces?.length && !d.picks?.tasks?.length && !d.reply && !d.files?.length

let drafts: Record<string, Draft> = {}
/** the parts of each chat's record changed on this page and not written yet */
const dirty = new Map<string, Set<Part>>()
/** each chat's record as this page last read or wrote it: another tab wrote when storage differs */
const base = new Map<string, string | null>()
let timer: ReturnType<typeof setTimeout> | null = null
let since = 0
let soon = false

const ls = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
const parse = (v: string | null): Draft | null => {
  try {
    const d = JSON.parse(v ?? 'null')
    return d && typeof d === 'object' ? (d as Draft) : null
  } catch {
    return null
  }
}

/** read every chat's record from storage (the page's start, and a test's reload) */
export function loadDrafts() {
  drafts = {}
  dirty.clear()
  base.clear()
  safe.clear()
  if (timer) clearTimeout(timer)
  timer = null
  soon = false
  const s = ls()
  if (!s) return
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k?.startsWith(PREFIX)) continue
      const raw = s.getItem(k)
      const d = parse(raw)
      base.set(k.slice(PREFIX.length), raw)
      if (d) drafts[k.slice(PREFIX.length)] = d
    }
    migrate(s)
  } catch {
    /* no storage here */
  }
}

/** 3.2's two stores become parts of the records. A chat leaves them once its record is written, so a storage too full
 *  for all of them moves the rest on a later page, and never brings back one that moved and was sent since */
function migrate(s: Storage) {
  const read = <T,>(k: string): Record<string, T> => {
    try {
      const o = JSON.parse(s.getItem(k) ?? '{}')
      return o && typeof o === 'object' ? o : {}
    } catch {
      return {}
    }
  }
  const text = read<string>(OLD_TEXT)
  const pastes = read<DraftPaste[]>(OLD_PASTES)
  if (!Object.keys(text).length && !Object.keys(pastes).length) return
  for (const k of new Set([...Object.keys(text), ...Object.keys(pastes)])) {
    // its record was written by a page of this build: it came over already
    if (base.has(k)) continue
    if (typeof text[k] === 'string' && text[k]) set(k, 'text', text[k])
    if (Array.isArray(pastes[k]) && pastes[k].length) set(k, 'pastes', pastes[k])
  }
  writeNow()
  const left = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => dirty.has(k)))
  const put = (key: string, o: Record<string, unknown>) => {
    try {
      if (Object.keys(o).length) s.setItem(key, JSON.stringify(o))
      else s.removeItem(key)
    } catch {
      /* smaller than before, so it fits; if not, a later page tries again */
    }
  }
  put(OLD_TEXT, left(text))
  put(OLD_PASTES, left(pastes))
}

const none: Draft = {}
/** a chat's record as it is on the page now */
export const draftOf = (key: string): Draft => drafts[key] ?? none
/** one part of every chat's record, for a store that holds that part for all chats (the UI state's files, reply) */
export function draftParts<P extends Part>(part: P): Record<string, NonNullable<Draft[P]>> {
  const out: Record<string, NonNullable<Draft[P]>> = {}
  for (const [k, d] of Object.entries(drafts)) if (d[part] !== undefined) out[k] = d[part]!
  return out
}

function set<P extends Part>(key: string, part: P, v: Draft[P] | undefined) {
  const d: Draft = { ...drafts[key], [part]: v }
  const parts = dirty.get(key) ?? new Set<Part>()
  if (v === undefined || (Array.isArray(v) && !v.length) || v === '') delete d[part]
  // the picks only mean something in the words they were picked in
  if (part === 'text' && !d.text && d.picks) {
    delete d.picks
    parts.add('picks')
  }
  parts.add(part)
  dirty.set(key, parts)
  if (empty(d)) {
    const { [key]: _, ...rest } = drafts
    drafts = rest
    // a box emptied (most often: sent) is written at once, so a page that dies now never brings a sent draft back
    soon = true
  } else drafts = { ...drafts, [key]: d }
}

/** a part of a chat's box changed: kept on the page now, in storage once typing pauses */
export function keepDraft<P extends Part>(key: string, part: P, v: Draft[P] | undefined) {
  if (drafts[key]?.[part] === v) return
  set(key, part, v)
  schedule()
}

/** a store of one part for every chat changed (the UI state's files or replies): keep each chat whose part changed */
export function keepEach<P extends Part>(part: P, was: Record<string, unknown>, now: Record<string, unknown>) {
  if (was === now) return
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) if (was[k] !== now[k]) set(k, part, now[k] as Draft[P])
  schedule()
}

function schedule() {
  if (!dirty.size) return
  const now = Date.now()
  if (!timer) since = now
  else clearTimeout(timer)
  // typing that never pauses is still kept every MAX_WAIT; an emptied box goes once this task's other changes are in
  timer = setTimeout(flushDrafts, soon ? 0 : Math.max(0, Math.min(IDLE, since + MAX_WAIT - now)))
}

/** write each changed chat over what storage holds now: only the parts changed here, so another tab's newer parts
 *  stay; a record another tab cleared (it sent the draft) is not brought back. False when storage refused one (a
 *  full storage): it stays to write, and the next change or hide tries again */
function writeNow(): boolean {
  const s = ls()
  if (!s) return false
  let ok = true
  for (const [k, parts] of [...dirty]) {
    try {
      const raw = s.getItem(PREFIX + k)
      let d = drafts[k] ?? {}
      if (raw !== (base.get(k) ?? null)) {
        // another tab wrote it since this page read it
        const theirs = parse(raw)
        if (!theirs) {
          // it sent (or emptied) the draft: this page's copy is spent; only what is typed from now on is kept
          dirty.delete(k)
          base.set(k, null)
          continue
        }
        d = { ...theirs }
        for (const p of parts) (d as Record<string, unknown>)[p] = drafts[k]?.[p]
        for (const p of parts) if (d[p] === undefined) delete d[p]
      }
      const out = empty(d) ? null : JSON.stringify(d)
      if (out === null) s.removeItem(PREFIX + k)
      else s.setItem(PREFIX + k, out)
      base.set(k, out)
      dirty.delete(k)
    } catch {
      ok = false
    }
  }
  return ok
}

/** write what changed now: typing paused, the page hides, or a test */
export function flushDrafts(): boolean {
  if (timer) clearTimeout(timer)
  timer = null
  soon = false
  const ok = writeNow()
  // bytes whose upload is done go once the record that names the upload is written
  if (!dirty.size) for (const id of uploaded.splice(0)) dropFile(id)
  return ok
}

/* ---------- a box clears on Send once its send is safe ---------- */

/** what to do once a send (its id) is safe: kept by the outbox, or delivered; never when it is dropped unsent */
const safe = new Map<string, { run: () => void; went?: boolean }>()
export function whenSafe(cid: string, run: () => void) {
  safe.set(cid, { run })
}
/** the outbox changed (`kept`: storage holds it now): a send that is safe runs what waited on it */
export function settleDrafts(out: readonly { cid: string; state: string }[], kept: boolean) {
  if (!safe.size) return
  for (const [cid, w] of [...safe]) {
    const o = out.find((x) => x.cid === cid)
    if (o?.state === 'sent') w.went = true
    // gone from the outbox after it went: it came back in the chat. Gone before that: dropped, the box keeps it
    if ((o && (kept || w.went)) || (!o && w.went)) {
      safe.delete(cid)
      w.run()
    } else if (!o) safe.delete(cid)
  }
}

if (typeof window !== 'undefined') {
  loadDrafts()
  // a phone drops a page it hid without another word: what the box holds is written before that
  addEventListener('pagehide', () => void flushDrafts())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushDrafts())
}

/* ---------- a box's files, kept until their upload is kept ---------- */

/** where the bytes wait: IndexedDB, or a stand-in in tests. `at`: when they were kept */
export interface FileStore {
  put(id: string, f: File): Promise<void>
  get(id: string): Promise<File | null>
  del(id: string): Promise<void>
  all(): Promise<{ id: string; at: number }[]>
}

const DB = 'shepherdr-drafts'
const FILES = 'files'
let db: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  db ??= new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(FILES)
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
    r.onblocked = () => no(new Error('blocked'))
  })
  db.catch(() => (db = null))
  return db
}
function req<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((ok, no) => {
        const t = d.transaction(FILES, mode)
        const r = run(t.objectStore(FILES))
        t.oncomplete = () => ok(r.result)
        t.onerror = t.onabort = () => no(t.error ?? r.error)
      }),
  )
}
type Kept = { file: File; at: number }
const idb: FileStore = {
  put: (id, file) => req('readwrite', (s) => s.put({ file, at: Date.now() } satisfies Kept, id)).then(() => undefined),
  get: (id) => req('readonly', (s) => s.get(id) as IDBRequest<Kept | undefined>).then((k) => (k?.file instanceof Blob ? k.file : null)),
  del: (id) => req('readwrite', (s) => s.delete(id)).then(() => undefined),
  all: () =>
    req('readonly', (s) => s.getAll() as IDBRequest<Kept[]>).then(async (vs) => {
      const ids = await req('readonly', (s) => s.getAllKeys())
      return ids.map((id, i) => ({ id: String(id), at: vs[i]?.at ?? 0 }))
    }),
}
const noStore: FileStore = { put: () => Promise.reject(new Error('no IndexedDB')), get: () => Promise.resolve(null), del: () => Promise.resolve(), all: () => Promise.resolve([]) }
let files: FileStore = typeof indexedDB === 'undefined' ? noStore : idb
/** tests: a store of their own */
export const useFileStore = (s: FileStore) => void (files = s)

/** keep a file's bytes until its upload is kept; nothing is said if they can't be (a reload then names it) */
export const keepFile = (id: string, f: File) => files.put(id, f).catch(() => undefined)
export const dropFile = (id: string) => void files.del(id).catch(() => undefined)
export const fileOf = (id: string) => files.get(id).catch(() => null)
const uploaded: string[] = []
/** its upload is done while it is in a box: the bytes go once the draft naming the upload is written (a page that
 *  dies first still has them) */
export function uploadedFile(id: string) {
  uploaded.push(id)
  schedule()
  if (!dirty.size) flushDrafts()
}
/** bytes kept longer than this that nothing names any more go: another tab's newest ones are never that old */
export const SWEEP_AFTER = 24 * 60 * 60_000
/** the bytes no box and no send names, in any tab's stored drafts or outbox or on this page, and kept a day ago */
export async function sweepFiles(live: Set<string>, now = Date.now()) {
  const s = ls()
  // what every tab has written: their drafts' files and their outbox's
  if (s)
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k || !(k.startsWith(PREFIX) || k.startsWith('shepherdr.outbox'))) continue
      for (const m of (s.getItem(k) ?? '').matchAll(/"id":"([^"]+)"/g)) live.add(m[1])
    }
  for (const { id, at } of await files.all().catch(() => [] as { id: string; at: number }[])) if (!live.has(id) && now - at > SWEEP_AFTER) dropFile(id)
}
