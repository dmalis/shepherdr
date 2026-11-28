// An agent's reply, drawn from markdown: a link to this app opens in it, any other in a new tab (kernel.ts catches
// the tap: SHEP-339; the app stays where it is), a code block has a copy
// button (the design system's code block), a tap on a bit of `code` copies it, and task names and #spaces are links
// that open them. A table wider than its message scrolls sideways in its own box, which fades where it is cut, is named
// and reached by Tab, and opens whole in a dialog (a sheet on a phone) by its Open table (fork #164).
import DOMPurify from 'dompurify'
import { marked, type MarkedExtension } from 'marked'
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { copyText } from '@client/copy.ts'
import { IC } from '@client/icons.ts'
import { go, notice, openTask, useSnap } from '@client/kernel.ts'
import { openDialog } from '@client/overlay.tsx'
import { IB } from '@client/ui.tsx'
import type { Message, Snapshot } from '@shared/types.ts'
import { spacesOf, taskRef } from '@shared/view.ts'
import { taskFor, withMentions } from './mentions.tsx'
import { markKind } from './kind.tsx'
import { made, replyKey } from './made.ts'
import { taskKind } from '@shared/kinds.ts'

marked.setOptions({ gfm: true, breaks: false })
// #1549: an agent's raw HTML shows as typed: a placeholder like <code> or <id> stays words and styles nothing after it.
// Only a line break (<br>, common in a table's cell) still breaks the line.
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const rawHtmlAsText: MarkedExtension = { renderer: { html: ({ text }) => (/^<br\s*\/?>$/i.test(text.trim()) ? '<br>' : esc(text)) } }
marked.use(rawHtmlAsText)

// a link goes to a new tab, never in place of the app; one to this app is caught by kernel.ts and opens in it.
// Without a browser (bun test) DOMPurify has no hooks: the module still loads, so a test's mock can keep its real exports.
if (DOMPurify.isSupported) DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A' || !node.getAttribute('href')) return
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

/** the reply as safe HTML: a copy button on each code block, and a bit of inline code copies when tapped. The marks
    go onto the sanitized elements themselves, never into the HTML as text, so nothing in the reply can turn into them.
    A link's or picture's title goes: nothing pops up on hover. `link`: called for each #space and task link. */
export function toHtml(text: string, link?: (a: HTMLAnchorElement, kind: 'space' | 'task', target: string) => void) {
  const root = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { RETURN_DOM: true, FORBID_ATTR: ['title'] }) as HTMLElement
  if (link)
    for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="#space="], a[href^="#task="]')) {
      const task = a.getAttribute('href')!.startsWith('#task=')
      link(a, task ? 'task' : 'space', decodeURIComponent(a.getAttribute('href')!.slice(task ? 6 : 7)))
    }
  for (const pre of root.querySelectorAll('pre')) {
    // the design system's code block: the code, and a copy button at its right
    const box = document.createElement('div')
    box.className = 'code block'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ib'
    btn.setAttribute('data-copy', '')
    btn.setAttribute('aria-label', 'Copy')
    btn.innerHTML = `<svg class="i" viewBox="0 0 20 20" aria-hidden="true">${IC.copy}</svg>`
    pre.replaceWith(box)
    box.append(pre, btn)
    // a line too long for the box scrolls sideways in it, faded where it is cut, as a table does (fitBoxes)
    pre.setAttribute('data-sx', 'Code')
  }
  // #1442: a table cell holding a sentence keeps a readable width; the table scrolls sideways in its box instead
  for (const cell of root.querySelectorAll('td, th')) if ((cell.textContent ?? '').trim().length > 24) cell.classList.add('long')
  for (const table of root.querySelectorAll('table')) tableBox(table)
  for (const code of root.querySelectorAll('code')) {
    // a bit of code inside a link is the link's
    if (code.closest('pre, a')) continue
    code.setAttribute('data-copy', '')
  }
  const h = root.innerHTML.trim()
  const one = h.match(/^<p>([\s\S]*)<\/p>$/)
  return one && !one[1].includes('<p>') ? one[1] : h
}

