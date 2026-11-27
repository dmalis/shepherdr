import { expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Chat, Message } from '@shared/types.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { imagesLine, lostLine } from './sent-images.ts'

const realMarkdown = await import('./markdown.tsx')
mock.module('./markdown.tsx', () => ({ ...realMarkdown, Markdown: ({ text }: { text: string }) => <div className="md">{text}</div>, toHtml: (t: string) => t, linked: (t: string) => t }))
const { FileRow } = await import('./client.tsx')

// #56: a picture you sent is itself under your message, one tap opening it full size, even one the agent's CLI kept
// only in its log (service/sent-images.ts); the line that stays says why it can't be opened yet.

const chat = { key: 'p:local:shop', messages: [] } as unknown as Chat

test('a picture from the log shows as a picture of yours that opens', () => {
  const msg: Message = { id: 'u10:f0', who: 'you', file: { name: 'Image.png', path: 'image:abc:u10:0', alt: 'Image' } }
  const html = renderToStaticMarkup(<FileRow msg={msg} chat={chat} gap={false} />)
  expect(html).toContain('class="pic mine"')
  expect(html).toContain('aria-label="Image"')
  expect(html).toContain(`href="api/file?chat=p%3Alocal%3Ashop&amp;path=${encodeURIComponent('image:abc:u10:0')}"`)
  expect(html).toContain('<img src="api/file?chat=p%3Alocal%3Ashop&amp;path=image%3Aabc%3Au10%3A0&amp;thumb=1"')
})

test("a picture still in the CLI's queue says so; the line is never a link or button", () => {
  expect(imagesLine(1)).toBe('1 image')
  expect(imagesLine(3)).toBe('3 images')
  expect(imagesLine(1, true)).toBe('1 image · shows once read')
  expect(imagesLine(2, true)).toBe('2 images · shows once read')
})

test('a picture that fails to load turns into a plain line, never a broken picture to tap', () => {
  expect(lostLine).toBe('1 image · not available')
  const src = readFileSync(join(import.meta.dir, 'client.tsx'), 'utf8')
  expect(src).toContain('onError={() => setLost(small)}')
  expect(src).toContain("if (lost && lost === small && isImage(f.name)) return")
  expect(src).toContain("<span>{lostLine}</span>")
})
