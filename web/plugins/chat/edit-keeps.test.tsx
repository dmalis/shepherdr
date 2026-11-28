import { afterEach, beforeAll, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isValidElement, type ReactElement, type ReactNode } from 'react'

// Edits keep what you wrote (dmalis/shepherdr#186): a held suggestion goes in at the caret and keeps the draft, a
// folded paste is sent where it was pasted through later edits, "Replying to" hides with its suggestions, and a file
// dragged over the page shows where it goes. Fake data.

const { getDraft, getState, setDraft, setUI } = await import('@client/kernel.ts')
const { closeAll, layersNow } = await import('@client/overlay.tsx')
const { holdSuggestion, insertAt } = await import('./edit-keeps.tsx')
const { addPaste, dropPaste, getPastes, joined, setPastes, shifted } = await import('./fold.ts')
const { DRAG_GONE_MS, DRAG_LEFT_MS, watchFileDrag } = await import('./attach.tsx')

const root = join(import.meta.dir, '../../..')
const KEY = 'p:edits'

beforeAll(() => {
  // the caret is put back once React has written the words: at once here
  globalThis.requestAnimationFrame ??= ((f: FrameRequestCallback) => (f(0), 0)) as typeof requestAnimationFrame
})
afterEach(() => {
  setDraft(KEY, '')
  setPastes(KEY, () => [])
  setUI({ reply: {} })
  closeAll()
})

/** a message box with its caret (or selection) at `start`..`end` */
const box = (start: number, end = start) => {
  const b = { selectionStart: start, selectionEnd: end, focused: false, focus() { b.focused = true }, setSelectionRange(s: number, e: number) { b.selectionStart = s; b.selectionEnd = e } }
  return b
}
const asBox = (b: ReturnType<typeof box>) => b as unknown as HTMLTextAreaElement
const Q = { id: 'm9', who: 'agent' as const, text: 'Should I merge it?' }

/* ---------- a held suggestion ---------- */

test('a suggestion goes in at the caret, a space either side where it would touch a word, the caret after it', () => {
  expect(insertAt('Thanks. Also check the login', 7, 7, 'Merge it')).toEqual({ text: 'Thanks. Merge it Also check the login', caret: 16 })
  expect(insertAt('', 0, 0, 'Merge it')).toEqual({ text: 'Merge it', caret: 8 })
  expect(insertAt('Hi\n', 3, 3, 'Merge it')).toEqual({ text: 'Hi\nMerge it', caret: 11 })
  // a selection: only it is replaced
  expect(insertAt('Please do X now', 10, 11, 'the merge')).toEqual({ text: 'Please do the merge now', caret: 19 })
})

test('holding a suggestion keeps the draft: it goes in where the caret was put, and the box takes the caret after it', () => {
  setDraft(KEY, 'First this. Then that.')
  const b = box(11)
  holdSuggestion(KEY, 'Merge it', Q, asBox(b), true)
  expect(getDraft(KEY)).toBe('First this. Merge it Then that.')
  expect(b.focused).toBe(true)
  expect(b.selectionStart).toBe('First this. Merge it'.length)
  // what is selected, only that is replaced
  setDraft(KEY, 'Do X today')
  holdSuggestion(KEY, 'the merge', Q, asBox(box(3, 4)), true)
  expect(getDraft(KEY)).toBe('Do the merge today')
})

test('before the caret was ever put in the box, a held suggestion goes after the words', () => {
  setDraft(KEY, 'First this.')
  holdSuggestion(KEY, 'Merge it', Q, asBox(box(0)), false)
  expect(getDraft(KEY)).toBe('First this. Merge it')
})

test('a held suggestion goes as a reply to the message it answers, as a tapped one does', () => {
  holdSuggestion(KEY, 'Merge it', Q, asBox(box(0)), true)
  expect(getState().ui.reply[KEY]).toEqual(Q)
  expect(layersNow()).toHaveLength(0)
})

/** the words and click of each button a dialog draws */
function buttons(n: ReactNode, out: { label: string; click: () => void }[] = []) {
  if (Array.isArray(n)) n.forEach((c) => buttons(c, out))
  else if (isValidElement(n)) {
    const p = n.props as { onClick?: () => void; children?: ReactNode }
    if (p.onClick) out.push({ label: String(p.children), click: p.onClick })
    else buttons(p.children, out)
  }
  return out
}

