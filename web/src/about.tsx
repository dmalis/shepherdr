// Settings › About (fork patch #44): the version this device runs and the one the service serves (SHEP-337), and
// which build of it each is when that isn't exactly the release, the way `git describe` and VS Code's About say it:
// "3.2.22 · 6 changes on top · 9fedf5c", the commit opening on GitHub. The same number on another build is "newer build", so the two
// rows can be compared. The stamp is read from the build itself (web/build-stamp.ts); a build without one says only
// its version. Under the rows, a plugin's views.about: What's new (fork patch #70) lists what changed in each version.
import { aheadWords, commitUrl, exact, short, stampOf, type Stamp } from '@shared/build-stamp.ts'
import { newerServed, registry, updateNow, useStore } from './kernel.ts'
import { SRow } from './settings.tsx'
import { Btn } from './ui.tsx'
import { OWN_VERSION } from './update.ts'
import './about.css'

/** this page's own stamp: its index.html says (vite.config.ts; none under test or for a build without git) */
export const OWN_STAMP = typeof document === 'undefined' ? null : stampOf(document.head.innerHTML)

function Commit({ stamp }: { stamp: Stamp }) {
  const url = commitUrl(stamp)
  const id = short(stamp.commit)
  if (!url) return <span className="about-commit">{id}</span>
  return (
    <a className="lk about-commit" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Commit ${id}, opens on GitHub`}>
      {id}
    </a>
  )
}

/** a version and, when it isn't exactly the release, what is on top and its commit */
export function BuildWords({ version, stamp, more = true }: { version: string; stamp: Stamp | null | undefined; more?: boolean }) {
  if (!version) return <>Unknown</>
  if (!stamp || exact(stamp)) return <>{version}</>
  const on = more ? aheadWords(version, stamp) : ''
  return (
    <>
      {version}
      {on && ` · ${on}`}
      {' · '}
      <Commit stamp={stamp} />
    </>
  )
}

export function About() {
  const served = useStore((s) => s.served)
  const newer = useStore(newerServed)
  const More = registry.views.about
  return (
    <>
      <SRow label="This device" wrap>
        <span className="val"><BuildWords version={OWN_VERSION} stamp={OWN_STAMP} /></span>
      </SRow>
      <SRow label="Shepherdr serves" wrap>
        <span className="val">
          {/* the served row compares builds, so its commit shows even when the numbers are the same */}
          <BuildWords version={served?.version ?? ''} stamp={served?.stamp} more={false} />
          {newer && (served?.version && served.version === OWN_VERSION ? ' · newer build' : ' · newer')}
        </span>
      </SRow>
      {newer && (
        <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
          <Btn small onClick={updateNow}>Update this device</Btn>
        </div>
      )}
      {More && <More />}
    </>
  )
}
