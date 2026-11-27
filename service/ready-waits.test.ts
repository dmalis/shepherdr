import { expect, test } from "bun:test";
import { alertsOf } from "./push.ts";

// dmalis/shepherdr#29: herdr-task's nothing_to_merge, closed_alone and waits_why reach the app's task, each only in the
// state it is about (a why line on a Ready task, closed by its setting on a Done one).
test("nothing to merge, closed by its setting and why it waits reach the task", async () => {
  const { enrich } = await import("./next.ts");
  const spaces = [{ id: "sp1", folder: "/srv/app", machine: null }];
  const row = (id: number, x: any) => ({ ref: `APP-${id}`, id, title: "", folder: "/srv/app", machine: null, section: "ready", worktree: "/wt", x });
  const t = (id: number, status: string) => ({ id: `APP-${id}`, name: "", place: "sp1", status, state: status, on: "mini", created: "", age: "" });
  const why = "Waits for you: Merge in this repo is When I mark it as done.";
  const rows = [row(1, { nothing_to_merge: true, waits_why: why }), row(2, { nothing_to_merge: true, closed_alone: "auto", waits_why: why }), row(3, { waits_why: why })];
  const snap: any = { places: [{ id: "sp1", chat: "p:sp1", name: "app", machine: "mini" }], tasks: [t(1, "ready"), t(2, "done"), t(3, "work")], machines: [] };
  const f: any = { spaces, rows, archived: [], asked: () => null, reportOf: () => null, config: { plans: [], all: { agents: { Tasks: { agent: "claude" } } } } };
  const out: any = enrich(snap, f);
  const by = (id: string) => out.tasks.find((x: any) => x.id === id);
  expect(by("APP-1")).toMatchObject({ nothingToMerge: true, waitsWhy: why });
  expect(by("APP-1").closedAlone).toBeUndefined();
  expect(by("APP-2")).toMatchObject({ nothingToMerge: true, closedAlone: true });
  expect(by("APP-2").waitsWhy).toBeUndefined();
  expect(by("APP-3").waitsWhy).toBeUndefined(); // back at work: it waits for no one
});

// the phone's alert: the card's own button, and no Done alert for a task its Merge setting closed
test("a nothing-to-merge alert says Close, and one closed by its setting sends none", () => {
  const alerts = (tasks: any[]) => [...alertsOf({ places: [], tasks, needs: [], settings: [] }).values()];
  const [a] = alerts([{ id: "APP-1", name: "Check the bug", status: "ready", place: "sp1", repo: "branch", nothingToMerge: true }]);
  expect(a.actions).toEqual([{ action: "accept", title: "Close, nothing changes" }]);
  const [b] = alerts([{ id: "APP-2", name: "Search", status: "ready", place: "sp1", repo: "branch", base: "main", pr: { number: 3 } }]);
  expect(b.actions).toEqual([{ action: "accept", title: "Merge into main" }]);
  expect(alerts([{ id: "APP-3", name: "Check", status: "done", place: "sp1", nothingToMerge: true, closedAlone: true, summary: "Already fixed." }])).toEqual([]);
  expect(alerts([{ id: "APP-4", name: "Check", status: "done", place: "sp1", nothingToMerge: true, summary: "Already fixed." }]).length).toBe(1);
});
