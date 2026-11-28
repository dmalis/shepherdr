// The pickers: a choice that can grow (agents, models, machines, spaces) is a picker row (what is picked, a chevron)
// that opens a searchable list, never a row of buttons. The agent picker always shows what is picked first, then lets
// you change one thing at a time: Agent, Model, Effort, Speed and Permissions, each the same row (its label, what is
// picked, a chevron) that opens its own list, and Done.
// A sheet on a phone, a 560 px dialog on a desktop; an open list takes the form's place, with a back arrow.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { AgentPick, Catalog, CatalogAgent, CatalogModel, ChatAgent, Snapshot } from '@shared/types.ts'
import { everything, isEverything, machineLabel, machineOf, spaceName, spacesOf, unreachable } from '@shared/view.ts'
import { levelName } from '@core/agents.js'
import { act, getState, useChat } from './kernel.ts'
import { openDialog } from './overlay.tsx'
import { Btn, I, IB, Logo, Row } from './ui.tsx'
import { SpaceIcon } from './space-icon.tsx'
import { later, laterFailed } from './later.tsx'

/** fork #163: the pickers' own lists come when one first opens (picker-sheet.tsx); the rows that open them, and
 *  the words for a pick, are here from the start */
const sheets = later(() => import('./picker-sheet.tsx'))

/** what runs: the agent, its model, effort, speed and permission mode; `label`: the model's name as a running agent reports it */
export type Pick = AgentPick & { label?: string | null }

export function reportedPick(a?: ChatAgent): Pick | undefined {
  if (!a?.kind) return undefined
  return {
    agent: a.kind,
    label: a.modelLabel ?? a.planned?.modelLabel ?? null,
    model: a.model ?? a.planned?.model ?? null,
    effort: a.effort ?? a.planned?.effort ?? null,
    fast: a.speed === 'ultrafast' ? 'ultrafast' : a.speed === 'fast',
    perm: a.perm ?? null,
  }
}

/* ---------- each machine's catalog: its agents and their own models, read once and kept ---------- */

const catalogs = new Map<string, { data?: Catalog; readAt: number }>()
const catListeners = new Set<() => void>()
let catTick = 0
const catalogVersion = () => catTick

export function loadCatalog(machine: string) {
  const old = catalogs.get(machine)
  if (old && Date.now() - old.readAt < 60_000) return
  const pending = { data: old?.data, readAt: Date.now() }
  catalogs.set(machine, pending)
  act<{ ok?: boolean; catalog?: Catalog }>({ type: 'catalog', machine })
    .then((r) => {
      if (catalogs.get(machine) === pending && r.catalog) pending.data = r.catalog
    })
    .catch(() => undefined)
    .finally(() => {
      catTick++
      catListeners.forEach((l) => l())
    })
}

/** a machine's agents and models (undefined while they load) */
export function useCatalog(machine: string | undefined): Catalog | undefined {
  useSyncExternalStore(
    (l) => {
      catListeners.add(l)
      return () => void catListeners.delete(l)
    },
    catalogVersion,
    catalogVersion,
  )
  useEffect(() => {
    if (machine) loadCatalog(machine)
  }, [machine])
  return machine ? catalogs.get(machine)?.data : undefined
}

/** a new Shepherdr may know more agents: the lists are read again */
export function forgetCatalogs() {
  catalogs.clear()
  catTick++
  catListeners.forEach((l) => l())
}

export const agentOf = (cat: Catalog | undefined, id: string): CatalogAgent | undefined => cat?.agents.find((a) => a.id === id)
/** the model a pick names: by its id, else by the name the agent itself reports for it (a running agent says
 *  "claude-opus-5-5" where its menu says "opus"), else the agent's first */
export const modelOf = (a: CatalogAgent | undefined, p: Pick & { label?: string | null }): CatalogModel | undefined =>
  a?.models.find((m) => m.id === p.model)
  ?? (p.label ? a?.models.find((m) => m.name === p.label) : undefined)
  ?? (p.model ? a?.models.find((m) => m.aliases?.includes(p.model!)) : undefined)
  ?? (p.model ? undefined : (a?.models.find((m) => m.id === a.defaultModel) ?? a?.models[0]))

