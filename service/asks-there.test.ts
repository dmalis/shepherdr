// dmalis/shepherdr#108 (Needs you 2/6): another machine's permission prompts show with no page open. A fake core (its
// machine.list, and machine.exec as a sh on a throwaway home per machine), never the real data/chat-asks.
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "shep-asks-there-"));
process.env.HERDR_APP_HOME = home;
const here = join(home, "data", "chat-asks");
for (const d of ["req", "ans", "end"]) mkdirSync(join(here, d), { recursive: true });
const { Asks, LIST } = await import("./asks.ts");
const { SEEN, askId, parseList, each } = await import("./asks-there.ts");
const { Compat } = await import("./compat.ts");
const { needsCount } = await import("../web/shared/view.ts");

const machineHome = (name: string) => {
  const there = mkdtempSync(join(tmpdir(), `shep-asks-${name}-`));
  for (const d of ["req", "ans", "end"]) mkdirSync(join(there, "data", "chat-asks", d), { recursive: true });
  return there;
};
const ask = (there: string, id: string, req: unknown = { tool_name: "Bash", tool_input: { command: "npm test" } }) =>
  writeFileSync(join(there, "data", "chat-asks", "req", `${id}.json`), JSON.stringify(req));
const seen = (there: string, id: string) => existsSync(join(there, "data", "chat-asks", "seen", id));

/** a core linked to these machines (each by its home, or "offline"); down: machines whose reads fail now */
function core(machines: Record<string, string | "offline">, opts: { down?: Set<string>; listFails?: () => boolean } = {}) {
  const calls: any[] = [];
  const hub: any = {
    calls,
    async call(method: string, p: any) {
      calls.push({ method, ...p });
      if (method === "machine.list") {
        if (opts.listFails?.()) throw new Error("core restarting");
        return { machines: [...Object.entries(machines).map(([name, h]) => ({ name, state: h === "offline" ? "offline" : "connected" })), { name: "tmp", state: "connected", temporary: true }] };
      }
      if (method !== "machine.exec") throw new Error(`unexpected ${method}`);
      const h = machines[p.on];
      if (!h || h === "offline" || opts.down?.has(p.on)) throw new Error(`${p.on} is out of reach`);
      const r = Bun.spawnSync(p.argv, { env: { ...process.env, HERDR_APP_HOME: h }, stdin: p.input ? Buffer.from(p.input, "base64") : "ignore" });
      return { code: r.exitCode, stdout: Buffer.from(r.stdout).toString("base64") };
    },
  };
  return hub;
}

test("a permission on another machine shows with no page open: under Needs you, in its space's count", async () => {
  const vm = machineHome("vm2");
  ask(vm, "w7.1700000000.42", { tool_name: "Bash", tool_input: { command: "rm -rf dist", description: "Clean the build" } });
  const hub = core({ vm2: vm, gone: "offline" });
  const asks = new Asks();
  // nobody watches any chat
  asks.remote(hub, () => []);
  await (asks as any).poll();
  expect(asks.of("vm2/w7").map((a: any) => a.id)).toEqual(["vm2/w7.1700000000.42"]);
  // only connected, lasting machines are read
  expect(hub.calls.filter((c: any) => c.method === "machine.exec").map((c: any) => c.on)).toEqual(["vm2", "vm2"]);
  // the card's place: a task on vm2 whose worker is w7, in the space on its folder there
  const c = new Compat() as any;
  c.terminalsOf = () => null;
  c.terminalsAll = () => [];
  c.assistantPick = () => null;
  c.asks = asks;
  const spaces = [{ id: "vm2/sp1", name: "shop", folder: "/srv/shop", machine: "vm2", assistant: "vm2/a1" }];
  const row = { ref: "SHOP-3", slug: "srv-shop", id: 3, title: "Tidy the build", section: "working", machine: "vm2", folder: "/srv/shop", space: "vm2/sp1", worker: "vm2/w7" };
  const snap = c.snapshot({ host: "mini", user: "me", machines: [{ name: "vm2", here: false, state: "connected" }], spaces, sections: [], rows: [row] });
  const need = snap.needs.find((n: any) => n.id === "vm2/w7.1700000000.42");
  expect(need).toMatchObject({ chat: "vm2:SHOP-3/worker", place: "vm2/sp1", task: "vm2:SHOP-3", question: { title: "Run a command" } });
  expect(snap.tasks[0].state).toBe("needs");
  expect(needsCount(snap)).toBe(1);
  expect(needsCount(snap, "vm2/sp1")).toBe(1);
  // and Compat maps the agent to that chat: where its seen goes
  expect(c.chatOf("vm2/w7")).toBe("vm2:SHOP-3/worker");
  expect(c.chatOf("vm2/nobody")).toBeNull();
});

