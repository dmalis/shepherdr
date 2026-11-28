// The settings window: sections on the left, rows with switches and choices on the right; on a phone a list of
// sections that each push in. 880×640 with a 200 px nav on a desktop. Opened for one space from its menu, it shows
// only Agents, Tasks and Secrets, and every row there carries small print under its value: "Same as
// Everything", or "Set here" with a Reset button beside it. A row is a label and a control: no hint lines under one.
import { useState } from 'react'
import { NotificationsPage } from '@plugins/alerts/page.tsx'
import { SpaceAlertsRow } from '@plugins/alerts/space.tsx'
import { AskAfterRow } from '@plugins/alerts/ask-after.tsx'
import type { Config, LevelConfig, RepoConfig, Snapshot } from '@shared/types.ts'
import { everything, isEverything, machineLabel, machineWarn, placeOf, spaceLabel, unreachable } from '@shared/view.ts'
import { copyText } from './copy.ts'
import type { IconName } from './icons.ts'
import { notice, openSettings, registry, setUI, tryAct, useStore, useUI } from './kernel.ts'
import { confirm, openDialog, openForm } from './overlay.tsx'
import { openPicker, pickFor, useCatalog, type Role } from './picker.tsx'
import { Appearance } from './appearance.tsx'
import { Choice as Seg } from './choice.tsx'
import { setChatSide, type Layout, type Side } from './sides.ts'
import { ReviewRows } from './review-rows.tsx'
import { About } from './about.tsx'
import { SecretList } from './secrets-list.tsx'
import { AGENT_USAGE, notRead } from '@core/agent-usage.js'
import { healthReadWords, READS } from '@core/machines.js'
import { attention, attentionWords, servingOf } from '@shared/machine-facts.ts'
import { MachineCard } from './machine-card.tsx'
import { IconButton } from './space-icon.tsx'
import { Btn, I, IB, Meter, Row, Tgl } from './ui.tsx'
import { ALL, Own, SRow } from './settings-rows.tsx'
import { AppliesTo, repoMachine, tilde } from './applies-to.tsx'
import { AgentRow } from './agent-rows.tsx'

// fork #163: the rows other parts use live in settings-rows.tsx, so this window can come when first opened
export { ALL, Own, SRow }
const SPACE: [string, IconName][] = [['Space', 'hash'], ['Agents', 'agent'], ['Tasks', 'tasks'], ['Secrets', 'key']]

const set = (place: string, key: string, value: unknown) => tryAct({ type: 'config', place, key, value })

function levelOf(c: Config, place: string): { lv: LevelConfig; own: (k: string) => boolean } {
  const sp = place === 'all' ? undefined : place.startsWith('repo:') ? c.repos?.find((r) => r.key === place.slice(5)) : c.spaces[place]
  return { lv: sp ?? c.all, own: (k) => !!sp?.own.includes(k) }
}

const SIDES: [Side, string][] = [['left', 'Chat on the left'], ['right', 'Chat on the right']]

/** SHEP-336: which side the chat is on beside a pane, for this device in the layout it is in now. A phone has no
 *  split, so no row. */
export function SidesRow({ layout, side }: { layout: Layout; side: Side }) {
  if (layout === 'phone') return null
  return (
    <SRow label="Sides" wrap>
      <Seg label="Sides" values={SIDES.map((x) => x[1])} value={SIDES.find((x) => x[0] === side)![1]} onChange={(v) => setChatSide(layout, SIDES.find((x) => x[1] === v)![0])} />
    </SRow>
  )
}

/* ---------- SHEP-335: task settings are a repo's ---------- */

/** a task's repo key, as the service keys Config.repos (its folder here, machine:folder on another machine) */
const taskRepo = (snap: Snapshot, t: { on?: string; taskFolder?: string; work?: { folder: string } }) => {
  const f = t.work?.folder ?? t.taskFolder
  return f ? (!t.on || t.on === snap.host ? f : `${t.on}:${f}`) : null
}
/** the repo a space sits on */
export const repoOfSpace = (snap: Snapshot, id: string): RepoConfig | undefined => snap.config?.repos?.find((r) => r.spaces.includes(id))
/** the repos a space's tasks work in, most tasks first, with how many; the one it sits on first, unless that isn't a repo
 *  and its tasks all work elsewhere (root, on /) */