export const SPEEDS = { regular: 'Standard', fast: 'Fast', ultrafast: 'Ultra-fast' }
export type Speed = keyof typeof SPEEDS
export const speedOf = (p: Pick): Speed => p.fast === 'ultrafast' ? 'ultrafast' : p.fast ? 'fast' : 'regular'
export const tiersOf = (m?: CatalogModel) => ['regular', ...(['fast', 'ultrafast'] as const).filter((tier) => m?.speeds?.includes(tier))] as const
const NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi' }

/** the words a pick shows: the agent's and model's own names once the catalog has them */
export function pickWords(p: Pick, cat?: Catalog) {
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const effort = p.effort ?? m?.defaultEffort ?? a?.defaultEffort ?? ''
  const perm = p.perm && a && p.perm !== a.permDefault ? (a.perms.find((x) => x.id === p.perm)?.label ?? p.perm) : ''
  return { agent: a?.name ?? NAMES[p.agent] ?? p.agent, model: m?.name ?? p.label ?? p.model ?? '', group: m?.group ?? '', effort: levelName(effort) ?? '', speed: speedOf(p), perm }
}

/** The spoken label for settings buttons. */
function sayPick(w: ReturnType<typeof pickWords>): string {
  return [w.agent, w.model, w.effort && `${w.effort} effort`, w.speed === 'regular' ? '' : SPEEDS[w.speed], w.perm.toLowerCase()].filter(Boolean).join(', ')
}

/** A compact model and effort label with a named speed icon. */
export function PickSummary({ pick, cat, full = false }: { pick: Pick; cat?: Catalog; full?: boolean }) {
  const w = pickWords(pick, cat)
  const model = [full || !w.model ? w.agent : '', w.model].filter(Boolean).join(' · ')
  return (
    <span className="pick-summary">
      <span className="pick-model">{model}</span>
      {w.effort && <span className="pick-effort"> · {w.effort}</span>}
      {full && w.perm && <span className="pick-mode"> · {w.perm.toLowerCase()}</span>}
      <Bolts speed={w.speed} />
    </span>
  )
}

export type Role = 'Chats' | 'Tasks' | 'Reviews'

/** what a role runs on, at a level ('all', or a space's id): Settings › Agents */
export function pickFor(snap: Snapshot, level: string, role: Role): Pick {
  const c = snap.config
  // a repo's (SHEP-335: "repo:<key>"), a space's own, else Everywhere's
  const own = level.startsWith('repo:') ? c?.repos?.find((r) => r.key === level.slice(5)) : level !== 'all'
    ? (role === 'Chats' ? c?.spaces[level] : c?.repos?.find((r) => r.spaces.includes(level)) ?? c?.spaces[level])
    : undefined
  return own?.agents[role] || c?.all.agents[role] || { agent: 'claude' }
}

/* ---------- the agent picker ---------- */

export function Bolts({ speed, decorative = false }: { speed: Speed; decorative?: boolean }) {
  if (speed === 'regular') return null
  return (
    <span className="speed-bolts" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : SPEEDS[speed]} aria-hidden={decorative || undefined}>
      <I n="bolt" c="s16" />
      {speed === 'ultrafast' && <I n="bolt" c="s16" />}
    </span>
  )
}

/** the message box's agent line: the logo, the model, the effort as a quiet word, a bolt when fast (two for
 *  ultra-fast), the permission mode when it is not the agent's own default */
export function AgentLine({ pick, machine, onClick }: { pick: Pick; machine: string; onClick: () => void }) {
  const cat = useCatalog(machine)
  const w = pickWords(pick, cat)
  const ref = useRef<HTMLButtonElement>(null)
  const words = `${w.model}|${w.agent}|${w.effort}|${w.perm}|${w.speed}`
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => fitAgentLine(el)
    fit()
    if (typeof ResizeObserver === 'undefined' || !el.parentElement) return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [words])
  return (
    <button ref={ref} type="button" className="agent" aria-label={`${sayPick(w)}. Change`} onClick={onClick}>
      <Logo agent={pick.agent} name={w.agent} />
      <span className="m">{w.model || w.agent}</span>
      {w.effort && <span className="e">{w.effort}</span>}
      <Bolts speed={w.speed} decorative />
      {w.perm && <span className="e pm">· {w.perm.toLowerCase()}</span>}
      <I n="down" c="s16" />
    </button>
  )
}