test("a failed read keeps what was open; the next good one closes it with how it went", async () => {
  const vm = machineHome("vm3");
  ask(vm, "w8.1700000000.5");
  const down = new Set<string>();
  let listFails = false;
  const hub = core({ vm3: vm }, { down, listFails: () => listFails });
  const asks = new Asks();
  asks.remote(hub, () => []);
  await (asks as any).poll();
  expect(asks.of("vm3/w8").length).toBe(1);
  // answered in its terminal there while vm3 is out of reach, and herdr-core's own list fails too
  rmSync(join(vm, "data", "chat-asks", "req", "w8.1700000000.5.json"));
  writeFileSync(join(vm, "data", "chat-asks", "end", "w8.1700000000.5"), "Allowed in the terminal\n");
  down.add("vm3");
  listFails = true;
  for (let i = 0; i < 3; i++) await (asks as any).poll();
  expect(asks.of("vm3/w8").length).toBe(1);
  // back: the next read says it ended there, and how
  down.delete("vm3");
  await (asks as any).poll();
  expect(asks.of("vm3/w8").length).toBe(0);
  expect(asks.endsOf("vm3/w8").at(-1)).toMatchObject({ how: "Allowed in the terminal" });
});

test("a read that fails, is cut off or can't see the folder closes nothing", async () => {
  const vm = machineHome("vm4");
  ask(vm, "w9.1700000000.6");
  let broken: ((r: any) => any) | null = null;
  const hub = core({ vm4: vm });
  const real = hub.call.bind(hub);
  hub.call = async (m: string, p: any) => { const r = await real(m, p); return broken && m === "machine.exec" ? broken(r) : r; };
  const asks = new Asks();
  asks.remote(hub, () => []);
  await (asks as any).poll();
  // the request is answered there meanwhile, but no read below can be trusted to say so
  rmSync(join(vm, "data", "chat-asks", "req", "w9.1700000000.6.json"));
  const empty = Buffer.from("").toString("base64");
  for (const b of [
    () => ({ code: 1, stdout: empty }), // a non-zero exit
    () => ({ code: 0, stdout: empty, truncated: true }), // herdr-core cut the output
    () => ({ code: 0, stdout: Buffer.from("req\tw1.1700000000.1\t{}\n").toString("base64") }), // no "done": cut short
  ]) {
    broken = b;
    await (asks as any).poll();
    expect(asks.of("vm4/w9").length).toBe(1);
  }
  // the hook's folder there can't be read: the read itself refuses (exit 4), never "nothing waits"
  broken = null;
  const req = join(vm, "data", "chat-asks", "req");
  const { chmodSync } = await import("node:fs");
  chmodSync(req, 0o000);
  try {
    const r = Bun.spawnSync(["sh", "-c", LIST, "sh"], { env: { ...process.env, HERDR_APP_HOME: vm } });
    // root reads any folder: only then can't this be shown
    if (process.getuid?.() !== 0) expect(r.exitCode).toBe(4);
    await (asks as any).poll();
    if (process.getuid?.() !== 0) expect(asks.of("vm4/w9").length).toBe(1);
  } finally { chmodSync(req, 0o755); }
  // a whole read again: it ended there
  await (asks as any).poll();
  expect(asks.of("vm4/w9").length).toBe(0);
});

test("a machine whose read hangs never holds up another's card or its seen", async () => {
  const fast = machineHome("fast");
  const hub = core({ slow: machineHome("slow"), fast });
  const real = hub.call.bind(hub);
  let release = () => {};
  const hung = new Promise<void>((r) => (release = r));
  let slowReads = 0;
  hub.call = async (m: string, p: any) => { if (m === "machine.exec" && p.on === "slow") { slowReads++; await hung; } return real(m, p); };
  const asks = new Asks();
  asks.remote(hub, () => []);
  const first = (asks as any).poll();
  await new Promise((r) => setTimeout(r, 50));
  // a request on fast after its first read: the next poll finds it and marks it seen while slow still hangs
  ask(fast, "w20.1700000000.3");
  await (asks as any).poll();
  expect(asks.of("fast/w20").length).toBe(1);
  expect(seen(fast, "w20.1700000000.3")).toBe(true);
  // slow was never read twice at once
  expect(slowReads).toBe(1);
  release();
  await first;
});

