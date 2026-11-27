// The Feedback page (friction loop, slice 2, #94): its sections and counts, Not now's menu, Undo, the empty page and
// the plugin switched off, the box keeping its text when saving fails, and words that never say "Assistant", "worker"
// or a key. The demo's fictional day is the snapshot; the service is a stubbed fetch.
import { afterAll, afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeedbackList, Snapshot } from '@shared/types.ts'
import { feedback as demoList, snapshot } from '../../demo/data.ts'

// the real toasts and no mock.module: Bun keeps a module mock for every later test file (a mocked menu broke the
// chat's Reply in chat test). The page gets its day as a prop, so another file's kernel mock can't change it.
const T = await import('@client/toasts.ts')
const toasts = () => T.toasts().map((t) => ({ text: t.text, o: { tone: t.tone, act: t.act } }))
const clearToasts = () => T.toasts().forEach((t) => T.dismiss(t.id))
const { FeedbackPage, decide, saveBox, writeUpTo, originOf } = await import('./rows.tsx')
const W = await import('./words.ts')

const real = globalThis.fetch
const sent: Record<string, unknown>[] = []
const answer = (body: unknown, status = 200) => {
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body))
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}
afterEach(() => {
  globalThis.fetch = real
  sent.length = 0
  clearToasts()
})
afterAll(clearToasts)

const NOW = Date.now()
const page = (s: Snapshot) => renderToStaticMarkup(<FeedbackPage now={NOW} snap={s} at={s.everything} />)

test('sections: Found and Filed open with their counts, Not now and Said no folded with theirs', () => {
  const html = page(snapshot())
  const heads = [...html.matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  expect(heads).toEqual(['Found 3', 'Filed 1', 'Not now 2', 'Said no 1'])
  // the folds are closed disclosure buttons: their rows aren't drawn until opened
  expect(html.match(/aria-expanded="false"/g)?.length).toBe(2)
  expect(html).not.toContain('The terminal pane scrolls')
  expect(html).toContain('The reply bubble')
  // a row: the problem, its fix (or none yet), one quiet line, one primary button
  expect(html).toContain('Fix:</span> Show the first line of the message it answers above it')
  expect(html).toContain(W.W.noFix)
  expect(html).toContain('From the task “Sticker book” · 2\u00a0h ago · 3\u00a0reports')
  expect(html.match(/class="btn pri s/g)?.length).toBe(2 + 1) // two Write it up, and the box's Send
  // Filed: its state, and the issue on GitHub in a new tab
  expect(html).toContain('href="https://github.com/example/shepherdr/issues/12" target="_blank" rel="noreferrer"')
  // the box: where it comes from
  expect(html).toContain('From Everything')
})

test("offers off in a row's origin: it says so and offers only Never; off everywhere links the setting", () => {
  const html = page(snapshot())
  const row = html.slice(html.indexOf('Scheduled tasks start twice'), html.indexOf('</li>', html.indexOf('Scheduled tasks start twice')))
  expect(row).toContain('Feedback offers are off in')
  expect(row).toContain('>Never<')
  expect(row).not.toContain(W.W.writeUp)
  expect(row).not.toContain(W.W.notNow)
  expect(html).not.toContain(W.W.offAll)
  const off = page({ ...snapshot(), feedback: { ...demoList, off: true } })
  expect(off).toContain(W.W.offAll)
  expect(off).toContain('>Open Settings<')
})

test('empty: nothing found, and where problems come from', () => {
  const html = page(snapshot('empty'))
  expect(html).toContain('Nothing found')
  expect(html).toContain('When something in Shepherdr doesn&#x27;t work as it should, your agents note it here.')
  expect(html).not.toContain('<h2')
  // no list read yet: the same, never a blank page
  expect(page({ ...snapshot(), feedback: undefined })).toContain('Nothing found')
})

test("Not now's menu: Tomorrow, Next week, When it happens again; each is the person's call", async () => {
  expect(W.LATER.map((x) => x.label)).toEqual(['Tomorrow', 'Next week', 'When it happens again'])
  const r = demoList.rows[0]
  answer({ ok: true, key: r.id, changed: true })
  expect(await decide(r, 'later', 'week')).toBe(true)
  expect(sent).toEqual([{ type: 'feedback', do: 'later', key: r.id, when: 'week' }])
  expect(toasts()[0].text).toBe('Not now: back next week')
  expect(toasts()[0].o.act?.label).toBe('Undo')
})

test('Undo in the toast puts it back; a no from the service is said, not swallowed', async () => {
  const r = demoList.rows[0]
  answer({ ok: true })
  await decide(r, 'no')
  expect(toasts()[0].text).toBe('Said no: it stays out of the way')
  toasts()[0].o.act!.run()
  await Bun.sleep(0)
  // the Undo names the decision it is for: one made since on another device is left alone
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'undo', key: r.id, expect: 'declined' })
  answer({ ok: false, error: 'Nothing to undo.' })
  clearToasts()
  expect(await decide(r, 'undo')).toBe(false)
  expect(toasts()[0]).toEqual({ text: 'Nothing to undo.', o: { tone: 'error', act: undefined } })
})

test('the box keeps its text when saving fails, and clears it only once kept', async () => {
  let text = 'The Send button hides behind the keyboard'
  const setText = (v: string) => void (text = v)
  answer('Shepherdr is restarting', 502)
  const failed = await saveBox(text, 'p:mac-mini:shop', setText)
  expect(failed.ok).toBe(false)
  expect(text).toBe('The Send button hides behind the keyboard')
  answer({ ok: false, off: true, error: 'off' })
  expect((await saveBox(text, 'p:mac-mini:shop', setText)).off).toBe(true)
  expect(text).toBe('The Send button hides behind the keyboard')
  answer({ ok: true, key: 'k1' })
  expect((await saveBox(text, 'p:mac-mini:shop', setText)).ok).toBe(true)
  expect(text).toBe('')
  // saved as the person's report, from the space open: nothing else is sent
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'report', text: 'The Send button hides behind the keyboard', space: 'mac-mini/shop' })
})

