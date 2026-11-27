// What reaches a device (fork: "Needs you 3/6: one Notifications page", design v2). One place for the words and the
// rules of Settings › Notifications, the server's push (service/push.ts), the phone app's glance feed
// (service/glance.ts) and the app's own toasts (web/plugins/alerts), so all of them follow one choice:
//   Needs you           only what the person must do now (a question, a permission, a review to approve): the default
//   Needs you and done  that, and a task that is done
//   Off                 nothing reaches this device; the bell still keeps every alert
// An ordinary new message in a chat and a machine's or a schedule's warning (memory, a restart, a provider cutting off,
// a schedule that failed) never push: the bell keeps them. Space alerts: On, or Muted (only what needs you reaches a
// device from it). The app never says Assistant (docs/develop.md): it says Shepherdr.
import type { PushTopic } from './alerts.ts'

/** the device choice, its words and what each gets: its topics (alerts.ts PUSH_TOPICS) */
export const LEVELS = [
  { id: 'Needs you', topics: ['needs', 'ready'], about: 'Only what you must do: a question, a permission, a review to approve.' },
  { id: 'Needs you and done', topics: ['needs', 'ready', 'done'], about: 'That, and each task that is done.' },
] as const satisfies readonly { id: string; topics: readonly PushTopic[]; about: string }[]
export type Level = (typeof LEVELS)[number]['id']
export const OFF = 'Off' as const
export type Reach = Level | typeof OFF
export const REACH: Reach[] = [...LEVELS.map((l) => l.id), OFF]
export const DEFAULT_LEVEL: Level = 'Needs you'

/** the topics no device is ever pushed: the bell keeps them, silent */
export const BELL_ONLY: readonly PushTopic[] = ['assistant', 'ops']

/** Space alerts (a space's menu and settings): On, or Muted */
export const SPACE_ALERTS = ['On', 'Muted'] as const
export type SpaceAlerts = (typeof SPACE_ALERTS)[number]

/** the page's words, kept here so a rename is one line */
export const WORDS = {
  reach: 'Alerts on this device',
  off: 'Nothing reaches this device. The bell still keeps every alert.',
  quiet: 'New messages and machine or schedule warnings never buzz: they wait in the bell.',
  bell: 'The bell',
  bellAbout: 'Every alert of the last 7 days, the silent ones too.',
  spaceAlerts: 'Space alerts',
  spaceOn: 'Its questions and alerts reach your devices.',
  spaceMuted: 'Its chat stays quiet: no alerts, no bold for new messages. Its tasks still alert.',
  mute: 'Mute alerts',
  unmute: 'Unmute alerts',
  muted: (name: string) => `Muted alerts from ${name}`,
  unmuted: (name: string) => `Alerts from ${name} are on`,
} as const

/** what a choice means, under its label */
export const aboutOf = (t: Reach) => (t === OFF ? WORDS.off : LEVELS.find((l) => l.id === t)!.about)

/** a device's level from the topics it has, an older choice too: Done makes it Needs you and done, anything else it
 *  gets (the old Needs me, a single topic) Needs you; nothing at all: none */
export function levelOf(topics: readonly string[]): Level | null {
  if (topics.includes('done')) return 'Needs you and done'
  return topics.some((t) => t === 'needs' || t === 'ready' || t === 'assistant') ? 'Needs you' : null
}

/** the topics a device gets for a level */
export const topicsOf = (level: Level): PushTopic[] => [...LEVELS.find((l) => l.id === level)!.topics]

/** a stored choice as one of the levels: what the page shows is exactly what the device gets. The old page's Needs me
 *  (needs and ready) is Needs you, its Everything (needs, ready and done) Needs you and done; a message or warning
 *  topic from before is dropped (those never push now) */
export function canonical(topics: readonly string[]): PushTopic[] {
  const level = levelOf(topics)
  return level ? topicsOf(level) : []
}

/** the old Notify of a space (All / Needs me / Off, core/notify.js) as Space alerts: All and Needs me are On, Off is
 *  Muted */
export const spaceAlertsOfNotify = (v: unknown): SpaceAlerts => (v === 'Off' ? 'Muted' : 'On')

/** what a space's Space alerts are: its own (Settings › Space, its menu), else Everything's, else On */
export type SpaceAlertsSnap = { config?: { all: { alerts?: SpaceAlerts }; spaces: Record<string, { alerts?: SpaceAlerts }> } | null }
export const spaceAlertsOf = (snap: SpaceAlertsSnap, place: string): SpaceAlerts =>
  (snap.config?.spaces?.[place] ?? snap.config?.all)?.alerts ?? 'On'

/** how long a push service keeps an alert for a device that is off: one that waited longer is stale by then (the app
 *  shows what still waits when it opens) */
export const PUSH_TTL_S = 3600
