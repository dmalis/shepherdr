// dmalis/shepherdr#131: a space made at a symlinked path says its folder's real path, and holds a task working there
// (herdr-task keeps a task's folder by its real path), so "#space only" lists it. The row's words for it are tested in
// web/plugins/tasks/from-space.test.tsx.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compat } from "./compat.ts";
import { realFolder } from "./real-folder.ts";

// the temp root may itself be a link (macOS's /tmp): start from its real path
const dir = realpathSync(mkdtempSync(join(tmpdir(), "real-folder-")));
const real = join(dir, "projects", "tools");
mkdirSync(real, { recursive: true });
const link = join(dir, "tools");
symlinkSync(real, link);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const snapOf = (spaces: any[], rows: any[] = []) => {
  const c = new Compat() as any;
  c.terminalsOf = () => null;
  c.terminalsAll = () => [];
  c.agents = { cached: () => null, fresh: () => ({ sel: null, words: "", label: "", effort: "" }) };
  c.assistantPick = () => null;
  return c.snapshot({ host: "mini", user: "me", machines: [], spaces, sections: [], rows });
};
const row = (x: any) => ({ slug: "tools", id: 1, title: "A task", section: "working", machine: null, folder: real, list: "tools", kind: "repo", ...x });

test("a folder's real path only when it differs; nothing for a folder that can't be read", () => {
  expect(realFolder(link)).toBe(real);
  expect(realFolder(real)).toBeNull();
  expect(realFolder(`${real}/`)).toBeNull();
  expect(realFolder(join(dir, "gone"))).toBeNull();
  expect(realFolder("")).toBeNull();
});

test("a space made at a symlinked path says its real folder; another machine's keeps its path as given", () => {
  const { places } = snapOf([
    { id: "sp1", name: "tools", folder: link, machine: null, assistant: null },
    { id: "sp2", name: "shop", folder: join(dir, "shop"), machine: null, assistant: null },
    { id: "vm/sp3", name: "tools", folder: link, machine: "vm", assistant: null },
  ]);
  expect(places.map((p: any) => [p.id, p.folder, p.real])).toEqual([
    ["sp1", link, real],
    ["sp2", join(dir, "shop"), undefined],
    ["vm/sp3", link, undefined],
  ]);
});

test("'#tools only' lists a task in its folder by the real path: one from #shop, and one no space started", () => {
  const { tasks } = snapOf(
    [
      { id: "sp1", name: "tools", folder: link, machine: null, assistant: null },
      { id: "sp2", name: "shop", folder: join(dir, "shop"), machine: null, assistant: null },
      { id: "vm/sp3", name: "tools", folder: link, machine: "vm", assistant: null },
    ],
    [row({ ref: "T-1", space: "sp2" }), row({ ref: "T-2", space: null }), row({ ref: "T-3", space: null, machine: "vm" })],
  );
  expect([tasks[0].place, tasks[0].also]).toEqual(["sp2", ["sp1"]]);
  expect(tasks[1].place).toBe("sp1");
  // on another machine the link can't be read from here: by the path as given only
  expect(tasks[2].place).toBe("");
});

test("a space at the exact path comes before one made at a link to it, whichever is listed first", () => {
  const { tasks } = snapOf(
    [
      { id: "alias", name: "tools-link", folder: link, machine: null, assistant: null },
      { id: "exact", name: "tools", folder: real, machine: null, assistant: null },
    ],
    [row({ ref: "T-1", space: null })],
  );
  expect([tasks[0].place, tasks[0].also]).toEqual(["exact", ["alias"]]);
});