test('a suggestion for another message than the box replies to asks first; both answers keep the draft and put it in', () => {
  const was = { id: 'm2', who: 'agent' as const, text: 'Which provider?' }
  for (const [answer, reply] of [['Switch the reply', Q], ['Keep my reply', was]] as const) {
    setDraft(KEY, 'Hm.')
    setUI({ reply: { [KEY]: was } })
    holdSuggestion(KEY, 'Merge it', Q, asBox(box(3)), true)
    // nothing changes before the answer
    expect(getDraft(KEY)).toBe('Hm.')
    const [dialog] = layersNow()
    expect(dialog!.kind).toBe('dialog')
    const drawn = dialog!.render(() => closeAll()) as ReactElement<{ children: ReactNode }>
    const html = JSON.stringify(drawn.props.children)
    expect(html).toContain('Which provider?')
    expect(html).toContain('Should I merge it?')
    const bs = buttons(drawn.props.children)
    expect(bs.map((x) => x.label)).toEqual(['Keep my reply', 'Switch the reply'])
    bs.find((x) => x.label === answer)!.click()
    expect(getDraft(KEY)).toBe('Hm. Merge it')
    expect(getState().ui.reply[KEY]).toEqual(reply)
    expect(layersNow()).toHaveLength(0)
  }
})

test('a suggestion for the message the box already replies to asks nothing', () => {
  setUI({ reply: { [KEY]: Q } })
  holdSuggestion(KEY, 'Merge it', Q, asBox(box(0)), true)
  expect(layersNow()).toHaveLength(0)
  expect(getDraft(KEY)).toBe('Merge it')
})

test('a bubble opens to edit from the keyboard: Shift+Enter, said to a screen reader', () => {
  const chat = readFileSync(join(root, 'web/plugins/chat/client.tsx'), 'utf8')
  const reply = chat.slice(chat.indexOf('function Reply('), chat.indexOf('/** what a chat runs on now'))
  expect(reply).toMatch(/if \(e\.key !== 'Enter' \|\| !e\.shiftKey\) return\s*e\.preventDefault\(\)\s*edit\.current\(text\)/)
  expect(reply).toContain('aria-keyshortcuts="Shift+Enter"')
  expect(chat).toContain('<span id={how} className="vh">Enter sends it. Shift+Enter puts it in the box to edit.</span>')
})

/* ---------- a folded paste keeps its place ---------- */

const LOG = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')

test('a paste in the middle is sent in the middle, after more typing before and after it', () => {
  setDraft(KEY, 'Why does this fail? It worked yesterday.')
  addPaste(KEY, LOG, 'Why does this fail?'.length)
  // typing before it, after it, and right where it sits (the caret is after a paste once it is pasted)
  setDraft(KEY, 'So, why does this fail? It worked yesterday.', 'So, w'.length)
  setDraft(KEY, 'So, why does this fail? It worked yesterday, on main.', 'So, why does this fail? It worked yesterday, on main'.length)
  setDraft(KEY, 'So, why does this fail? Here: It worked yesterday, on main.', 'So, why does this fail? Here:'.length)
  const text = getDraft(KEY)
  expect(joined(text, getPastes(KEY))).toBe(`So, why does this fail?\n\n${LOG}\n\nHere: It worked yesterday, on main.`)
})

test('deleting around a paste keeps it at its place; deleting what held its place puts it where that was', () => {
  setDraft(KEY, 'abc def')
  addPaste(KEY, LOG, 3)
  setDraft(KEY, 'ab def', 2)
  expect(getPastes(KEY)[0]!.at).toBe(2)
  setDraft(KEY, 'x', 1)
  expect(getPastes(KEY)[0]!.at).toBe(0)
  expect(joined(getDraft(KEY), getPastes(KEY))).toBe(`${LOG}\n\nx`)
})

test('repeated letters: the caret says on which side of a paste a letter went', () => {
  // "xbb" with the paste between the two b's; a b typed after the x
  expect(shifted(2, 'xbb', 'xbbb', 2)).toBe(3)
  // without the caret, the plain difference
  expect(shifted(2, 'xbb', 'xbbb')).toBe(2)
  // a caret that doesn't fit the edit is not used
  expect(shifted(2, 'xbb', 'xbbb', 0)).toBe(2)
})

test('pastes kept from before have no place: they go after the words, as they did', () => {
  expect(joined('Look', [{ text: LOG }, { text: 'x'.repeat(3000) }])).toBe(`Look\n\n${LOG}\n\n${'x'.repeat(3000)}`)
  // two at one place keep their order
  expect(joined('ab', [{ text: 'P1', at: 1 }, { text: 'P2', at: 1 }])).toBe('a\n\nP1\n\nP2\n\nb')
  // a place past the words (an edit while the box was away) is their end
  expect(joined('ab', [{ text: 'P', at: 9 }])).toBe('ab\n\nP')
})

