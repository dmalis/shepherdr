// Space alerts (fork Needs you 3/6): On or Muted, a space's own or Everything's (On). Set from the space's menu (Mute
// alerts, Unmute alerts) and its Settings › Space. Muted is the old Notify Off: its chat's alerts stay in the bell and
// its sidebar row stays quiet; its tasks still alert. Slack's and Linear's mute: one row in the channel's menu, the
// same choice in its settings. The words are web/shared/reach.ts's.
import { tryAct, type MenuRow } from '@client/kernel.ts'
import { Choice } from '@client/choice.tsx'
import { Own } from '@client/settings.tsx'
import { SPACE_ALERTS, spaceAlertsOf, WORDS, type SpaceAlerts } from '@shared/reach.ts'
import type { Place, Snapshot } from '@shared/types.ts'

const KEY = 'alerts'

export const setSpaceAlerts = (place: string, v: SpaceAlerts | null, done?: string) => tryAct({ type: 'config', place, key: KEY, value: v }, done)

/** what Unmute alerts writes: back to Everything's when that is On, else this space's own On (Reset goes back) */
export const unmuted = (snap: Snapshot): SpaceAlerts | null => (snap.config?.all?.alerts === 'Muted' ? 'On' : null)

/** the space menu's row: Mute alerts, or Unmute alerts while it is muted */
export function spaceAlertsRow(snap: Snapshot | null, p: Pick<Place, 'id'>, name: string): MenuRow[] {
  if (!snap?.config) return []
  const muted = spaceAlertsOf(snap, p.id) === 'Muted'
  return [
    {
      icon: 'bell',
      label: muted ? WORDS.unmute : WORDS.mute,
      run: () => void setSpaceAlerts(p.id, muted ? unmuted(snap) : 'Muted', muted ? WORDS.unmuted(name) : WORDS.muted(name)),
    },
  ]
}

/** Settings › Space's row: On or Muted, with Same as Everything or Set here · Reset */
export function SpaceAlertsRow({ snap, place }: { snap: Snapshot; place: string }) {
  if (!snap.config) return null
  const v = spaceAlertsOf(snap, place)
  const own = !!snap.config.spaces[place]?.own.includes(KEY)
  return (
    <div className="srow">
      <span className="n">
        {WORDS.spaceAlerts}
        <small>{v === 'Muted' ? WORDS.spaceMuted : WORDS.spaceOn}</small>
        <Own place={place} own={own} k={KEY} />
      </span>
      <Choice<SpaceAlerts> label={WORDS.spaceAlerts} values={SPACE_ALERTS} value={v} onChange={(x) => void setSpaceAlerts(place, x)} />
    </div>
  )
}
