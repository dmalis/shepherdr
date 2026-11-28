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
const { addPaste, dropPaste, editRange, getPastes, joined, outgoing, putBack, setPastes, typedEdit } = await import('./fold.ts')
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

/** `s` typed at `at` (over `to` when a selection) as the box reports it: what it replaced */
function type(at: number, s: string, to = at) {
  const t = getDraft(KEY)
  setDraft(KEY, t.slice(0, at) + s + t.slice(to), { from: at, to })
}
const sent = () => joined(getDraft(KEY), getPastes(KEY))

test('a paste in the middle is sent in the middle, after more typing before and after it', () => {
  setDraft(KEY, 'Why does this fail? It worked yesterday.')
  addPaste(KEY, LOG, 'Why does this fail?'.length)
  // before it, after it, and right where it sits (the caret is after a paste once it is pasted)
  type(0, 'So: ')
  type(getDraft(KEY).length, ' On main.')
  type('So: Why does this fail?'.length, ' Here:')
  expect(sent()).toBe(`So: Why does this fail?\n\n${LOG}\n\nHere: It worked yesterday. On main.`)
})

test('the same words again before a paste: the edit says which copy it is, not a guess', () => {
  // a suggestion, dictation or Held's Edit puts "Go" in front of "Go again" with the paste after the first "Go"
  setDraft(KEY, 'Go again')
  addPaste(KEY, LOG, 2)
  type(0, 'Go ')
  expect(sent()).toBe(`Go Go\n\n${LOG}\n\nagain`)
})

test('a selection replaced, a Backspace before the paste, an undo: the paste stays with its words', () => {
  setDraft(KEY, 'old')
  addPaste(KEY, LOG, 3)
  // select all, type "other": letter by letter, never split
  type(0, 'o', 3)
  for (const [i, c] of [...'ther'].entries()) type(1 + i, c)
  expect(sent()).toBe(`other\n\n${LOG}`)
  // a Backspace just before it, then letters typed there: they go before it, as you write on
  setDraft(KEY, 'othe', typedEdit('other', 'othe', { start: 5, end: 5 }, 4))
  type(4, 'rs')
  expect(sent()).toBe(`others\n\n${LOG}`)
  // replaced up to it, then undone: back after its words
  setDraft(KEY, 'x', { from: 0, to: 6 })
  expect(getPastes(KEY)[0]!.at).toBe(1)
  setDraft(KEY, 'others', { undo: true })
  expect(sent()).toBe(`others\n\n${LOG}`)
  // a part with the paste inside replaced: it goes where that part was; undone: back between its words
  setDraft(KEY, 'abc def')
  setPastes(KEY, (ps) => ps.map((p) => ({ ...p, at: 3 })))
  setDraft(KEY, 'x', { from: 0, to: 7 })
  expect(getPastes(KEY)[0]!.at).toBe(0)
  setDraft(KEY, 'abc def', { undo: true })
  expect(sent()).toBe(`abc\n\n${LOG}\n\ndef`)
})

test('what a typed edit replaced: the selection, or the letters a Backspace or Delete took', () => {
  expect(typedEdit('abcd', 'aXd', { start: 1, end: 3 }, 2)).toEqual({ from: 1, to: 3 })
  expect(typedEdit('abc', 'ab', { start: 3, end: 3 }, 2)).toEqual({ from: 2, to: 3 })
  expect(typedEdit('abc', 'ac', { start: 1, end: 1 }, 1)).toEqual({ from: 1, to: 2 })
  expect(typedEdit('ab', 'aXb', { start: 1, end: 1 }, 2)).toEqual({ from: 1, to: 1 })
  // an edit that doesn't fit the words is not used: the plain difference
  expect(editRange('xbb', 'xbbb', { from: 0, to: 0 })).toEqual({ from: 3, to: 3, added: 1 })
  expect(editRange('xbb', 'xbbb', { from: 1, to: 1 })).toEqual({ from: 1, to: 1, added: 1 })
})

test('pastes kept from before have no place: they go after the words, as they did, through edits', () => {
  expect(joined('Look', [{ text: LOG }, { text: 'x'.repeat(3000) }])).toBe(`Look\n\n${LOG}\n\n${'x'.repeat(3000)}`)
  setDraft(KEY, 'Look')
  setPastes(KEY, () => [{ id: 'old', text: LOG }])
  type(4, ' at this.')
  expect(getPastes(KEY)[0]!.at).toBeUndefined()
  expect(sent()).toBe(`Look at this.\n\n${LOG}`)
  // two at one place keep their order; a place past the words is their end
  expect(joined('ab', [{ text: 'P1', at: 1 }, { text: 'P2', at: 1 }])).toBe('a\n\nP1\n\nP2\n\nb')
  expect(joined('ab', [{ text: 'P', at: 9 }])).toBe('ab\n\nP')
})

test('a line after a paste keeps its indent, sent or put back', () => {
  const code = 'Summary\n    return x'
  expect(joined(code, [{ text: 'P', at: 8 }])).toBe('Summary\n\nP\n\n    return x')
  expect(putBack(code, 8, 'P')).toEqual({ text: 'Summary\n\nP\n\n    return x', from: 8, to: 8, end: 10 })
  // words on its line lose only the spaces next to it
  expect(putBack('see  this', 4, 'P')).toEqual({ text: 'see\n\nP\n\nthis', from: 3, to: 5, end: 6 })
  expect(joined('see  this', [{ text: 'P', at: 4 }])).toBe('see\n\nP\n\nthis')
})

test('a paste never makes a message a ! command: one that would start it goes after your words', () => {
  expect(outgoing('Can you explain this?', [{ text: '!pwd\nls', at: 0 }])).toBe('Can you explain this?\n\n!pwd\nls')
  expect(outgoing('Can you explain this?', [{ text: LOG, at: 0 }])).toBe(`${LOG}\n\nCan you explain this?`)
  // a command you typed stays one
  expect(outgoing('!ls', [])).toBe('!ls')
  const chat = readFileSync(join(root, 'web/plugins/chat/client.tsx'), 'utf8')
  expect(chat).toContain('const t = outgoing(text, pastes)')
})

test("a paste's Edit puts it back where it was pasted, the pastes beside it in their order", () => {
  const chat = readFileSync(join(root, 'web/plugins/chat/client.tsx'), 'utf8')
  const edit = chat.slice(chat.indexOf('const editPaste = '), chat.indexOf('const drag = useFileDrag'))
  expect(edit).toContain('const r = putBack(text, p.at ?? text.length, p.text)')
  expect(edit).toContain('setText(r.text, { from: r.from, to: r.to })')
  expect(edit).toContain('place.set(x.id, j < i ? r.from : r.end)')
  expect(edit).toContain('box.setSelectionRange(r.end, r.end)')
  // a long paste folds where the caret is, over a selection
  expect(chat).toContain('addPaste(key, t, at)')
  // each typed edit says what it replaced, from the selection as it began; an undo says so
  expect(chat).toContain("box.addEventListener('beforeinput', note)")
  expect(chat).toContain('typedEdit(text, e.target.value, b, e.target.selectionEnd)')
  // Held's Edit puts the held words in front
  expect(chat).toContain('setDraft(key, editedDraft(o.text, now), { from: 0, to: now.trim() ? 0 : now.length })')
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