test("a paste's Edit puts it back where it was pasted, a blank line around it as it is sent", () => {
  const chat = readFileSync(join(root, 'web/plugins/chat/client.tsx'), 'utf8')
  const edit = chat.slice(chat.indexOf('const editPaste = '), chat.indexOf('const drag = useFileDrag'))
  expect(edit).toContain('const at = Math.min(p.at ?? text.length, text.length)')
  expect(edit).toContain("setText(tail ? `${put}\\n\\n${tail}` : put)")
  expect(edit).toContain('box.setSelectionRange(put.length, put.length)')
  // a long paste folds where the caret is, over a selection
  expect(chat).toContain('addPaste(key, t, at)')
  // each typed letter says where the caret is
  expect(chat).toContain('if (!echo) setDraft(key, e.target.value, e.target.selectionEnd)')
  dropPaste(KEY, 'none')
})

/* ---------- "Replying to" and its suggestions together ---------- */

test('every rule that hides the suggested replies hides their "Replying to" line too', () => {
  const css: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name))
      else if (e.name.endsWith('.css')) css.push(readFileSync(join(d, e.name), 'utf8'))
    }
  }
  walk(join(root, 'web/src'))
  walk(join(root, 'web/plugins'))
  const hiding = css
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)
  let n = 0
  for (const [, sel, body] of hiding) {
    // the row itself, not its scrollbar
    if (!/\.sugs\b(?!::)/.test(sel!) || !/display:\s*none/.test(body!)) continue
    n++
    expect(sel).toMatch(/\.sugfor\b/)
  }
  expect(n).toBeGreaterThanOrEqual(2)
})

/* ---------- a file dragged over the page ---------- */

function dragOver(win: EventTarget, type: string, target: object, files = true, related: object | null = target) {
  const e = new Event(type, { cancelable: true })
  const dt = { types: files ? ['Files'] : ['text/plain'], dropEffect: 'copy' }
  Object.defineProperties(e, { dataTransfer: { value: dt }, relatedTarget: { value: related } })
  // the event's target is where the pointer is; dispatched here at the window, so `inBox` reads it from the event
  Object.defineProperty(e, 'target', { value: target })
  win.dispatchEvent(e)
  return { e, dt }
}

test('a file dragged over the page lights the box; over the box it is ready; a drop, a cancel or leaving puts it out', () => {
  const win = new EventTarget()
  const inside = {}
  const outside = {}
  const seen: unknown[] = []
  const timers: { f: () => void; ms: number }[] = []
  const stop = watchFileDrag(win, (t) => t === inside, (d) => seen.push(d), (f, ms) => timers.push({ f, ms }) - 1, () => {})
  dragOver(win, 'dragenter', outside)
  dragOver(win, 'dragover', outside)
  expect(seen).toEqual(['page'])
  dragOver(win, 'dragover', inside)
  expect(seen).toEqual(['page', 'over'])
  dragOver(win, 'drop', inside)
  expect(seen).toEqual(['page', 'over', false])
  // text dragged around the page is not a file: nothing lights
  dragOver(win, 'dragover', outside, false)
  expect(seen).toHaveLength(3)
  // leaving the window: gone soon, unless a dragover follows; a drag that goes quiet is gone too
  dragOver(win, 'dragover', outside)
  dragOver(win, 'dragleave', outside, true, null)
  expect(timers.at(-1)!.ms).toBe(DRAG_LEFT_MS)
  timers.at(-1)!.f()
  expect(seen.at(-1)).toBe(false)
  dragOver(win, 'dragover', outside)
  expect(timers.at(-1)!.ms).toBe(DRAG_GONE_MS)
  timers.at(-1)!.f()
  expect(seen.at(-1)).toBe(false)
  stop()
  dragOver(win, 'dragover', outside)
  expect(seen.at(-1)).toBe(false)
})

test('a file dropped where nothing takes it does nothing, never the browser opening it in place of the app', () => {
  const win = new EventTarget()
  const stop = watchFileDrag(win, () => false, () => {}, () => 0, () => {})
  const { e, dt } = dragOver(win, 'dragover', {})
  expect(e.defaultPrevented).toBe(true)
  expect(dt.dropEffect).toBe('none')
  expect(dragOver(win, 'drop', {}).e.defaultPrevented).toBe(true)
  // text is the browser's, as before
  expect(dragOver(win, 'dragover', {}, false).e.defaultPrevented).toBe(false)
  stop()
})

test('the box says where to drop while a file is dragged, at once and without moving', () => {
  const chat = readFileSync(join(root, 'web/plugins/chat/client.tsx'), 'utf8')
  expect(chat).toContain("className={cx('cbox', drag && 'drop', drag === 'over' && 'over')}")
  expect(chat).toContain('<span>Drop to add to your message</span>')
  const css = readFileSync(join(root, 'web/plugins/chat/attach.css'), 'utf8')
  const rule = css.match(/\.cdrop\{([^}]*)\}/)![1]!
  expect(rule).toContain('pointer-events:none')
  expect(rule).not.toMatch(/transition|animation/)
  expect(css).toMatch(/\.cbox\.over>\.cdrop\{[^}]*outline-style:solid/)
})