function reposOfSpace(snap: Snapshot, id: string): [RepoConfig, number][] {
  const n = new Map<string, number>()
  // the space that asked for it (SHEP-325: `place` may be the space working in its folder)
  for (const t of snap.tasks) if ((t.asked ?? t.place) === id) { const k = taskRepo(snap, t); if (k) n.set(k, (n.get(k) ?? 0) + 1) }
  const own = repoOfSpace(snap, id)
  const used = (snap.config?.repos ?? []).filter((r) => n.has(r.key) && r.key !== own?.key).sort((a, b) => n.get(b.key)! - n.get(a.key)!)
  const git = !!snap.places.find((p) => p.id === id)?.git
  const first = own && (git || n.has(own.key) || !used.length) ? [own] : []
  return [...first, ...used].map((r) => [r, n.get(r.key) ?? 0])
}

/** A space's Tasks page: its tasks follow the repos they work in; each opens that repo's settings */
function SpaceRepos({ snap, place }: { snap: Snapshot; place: string }) {
  const list = reposOfSpace(snap, place)
  return (
    <>
      <p className="hint">Tasks get the settings of the repo they work in.</p>
      {list.map(([r, n]) => (
        <Row key={r.key} icon="folder" label={r.name} sub={`${tilde(r.folder)}${r.machine ? ` · ${repoMachine(snap, r)}` : ''}`} value={n ? `${n} ${n === 1 ? 'task' : 'tasks'}` : undefined}
          end={<I n="right" c="s16" />} onClick={() => openSettings('all', 'Tasks', r.key)} />
      ))}
      {!list.length && <div className="empty"><span>No tasks yet.</span></div>}
    </>
  )
}

// fork Needs you 3/6: the page is the alerts plugin's (web/plugins/alerts/page.tsx)
const Notifications = NotificationsPage

function Agents({ snap, place, only }: { snap: Snapshot; place: string; only?: Role[] }) {
  const c = snap.config!
  const { own } = levelOf(c, place)
  const repo = place.startsWith('repo:') ? c.repos?.find((r) => r.key === place.slice(5)) : undefined
  const machine = (repo ? repo.machine : place !== 'all' && snap.places.find((p) => p.id === place)?.machine) || snap.host
  const cat = useCatalog(machine)
  // on a repo's Tasks page: what its tasks and their reviews run on
  const name = (role: Role) => (repo ? (role === 'Tasks' ? 'Agent' : role === 'Reviews' ? 'Reviewer' : role) : role)
  const row = (role: Role, title: string) => {
    const pick = pickFor(snap, place, role)
    // fork #219: one roomy row, the whole row opens its picker (agent-rows.tsx)
    return (
      <AgentRow key={role} name={name(role)} pick={pick} cat={cat} small={place === 'all' ? null : <Own place={place} own={own(`agents.${role}`)} k={`agents.${role}`} />}
        onOpen={() => openPicker({ title, machine, pick, onChange: () => undefined, onClose: (now) => JSON.stringify(now) !== JSON.stringify(pick) && void set(place, `agents.${role}`, now) })} />
    )
  }
  const rows: [Role, string][] = [['Chats', 'Chats run on'], ['Tasks', 'Tasks run on'], ['Reviews', 'Reviews run on']]
  return <>{rows.filter(([r]) => !only || only.includes(r)).map(([r, t]) => row(r, t))}</>
}

const MERGE: [LevelConfig['merge'], string][] = [['done', 'When I mark it as done'], ['checks', 'When all checks pass'], ['now', 'Right away']]
/** under Merge: what happens to a task that changed nothing (dmalis/shepherdr#29, herdr_task/waits.py) */
export const nothingWords = (merge: LevelConfig['merge']) =>
  merge === 'done' ? 'A task that changed nothing waits for you to close it.' : 'A task that changed nothing closes by itself: what it found stays in the chat.'

function Tasks({ snap, place }: { snap: Snapshot; place: string }) {
  // a space's page: the repos its tasks work in (SHEP-335); Everywhere's: Everywhere or one repo
  const ui = useUI((u) => u.settings)
  if (place !== 'all') return <SpaceRepos snap={snap} place={place} />
  const repo = ui?.repo ? snap.config?.repos?.find((r) => r.key === ui.repo) : undefined
  return (
    <>
      <AppliesTo snap={snap} repo={repo} />
      {repo && <Agents snap={snap} place={`repo:${repo.key}`} only={['Tasks', 'Reviews']} />}
      <TaskRows snap={snap} place={repo ? `repo:${repo.key}` : 'all'} />
    </>
  )
}

