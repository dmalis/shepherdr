import { expect, test } from 'bun:test'
import type { Machine, MachineHealth } from './types.ts'
import { attention, attentionWords, compareVersions, diskSize, gauges, memSize, moreWarnings, statusOf, summaryOf, upWords } from './machine-facts.ts'

// Machines: more health facts, clearer cards (dmalis/shepherdr#107): the words Settings › Machines and the warnings
// line say of each machine.

const GiB = 2 ** 30, NOW = 1_800_000_000_000, day = 86_400_000
const meters = (cpu: number, mem: number, disk: number): MachineHealth => ({ engine: 'core' as const, herdr: true, working: 0, held: 0, at: '',
  meters: [{ name: 'CPU', pct: cpu, detail: '', level: 'ok' }, { name: 'Memory', pct: mem, detail: '', level: mem > 90 ? 'over' : 'ok' }, { name: 'Disk', pct: disk, detail: '', level: disk > 90 ? 'over' : 'ok' }] })
const machine = (x: Partial<Machine> = {}): Machine => ({
  id: 'm:vps', machine: 'vps', name: 'vps', status: 'idle', health: meters(18, 44, 4),
  stats: { at: NOW, health: { cores: 32, load: 5.88, mem_total: 59 * GiB, mem_used: 26 * GiB, disks: [{ path: 'home', pct: 4, free_gb: 1583, free: 1.7e12, used: 78e9, size: 1.78e12 }] } },
  system: { at: NOW, os: 'Ubuntu 26.04.1 LTS', arch: 'x86_64', bootAt: NOW - 2 * day - 3_600_000, restart: false, hc: '0.1.22', shepherdr: null },
  ...x,
})
const here: Machine = { ...machine({ id: 'm:mini', machine: 'mini', name: 'mini', here: true }), system: { at: NOW, os: 'macOS 15.1', arch: 'arm64', bootAt: NOW - day, restart: null, hc: '0.1.22', shepherdr: '3.2.22' } }

test('sizes as macOS gives them: disks decimal, memory in GB of 2^30 bytes, one decimal under 10', () => {
  expect(diskSize(1.7e12)).toBe('1.7 TB')
  expect(diskSize(494e9)).toBe('494 GB')
  expect(diskSize(4.24e9)).toBe('4.2 GB')
  expect(diskSize(999.9e9)).toBe('1 TB')
  expect(diskSize(12e12)).toBe('12 TB')
  expect(diskSize(820e6)).toBe('820 MB')
  expect(memSize(59 * GiB)).toBe('59 GB')
  expect(memSize(9.3 * GiB)).toBe('9.3 GB')
})

test('the agent\'s own answer, as the card says it: 78 GB of 1.8 TB used, 1.7 TB free, 33 of 59 GB free, up 2 days', () => {
  const [cpu, mem, disk] = gauges(machine())
  expect(cpu).toMatchObject({ name: 'Processor', pct: 18, lines: ['Load 5.9 on 32 cores'] })
  expect(mem).toMatchObject({ name: 'Memory', pct: 44, lines: ['33 of 59 GB free'] })
  expect(disk).toMatchObject({ name: 'Disk', pct: 4, lines: ['78 GB of 1.8 TB used · 1.7 TB free'] })
  expect(summaryOf(machine(), here, NOW)).toBe('OK · disk 4% · up 2 days')
})

test('two disks: each named, the fullest first; a different unit each side says both', () => {
  const m = machine({ stats: { at: NOW, health: { disks: [{ path: 'home', pct: 4, free: 1.7e12, size: 1.78e12 }, { path: '/tmp', pct: 19, free: 24e9, size: 30e9 }] } } })
  expect(gauges(m)[2]!.lines).toEqual(['/tmp 19% · 24 of 30 GB free', 'Home 4% · 1.7 of 1.8 TB free'])
  const one = machine({ stats: { at: NOW, health: { disks: [{ path: 'home', pct: 99, free: 820e6, size: 250e9 }] } } })
  expect(gauges(one)[2]!.lines).toEqual(['820 MB free of 250 GB'])
  // df -H's three: used of its whole size (blocks kept for the system in neither), then free
  const df = machine({ stats: { at: NOW, health: { disks: [{ path: 'home', pct: 58, used: 274e9, free: 207.5e9, size: 494e9 }, { path: '/tmp', pct: 13, used: 4e9, free: 28e9, size: 32e9 }] } } })
  expect(gauges(df)[2]!.lines).toEqual(['Home 58% · 274 of 494 GB used · 208 GB free', '/tmp 13% · 4 of 32 GB used · 28 GB free'])
})

