// The Feedback page's shape and check (friction loop, slice 3, #94): a row shows its fix and what a check on GitHub
// found (fixed or declined before, Shepherdr's makers have it, a newer version, GitHub not reachable), each match with
// Follow this one; Follow sends only the person's call and offers Undo; a followed row is under Filed. The demo's
// fictional day is the snapshot; the service is a stubbed fetch.
import { afterAll, afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeedbackRow, Snapshot } from '@shared/types.ts'
import { feedback as demoList, snapshot } from '../../demo/data.ts'

const T = await import('@client/toasts.ts')
const toasts = () => T.toasts().map((t) => ({ text: t.text, act: t.act }))
const clearToasts = () => T.toasts().forEach((t) => T.dismiss(t.id))
const { FeedbackPage, follow } = await import('./rows.tsx')
const W = await import('./words.ts')

const real = globalThis.fetch
const sent: Record<string, unknown>[] = []
const answer = (body: unknown) => {
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify(body))
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
const text = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
/** one row's markup: from its <li class="fb-row"> to the next */
const rowOf = (html: string, line: string) => html.split('<li class="fb-row').find((x) => x.includes(line)) ?? ''
const shaped = demoList.rows.find((r) => r.id === 'a1f0c2')!

test('a shaped row: its fix, fixed before, Shepherdr’s makers have it, a newer version, each match with Follow', () => {
  const html = page(snapshot())
  const row = rowOf(html, 'The reply bubble')
  expect(row).toContain('Fix:</span> Show the first line of the message it answers above it')
  expect(text(row)).toContain('Fixed before: “Reply bubble loses the message it answers”')
  expect(text(row)).toContain('Shepherdr’s makers have it: “Show which message a reply answers” (open)')
  expect(text(row)).toContain('A newer version is out (3.2.23; you have 3.2.22)')
  // each title opens its issue on GitHub in a new tab
  expect(row).toContain('href="https://github.com/example/shepherdr/issues/31" target="_blank" rel="noreferrer"')
  // Follow this one, once per match, a secondary button named with its issue; Write it up stays the one primary
  expect(row.match(/>Follow this one</g)?.length).toBe(2)
  expect(row).toContain('aria-label="Follow this one: Reply bubble loses the message it answers"')
  expect(row.match(/class="btn pri s/g)?.length).toBe(1)
  expect(row).toContain('aria-label="What a check on GitHub found"')
})

test("GitHub not reachable since: the last check stays, and the row says so", () => {
  const row = text(rowOf(page(snapshot()), 'Needs you showed a task'))
  expect(row).toContain('Declined before: “Needs you lists finished tasks”')
  expect(row).toContain(W.W.unreachable)
  expect(row).toContain(W.W.noFix)
})

test("no check yet, or offers off in its origin: nothing about GitHub on the row", () => {
  const html = page(snapshot())
  expect(rowOf(html, 'Scheduled tasks start twice')).not.toContain('fb-check')
  const bare: FeedbackRow = { ...shaped, check: undefined }
  const html2 = page({ ...snapshot(), feedback: { ...demoList, rows: [bare] } })
  expect(html2).not.toContain('fb-check')
  expect(html2).not.toContain(W.W.follow)
  const off: FeedbackRow = { ...shaped, off: true }
  expect(page({ ...snapshot(), feedback: { ...demoList, rows: [off] } })).not.toContain(W.W.follow)
})

test('what each match says, by its state and close reason, and whose repo it is in', () => {
  expect(W.matchWords({ state: 'open' })).toEqual({ lead: 'Maybe the same', open: true })
  expect(W.matchWords({ state: 'closed', reason: 'completed' }).lead).toBe('Fixed before')
  expect(W.matchWords({ state: 'closed', reason: 'not_planned' }).lead).toBe('Declined before')
  expect(W.matchWords({ state: 'closed', reason: 'duplicate' }).lead).toBe('Closed as a duplicate')
  expect(W.matchWords({ state: 'closed' }).lead).toBe('Closed before')
  expect(W.matchWords({ state: 'open', makers: true }).lead).toBe('Shepherdr’s makers have it')
  expect(W.matchWords({ state: 'closed', reason: 'completed', makers: true }).lead).toBe('Shepherdr’s makers fixed it before')
  expect(W.matchWords({ state: 'closed', reason: 'not_planned', makers: true }).lead).toBe('Shepherdr’s makers declined it before')
})

test('a newer version only when it is newer, compared as numbers', () => {
  expect(W.newerWords('3.2.10', '3.2.9')).toBe('A newer version is out (3.2.10; you have 3.2.9)')
  expect(W.newerWords('3.2.22', '3.2.22')).toBeNull()
  expect(W.newerWords('3.2.21', '3.2.22')).toBeNull()
  expect(W.newerWords('3.2.23', undefined)).toBeNull()
  expect(W.newerWords(undefined, '3.2.22')).toBeNull()
})

test('Follow this one sends only the call, and its toast offers Undo for exactly that', async () => {
  const m = shaped.check!.matches[0]
  answer({ ok: true, key: shaped.id, changed: true })
  expect(await follow(shaped, m)).toBe(true)
  expect(sent).toEqual([{ type: 'feedback', do: 'follow', key: shaped.id, url: m.url }])
  expect(toasts()[0].text).toBe('Following “Reply bubble loses the message it answers”')
  expect(toasts()[0].act?.label).toBe('Undo')
  toasts()[0].act!.run()
  await Bun.sleep(0)
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'undo', key: shaped.id, expect: 'following' })
  // a no from the service is said
  clearToasts()
  answer({ ok: false, error: 'That was already decided: the list shows it as it is now.' })
  expect(await follow(shaped, m)).toBe(false)
  expect(toasts()[0].text).toBe('That was already decided: the list shows it as it is now.')
})

test('a followed row is under Filed: what it follows, and On GitHub', () => {
  const html = page(snapshot())
  const row = rowOf(html, 'Search in the task list misses')
  expect(text(row)).toContain('Following “Task search covers linked machines”')
  expect(row).toContain('href="https://github.com/example/shepherdr/issues/19"')
  expect(row).not.toContain(W.W.follow)
})

test('no words say "Assistant", "worker" or a key', () => {
  const words = [W.W.follow, W.W.unreachable, W.W.checkLabel, W.followingWords('x'), W.newerWords('3.2.23', '3.2.22')!,
    ...(['open', 'completed', 'not_planned', 'duplicate', undefined] as const).flatMap((reason) =>
      [false, true].map((makers) => W.matchWords({ state: reason === 'open' ? 'open' : 'closed', ...(reason && reason !== 'open' ? { reason } : {}), ...(makers ? { makers } : {}) } as never).lead))]
  for (const w of words) expect(w).not.toMatch(/assistant|worker|--|\bkey\b/i)
})
