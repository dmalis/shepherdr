import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { FOLDED_LINES, PromptBody, commandLong } from './prompt-body.tsx'

// dmalis/shepherdr#45: a permission card says why a hook (a guard) held it, in one plain line above the command, and
// folds a long command to a few lines with Show all.
const guard = 'The guard holds this command until a person answers: git push with --force-with-lease rewrites or deletes remote history (rule: git-push-rewrite).'

test('#45: the reason shows above the command; a plain permission has none', () => {
  const html = renderToStaticMarkup(<PromptBody why={guard} command="git push --force-with-lease"><code>git push --force-with-lease</code></PromptBody>)
  expect(html.indexOf(`<span class="pwhy">${guard}</span>`)).toBe(0)
  expect(html).toContain('<div class="pbody"><code>git push --force-with-lease</code></div>')
  expect(html).not.toContain('Show all')
  expect(renderToStaticMarkup(<PromptBody command="npm test"><code>npm test</code></PromptBody>)).not.toContain('pwhy')
})

test('#45: a long command starts folded, with Show all', () => {
  expect(commandLong('npm test')).toBe(false)
  expect(commandLong('x'.repeat(40 * FOLDED_LINES))).toBe(false)
  expect(commandLong('x'.repeat(40 * FOLDED_LINES + 1))).toBe(true)
  expect(commandLong('a\nb\nc\nd\ne\nf')).toBe(true)
  const long = 'x'.repeat(400)
  const html = renderToStaticMarkup(<PromptBody command={long}><code>{long}</code></PromptBody>)
  expect(html).toContain('<div class="pbody clip">')
  expect(html).toContain('<button type="button" class="fold" aria-expanded="false">Show all</button>')
  expect(readFileSync(join(import.meta.dir, 'prompt-body.css'), 'utf8')).toContain(`-webkit-line-clamp:${FOLDED_LINES}`)
})

test('#45: the permission card draws its command through it', () => {
  expect(readFileSync(join(import.meta.dir, 'cards.tsx'), 'utf8')).toContain('<PromptBody why={q.why} command={q.command}><Code text={q.command} /></PromptBody>')
})
