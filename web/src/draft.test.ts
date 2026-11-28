// A draft is never lost (fork dmalis/shepherdr#149): one record per chat, written once typing pauses, back after a
// reload whole; a box clears on Send once its send is safe; another tab never brings a sent draft back.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { draftOf, draftParts, dropFile, fileOf, flushDrafts, IDLE, keepDraft, keepEach, keepFile, loadDrafts, MAX_WAIT, PREFIX, settleDrafts, sweepFiles, uploadedFile, useFileStore, whenSafe } from './draft.ts'

/** a localStorage that counts its writes, and can be made full */
function storage() {
  const m = new Map<string, string>()
  const s = {
    writes: 0,
    full: false,
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (s.full) throw new DOMException('full', 'QuotaExceededError')
      s.writes++
      m.set(k, v)
    },
    removeItem: (k: string) => void m.delete(k),
    m,
  }
  return s
}
const g = globalThis as { localStorage?: unknown }
let was: unknown
let ls: ReturnType<typeof storage>
beforeEach(() => {
  was = g.localStorage
  ls = storage()
  g.localStorage = ls
  loadDrafts()
})
afterEach(() => {
  g.localStorage = was
})

const reply = { id: 'm-1', who: 'agent', text: 'Which payment page?' }
const file = { name: 'shot.png', id: 'f-1', path: '/tmp/up/shot.png' }
const picks = { spaces: [{ id: 'sp2', name: 'cafe', route: '', machine: 'mini', target: 'sp2' }], tasks: [{ ref: 'SHOP-2', route: '', folder: '', title: 'Fix login' }] }

test('a draft with words, a paste, a pick, a reply and a file comes back whole after a reload', () => {
  keepDraft('p:shop', 'text', 'ask #cafe about @SHOP-2')
  keepDraft('p:shop', 'pastes', [{ id: 'a', text: 'a long log\n'.repeat(30) }])
  keepDraft('p:shop', 'picks', picks)
  keepEach('reply', {}, { 'p:shop': reply })
  keepEach('files', {}, { 'p:shop': [file] })
  expect(flushDrafts()).toBe(true)
  // the page goes; the next one reads storage
  loadDrafts()
  expect(draftOf('p:shop')).toEqual({ text: 'ask #cafe about @SHOP-2', pastes: [{ id: 'a', text: 'a long log\n'.repeat(30) }], picks, reply, files: [file] })
  expect(draftParts('files')).toEqual({ 'p:shop': [file] })
  expect(draftParts('reply')).toEqual({ 'p:shop': reply })
})

test('typing writes once it pauses, only its own chat, and at least every MAX_WAIT while it goes on', async () => {
  keepDraft('p:blog', 'text', 'another chat')
  flushDrafts()
  const before = ls.writes
  for (let i = 1; i <= 20; i++) keepDraft('p:shop', 'text', 'x'.repeat(i))
  // nothing written per letter
  expect(ls.writes).toBe(before)
  await Bun.sleep(IDLE + 50)
  expect(ls.writes).toBe(before + 1)
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!).text).toBe('x'.repeat(20))
  // typing that never pauses is still written
  const t0 = Date.now()
  let n = 0
  while (Date.now() - t0 < MAX_WAIT + 200) {
    keepDraft('p:shop', 'text', `y${n++}`)
    await Bun.sleep(IDLE / 4)
  }
  expect(ls.writes).toBeGreaterThan(before + 1)
})

test('an emptied box leaves nothing in storage, its picks with it', () => {
  keepDraft('p:shop', 'text', 'hi')
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).not.toBeNull()
  keepDraft('p:shop', 'text', undefined)
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).toBeNull()
  keepDraft('p:shop', 'text', '#cafe ')
  keepDraft('p:shop', 'picks', picks)
  keepDraft('p:shop', 'text', '')
  flushDrafts()
  expect(draftOf('p:shop')).toEqual({})
  expect(ls.getItem(PREFIX + 'p:shop')).toBeNull()
})

test("3.2's words and pastes move into the records, and their old keys go", () => {
  ls.setItem('shepherdr.drafts', JSON.stringify({ 'p:shop': 'hello', 'p:blog': 'there' }))
  ls.setItem('shepherdr.pastes', JSON.stringify({ 'p:shop': [{ id: 'a', text: 'log' }] }))
  loadDrafts()
  expect(draftOf('p:shop')).toEqual({ text: 'hello', pastes: [{ id: 'a', text: 'log' }] })
  expect(draftOf('p:blog')).toEqual({ text: 'there' })
  expect(ls.getItem('shepherdr.drafts')).toBeNull()
  expect(ls.getItem('shepherdr.pastes')).toBeNull()
  loadDrafts()
  expect(draftOf('p:shop').text).toBe('hello')
})

test('a full storage keeps the old keys and the change, and writes it once there is room', () => {
  ls.setItem('shepherdr.drafts', JSON.stringify({ 'p:shop': 'hello' }))
  ls.full = true
  loadDrafts()
  expect(draftOf('p:shop').text).toBe('hello')
  expect(ls.getItem('shepherdr.drafts')).not.toBeNull()
  ls.full = false
  expect(flushDrafts()).toBe(true)
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!).text).toBe('hello')
})

