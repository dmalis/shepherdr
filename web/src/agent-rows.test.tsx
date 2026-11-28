import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Catalog } from '@shared/types.ts'
import { compactChoices, hasCompact, pickerRows, pickWords, samePick, type Pick } from './picker.tsx'
import { AgentRow, agentParts } from './agent-rows.tsx'

// fork #219: Settings › Agents' roomy rows, and Compact at in every picker

const cat: Catalog = {
  machine: 'here',
  agents: [
    {
      id: 'claude', name: 'Claude Code', installed: true, efforts: ['low', 'medium', 'high'], perms: [{ id: 'default', label: 'Default', about: '' }], permDefault: 'default',
      models: [{ id: 'opus', name: 'Opus 5.5', speeds: ['regular', 'fast'], window: 1000000 }, { id: 'small', name: 'Small', window: 200000 }],
    },
    {
      id: 'codex', name: 'Codex', installed: true, efforts: ['high'], perms: [{ id: 'auto', label: 'Auto', about: '' }], permDefault: 'auto',
      models: [{ id: 'sol', name: 'GPT-6.2 Sol', window: 500000 }, { id: 'astra', name: 'GPT-6.2 Astra', window: 272000 }],
    },
    { id: 'plain', name: 'Plain', installed: true, efforts: [], perms: [], models: [{ id: 'one', name: 'One' }] },
  ],
}
const claude: Pick = { agent: 'claude', model: 'opus', effort: 'high', fast: false, perm: null }
const codex: Pick = { agent: 'codex', model: 'sol', effort: 'high', fast: false, perm: null }

test('only Claude Code and Codex have a Compact at row (documented per-run switches)', () => {
  expect(hasCompact('claude')).toBe(true)
  expect(hasCompact('codex')).toBe(true)
  expect(pickerRows({ agent: 'plain' }, cat).some((r) => r.f === 'compact')).toBe(false)
  expect(pickerRows({ ...claude, compact: 300000 }, cat).at(-1)).toEqual({ f: 'compact', label: 'Compact at', value: '300k' })
})

test("Claude's 1M window offers sizes under it with 300k recommended, Default first", () => {
  const items = compactChoices(claude, cat)
  expect(items.map((x) => x.label)).toEqual(['Default', '200k', '300k', '400k', '500k'])
  expect(items.filter((x) => x.recommended).map((x) => x.label)).toEqual(['300k'])
  expect(items[0].on).toBe(true)
  expect(items[0].sub).toBe('Claude Code decides: near the end of the window')
  expect(items.find((x) => x.label === '300k')!.pick.compact).toBe(300000)
  expect(items[0].pick.compact).toBeNull()
})

test("Codex's own point (90% of the window) is the recommended Default; only sizes below it are offered", () => {
  const sol = compactChoices(codex, cat)
  expect(sol.map((x) => x.label)).toEqual(['Default', '150k', '200k', '300k', '400k'])
  expect(sol[0]).toMatchObject({ recommended: true, sub: 'Codex decides: at about 450k' })
  const astra = compactChoices({ ...codex, model: 'astra' }, cat)
  expect(astra.map((x) => x.label)).toEqual(['Default', '150k', '200k'])
  expect(astra[0].sub).toBe('Codex decides: at about 245k')
})

test('a kept size the list lacks stays on it, picked', () => {
  const items = compactChoices({ ...claude, model: 'small', compact: 600000 }, cat)
  expect(items.map((x) => x.label)).toEqual(['Default', '150k', '600k'])
  expect(items.find((x) => x.on)!.label).toBe('600k')
})

test('a changed Compact at counts as a change; its words name it', () => {
  expect(samePick(claude, { ...claude, compact: 300000 }, cat)).toBe(false)
  expect(samePick({ ...claude, compact: null }, { ...claude, compact: undefined }, cat)).toBe(true)
  expect(pickWords({ ...claude, compact: 1000000 }, cat).compact).toBe('1M')
})

test("a row shows every choice but the agent, Speed's Standard and Compact at's Default included", () => {
  expect(agentParts({ ...claude, fast: true, compact: 300000 }, cat)).toEqual([
    { f: 'model', label: 'Model', value: 'Opus 5.5' },
    { f: 'effort', label: 'Effort', value: 'High' },
    { f: 'speed', label: 'Speed', value: 'Fast' },
    { f: 'mode', label: 'Permissions', value: 'Default' },
    { f: 'compact', label: 'Compact at', value: '300k' },
  ])
  expect(agentParts(claude, cat).find((p) => p.f === 'speed')!.value).toBe('Standard')
})

test('the whole row is one button that says what it holds; the small print stays outside it', () => {
  const html = renderToStaticMarkup(createElement(AgentRow, { name: 'Tasks', pick: { ...claude, compact: 300000 }, cat, small: createElement('small', null, 'Set here'), onOpen: () => undefined }))
  expect(html.match(/<button/g)!.length).toBe(1)
  expect(html).toContain('aria-label="Tasks: Claude Code, Model Opus 5.5, Effort High, Speed Standard, Permissions Default, Compact at 300k. Change"')
  expect(html).toContain('<span class="agr-n">Tasks</span>')
  expect(html).toMatch(/<\/button><span class="agr-own"><small>Set here<\/small><\/span>/)
  expect(html).not.toContain('>Change<')
})