test("an ask with no chat yet has its machine's task lists read again, at most every 10 s", async () => {
  const vm = machineHome("vm7");
  ask(vm, "w30.1700000000.4");
  const hub = core({ vm7: vm });
  const asks = new Asks();
  const reread: string[] = [];
  let routed = false;
  asks.destination = () => routed;
  asks.unrouted = (m: string) => reread.push(m);
  asks.remote(hub, () => []);
  await (asks as any).poll();
  await (asks as any).poll();
  expect(reread).toEqual(["vm7"]);
  expect(seen(vm, "w30.1700000000.4")).toBe(false);
  // the lists read, its task's chat is known: marked on the next read
  routed = true;
  await (asks as any).poll();
  expect(seen(vm, "w30.1700000000.4")).toBe(true);
  expect(reread).toEqual(["vm7"]);
});

test("seen waits for a card to show it: an ask no chat maps stays unseen, there and here", async () => {
  const vm = machineHome("vm5");
  ask(vm, "w10.1700000000.7");
  writeFileSync(join(here, "req", "w11.1700000000.8.json"), JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }));
  const hub = core({ vm5: vm });
  const asks = new Asks();
  const chats = new Set<string>();
  asks.destination = (t: string) => chats.has(t);
  asks.remote(hub, () => []);
  asks.start();
  await (asks as any).poll();
  // both show as asks, but nothing maps them to a chat: a Codex hook would go back to its terminal
  expect(asks.of("vm5/w10").length).toBe(1);
  expect(asks.of("w11").length).toBe(1);
  expect(seen(vm, "w10.1700000000.7")).toBe(false);
  expect(existsSync(join(here, "seen", "w11.1700000000.8"))).toBe(false);
  // their agents' chats appear (a task's list read): the next poll and read mark them, once
  chats.add("vm5/w10");
  chats.add("w11");
  await (asks as any).poll();
  (asks as any).read();
  expect(seen(vm, "w10.1700000000.7")).toBe(true);
  expect(existsSync(join(here, "seen", "w11.1700000000.8"))).toBe(true);
  const marks = () => hub.calls.filter((c: any) => c.argv?.[2] === SEEN).length;
  const before = marks();
  await (asks as any).poll();
  expect(marks()).toBe(before);
  rmSync(join(here, "req", "w11.1700000000.8.json"));
  (asks as any).read();
});

test("the read there never marks seen, and the mark touches only an ask still waiting", () => {
  expect(LIST).not.toContain("seen");
  const vm = machineHome("vm6");
  ask(vm, "w12.1700000000.9");
  const r = Bun.spawnSync(["sh", "-c", SEEN, "sh", "w12.1700000000.9", "w13.1700000000.1"], { env: { ...process.env, HERDR_APP_HOME: vm } });
  expect(r.exitCode).toBe(0);
  expect(seen(vm, "w12.1700000000.9")).toBe(true);
  expect(seen(vm, "w13.1700000000.1")).toBe(false);
});

test("ids from another machine are checked before they name a file", () => {
  for (const ok of ["w1.1700000000.42", "t-3.1700000000.1", "a_b.c.1700000000.2"]) expect(askId(ok)).toBe(true);
  for (const bad of ["..", "../x.1.2", "a..b.1.2", "w1", "w1.17", "w/1.1.2", ".w.1.2", "w1.x.2", "w1.1.2 ", ""]) expect(askId(bad)).toBe(false);
  const line = (id: string) => `req\t${id}\t{}`;
  const out = Buffer.from([line("w1.1700000000.42"), line("../x.1.2"), "end\tw2.1700000000.1\tAnswered in the terminal", "end\tw3.1.1\t ", "junk"].join("\n")).toString("base64");
  const { reqs, ends } = parseList(out);
  expect([...reqs.keys()]).toEqual(["w1.1700000000.42"]);
  expect([...ends]).toEqual([["w2.1700000000.1", "Answered in the terminal"]]);
});

test("machines are read a few at a time, and a slow one never holds up the rest", async () => {
  let now = 0, most = 0;
  const done: string[] = [];
  const names = ["slow", "a", "b", "c", "d", "e", "f"];
  await each(names, 4, async (m) => {
    now++;
    most = Math.max(most, now);
    await new Promise((r) => setTimeout(r, m === "slow" ? 60 : 5));
    now--;
    done.push(m);
  });
  expect(most).toBe(4);
  expect(done.at(-1)).toBe("slow");
  expect(done.sort()).toEqual([...names].sort());
});

// Pins what this relies on in the hook (hooks/ask-hook.sh): its id's form, and a Codex ask going back to its terminal
// when no seen/<id> comes.
test("the hook still makes <terminal>.<seconds>.<pid> ids and waits on seen/<id> for Codex", () => {
  const hook = readFileSync(join(import.meta.dir, "..", "hooks", "ask-hook.sh"), "utf8");
  expect(hook).toContain('id="$t.$(date +%s).$$"');
  expect(hook).toContain('seen="$d/seen/$id"');
  expect(hook).toMatch(/\[ ! -f "\$seen" \] && \[ "\$i" -ge "\$unseen" \]/);
});
