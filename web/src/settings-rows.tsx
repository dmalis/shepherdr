// What other parts use of the settings window without opening it (fork #163): its page names, a row, the small
// print under a space's value. The window itself (settings.tsx) comes when first opened (later.tsx).
import type { ReactNode } from 'react'
import type { IconName } from './icons.ts'
import { tryAct } from './kernel.ts'
import { cx } from './ui.tsx'

export const ALL: [string, IconName][] = [['General', 'gear'], ['Notifications', 'bell'], ['Agents', 'agent'], ['Tasks', 'tasks'], ['Secrets', 'key'], ['Machines', 'server'], ['Usage', 'gauge'], ['Plugins', 'plug'], ['About', 'info']]

/** a settings row: a label and a control */
export function SRow({ label, wrap, children }: { label: ReactNode; wrap?: boolean; children?: ReactNode }) {
  return (
    <div className={cx('srow', wrap && 'wrap')}>
      <span className="n">{label}</span>
      {children}
    </div>
  )
}

const set = (place: string, key: string, value: unknown) => tryAct({ type: 'config', place, key, value })

/** the small print under a space's value: "Same as Everything", or "Set here" with Reset beside it */
export function Own({ place, own, k }: { place: string; own: boolean; k: string }) {
  if (place === 'all') return null
  return (
    <small>
      {own ? (
        <>
          Set here · <span className="lk" role="button" tabIndex={0} onClick={() => void set(place, k, null)} onKeyDown={(e) => e.key === 'Enter' && void set(place, k, null)}>Reset</span>
        </>
      ) : (
        'Same as Everything'
      )}
    </small>
  )
}
