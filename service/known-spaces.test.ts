// The "#" list in a chat whose agent runs on another machine than the one serving Shepherdr: a space of the same name
// on each machine was listed twice under the agent's machine, the serving machine's one aimed at the agent's machine,
// and Everything went to the agent's machine's own home. The service's known list is relative to the serving machine,
// the reach map to the agent's: known-spaces.ts gives the map the list as the agent's machine sees it.
// The fixture is a real pair of views, cut down and anonymised: "laptop" runs the agent, "server" serves Shepherdr.
import { expect, test } from "bun:test";
import * as MN from "../core/mentions.js";
import { knownFrom } from "./known-spaces.ts";
const { reachable } = MN as any;

// laptop's reach map: its own spaces, then server as laptop's probe read it (an older herdr-task there read only a
// stale window copy: one blank space, and the assistants it saw)
const laptopMap = {
  core: { id: "c-laptop", name: "laptop" }, host: "laptop", home: "/base/laptop",
  spaces: [
    { id: "spLA", name: ".agents", folder: "/base/laptop/.agents" },
    { id: "spLS", name: "shop", folder: "/base/laptop/dev/shop" },
  ],
  assistants: [{ space: "spLA" }],
  links: [{ how: "herdr-core", to: "server", ok: true, id: "c-server", next: {
    core: { id: "c-server", name: "server" }, home: "/base/server", spaces: [],
    assistants: [{ space: "home" }, { space: "spSA" }],
    links: [{ how: "herdr-core", to: "laptop", ok: true, id: "c-laptop" }],
  } }],
};
// server's own map, the same two machines from its side
const serverMap = {
  core: { id: "c-server", name: "server" }, host: "server", home: "/base/server", everything: "home",
  spaces: [
    { id: "home", name: "Everything", folder: "/base/server" },
    { id: "spSA", name: ".agents", folder: "/base/server/.agents" },
    { id: "spSN", name: "notes", folder: "/base/server/notes" },
  ],
  assistants: [{ space: "home" }, { space: "spSA" }],
  links: [{ how: "herdr-core", to: "laptop", ok: true, id: "c-laptop", next: laptopMap }],
};
// the service's known list on server (knownSpaces() in main.ts): server's own spaces carry no machine
const known = [
  { id: "home", name: "Home", folder: "/base/server", machine: null, everything: true, assistant: true },
  { id: "spLA", name: ".agents", folder: "/base/laptop/.agents", machine: "laptop", everything: false, assistant: true },
  { id: "spSA", name: ".agents", folder: "/base/server/.agents", machine: null, everything: false, assistant: true },
  { id: "spSN", name: "notes", folder: "/base/server/notes", machine: null, everything: false, assistant: false },
];
const rows = (list: any[]) => list.map((s) => [s.name, s.machine, s.target]);

test("an agent on another machine: each same-named space under its own machine, aimed at it", () => {
  const list = reachable(laptopMap, knownFrom(known, "c-server", "laptop"));
  expect(rows(list.filter((s: any) => s.name === ".agents"))).toEqual([
    [".agents", "laptop", "spLA"],
    [".agents", "server", "server/spSA"],
  ]);
  expect(rows(list)).toEqual([
    ["Everything", "server", "server/home"],
    [".agents", "laptop", "spLA"],
    ["shop", "laptop", "spLS"],
    [".agents", "server", "server/spSA"],
    ["notes", "server", "server/spSN"],
  ]);
  // the token a pick sends names the right machine
  const theirs = list.find((s: any) => s.name === ".agents" && s.machine === "server");
  expect(MN.token(theirs)).toBe("[#.agents](space:server/spSA)");
});

test("before: the known list as it was given to another machine's map put server's spaces on the agent's machine", () => {
  const list = reachable(laptopMap, known);
  expect(rows(list.filter((s: any) => s.name === ".agents")).map((r) => r[1])).toEqual(["laptop", "laptop"]);
});

test("an agent on the serving machine: the known list is given as it is, and the list is unchanged", () => {
  expect(knownFrom(known, "c-server", null)).toBe(known);
  expect(rows(reachable(serverMap, knownFrom(known, "c-server", null)))).toEqual([
    ["Everything", "server", "home"],
    [".agents", "server", "spSA"],
    ["notes", "server", "spSN"],
    [".agents", "laptop", "laptop/spLA"],
    ["shop", "laptop", "laptop/spLS"],
  ]);
});

test("a third machine's spaces keep their machine; the serving machine's are left out when its id is unknown", () => {
  const more = [...known, { id: "spX", name: "x", folder: "/base/x", machine: "box", everything: false, assistant: false }];
  expect(knownFrom(more, "c-server", "laptop").map((k) => [k.id, k.machine])).toEqual([
    ["home", "@c-server"], ["spLA", null], ["spSA", "@c-server"], ["spSN", "@c-server"], ["spX", "box"],
  ]);
  expect(knownFrom(more, "", "laptop").map((k) => k.id)).toEqual(["spLA", "spX"]);
});

test("the serving machine is found by its core id, even when another machine's link has its name", () => {
  // laptop calls the serving machine "main", and a third machine "server", the serving machine's own core name
  const map = {
    core: { id: "c-laptop", name: "laptop" }, spaces: [{ id: "spLA", name: ".agents" }], links: [
      { how: "herdr-core", to: "main", next: { core: { id: "c-server", name: "server" }, spaces: [], links: [] } },
      { how: "herdr-core", to: "server", next: { core: { id: "c-other", name: "other" }, spaces: [{ id: "spOA", name: ".agents" }], links: [] } },
    ],
  };
  const list = reachable(map, knownFrom(known, "c-server", "laptop"));
  expect(rows(list.filter((s: any) => s.name === ".agents"))).toEqual([
    [".agents", "laptop", "spLA"],
    [".agents", "server", "main/spSA"],
    [".agents", "other", "server/spOA"],
  ]);
});