/** what goes from the message box's agent line when it is short of room (SHEP-356), in this order, so the model and
 *  its effort stay whole: logo, chevron, then permission mode. */
export const AGENT_DROPS = ['logo', 'chev', 'perm'] as const

/** sets the agent line's data-drop to the fewest drops that let its words fit */
export function fitAgentLine(el: HTMLElement) {
  const cut = () => el.scrollWidth > el.clientWidth + 0.5 || [...el.querySelectorAll<HTMLElement>('.m,.e')].some((s) => s.scrollWidth > s.clientWidth + 0.5)
  for (let n = 0; n <= AGENT_DROPS.length; n++) {
    el.dataset.drop = AGENT_DROPS.slice(0, n).join(' ')
    if (!cut()) return n
  }
  return AGENT_DROPS.length
}

/** a dialog's Agent row: what is picked, a chevron; it opens the picker */
export function AgentField({ title, machine, pick, onChange }: { title: string; machine: string; pick: Pick; onChange: (p: Pick) => void }) {
  const cat = useCatalog(machine)
  const w = pickWords(pick, cat)
  return (
    <div className="fld">
      <span>Agent</span>
      <button type="button" className="fake" aria-label={`Agent: ${sayPick(w)}. Change`} onClick={() => openPicker({ title, machine, pick, onChange })}>
        <Logo agent={pick.agent} name={w.agent} />
        <span className="n">
          <b>{w.agent}</b> <span>{[w.model, w.effort, w.perm.toLowerCase()].filter(Boolean).join(' · ')}<Bolts speed={w.speed} decorative /></span>
        </span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}

export function PickerHead({ title, back, close }: { title: ReactNode; back?: () => void; close: () => void }) {
  return (
    <div className="hd">
      {back && <IB icon="back" label="Back" onClick={back} />}
      <div className="ttl" style={back ? undefined : { padding: 0 }}>
        <h2>{title}</h2>
      </div>
      <IB icon="x" label="Close" onClick={close} />
    </div>
  )
}

export type Field = 'agent' | 'model' | 'effort' | 'speed' | 'mode'

/** the agent picker's rows, in order: each one's label and what is picked; Effort, Speed and Permissions only when
 *  the agent or model has a choice there */
export function pickerRows(p: Pick, cat?: Catalog): { f: Field; label: string; value: string }[] {
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const w = pickWords(p, cat)
  const efforts = m?.efforts ?? a?.efforts ?? []
  const rows: { f: Field; label: string; value: string }[] = [
    { f: 'agent', label: 'Agent', value: w.agent },
    { f: 'model', label: 'Model', value: w.model + (w.group ? ` · ${w.group}` : '') },
  ]
  if (efforts.length) rows.push({ f: 'effort', label: 'Effort', value: w.effort })
  rows.push({ f: 'speed', label: 'Speed', value: SPEEDS[w.speed] })
  if (a?.perms.length) rows.push({ f: 'mode', label: 'Permissions', value: a.perms.find((x) => x.id === (p.perm ?? a.permDefault))?.label ?? '' })
  return rows
}

/** a short list a row opens (Effort, Speed, Permissions): its title, its choices, which one is on, and the pick
 *  each one makes */
export function choiceList(f: 'effort' | 'speed' | 'mode', p: Pick, cat?: Catalog): { title: string; items: { id: string; label: string; sub?: string; on: boolean; pick: Pick }[] } {
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const w = pickWords(p, cat)
  if (f === 'effort') {
    const efforts = m?.efforts ?? a?.efforts ?? []
    return { title: `Effort · ${w.model || w.agent}`, items: efforts.map((e) => ({ id: e, label: levelName(e) ?? e, on: levelName(e) === w.effort, pick: { ...p, effort: e } })) }
  }
  if (f === 'speed')
    return {
      title: `Speed · ${w.model || w.agent}`,
      items: tiersOf(m).map((s) => ({ id: s, label: SPEEDS[s], on: s === w.speed, pick: { ...p, fast: s === 'ultrafast' ? 'ultrafast' : s === 'fast' } })),
    }
  return {
    title: `Permissions · ${w.agent}`,
    items: (a?.perms ?? []).map((x) => ({ id: x.id, label: x.label, sub: x.about, on: (p.perm ?? a?.permDefault) === x.id, pick: { ...p, perm: x.id } })),
  }
}

export function samePick(a: Pick, b: Pick, cat?: Catalog) {
  const agent = agentOf(cat, a.agent)
  const key = (p: Pick) => modelOf(agent, p)?.id ?? p.model ?? null
  return a.agent === b.agent && key(a) === key(b) && pickWords(a, cat).effort === pickWords(b, cat).effort &&
    speedOf(a) === speedOf(b) && (a.perm ?? agent?.permDefault) === (b.perm ?? agent?.permDefault)
}

/** the model a typed name means ("sonnet", "gpt-5.5", "Opus 5.5"): by id or name, then by their start; the agent's
 *  own models first */
export function findModel(cat: Catalog, agent: string, name: string): { agent: string; model: string } | null {
  const n = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, '')
  const q = n(name)
  if (!q) return null
  const agents = [...cat.agents.filter((a) => a.id === agent), ...cat.agents.filter((a) => a.id !== agent && a.installed)]
  const rows = agents.flatMap((a) => a.models.map((m) => ({ agent: a.id, model: m.id, keys: [m.id, m.name, ...(m.aliases ?? [])].map(n) })))
  const hit = rows.find((r) => r.keys.includes(q)) ?? rows.find((r) => r.keys.some((k) => k.startsWith(q)))
  return hit ? { agent: hit.agent, model: hit.model } : null
}

