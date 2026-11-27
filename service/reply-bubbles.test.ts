// dmalis/shepherdr#51: a tapped suggested reply goes as a reply to the message it came with (the web app sends that
// message's id, web/plugins/chat/reply-bubbles.tsx): the agent gets the reply-to line with its first words above the
// bubble's words, so it knows what the answer is for. Fake data.
import { expect, test } from "bun:test";
import { quoteOf } from "./actions.ts";
import { messageBody } from "../core/send.js";

const fake = { replyTaskOf: () => null, tasksFor: () => [] } as any;

test("a tapped bubble reaches the agent under the reply-to line of its message", () => {
  const asks = 'One line under the Everything row: "Your chats with every space, in one place." Should I start on them?';
  const r = { conv: { items: [{ id: "m1", text: "Here's what I'd change: 1. Add the Everything hint" }, { id: "m3", text: asks }] } };
  const q = quoteOf({ type: "send", chat: "p:docs", text: "Do all four", reply: "m3", how: "bubble" }, fake, r);
  expect(q.quote).toBe(asks);
  expect(messageBody({ text: "Do all four", quote: q.quote, tags: q.tags }))
    .toBe('<hc reply-to="One line under the Everything row: ”Your chats with every space, in one place.”…"/>\nDo all four');
});