function TaskRows({ snap, place }: { snap: Snapshot; place: string }) {
  const { lv, own } = levelOf(snap.config!, place)
  return (
    <>
      <SRow label={<>Review by a second agent<Own place={place} own={own('review')} k="review" /></>}><Tgl label="Review by a second agent" on={lv.review} onChange={(v) => void set(place, 'review', v)} /></SRow>
      <ReviewRows place={place} lv={lv} own={own} />
      <SRow label={<>Merge<Own place={place} own={own('merge')} k="merge" /><small>{nothingWords(lv.merge)}</small></>} wrap>
        <Seg label="Merge" values={MERGE.map((m) => m[1])} value={MERGE.find((m) => m[0] === lv.merge)?.[1] ?? MERGE[0]![1]} onChange={(v) => void set(place, 'merge', MERGE.find((m) => m[1] === v)![0])} />
      </SRow>
      <SRow label={<>Proof<Own place={place} own={own('proof')} k="proof" /></>}><Tgl label="Proof" on={lv.proof} onChange={(v) => void set(place, 'proof', v)} /></SRow>
      {/* fork Needs you 6b: a repo's own Ask me after (Everything's is on Settings › Notifications) */}
      {place.startsWith('repo:') && <AskAfterRow snap={snap} place={place} />}
    </>
  )
}

/** Add or replace a secret: its name, the value in a masked box, and who may use it. Agents use it by name and never
 *  see it. */
export function secretDialog(snap: Snapshot, place: string, name?: string, scope?: string, opts: { fresh?: boolean; done?(): void } = {}) {
  openForm(
    function Form({ close }) {
      const [n, setN] = useState(name ?? '')
      const [v, setV] = useState('')
      const level = scope ?? place
      const ok = async () => {
        const key = n.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        if (!key || !v) return
        close()
        if (await tryAct({ type: 'secret', level, name: key, value: v }, 'Saved')) opts.done?.()
      }
      return (
        <>
          <h2>{name ? `${opts.fresh ? 'Set' : 'Replace'} ${name}` : 'Add a secret'}</h2>
          <p>{level === 'all' ? 'Every space can use it.' : `Only ${secretWhere(snap, level)} can use it.`}</p>
          {!name && (
            <label className="fld">
              <span>Name</span>
              <input className="inp" name="secret-name" value={n} placeholder="GITHUB_TOKEN" autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(e) => setN(e.target.value)} />
            </label>
          )}
          <label className="fld">
            <span>Value</span>
            <input className="inp" type="password" name="secret-value" value={v} autoComplete="off" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ok()} />
          </label>
          <div className="acts">
            <Btn onClick={close}>Cancel</Btn>
            <Btn kind="pri" onClick={() => void ok()}>Save</Btn>
          </div>
        </>
      )
    },
    { label: name ? `${opts.fresh ? 'Set' : 'Replace'} ${name}` : 'Add a secret' },
  )
}

/** who may use a secret kept at a level, in words: "#shop", "agents on mini" */
const secretWhere = (snap: Snapshot, level: string) => {
  const m = /^m:(.*)$/.exec(level)
  return m ? `agents on ${m[1] ? machineLabel(snap, m[1]) : snap.host}` : spaceLabel(snap, level)
}

/** Every kept secret, by name only, never its value: Everywhere's, each machine's and each space's (a space's own
 *  page: its own), each with Replace and Remove, so a leaked key goes from a phone in two taps. */
export function Secrets({ snap, place }: { snap: Snapshot; place: string }) {
  const all = place === 'all'
  const vault = snap.settings?.find((x) => x.name === 'Secrets')?.vault
  // each with the level the service keeps it at: all, m:<machine> ('' this computer) or the space's id
  const kept = vault
    ? vault.map((e) => ({ name: e.name, level: e.scope === 'everywhere' ? 'all' : e.scope === 'machine' ? `m:${e.machine ?? ''}` : e.space ?? '' }))
    : snap.config!.secrets.map((s) => ({ name: s.name, level: s.scope }))
  const list = kept.filter((s) => s.level && (all || s.level === place))
  const remove = (s: { name: string; level: string }) =>
    confirm({
      title: `Remove ${s.name}?`,
      body: 'Agents can no longer use it. To use it again, add it again.',
      ok: 'Remove',
      danger: true,
      run: () => tryAct({ type: 'secret', level: s.level, name: s.name, value: null }, `Removed ${s.name}`),
    })
  return (
    <>
      <p className="hint">Agents use these by name and never see them.</p>
      <SecretList list={list} scope={(s) => (s.level === 'all' ? 'Every space' : `Only ${secretWhere(snap, s.level)}`)} replace={(s) => secretDialog(snap, place, s.name, s.level)} remove={remove} />

      <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <Btn small onClick={() => secretDialog(snap, place)}>Add a secret</Btn>
      </div>
    </>
  )
}

