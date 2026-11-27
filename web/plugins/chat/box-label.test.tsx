// fork #105: the message box has its own <label>, so iPhone Safari reads it instead of guessing the box's type from the
// messages above it (which offered "AutoFill Contact" and the person's own number). The label is hidden on screen and
// from screen readers: the box's accessible name stays its aria-label.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { BOX_LABEL, BoxLabel } from './box-label.tsx'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')

test('the label names the box for Safari, hidden on screen and from screen readers', () => {
  const html = renderToStaticMarkup(<BoxLabel htmlFor="box-1" />)
  expect(html).toBe('<label class="vh" for="box-1" aria-hidden="true">Message</label>')
  // no word a contact form asks for
  expect(BOX_LABEL).not.toMatch(/name|phone|tel|mobile|email|mail|address|number|#|-/i)
})

test('the message box is the field the label is for, and keeps its aria-label', () => {
  const box = read('web/plugins/chat/client.tsx')
  const at = box.indexOf('<div className="crow">')
  const row = box.slice(at, box.indexOf('</div>', at))
  expect(row).toContain('<BoxLabel htmlFor={boxId} />')
  expect(row).toContain('id={boxId}')
  expect(row).toContain('aria-label={hint}')
  expect(box).toContain('const boxId = useId()')
  // the visually hidden class it uses
  expect(read('web/src/dictate.css')).toContain('.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}')
})
