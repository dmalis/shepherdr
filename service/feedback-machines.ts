// Every linked machine's problems on one Feedback page (friction loop, slice 8, #94: fork/specs/friction-loop.md).
// Each machine's list is read there through herdr-core's own way to run a command on another machine (machine.exec,
// what `hc exec --on` does), with the explicit path herdr-task's own remote calls use (herdr_task/cli.py): a core
// started by launchd or systemd hands remote commands a bare PATH. Never `herdr-task --on`, which copies its bundle over,
// and never an install: a machine with no herdr-task says so and stays as it is. The list is read only; the person's
// calls on a row go to the row's own machine the same way. A machine out of reach keeps its last rows, marked stale,
// with their buttons off; one whose herdr-task is older than the list shows its record read only, its buttons off too.
import { SH } from "../core/paths.js";

type Ran = { code: number; stdout: string; stderr: string };
/** a command on another machine (machine.exec); throws when herdr-core couldn't run it there */
export type Exec = (machine: string, argv: string[], timeout: number) => Promise<Ran>;
/** herdr-core's machines (machine.list) */
export type Machines = () => Promise<{ name: string; state?: string; temporary?: boolean }[]>;

/** what one machine's list is, as of its last read: read (ok), out of reach (stale: the last rows), older (old: its
 *  record read as it is, nothing to act with), or without Shepherdr (none) */
export type There = { state: "ok" | "stale" | "old" | "none"; rows: unknown[]; at: number };

/** herdr-task there, by its own path: the same call herdr-task's remote_run makes, never through PATH */
export const RUN = 'exec "$HOME/.local/bin/herdr-task" "$@"';
/** ...with its start-up data move off (herdr_task/layout.py ensure): a call from here must not move the other machine's
 *  data; its own runs do that */
export const THERE = `export SHEPHERDR_NO_MIGRATE=1; ${RUN}`;
/** the argv that runs `herdr-task feedback <args>` on another machine */
export const thereArgv = (args: string[]) => ["sh", "-c", THERE, "herdr-task", "feedback", ...args];
/** an older herdr-task's record, read as a file (its own --list rewrites and prunes it: a read must stay a read) */
export const READ_OLD = SH + 'exec cat -- "$SHEP_TASKS/.feedback.json"';

const NAME = /^[\w.-]{1,80}$/;
export const isMachine = (m: unknown): m is string => typeof m === "string" && NAME.test(m);

/** herdr-task isn't there: the shell's own "not found" (127), or its path missing */
export const missing = (r: Ran) => r.code === 127 || (!r.stdout.trim() && /not found|No such file/i.test(r.stderr));
/** an older herdr-task that doesn't know the call (argparse refuses it before doing anything) */
export const older = (r: Ran) => r.code === 2 && /unrecognized arguments|invalid choice|expected one argument/.test(r.stderr);

/** the last JSON line printed, else null */
export function answer(out: string): any {
  for (const l of out.trim().split("\n").reverse()) { try { return JSON.parse(l); } catch {} }
  return null;
}

/** an older record ({problems: {key: row}}), as rows like --list --all gives them */
export function oldRows(text: string): unknown[] {
  try {
    const ps = JSON.parse(text)?.problems;
    if (!ps || typeof ps !== "object" || Array.isArray(ps)) return [];
    return Object.entries(ps).filter(([, p]) => p && typeof p === "object").map(([key, p]) => ({ key, ...(p as object) }));
  } catch { return []; }
}

/** the space a row there names, as this service names it: "vm/sp1" (model.ts); one that names its machine is left */
export const spaceThere = (machine: string, space: unknown) =>
  typeof space === "string" && space ? (space.includes("/") ? space : `${machine}/${space}`) : undefined;

export class FeedbackMachines {
  /** each linked machine's last read, by its name */
  readonly lists = new Map<string, There>();
  private reading = new Map<string, Promise<void>>();
  /** the options a machine's herdr-task refused as unknown (one that lists but can't act yet, e.g. rolled back): it
   *  stays read only until its own --help names them all */
  private refused = new Map<string, string[]>();

  constructor(public exec: Exec | null = null, public machines: Machines = async () => []) {}