/** Adding a machine: the one command to run on the new machine; it appears in Machines and in the list once linked. */
function addMachineDialog(snap: Snapshot) {
  const cmd = snap.config?.addMachine ?? 'hc machine add <its name on your Tailscale network>'
  openDialog(
    (close) => (
      <>
        <h2>Add a machine</h2>
        <p>Run this on the machine that serves Shepherdr. The new machine shows here and in the list once it is linked.</p>
        <div className="code">
          <code>{cmd}</code>
          <IB icon="copy" label="Copy" onClick={(e) => void copyText(cmd, e.currentTarget).then((ok) => ok && notice('Copied'))} />
        </div>
        <div className="acts"><Btn onClick={close}>Close</Btn></div>
      </>
    ),
    { label: 'Add a machine' },
  )
}


type Mach = Snapshot['machines'][number]
/** #1548: the agents live on a machine now, as the Tasks list and the spaces show them: its tasks' agents and its
 *  spaces' Assistants that are working or waiting on you */
const agentsOn = (snap: Snapshot, m: Mach) =>
  snap.tasks.filter((t) => (t.on || snap.host) === m.machine && (t.status === 'work' || t.status === 'need')).length +
  snap.places.filter((p) => p.machine === m.machine && (p.status === 'work' || p.status === 'need')).length

/* ---------- #1547: a machine's start limits (herdr-task holds new tasks while it is busier) ---------- */

const LIMITS: [string, string][] = [['start_load', 'Processor'], ['start_memory', 'Memory'], ['start_disk', 'Disk']]
/** its three limit rows as the service keeps them (machine.<field>@<machine>, "local" for the one serving the app) */
function limitsOf(snap: Snapshot, m: Mach) {
  const at = m.machine === snap.host ? 'local' : m.machine
  const rows = snap.settings?.find((x) => x.name === 'Machines')?.rows ?? []
  return LIMITS.flatMap(([f, name]) => {
    const row = rows.find((r) => r.key === `machine.${f}@${at}`)
    return row ? [{ name, row, off: /^off$/i.test(row.value), own: !!row.inherits }] : []
  })
}
const setLimit = (key: string, value: string | null) => tryAct({ type: 'setting', key, value, place: 'all' })
/** the next word up or down its stepper's list (a value off the list starts from the nearest) */
function stepTo(steps: string[], value: string, by: number) {
  const n = parseFloat(value)
  let i = steps.indexOf(value)
  if (i < 0) i = steps.reduce((b, s, j) => (Math.abs(parseFloat(s) - n) < Math.abs(parseFloat(steps[b]!) - n) ? j : b), 0)
  return steps[Math.max(0, Math.min(steps.length - 1, i + by))]!
}

