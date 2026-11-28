// Radar's words and the page's helpers (the clickable prototype): they come with the page, not the first screen.
import type { RadarItem, RadarProject, Source, Workflow } from './model.ts'

const DAY = 86400_000

/** the queue of one project: held after the rest, each by its rank */
export const queue = (items: RadarItem[], project: string) =>
  items.filter((i) => i.project === project && (i.state === 'next' || i.state === 'held')).sort((a, b) => (a.state === 'held' ? 1 : 0) - (b.state === 'held' ? 1 : 0) || (a.rank ?? 99) - (b.rank ?? 99))

export const SOURCE: Record<Source, string> = { agents: 'Agents', github: 'GitHub', sentry: 'Sentry', upstream: 'Upstream', you: 'You' }
export const WORKFLOWS: Workflow[] = ['Start', 'Review', 'Install', 'Chat', 'Phone']

/** after a Yes on its card: posted, and a fix is being built that you review and merge (nothing waits on a merge yet) */
export const APPROVED = 'Fix being built · you’ll review and merge'

/** the words of an action that only shows a toast here: said on its button, so no one takes it for a real one */
export const PREVIEW = 'Demo preview'

export function stateWords(i: RadarItem): string {
  if (i.approved) return APPROVED
  if (i.needs) return 'Needs you'
  switch (i.state) {
    case 'new': return i.later?.returned ? 'Came back' : 'New'
    case 'next': return i.draft ? 'Draft finished' : 'Next up'
    case 'held': return 'Held back'
    case 'running': return 'Being fixed'
    case 'later': return 'Parked'
    case 'shipped': return i.shipped?.how === 'live' ? 'Live' : i.shipped?.how === 'merged' ? 'Merged · not installed yet' : 'Reverted'
    case 'declined': return 'Not doing'
  }
}

export function levelWords(p: RadarProject): string {
  if (p.level === 'none') return 'Not watched yet'
  if (p.paused) return 'Paused'
  return p.level === 'watch' ? 'Watching' : p.level === 'score' ? 'Watching and scoring' : 'On'
}

/** "14:20", "yesterday 18:40", "Tue 09:10", "12 Nov" */
export function when(t: number, now: number): string {
  const d = new Date(t), n = new Date(now)
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((new Date(n.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / DAY)
  if (days === 0) return hm
  if (days === 1) return `yesterday ${hm}`
  if (days > 0 && days < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`
  if (days < 0 && days > -8) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
