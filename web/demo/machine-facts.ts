// The demo's machine facts (dmalis/shepherdr#107): what machine.py and machine_system.py would send for each made-up
// machine. mac-mini serves the app and is fine; vm needs attention (its disk is nearly full, an update waits for a
// restart and its herdr-core is older); studio is fine; pi can't be reached.
import type { Machine } from '../shared/types.ts'

const GiB = 2 ** 30
const hour = 3600_000, day = 24 * hour

type Facts = Pick<Machine, 'stats' | 'system'>
const raw = (x: { cores: number; load: number; mem: number; used: number; disks: { path: string; free: number; size: number }[] }) => ({
  cores: x.cores, load: x.load, cpu: Math.round((x.load * 100) / x.cores), mem_total: x.mem * GiB, mem_used: x.used * GiB, memory: Math.round((x.used * 100) / x.mem),
  disks: x.disks.map((d) => ({ path: d.path, pct: Math.round(((d.size - d.free) * 100) / d.size), free_gb: Math.round(d.free / GiB), free: d.free, used: d.size - d.free, size: d.size })),
})
const hold = { start_load: 1, start_memory: 80, start_disk: 90 }

export function demoFacts(now: number): Record<string, Facts> {
  return {
    'mac-mini': {
      stats: { at: now - 20_000, hold, health: raw({ cores: 10, load: 3.4, mem: 32, used: 22.7, disks: [{ path: 'home', free: 207.5e9, size: 494e9 }] }) },
      system: { at: now - 4 * 60_000, os: 'macOS 15.1', arch: 'arm64', bootAt: now - 2 * day - 5 * hour, restart: null, hc: '0.1.22', shepherdr: '3.2.22' },
    },
    vm: {
      stats: { at: now - 35_000, hold, health: raw({ cores: 8, load: 0.96, mem: 59, used: 23.6, disks: [{ path: 'home', free: 18e9, size: 200e9 }, { path: '/tmp', free: 28e9, size: 32e9 }] }) },
      system: { at: now - 6 * 60_000, os: 'Ubuntu 24.04.1 LTS', arch: 'x86_64', bootAt: now - 41 * day, restart: true, hc: '0.1.20', shepherdr: '3.2.22' },
    },
    studio: {
      stats: { at: now - 15_000, hold, health: raw({ cores: 32, load: 5.9, mem: 59, used: 26, disks: [{ path: 'home', free: 1.7e12, size: 1.78e12 }] }) },
      system: { at: now - 2 * 60_000, os: 'Ubuntu 26.04.1 LTS', arch: 'x86_64', bootAt: now - 2 * day - 3 * hour, restart: false, hc: '0.1.22', shepherdr: null },
    },
  }
}
