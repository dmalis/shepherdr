// A machine's groups and its spaces in no group, in one order (fork patch #31: a space can go above, between or below
// the groups). Each group keeps the loose spaces that were above it when it was last dragged (Section.after) and goes
// right after the last of them still shown, or at the top when none is. A group that keeps none (never dragged this
// way) goes where the group before it went, the first one at the top: an order nobody dragged is the old one, groups
// first. The service keeps it (core/group-slots.js); the spaces' own order stays the one their machine has.
import type { Place } from './types.ts'

/** one row of a machine's list: a group (its heading and its spaces), or a space in no group */
export type Slotted<G> = { group: G; space?: undefined } | { space: Place; group?: undefined }

export function inSlots<G extends { after?: string[] }>(groups: G[], spaces: Place[]): Slotted<G>[] {
  const at = new Map(spaces.map((p, i) => [p.id, i]))
  // each group's slot: after which loose space (-1: the top)
  let prev = -1
  const slots = groups.map((g) => {
    if (Array.isArray(g.after)) {
      const last = g.after.findLast((id) => at.has(id))
      prev = last === undefined ? -1 : at.get(last)!
    }
    return prev
  })
  const out: Slotted<G>[] = []
  const put = (slot: number) => groups.forEach((g, i) => slots[i] === slot && out.push({ group: g }))
  put(-1)
  spaces.forEach((p, i) => {
    out.push({ space: p })
    put(i)
  })
  return out
}

/** the spaces of a machine's list as they show, top to bottom */
export const slottedSpaces = (items: Slotted<{ spaces: Place[] }>[]): Place[] => items.flatMap((x) => (x.group ? x.group.spaces : [x.space]))
