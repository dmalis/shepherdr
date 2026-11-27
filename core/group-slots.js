// A machine's groups among its spaces in no group (fork patch #31), in the sidebar's own data (shared "spaces-chat"):
// each of the machine's sections keeps the loose spaces above it as last dragged (section.after), and the list shows
// it right after the last of them (web/shared/group-slots.ts). A section with none kept shows where the one before it
// does, so data saved before this shows its groups first, as it always did. The spaces' own order stays in .order
// (core/spaces.js withOrder).

// d with a machine's list dragged into a new order: items as they show, each a loose space's id or { group: <its
// section's id> }. Its sections take the order named, in the slots its sections had (other machines' stay where they
// are); a section of another machine, or one gone, is left as it was.
export function withGroupSlots(d, machine, items) {
  const x = { ...(d ?? {}), sections: (d?.sections ?? []).map((s) => ({ ...s, spaces: [...(s.spaces ?? [])] })) };
  const mine = new Map(x.sections.filter((s) => (s.machine ?? null) === (machine ?? null)).map((s) => [s.id, s]));
  const named = [...new Set(items.filter((it) => it && typeof it === "object" && mine.has(it.group)).map((it) => it.group))];
  const slots = x.sections.flatMap((s, i) => (named.includes(s.id) ? [i] : []));
  named.forEach((id, k) => { x.sections[slots[k]] = mine.get(id); });
  const above = [];
  for (const it of items) {
    if (typeof it === "string") above.push(it);
    else if (it && mine.has(it.group)) mine.get(it.group).after = [...above];
  }
  return x;
}
