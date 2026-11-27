// dmalis/shepherdr#131: a space made at a symlinked path says its folder's real path, so a task working there (herdr-task
// keeps a task's folder by its real path) is in its own space's folder and its row says no "from #space".
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import { realFolder } from "./real-folder.ts";
import { fromSpace } from "../web/plugins/tasks/where.tsx";
import type { Snapshot, Task } from "../web/shared/types.ts";

const dir = mkdtempSync(join(tmpdir(), "real-folder-"));
const real = join(dir, "projects", "tools");
mkdirSync(real, { recursive: true });
const link = join(dir, "tools");
symlinkSync(real, link);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const snapOf = (spaces: any[]) => {
  const c = new Compat() as any;
  c.terminalsOf = () => null;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  return c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows: [] }) as Snapshot;
};
const task = (place: string, folder: string, on = "mini"): Task =>
  ({ id: "T-1", name: "A task", place, status: "work", state: "work", on, created: "", age: "", work: { name: "tools", folder, repo: true } }) as Task;

test("a folder's real path only when it differs; nothing for a folder that can't be read", () => {
  expect(realFolder(link)).toBe(real);
  expect(realFolder(real)).toBeNull();
  expect(realFolder(`${real}/`)).toBeNull();
  expect(realFolder(join(dir, "gone"))).toBeNull();
  expect(realFolder("")).toBeNull();
});

test("a space made at a symlinked path: a task in its real folder is in its own space's folder, no 'from'", () => {
  const snap = snapOf([
    { id: "sp1", name: "tools", folder: link, machine: null, assistant: null },
    { id: "sp2", name: "shop", folder: join(dir, "shop"), machine: null, assistant: null },
  ]);
  const tools = snap.places.find((p) => p.id === "sp1")!;
  expect([tools.folder, tools.real]).toEqual([link, real]);
  expect(snap.places.find((p) => p.id === "sp2")!.real).toBeUndefined();
  // started in #tools, working in its folder by the real path herdr-task keeps: no "from"
  expect(fromSpace(snap, task("sp1", real))).toBe("");
  // by the path as given, the same
  expect(fromSpace(snap, task("sp1", link))).toBe("");
  // started in #shop, working in the tools folder: "from #shop"
  expect(fromSpace(snap, task("sp2", real))).toBe("#shop");
});

test("another machine's space keeps its path as given: it can't be resolved here", () => {
  const snap = snapOf([{ id: "vm/sp1", name: "tools", folder: link, machine: "vm", assistant: null }]);
  expect(snap.places[0]!.real).toBeUndefined();
});

test("'#tools only' lists a task in its folder by the real path: one from #shop, and one no space started", () => {
  const spaces = [
    { id: "sp1", name: "tools", folder: link, machine: null, assistant: null },
    { id: "sp2", name: "shop", folder: join(dir, "shop"), machine: null, assistant: null },
    { id: "vm/sp3", name: "tools", folder: link, machine: "vm", assistant: null },
  ];
  const row = (x: any) => ({ slug: "tools", id: 1, title: "A task", section: "working", machine: null, folder: real, list: "tools", kind: "repo", ...x });
  const c = new Compat() as any;
  c.terminalsOf = () => null;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  const [fromShop, orphan, there] = c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows: [
    row({ ref: "T-1", space: "sp2" }),
    row({ ref: "T-2", space: null }),
    row({ ref: "T-3", space: null, machine: "vm" }),
  ] }).tasks as Task[];
  expect([fromShop!.place, fromShop!.also]).toEqual(["sp2", ["sp1"]]);
  expect(orphan!.place).toBe("sp1");
  // on another machine the link can't be read from here: by the path as given only
  expect(there!.place).toBe("");
});
