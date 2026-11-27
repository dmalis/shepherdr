// A mention resolves to the one task picked (dmalis/shepherdr, "Chat: say what each thing is"): a picked
// [@Install merged](task:SD-7) is that task by its key, and its words never name every task with the same title (a
// schedule's runs share one), nor a key written in a title ("Follow up on SD-12"). A pick from another folder or
// machine carries its route and folder (core/mentions.js taskTarget) and names that task, never the chat's own task
// with the same key. core/send.js mentionedIn() and service/actions.ts quoteOf() read a message through these.
import { parseTask } from "./mentions.js";

const PICKED = /\[[#@][^\]\n]{1,80}\]\((?:space|task):[^)\s]+\)/g;
const TASK_LINK = /\[@[^\]\n]{1,80}\]\(task:([^)\s]+)\)/g;

/** a message's words with each picked link taken out (its key is matched on the link's target, by picks()) */
export const unpicked = (text) => String(text ?? "").replace(PICKED, " ");

/** the titles more than one task has, lower case: such a title alone is no mention of any one of them */
export function sharedTitles(tasks) {
  const seen = new Set(), shared = new Set();
  for (const x of tasks ?? []) {
    const title = String(x?.title ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!title) continue;
    if (seen.has(title)) shared.add(title);
    seen.add(title);
  }
  return shared;
}

/** each task link's target: [{ ref, route, folder }] */
export const picks = (text) => [...String(text ?? "").matchAll(TASK_LINK)].map((m) => parseTask(m[1]));

/** a pick's folder ("~/dev/shop" as the picker wrote it) is this task's folder */
export const sameFolder = (want, folder) =>
  !!folder && (want === folder || (want.startsWith("~/") && String(folder).endsWith(want.slice(1))));

const sameRef = (p, x) => !!x?.ref && p.ref.toLowerCase() === String(x.ref).toLowerCase();

/** a pick of a task in the chat's own folder: no route, and no folder or this one */
export const pickedHere = (p, x) => !p.route && sameRef(p, x) && (!p.folder || sameFolder(p.folder, x.folder));

/** The tasks a message picked in another folder or on another machine, each the one its route, folder and key name.
 *  rows: every task known here ({ ref, folder, machine, ... }); machine: the chat's machine (null here). A pick that
 *  fits several, or none, names nothing: its link still tells the agent where to look. */
export function pickedElsewhere(text, rows, machine) {
  const out = [];
  for (const p of picks(text)) {
    if (!p.route && !p.folder) continue;
    // the route's last hop is the machine the task is on; no route: the chat's own machine, another folder
    const hop = p.route ? p.route.split(">").pop().toLowerCase() : null;
    const there = (rows ?? []).filter((x) => sameRef(p, x) && (!p.folder || sameFolder(p.folder, x.folder)) &&
      (hop ? String(x.machine ?? "").toLowerCase() === hop : (x.machine ?? null) === (machine ?? null)));
    if (there.length === 1 && !out.includes(there[0])) out.push(there[0]);
  }
  return out;
}
