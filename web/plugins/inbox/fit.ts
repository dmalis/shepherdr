// UI 16, "Alerts read whole": an alert's title is one line, its kind, the task's name, then what happened
// ("Task · Bigger checkout button · Approval code"). When the line runs short, the kind gives way first, whole, so the
// name keeps its room, as Mail and Linear keep a row's subject over its label; only then is the name cut. The kind
// is left out only on screen: it stays in the row's name for screen readers.
import { useLayoutEffect, type RefObject } from 'react'

/** whether the kind must give way: the kind, the whole name and the state word don't fit in the room (px) */
export const kindGivesWay = (room: number, kind: number, name: number, state: number) => kind + name + state > room + 0.5

/** watches one title (inbox client.tsx Item): `.knd.tight` while its kind gives way, again on every change of width */
export function useKindFit(ref: RefObject<HTMLElement | null>, title: string) {
  useLayoutEffect(() => {
    const box = ref.current
    const line = box?.querySelector<HTMLElement>(':scope > .knd')
    const kd = line?.querySelector<HTMLElement>(':scope > .kd')
    const kn = line?.querySelector<HTMLElement>(':scope > .kn')
    if (!box || !line || !kd || !kn) return
    const ks = line.querySelector<HTMLElement>(':scope > .ks')
    const fit = () => {
      // scrollWidth: each part's whole words, cut or tucked away as it may be now
      const gone = kindGivesWay(box.clientWidth, kd.scrollWidth, kn.scrollWidth, ks?.scrollWidth ?? 0)
      if (line.classList.contains('tight') !== gone) line.classList.toggle('tight', gone)
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [ref, title])
}
