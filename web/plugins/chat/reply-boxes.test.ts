// fork #164: a reply's code blocks and tables (markdown.tsx). Shaping them needs a browser's DOM, so web/demo/reply-check.ts
// checks what people see on the built demo on every pull request; these pin the seams it and the styles rely on, so a
// sync sees a break at once.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Marked } from 'marked'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const md = read('web/plugins/chat/markdown.tsx')
const css = read('web/src/styles.css')
const size = read('web/src/size.css')

test('marked still writes a table and a code block as the boxes expect: <table> after its line, <pre><code>', () => {
  const html = new Marked({ gfm: true, breaks: false }).parse('The links:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nx\n```', { async: false }) as string
  expect(html).toMatch(/<p>The links:<\/p>\s*<table>/)
  expect(html).toContain('<pre><code class="language-ts">x\n</code></pre>')
})

test('every code block gets its Copy, and a long line scrolls in a box of its own', () => {
  expect(md).toContain("box.className = 'code block'")
  expect(md).toContain("btn.setAttribute('aria-label', 'Copy')")
  expect(md).toContain("pre.setAttribute('data-sx', 'Code')")
})

test("a table's box: named from the line before it, Open table beside it, measured after layout", () => {
  expect(md).toContain("for (const table of root.querySelectorAll('table')) tableBox(table)")
  expect(md).toContain("scroll.className = 'tbls'")
  expect(md).toContain("btn.className = 'btn s tblx'")
  expect(md).toContain('Open table')
  expect(md).toContain("s.setAttribute('role', 'region')")
  expect(md).toContain('s.tabIndex = 0')
  expect(md).toContain('new ResizeObserver((es) => fitBoxes(es.map((e) => e.target)))')
  expect(md).toContain("openDialog((close) => <TableSheet name={name} html={html} close={close} />, { wide: true })")
  // the demo has a wide table after its line and a report with headings, code and a table that fits
  const data = read('web/demo/data.ts')
  expect(data).toContain("a('The broken links I found:\\n\\n| # | Page |")
  expect(data).toContain("a('# Archive links fixed\\n\\n## What changed")
})

test('the styles: a fade where cut, a ring round the box, Open table only when wide, headings that step down', () => {
  expect(css).toContain('.md [data-sx][data-cut="end"]{mask-image:')
  expect(css).toContain('.md .tbl:has(>.tbls:focus-visible),.md .code.block:has(>pre:focus-visible){outline:')
  expect(css).toContain('.md .tblx{display:none;')
  expect(css).toContain('.md .tbl[data-wide]+.tblx{display:inline-flex}')
  expect(size).toContain('.md h1{font-size:calc(var(--chat,16px) + 4px)')
  expect(size).toContain('.md h2{font-size:calc(var(--chat,16px) + 2px)')
  expect(size).toContain('.md h4,.md h5,.md h6{font-size:var(--chat2,14px)')
  // code on touch at Default is the design system's --code, 14/20
  expect(size).toContain('.app.tap{--chat:16px;--chatl:24px;--chat2:14px;--chat2l:20px;--chatm:14px;--chatml:20px}')
})
