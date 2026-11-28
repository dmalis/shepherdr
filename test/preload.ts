// bun test (bunfig.toml): the service's data (paths.ts DATA) in a throwaway folder before any test imports it, so no
// test writes the real ~/.herdr/shepherdr (ask-ends.json and the rest).
// The settings file too: a throwaway one unless a test names its own, and SHEPHERDR_TEST makes paths.ts refuse every
// write to the real ~/.herdr/shepherdr.json (writableSettings), so no test can change the person's settings or have
// them sent on to their Assistants and other machines.
// Herdr's app home too (HERDR_APP_HOME): a throwaway one unless a test names its own, so a module imported before a
// test points it elsewhere still lands in a throwaway (SHEP-131), and paths.ts writable() refuses the real one anyway.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// dmalis/shepherdr#216: the whole run's temp files in one folder of its own (TMPDIR, TMP and TEMP point inside it, so
// tmpdir() and the programs a test starts with process.env use it), removed when the run ends, as pytest's basetemp:
// the folders tests make never pile up in the shared temp folder (they once filled a tmpfs's inodes). Then a shep-*
// entry the run added to the shared temp folder (one made past TMPDIR) fails the run, by name; entries that were there
// before and other runs' own folders (RUN_FOLDERS) never count. test/home_guard.py does the same for the Python tests.
export const RUN_PREFIX = "shep-run-";
// what a run's own setup makes, in any version (older ones made these four and shep-test-home-* in the shared folder):
// another run's, never a test's leftover
export const RUN_FOLDERS = [RUN_PREFIX, "shep-test-home-", "shep-data-", "shep-settings-", "shep-app-", "shep-hc-"];
export function shepEntries(folder: string): string[] {
  try { return readdirSync(folder).filter((n) => n.startsWith("shep-") && !RUN_FOLDERS.some((r) => n.startsWith(r))); } catch { return []; }
}
const shared = tmpdir();
const before = new Set(shepEntries(shared));
const run = mkdtempSync(join(shared, RUN_PREFIX));
mkdirSync(join(run, "tmp"), { mode: 0o700 });
for (const v of ["TMPDIR", "TMP", "TEMP"]) process.env[v] = join(run, "tmp");
afterAll(() => {
  rmSync(run, { recursive: true, force: true });
  const left = shepEntries(shared).filter((n) => !before.has(n));
  if (left.length) throw new Error(`This test run left ${left.length} folder(s) in ${shared}: ${left.slice(0, 10).join(", ")}${left.length > 10 ? " …" : ""}. Make them under tmpdir() (the run's own), or remove them when the test ends (test/preload.ts).`);
});

process.env.SHEPHERDR_TEST = "1";
process.env.SHEPHERDR_DATA ||= mkdtempSync(join(tmpdir(), "shep-data-"));
const real = resolve(join(homedir(), ".herdr", "shepherdr.json"));
const named = process.env.HERDR_TASK_SETTINGS;
if (!named || resolve(named) === real) process.env.HERDR_TASK_SETTINGS = join(mkdtempSync(join(tmpdir(), "shep-settings-")), "shepherdr.json");
const realApp = resolve(join(homedir(), ".config", "herdr-app"));
const app = process.env.HERDR_APP_HOME;
if (!app || resolve(app) === realApp) process.env.HERDR_APP_HOME = mkdtempSync(join(tmpdir(), "shep-app-"));
// The person's own terminal, agent and herdr-core never reach a test (SHEP-147): their markers are dropped, and the
// service's hc (SHEPHERDR_HC) is a stand-in that answers nothing unless a test names its own, so no test can label,
// run or ask anything in the real core or file a card in a real chat.
for (const k of ["HC_TERMINAL_SOCKET", "HC_TERMINAL_ID", "HC_SCOPE", "HC_SOCKET", "HC_SESSION", "HERDR_BROWSER_TASK", "HERDR_ASK_CHAINED"]) delete process.env[k];
if (!process.env.SHEPHERDR_HC) {
  const hc = join(mkdtempSync(join(tmpdir(), "shep-hc-")), "hc");
  writeFileSync(hc, "#!/bin/sh\necho 'hc: no herdr-core in tests (test/preload.ts)' >&2\nexit 1\n", { mode: 0o755 });
  process.env.SHEPHERDR_HC = hc;
}
