import { afterEach, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'
import { withAttention } from '@shared/attention.ts'

// fork #185 (Tasks: swipe actions on a phone, a pilot): a slide to the left on a task's row shows one or two of its
// menu's safe actions, each tapped to act, Archive at the edge the only one a full slide does, because it has Undo.

mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const { TaskRow, taskRows } = await import('./client.tsx')
const { archiveTask, swipeActs, UNDO_MS } = await import('./swipe.tsx')
const { getState, registry } = await import('@client/kernel.ts')
const { toasts, dismiss, lasts } = await import('@client/toasts.ts')
const { tstate } = await import('@shared/view.ts')

const snap: Snapshot = withAttention(snapshot())
Object.assign(getState(), { snap })
// the diff plugin's row on a task with a folder (web/plugins/diff/client.tsx), as it registers it
registry.taskMenu.push({ order: 30, rows: (t) => (t.work ? [{ icon: 'branch', label: 'Changes', run: () => {} }] : []) })
const find = (f: (t: Task) => boolean) => snap.tasks.find(f)!
const labels = (t: Task) => swipeActs(snap, t).map((a) => a.label)

test('a review with a pull request: Open PR, then Archive at the edge, the full slide’s', () => {
  const t = find((t) => tstate(t) === 'ready' && !!t.pr && !t.pr.closed && !t.merged)
  const acts = swipeActs(snap, t)
  expect(acts.map((a) => a.label)).toEqual(['Open PR', 'Archive'])
  expect(acts.filter((a) => a.full).map((a) => a.key)).toEqual(['archive'])
  expect(acts.at(-1)!.doing).toBe('Archiving…')
  // each is named with the task, so a screen reader tells the rows' buttons apart
  for (const a of acts) expect(a.name).toContain(t.name)
})

test('a task that asks you: Reply, then Archive; a working one: no Archive (herdr-task refuses it), its Changes instead', () => {
  const ask = find((t) => t.action?.owner === 'you' && t.action.kind !== 'review' && !t.stopped && tstate(t) === 'ask')
  expect(labels(ask)[0]).toBe('Reply')
  const working = find((t) => tstate(t) === 'working' && !!t.work && !(t.action?.owner === 'you'))
  expect(labels(working)).toEqual(['Changes'])
  expect(swipeActs(snap, working).some((a) => a.full)).toBe(false)
})

test('a done task: its Changes and Archive; an archived one: nothing to archive', () => {
  const done = find((t) => tstate(t) === 'done' && !t.archived && !!t.work)
  expect(labels(done)).toEqual(['Changes', 'Archive'])
  const archived = find((t) => !!t.archived)
  expect(labels(archived)).not.toContain('Archive')
})

test('at most two, every one also in the row’s menu, and never merge, stop, allow or delete', () => {
  for (const t of snap.tasks) {
    const acts = swipeActs(snap, t)
    expect(acts.length).toBeLessThanOrEqual(2)
    const menu = (taskRows(t, 'row') ?? []).map((r) => r.label)
    for (const a of acts) {
      // the menu says the shortcut in its own words (Open PR #12, Reply in its chat)
      const inMenu = menu.some((m) => m === a.label || m.startsWith(a.label) || (a.label === 'Reply' && m === 'Reply in its chat'))
      expect(inMenu ? a.label : `${a.label} missing from ${t.id}'s menu`).toBe(a.label)
      expect(a.label).not.toMatch(/merge|stop|allow|delete|accept/i)
    }
  }
})

test('the row takes the slide and draws no actions until slid; one that can’t be reached has none', () => {
  const t = find((t) => tstate(t) === 'done' && !t.archived && !!t.work)
  const html = renderToStaticMarkup(<TaskRow snap={snap} t={t} tag />)
  expect(html).toContain('data-slide=""')
  expect(html).not.toContain('class="sla')
  // the diff plugin's row is the one called Changes (the seam the swipe stands on)
  expect(readFileSync(new URL('../diff/client.tsx', import.meta.url), 'utf8')).toContain("label: 'Changes', run: () => openDiff(t.id)")
})

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  for (const t of toasts()) dismiss(t.id)
})
/** the service, answering `answer` and keeping what was asked */
function service(answer: (a: Record<string, unknown>) => object) {
  const asked: Record<string, unknown>[] = []
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const a = JSON.parse(String(init.body))
    asked.push(a)
    return new Response(JSON.stringify(answer(a)), { status: 200 })
  }) as typeof fetch
  return asked
}

test('Archive offers Undo for at least 5 seconds, and Undo brings it back', async () => {
  const t = find((t) => tstate(t) === 'done' && !t.archived)
  const asked = service(() => ({ ok: true }))
  expect(await archiveTask(t, { quiet: true })).toBe(true)
  expect(asked.at(-1)).toMatchObject({ type: 'archive', on: true })
  const shown = toasts().find((x) => x.text === `Archived “${t.name}”`)!
  expect(shown.act?.label).toBe('Undo')
  expect(lasts(shown.text, 'ok', UNDO_MS)).toBeGreaterThanOrEqual(5000)
  shown.act!.run()
  await new Promise((r) => setTimeout(r, 0))
  expect(asked.at(-1)).toMatchObject({ type: 'archive', on: false })
})

test('a failed Archive says why and offers no Undo; the row springs back on false', async () => {
  const t = find((t) => tstate(t) === 'done' && !t.archived)
  service(() => ({ ok: false, error: 'Can’t reach the machine.' }))
  expect(await archiveTask(t, { quiet: true })).toBe(false)
  expect(toasts().some((x) => x.text.startsWith('Archived'))).toBe(false)
  expect(toasts().find((x) => x.tone === 'error')?.text).toBe('Can’t reach the machine.')
})