const shown = new WeakMap<Element, ReturnType<typeof setTimeout>>()

/** a code block's button, or a bit of inline code, says it copied for a moment (to a screen reader too) */
function copied(el: Element) {
  el.setAttribute('data-copied', '')
  if (el.tagName === 'BUTTON') el.setAttribute('aria-label', 'Copied')
  clearTimeout(shown.get(el))
  shown.set(
    el,
    setTimeout(() => {
      el.removeAttribute('data-copied')
      if (el.tagName === 'BUTTON') el.setAttribute('aria-label', 'Copy')
    }, 1400),
  )
}

function onCopy(e: MouseEvent) {
  const el = (e.target as Element).closest('[data-copy]')
  if (!el || !e.currentTarget.contains(el)) return
  // dragging across code selects it; that is not a tap
  if (el.tagName === 'CODE' && getSelection()?.toString()) return
  e.stopPropagation()
  // a block's button sits in the bar over its code (SHEP-152: it looked beside itself, found nothing, copied nothing)
  const code = el.tagName === 'CODE' ? el : el.closest('.code')?.querySelector('pre')
  if (!code?.textContent) return
  void copyText(code.textContent.replace(/\n$/, ''), el).then((ok) => ok && copied(el))
}

/** A table in its own box (fork #164): the box scrolls sideways, and Open table follows it. The box learns its name here,
 *  from the line before the table when that says what it is ("The broken links I found:"), else "Table"; fitBoxes
 *  gives it that name, its place in Tab's order and Open table only once the table is wider than the box. */
function tableBox(table: HTMLTableElement) {
  const before = table.previousElementSibling
  const said = before?.matches('p, h1, h2, h3, h4, h5, h6') ? (before.textContent ?? '').trim().replace(/\s+/g, ' ').replace(/[:：]$/, '') : ''
  const box = document.createElement('div')
  box.className = 'tbl'
  const scroll = document.createElement('div')
  scroll.className = 'tbls'
  scroll.setAttribute('data-sx', said && said.length <= 80 ? said : 'Table')
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'btn s tblx'
  btn.setAttribute('data-table', '')
  btn.innerHTML = `<svg class="i" viewBox="0 0 20 20" aria-hidden="true">${IC.expand}</svg>Open table`
  table.replaceWith(box)
  box.append(scroll)
  scroll.append(table)
  // beside the box, not in it: the ring Tab draws round the box is the table's alone
  box.after(btn)
}

/** where a sideways box (a table, a code block) is cut: what it holds fades at that edge (none once scrolled to the end) */
function cut(s: HTMLElement, over: number, x: number) {
  const start = x > 1
  const end = over - x > 1
  if (start || end) s.setAttribute('data-cut', start && end ? 'both' : start ? 'start' : 'end')
  else s.removeAttribute('data-cut')
}

/** each sideways box in `roots` (a table's, a code block's), measured: one whose content is wider than it is a named
 *  region Tab reaches, faded where cut, and a table's gets Open table under it; one that fits is just what it holds.
 *  Every box is read first and written after, so a chat of many replies lays out once, not once a box. */
export function fitBoxes(roots: Element[]) {
  const sized = roots.flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>('[data-sx]'), (s) => ({ s, over: s.scrollWidth - s.clientWidth, x: Math.abs(s.scrollLeft) })))
  for (const { s, over, x } of sized) {
    const wide = over > 1
    s.parentElement?.toggleAttribute('data-wide', wide)
    if (wide) {
      s.setAttribute('role', 'region')
      s.setAttribute('aria-label', s.getAttribute('data-sx') || 'Table')
      s.tabIndex = 0
    } else for (const a of ['role', 'aria-label', 'tabindex']) s.removeAttribute(a)
    cut(s, over, x)
  }
}

// one watcher for every reply that holds a table or code: it tells after layout, in a batch, when one is drawn or its
// width changes (never while React draws, which would lay the page out once a reply)
const watch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => fitBoxes(es.map((e) => e.target))) : null

