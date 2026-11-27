// A machine's groups among its spaces in no group (fork patch #31), in the sidebar's own data (shared "spaces-chat"):
// each of the machine's sections keeps the loose spaces above it as last dragged (section.after), and the list shows
// it right after the last of them (web/shared/group-slots.ts). A section with none kept shows where the one before it
// does, so data saved before this shows its groups first, as it always did. The spaces' own order stays in .order
// (core/spaces.js withOrder).

// d with a machine's list dragged into a new order: items as they show, each a loose space's id or { group: <its
// section's id> }; all: the machine's spaces in their new order, those not shown too (archived under the Active
// filter). Its sections take the order named, in the slots its sections had (other machines' stay where they are); a
// section of another machine, or one gone, is left as it was. A space not shown that was above a group stays above
// it, unless it now comes after the shown space below that group: what you can't see keeps its place.
export function withGroupSlots(d, machine, items, all = []) {
  const x = { ...(d ?? {}), sections: (d?.sections ?? []).map((s) => ({ ...s, spaces: [...(s.spaces ?? [])] })) };
  const mine = new Map(x.sections.filter((s) => (s.machine ?? null) === (machine ?? null)).map((s) => [s.id, s]));
  const named = [...new Set(items.filter((it) => it && typeof it === "object" && mine.has(it.group)).map((it) => it.group))];
  const slots = x.sections.flatMap((s, i) => (named.includes(s.id) ? [i] : []));
  named.forEach((id, k) => { x.sections[slots[k]] = mine.get(id); });
  const shown = new Set(items.filter((it) => typeof it === "string"));
  const at = new Map(all.map((id, i) => [id, i]));
  const above = [];
  for (const [k, it] of items.entries()) {
    if (typeof it === "string") { above.push(it); continue; }
    const g = it && mine.get(it.group);
    if (!g) continue;
    const below = items.slice(k + 1).find((y) => typeof y === "string");
    const hidden = (Array.isArray(g.after) ? g.after : []).filter((id) => !shown.has(id) && at.has(id) && (below === undefined || !at.has(below) || at.get(id) < at.get(below)));
    g.after = [...above, ...hidden].sort((a, b) => (at.get(a) ?? -1) - (at.get(b) ?? -1));
  }
  return x;
}
