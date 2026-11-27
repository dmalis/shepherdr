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

// a code fence: ``` or ~~~ (three or more), closed by the same kind
const FENCE = /^\s*(`{3,}|~{3,})/;

/** which lines are in a code block (a fence line counts as in) */
function fenced(lines) {
  let open = null;
  return lines.map((l) => {
    const m = FENCE.exec(l);
    if (!m) return !!open;
    if (!open) open = m[1][0];
    else if (m[1][0] === open) open = null;
    return true;
  });
}

const clean = (t) => t.replace(/^[*_]+|[*_]+$/g, "").trim().replace(/^[“"'`]+|[”"'`]+$/g, "").replace(/\s+/g, " ").trim();

/** { text, suggests } with a trailing "Suggested replies:" block taken out, or null when the message ends without one.
 *  Only the end counts: such words earlier in a message are the agent's to say. A code block is never read. */
export function plainSuggests(text) {
  const lines = String(text ?? "").replace(/\s+$/, "").split("\n");
  // a list in a code block (its heading in one, even one left open) is code: leave it; a fence after the heading
  // ends the items' run below, so it isn't last
  const code = fenced(lines);
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
  const h = code[i] ? null : HEAD.exec(lines[i]);
  if (!h) return null;
  // items on the heading's own line: quoted ones ("Suggested replies: “Yes”, “Not yet”")
  // only quoted items, with commas, "or" and a full stop between them: anything else is a sentence ("Suggested
  // replies: replace “Stop” with “Pause”."), the agent's to say
  if (h[1] && h[1].replace(QUOTED, "").replace(/\b(or|and)\b|[,;.\s]/gi, "") !== "") return null;
  const inline = h[1] ? [...h[1].matchAll(QUOTED)].map((m) => clean(m[1])) : [];
  if (h[1] && !inline.length) return null;
  const suggests = [...new Set([...inline, ...items].filter(Boolean))];
  if (!suggests.length) return null;
  return { text: lines.slice(0, i).join("\n").replace(/\s+$/, ""), suggests };
}
