// Settings › Secrets: no overlap, search, A to Z (dmalis/shepherdr#98). The names are made up.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Snapshot } from '@shared/types.ts'
import { snapshot } from '../demo/data.ts'
import { setUI } from './kernel.ts'
import { matching, SEARCH_FROM, SecretList, sorted, type Kept } from './secrets-list.tsx'
import { Secrets } from './settings.tsx'

const k = (name: string, level = 'all'): Kept => ({ name, level })
const names = (l: Kept[]) => l.map((s) => `${s.name}@${s.level}`)
const none = () => undefined
const list = (l: Kept[]) => renderToStaticMarkup(<SecretList list={l} scope={(s) => s.level} replace={none} remove={none} />)
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('A to Z by name, ignoring case, numbers in their order; a name kept at two levels: Every space, a machine, a space', () => {
  const got = sorted([k('ZED'), k('acme_key'), k('KEY_10'), k('KEY_2'), k('GITHUB_TOKEN', 'p:shop'), k('GITHUB_TOKEN', 'm:vm'), k('GITHUB_TOKEN'), k('BETA')])
  expect(names(got)).toEqual(['acme_key@all', 'BETA@all', 'GITHUB_TOKEN@all', 'GITHUB_TOKEN@m:vm', 'GITHUB_TOKEN@p:shop', 'KEY_2@all', 'KEY_10@all', 'ZED@all'])
})

test('search finds what was typed anywhere in a name, any case, a space the same as an underscore', () => {
  const all = [k('ACME_PAYMENTS_WEBHOOK_SECRET'), k('GITHUB_TOKEN'), k('NPM_TOKEN'), k('WEBHOOKS')]
  expect(names(matching(all, 'token'))).toEqual(['GITHUB_TOKEN@all', 'NPM_TOKEN@all'])
  expect(names(matching(all, 'webhook secret'))).toEqual(['ACME_PAYMENTS_WEBHOOK_SECRET@all'])
  expect(names(matching(all, ' Hook '))).toEqual(['ACME_PAYMENTS_WEBHOOK_SECRET@all', 'WEBHOOKS@all'])
  expect(matching(all, '  ')).toEqual(all)
  expect(matching(all, 'stripe')).toEqual([])
  // an underscore typed is one (round 1's review): not every name, nor one without it
  const deploy = [k('DEPLOY'), k('DEPLOY_KEY'), k('DEPLOY__KEY'), k('_PRIVATE')]
  expect(names(matching(deploy, '_'))).toEqual(['DEPLOY_KEY@all', 'DEPLOY__KEY@all', '_PRIVATE@all'])
  expect(names(matching(deploy, 'deploy_'))).toEqual(['DEPLOY_KEY@all', 'DEPLOY__KEY@all'])
  expect(names(matching(deploy, 'deploy__key'))).toEqual(['DEPLOY__KEY@all'])
})

test('the search box comes once there are more than a few', () => {
  const few = Array.from({ length: SEARCH_FROM }, (_, i) => k(`KEY_${i}`))
  expect(list(few)).not.toContain('type="search"')
  const html = list([...few, k('ONE_MORE')])
  expect(html).toContain('<div class="sq" role="search">')
  expect(html).toMatch(/<input class="inp" type="search" aria-label="Search secrets" placeholder="Search secrets"/)
})

test('a long name may break after each underscore, so it never runs under its buttons', () => {
  setUI({ phone: false })
  const html = list([k('ACME_PAYMENTS_WEBHOOK_SECRET')])
  expect(html).toContain('<span class="sn" translate="no">ACME_<wbr/>PAYMENTS_<wbr/>WEBHOOK_<wbr/>SECRET</span>')
  expect(read('./secrets-list.css')).toContain('.win .pg .srow.sec>.n{overflow-wrap:anywhere}')
})

test('a computer keeps Replace and Remove on the row; a phone has one ⋯ for them, the name the whole width', () => {
  setUI({ phone: false })
  const desk = list([k('NPM_TOKEN')])
  expect(desk).toContain('<span class="acts"><button type="button" class="btn s">Replace</button><button type="button" class="btn s">Remove</button></span>')
  setUI({ phone: true })
  const phone = list([k('NPM_TOKEN')])
  expect(phone).not.toContain('Replace')
  expect(phone).toMatch(/<button type="button" class="ib" aria-label="More for NPM_TOKEN, all" aria-haspopup="menu">/)
  setUI({ phone: false })
})

test("Everywhere's page lists its secrets A to Z, each row one row of the Settings group", () => {
  const base = snapshot('long')
  const html = renderToStaticMarkup(<Secrets snap={base as Snapshot} place="all" />)
  const shown = [...html.matchAll(/<span class="sn" translate="no">(.*?)<\/span>/g)].map((m) => m[1]!.replaceAll('<wbr/>', ''))
  expect(shown.length).toBe(15)
  expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })))
  expect(html).toContain('<div class="srow sec">')
  // the seam: settings.tsx hands its list over here, and Settings' group rules (settings-look.css) style any .srow
  expect(read('./settings.tsx')).toContain('<SecretList list={list} ')
  expect(read('./settings-look.css')).toContain('.win .pg .srow{position:relative;gap:12px;padding:8px 16px}')
})
