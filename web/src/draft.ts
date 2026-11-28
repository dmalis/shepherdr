// A draft is never lost (fork dmalis/shepherdr#149): one record per chat of everything its message box holds, kept
// across reloads: the words, the folded pastes, what each # and @ points at, the message it replies to and its files.
// Each part keeps its own home on the page (the words in kernel.ts, the pastes in fold.ts, the picks in mentions.tsx,
// the files and the reply in the UI state); each hands its changes here, and the record goes to storage once typing
// pauses and when the page hides, only for the chats that changed, never on every key press.
// A file's bytes wait in IndexedDB until its upload is done, then the record keeps the upload (send.ts). A send that
// the outbox couldn't keep (a full storage) holds its chat's stored draft as it was until the send is delivered.

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
/** where 3.2's words and pastes were kept, each for every chat at once: moved into the records once */
const OLD_TEXT = 'shepherdr.drafts'
const OLD_PASTES = 'shepherdr.pastes'
/** written once typing pauses this long, and at least this often while it goes on */
export const IDLE = 400
export const MAX_WAIT = 2000

const empty = (d: Draft) => !d.text && !d.pastes?.length && !d.picks?.spaces?.length && !d.picks?.tasks?.length && !d.reply && !d.files?.length

let drafts: Record<string, Draft> = {}
const dirty = new Set<string>()
/** chats whose stored draft stays as it was until the send it was sent as (its id) is delivered */
const held = new Map<string, string>()
let timer: ReturnType<typeof setTimeout> | null = null
let since = 0

const ls = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** read every chat's record from storage (the page's start, and a test's reload) */
export function loadDrafts() {
  drafts = {}
  dirty.clear()
  held.clear()
  if (timer) clearTimeout(timer)
  timer = null
  const s = ls()
  if (!s) return
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k?.startsWith(PREFIX)) continue
      try {
        const d = JSON.parse(s.getItem(k) ?? 'null')
        if (d && typeof d === 'object') drafts[k.slice(PREFIX.length)] = d as Draft
      } catch {
        /* half written: nothing to bring back */
      }
    }
    migrate(s)
  } catch {
    /* no storage here */
  }
}

/** 3.2's two stores become parts of the records; their keys go once the records are written */
function migrate(s: Storage) {
  const text = s.getItem(OLD_TEXT)
  const pastes = s.getItem(OLD_PASTES)
  if (text === null && pastes === null) return
  const parse = <T,>(v: string | null): Record<string, T> => {
    try {
      const o = JSON.parse(v ?? '{}')
      return o && typeof o === 'object' ? o : {}
    } catch {
      return {}
    }
  }
  for (const [k, t] of Object.entries(parse<string>(text))) if (typeof t === 'string' && t && !drafts[k]?.text) set(k, 'text', t)
  for (const [k, ps] of Object.entries(parse<DraftPaste[]>(pastes))) if (Array.isArray(ps) && ps.length && !drafts[k]?.pastes?.length) set(k, 'pastes', ps)
  if (writeNow()) {
    s.removeItem(OLD_TEXT)
    s.removeItem(OLD_PASTES)
  }
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
  if (v === undefined || (Array.isArray(v) && !v.length) || v === '') delete d[part]
  // the picks only mean something in the words they were picked in
  if (part === 'text' && !d.text) delete d.picks
  if (empty(d)) {
    if (!drafts[key]) return
    const { [key]: _, ...rest } = drafts
    drafts = rest
  } else drafts = { ...drafts, [key]: d }
  dirty.add(key)
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
  // typing that never pauses is still kept every MAX_WAIT
  timer = setTimeout(flushDrafts, Math.max(0, Math.min(IDLE, since + MAX_WAIT - now)))
}

/** false when storage refused one (a full storage): it stays to write, and the next change or hide tries again */
function writeNow(): boolean {
  const s = ls()
  if (!s) return false
  let ok = true
  for (const k of [...dirty]) {
    if (held.has(k)) continue
    try {
      const d = drafts[k]
      if (d && !empty(d)) s.setItem(PREFIX + k, JSON.stringify(d))
      else s.removeItem(PREFIX + k)
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
  return writeNow()
}

/** the outbox couldn't keep the send `cid` (a full storage): its chat's stored draft stays as it was, the box on the
 *  page clears, until `settleDrafts` sees the send delivered or the outbox kept */
export function holdDraft(key: string, cid: string) {
  // what was typed just before Send goes with it, if storage takes it
  flushDrafts()
  held.set(key, cid)
}

/** the outbox changed: a held draft goes once its send is delivered, dropped, or kept by the outbox after all */
export function settleDrafts(out: readonly { cid: string; state: string }[], kept: boolean) {
  if (!held.size) return
  let any = false
  for (const [k, cid] of held) {
    const o = out.find((x) => x.cid === cid)
    if (kept || !o || o.state === 'sent') {
      held.delete(k)
      dirty.add(k)
      any = true
    }
  }
  if (any) schedule()
}

if (typeof window !== 'undefined') {
  loadDrafts()
  // a phone drops a page it hid without another word: what the box holds is written before that
  addEventListener('pagehide', () => void flushDrafts())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushDrafts())
}

/* ---------- a box's files, kept until their upload is done ---------- */

/** where the bytes wait: IndexedDB, or a stand-in in tests */
export interface FileStore {
  put(id: string, f: File): Promise<void>
  get(id: string): Promise<File | null>
  del(id: string): Promise<void>
  ids(): Promise<string[]>
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
const idb: FileStore = {
  put: (id, f) => req('readwrite', (s) => s.put(f, id)).then(() => undefined),
  get: (id) => req('readonly', (s) => s.get(id) as IDBRequest<File | undefined>).then((f) => (f instanceof Blob ? (f as File) : null)),
  del: (id) => req('readwrite', (s) => s.delete(id)).then(() => undefined),
  ids: () => req('readonly', (s) => s.getAllKeys()).then((ks) => ks.map(String)),
}
const noStore: FileStore = { put: () => Promise.reject(new Error('no IndexedDB')), get: () => Promise.resolve(null), del: () => Promise.resolve(), ids: () => Promise.resolve([]) }
let files: FileStore = typeof indexedDB === 'undefined' ? noStore : idb
/** tests: a store of their own */
export const useFileStore = (s: FileStore) => void (files = s)

/** keep a file's bytes until its upload is done; nothing is said if they can't be kept (a reload then names it) */
export const keepFile = (id: string, f: File) => files.put(id, f).catch(() => undefined)
export const dropFile = (id: string) => void files.del(id).catch(() => undefined)
export const fileOf = (id: string) => files.get(id).catch(() => null)
/** the bytes no box and no send still names go (a send dropped before its upload was done) */
export async function sweepFiles(live: Set<string>) {
  for (const id of await files.ids().catch(() => [] as string[])) if (!live.has(id)) dropFile(id)
}
