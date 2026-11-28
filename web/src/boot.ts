// How the page starts (fork #163): nothing waits in line. Which plugins are off is asked and the live link opened at
// once, while the plugins that load on their own come in side by side; they are installed in the list's order.
import { pluginFailed } from './guard.tsx'
import { getState, installPlugins, registry, takeEarlyWake, type ClientPlugin } from './kernel.ts'

export type Entry = ClientPlugin | { name: string; load: () => Promise<{ default: ClientPlugin }> }

export interface Boot {
  plugins: Entry[]
  enabled: string[]
  user: string[]
  /** asks the service which plugins are switched off (api/me) */
  me: () => Promise<Response>
  /** opens the live link */
  connect: () => void
  install?: typeof installPlugins
  /** the plugins the live link's snapshot says are off, once one came */
  live?: () => string[] | undefined
  /** a call asked for over the link before Voice was in */
  woke?: () => boolean
}

/** the plugins switched off in Settings › Plugins, as installed: their buttons, menu items and settings are gone */
export async function boot({ plugins, enabled, user, me, connect, install = installPlugins, live = () => getState().snap?.off, woke = takeEarlyWake }: Boot): Promise<string[]> {
  const off = me()
    .then(async (r) => ((await r.json()) as { off?: string[] }).off ?? [])
    // the link is down: every plugin, until the first snapshot says otherwise
    .catch(() => [] as string[])
  connect()
  const loaded = await Promise.all(
    plugins.map((p) =>
      'setup' in p
        ? p
        : p.load().then(
            (m) => m.default,
            (e: unknown) => (pluginFailed(p.name, e), null),
          ),
    ),
  )
  const asked = await off
  // the link opened first and its snapshot came while the plugins loaded: it is the newer word (and api/me may have
  // failed); one that comes later is checked against this by the kernel, which starts the page again if they differ
  const offNow = live() ?? asked
  ;(globalThis as { shepherdrOff?: string[] }).shepherdrOff = offNow
  install(
    loaded.filter((p): p is ClientPlugin => !!p && !offNow.includes(p.name)),
    enabled.filter((n) => !offNow.includes(n)),
    user,
  )
  if (woke()) registry.voiceWake?.()
  return offNow
}
