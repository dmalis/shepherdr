// Triage's keys (dmalis/shepherdr#235, fork/specs/issue-loop.md, "Settings and the schedule"), as Settings › Triage
// reads and saves them through the settings window's one config action (service/next.ts). The same rules as herdr-task's
// (mods/tasks/bin/herdr_task/triage.py value_of and keys): a repo's own value, else Everywhere's (never for the level:
// each repo is switched on by hand), else the default; a value that doesn't check counts as unset. Only the person's
// app saves them here; herdr-task refuses them from an agent's terminal. triage.rules and triage.private_words stay in
// the settings file only.
import { repoLayer } from "./settings.ts";

export type TriageKeys = { level: "off" | "score"; fix_from: number; fixes_per_day: number; ask_merge: boolean };
export const TRIAGE_DEFAULTS: TriageKeys = { level: "off", fix_from: 4, fixes_per_day: 3, ask_merge: true };
export const TRIAGE_KEYS = Object.keys(TRIAGE_DEFAULTS) as (keyof TriageKeys)[];
const LEVELS = ["off", "score"];

/** a key's value, checked: herdr-task's value_of. Throws the words the page shows. */
export function triageValue(key: string, v: unknown): TriageKeys[keyof TriageKeys] {
  if (key === "level") {
    if (v === "fix") throw new Error("Score and fix comes in a later step of Triage: for now a repo is Off or Score only.");
    if (typeof v !== "string" || !LEVELS.includes(v)) throw new Error("Triage is Off or Score only.");
    return v as TriageKeys["level"];
  }
  if (key === "fix_from" || key === "fixes_per_day") {
    const [lo, hi] = key === "fix_from" ? [3, 5] : [1, 10];
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) throw new Error(`That is a whole number from ${lo} to ${hi}.`);
    return v;
  }
  if (key === "ask_merge") {
    if (typeof v !== "boolean") throw new Error("Ask me before merging is on or off.");
    return v;
  }
  throw new Error("That setting can't be changed here.");
}

const checks = (key: string, v: unknown) => { try { triageValue(key, v); return true; } catch { return false; } };
const layerOf = (x: any) => (x && typeof x === "object" && x.triage && typeof x.triage === "object" ? x.triage : {});

/** One repo's keys (key: its settings.json "repos" key), and which of them it sets itself: herdr-task's keys() */
export function triageOf(f: any, key: string | null): TriageKeys & { own: string[] } {
  const own = key ? layerOf(f?.repos?.[key]) : {};
  const every = layerOf(f?.everywhere);
  const out: any = { ...TRIAGE_DEFAULTS, own: [] as string[] };
  for (const k of TRIAGE_KEYS) {
    if (k in own && checks(k, own[k])) { out[k] = own[k]; out.own.push(k); }
    else if (k !== "level" && k in every && checks(k, every[k])) out[k] = every[k];
  }
  return out;
}

/** Config.triage: Everywhere's keys, and each of this machine's repos' (another machine's: Triage isn't there yet) */
export function triageConfig(f: any, repos: { key: string; machine: string | null }[]): { all: TriageKeys; repos: Record<string, TriageKeys & { own: string[] }> } {
  const { own: _o, ...all } = triageOf(f, null);
  return { all, repos: Object.fromEntries(repos.filter((r) => !r.machine).map((r) => [r.key, triageOf(f, r.key)])) };
}

/** The person's change to one Triage key (key: "triage.<name>"; null: Reset, back to Everywhere's or the default), in
 *  the settings file being changed. place: "all" (Everywhere; never the level) or "repo:<key>" (this machine's). from:
 *  a space on the repo, whose not-moved task settings go along (settings.ts repoLayer). */
export function setTriage(next: any, place: string, key: string, value: unknown, from?: string | null) {
  const k = key.slice("triage.".length);
  if (!TRIAGE_KEYS.includes(k as keyof TriageKeys)) throw new Error("That setting can't be changed here.");
  const v = value === null ? null : triageValue(k, value);
  let layer: any;
  if (place === "all") {
    if (k === "level") throw new Error("Triage is switched on one repo at a time: pick it under Applies to.");
    layer = (next.everywhere ??= {});
  } else if (place.startsWith("repo:")) {
    const repo = place.slice(5);
    if (!repo.startsWith("/")) throw new Error("Triage works only on this machine's repos for now.");
    layer = repoLayer(next, repo, from ?? null);
  } else throw new Error("Triage is set for everything or for one repo.");
  const t = { ...layerOf(layer) };
  if (v === null) delete t[k]; else t[k] = v;
  if (Object.keys(t).length) layer.triage = t; else delete layer.triage;
}