test('an older probe without bytes still says what it has', () => {
  const m = machine({ stats: { at: NOW, health: { disks: [{ path: 'home', pct: 40, free_gb: 300 }] } } })
  expect(gauges(m)[2]!.lines).toEqual(['300 GB free'])
})

test('uptime in the largest whole unit', () => {
  expect(upWords(30_000)).toBe('0 minutes')
  expect(upWords(60_000)).toBe('1 minute')
  expect(upWords(5 * 3_600_000 + 1)).toBe('5 hours')
  expect(upWords(day)).toBe('1 day')
  expect(upWords(41 * day + 5)).toBe('41 days')
})

test('versions compare part by part', () => {
  expect(compareVersions('3.2.9', '3.2.10')).toBe(-1)
  expect(compareVersions('0.1.22', '0.1.22')).toBe(0)
  expect(compareVersions('3.3.0', '3.2.22')).toBe(1)
})

test('what needs attention: a nearly full disk or memory, a restart, an older version', () => {
  expect(attention(machine(), here)).toEqual([])
  expect(statusOf(machine(), here)).toBe('ok')
  const vm = machine({ health: meters(12, 93, 91), system: { ...machine().system!, restart: true, hc: '0.1.20', shepherdr: '3.2.21' } })
  expect(attention(vm, here).map((a) => a.words)).toEqual(['Disk 91% full', 'Memory 93% in use', 'Restart needed to finish updates',
    "Shepherdr 3.2.21 is older than mini's 3.2.22", "herdr-core 0.1.20 is older than mini's 0.1.22"])
  expect(statusOf(vm, here)).toBe('attention')
  expect(attentionWords(vm, here)).toBe("disk 91% full · memory 93% in use · restart needed to finish updates · Shepherdr 3.2.21 is older than mini's 3.2.22 · herdr-core 0.1.20 is older than mini's 0.1.22")
  expect(summaryOf(vm, here, NOW)).toMatch(/^Needs attention · disk 91% full/)
  // a newer one, or one the machine can't say, needs nothing; the machine serving the app is never older than itself
  expect(attention(machine({ system: { ...machine().system!, hc: '0.1.23', restart: null } }), here)).toEqual([])
  expect(attention(here, here)).toEqual([])
})

test('an unreachable machine: when it was last seen, and nothing else', () => {
  const off = machine({ status: 'off', unreachableSince: 'Tue 9:12', health: meters(0, 99, 99) })
  expect(statusOf(off, here)).toBe('off')
  expect(summaryOf(off, here, NOW)).toBe("Can't reach · last seen Tue 9:12")
  expect(moreWarnings([here, off])).toEqual([])
})

test('memory and disk both full: upstream says the first, this the other, each dismissed on its own', () => {
  const both = machine({ health: meters(12, 94, 95) })
  expect(moreWarnings([here, both])).toEqual([{ id: 'm:vps:disk', kind: 'machine', text: 'vps: disk nearly full' }])
})

test('the warnings line gets a restart and an older version (upstream already says disk, memory and can\'t reach)', () => {
  const vm = machine({ health: meters(12, 40, 91), system: { ...machine().system!, restart: true, hc: '0.1.20' } })
  expect(moreWarnings([here, vm])).toEqual([
    { id: 'm:vps:restart', kind: 'machine', text: 'vps: restart needed to finish updates' },
    { id: 'm:vps:hc', kind: 'machine', text: "vps: herdr-core 0.1.20 is older than mini's 0.1.22" },
  ])
})
