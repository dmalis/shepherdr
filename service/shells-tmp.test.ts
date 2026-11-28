// dmalis/shepherdr#216: a task's own terminal starts with the task's temp folder as TMPDIR, TMP and TEMP (herdr-task's
// task_tmp.py), while it is there; a space's terminal, or a task with none, gets that machine's own shell as before.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureShell, shellArgv, taskTmp, TMP_SHELL } from "./shells.ts";

const dir = mkdtempSync(join(tmpdir(), "shep-shells-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What a shell started by TMP_SHELL sees: its "shell" is env, which prints its environment. */
function seen(folder: string): Record<string, string> {
  const r = Bun.spawnSync(["sh", "-c", TMP_SHELL, "herdr-shell", folder], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SHELL: "/usr/bin/env", TMPDIR: "/machine-tmp" } });
  return Object.fromEntries(r.stdout.toString().trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}

test("a task's shell gets its temp folder", () => {
  const own = join(dir, "shop-1-abcd");
  mkdirSync(own);
  const env = seen(own);
  expect([env.TMPDIR, env.TMP, env.TEMP]).toEqual([own, own, own]);
});

test("the shell marks the folder in use with its own pid (herdr-task keeps it while that runs)", () => {
  const own = join(dir, "shop-2-abcd");
  mkdirSync(own);
  const r = Bun.spawnSync(["sh", "-c", TMP_SHELL, "herdr-shell", own], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SHELL: "/bin/sh" }, stdin: new TextEncoder().encode("echo $$\n") });
  expect(readdirSync(own)).toEqual([`.shell-${r.stdout.toString().trim()}`]);
});

test("a temp folder that is gone leaves the machine's own", () => {
  const env = seen(join(dir, "gone"));
  expect(env.TMPDIR).toBe("/machine-tmp");
  expect(env.TMP).toBeUndefined();
});

test("hc runs the plain shell unless the task has a temp folder", () => {
  expect(shellArgv({ folder: "/f", machine: null })).toEqual([]);
  expect(shellArgv({ folder: "/f", machine: null, tmp: null })).toEqual([]);
  expect(shellArgv({ folder: "/f", machine: "vm", tmp: "/c/tmp/shop-1-abcd" })).toEqual(["--", "sh", "-c", TMP_SHELL, "herdr-shell", "/c/tmp/shop-1-abcd"]);
});

test("ensureShell starts it that way through hc", async () => {
  const log = join(dir, "hc.log"), fake = join(dir, "hc");
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\necho '{"address":"t7"}'\n`);
  chmodSync(fake, 0o755);
  const was = process.env.SHEPHERDR_HC;
  process.env.SHEPHERDR_HC = fake;
  try {
    const hub: any = { terminals: new Map([["t7", { address: "t7", state: "live" }]]) };
    expect(await ensureShell(hub, "sh:task:SHOP-1", { folder: "/f", machine: null, tmp: "/c/tmp/shop-1-abcd" })).toBe("t7");
  } finally {
    if (was === undefined) delete process.env.SHEPHERDR_HC; else process.env.SHEPHERDR_HC = was;
  }
  const argv = readFileSync(log, "utf8").trimEnd().split("\n");
  expect(argv.slice(0, 2)).toEqual(["run", "--bg"]);
  expect(argv).toContain("shepherdr.shell=sh:task:SHOP-1");
  expect(argv.slice(argv.indexOf("--"))).toEqual(["--", "sh", "-c", TMP_SHELL, "herdr-shell", "/c/tmp/shop-1-abcd"]);
});

/** a stand-in herdr-task that logs its words and answers with `answer` */
function fakeTask(answer: string, code = 0): { file: string; log: string } {
  const log = join(dir, "task.log"), file = join(dir, "herdr-task");
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\necho '${answer}'\nexit ${code}\n`);
  chmodSync(file, 0o755);
  return { file, log };
}

async function withTask<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const was = process.env.SHEPHERDR_HERDR_TASK;
  process.env.SHEPHERDR_HERDR_TASK = file;
  try { return await fn(); } finally { if (was === undefined) delete process.env.SHEPHERDR_HERDR_TASK; else process.env.SHEPHERDR_HERDR_TASK = was; }
}

test("a task with no temp folder yet (its agent hasn't started) has herdr-task make it for its terminal", async () => {
  const { file, log } = fakeTask('{"tmp": "/c/tmp/shop-3-abcd"}');
  expect(await withTask(file, () => taskTmp({ folder: "/f", machine: "vm", task: { id: "3", folder: "/list" } }))).toBe("/c/tmp/shop-3-abcd");
  expect(readFileSync(log, "utf8").trimEnd().split("\n")).toEqual(["--on", "vm", "_task-tmp", "3", "--folder", "/list"]);
  // one it has, or a space's terminal: nothing asked
  rmSync(log);
  expect(await withTask(file, () => taskTmp({ folder: "/f", machine: null, tmp: "/c/tmp/x", task: { id: "3", folder: "/list" } }))).toBe("/c/tmp/x");
  expect(await withTask(file, () => taskTmp({ folder: "/f", machine: null }))).toBeNull();
  expect(() => readFileSync(log)).toThrow();
});

test("an older herdr-task without it leaves the machine's own temp folder", async () => {
  const { file } = fakeTask("usage: herdr-task ...", 2);
  expect(await withTask(file, () => taskTmp({ folder: "/f", machine: null, task: { id: "3", folder: "/list" } }))).toBeNull();
});
