// bun test (bunfig.toml): the service's data (paths.ts DATA) in a throwaway folder before any test imports it, so no
// test writes the real ~/.herdr/shepherdr (ask-ends.json and the rest).
// The settings file too: a throwaway one unless a test names its own, and SHEPHERDR_TEST makes paths.ts refuse every
// write to the real ~/.herdr/shepherdr.json (writableSettings), so no test can change the person's settings or have
// them sent on to their Assistants and other machines.
// Herdr's app home too (HERDR_APP_HOME): a throwaway one unless a test names its own, so a module imported before a
// test points it elsewhere still lands in a throwaway (SHEP-131), and paths.ts writable() refuses the real one anyway.
import { afterAll } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

// dmalis/shepherdr#216: the whole run's temp files in one folder of its own, shep-run-<pid>-* (TMPDIR, TMP and TEMP
// point inside it, so tmpdir() and the programs a test starts with process.env use it), removed when the run ends, as
// pytest's basetemp: the folders tests make never pile up in the shared temp folder (they once filled a tmpfs's
// inodes). One a killed run left (its process gone, untouched an hour) goes when the next run starts. Then a shep-*
// entry the run added to the shared temp folder (one made past TMPDIR) fails the run, by name; when another run shared
// that folder meanwhile (a live shep-run-*, or an older checkout's run, which made OLD_RUN_FOLDERS there), whose it is
// can't be told, so it only warns. test/home_guard.py does the same for the Python tests.
export const RUN_PREFIX = "shep-run-";
// what only a run's own setup made in the shared temp folder before #216: an older checkout's run is live beside this one
export const OLD_RUN_FOLDERS = ["shep-test-home-", "shep-data-", "shep-app-", "shep-hc-"];
const STALE_RUN_MS = 3600_000;
export function shepEntries(folder: string): string[] {
  try { return readdirSync(folder).filter((n) => n.startsWith("shep-") && !n.startsWith(RUN_PREFIX)); } catch { return []; }
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
}
/** when a run's folder last changed: its tmp/ changes with every folder a test makes there */
function touched(p: string): number {
  let t = 0;
  for (const x of [p, join(p, "tmp")]) try { t = Math.max(t, statSync(x).mtimeMs); } catch {}
  return t;
}
/** the other runs whose folders are here and whose process still runs (or, unnamed, changed lately) */
export function otherRuns(folder: string, me: number): string[] {
  let names: string[] = [];
  try { names = readdirSync(folder).filter((n) => n.startsWith(RUN_PREFIX)); } catch {}
  return names.filter((n) => {
    const pid = Number(/^shep-run-(\d+)-/.exec(n)?.[1] ?? 0);
    return pid !== me && (pid ? alive(pid) : Date.now() - touched(join(folder, n)) < STALE_RUN_MS);
  });
}
/** removes the folders of runs killed before their end: process gone, unchanged for STALE_RUN_MS */
export function cleanStaleRuns(folder: string, me: number): string[] {
  let names: string[] = [];
  try { names = readdirSync(folder).filter((n) => n.startsWith(RUN_PREFIX)); } catch {}
  return names.filter((n) => {
    const p = join(folder, n), pid = Number(/^shep-run-(\d+)-/.exec(n)?.[1] ?? 0);
    try { if (pid === me || (pid && alive(pid)) || Date.now() - touched(p) < STALE_RUN_MS || lstatSync(p).isSymbolicLink()) return false; } catch { return false; }
    rmSync(p, { recursive: true, force: true });
    return true;
  });
}
const shared = tmpdir();
cleanStaleRuns(shared, process.pid);
const before = new Set(shepEntries(shared));
const sharedWith = otherRuns(shared, process.pid).length > 0;
const run = mkdtempSync(join(shared, `${RUN_PREFIX}${process.pid}-`));
mkdirSync(join(run, "tmp"), { mode: 0o700 });
for (const v of ["TMPDIR", "TMP", "TEMP"]) process.env[v] = join(run, "tmp");
process.env.SHEPHERDR_TEST_RUN = run; // a Python test a test starts keeps this run's folders (test/home_guard.py)
afterAll(() => {
  rmSync(run, { recursive: true, force: true });
  const left = shepEntries(shared).filter((n) => !before.has(n));
  if (!left.length) return;
  const names = `${left.slice(0, 10).join(", ")}${left.length > 10 ? " …" : ""}`;
  if (sharedWith || otherRuns(shared, process.pid).length || left.some((n) => OLD_RUN_FOLDERS.some((o) => n.startsWith(o)))) {
    console.warn(`New in ${shared} during this test run, with another run beside it, so maybe not this run's: ${names} (test/preload.ts).`);
    return;
  }
  throw new Error(`This test run left ${left.length} folder(s) in ${shared}: ${names}. Make them under tmpdir() (the run's own), or remove them when the test ends (test/preload.ts).`);
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
