// The "#" list's known spaces, as the machine running the chat's agent sees them.
// The service's own list is relative to this machine: a space with no machine is this machine's, any other carries the
// name this machine's link gives its machine. A reach map is relative to the machine it starts at, the agent's, and
// core/mentions.js reachable() gives that start every space with no machine. So for an agent on another machine, this
// machine's spaces carry this machine's herdr-core name (the name its node has in that map), and the start's own lose
// theirs. here: this machine's herdr-core name (unknown: its spaces can't be placed, so they are left out); start: this
// machine's name for the agent's machine, null when the agent runs here.
export type Known = { id: string; machine: string | null; [k: string]: unknown };

export function knownFrom<T extends Known>(known: T[], here: string | null | undefined, start: string | null): T[] {
  if (!start) return known;
  return known.flatMap((k) => k.machine === start ? [{ ...k, machine: null }] : k.machine ? [k] : here ? [{ ...k, machine: here }] : []);
}
