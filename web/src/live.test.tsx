import { afterEach, beforeEach, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { KEEP_MS, onSaid, resetSaid, saidLines, say } from './live.ts'
import { newlyFailed, type Outgoing } from './outbox.ts'
import { failedSendWords, filterCountWords, LOADING, offlineWords, staleWords, timeWords, TRY_AGAIN, UNREACHABLE } from './states.ts'
import { reset as resetToasts, toast } from './toasts.ts'
import { Empty, Failed, LiveRegion, Loading, Stale } from './ui.tsx'

// docs/design.md, Components: empty, loading, offline and try-again each said in their own words, one layout for all;
// what changes on its own reaches screen readers once, through one polite live region (UI 18).

beforeEach(() => (resetSaid(), resetToasts()))
afterEach(() => (resetSaid(), resetToasts()))

test('the live region is polite, and each thing said is one line in it, spoken once', () => {
  say('Copied')
  expect(saidLines().map((l) => l.text)).toEqual(['Copied'])
  const html = renderToStaticMarkup(<LiveRegion />)
  expect(html).toContain('aria-live="polite"')
  expect(html).not.toContain('role="alert"')
  expect(html.match(/<p>/g)?.length).toBe(1)
  // the same words said again later are a new line, so they are spoken again; blank words say nothing
  say('Copied')
  say('   ')
  expect(saidLines().length).toBe(2)
  expect(saidLines()[0]!.id).not.toBe(saidLines()[1]!.id)
})

test('lines said together are all kept, so each is spoken; each stays long enough for a screen reader to reach it', () => {
  // four sends failing in one pass: four lines, none pushed out before it reached the page
  for (const w of ['a', 'b', 'c', 'd']) say(w)
  expect(saidLines().map((l) => l.text)).toEqual(['a', 'b', 'c', 'd'])
  expect(renderToStaticMarkup(<LiveRegion />).match(/<p>/g)?.length).toBe(4)
  expect(KEEP_MS).toBeGreaterThanOrEqual(5000)
})

test('a toast is said once to screen readers, with its second line', () => {
  let heard = 0
  const off = onSaid(() => heard++)
  toast('Uploaded to src', { tone: 'ok' })
  toast("Couldn't merge", { tone: 'error', sub: 'A conflict in checkout.ts' })
  off()
  expect(saidLines().map((l) => l.text)).toEqual(['Uploaded to src', "Couldn't merge A conflict in checkout.ts"])
  expect(heard).toBe(2)
})

const out = (cid: string, state: Outgoing['state'], error?: string): Outgoing => ({ cid, chat: 'p:x', text: 'hi', state, error, at: 1 }) as Outgoing

test('a send that just failed is said once; one already failed, or loaded failed, is not said again', () => {
  const before = [out('a', 'sending'), out('b', 'failed', 'gone')]
  const after = [out('a', 'failed', 'Shepherdr refused it.'), out('b', 'failed', 'gone')]
  expect(newlyFailed(before, after).map((o) => o.cid)).toEqual(['a'])
  expect(newlyFailed(after, after)).toEqual([])
  expect(failedSendWords('Shepherdr refused it.')).toBe("Your message wasn't sent: Shepherdr refused it. Retry or remove it in the chat.")
  expect(failedSendWords()).toBe("Your message wasn't sent. Retry or remove it in the chat.")
})

test('loading, saved from before, offline and try again are said apart, in the same words everywhere', () => {
  const now = new Date(2026, 10, 28, 15, 0).getTime()
  const at = new Date(2026, 10, 28, 14, 2).getTime()
  expect(LOADING).toBe('Loading…')
  expect(TRY_AGAIN).toBe('Try again')
  expect(UNREACHABLE).toBe("Can't reach Shepherdr.")
  expect(timeWords(at, now)).toMatch(/2:02|14:02/)
  // a day before: its weekday too
  expect(timeWords(at - 86400_000, now)).not.toBe(timeWords(at, now))
  expect(staleWords(at, "Can't reach Shepherdr.", now)).toMatch(/^Can't reach Shepherdr\. Last updated (2:02|14:02)/)
  expect(offlineWords(at, false, now)).toMatch(/^Can't reach Shepherdr · last updated (2:02|14:02)/)
  expect(offlineWords(null)).toBe("Can't reach Shepherdr")
  expect(offlineWords(at, true, now)).toBe('Shepherdr is updating · back in a moment')
  expect(filterCountWords(0)).toBe('No tasks match')
  expect(filterCountWords(1)).toBe('1 task shown')
  expect(filterCountWords(4)).toBe('4 tasks shown')
})

test('one empty layout: what it is, one quiet line, the one thing to do', () => {
  const html = renderToStaticMarkup(<Empty title="No tasks yet" act={{ label: 'Go to the chat', run: () => {} }}>Ask in a chat to add one.</Empty>)
  expect(html).toBe('<div class="empty"><b>No tasks yet</b><span>Ask in a chat to add one.</span><button type="button" class="btn s ea">Go to the chat</button></div>')
  // loading says so in its own words, marked busy; a failed load names what, why, and Try again
  expect(renderToStaticMarkup(<Loading />)).toBe('<div class="empty load" aria-busy="true"><span>Loading…</span></div>')
  const failed = renderToStaticMarkup(<Failed title="Can't show this folder" why="The folder couldn't be read." again={() => {}} />)
  expect(failed).toContain('<b>Can&#x27;t show this folder</b><span>The folder couldn&#x27;t be read.</span>')
  expect(failed).toContain('>Try again</button>')
  // saved from before: what was shown stays, with when it came and Try again
  const stale = renderToStaticMarkup(<Stale at={Date.now()} why={UNREACHABLE} again={() => {}} />)
  expect(stale).toMatch(/^<p class="stale"><span>Can&#x27;t reach Shepherdr\. Last updated .+\.<\/span><button type="button" class="lk">Try again<\/button><\/p>$/)
})