/** a reply's tables and code blocks kept measured: when drawn, when the reply's width changes and as each box scrolls */
function useBoxes(ref: { current: HTMLElement | null }, html: string) {
  const boxes = html.includes('<table') || html.includes('<pre')
  useEffect(() => {
    const el = ref.current
    if (!el || !boxes) return
    // observing again (new words in the same reply) measures again
    watch?.unobserve(el)
    watch?.observe(el)
    let frame = 0
    const scrolled = (e: Event) => {
      const s = e.target
      if (!(s instanceof HTMLElement) || !s.hasAttribute('data-sx')) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => cut(s, s.scrollWidth - s.clientWidth, Math.abs(s.scrollLeft)))
    }
    el.addEventListener('scroll', scrolled, { capture: true, passive: true })
    return () => {
      el.removeEventListener('scroll', scrolled, true)
      watch?.unobserve(el)
      cancelAnimationFrame(frame)
    }
  }, [html, boxes])
}

/** a task or #space link opens it; anything else may be code to copy. `done`: what to close first (a table's sheet) */
function follow(e: MouseEvent, snap: Snapshot | null, done?: () => void) {
  const el = (e.target as Element).closest('[data-task], [data-place]')
  if (!el || !e.currentTarget.contains(el)) return onCopy(e)
  e.stopPropagation()
  goTo(el, snap, done)
}

/** Enter on a task or #space link opens it, as a click does (they are links without an address: role="link") */
function enter(e: KeyboardEvent, snap: Snapshot | null, done?: () => void) {
  const el = e.target as Element
  if (e.key !== 'Enter' || !el.matches('[data-task], [data-place]') || !e.currentTarget.contains(el)) return
  e.preventDefault()
  e.stopPropagation()
  goTo(el, snap, done)
}

function goTo(el: Element, snap: Snapshot | null, done?: () => void) {
  done?.()
  const task = el.getAttribute('data-task')
  if (task) return snap?.tasks.some((t) => t.id === task) ? openTask(task) : notice('That task is not in your lists here.')
  const place = el.getAttribute('data-place')!
  return snap?.places.some((p) => p.id === place) ? go(place) : notice('That space is not in your list here.')
}

/** Open table: the table whole, in a dialog as wide as the window allows (a sheet on a phone) */
function openTable(box: Element) {
  const s = box.querySelector<HTMLElement>('.tbls')
  const table = s?.querySelector('table')
  if (!s || !table) return
  const name = s.getAttribute('data-sx') || 'Table'
  const html = table.outerHTML
  openDialog((close) => <TableSheet name={name} html={html} close={close} />, { wide: true })
}

function TableSheet({ name, html, close }: { name: string; html: string; close: () => void }) {
  const snap = useSnap()
  const ref = useRef<HTMLDivElement>(null)
  useBoxes(ref, html)
  return (
    <div className="pk tblsheet">
      <div className="hd">
        <h2>{name}</h2>
        <IB icon="x" label="Close" onClick={close} />
      </div>
      <div
        ref={ref}
        className="md"
        onKeyDown={(e) => enter(e, snap, close)}
        onClick={(e) => {
          // a link with an address (another site, or a page of this app that kernel.ts opens in it) goes, and the sheet
          // closes after it, so the link has left before its element does
          if ((e.target as Element).closest('a[href]')) return void setTimeout(close)
          follow(e, snap, close)
        }}
      >
        <div className="tbl">
          <div className="tbls" data-sx={name} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  )
}

const escMd =(t: string) => t.replace(/[\\\[\]]/g, (c) => `\\${c}`)

/** Task names and #spaces as links: a picked `[#shop](space:…)` or `[@Fix login](task:SHOP-2…)`, a task's key the agent wrote
 *  (shown as the task's title, never its id) and a #space the list has. Code is left alone. */
