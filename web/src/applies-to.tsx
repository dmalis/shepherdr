// "Applies to" (SHEP-335, shared by fork #235): which level a settings page's rows set, Everything or one repo, as VS
// Code's User / Workspace scope. A searchable picker, since there can be dozens. Settings › Tasks and Settings › Triage
// share the pick (ui.settings.repo), so switching page keeps the repo you were looking at.
import { useState } from 'react'
import type { RepoConfig, Snapshot } from '@shared/types.ts'
import { machineLabel } from '@shared/view.ts'
import { setUI, useUI } from './kernel.ts'
import { openDialog } from './overlay.tsx'
import { PickerHead } from './picker.tsx'
import { I, Row } from './ui.tsx'

/** a folder as it shows: a home folder as ~ */
export const tilde = (f: string) => f.replace(/^\/(home\/[^/]+|Users\/[^/]+|root)(?=\/|$)/, '~')
export const repoMachine = (snap: Snapshot, r: RepoConfig) => machineLabel(snap, r.machine ?? snap.host)

export function RepoPicker({ snap, repos, value, onPick, close }: { snap: Snapshot; repos: RepoConfig[]; value: string | null; onPick: (key: string | null) => void; close: () => void }) {
  const [q, setQ] = useState('')
  const hit = (...words: string[]) => !q.trim() || words.join(' ').toLowerCase().includes(q.trim().toLowerCase())
  const pick = (key: string | null) => {
    onPick(key)
    close()
  }
  const machines = [...new Set(repos.map((r) => r.machine ?? snap.host))]
  const blocks = machines.map((m) => ({ m, list: repos.filter((r) => (r.machine ?? snap.host) === m && hit(r.name, r.folder, machineLabel(snap, m))) })).filter((b) => b.list.length)
  const all = hit('Everything')
  return (
    <div className="pk">
      <PickerHead title="Applies to" close={close} />
      <input className="inp" name="rq" aria-label="Search repos and folders" placeholder="Search repos and folders" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {all && <Row icon="layers" label="Everything" current={!value} end={!value ? <I n="check" /> : undefined} onClick={() => pick(null)} />}
        {blocks.map((b) => (
          <div key={b.m} style={{ display: 'contents' }}>
            <div className="lab">{machineLabel(snap, b.m)}</div>
            {b.list.map((r) => (
              <Row key={r.key} icon="folder" label={r.name} sub={tilde(r.folder)} current={value === r.key} end={value === r.key ? <I n="check" /> : undefined} onClick={() => pick(r.key)} />
            ))}
          </div>
        ))}
        {!all && !blocks.length && <p className="hint" style={{ padding: 8 }}>No repo or folder matches.</p>}
      </div>
    </div>
  )
}

/** the repo the page shows now (ui.settings.repo), when it is one of `repos` */
export function useAppliesTo(snap: Snapshot, repos: RepoConfig[] = snap.config?.repos ?? []): RepoConfig | undefined {
  const key = useUI((u) => u.settings?.repo)
  return key ? repos.find((r) => r.key === key) : undefined
}

/** The page's Applies to field: Everything, or the repo picked; it opens the picker. repos: the ones this page can set
 *  (all of them unless said). */
export function AppliesTo({ snap, repo, repos }: { snap: Snapshot; repo: RepoConfig | undefined; repos?: RepoConfig[] }) {
  const s = useUI((u) => u.settings)!
  const name = repo ? repo.name : 'Everything'
  const where = repo ? `${tilde(repo.folder)}${repo.machine ? ` · ${repoMachine(snap, repo)}` : ''}` : ''
  return (
    <div className="fld">
      <span>Applies to</span>
      <button type="button" className="fake" aria-label={`Applies to ${name}. Change`}
        onClick={() => openDialog((close) => <RepoPicker snap={snap} repos={repos ?? snap.config?.repos ?? []} value={repo?.key ?? null} close={close} onPick={(key) => setUI({ settings: { ...s, repo: key } })} />, { wide: true, bare: true, label: 'Applies to' })}>
        <I n={repo ? 'folder' : 'layers'} />
        <span className="n"><b>{name}</b> {where && <span>{where}</span>}</span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}
