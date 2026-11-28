// Radar's calm timeline (the clickable prototype's default opening): the day as a feed of short events, newest first,
// grouped by day, with one recap line on top of each week, as Linear's Pulse, GitHub's home feed, Vercel's deployment
// list and Slack's Activity lay theirs out. What needs the person is not an event here: it is pinned above the feed
// and opens the same Needs you card. Plain rules only; the page draws it (timeline.tsx).
import type { IconName } from '@client/icons.ts'
import { needsYou, type Live, type RadarItem, type RadarProject } from './model.ts'
import { queue } from './say.ts'

const DAY = 86400_000

export interface Event {
  id: string
  at: number
  project: string
  icon: IconName
  /** a status colour for the mark: green for live, amber for being built or reverted */
  tone?: 'ok' | 'warm'
  /** a few words, then one status word (or two) */
  words: string
  status?: string
  /** what the recap counts it as */
  count?: 'fixed' | 'reverted' | 'parked' | 'declined'
  /** what a tap opens: an item, or a project (`p:<id>`) */
  open: string
}

/** when an item last changed: its return from parking, its ship, else the time kept on it, else its newest sighting */
export function eventAt(i: RadarItem, now: number): number {
  if (i.state === 'new' && i.later?.returned) return Math.min(i.later.until, i.later.soon ?? Infinity)
  return i.shipped?.at ?? i.changed ?? i.sightings?.[0]?.at ?? now
}

/** an item's one line in the timeline; one whose card still asks is pinned instead, so it has none */
export function eventOf(i: RadarItem, items: RadarItem[], projects: RadarProject[], live: Live, now: number): Event | null {
  if (needsYou(i, live)) return null
  const s = i.short ?? i.title
  const base = { id: i.id, at: eventAt(i, now), project: i.project, open: i.id }
  const paused = !!projects.find((p) => p.id === i.project)?.paused
  if (i.approved) return { ...base, icon: 'working', tone: 'warm', words: s, status: 'fix being built' }
  if (i.posted) return { ...base, icon: 'ready', words: s, status: 'posted' }
  switch (i.state) {
    case 'shipped': {
      const how = i.shipped?.how
      if (how === 'reverted') return { ...base, icon: 'reload', tone: 'warm', words: s, status: 'reverted', count: 'reverted' }
      if (how === 'merged') return { ...base, icon: 'merged', words: `${s} fixed`, status: 'not installed yet', count: 'fixed' }
      return { ...base, icon: 'check', tone: 'ok', words: `${s} fixed`, status: i.shipped?.after ? 'holding' : 'live', count: 'fixed' }
    }
    case 'running': return { ...base, icon: 'working', tone: 'warm', words: s, status: 'being fixed' }
    case 'next': {
      if (i.draft) return { ...base, icon: 'note', words: s, status: paused ? 'waits for Resume' : 'draft finished' }
      const first = queue(items, i.project)[0]?.id === i.id
      if (!first) return { ...base, icon: 'next', words: s, status: 'queued' }
      return { ...base, icon: i.trend === 'rising' ? 'up' : 'next', words: s, status: i.trend === 'rising' ? 'rising, next up' : 'next up' }
    }
    case 'held': return { ...base, icon: 'pause', words: s, status: 'held back' }
    case 'later': return { ...base, icon: 'clock', words: s, status: 'parked', count: 'parked' }
    case 'declined': return { ...base, icon: 'minus', words: s, status: 'not doing', count: 'declined' }
    case 'new': {
      if (i.later?.returned) return { ...base, icon: 'clock', words: s, status: 'came back' }
      const icon: IconName = i.kind === 'error' ? 'warn' : i.kind === 'idea' ? 'note' : i.kind === 'release' ? 'download' : 'feedback'
      return { ...base, icon, words: s, status: 'new' }
    }
  }
}

/** every event of the shown projects, newest first: the items' and each paused project's own */
export function events(items: RadarItem[], projects: RadarProject[], live: Live, now: number, project: string | null): Event[] {
  const mine = (id: string) => !project || id === project
  const out: Event[] = []
  for (const i of items) {
    if (!mine(i.project)) continue
    const e = eventOf(i, items, projects, live, now)
    if (e) out.push(e)
  }
  for (const p of projects) if (mine(p.id) && p.paused) out.push({ id: `p:${p.id}`, at: p.paused, project: p.id, icon: 'pause', words: `${p.name} paused`, open: `p:${p.id}` })
  return out.sort((a, b) => b.at - a.at)
}

export type Day = 'Today' | 'Yesterday' | 'This week' | 'Earlier'
export const DAYS: Day[] = ['Today', 'Yesterday', 'This week', 'Earlier']
/** which day group an event is in, by this device's calendar days */
export function dayGroup(at: number, now: number): Day {
  const days = Math.round((new Date(new Date(now).toDateString()).getTime() - new Date(new Date(at).toDateString()).getTime()) / DAY)
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'This week' : 'Earlier'
}

/** a number and its word, never split across lines on a narrow page ("10 fixed", not "10 / fixed") */
const NB = ' '
/** a week's one line: what it fixed, reverted, parked, said no to, and what waits for you */
export function recap(es: Event[], waits = 0): string {
  const n = (k: Event['count']) => es.filter((e) => e.count === k).length
  const bits = [
    n('fixed') ? `${n('fixed')}${NB}fixed` : '',
    n('reverted') ? `${n('reverted')}${NB}reverted` : '',
    n('parked') ? `${n('parked')}${NB}parked` : '',
    n('declined') ? `${n('declined')}${NB}not doing` : '',
    waits ? `${waits}${NB}${waits === 1 ? 'waits' : 'wait'} for you` : '',
  ].filter(Boolean)
  return bits.length ? bits.join(`${NB}· `) : `${es.length}${NB}${es.length === 1 ? 'change' : 'changes'}`
}

export interface Week { recap: string; days: { day: Day; events: Event[] }[] }
/** the feed in weeks (this week, then what came before), each in its days; empty days and weeks left out */
export function weeks(es: Event[], now: number, waits: number): Week[] {
  const by = (d: Day) => es.filter((e) => dayGroup(e.at, now) === d)
  const week = (ds: Day[], lead: string, w: number): Week | null => {
    const days = ds.map((day) => ({ day, events: by(day) })).filter((d) => d.events.length)
    const all = days.flatMap((d) => d.events)
    return all.length || w ? { recap: `${lead}: ${recap(all, w)}`, days } : null
  }
  return [week(['Today', 'Yesterday', 'This week'], 'This week', waits), week(['Earlier'], 'Before that', 0)].filter((w): w is Week => !!w)
}