function limitsDialog(id: string) {
  openForm(
    function Form({ close }) {
      const snap = useStore((s) => s.snap)
      const m = snap?.machines.find((x) => x.id === id)
      const lims = snap && m ? limitsOf(snap, m) : []
      return (
        <>
          <h2>Start limits{m ? ` · ${m.name}` : ''}</h2>
          <p>New tasks wait while {m?.name ?? 'this machine'} is busier than this.</p>
          {lims.map(({ name, row, off, own }) => {
            const steps = row.steps ?? []
            const at = steps.indexOf(row.value)
            return (
              <SRow key={row.key} label={<>{name}<small>{own ? <>Set here · <span className="lk" role="button" tabIndex={0} onClick={() => void setLimit(row.key, null)} onKeyDown={(e) => e.key === 'Enter' && void setLimit(row.key, null)}>Reset</span></> : 'Default'}</small></>}>
                <span className="stp">
                  {!off && (
                    <>
                      <IB icon="minus" label={`Lower ${name}`} disabled={at === 0} onClick={() => void setLimit(row.key, stepTo(steps, row.value, -1))} />
                      <span className="num">{row.value}</span>
                      <IB icon="plus" label={`Raise ${name}`} disabled={at === steps.length - 1} onClick={() => void setLimit(row.key, stepTo(steps, row.value, 1))} />
                    </>
                  )}
                  <Tgl label={`${name} limit`} on={!off} onChange={(on) => void setLimit(row.key, on ? row.stepFrom ?? steps[steps.length - 1] ?? null : 'Off')} />
                </span>
              </SRow>
            )
          })}
          {!lims.length && <p className="hint">Its limits can't be read now.</p>}
          <div className="acts"><Btn onClick={close}>Done</Btn></div>
        </>
      )
    },
    { label: 'Start limits' },
  )
}

function Machines({ snap }: { snap: Snapshot }) {
  const ph = useUI((u) => u.phone)
  // dmalis/shepherdr#107: every machine that needs the person, with all it needs (a restart, an older version too)
  const serving = servingOf(snap.machines)
  const warns = snap.machines.filter((m) => machineWarn(m) || attention(m, serving).length)
  return (
    <>
      {warns.map((m) => (
        <div className="banner" key={m.id}>
          <I n="warn" c="c-ask" />
          <span className="n">{unreachable(m) ? `Can't reach ${m.name}${m.unreachableSince ? ` · last seen ${m.unreachableSince}` : ''}${m.linkWhy ? ' · its link is broken' : ''}` : `${m.name}: ${attentionWords(m, serving)}`}</span>
        </div>
      ))}
      {snap.machines.map((m) => {
        const off = unreachable(m)
        // #1547: each meter's start limit marked on it (new tasks wait above it), and Start limits to change them
        const lims = limitsOf(snap, m)
        const desk = !off && snap.config?.desktops?.includes(m.machine)
        return (
          <MachineCard key={m.id} m={m} serving={serving} role={m.machine === snap.host ? 'Serves this app' : 'Linked'} agents={agentsOn(snap, m)}
            working={snap.tasks.filter((t) => (t.on || snap.host) === m.machine && t.status === 'work').length}
            limits={lims.map((l) => ({ name: l.name, value: l.row.value, off: l.off }))} foldable={!!ph} linkWhy={off ? m.linkWhy : undefined}
            read={m.stats ? healthReadWords(m.stats) : undefined}
            actions={(desk || lims.length > 0) && (
              <>
                {lims.length > 0 && <Btn small onClick={() => limitsDialog(m.id)}>Start limits</Btn>}
                {desk && <Btn small onClick={() => setUI({ settings: null, pane: 'screen', scr: { key: `machine:${m.machine}`, src: 'd', drive: false }, task: null, art: null })}>Open desktop</Btn>}
              </>
            )} />
        )
      })}
      <div className="acts" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <Btn small onClick={() => addMachineDialog(snap)}>Add a machine</Btn>
      </div>
    </>
  )
}

/** A plan Shepherdr may read but can't now, with why (an ElevenLabs key without User → Read). Claude Code's and Codex's
 *  plan usage is never read: their notes stay off, and Usage says once where to see it (core/agent-usage.js). */
function noUsageOf(limits: Snapshot['machines'][number]['limits']): [string, string][] {
  return Object.entries(limits ?? {}).filter(([k, l]) => !notRead(k) && l?.state === 'no-access').map(([k, l]) => [READS[k as keyof typeof READS] ?? k, (l as { why?: string }).why ?? ''])
}

function Usage({ snap }: { snap: Snapshot }) {
  const plans = snap.config?.plans ?? []
  const noUsage = noUsageOf((snap.machines.find((m) => m.here) ?? snap.machines[0])?.limits)
  return (
    <>
      <p className="hint">{AGENT_USAGE}</p>
      {plans.map((p) => (
        <div className="mcard" key={p.name}>
          <div className="nm">{p.name}</div>
          {p.windows.map((u) => (
            <div className="um" key={u.name}>
              <span className="num">{Math.round(u.used)}%</span>
              <span>
                <span className="l1">{u.name}</span>
                <span className="l2">{u.resets}</span>
              </span>
              <span />
              <Meter pct={u.used} />
            </div>
          ))}
        </div>
      ))}
      {noUsage.map(([name, why]) => <div className="mcard" key={name}><div className="nm">{name}</div><p className="hint">{why}</p></div>)}
    </>
  )
}

function Plugins({ snap }: { snap: Snapshot }) {
  return (
    <>
      <p className="hint">Every feature is a plugin. Turn off what you don't use.</p>
      {(snap.config?.plugins ?? []).map((p) => (
        <SRow key={p.id} label={p.name}>{p.always ? <span className="val">Always on</span> : <Tgl label={p.name} on={p.on} onChange={(v) => void set('all', `plugin.${p.id}`, v)} />}</SRow>
      ))}
    </>
  )
}

/** a space's icon (Everything's too): its own button, as in Rename (web/src/space-icon.tsx) */
function IconRow({ snap, id }: { snap: Snapshot; id: string }) {
  const p = placeOf(snap, id)
  if (!p) return null
  return (
    <SRow label="Icon">
      <IconButton icon={p.emoji ?? null} root={isEverything(snap, id)} onChange={(v) => void tryAct({ type: 'rename', id, name: '', emoji: v ?? '' })} />
    </SRow>
  )
}

function Section({ snap, place, sec }: { snap: Snapshot; place: string; sec: string }) {
  const extra = registry.settings.find((s) => s.name === sec)
  if (extra) return <extra.View place={place} />
  if (sec === 'About') return <About />
  if (!snap.config) return null
  if (sec === 'General') return <><Appearance /><h3>Everything</h3><IconRow snap={snap} id={everything(snap)?.id ?? ''} /></>
  if (sec === 'Notifications') return <Notifications />
  // fork Needs you 3/6: Space alerts under the icon
  if (sec === 'Space') return <><IconRow snap={snap} id={place} /><SpaceAlertsRow snap={snap} place={place} /></>
  // a space's Agents: its own Assistant only (its tasks' agents are its repos', SHEP-335)
  if (sec === 'Agents') return <Agents snap={snap} place={place} only={place === 'all' ? undefined : ['Chats']} />
  if (sec === 'Tasks') return <Tasks snap={snap} place={place} />
  if (sec === 'Secrets') return <Secrets snap={snap} place={place} />
  if (sec === 'Machines') return <Machines snap={snap} />
  if (sec === 'Usage') return <Usage snap={snap} />
  if (sec === 'Plugins') return <Plugins snap={snap} />
  return null
}

export function SettingsWindow({ snap }: { snap: Snapshot }) {
  const s = useUI((u) => u.settings)!
  const ph = useUI((u) => u.phone)
  const space = s.scope !== 'all' && !isEverything(snap, s.scope) ? placeOf(snap, s.scope) : undefined
  const place = space ? space.id : 'all'
  const own = registry.settings.filter((x) => (space ? x.scope !== 'all' : x.scope !== 'space')).map((x) => [x.name, x.icon] as [string, IconName])
  // a plugin's own sections go before About
  const L = space ? [...SPACE, ...own] : [...ALL.slice(0, -1), ...own, ...ALL.slice(-1)]
  const title = space ? `Settings for ${spaceLabel(snap, space.id)}` : 'Settings'
  const cur = s.sec ?? (ph ? null : L[0]![0])
  const close = () => setUI({ settings: null })
  const X = <IB icon="x" label="Close settings" onClick={close} />
  const nav = L.map(([n, ic]) => <Row key={n} icon={ic} label={n} current={!ph && n === cur} end={ph ? <I n="right" c="s16" /> : undefined} onClick={() => setUI({ settings: { ...s, sec: n } })} />)
  if (ph)
    return (
      <div className="win in" role="dialog" aria-modal="true" aria-label={title}>
        {cur ? (
          <>
            <div className="hd">
              <IB icon="back" label="Back" onClick={() => setUI({ settings: { ...s, sec: null } })} />
              <div className="ttl"><span className="t1">{cur}</span></div>
              {X}
            </div>
            <div className="pg"><Section snap={snap} place={place} sec={cur} /></div>
          </>
        ) : (
          <>
            <div className="hd">
              <div className="ttl" style={{ paddingLeft: 12 }}><span className="t1">{title}</span></div>
              {X}
            </div>
            <div className="nav">{nav}</div>
          </>
        )}
      </div>
    )
  return (
    <div className="win in" role="dialog" aria-modal="true" aria-label={title}>
      <div className="nav">
        <div className="lab" style={{ paddingTop: 0 }}>{title}</div>
        {nav}
      </div>
      <div className="pg">
        <span className="x">{X}</span>
        <h2 className="ptl">{cur}</h2>
        {cur && <Section snap={snap} place={place} sec={cur} />}
      </div>
    </div>
  )
}
