// Suggested replies an agent wrote as plain words (dmalis/shepherdr#42): a "Suggested replies:" heading and a list
// last in its message, as an agent writes once a compacted conversation lost the <hc suggest="…"/> form. Never shown
// as the message's words: its items are the reply's suggestions, as its own lines would be (core/chat-log.js).

// the heading: "Suggested replies:", "**Suggested replies**", "Suggested next replies:", with its items on the same
// line or under it
const HEAD = /^\s*(?:[*_]{1,2})?\s*suggested(?: next)? repl(?:y|ies)\s*(?:[*_]{1,2})?\s*:?\s*(?:[*_]{1,2})?\s*(.*)$/i;
// an item: "- …", "* …", "• …", "1. …", "1) …"
const ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$/;
// quoted words in a line: “…”, "…", `…`
const QUOTED = /[“"`]([^”"`]+)[”"`]/g;

const clean = (t) => t.replace(/^[*_]+|[*_]+$/g, "").trim().replace(/^[“"'`]+|[”"'`]+$/g, "").replace(/\s+/g, " ").trim();

/** { text, suggests } with a trailing "Suggested replies:" block taken out, or null when the message ends without one.
 *  Only the end counts: such words earlier in a message are the agent's to say. A code block is never read. */
export function plainSuggests(text) {
  const lines = String(text ?? "").replace(/\s+$/, "").split("\n");
  if (lines.some((l) => l.trim().startsWith("```"))) {
    // a fence after the heading would mean the list is in code: leave it
    const last = lines.map((l) => l.trim().startsWith("```")).lastIndexOf(true);
    const head = lines.findLastIndex((l) => HEAD.test(l));
    if (head < 0 || last > head) return null;
  }
  let i = lines.length - 1;
  const items = [];
  for (; i >= 0; i--) {
    const l = lines[i];
    if (!l.trim()) continue;
    const m = ITEM.exec(l);
    if (!m) break;
    items.unshift(clean(m[1]));
  }
  if (i < 0) return null;
  const h = HEAD.exec(lines[i]);
  if (!h) return null;
  // items on the heading's own line: quoted ones ("Suggested replies: “Yes”, “Not yet”")
  const inline = h[1] ? [...h[1].matchAll(QUOTED)].map((m) => clean(m[1])) : [];
  if (h[1] && !inline.length) return null; // a sentence about suggested replies, not a list of them
  const suggests = [...new Set([...inline, ...items].filter(Boolean))];
  if (!suggests.length) return null;
  return { text: lines.slice(0, i).join("\n").replace(/\s+$/, ""), suggests };
}
