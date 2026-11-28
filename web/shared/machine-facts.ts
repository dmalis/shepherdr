// What Settings › Machines says of each machine (dmalis/shepherdr#107): its meters' amounts, its system facts, and what
// needs the person's attention, in plain words. The page (web/src/machine-card.tsx) and the warnings line
// (service/next.ts warningsOf) both say it from here. Units as macOS gives them: disks in decimal GB and TB (Finder, About
// This Mac › Storage), memory in GB of 2^30 bytes (About This Mac › Memory, Activity Monitor).
import type { Machine } from './types.ts'

export type Status = 'ok' | 'attention' | 'off' | 'reading'

const ALERT = 90 // a disk or memory past this: nearly full (core/machines.js ALERT)

/** one decimal under 10, whole numbers above: 4.2, 59, 1.7 */
const num = (n: number) => (n < 9.95 ? String(Math.round(n * 10) / 10) : String(Math.round(n)))

/** a disk's size, decimal as Finder shows it: "512 GB", "1.7 TB", "820 MB" */
export function diskSize(bytes: number): string {
  if (bytes >= 999.5e9) return `${num(bytes / 1e12)} TB`
  if (bytes >= 0.9995e9) return `${num(bytes / 1e9)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/** memory, in GB as macOS counts it (2^30 bytes) */
export const memSize = (bytes: number) => `${num(bytes / 2 ** 30)} GB`

/** "1.7 TB free of 1.8 TB", "33 of 59 GB free": the second unit only when the two differ */
function freeOf(free: string, total: string) {
  const [fn, fu] = free.split(' '), [tn, tu] = total.split(' ')
  return fu === tu ? `${fn} of ${tn} ${tu} free` : `${free} free of ${total}`
}

/** "2 days", "5 hours", "12 minutes" */
export function upWords(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000))
  if (min < 60) return min === 1 ? '1 minute' : `${min} minutes`
  const h = Math.floor(min / 60)
  if (h < 24) return h === 1 ? '1 hour' : `${h} hours`
  const d = Math.floor(h / 24)
  return d === 1 ? '1 day' : `${d} days`
}

/** -1, 0, 1: a before b, the same, after (numbers part by part: 3.2.9 before 3.2.10) */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** one disk as machine.py reads it: `pct` the fuller of its space and its file slots, `by` which one (an older probe
 *  sends neither `by` nor `files_pct`: space alone) */
type Disk = { path: string; pct: number; free_gb?: number; free?: number; used?: number; size?: number; by?: 'space' | 'files'; space_pct?: number; files_pct?: number; fullest?: boolean }
type Raw = { cores?: number; load?: number; mem_total?: number; mem_used?: number; disks?: Disk[] }
const rawOf = (m: Machine): Raw => (m.stats?.health ?? {}) as Raw

/** "Home", "/tmp" */
export const diskName = (d: { path: string }) => (d.path === 'home' ? 'Home' : d.path)

export interface Gauge {
  key: 'cpu' | 'memory' | 'disk'
  name: string
  /** its name in the card's header, where three sit side by side: CPU, Memory, Disk */
  short: string
  pct: number | undefined
  /** ok, busy (over its start limit), over (past its alert limit) */
  level: 'ok' | 'busy' | 'over'
  /** its amounts under the bar, one short line each: "8.0 load · 32 cores", "41 of 59 GB free", a line per disk */
  lines: string[]
  /** the fullest disk, when its file slots (not its space) make it so: "/tmp" */
  files?: string
}

/** Processor, Memory and Disk with their amounts: the meters upstream reads (load as a share of the cores, #1092) */
export function gauges(m: Machine): Gauge[] {
  const meter = (re: RegExp) => m.health?.meters.find((x) => re.test(x.name))
  const raw = rawOf(m)
  const lv = (x: { level?: string } | undefined) => (x?.level === 'over' || x?.level === 'busy' ? x.level : 'ok') as Gauge['level']
  const cpu = meter(/cpu|processor|load/i), mem = meter(/mem/i), disk = meter(/disk/i)
  const cpuLine = typeof raw.load === 'number' && raw.cores ? `${raw.load.toFixed(1)} load · ${raw.cores} ${raw.cores === 1 ? 'core' : 'cores'}` : ''
  const memLine = raw.mem_total ? freeOf(memSize(Math.max(0, raw.mem_total - (raw.mem_used ?? 0))), memSize(raw.mem_total)) : ''
  // fullest first: the reading marks it by its unrounded share, where two round alike
  const disks = [...(raw.disks ?? [])].sort((a, b) => b.pct - a.pct || Number(!!b.fullest) - Number(!!a.fullest))
  const named = disks.length > 1 || disks.some((d) => d.by === 'files')
  const diskLine = (d: Disk) => {
    const free = typeof d.free === 'number' ? diskSize(d.free) : typeof d.free_gb === 'number' ? `${d.free_gb} GB` : ''
    // one disk, full by its space: free of its size (as Finder); else each named with its share, "(files)" when its
    // file slots fill it first, the fullest first (the meter shows it)
    if (!named) return typeof d.free === 'number' && d.size ? freeOf(diskSize(d.free), diskSize(d.size)) : free ? `${free} free` : ''
    return `${diskName(d)} ${d.pct}%${d.by === 'files' ? ' (files)' : ''}${free ? ` · ${free} free` : ''}`
  }
  const full = disks[0]?.by === 'files' ? diskName(disks[0]) : undefined
  return [
    { key: 'cpu', name: 'Processor', short: 'CPU', pct: cpu?.pct, level: lv(cpu), lines: cpuLine ? [cpuLine] : [] },
    { key: 'memory', name: 'Memory', short: 'Memory', pct: mem?.pct, level: lv(mem), lines: memLine ? [memLine] : [] },
    { key: 'disk', name: 'Disk', short: 'Disk', pct: disk?.pct, level: lv(disk), lines: disks.map(diskLine).filter(Boolean), ...(full ? { files: full } : {}) },
  ]
}

/** the machine that serves the app: the one the others' versions are held against */
export const servingOf = (machines: Machine[]) => machines.find((x) => x.here)

/** What needs the person, each in a few plain words: a nearly full disk or memory, a restart waiting, an older version.
 *  `id` keys it (the warnings line's dismissal). */
export function attention(m: Machine, serving?: Machine): { id: string; words: string }[] {
  const out: { id: string; words: string }[] = []
  const g = gauges(m)
  const dg = g.find((x) => x.key === 'disk'), disk = dg?.pct, mem = g.find((x) => x.key === 'memory')?.pct
  // full by its file slots: which disk, since its space may look fine ("Disk 100% full (/tmp's file slots)")
  if (typeof disk === 'number' && disk > ALERT) out.push({ id: 'disk', words: `Disk ${Math.round(disk)}% full${dg?.files ? ` (${dg.files}'s file slots)` : ''}` })
  if (typeof mem === 'number' && mem > ALERT) out.push({ id: 'memory', words: `Memory ${Math.round(mem)}% in use` })
  const s = m.system, there = serving && serving.machine !== m.machine ? serving.system : undefined
  if (s?.restart) out.push({ id: 'restart', words: 'Restart needed to finish updates' })
  if (s?.shepherdr && there?.shepherdr && compareVersions(s.shepherdr, there.shepherdr) < 0)
    out.push({ id: 'shepherdr', words: `Shepherdr ${s.shepherdr} is older than ${serving!.name}'s ${there.shepherdr}` })
  if (s?.hc && there?.hc && compareVersions(s.hc, there.hc) < 0)
    out.push({ id: 'hc', words: `herdr-core ${s.hc} is older than ${serving!.name}'s ${there.hc}` })
  return out
}

