// Fork patch #31 (Sidebar: move a space above groups): the order action under a machine takes its groups too, one
// order for groups and loose spaces, kept in the sidebar's data (core/group-slots.js). Older data (no `after`) shows as
// it always did. The pins below fail when upstream changes what the patch relies on. Fake data only; no hc.
import { expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as SP from "../core/spaces.js";
import { withGroupSlots } from "../core/group-slots.js";
import { inSlots } from "../web/shared/group-slots.ts";

const DIR = mkdtempSync(join(tmpdir(), "shep-slots-"));
mkdirSync(join(DIR, "bin"));
writeFileSync(join(DIR, "bin", "hc"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
let act: typeof import("./actions.ts").act;
const was = process.env.SHEPHERDR_HC;
beforeAll(async () => {
  process.env.SHEPHERDR_HC = join(DIR, "bin", "hc");
  ({ act } = await import("./actions.ts"));
});
afterAll(() => { if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was; });

function world() {
  const shared: Record<string, any> = {
    spaces: [{ id: "a", machine: null }, { id: "b", machine: null }, { id: "c", machine: null }, { id: "x", machine: "vm" }],
    "spaces-chat": { sections: [{ id: "g1", name: "One", machine: null, spaces: ["b"] }, { id: "v1", name: "Theirs", machine: "vm", spaces: ["vm/x"] }, { id: "g2", name: "Two", machine: null, spaces: [] }], order: { "": ["c", "a", "b"] } },
  };
  const compat: any = {
    host: "mini", data: shared,
    shared: { value: (k: string) => shared[k], set: async (k: string, v: unknown) => { shared[k] = v; } },
    allSpaces: () => shared.spaces.map((x: any) => ({ id: x.machine ? `${x.machine}/${x.id}` : x.id, machine: x.machine })),
  };
  return { hub: { terminals: new Map() } as any, compat, shared };
}
/** the machine's list as the web draws it from the saved data (sections as the snapshot names them, s:<id>) */
const drawn = (bar: any, loose: string[]) =>
  inSlots(bar.sections.filter((s: any) => s.machine === null).map((s: any) => ({ id: `s:${s.id}`, ...(s.after ? { after: s.after } : {}) })), loose.map((id) => ({ id }) as any)).map((x) => (x.group ? x.group.id : x.space.id));

test("a loose space dragged above the groups stays there; the spaces' own order and the groups' order are kept", async () => {
  const w = world();
  expect(await act(w.hub, { type: "order", under: "m:mini", ids: ["a", "s:g2", "c", "s:g1"] }, w.compat)).toEqual({ ok: true });
  const bar = w.shared["spaces-chat"];
  // the spaces' order (core/spaces.js withOrder): b is grouped and keeps its place after the one it followed
  expect(bar.order[""]).toEqual(["a", "b", "c"]);
  // the groups in the order named, in the slots the machine's had; vm's stays where it was
  expect(bar.sections.map((s: any) => s.id)).toEqual(["g2", "v1", "g1"]);
  expect(bar.sections.map((s: any) => s.after)).toEqual([["a"], undefined, ["a", "c"]]);
  expect(drawn(bar, ["a", "c"])).toEqual(["a", "s:g2", "c", "s:g1"]);
});

test("older saved data, or a drag of spaces only, shows groups first as before", async () => {
  const w = world();
  expect(drawn(w.shared["spaces-chat"], ["c", "a"])).toEqual(["s:g1", "s:g2", "c", "a"]);
  await act(w.hub, { type: "order", under: "m:mini", ids: ["a", "c"] }, w.compat);
  expect(w.shared["spaces-chat"].order[""]).toEqual(["a", "b", "c"]);
  expect(w.shared["spaces-chat"].sections.every((s: any) => s.after === undefined)).toBe(true);
});

test("another machine's group, or one gone, named in a machine's order changes nothing of it", () => {
  const bar = world().shared["spaces-chat"];
  const x = withGroupSlots(bar, null, ["a", { group: "v1" }, { group: "nope" }, { group: "g2" }]);
  expect(x.sections.map((s: any) => [s.id, s.after])).toEqual([["g1", undefined], ["v1", undefined], ["g2", ["a"]]]);
  expect(bar.sections[2].after).toBeUndefined();   // the data it was given is left as it was
});

// pins: what the patch relies on from upstream
test("pin: a section's own fields (after) survive upstream's changes to the sidebar's data", () => {
  const bar = { sections: [{ id: "g1", name: "One", machine: null, spaces: ["b"], after: ["a"] }] };
  expect(SP.withMove(bar, "b", null).sections[0].after).toEqual(["a"]);
  expect(SP.withSectionName(bar, "g1", "Uno").sections[0].after).toEqual(["a"]);
  expect(SP.withOrder(bar, null, ["a"], ["a", "b"]).sections[0].after).toEqual(["a"]);
  const gone = SP.deletedSection(bar, "g1");
  expect(SP.withRestoredSection(SP.withoutSection(bar, "g1"), gone).sections[0].after).toEqual(["a"]);
});

test("pin: the order action under a machine still keeps its spaces' order with core/spaces.js withOrder", async () => {
  const w = world();
  await act(w.hub, { type: "order", under: "m:mini", ids: ["b", "a"] }, w.compat);
  expect(w.shared["spaces-chat"].order[""]).toEqual(SP.withOrder(world().shared["spaces-chat"], null, ["b", "a"], ["a", "b", "c"]).order[""]);
});