test('a box clears on Send only once its send is safe: kept by the outbox, or delivered', () => {
  const ran: string[] = []
  // kept by the outbox: safe at once
  whenSafe('c1', () => ran.push('c1'))
  settleDrafts([{ cid: 'c1', state: 'sending' }], true)
  expect(ran).toEqual(['c1'])
  // the outbox couldn't keep it (a full storage): the box keeps it while it is on its way or failed
  whenSafe('c2', () => ran.push('c2'))
  settleDrafts([{ cid: 'c2', state: 'sending' }], false)
  settleDrafts([{ cid: 'c2', state: 'failed' }], false)
  expect(ran).toEqual(['c1'])
  // delivered: it goes
  settleDrafts([{ cid: 'c2', state: 'sent' }], false)
  expect(ran).toEqual(['c1', 'c2'])
  // dropped unsent: the box keeps it for good
  whenSafe('c3', () => ran.push('c3'))
  settleDrafts([], false)
  settleDrafts([{ cid: 'c3', state: 'sent' }], true)
  expect(ran).toEqual(['c1', 'c2'])
})

test("a tab never brings back a draft another tab sent, and keeps another tab's newer parts", () => {
  keepDraft('p:shop', 'text', 'ship it')
  keepEach('files', {}, { 'p:shop': [{ name: 'a.txt', id: 'f-1' }] })
  flushDrafts()
  // another tab sent it: its record is gone
  ls.removeItem(PREFIX + 'p:shop')
  // this tab's upload lands later
  keepEach('files', { 'p:shop': [{ name: 'a.txt', id: 'f-1' }] }, { 'p:shop': [{ name: 'a.txt', id: 'f-1', path: '/up/a.txt' }] })
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).toBeNull()
  // what is typed from now on is kept again
  keepDraft('p:shop', 'text', 'next one')
  flushDrafts()
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!).text).toBe('next one')
  // another tab typed newer words; this one changes only the reply: both stay
  ls.setItem(PREFIX + 'p:shop', JSON.stringify({ text: 'their newer words' }))
  keepEach('reply', {}, { 'p:shop': reply })
  flushDrafts()
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!)).toEqual({ text: 'their newer words', reply })
})

test('a migration storage cut short goes on later, and never brings back a draft sent since', () => {
  ls.setItem('shepherdr.drafts', JSON.stringify({ 'p:shop': 'hello', 'p:blog': 'there' }))
  // room for one record only
  const set = ls.setItem
  let room = 1
  ls.setItem = (k: string, v: string) => {
    if (k.startsWith(PREFIX) && room-- <= 0) throw new DOMException('full', 'QuotaExceededError')
    set(k, v)
  }
  loadDrafts()
  ls.setItem = set
  const left = JSON.parse(ls.getItem('shepherdr.drafts') ?? '{}')
  expect(Object.keys(left)).toHaveLength(1)
  const moved = Object.keys({ 'p:shop': 1, 'p:blog': 1 }).find((k) => !(k in left))!
  // the moved one is sent: its record goes
  keepDraft(moved, 'text', undefined)
  flushDrafts()
  loadDrafts()
  expect(draftOf(moved)).toEqual({})
  expect(draftOf(Object.keys(left)[0]).text).toBe(left[Object.keys(left)[0]])
  expect(ls.getItem('shepherdr.drafts')).toBeNull()
})

test('the sweep leaves bytes another tab may have just kept', async () => {
  const m = new Map<string, number>([['new', Date.now()], ['old', 0], ['named', 0]])
  useFileStore({ put: async () => undefined, get: async () => null, del: async (id) => void m.delete(id), all: async () => [...m].map(([id, at]) => ({ id, at })) })
  ls.setItem(PREFIX + 'p:shop', JSON.stringify({ files: [{ name: 'a', id: 'named' }] }))
  await sweepFiles(new Set())
  await Bun.sleep(0)
  expect([...m.keys()].sort()).toEqual(['named', 'new'])
})

test("a file's kept bytes come back, go once uploaded, and ones nothing names are swept", async () => {
  const m = new Map<string, File>()
  useFileStore({ put: async (id, f) => void m.set(id, f), get: async (id) => m.get(id) ?? null, del: async (id) => void m.delete(id), all: async () => [...m.keys()].map((id) => ({ id, at: 0 })) })
  const f = new File(['png'], 'shot.png', { type: 'image/png' })
  await keepFile('f-1', f)
  await keepFile('f-2', f)
  expect((await fileOf('f-1'))?.name).toBe('shot.png')
  dropFile('f-1')
  await Bun.sleep(0)
  expect(await fileOf('f-1')).toBeNull()
  await sweepFiles(new Set())
  await Bun.sleep(0)
  expect(m.size).toBe(0)
})

test('an emptied box (a send) is written at once, not after the pause', async () => {
  keepDraft('p:shop', 'text', 'ship it')
  flushDrafts()
  keepDraft('p:shop', 'text', undefined)
  await Bun.sleep(5)
  expect(ls.getItem(PREFIX + 'p:shop')).toBeNull()
})

test("a file's bytes go only once the draft naming its upload is written", async () => {
  const m = new Map<string, File>()
  useFileStore({ put: async (id, f) => void m.set(id, f), get: async (id) => m.get(id) ?? null, del: async (id) => void m.delete(id), all: async () => [...m.keys()].map((id) => ({ id, at: 0 })) })
  await keepFile('f-9', new File(['x'], 'a.txt'))
  keepEach('files', {}, { 'p:shop': [{ name: 'a.txt', id: 'f-9' }] })
  flushDrafts()
  // the upload is done: the box's file gets its path, then the bytes are let go
  keepEach('files', { 'p:shop': [{ name: 'a.txt', id: 'f-9' }] }, { 'p:shop': [{ name: 'a.txt', id: 'f-9', path: '/up/a.txt' }] })
  uploadedFile('f-9')
  await Bun.sleep(0)
  expect(m.has('f-9')).toBe(true)
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!).files[0].path).toBeUndefined()
  await Bun.sleep(IDLE + 50)
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!).files[0].path).toBe('/up/a.txt')
  expect(m.has('f-9')).toBe(false)
})