/** its words inside a sentence: "disk 91% full", but Shepherdr keeps its capital */
const lower = (a: { id: string; words: string }) => (a.id === 'shepherdr' ? a.words : a.words[0]!.toLowerCase() + a.words.slice(1))

export function statusOf(m: Machine, serving?: Machine): Status {
  if (m.status === 'off' && !m.connecting) return 'off'
  if (attention(m, serving).length) return 'attention'
  return m.health || m.system ? 'ok' : 'reading'
}

export const STATUS_WORDS: Record<Status, string> = { ok: 'OK', attention: 'Needs attention', off: "Can't reach", reading: 'Reading…' }

/** how long it has been up, now */
export const upOf = (m: Machine, now = Date.now()) => (typeof m.system?.bootAt === 'number' ? upWords(now - m.system.bootAt) : null)

/** A phone card's one line, its status first: "OK · disk 4% · up 2 days", "Needs attention · disk 91% full",
 *  "Can't reach · last seen 14:02". */
export function summaryOf(m: Machine, serving?: Machine, now = Date.now()): string {
  const st = statusOf(m, serving)
  const rest = st === 'off' ? (m.unreachableSince ? `last seen ${m.unreachableSince}` : '')
    : st === 'attention' ? attentionWords(m, serving)
    : [((d) => (typeof d === 'number' ? `disk ${Math.round(d)}%` : ''))(gauges(m).find((x) => x.key === 'disk')?.pct), ((u) => (u ? `up ${u}` : ''))(upOf(m, now))].filter(Boolean).join(' · ')
  return [STATUS_WORDS[st], rest].filter(Boolean).join(' · ')
}

/** all it needs, inside a sentence: "disk 91% full · restart needed to finish updates" (the Machines page's banner) */
export const attentionWords = (m: Machine, serving?: Machine) => attention(m, serving).map(lower).join(' · ')

/** The warnings line's machine entries this adds to upstream's (disk and memory, can't reach): a restart waiting and
 *  an older version. */
export function moreWarnings(machines: Machine[]): { id: string; kind: 'machine'; text: string }[] {
  const serving = servingOf(machines)
  return machines.filter((m) => !(m.status === 'off' && !m.connecting)).flatMap((m) => [
    // upstream's line says the first full one of memory and disk; the other too, in its words, dismissed on its own
    ...(m.health?.meters ?? []).filter((x) => /disk|memory/i.test(x.name) && x.pct > ALERT).slice(1)
      .map((x) => ({ id: `m:${m.machine}:${x.name.toLowerCase()}`, kind: 'machine' as const, text: `${m.name}: ${/disk/i.test(x.name) ? 'disk' : 'memory'} nearly full` })),
    ...attention(m, serving).filter((a) => a.id !== 'disk' && a.id !== 'memory').map((a) => ({ id: `m:${m.machine}:${a.id}`, kind: 'machine' as const, text: `${m.name}: ${lower(a)}` })),
  ])
}