export function linked(text: string, snap: Snapshot | null, mentions: Message['mentions'] = [], place?: string): string {
  if (!snap) return text
  const spaces = new Map(spacesOf(snap).map((p) => [p.name.toLowerCase(), p.id]))
  // outside code spans and blocks only
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => {
      if (i % 2) return part
      return part
        .replace(/\[#([^\]\n]+)\]\(space:([^)\s]+)\)/g, (_, name: string, target: string) => `[#${escMd(name)}](#space=${encodeURIComponent(target)})`)
        .replace(/\[@([^\]\n]+)\]\(task:([^)\s]+)\)/g, (_, words: string, target: string) => {
          // SHEP-322: the task its target names (its key there); its words are its title (an older one's, its key)
          const task = taskFor(snap, target, place)
          return `[${escMd(task?.name ?? (/^[A-Z][A-Z0-9]*-\d+$/.test(words) ? 'a task' : words))}](#task=${encodeURIComponent(task?.id ?? target)})`
        })
        .replace(/(^|[^\w\[/=#-])([A-Z][A-Z0-9]*-\d+)\b(?!\]\()/g, (all, pre: string, ref: string) => {
          const task = taskFor(snap, ref, place, false)
          const recorded = !task && !snap.tasks.some((t) => taskRef(t) === ref) ? mentions?.filter((m) => m.ref === ref) : []
          const t = task ? { id: task.id, title: task.name } : recorded?.length === 1 ? { id: recorded[0].task, title: recorded[0].title } : null
          return t ? `${pre}[${escMd(t.title)}](#task=${encodeURIComponent(t.id)})` : all
        })
        .replace(/(^|[\s(])#([\w.-]+)\b(?!\]\()/g, (all, pre: string, name: string) => {
          const id = spaces.get(name.toLowerCase())
          return id ? `${pre}[#${name}](#space=${encodeURIComponent(id)})` : all
        })
    })
    .join('')
}

/** an agent's words, formatted; `mentions`: the tasks the server found named in them */
export function Markdown({ text, mentions, plain, place }: { text: string; mentions?: Message['mentions']; plain?: boolean; place?: string }) {
  const snap = useSnap()
  const html = useMemo(() => {
    const source = plain ? text : linked(text, snap, mentions, place)
    const task = (id: string) => snap?.tasks.find((t) => t.id === id)
    // kept by the words and the kind of each task they link (made.ts): a chat opened again parses none of them
    return made(replyKey(source, !!plain, (id) => taskKind(task(id))), () =>
      toHtml(source, (a, kind, target) => {
        a.removeAttribute('target')
        a.removeAttribute('rel')
        a.removeAttribute('href')
        a.className = 'lk'
        a.setAttribute('role', 'link')
        a.setAttribute('tabindex', '0')
        a.setAttribute(kind === 'task' ? 'data-task' : 'data-place', target)
        if (kind === 'task') markKind(a, snap?.tasks.find((t) => t.id === target))
      }),
    )
  }, [text, snap?.tasks, snap?.places, snap?.machines, mentions, plain, place])
  const ref = useRef<HTMLDivElement>(null)
  useBoxes(ref, html)
  const open = (e: MouseEvent) => {
    const t = (e.target as Element).closest('[data-table]')
    if (!t || !e.currentTarget.contains(t)) return follow(e, snap)
    e.stopPropagation()
    const box = t.previousElementSibling
    if (box?.matches('.tbl')) openTable(box)
  }
  return <div ref={ref} className="md" onClick={open} onKeyDown={(e) => enter(e, snap)} dangerouslySetInnerHTML={{ __html: html }} />
}

/** your own words as you typed them, with their web addresses as links (one to this app opens in it) and each space
 *  or task you picked with # or @ as a link to it */
export const withLinks = (text: string, place?: string): ReactNode[] => withMentions(text, urls, place)

function urls(text: string, pre: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s<>"]+)/).flatMap((part, i): ReactNode[] => {
    if (i % 2 === 0) return part ? [part] : []
    // a full stop, comma or bracket at the end is the sentence's
    const end = part.match(/[.,;:!?)\]'"]+$/)?.[0] ?? ''
    const url = end ? part.slice(0, -end.length) : part
    return [
      <a key={pre + i} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>,
      ...(end ? [end] : []),
    ]
  })
}
