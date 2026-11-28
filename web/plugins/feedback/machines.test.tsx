// Every linked machine's problems on the Feedback page (friction loop, slice 8, #94): each row names its machine on its
// meta line, one id on two machines is two rows, a call on a row goes to its machine, and a machine out of reach, on an
// older Shepherdr or without one is said as it is, its rows shown with no buttons. The demo's `?case=machines` day is
// the snapshot; the service is a stubbed fetch.
import { afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { feedbackMachines, snapshot } from '../../demo/data.ts'

const T = await import('@client/toasts.ts')
const { FeedbackPage, decide, follow, rowKey, whose } = await import('./rows.tsx')
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

test("an unreachable machine's rows show as of their last read, with their buttons off", () => {
  const html = page(snapshot('machines'))
  const row = rowOf(html, 'A schedule run shows no news when the machine was asleep')
  expect(row).toContain('on pi')
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

test('the words name no agent role and no key', () => {
  const words = [W.lockWords('stale', 'studio', NOW - 60_000, NOW), W.lockWords('stale', 'studio', undefined, NOW), W.lockWords('old', 'studio', NOW, NOW),
    ...(['stale', 'old', 'none'] as const).map((state) => W.machineWords({ name: 'studio', state, at: NOW }, 'studio', NOW))]
  for (const w of words) expect(w).not.toMatch(/Assistant|worker|herdr-task|--/)
})
