// A draft is never lost (fork dmalis/shepherdr#149): one record per chat, written once typing pauses, back after a
// reload whole, and held while the outbox couldn't keep its send.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { draftOf, draftParts, dropFile, fileOf, flushDrafts, holdDraft, IDLE, keepDraft, keepEach, keepFile, loadDrafts, MAX_WAIT, PREFIX, settleDrafts, sweepFiles, useFileStore } from './draft.ts'

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

test('the stored draft clears only once the outbox has the send', () => {
  keepDraft('p:shop', 'text', 'ship it')
  flushDrafts()
  // the outbox couldn't keep the send: the box clears on the page, the stored draft stays as it was
  holdDraft('p:shop', 'c1')
  keepDraft('p:shop', 'text', undefined)
  flushDrafts()
  expect(draftOf('p:shop')).toEqual({})
  expect(JSON.parse(ls.getItem(PREFIX + 'p:shop')!).text).toBe('ship it')
  // still on its way: kept
  settleDrafts([{ cid: 'c1', state: 'sending' }], false)
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).not.toBeNull()
  // failed: kept, for Retry or the next page
  settleDrafts([{ cid: 'c1', state: 'failed' }], false)
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).not.toBeNull()
  // delivered: it goes
  settleDrafts([{ cid: 'c1', state: 'sent' }], false)
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).toBeNull()
})

test('a held draft goes once the outbox keeps it after all, or the send is dropped', () => {
  keepDraft('p:shop', 'text', 'one')
  flushDrafts()
  holdDraft('p:shop', 'c1')
  keepDraft('p:shop', 'text', undefined)
  settleDrafts([{ cid: 'c1', state: 'sending' }], true)
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:shop')).toBeNull()
  keepDraft('p:blog', 'text', 'two')
  flushDrafts()
  holdDraft('p:blog', 'c2')
  keepDraft('p:blog', 'text', undefined)
  settleDrafts([], false)
  flushDrafts()
  expect(ls.getItem(PREFIX + 'p:blog')).toBeNull()
})

test("a file's kept bytes come back, go once uploaded, and ones nothing names are swept", async () => {
  const m = new Map<string, File>()
  useFileStore({ put: async (id, f) => void m.set(id, f), get: async (id) => m.get(id) ?? null, del: async (id) => void m.delete(id), ids: async () => [...m.keys()] })
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
