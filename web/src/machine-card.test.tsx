import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Machine, MachineHealth } from '@shared/types.ts'
import { LimitBar, MachineCard, type MachineCardProps } from './machine-card.tsx'

// Machines: more health facts, clearer cards (dmalis/shepherdr#107): the card's parts on a computer and a phone, and the
// upstream seams it hangs on in settings.tsx.

const GiB = 2 ** 30, NOW = 1_800_000_000_000, day = 86_400_000
const meters = (disk: number): MachineHealth => ({ engine: 'core' as const, herdr: true, working: 0, held: 0, at: '',
  meters: [{ name: 'CPU', pct: 18, detail: '', level: 'ok' }, { name: 'Memory', pct: 44, detail: '', level: 'ok' }, { name: 'Disk', pct: disk, detail: '', level: disk > 90 ? 'over' : 'ok' }] })
const vps: Machine = {
  id: 'm:vps', machine: 'vps', name: 'vps', status: 'idle', health: meters(4),
  stats: { at: NOW, health: { cores: 32, load: 5.88, mem_total: 59 * GiB, mem_used: 26 * GiB, disks: [{ path: 'home', pct: 4, free: 1.7e12, size: 1.78e12 }] } },
  system: { at: NOW, os: 'Ubuntu 26.04.1 LTS', arch: 'x86_64', bootAt: NOW - 2 * day, restart: false, hc: '0.1.20', shepherdr: null },
}
const mini: Machine = { id: 'm:mini', machine: 'mini', name: 'mini', status: 'idle', here: true, system: { at: NOW, os: 'macOS 15.1', arch: 'arm64', bootAt: NOW - day, restart: null, hc: '0.1.22', shepherdr: '3.2.22' } }
const limits = [{ name: 'Processor', value: '100%', off: false }, { name: 'Memory', value: '80%', off: false }, { name: 'Disk', value: '90%', off: true }]
const card = (x: Partial<MachineCardProps> = {}) => renderToStaticMarkup(
  <MachineCard m={vps} serving={mini} role="Linked" agents={3} working={2} limits={limits} foldable={false} read="Read just now" now={NOW} {...x} />)

test('a computer: header with its role, work and status words, then Health and System, open', () => {
  const html = card()
  expect(html).toContain('<span class="nm" id="mc-m_vps-n">vps</span>')
  expect(html).toContain('<span class="mc-h2">Linked · 3 agents · 2 working</span>')
  expect(html).toContain('class="mc-dot attention"')
  expect(html).toContain('<span class="mc-hst" id="mc-m_vps-s">Needs attention</span>')
  expect(html).not.toContain('aria-expanded')
  expect(html).toContain('<h4>Health<span>Read just now</span></h4>')
  for (const s of ['5.9 load · 32 cores', '33 of 59 GB free', '1.7 of 1.8 TB free']) expect(html).toContain(s)
  // its start limit is the mark on its bar in the header, said to screen readers; no line of words for it
  expect(html).toContain('<dt>Memory</dt><dd><span>33 of 59 GB free</span><span class="mc-sr">Start limit 80%</span></dd>')
  // the three numbers are said once, in the header: Health holds only their amounts
  expect(html).not.toContain('Processor')
  expect(html.match(/>44%</g)?.length).toBe(1)
  for (const s of ['Limit 80%', 'No limit', 'Limit 100%']) expect(html).not.toContain(s)
  // its work is said once, in the header
  expect(html).not.toContain('<dt>Agents</dt>')
  expect(html).not.toContain('<dt>Role</dt>')
  expect(html).toContain('<dt>OS</dt><dd>Ubuntu 26.04.1 LTS<span class="mc-fx"> · x86_64</span></dd>')
  expect(html).toContain('<dt>Up</dt><dd>2 days</dd>')
  expect(html).toContain('<dt>Restart</dt><dd>Not needed</dd>')
  // older than the machine serving the app: said in the header's list and on its row
  expect(html).toContain("herdr-core 0.1.20 is older than mini&#x27;s 0.1.22")
  expect(html).toContain('<dt>herdr-core</dt><dd class="c-busy">0.1.20 · mini has 0.1.22</dd>')
  // no Shepherdr installed there: no row, never a guess
  expect(html).not.toContain('<dt>Shepherdr</dt>')
})

test('every enabled start limit is marked on its bar; none when off', () => {
  expect(renderToStaticMarkup(<LimitBar pct={44} level="ok" limit={80} />)).toContain('<b style="--at:80%"></b>')
  expect(renderToStaticMarkup(<LimitBar pct={44} level="ok" limit={100} />)).toContain('<b style="--at:100%"></b>')
  expect(renderToStaticMarkup(<LimitBar pct={44} level="ok" />)).not.toContain('<b')
  // a processor limit past its cores: the bar reaches to it, the load keeps its share of the cores
  const over = renderToStaticMarkup(<LimitBar pct={75} level="ok" limit={150} />)
  expect(over).toContain('--w:50%')
  expect(over).toContain('<b style="--at:100%"></b>')
  expect(renderToStaticMarkup(<LimitBar pct={130} level="over" />)).toContain('class="mc-bar over"')
  expect(renderToStaticMarkup(<LimitBar pct={130} level="over" />)).toContain('--w:100%')
})

