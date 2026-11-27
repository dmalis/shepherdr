// dmalis/shepherdr "Chat: say what each thing is": a chat's task line and a link to a task say what kind of thing it
// is, so a title that reads like a sentence ("Install merged") never reads as news.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { KindName, KindWord } from './kind.tsx'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

test("a task's line: its kind, its title, its state; a schedule's run says so", () => {
  expect(text(renderToStaticMarkup(<KindName t={{}} name="Fix login" state="Working" />))).toBe('Task Fix login Working')
  const run = renderToStaticMarkup(<KindName t={{ schedule: 'Install merged' }} name="Install merged" state="Done" />)
  expect(text(run)).toBe('Schedule run Install merged Done')
  // a state's tail in a part of its own that gives way first
  expect(renderToStaticMarkup(<KindName name="Install merged" state="Done · told you in Everything" />)).toContain('<span class="ks">Done</span><span class="kx">told you in Everything</span>')
  // the kind and state in their own quiet parts, the title the part that is cut short
  expect(run).toContain('<span class="kd">Schedule run</span><span class="kn">Install merged</span><span class="ks">Done</span>')
  expect(text(renderToStaticMarkup(<KindName name="Fix login" />))).toBe('Task Fix login')
  expect(text(renderToStaticMarkup(<KindWord t={{ schedule: 'x' }} />))).toBe('Schedule run')
})

test('one line on a phone: the kind and state never shrink, the title truncates', () => {
  const css = readFileSync(join(import.meta.dir, 'kind.css'), 'utf8')
  expect(css).toMatch(/\.knd\{[^}]*white-space:nowrap/)
  expect(css).toMatch(/\.knd>\.kd,\.knd>\.ks\{flex:none/)
  expect(css).toMatch(/\.knd>\.kn\{[^}]*min-width:0;overflow:hidden;text-overflow:ellipsis/)
})

test('every place a chat names a task uses it (pins the call sites in upstream files)', () => {
  const read = (p: string) => readFileSync(join(import.meta.dir, p), 'utf8')
  expect(read('client.tsx')).toContain('<KindName t={t} name={title} state={t ? statusWord(t).word : undefined} />')
  expect(read('client.tsx')).toContain('<KindName t={t} name={t?.name ?? title} state={word} />')
  expect(read('client.tsx')).toContain("newsRow(m.news, t ? `the ${taskKind(t).toLowerCase()} ${t.name}` : '', ")
  expect(read('../artifacts/client.tsx')).toContain('<Tile id={msg.artifact.id} v={msg.artifact.v} kind />')
  expect(read('../inbox/client.tsx')).toContain('<KindTitle title={x.title} />')
  expect(read('client.tsx')).toContain('<span><KindLine text={line} />')
  // the Assistant's lines for its tasks' settled asks and start screens; an agent's alert title
  expect(read('../../../service/compat.ts').match(/\$\{who\} · /g)?.length).toBe(3)
  expect(read('../../../service/compat.ts')).toContain('screens(r.worker, who, by);')
  expect(read('../../../service/push.ts')).toContain('fitWho(who, String(a.title ?? ""), 60)')
  expect(read('mentions.tsx')).toContain('<KindWord t={task} />')
  expect(read('markdown.tsx')).toContain("if (kind === 'task') markKind(a, snap?.tasks.find((t) => t.id === target))")
  // the review card's Done line and the stopped card's line; the Needs your hands card's line
  expect(read('../tasks/client.tsx').split('<KindName t={t} name={t.name} state={statusWord(t).word} />').length).toBe(3)
  expect(read('../tasks/client.tsx')).toContain('<StatusIcon t={t} time="none" /><KindName t={t} name={t.name} />')
  expect(read('../screens/client.tsx')).toContain('<KindName t={t} name={t.name} state={statusWord(t).word} />')
})
