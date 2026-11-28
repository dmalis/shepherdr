// Every linked machine's problems on the Feedback page (friction loop, slice 8, #94): each row names its machine on its
// meta line, one id on two machines is two rows, a call on a row goes to its machine, and a machine out of reach, on an
// older Shepherdr or without one is said as it is, its rows shown with no buttons. The demo's `?case=machines` day is
// the snapshot; the service is a stubbed fetch.
import { afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { feedbackMachines, snapshot } from '../../demo/data.ts'

const T = await import('@client/toasts.ts')
const { FeedbackPage, decide, follow, rowKey, tried, whose, writeUpTo } = await import('./rows.tsx')
const { postIt } = await import('./confirm.tsx')
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
  T.toasts().forEach((t) => T.dismiss(t.id))
})

const NOW = Date.now()
const page = (s: Snapshot) => renderToStaticMarkup(<FeedbackPage now={NOW} snap={s} at={s.everything} />)
/** a row's own markup, from its line to the end of its item */
const rowOf = (html: string, line: string) => {
  const i = html.indexOf(line)
  return i < 0 ? '' : html.slice(i, html.indexOf('</li>', i))
}
const byId = (id: string, machine?: string) => feedbackMachines.rows.find((r) => r.id === id && r.machine === machine)!

test("another machine's rows name it on their meta line; one id on two machines is two rows", () => {
  const html = page(snapshot('machines'))
  expect(html.split("The reply bubble doesn&#x27;t show which message it answers").length - 1).toBe(2)
  expect(html).toContain('From the task “Site footer” · on studio · 40 min ago')
  // this machine's own row names no machine
  expect(html).toContain('From the task “Sticker book” · 2 h ago · 3 reports')
  // found counts both machines' rows
  expect(html).toMatch(/<h2[^>]*><span>Found<\/span><span[^>]*>6</)
  expect(rowKey(byId('a1f0c2', 'studio'))).not.toBe(rowKey(byId('a1f0c2')))
})

test('a call on a row goes to its machine; one on this machine names none', async () => {
  answer({ ok: true, key: 'a1f0c2', changed: true })
  expect(await decide(byId('a1f0c2', 'studio'), 'later', 'week')).toBe(true)
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'later', key: 'a1f0c2', machine: 'studio', when: 'week' })
  // its toast's Undo goes there too
  T.toasts()[0].act!.run()
  await Bun.sleep(0)
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'undo', key: 'a1f0c2', machine: 'studio', expect: 'later' })
  expect(await decide(byId('a1f0c2'), 'no')).toBe(true)
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'no', key: 'a1f0c2' })
  const m = feedbackMachines.rows[2].check!.matches[0]
  await follow({ ...byId('a1f0c2'), machine: 'studio' }, m)
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'follow', key: 'a1f0c2', machine: 'studio', url: m.url })
  expect(whose({ id: 'x1' })).toEqual({ key: 'x1' })
})

test("Write it up for another machine's row stays on that machine: its home space there, never this one's Everything", async () => {
  const s = snapshot('machines')
  const row = byId('a1f0c2', 'studio')
  // its space is open: it goes there
  expect(writeUpTo(s, row)?.chat).toBe('p:studio:site')
  // its space is gone: studio's home space, which reads studio's record
  const gone: Snapshot = { ...s, places: s.places.filter((p) => p.chat !== 'p:studio:site') }
  expect(writeUpTo(gone, row)?.chat).toBe('p:studio:home')
  expect(page(gone)).toContain('Its space is gone: Write it up goes to ~ on studio')
  // nothing open on studio: nowhere to send it, so Write it up is off and says why; this machine's rows still go to Everything
  const none: Snapshot = { ...gone, places: gone.places.filter((p) => p.machine !== 'studio') }
  expect(writeUpTo(none, row)).toBeUndefined()
  expect(writeUpTo(none, { ...row, machine: undefined })?.id).toBe(none.everything)
  const html = page(none)
  const i = html.indexOf('From the task “Site footer” · on studio')
  const mine = html.slice(i, html.indexOf('</li>', i))
  expect(mine).toContain('Its space is gone: Write it up waits for a space on studio to open')
  expect(mine).toMatch(/<button[^>]*disabled=""[^>]*>Write it up/)
  // Post it keeps no yes it can't send
  answer({ ok: true })
  expect(await postIt(none, { ...row, draft: { rev: 1, title: 't', body: 'b', target: 'example/shepherdr' } } as any, { rev: 1 } as any)).toBe(false)
  expect(sent).toEqual([])
})

test("an unreachable machine's rows show as of their last read, with their buttons off", () => {
  const html = page(snapshot('machines'))
  const row = rowOf(html, 'A schedule run shows no news when the machine was asleep')
  // its space's name already says its machine: said once
  expect(row).toMatch(/in ~ on pi · 1\s?h ago/u)
  expect(row).not.toContain('on pi · on pi')
  expect(row).toContain('pi can&#x27;t be reached: as it was 50 min ago')
  expect(row).not.toContain('<button')
  expect(html).toContain('pi can&#x27;t be reached: its problems show as they were 50 min ago')
})

test("an older machine's rows are read only, and say to update it", () => {
  const html = page(snapshot('machines'))
  const row = rowOf(html, 'Approving a merge on the phone needs two taps')
  expect(row).toContain('Update Shepherdr on vm to act on this here')
  expect(row).not.toContain('<button')
  expect(html).toContain('vm has an older Shepherdr: its problems show, and updating it lets you act on them here')
})

test("a machine without Shepherdr is said once, at the top; nothing more", () => {
  const html = page(snapshot('machines'))
  expect(html).toContain('Shepherdr isn&#x27;t set up on laptop, so its problems can&#x27;t show here')
  // a machine that's out of reach with no rows to show isn't named
  const quiet = page({ ...snapshot('machines'), feedback: { ...feedbackMachines, rows: feedbackMachines.rows.filter((r) => r.machine !== 'pi') } })
  expect(quiet).not.toContain('pi can&#x27;t be reached')
})

test("a fix's lines on another machine's row name that machine, and Works goes there (slices 6 and 8)", async () => {
  const ship = { ship: { release: '3.2.23', here: true as const }, tried: undefined }
  expect(W.shipWords(ship)!.text).toBe('Fixed in 3.2.23 · On this machine')
  expect(W.shipWords(ship, 'studio')!.text).toBe('Fixed in 3.2.23 · On studio')
  expect(W.shipWords({ ship: { release: '3.2.24', update: true } }, 'studio')!.text).toBe('Fixed in 3.2.24: update Shepherdr on studio to get it')
  answer({ ok: true, key: 'a1f0c2', changed: true })
  expect(await tried(byId('a1f0c2', 'studio'), 'works')).toBe(true)
  expect(sent.at(-1)).toEqual({ type: 'feedback', do: 'works', key: 'a1f0c2', machine: 'studio' })
})

test('the words name no agent role and no key', () => {
  const words = [W.lockWords('stale', 'studio', NOW - 60_000, NOW), W.lockWords('stale', 'studio', undefined, NOW), W.lockWords('old', 'studio', NOW, NOW),
    ...(['stale', 'old', 'none'] as const).map((state) => W.machineWords({ name: 'studio', state, at: NOW }, 'studio', NOW))]
  for (const w of words) expect(w).not.toMatch(/Assistant|worker|herdr-task|--/)
})
