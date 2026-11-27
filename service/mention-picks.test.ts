// dmalis/shepherdr "Chat: say what each thing is": a mention resolves to the one task picked, never to every task that
// shares its title (a schedule's runs all share one). Fake data.
import { expect, test } from "bun:test";
import { quoteOf } from "./actions.ts";
import { mentionedIn } from "../core/send.js";
import { pickedElsewhere, pickedHere, sameFolder, sharedTitles, unpicked } from "../core/mention-picks.js";

const runs = Array.from({ length: 11 }, (_, i) => ({ ref: `SD-${i + 1}`, id: i + 1, title: "Install merged", status_text: "Done", why: "", folder: "/srv/repo", prompt: "Install main's tip", state: "done" }));
const login = { ref: "SD-40", id: 40, title: "Fix login", status_text: "Working", why: "", folder: "/srv/repo", prompt: "Make sign-in work", state: "working" };
const fake = (tasks: any[]) => ({ replyTaskOf: () => null, tasksFor: () => tasks }) as any;

test("a picked run of a schedule gives the agent exactly that one task, not every run sharing its title", () => {
  const q = quoteOf({ chat: "p:sp1", text: "what did [@Install merged](task:SD-7) do?" }, fake([...runs, login]), null);
  expect(q.tags.match(/<hc task=/g)?.length).toBe(1);
  expect(q.tags).toContain('<hc task="SD-7" title="Install merged"');
});

// every task known here, as compat's rows: this chat's folder on this machine (machine null), another folder, another machine
const rows = [
  ...runs.map((x) => ({ ...x, machine: null })),
  { ...login, ref: "SD-7", id: 7, title: "Other folder's", folder: "/srv/other", machine: null },
  { ...login, ref: "SD-7", id: 7, title: "On the vm", folder: "/srv/me/dev/repo", machine: "vm" },
];
const withPicks = (tasks: any[]) => ({ ...fake(tasks), pickedFor: (_: string, text: string) => pickedElsewhere(text, rows, null) }) as any;

test("a pick from another machine or folder names that task, never the chat's own task with the same key", () => {
  // the route's last hop is the machine; a "~/" folder is matched by its end
  const vm = quoteOf({ chat: "p:sp1", text: "and [@On the vm](task:mini>vm/SD-7?folder=~/dev/repo)?" }, withPicks(runs), null);
  expect(vm.tags.match(/<hc task=/g)?.length).toBe(1);
  expect(vm.tags).toContain('title="On the vm"');
  const other = quoteOf({ chat: "p:sp1", text: "and [@Other folder's](task:SD-7?folder=/srv/other)?" }, withPicks(runs), null);
  expect(other.tags.match(/<hc task=/g)?.length).toBe(1);
  expect(other.tags).toContain('title="Other folder\'s"');
  // one not known here names none (its link still tells the agent where), and never the local SD-7
  expect(quoteOf({ chat: "p:sp1", text: "[@Gone](task:pi/SD-7?folder=/srv/x)" }, withPicks(runs), null).tags).toBe("");
  expect(mentionedIn("[@On the vm](task:mini>vm/SD-7?folder=~/dev/repo)", runs)).toEqual([]);
  // the chat's own task picked: once, not again from the other lookup
  expect(quoteOf({ chat: "p:sp1", text: "[@Install merged](task:SD-7)" }, withPicks(runs), null).tags.match(/<hc task=/g)?.length).toBe(1);
});

test("a key written inside a picked title names nothing more", () => {
  const follow = { ...login, ref: "SD-50", id: 50, title: "Follow up on SD-12" }, twelve = { ...login, ref: "SD-12", id: 12, title: "Twelve" };
  expect(mentionedIn("[@Follow up on SD-12](task:SD-50) is it done?", [follow, twelve]).map((x: any) => x.ref)).toEqual(["SD-50"]);
  expect(pickedHere({ ref: "sd-50", route: "", folder: "" }, follow)).toBe(true);
  expect(sameFolder("~/dev/repo", "/srv/me/dev/repo")).toBe(true);
  expect(sameFolder("~/dev/repo", "/srv/me/dev/repo2")).toBe(false);
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
