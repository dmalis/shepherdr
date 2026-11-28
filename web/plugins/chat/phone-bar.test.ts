// fork #105: on a phone the message box is two rows at every width and zoom: the text, then one bar (+, the model line
// cut to fit, send or stop). web/demo/box-check.ts measures it in a real browser at 320 and 390 px, Zoom 100% and
// 125%, idle and working. The upstream seams it leans on are pinned here, so a sync sees a break at once.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')
const css = read('web/plugins/chat/phone-bar.css')

test('the bar stays one line on a phone: no wrap, the model line shrinks, its effort before its model', () => {
  const coarse = css.indexOf('@media (pointer: coarse) {')
  expect(coarse).toBeGreaterThan(-1)
  const rules = css.slice(coarse)
  // one line while the box has room for +, the microphone, send and a readable model line (upstream's wrap below it)
  expect(rules).toContain('@container (min-width: 216px) {\n    .app .cbox > .cbar:has(> .agent) {\n      flex-wrap: nowrap;\n    }\n    .app .cbox > .cbar > .agent {\n      flex: 0 1 auto;\n    }\n  }')
  expect(rules).toContain('.app .cbox > .cbar > .agent > .e:not(.pm) {\n    flex: 0 1000 auto;\n  }')
  // zoom-css.ts writes a container query once per zoom step, scaled
  expect(read('web/zoom-css.ts')).toContain('root.walkAtRules(/^(container|media)$/i, (at) => {')
  // every rule only where a finger is the pointer: nothing before the media block, nothing after it
  expect(css.slice(0, coarse).replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('')
  expect(css.trimEnd().endsWith('}\n}')).toBe(true)
  // the chat plugin loads it
  expect(read('web/plugins/chat/client.tsx')).toContain("import './phone-bar.css'")
})

test('upstream seams: the narrow box it undoes, and the model line that cuts itself to fit', () => {
  const ds = read('web/src/ds.css')
  // upstream's narrow box gives the model line a row of its own, which pushes send or stop onto a third row. Ours
  // outranks these (a class or two more than .cbar:has(>.agent) and .cbar>.agent; zoom-css.ts copies them under :where())
  expect(ds).toContain('@container (max-width:336px){\n  .cbar:has(>.agent){flex-wrap:wrap}\n  .cbar>.agent{flex-basis:calc(100% - var(--ib) - 4px);justify-content:flex-start}')
  expect(ds).toContain('.cbox{display:grid;container-type:inline-size;')
  expect(ds).toContain('.cbar{display:flex;align-items:center;gap:4px;min-width:0;padding:0 6px 6px}.sp{flex:1}')
  // the line and its parts cut with an ellipsis; upstream holds the effort whole (ours lets it give way first)
  expect(ds).toContain('.agent{display:inline-flex;align-items:center;gap:6px;min-width:0;')
  expect(ds).toContain('.agent .m{min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
  expect(ds).toContain('.agent .e{min-width:0;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}')
  expect(ds).toContain('.agent .e:not(.pm){flex:none}')
  // short of room it drops its logo, chevron and permission mode first
  const picker = read('web/src/picker.tsx')
  expect(picker).toContain("export const AGENT_DROPS = ['logo', 'chev', 'perm'] as const")
  expect(picker).toContain('<span className="m">{w.model || w.agent}</span>\n      {w.effort && <span className="e">{w.effort}</span>}')
  // the box: its text row, then its bar, + first and the round button last
  const box = read('web/plugins/chat/client.tsx')
  expect(box).toContain('<div className="cbar">\n        <AddButtons finger={finger} onFiles={(f) => attach(key, key, f)} />\n        <AgentLine')
  // + and the round button keep their size
  expect(ds).toMatch(/\.ib\{[^}]*flex:none\}/)
  expect(ds).toMatch(/\.send\{[^}]*flex:none\}/)
})
