// The demo's builds for Settings › About (fork patch #44): ?build=release, ?build=ahead or ?build=older stamps fake
// values on the real build, as web/build-stamp.ts would, so About can be seen for an exact release, a build with
// changes on top, and a device on an older build of the same version than the one served. Fictional commits and repo.
import { buildId, buildVersion } from '../shared/build.ts'
import { STAMP_ID, stampJson, type Stamp } from '../shared/build-stamp.ts'

export const BUILDS = ['release', 'ahead', 'older'] as const
export type DemoBuild = (typeof BUILDS)[number]

const REPO = 'https://github.com/example/shepherdr'
const sha = (start: string) => start + '0'.repeat(40 - start.length)
// newest first, as the stamp lists them
const CHANGES = [
  'Settings: the About sheet names the build that runs (#44)',
  'Usage notes: remove the leftovers (#38)',
  'Nothing to merge: no card unless you are needed, and say why (#32)',
  'Review rounds and Must fix back in Settings › Tasks (#13)',
  'Held as writing when not (#15)',
  'Notices never stop work (#8)',
  'Sync: the install step checks its terminal (#25)',
  'Sync: install and roll back (#18)',
  'Sync: the trial (#16)',
  'Sync: CI and state (#14)',
  'Sync: release and gates (#17)',
  'Spec the upstream sync (#10)',
]

const stamp = (tag: string, changes: string[], commit: string): Stamp => ({ tag, ahead: changes.length, commit: sha(commit), repo: REPO, changes: changes.slice(0, 10), more: Math.max(0, changes.length - 10) })

export const demoBuild = (b: string | undefined): DemoBuild | null => (BUILDS as readonly string[]).includes(b ?? '') ? (b as DemoBuild) : null

/** this device's index.html and the build the demo's "service" serves */
export function demoBuilds(kind: DemoBuild, html: string): { page: string; served: string } {
  const v = buildVersion(html)
  const tag = `v${v}`
  const device = kind === 'release' ? stamp(tag, [], '46e58cc') : kind === 'ahead' ? stamp(tag, CHANGES, '9fedf5c') : stamp(tag, CHANGES.slice(3), '4b1d2e7')
  const served = kind === 'older' ? stamp(tag, CHANGES, '9fedf5c') : device
  const put = (s: Stamp) => html.replace(new RegExp(`<script[^>]*id="${STAMP_ID}"[^>]*>[^<]*</script>`), '').replace('</head>', `<script type="application/json" id="${STAMP_ID}">${stampJson(s)}</script></head>`)
  const there = put(served)
  return {
    page: put(device),
    served: JSON.stringify({ type: 'build', id: buildId(there), version: v, stamp: { tag: served.tag, ahead: served.ahead, commit: served.commit, repo: served.repo } }),
  }
}
