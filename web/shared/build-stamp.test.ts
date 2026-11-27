// fork patch #44: the stamp as index.html carries it, the words About says, and the upstream seams it hangs on
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webBuild } from '../../service/webbuild.ts'
import { buildId, buildVersion } from './build.ts'
import { aheadWords, commitUrl, exact, short, STAMP_ID, stampJson, stampOf, type Stamp } from './build-stamp.ts'

const C = '9fedf5c' + '0'.repeat(33)
const S: Stamp = { tag: 'v3.2.22', ahead: 6, commit: C, repo: 'https://github.com/o/r', changes: ['Fix </script><b>x</b>', 'Two'], more: 0 }
const tag = (s: unknown) => `<script type="application/json" id="${STAMP_ID}">${typeof s === 'string' ? s : stampJson(s as Stamp)}</script>`
const page = (extra = '') => `<head><meta name="shepherdr-version" content="3.2.22"><script type="module" src="./assets/index-abc.js"></script><link rel="stylesheet" href="./assets/index-def.css">${extra}</head><body></body>`

describe('stampOf', () => {
  test('round trip; a subject can never end the script tag', () => {
    expect(stampJson(S)).not.toContain('<')
    expect(stampOf(page(tag(S)))).toEqual(S)
  })

  test('no stamp, or a broken one: null', () => {
    expect(stampOf(page())).toBeNull()
    expect(stampOf(page(tag('{nope')))).toBeNull()
    expect(stampOf(page(tag({ ...S, commit: 'javascript:x' })))).toBeNull()
  })

  test('a repo that is not a GitHub address is dropped, so the commit is never a link elsewhere', () => {
    expect(stampOf(page(tag({ ...S, repo: 'javascript:alert(1)' })))?.repo).toBe('')
    expect(stampOf(page(tag({ ...S, repo: 'https://evil.example/o/r' })))?.repo).toBe('')
  })
})

describe('words', () => {
  test('exactly a release, or no stamp: just the number', () => {
    expect(exact(null)).toBe(true)
    expect(exact({ ...S, ahead: 0 })).toBe(true)
    expect(exact(S)).toBe(false)
    // no tag at all: the commit is all there is to say
    expect(exact({ ...S, tag: '', ahead: 0 })).toBe(false)
  })

  test('changes on top of this version, or since an older tag', () => {
    expect(aheadWords('3.2.22', S)).toBe('6 changes on top')
    expect(aheadWords('3.2.22', { ...S, ahead: 1 })).toBe('1 change on top')
    expect(aheadWords('3.2.23', S)).toBe('6 changes since 3.2.22')
    expect(aheadWords('3.2.22', { ...S, tag: '', ahead: 0 })).toBe('')
  })

  test("fork patch #70: What's new's own count when the build has one, read back from the page", () => {
    expect(aheadWords('3.2.22', { ...S, onTop: 2 })).toBe('2 changes on top')
    expect(aheadWords('3.2.22', { ...S, onTop: 1 })).toBe('1 change on top')
    expect(aheadWords('3.2.22', { ...S, onTop: 0 })).toBe('')
    expect(stampOf(page(tag({ ...S, onTop: 8 })))?.onTop).toBe(8)
    expect(stampOf(page(tag(S)))).not.toHaveProperty('onTop')
  })

  test('the short commit opens on GitHub', () => {
    expect(short(C)).toBe('9fedf5c')
    expect(commitUrl(S)).toBe(`https://github.com/o/r/commit/${C}`)
    expect(commitUrl({ ...S, repo: '' })).toBeNull()
  })
})

// The seams this patch hangs on (upstream SHEP-337): if one of these changes, the next sync sees it here.
describe('pinned upstream seams', () => {
  test('a build without a stamp keeps upstream’s build id; another commit of the same version is a new build', () => {
    expect(buildVersion(page())).toBe('3.2.22')
    expect(buildId(page())).toBe('assets/index-abc.js assets/index-def.css v3.2.22')
    expect(buildId(page(tag(S)))).toBe(`assets/index-abc.js assets/index-def.css v3.2.22 @${C}`)
    expect(buildId(page(tag({ ...S, commit: 'a'.repeat(40) })))).not.toBe(buildId(page(tag(S))))
  })

  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  test('the service reads the served build’s stamp, without its list', () => {
    const d = mkdtempSync(join(tmpdir(), 'web-'))
    dirs.push(d)
    writeFileSync(join(d, 'index.html'), page(tag(S)))
    expect(webBuild(d)()).toEqual({ id: buildId(page(tag(S))), version: '3.2.22', stamp: { tag: 'v3.2.22', ahead: 6, commit: C, repo: 'https://github.com/o/r' } })
  })

  test('the stamp goes in beside the version, travels with the build message, and About shows it', () => {
    const at = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
    expect(at('../vite.config.ts')).toMatch(/name: 'shepherdr-version', transformIndexHtml[^\n]*STAMP_ID/)
    expect(at('../../service/live.ts')).toContain('type: "build", id: this.build, version: b?.version || this.version, stamp: b?.stamp ?? null')
    expect(at('../src/kernel.ts')).toContain("served: { build: msg.id, version: msg.version ?? '', stamp: msg.stamp ?? null }")
    expect(at('../src/settings.tsx')).toMatch(/import \{ About \} from '\.\/about\.tsx'[\s\S]*if \(sec === 'About'\) return <About \/>/)
  })
})
