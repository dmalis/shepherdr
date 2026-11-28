// Your own terminal: one per space, a real shell through herdr-core in the space's folder on the space's machine
// (Everything: the home folder on the serving machine), and one per task in the task's folder (its worktree when it
// works on its own branch). It keeps running when the drawer is closed or the page reloads; once its shell exits,
// opening the drawer again starts a fresh one. It is never an agent's session: that stays behind View as terminal.
import type { Hub } from "./hub.ts";
import { hc } from "./actions.ts";
import { spawn } from "./spawn.ts";

export const SHELL_LABEL = "shepherdr.shell";

export interface ShellAt {
  /** the folder it starts in, and the machine (null: this one) */
  folder: string;
  machine: string | null;
  /** a task's own temp folder there (herdr-task's task_tmp.py), its shell's TMPDIR, TMP and TEMP while it exists */
  tmp?: string | null;
  /** a task's: its id and list folder there, to have its temp folder made when it has none yet (taskTmp()) */
  task?: { id: string; folder: string } | null;
}

/** task_tmp.py's TAKE, the same words: locks the folder "$1" names on descriptor 9 (shared, never waiting) for what
 *  runs after, which inherits it, so herdr-task never removes the folder while the shell lives. */
export const TAKE = '[ -d "$1" ] && command exec 9<"$1" && { flock -s -n 9 || python3 -c "import fcntl; fcntl.flock(9, fcntl.LOCK_SH | fcntl.LOCK_NB)"; } 2>/dev/null';

/** That machine's own shell (hc gives every program SHELL), with the task's temp folder as TMPDIR, TMP and TEMP when
 *  it is still there, held (TAKE): hc run has no way to set a variable, so a short sh sets them first
 *  (dmalis/shepherdr#216). */
export const TMP_SHELL = `if [ -d "$1" ]; then TMPDIR=$1 TMP=$1 TEMP=$1; export TMPDIR TMP TEMP; ${TAKE}; fi; exec "\${SHELL:-/bin/sh}"`;

/** What hc runs for a shell: nothing (its own shell), or TMP_SHELL with the task's temp folder. */
export function shellArgv(at: ShellAt): string[] {
  return at.tmp ? ["--", "sh", "-c", TMP_SHELL, "herdr-shell", at.tmp] : [];
}

/** A task's temp folder for its terminal, from herdr-task on the task's machine: the one it has, or one made now (its
 *  agent hasn't started, or an older copy's is in its old place). Null when that fails (an older herdr-task there):
 *  the shell then uses the one it has, or the machine's own. */
export async function taskTmp(at: ShellAt): Promise<string | null> {
  if (!at.task) return at.tmp ?? null;
  try {
    const p = spawn([process.env.SHEPHERDR_HERDR_TASK || "herdr-task", ...(at.machine ? ["--on", at.machine] : []), "_task-tmp", at.task.id, "--folder", at.task.folder], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    const out = await new Response(p.stdout).text();
    if ((await p.exited) !== 0) return at.tmp ?? null;
    const tmp = JSON.parse(out.trim().split("\n").pop() || "null")?.tmp;
    return typeof tmp === "string" && tmp ? tmp : at.tmp ?? null;
  } catch {
    return at.tmp ?? null;
  }
}

/** the live shell kept for a key ("sh:<space id>" or "sh:task:<task id>"), if any */
export function shellOf(hub: Hub, key: string): string | null {
  for (const k of hub.terminals.values()) if (k.state === "live" && k.labels?.[SHELL_LABEL] === key) return k.address;
  return null;
}

const starting = new Map<string, Promise<string>>();

/** The shell for a key: the one running, else a fresh one started in its folder. */
export function ensureShell(hub: Hub, key: string, at: ShellAt): Promise<string> {
  const live = shellOf(hub, key);
  if (live) return Promise.resolve(live);
  const was = starting.get(key);
  if (was) return was;
  const p = (async () => {
    // with no program, hc starts that machine's own shell; it outlives the page and is nobody's child
    const tmp = await taskTmp(at);
    const r = await hc(["run", "--bg", "--json", "--no-parent", ...(at.machine ? ["--on", at.machine] : []), "--cwd", at.folder, "--label", `${SHELL_LABEL}=${key}`, ...shellArgv({ ...at, tmp })]);
    let out: any = null;
    try { out = JSON.parse(r.stdout); } catch {}
    const address: string | undefined = out?.address ?? out?.terminal?.address ?? out?.terminal;
    if (r.code !== 0 || !address) throw new Error(r.stderr.trim().split("\n").pop() || "The terminal didn't start.");
    // the page attaches once herdr-core lists it
    for (let i = 0; i < 50 && hub.terminals.get(address)?.state !== "live"; i++) await new Promise((res) => setTimeout(res, 100));
    return address;
  })().finally(() => starting.delete(key));
  starting.set(key, p);
  return p;
}