export type LivePick = {
  chat: string
  update: (p: Pick) => Promise<{ current?: Pick; error?: string }>
}

/** Open the agent picker. `title` says what it sets: "This chat runs on", "Tasks run on", "The new space runs on".
 *  `typed`: the model a /model named, picked once the models are read */
export function openPicker(o: { title: string; machine: string; pick: Pick; typed?: string; onChange: (p: Pick) => void; onClose?: (p: Pick) => void; live?: LivePick }) {
  if (o.machine) loadCatalog(o.machine)
  void sheets.load().then((m) => m.openPicker(o), laterFailed)
}

/* ---------- machines and spaces ---------- */

/** a dialog's Machine row: built for dozens of machines; one you can't reach is greyed out */
export function MachineField({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const snap = getState().snap!
  const name = machineOf(snap, value)?.name ?? value
  return (
    <div className="fld">
      <span>Machine</span>
      <button type="button" className="fake" aria-label={`Machine: ${name}. Change`} onClick={() => void sheets.load().then((m) => m.openMachines(value, onChange), laterFailed)}>
        <I n="server" />
        <span className="n"><b>{name}</b></span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}

/** a dialog's Space row: spaces under their machines; its search matches either name */
export function SpaceField({ value, onChange }: { value: string; onChange: (place: string) => void }) {
  const snap = getState().snap!
  const p = snap.places.find((x) => x.id === value)
  const root = isEverything(snap, value)
  const name = root ? 'Everything' : p ? spaceName(snap, p) : ''
  const mach = p ? machineLabel(snap, p.machine) : ''
  return (
    <div className="fld">
      <span>Space</span>
      <button type="button" className="fake" aria-label={`Space: ${name} on ${mach}. Change`} onClick={() => void sheets.load().then((m) => m.openSpaces(value, onChange), laterFailed)}>
        <SpaceIcon snap={snap} id={value} />
        <span className="n"><b>{name}</b> <span>{mach}</span></span>
        <I n="right" c="s16" />
      </button>
    </div>
  )
}
