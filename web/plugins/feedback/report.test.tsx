// Report from a failed action (friction loop, slice 7, #94): a failed action's error notice has Report with the
// feedback plugin on and none with it off; Report opens the Feedback page's box holding the action's label and
// "didn't work", never the error's text; nothing is sent until Send; what is sent is a report from that action. The
// demo's fictional day is the snapshot; the service is a stubbed fetch. Made-up names only.
import { afterAll, afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'

const T = await import('@client/toasts.ts')
const clearToasts = () => T.toasts().forEach((t) => T.dismiss(t.id))
const K = await import('@client/kernel.ts')
const { FeedbackPage, clearBox, saveBox } = await import('./rows.tsx')
const R = await import('./report.ts')
const plugin = (await import('./client.tsx')).default

const real = globalThis.fetch
const sent: Record<string, unknown>[] = []
const answers: unknown[] = []
const stub = () => {
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify(answers.shift() ?? { ok: true }), { status: 200 })
  }) as unknown as typeof fetch
}
const was = K.registry.failAct
afterEach(() => {
  globalThis.fetch = real
  sent.length = 0
  answers.length = 0
  clearToasts()
  K.registry.failAct = was
  K.setUI({ page: null })
  clearBox()
})
afterAll(clearToasts)

// an error whose words hold what must never reach a report: a path, a project's name, a host
const ERROR = 'Merge failed in /home/sam/clients/acme/shop on build-box-7: conflict in checkout.ts'
const NOW = Date.now()
const page = (s: Snapshot) => renderToStaticMarkup(<FeedbackPage now={NOW} snap={s} at={s.everything} />)
const fails = async (a: { type: string } & Record<string, unknown>) => {
  stub()
  answers.push({ ok: false, error: ERROR })
  expect(await K.tryAct(a)).toBe(false)
  return T.toasts().at(-1)!
}

test('with the plugin off, a failed action says its error and has no Report', async () => {
  K.registry.failAct = null
  const t = await fails({ type: 'accept', task: 'SHOP-12' })
  expect(t.text).toBe(ERROR)
  expect(t.tone).toBe('error')
  expect(t.act).toBeUndefined()
})

test('with the plugin on, the same error has Report; an action not on the list keeps its plain notice', async () => {
  plugin.setup(K.registry)
  expect(K.registry.failAct).toBe(R.reportAct)
  const t = await fails({ type: 'accept', task: 'SHOP-12' })
  expect(t.text).toBe(ERROR)
  expect(t.act?.label).toBe('Report')
  expect((await fails({ type: 'made-up-action' })).act).toBeUndefined()
})

test("Report opens the Feedback page, its box holding the action's label and didn't work, and no error text", async () => {
  plugin.setup(K.registry)
  const s = snapshot()
  K.getState().snap = s
  K.setUI({ at: s.everything })
  const t = await fails({ type: 'accept', task: 'SHOP-12' })
  sent.length = 0
  t.act!.run()
  expect(K.getState().ui.page).toBe('feedback')
  const html = page(s)
  const box = html.slice(html.indexOf('<textarea'), html.indexOf('</textarea>'))
  expect(box).toContain('>Mark as done didn&#x27;t work')
  for (const bit of ['/home', 'sam', 'acme', 'build-box', 'checkout', 'conflict', 'Merge failed']) expect(html).not.toContain(bit)
  // the space it acted in (the task's), and which action, under the box
  const shop = s.places.find((p) => p.id === s.tasks.find((x) => x.id === 'SHOP-12')!.place)!
  expect(html).toContain(`“Mark as done” · From #${shop.name}`)
  // nothing is sent until Send
  expect(sent).toEqual([])
})

test("Send keeps it as a report from that action, in that space's name, and nothing else", async () => {
  stub()
  const s = snapshot()
  const shop = s.places.find((p) => p.name === 'shop' && p.machine === 'mac-mini')!
  let left = 'x'
  expect((await saveBox("Mark as done didn't work, twice", shop.chat, (v) => (left = v), 'Mark as done')).ok).toBe(true)
  expect(sent).toEqual([{ type: 'feedback', do: 'report', text: "Mark as done didn't work, twice", space: 'mac-mini/shop', action: 'Mark as done' }])
  expect(left).toBe('')
  // the box's own report says no action
  sent.length = 0
  await saveBox('Something else', shop.chat, () => {})
  expect(sent[0]).not.toHaveProperty('action')
})