  /** every linked machine's list read again (the ones being read now aside); -> whether anything changed */
  async read(now = Date.now()): Promise<boolean> {
    if (!this.exec) return false;
    let known: Awaited<ReturnType<Machines>>;
    const before = this.stamp();
    try { known = (await this.machines()).filter((m) => m && isMachine(m.name) && !m.temporary); }
    catch {
      // herdr-core itself didn't answer: no machine can be reached through it, so every last read shows as it was
      for (const m of this.lists.keys()) this.away(m);
      return this.stamp() !== before;
    }
    const names = new Set(known.map((m) => m.name));
    // a machine removed from Settings › Machines: its rows go with it
    for (const m of [...this.lists.keys()]) if (!names.has(m)) { this.lists.delete(m); this.refused.delete(m); }
    await Promise.all(known.map((m) => (m.state === "connected" ? this.readOne(m.name, now) : this.away(m.name))));
    return this.stamp() !== before;
  }

  private stamp() { return JSON.stringify([...this.lists]); }

  /** out of reach: its last rows stay, stale (none read yet: nothing to show) */
  private away(m: string) {
    const l = this.lists.get(m);
    if (l && l.state !== "none") this.lists.set(m, { ...l, state: "stale" });
  }

  /** one machine's list read now, through its own herdr-task; a read that fails keeps the last rows, stale. One that
   *  is under way is waited for (`fresh`: then read again, as after the person's call) */
  async readOne(m: string, now = Date.now(), fresh = false): Promise<void> {
    const going = this.reading.get(m);
    if (going) { await going; if (!fresh) return; }
    if (!this.exec) return;
    const p = this.readNow(m, now);
    this.reading.set(m, p);
    try { await p; } finally { if (this.reading.get(m) === p) this.reading.delete(m); }
  }

  private async readNow(m: string, now: number): Promise<void> {
    if (!this.exec) return;
    try {
      const r = await this.exec(m, thereArgv(["--list", "--all", "--json"]), 30);
      const out = answer(r.stdout);
      if (r.code === 0 && Array.isArray(out)) return void this.lists.set(m, { state: (await this.refuses(m)) ? "old" : "ok", rows: out, at: now });
      if (missing(r)) return void this.lists.set(m, { state: "none", rows: [], at: now });
      if (older(r)) {
        const f = await this.exec(m, ["sh", "-c", READ_OLD], 30);
        // no record yet (nothing kept there): an empty list, still older
        return void this.lists.set(m, { state: "old", rows: f.code === 0 ? oldRows(f.stdout) : [], at: now });
      }
      this.away(m);
    } catch {
      this.away(m);
    }
  }

  /** does this machine still lack an option it refused: asked of its own --help (a read), until it names them all */
  private async refuses(m: string): Promise<boolean> {
    const want = this.refused.get(m);
    if (!want || !this.exec) return false;
    const h = await this.exec(m, thereArgv(["--help"]), 30);
    const has = new Set(h.code === 0 ? h.stdout.match(/--[\w-]+/g) ?? [] : []);
    if (!want.every((o) => has.has(o))) return true;
    this.refused.delete(m);
    return false;
  }

  /** why the person's call can't go to this machine now, else null */
  refusal(m: string): string | null {
    const l = this.lists.get(m);
    if (!l) return "That machine isn't linked any more.";
    if (l.state === "stale") return `${m} can't be reached just now: try again once it's back.`;
    if (l.state === "old") return `Update Shepherdr on ${m} to act on these here.`;
    if (l.state === "none") return `Shepherdr isn't set up on ${m}.`;
    return null;
  }

  /** herdr-task feedback <args> on that machine, then its list read again; an older one's refusal said as an update */
  async run(m: string, args: string[]): Promise<Ran> {
    if (!this.exec) return { code: 1, stdout: "", stderr: "Not connected." };
    let r: Ran;
    try { r = await this.exec(m, thereArgv(args), 30); }
    catch { r = { code: 1, stdout: "", stderr: `${m} can't be reached just now: try again once it's back.` }; }
    if (older(r)) {
      this.refused.set(m, args.filter((a) => /^--[\w-]+$/.test(a) && a !== "--json"));
      r = { code: 2, stdout: JSON.stringify({ error: `Update Shepherdr on ${m} to do this here.` }), stderr: "" };
    }
    await this.readOne(m, Date.now(), true);
    return r;
  }
}
