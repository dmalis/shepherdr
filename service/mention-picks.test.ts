// dmalis/shepherdr "Chat: say what each thing is": a mention resolves to the one task picked, never to every task that
// shares its title (a schedule's runs all share one). Fake data.
import { expect, test } from "bun:test";
import { quoteOf } from "./actions.ts";
import { mentionedIn } from "../core/send.js";
import { sharedTitles, unpicked } from "../core/mention-picks.js";

const runs = Array.from({ length: 11 }, (_, i) => ({ ref: `SD-${i + 1}`, id: i + 1, title: "Install merged", status_text: "Done", why: "", folder: "/srv/repo", prompt: "Install main's tip", state: "done" }));
const login = { ref: "SD-40", id: 40, title: "Fix login", status_text: "Working", why: "", folder: "/srv/repo", prompt: "Make sign-in work", state: "working" };
const fake = (tasks: any[]) => ({ replyTaskOf: () => null, tasksFor: () => tasks }) as any;

test("a picked run of a schedule gives the agent exactly that one task, not every run sharing its title", () => {
  const q = quoteOf({ chat: "p:sp1", text: "what did [@Install merged](task:SD-7) do?" }, fake([...runs, login]), null);
  expect(q.tags.match(/<hc task=/g)?.length).toBe(1);
  expect(q.tags).toContain('<hc task="SD-7" title="Install merged"');
});

test("a picked link from another machine or folder still names its one task by its key", () => {
  expect(mentionedIn("[@Install merged](task:vm>mini/SD-3?folder=~/dev/repo) again?", runs).map((x: any) => x.ref)).toEqual(["SD-3"]);
});

test("a title several tasks share names none of them; a title only one has still names it", () => {
  expect(mentionedIn("did Install merged finish?", runs)).toEqual([]);
  expect(mentionedIn("is Fix login done?", [...runs, login]).map((x: any) => x.ref)).toEqual(["SD-40"]);
  // a key typed by hand still names its task
  expect(mentionedIn("look at SD-4", runs).map((x: any) => x.ref)).toEqual(["SD-4"]);
});

test("a picked link's words never count as a title written in the message", () => {
  expect(mentionedIn("[@Fix login](task:SD-40)", [login]).map((x: any) => x.ref)).toEqual(["SD-40"]);
  // its words name another task's title: only the picked key counts
  const other = { ...login, ref: "SD-41", id: 41 , title: "Fix login flow" };
  expect(mentionedIn("[@Fix login flow](task:SD-40)", [login, other]).map((x: any) => x.ref)).toEqual(["SD-40"]);
  expect(unpicked("ask [@A b](task:X-1) and [#shop](space:sp1) now")).toBe("ask   and   now");
  expect([...sharedTitles([{ title: "A b" }, { title: "a  B" }, { title: "C" }])]).toEqual(["a b"]);
});
