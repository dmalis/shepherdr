// Which build of the web app this service serves (SHEP-337): the hashed files its index.html loads, as a page works
// out its own (web/shared/build.ts), and the version that index.html says. A page on another build learns of it
// (live.ts) and updates itself. Read again when index.html changes, so a new web app put in place without a restart
// is news too.
import { statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildId, buildVersion } from "../web/shared/build.ts";
import { stampOf, type Stamp } from "../web/shared/build-stamp.ts";

// stamp: which build of that version (fork patch #44), without its list of changes; none for a build without one
export type WebBuild = { id: string; version: string; stamp?: Stamp | null };

const served = (html: string): Stamp | null => {
  const s = stampOf(html);
  return s && { tag: s.tag, ahead: s.ahead, commit: s.commit, repo: s.repo };
};

export function webBuild(dir: string) {
  let seen = "";
  let now: WebBuild = { id: "", version: "" };
  return (): WebBuild => {
    const p = join(dir, "index.html");
    let stamp = "";
    try { const s = statSync(p); stamp = `${s.mtimeMs}:${s.size}`; } catch { return { id: "", version: "" }; }
    if (stamp !== seen) {
      try { const html = readFileSync(p, "utf8"); const which = served(html); now = { id: buildId(html), version: buildVersion(html), ...(which && { stamp: which }) }; seen = stamp; } catch { now = { id: "", version: "" }; }
    }
    return now;
  };
}
