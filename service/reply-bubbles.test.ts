// dmalis/shepherdr#51: a tapped suggested reply goes as a reply to the message it came with (the web app sends that
// message's id, web/plugins/chat/reply-bubbles.tsx): the agent gets the reply-to line with its first words above the
// bubble's words, so it knows what the answer is for. Fake data.
import { expect, spyOn, test } from "bun:test";
import { act, quoteOf } from "./actions.ts";
import { Compat } from "./compat.ts";
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

test("a tapped bubble in a stopped task's chat starts its agent again with the reply-to line", async () => {
  const compat = new Compat() as any;
  compat.taskOf = (id: string) => (id === "SHOP-2" ? { ref: "SHOP-2", folder: "/srv/shop", machine: null } : null);
  compat.addrOf = () => "log:/srv/shop/log.jsonl";
  compat.reader = (a: string) => (a === "log:/srv/shop/log.jsonl" ? { conv: { items: [{ id: "m7", text: "Merge the zoom patch now?" }] } } : null);
  compat.tasksFor = () => [];
  const hub: any = { terminals: new Map() };
  const ran: string[][] = [];
  const spawn = spyOn(Bun, "spawn").mockImplementation(((argv: string[]) => {
    ran.push(argv);
    return { stdout: new Blob(["{}"]).stream(), stderr: new Blob([]).stream(), exited: Promise.resolve(0) } as any;
  }) as any);
  try {
    expect(await act(hub, { type: "send", chat: "SHOP-2/worker", text: "Merge the zoom patch", reply: "m7", how: "bubble" }, compat)).toMatchObject({ ok: true, started: true });
  } finally { spawn.mockRestore(); }
  const reply = ran.find((a) => a[0] === "herdr-task" && a.includes("reply"))!;
  expect(reply[reply.indexOf("reply") + 2]).toBe('<hc reply-to="Merge the zoom patch now?"/>\nMerge the zoom patch');
});
