// The Feedback page's File it… and Post it (friction loop, slice 4, #94): a row with a draft offers File it…; its sheet
// shows where it goes, the exact title and body and the settings note; Post it keeps the yes first and only then sends
// the person's message with its hidden line; each step of the post after the yes, from what herdr-task knows. The demo's
// `?case=post` day is the snapshot; the service is a stubbed fetch. Made-up names only.
import { afterAll, afterEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FeedbackRow, Snapshot } from '@shared/types.ts'
import { feedbackPost, snapshot } from '../../demo/data.ts'

const T = await import('@client/toasts.ts')
const clearToasts = () => T.toasts().forEach((t) => T.dismiss(t.id))
const { FeedbackPage } = await import('./rows.tsx')
const { DraftView, postIt } = await import('./confirm.tsx')
const W = await import('./words.ts')

const real = globalThis.fetch
const sent: Record<string, any>[] = []
const answers: unknown[] = []
const stub = () => {
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body))
    return new Response(JSON.stringify(answers.shift() ?? { ok: true }), { status: 200 })
  }) as unknown as typeof fetch
}
afterEach(() => { globalThis.fetch = real; sent.length = 0; answers.length = 0; clearToasts() })
afterAll(clearToasts)

const NOW = Date.now()
const snap = (): Snapshot => snapshot('post')
const page = (s: Snapshot) => renderToStaticMarkup(<FeedbackPage now={NOW} snap={s} at={s.everything} />)
const rowOf = (html: string, line: string) => html.slice(html.indexOf(line), html.indexOf('</div></div></li>', html.indexOf(line)))
const row = (id: string) => feedbackPost.rows.find((r) => r.id === id)! as FeedbackRow

test('a row with a draft offers File it… as its one primary button; one without still says Write it up', () => {
  const html = page(snap())
  const drafted = rowOf(html, 'The reply bubble')
  expect(drafted).toContain(`>${W.W.fileIt}<`)
  expect(drafted).toContain('aria-haspopup="dialog"')
  expect(drafted).not.toContain(W.W.writeUp)
  expect(rowOf(html, 'Needs you showed a task')).toContain(`>${W.W.writeUp}<`)
})

test('the sheet shows where it goes, then the exact title and body, the hidden-line note and the settings note', () => {
  const d = row('a1f0c2').draft!
  const html = renderToStaticMarkup(<DraftView d={d} note={feedbackPost.note} />)
  expect(html).toContain('A new issue in example/shepherdr')
  expect(html).toContain('>Reply bubble hides the message it answers<')
  expect(html).toContain('## What happened\n\nA reply in the chat shows only its own words')
  expect(html).not.toContain('shepherdr-feedback')
  expect(html).toContain(W.W.hiddenLine)
  expect(html.indexOf(W.W.hiddenLine)).toBeLessThan(html.indexOf('Posting it also starts a fix here'))
  expect(html).toContain('role="group"')
  // a comment names the issue and its repo whole: a fork's #12 and Shepherdr's #12 are told apart
  expect(W.whereWords({ repo: 'acme/shepherdr', action: 'comment', issue: 12, title: 'Replies lose their quote' })).toBe('A comment on “Replies lose their quote” (#12) in acme/shepherdr')
  expect(W.whereWords({ repo: 'eliasstravik/shepherdr', action: 'comment', issue: 12 })).toBe('A comment on issue #12 in eliasstravik/shepherdr')
})

test('Post it keeps the yes for that revision first, then sends the person’s message with its hidden line', async () => {
  stub()
  const r = row('a1f0c2')
  expect(await postIt(snap(), r, r.draft!)).toBe(true)
  expect(sent.map((b) => b.type)).toEqual(['feedback', 'send'])
  expect(sent[0]).toMatchObject({ do: 'approve', key: 'a1f0c2', rev: 2 })
  expect(sent[1]).toMatchObject({ text: 'Post the feedback about “The reply bubble doesn\'t show which message it answers”', human: true, feedback: { id: 'a1f0c2', rev: 2 } })
})

test('a yes the service refuses sends nothing, and says why', async () => {
  stub()
  answers.push({ ok: false, error: 'The draft changed since you opened it: open File it… again to see the new one.' })
  const r = row('a1f0c2')
  expect(await postIt(snap(), r, r.draft!)).toBe(false)
  expect(sent.map((b) => b.type)).toEqual(['feedback'])
  expect(T.toasts().at(-1)?.text).toContain('The draft changed')
})

test('each step after the yes: waiting offers Send again, refused Post it again, a post in doubt offers Check on GitHub and Check again', () => {
  const html = page(snap())
  const waiting = rowOf(html, 'Dictation stops')
  expect(waiting).toContain('Waiting to post: its chat posts it next')
  expect(waiting).toContain(`>${W.W.sendAgain}<`)
  const refused = rowOf(html, 'A task row forgets')
  expect(refused).toContain('Couldn&#x27;t post: gh is not signed in: run gh auth login. Your yes is kept')
  expect(refused).toContain(`>${W.W.postAgain}<`)
  const unsure = rowOf(html, 'The Tasks panel loses')
  expect(unsure).toContain('Couldn&#x27;t tell whether it was posted, so it won&#x27;t be posted again')
  expect(unsure).toContain('href="https://github.com/example/shepherdr/issues?q=is%3Aissue%20author%3A%40me"')
  expect(unsure).toContain(`>${W.W.checkAgain}<`)
  expect(unsure).not.toContain(W.W.sendAgain)
  expect(unsure).not.toContain(W.W.postIt)
  // a posting under way: no button at all; once posted: Filed with its link
  expect(W.postWords({ post: { state: 'posting', rev: 1 } })).toBe('Posting…')
  expect(W.postWords({ post: { state: 'posted', rev: 1 }, url: 'https://github.com/example/shepherdr/issues/40' })).toBeNull()
  expect(W.filedWords({ state: 'filed', post: { state: 'posted', rev: 1 }, url: 'https://github.com/example/shepherdr/issues/40' })).toBe('Filed')
})

test('the words never say Assistant, worker or a key', () => {
  const words = [...Object.values(W.W), W.postText('x'), W.postWords({ post: { state: 'refused', rev: 1, why: 'HTTP 403' } })!,
    W.postWords({ post: { state: 'unsure', rev: 1 } })!, W.postWords({ approved: 1 })!].join(' ')
  expect(words).not.toMatch(/\bAssistant\b|\bworker\b|--key/i)
})
