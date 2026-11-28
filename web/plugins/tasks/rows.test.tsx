import { expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot, Task } from '@shared/types.ts'
import { snapshot } from '../../demo/data.ts'
import { withAttention } from '@shared/attention.ts'

// fork UI 14 (fork/specs/ui-polish.md, slice 14): a task's row reads in one look. Its status, its name, one line of what
// it needs or just did, then where it works, quiet, with a machine only where it tells two apart; no model and no pull
// request on it (they are in the task's header). At most one shortcut, the one its state calls for, named with the task
// and first in its menu too.

// the formatted words need a browser (DOMPurify): here they are drawn as they are
mock.module('@plugins/chat/markdown.tsx', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t, withLinks: (t: string) => [t] }))
const { TaskRow, taskRows } = await import('./client.tsx')
const { cardOf, shortcutOf, shortcutRow, ShortcutBtn } = await import('./shortcut.tsx')
const { rowWhere } = await import('./where.tsx')
const { getState } = await import('@client/kernel.ts')

// the demo's day with what needs the person worked out, as the service sends it (web/demo/serve.ts)
const snap: Snapshot = withAttention(snapshot())
Object.assign(getState(), { snap })
const task = (id: string) => snap.tasks.find((t) => t.id === id)!
const text = (html: string) => html.replace(/<[^>]+>/g, '')
const row = (t: Task, tag = true) => renderToStaticMarkup(<TaskRow snap={snap} t={t} tag={tag} />)
// the row's button, what a screen reader reads as its name: everything inside it, with an image's label for its text
const unescape = (h: string) => h.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const nameOf = (html: string) => {
  const btn = html.match(/<button[^>]*class="row row2 tk[^"]*"[^>]*>([\s\S]*?)<\/button>/)![1]!
  // a status ring is an image: its label stands for its drawing (and its hidden time left)
  const img = /<span[^>]*role="img"[^>]*aria-label="([^"]*)"[^>]*><svg[\s\S]*?<\/svg>(?:<span[^>]*aria-hidden="true"[^>]*>[^<]*<\/span>)?<\/span>/g
  // what is hidden from a screen reader (the shortcut's invisible copy that sizes the time's place) is not read
  const hidden = /<span[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/span>/g
  return unescape(btn.replace(img, (_m, a: string) => ` ${a} `).replace(hidden, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

test('a row reads in one look: status, name, what it needs, where, when; no model', () => {
  const t = task('SHOP-14')
  const html = row(t)
  const name = nameOf(html)
  // read aloud in one pass: its status, its name, what it asks, where (its machine, as a shop is on vm too), when
  expect(name).toBe('Needs you, 35% done Switch payment provider Which provider, Stripe or Adyen? shop · mac-mini 2h')
  expect(name.indexOf('Switch payment provider')).toBeGreaterThan(0)
  // status first, then the name, then what it asks, then where it works
  expect(name.indexOf('Which provider, Stripe or Adyen?')).toBeGreaterThan(name.indexOf('Switch payment provider'))
  expect(name.indexOf('shop')).toBeGreaterThan(name.indexOf('Which provider'))
  // one line of what it needs, cut with … (rows.css), never a second or a model line
  expect(html.match(/class="l2 one"/g)?.length).toBe(1)
  expect(html).not.toContain('pick-summary')
  expect(html).not.toContain('pick-model')
  // the pull request is in the header, not on the row
  expect(text(row(task('SHOP-12')))).not.toContain('PR #212')
})

test('one shortcut per state: Reply for a question, Open PR for a review, nothing else', () => {
  const ask = shortcutOf(snap, task('SHOP-14'))!
  expect([ask.label, ask.name, ask.icon, ask.menu]).toEqual(['Reply', 'Reply to Switch payment provider', 'reply', 'Reply in its chat'])
  const ready = shortcutOf(snap, task('SHOP-12'))!
  expect([ready.label, ready.name, ready.icon, ready.menu]).toEqual(['Open PR', 'Open PR #212 for Faster product search', 'pr', 'Open PR #212'])
  // working, stopped, done or ready with no pull request: no shortcut
  expect(shortcutOf(snap, task('SHOP-22'))).toBeNull()
  expect(shortcutOf(snap, task('vm:ACME-3'))).toBeNull()
  const t12 = task('SHOP-12')
  expect(shortcutOf(snap, { ...t12, pr: undefined })).toBeNull()
  expect(shortcutOf(snap, { ...t12, merged: true })).toBeNull()
  expect(shortcutOf(snap, { ...t12, pr: { ...t12.pr!, closed: true } })).toBeNull()
  expect(shortcutOf(snap, { ...task('SHOP-14'), stopped: { by: 'error', why: 'gone' } })).toBeNull()
  // Reply follows the task's lead action, the one its row, its header and the red count go by: a working task whose
  // lead action is yours (a secret it asks for, a question from a card) gets it too; Shepherdr's own wait doesn't
  const lead = { id: 'need:x', owner: 'you' as const, kind: 'question' as const, what: 'Which key?', since: 1 }
  expect(shortcutOf(snap, { ...task('SHOP-22'), action: lead })?.label).toBe('Reply')
  expect(shortcutOf(snap, { ...task('SHOP-22'), action: { ...lead, owner: 'shepherdr' } })).toBeNull()
  expect(shortcutOf(snap, { ...task('SHOP-22'), action: { ...lead, kind: 'review' } })).toBeNull()
  // every row in the demo has at most one, and each named with its task
  for (const t of snap.tasks) {
    const html = row(t)
    const n = html.match(/class="[^"]*\btsc\b/g)?.length ?? 0
    expect(n).toBeLessThanOrEqual(1)
    if (n) expect(unescape(html)).toContain(`aria-label="${shortcutOf(snap, t)!.name}"`)
  }
})

test('the shortcut sits beside the row button, never inside it, and its name starts with what it shows', () => {
  const html = row(task('SHOP-12'))
  // Open PR goes to a page: a real link, so Cmd/Ctrl-click and a middle click work (GitHub's own rows link it)
  expect(html).toMatch(/<\/button><a class="btn s tsc[^"]*" href="https:\/\/github.com\/example\/shop\/pull\/212" target="_blank" rel="noopener noreferrer" aria-label="Open PR #212 for Faster product search">/)
  const btn = renderToStaticMarkup(<ShortcutBtn sc={shortcutOf(snap, task('SHOP-14'))!} />)
  expect(text(btn)).toBe('Reply')
  expect(btn).toContain('aria-label="Reply to Switch payment provider"')
})

test('the same shortcut is first in the row\'s menu (touch has the menu), not in an open task\'s own', () => {
  expect(taskRows(task('SHOP-12'), 'row')![0]!.label).toBe('Open PR #212')
  expect(taskRows(task('SHOP-14'), 'row')![0]!.label).toBe('Reply in its chat')
  expect(taskRows(task('SHOP-12'), 'thread')!.some((r) => r.label === 'Open PR #212')).toBe(false)
  expect(shortcutRow(snap, task('SHOP-22'))).toEqual([])
})

test('Open PR opens the pull request in a new tab; Reply opens the task at its question', () => {
  const opened: unknown[][] = []
  const was = globalThis.window
  ;(globalThis as { window: unknown }).window = { ...(was ?? {}), open: (...a: unknown[]) => void opened.push(a) }
  try {
    shortcutOf(snap, task('SHOP-12'))!.run()
  } finally {
    ;(globalThis as { window: unknown }).window = was
  }
  expect(opened).toEqual([['https://github.com/example/shop/pull/212', '_blank', 'noopener,noreferrer']])
})

test('Reply opens the card of the action as it is when pressed: none once it was answered', () => {
  const id = task('SHOP-14').action!.id
  expect(cardOf(id)).toBe(snap.attention!.actions.find((a) => a.id === id)!.card)
  Object.assign(getState(), { snap: { ...snap, attention: { ...snap.attention!, actions: snap.attention!.actions.filter((a) => a.id !== id) } } })
  try {
    expect(cardOf(id)).toBeNull()
  } finally {
    Object.assign(getState(), { snap })
  }
})

test('the shortcut has its own slot: the time\'s place takes its size while it shows, so it never covers the name', () => {
  const html = row(task('SHOP-12'))
  expect(html).toMatch(/<span class="v vsc"><span class="vw">[^<]+<\/span><span class="btn s vsz" aria-hidden="true"><svg[^>]*>[\s\S]*?<\/svg>Open PR<\/span><\/span><\/button>/)
  // no shortcut: the time as before
  expect(shortcutOf(snap, task('BLOG-10'))).toBeNull()
  expect(row(task('BLOG-10'))).toMatch(/<span class="v">[^<]+<\/span><\/button>/)
  const css = readFileSync(new URL('./rows.css', import.meta.url), 'utf8')
  expect(css).toContain('.row.tk>.v.vsc>.vsz{display:none;visibility:hidden;height:0;overflow:hidden}')
  // on touch the time never hides for a shortcut that isn't there
  expect(css).not.toMatch(/(^|\n)\s*\.rowx[^{]*>\.row>\.v\{visibility:hidden\}/)
  expect(css).toContain('.app:not(.tap) .rowx:has(:focus-visible)>.row>.v.vsc>.vw{visibility:hidden}')
})

test('two projects or spaces with one name keep their machine; a name on one machine has none', () => {
  // the demo has a shop on mac-mini and one on vm
  const mac = task('SHOP-12')
  expect(rowWhere(snap, mac)).toEqual({ name: 'shop', machine: 'mac-mini', from: '' })
  expect(rowWhere(snap, task('vm:ACME-3')).machine).toBe('vm')
  // team-handbook is only on mac-mini; it came from #shop, and there is a #shop on vm too
  expect(rowWhere(snap, task('SHOP-22'))).toEqual({ name: 'team-handbook', machine: '', from: '#shop on mac-mini' })
  // one machine: nothing to tell apart
  const one: Snapshot = { ...snap, machines: [snap.machines[0]!] }
  expect(rowWhere(one, mac)).toEqual({ name: 'shop', machine: '', from: '' })
  expect(rowWhere(one, task('SHOP-22')).from).toBe('#shop')
  // on the row it reads the same
  expect(text(row(mac))).toContain('shop· mac-mini')
  expect(text(row(task('SHOP-22')))).toContain('team-handbook· from #shop on mac-mini')
})

test('the shortcut shows only with a mouse (hover) or the keyboard, hidden on touch, and nothing moves', () => {
  const css = readFileSync(new URL('./rows.css', import.meta.url), 'utf8')
  expect(css).toContain('.rowx:has(:focus-visible)>.tsc{opacity:1;pointer-events:auto}')
  expect(css).toMatch(/@media\(hover:hover\)\{\s*\.rowx:hover>\.tsc\{opacity:1;pointer-events:auto\}/)
  expect(css).toContain('.app.tap .rowx>.tsc{display:none}')
  expect(css).not.toMatch(/transition|animation/)
})

test('the header keeps its status whole: the pull request and the model give way first, never as a stray …', () => {
  const css = readFileSync(new URL('./rows.css', import.meta.url), 'utf8')
  expect(css).toContain('.t2>.hline>.hst{flex:0 1 auto;min-width:0}')
  expect(css).toMatch(/\.t2>\.hline>\.hmore\{flex:0 1000000 auto;min-width:0;[^}]*flex-wrap:wrap;[^}]*height:var\(--secl\);overflow:hidden\}/)
  expect(css).toContain('.t2>.hline>.hmore::before{content:"";flex:none;width:0;height:var(--secl)}')
})
