import { expect, test } from "bun:test";

// fork Needs you 5/6, one list: a machine that can't be read now keeps its tasks as last read, so its rows (and their
// actions, service/attention.ts) stay, saying "Can't check <machine> right now", instead of vanishing until it is back.
// A machine no longer listed is forgotten. Made-up data.

test("a machine that drops out keeps its last rows; one removed is forgotten", async () => {
  const { Model } = await import("./model.ts");
  let state = "connected", listed = true;
  const hub: any = { terminals: new Map(), on: () => () => {},
    call: async (m: string) => (m === "machine.list" ? { machines: listed ? [{ name: "vm", state }] : [] } : {}) };
  const m = new Model(hub, { put: () => {} } as any);
  (m as any).carry = async () => {};
  (m as any).readGit = async () => {};
  (m as any).readLists = async (machine: string | null) => {
    if (machine === "vm") (m as any).lists.set("vm", [{ machine: "vm", folder: "/srv/shop", slug: "shop", name: "shop", prefix: "SHOP", tasks: [{ id: 1, title: "Fix the cart", state: "working" }] }]);
    else (m as any).lists.set(null, []);
  };
  let rows: any[] = [];
  m.onBuild = (b) => { rows = b.rows; };
  await m.refresh();
  expect(rows.map((r) => [r.machine, r.title])).toEqual([["vm", "Fix the cart"]]);
  state = "disconnected";
  await m.refresh();
  expect(rows.map((r) => [r.machine, r.title])).toEqual([["vm", "Fix the cart"]]);
  listed = false;
  await m.refresh();
  expect(rows).toEqual([]);
});
