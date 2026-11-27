// dmalis/shepherdr#108: another machine's waiting asks (service/asks.ts), read whether or not a page shows its chats.
// Only the hook's own files there (hooks/ask-hook.sh: data/chat-asks/req, ans, end and seen) are read or marked,
// through herdr-core's link (machine.exec): nothing here presses a key or answers a prompt.
import type { Hub } from "./hub.ts";

// asks.ts's THERE: that machine's data/chat-asks, by its own home
const THERE = 'd="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/data/chat-asks"';
/** seen/<id> there, for each id given that still waits: a card shows it, so its Codex hook keeps waiting for it */
export const SEEN = `${THERE}; mkdir -p "$d/seen" 2>/dev/null
for n in "$@"; do [ -f "$d/req/$n.json" ] && : > "$d/seen/$n" 2>/dev/null; done; exit 0`;

export const MACHINE = /^[\w.-]+$/;
/** an ask's id as its hook makes it: <terminal>.<seconds>.<pid>, its terminal a plain name (no /, no ..) */
export const askId = (id: string) => /^[\w-][\w.-]*\.\d+\.\d+$/.test(id) && !id.includes("..");

/** The lines of a read there (asks.ts LIST): each request still waiting, and how each id asked about has ended;
 *  complete only when it ends with its "done" line (a read cut short could make a waiting request look gone). */
export function parseList(stdout: string) {
  const reqs = new Map<string, string>(), ends = new Map<string, string>();
  const lines = Buffer.from(stdout, "base64").toString("utf8").split("\n");
  const complete = lines.filter((l) => l !== "").at(-1) === "done";
  for (const line of lines) {
    const [kind, id, ...rest] = line.split("\t");
    if (!id || !askId(id)) continue;
    const body = rest.join("\t");
    if (kind === "req") reqs.set(id, body);
    else if (kind === "end" && body.trim()) ends.set(id, body.trim());
  }
  return { reqs, ends, complete };
}

/** The machines herdr-core is linked to and reaches now (machine.list), by name; null when the list can't be had. */
export async function connected(hub: Hub): Promise<string[] | null> {
  try {
    const r = await hub.call<{ machines: any[] }>("machine.list", {}, 8000);
    return (r?.machines ?? []).filter((m) => m?.state === "connected" && !m.temporary && MACHINE.test(String(m.name ?? ""))).map((m) => String(m.name));
  } catch { return null; }
}

/** A script there, its output (base64) on success; null when it is out of reach, fails, takes too long or is cut off. */
export async function run(hub: Hub, on: string, script: string, args: string[]) {
  const r = await hub.call<{ code: number; stdout: string; truncated?: boolean }>("machine.exec", { on, argv: ["sh", "-c", script, "sh", ...args], timeout: 10 }, 15_000).catch(() => null);
  return r?.code === 0 && !r.truncated && typeof r.stdout === "string" ? r.stdout : null;
}
