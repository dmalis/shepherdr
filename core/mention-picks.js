// A mention resolves to the one task picked (dmalis/shepherdr, "Chat: say what each thing is"): a picked
// [@Install merged](task:SD-7) is that task by its key, and its words never name every task with the same title (a
// schedule's runs share one). core/send.js mentionedIn() reads a message's words through these.

const PICKED = /\[[#@][^\]\n]{1,80}\]\((?:space|task):[^)\s]+\)/g;

/** a message's words with each picked link's words taken out (its key stays matched on the link itself) */
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