test('a phone: folded to its header, the three numbers still there; a button named by the machine and its status', () => {
  const html = card({ foldable: true, m: { ...vps, system: { ...vps.system!, hc: '0.1.22' } } })
  expect(html).toContain('<h3 class="mc-hh"><button type="button" class="mc-h" aria-expanded="false" aria-controls="mc-m_vps" aria-labelledby="mc-m_vps-n mc-m_vps-s">')
  expect(html).toContain('<span class="mc-hst" id="mc-m_vps-s">OK</span>')
  expect(html).toContain('<span class="mc-h2">Linked · 3 agents · 2 working</span>')
  const body = html.indexOf('<div class="mc-body" id="mc-m_vps" hidden="">')
  expect(body).toBeGreaterThan(0)
  const glance = html.indexOf('<span class="mc-ms">')
  expect(glance).toBeGreaterThan(0)
  expect(glance).toBeLessThan(body)
  for (const [n, p] of [['CPU', 18], ['Memory', 44], ['Disk', 4]]) expect(html).toContain(`<span class="mc-ml">${n}</span><span class="num">${p}%</span>`)
})

test('the three numbers at a glance: each start limit on its small bar; amber with words past it (Machine card at a glance)', () => {
  const busy = { ...vps, health: { ...vps.health!, meters: [{ name: 'CPU', pct: 18, detail: '', level: 'ok' as const }, { name: 'Memory', pct: 86, detail: '', level: 'busy' as const }, { name: 'Disk', pct: 100, detail: '', level: 'over' as const }] },
    stats: { at: NOW, health: { ...vps.stats!.health, disks: [{ path: 'home', pct: 4, by: 'space', free: 1.7e12, size: 1.78e12 }, { path: '/tmp', pct: 100, by: 'files', free: 23e9, size: 32e9 }] } } }
  const html = card({ foldable: true, m: busy })
  const glance = html.slice(html.indexOf('<span class="mc-ms">'), html.indexOf('<div class="mc-body"'))
  expect(glance).toContain('<span class="mc-m busy"><span class="mc-ml">Memory</span><span class="num">86%</span><span class="mc-sr">, new tasks wait</span><span class="mc-bar sm busy" aria-hidden="true"><i style="--w:86%"></i><b style="--at:80%"></b></span></span>')
  expect(glance).toContain('<span class="mc-m over"><span class="mc-ml">Disk</span><span class="num">100%</span><span class="mc-sr">, over its alert limit</span>')
  expect(glance).toContain('<span class="mc-m"><span class="mc-ml">CPU</span><span class="num">18%</span><span class="mc-bar sm" aria-hidden="true"><i style="--w:18%"></i><b style="--at:100%"></b></span></span>')
  // opened: the disk full by its file slots named, and why it needs attention
  expect(html).toContain('<dt>Disk</dt><dd><span>/tmp 100% (files) · 23 GB free</span><span>Home 4% · 1.7 TB free</span><span class="c-over">Over its alert limit</span></dd>')
  expect(html).toContain("Disk 100% full (/tmp&#x27;s file slots)</li>")
  // nothing read yet: no row of dashes
  expect(card({ m: { ...vps, health: undefined, stats: undefined } })).not.toContain('mc-ms')
})

test('an unreachable machine: when it was last seen, and its link\'s why', () => {
  const html = card({ m: { ...vps, status: 'off', unreachableSince: 'Tue 9:12' }, linkWhy: 'A different herdr-core answers there now.' })
  expect(html).toContain('<span class="mc-hst" id="mc-m_vps-s">Can&#x27;t reach</span>')
  expect(html).toContain('Last seen Tue 9:12.')
  expect(html).toContain('A different herdr-core answers there now.')
  expect(html).not.toContain('<h4>Health')
  expect(html).not.toContain('mc-ms')
})

test('restart needed shows in the header and on its row', () => {
  const html = card({ m: { ...vps, system: { ...vps.system!, restart: true, hc: '0.1.22' } } })
  expect(html).toContain('Restart needed to finish updates</li>')
  expect(html).toContain('<dt>Restart</dt><dd class="c-busy">Needed to finish updates</dd>')
})

test('seams in settings.tsx: Machines draws each machine with MachineCard, start limits as before', () => {
  const src = readFileSync(new URL('./settings.tsx', import.meta.url), 'utf8')
  expect(src).toContain("import { MachineCard } from './machine-card.tsx'")
  expect(src).toMatch(/<MachineCard key=\{m\.id\} m=\{m\} serving=\{serving\}/)
  expect(src).toContain('limitsDialog(m.id)')
  expect(src).toContain('foldable={!!ph}')
  // every motion follows the Motion setting and prefers-reduced-motion
  const css = readFileSync(new URL('./machine-card.css', import.meta.url), 'utf8')
  expect(css).toContain('html[data-motion="reduced"] .mc .mc-chev{transition:none}')
  expect(css).toContain('@media(prefers-reduced-motion:reduce){.mc .mc-chev{transition:none}}')
})