test("an unsent draft of the person's own stays, under the action's line; an earlier Report's words give way", async () => {
  const { boxWith, prefillBox } = await import('./rows.tsx')
  expect(boxWith('', undefined, "Start didn't work")).toBe("Start didn't work")
  expect(boxWith('  The search is slow ', undefined, "Start didn't work")).toBe("Start didn't work\n\nThe search is slow")
  expect(boxWith("Start didn't work", "Start didn't work", "Send didn't work")).toBe("Send didn't work")
  expect(boxWith("Start didn't work, twice", "Start didn't work", "Send didn't work")).toBe("Send didn't work\n\nStart didn't work, twice")
  // on the page: the second Report's words, alone
  const s = snapshot()
  const box = () => { const h = page(s); return h.slice(h.indexOf('<textarea'), h.indexOf('</textarea>')) }
  prefillBox(R.prefillOf('Start'), 'Start', s.everything!)
  prefillBox(R.prefillOf('Send'), 'Send', s.everything!)
  expect(box().endsWith(">Send didn&#x27;t work")).toBe(true)
})

test('the space it acted in: its place, its chat, its task; else the space on screen', () => {
  const s = snapshot()
  const shop = s.places.find((p) => p.name === 'shop' && p.machine === 'mac-mini')!
  const task = s.tasks.find((t) => t.place === shop.id)!
  expect(R.placeOf({ type: 'config', place: shop.id }, s, 'elsewhere')).toBe(shop.id)
  expect(R.placeOf({ type: 'stop', chat: shop.chat }, s, 'elsewhere')).toBe(shop.id)
  expect(R.placeOf({ type: 'accept', task: task.id }, s, 'elsewhere')).toBe(shop.id)
  expect(R.placeOf({ type: 'stop', chat: `${task.id}/worker` }, s, 'elsewhere')).toBe(shop.id)
  expect(R.placeOf({ type: 'config', place: 'all' }, s, 'elsewhere')).toBe('elsewhere')
})

test("every label is plain words herdr-task and the service take, and only an action's type picks it", () => {
  const WORDS = /^[A-Z][a-z]*(?: [a-z-]+){0,4}$/
  for (const label of Object.values(R.LABELS)) expect(label).toMatch(WORDS)
  expect(R.labelOf({ type: 'accept', label: 'Something else', error: ERROR })).toBe('Mark as done')
  expect(R.labelOf({ type: 'toString' })).toBeUndefined()
  // the service's and herdr-task's own checks are the same words
  expect(readFileSync(join(import.meta.dir, '../../../service/feedback.ts'), 'utf8')).toContain(`const ACTION = ${WORDS};`)
  expect(readFileSync(join(import.meta.dir, '../../../mods/tasks/bin/herdr_task/feedback_page.py'), 'utf8')).toContain(`re.compile(r"${WORDS.source.slice(1, -1)}")`)
})

// the seam this relies on (#94, slice 7): every action the app asks for through tryAct has a label here, so a new one
// upstream adds is named before its error notice can be reported
test('every action the app asks for through tryAct is on the list', () => {
  const root = join(import.meta.dir, '../..')
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { if (n !== 'generated' && n !== 'dist' && n !== 'node_modules') walk(p) }
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p)
    }
  }
  walk(join(root, 'src'))
  walk(join(root, 'plugins'))
  const types = new Set<string>()
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/tryAct\(\{\s*type:\s*'([a-z-]+)'/g)) types.add(m[1])
  expect(types.size).toBeGreaterThan(20)
  expect([...types].filter((t) => !R.labelOf({ type: t }))).toEqual([])
  // the hook itself: tryAct's error notice takes its button from the plugin
  expect(readFileSync(join(root, 'src/kernel.ts'), 'utf8')).toContain("notice(error, { tone: 'error', act: registry.failAct?.(a) })")
})