test("Write it up goes to the origin's chat; to Everything's when that space is gone or can't be reached", () => {
  const s = snapshot()
  expect(writeUpTo(s, { space: 'mac-mini/shop' })?.id).toBe('p:mac-mini:shop')
  expect(writeUpTo(s, { space: 'mac-mini/removed' })?.id).toBe(s.everything)
  expect(originOf(s, { space: 'mac-mini/removed' }).why).toBe('gone')
  const away = { ...s, places: s.places.map((p) => (p.id === 'p:vm:garden-app' ? { ...p, unreachableSince: '14:02' } : p)) }
  expect(writeUpTo(away, { space: 'vm/garden-app' })?.id).toBe(s.everything)
  // the service names a place by its space id ("sp1", "vm/sp2"), its chat "p:sp1": a row finds it by its chat
  const real = { ...s, places: [...s.places, { ...s.places[1], id: 'sp1', chat: 'p:sp1', archived: false }, { ...s.places[1], id: 'vm/sp2', chat: 'p:vm:sp2', archived: false }] } as typeof s
  expect(writeUpTo(real, { space: 'sp1' })?.id).toBe('sp1')
  expect(writeUpTo(real, { space: 'vm/sp2' })?.id).toBe('vm/sp2')
  // no chat runs in its space now: Everything's, and the row says so
  expect(writeUpTo(real, { space: 'sp1', noChat: true })?.id).toBe(s.everything)
  expect(originOf(real, { space: 'sp1', noChat: true }).why).toBe('asleep')
  expect(W.writeUpText('A mention resolved to eleven tasks')).toBe('Write up the feedback about “A mention resolved to eleven tasks”')
})

test('Not now says when it comes back', () => {
  const at = new Date(2026, 10, 27, 15).getTime()
  expect(W.backWords(null, at)).toBe('Comes back when it happens again')
  expect(W.backWords(at + 24 * 3600_000, at)).toBe('Comes back tomorrow')
  expect(W.backWords(at + 7 * 24 * 3600_000, at)).toBe('Comes back in 7 days')
  expect(W.backWords(at + 3600_000, at)).toBe('Comes back later today')
})

test('no words say "Assistant", "worker" or a key, and the page shows no key', () => {
  const words = [...Object.values(W.W), ...W.LATER.map((x) => x.label), W.offWords('#shop'), W.elsewhereWords('#shop', 'away'), W.elsewhereWords('', 'gone'),
    W.doneWords('later', 'tomorrow'), W.doneWords('later', 'week'), W.doneWords('later', 'again'), W.doneWords('no'), W.doneWords('undo'),
    W.fromWords({ from: { chat: true } }), W.fromWords({ from: { agent: true } }), W.fromWords({ from: { person: true } }), W.fromWords({}), W.filedWords({ state: 'filing' })]
  for (const w of words) expect(w).not.toMatch(/assistant|worker|--|\bkey\b/i)
  const html = page(snapshot())
  const text = html.replace(/<[^>]+>/g, ' ')
  expect(text).not.toMatch(/assistant|worker/i)
  for (const r of demoList.rows) expect(text).not.toContain(r.id)
})

test("the plugin off: the list's row is upstream's old box again", async () => {
  const list = readFileSync(join(import.meta.dir, '../../src/list.tsx'), 'utf8')
  expect(list).toContain('registry.views.feedbackRow ? <registry.views.feedbackRow /> : <Row icon="feedback" label="Feedback" onClick={() => { setUI({ drawer: false }); feedbackDialog() }} />')
  const reg = { views: {} as Record<string, unknown>, middle: [] as { when: (ui: never) => boolean }[] }
  const plugin = (await import('./client.tsx')).default
  plugin.setup(reg as never)
  expect(typeof reg.views.feedbackRow).toBe('function')
  expect(reg.middle[0].when({ page: 'feedback' } as never)).toBe(true)
  expect(reg.middle[0].when({ page: null } as never)).toBe(false)
  const plugins = JSON.parse(readFileSync(join(import.meta.dir, '../../plugins.json'), 'utf8')).plugins
  expect(plugins).toContain('feedback')
})

test('motion: a leaving row folds in 150 ms, and not at all under reduced motion', () => {
  const css = readFileSync(join(import.meta.dir, 'feedback.css'), 'utf8')
  expect(css).toContain('grid-template-rows 150ms')
  expect(css).toContain('@media(prefers-reduced-motion:reduce){.fb-row,.fb-in{transition:none}}')
  expect(css).toContain(':root[data-motion="reduced"] .fb-row,:root[data-motion="reduced"] .fb-in{transition:none}')
})

test('pins: the kernel keeps the page in the address and as a step Back closes', () => {
  const k = readFileSync(join(import.meta.dir, '../../src/kernel.ts'), 'utf8')
  expect(k).toContain("if (s.page) q.set('page', s.page)")
  expect(k).toContain("'search', 'page']")
  const list: FeedbackList = demoList
  expect(list.found).toBe(list.rows.filter((r) => r.section === 'found').length)
})
