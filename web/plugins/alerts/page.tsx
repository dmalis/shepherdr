// Settings › Notifications (fork Needs you 3/6): one page for what reaches this device. Its words are
// web/shared/reach.ts's. In order: why alerts can't be on here (with Turn on); Alerts on this device (Needs you, the
// default and strict; Needs you and done; Off), what the choice means under its label, as Merge's small print, and that
// new messages and warnings wait in the bell; the hand-up time (Needs you 6/6, "Ask me after") after it; the bell,
// which keeps every alert, the silent ones too; then this device's check and test alert and the devices that get
// alerts (web/plugins/inbox/device-check.tsx). A space is muted from its own menu or Settings › Space (space.tsx).
// The pattern of iOS's and Slack's notification settings: one choice for the device, the channels muted where they are.
import { notice, useSnap } from '@client/kernel.ts'
import { Choice } from '@client/choice.tsx'
import { Btn, I } from '@client/ui.tsx'
import { DeviceCheck } from '@plugins/inbox/device-check.tsx'
import { aboutOf, DEFAULT_LEVEL, OFF, WORDS } from '@shared/reach.ts'
import { choose, TELL, turnOn, useDeviceAlerts, WHY, type Tell } from './device.ts'
import { AskAfterRow } from './ask-after.tsx'

export function NotificationsPage() {
  const { now, read } = useDeviceAlerts()
  const snap = useSnap()
  const run = async (f: () => Promise<string | void>) => {
    try {
      const said = await f()
      if (said) notice(said)
    } catch (e) {
      notice(e instanceof Error ? e.message : 'That did not work. Try again.', { tone: 'error' })
    }
    await read()
  }
  const why = now && WHY[now.state]
  const tell = now?.tell ?? DEFAULT_LEVEL
  return (
    <>
      {now && now.state !== 'on' && (
        <div className="banner" style={{ margin: '0 0 4px' }}>
          <I n="bell" />
          <span className="n">{why ?? "Alerts aren't on in this browser yet"}</span>
          {now.state === 'off' && <Btn small onClick={() => void run(() => turnOn(now.tell === OFF ? undefined : now.tell))}>Turn on</Btn>}
        </div>
      )}
      <div className="srow">
        <span className="n">
          {WORDS.reach}
          <small>{aboutOf(tell)}</small>
          {tell !== OFF && <small>{WORDS.quiet}</small>}
        </span>
        <Choice<Tell> label={WORDS.reach} values={TELL} value={tell} onChange={(v) => now && void run(() => choose(v, now))} />
      </div>
      {/* Needs you 6/6: the "Ask me after" row (tasks.ask_after), Everything's, under the device's choice */}
      {snap && <AskAfterRow snap={snap} place="all" />}
      <h3>{WORDS.bell}</h3>
      <p className="hint">{WORDS.bellAbout}</p>
      <DeviceCheck now={now} reread={read} />
    </>
  )
}
