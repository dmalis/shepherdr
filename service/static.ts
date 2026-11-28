// The web app's own files, sent compressed when the browser takes it (fork patch #148). The build writes a brotli
// and a gzip copy beside each hashed file in assets/ (web/compress.ts); this picks one by the request's
// Accept-Encoding. The page itself (index.html) is always sent as it is, so a stale copy of it is never served.
import { statSync } from "node:fs";
import { join, normalize } from "node:path";

export type Coding = "br" | "gzip";

// the codings an Accept-Encoding header takes, best first: brotli, else gzip; none means the file as it is. Its
// q-values count: q=0 refuses a coding, a higher q comes first, and * stands for any coding it doesn't name. On a
// tie brotli comes first.
export function codings(accept: string | null | undefined): Coding[] {
  if (!accept) return [];
  const q = new Map<string, number>();
  for (const part of accept.split(",")) {
    const [name, ...params] = part.split(";").map((x) => x.trim().toLowerCase());
    if (!name) continue;
    let v = 1;
    // a q it can't read counts as a refusal
    for (const p of params) if (/^q\s*=/.test(p)) v = Number(/^q\s*=\s*([0-9.]+)$/.exec(p)?.[1] ?? NaN);
    q.set(name, Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  }
  const of = (c: string, alias?: string) => q.get(c) ?? (alias ? q.get(alias) : undefined) ?? q.get("*") ?? 0;
  const br = of("br"), gz = of("gzip", "x-gzip");
  const by: [Coding, number][] = [["br", br], ["gzip", gz]];
  return by.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

const EXT: Record<Coding, string> = { br: ".br", gzip: ".gz" };
const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

// a file of the built app at root (web/dist) for a request's path: a hashed file is kept for a year, the page is
// checked on each load. A path that isn't a file gets the page (the app routes in the page), except under assets/:
// a hashed file that isn't there (a page from an older build) answers 404, never the page marked immutable.
export function webFile(root: string, path: string, accept: string | null): Response {
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, "").replace(/^\/+/, "");
  const immutable = rel.startsWith("assets/");
  const base = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    // the same URL answers differently by Accept-Encoding: a cache in between keeps one copy per coding
    vary: "Accept-Encoding",
  };
  let p = join(root, rel);
  if (!p.startsWith(root) || rel === "" || !isFile(p)) {
    if (immutable) return new Response("Not found", { status: 404, headers: { ...base, "cache-control": "no-cache", "content-type": "text/plain;charset=utf-8" } });
    p = join(root, "index.html");
  }
  if (!isFile(p)) return new Response("The web app isn't built: run bun run build.", { status: 503 });
  // the type is the file's own, not its compressed copy's, and is set here so a HEAD answer carries it too
  const headers: Record<string, string> = { ...base, "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache", "content-type": Bun.file(p).type };
  // the best coding the browser takes that the build wrote a copy in (a file too small to gain has none)
  const coding = immutable ? codings(accept).find((c) => isFile(p + EXT[c])) : undefined;
  if (coding) headers["content-encoding"] = coding;
  return new Response(Bun.file(coding ? p + EXT[coding] : p), { headers });
}
