// The web app's files sent compressed, cached right (fork patch #148): a real server over a built-like folder, read
// as a browser would, with the bytes as sent (decompress: false) and decoded.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { compressDir } from "../web/compress.ts";
import { codings, webFile } from "./static.ts";

const root = mkdtempSync(join(tmpdir(), "shep-static-"));
mkdirSync(join(root, "assets"));
const JS = "export const greet = (n) => `hello ${n}`;\n".repeat(400);
const CSS = ".row { color: var(--muted); padding: 8px 12px; }\n".repeat(300);
writeFileSync(join(root, "index.html"), "<!doctype html><title>Shepherdr</title>" + "<meta name=x>".repeat(200));
writeFileSync(join(root, "assets", "index-abc123.js"), JS);
writeFileSync(join(root, "assets", "index-abc123.css"), CSS);
writeFileSync(join(root, "assets", "tiny-abc123.js"), "export{}");
writeFileSync(join(root, "assets", "font-abc123.woff2"), Buffer.alloc(4096, 7));
const wrote = await compressDir(join(root, "assets"));

const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => webFile(root, new URL(req.url).pathname, req.headers.get("accept-encoding")) });
afterAll(() => server.stop(true));
const get = async (path: string, accept?: string, method = "GET") => {
  const r = await fetch(`http://127.0.0.1:${server.port}${path}`, { method, headers: accept === undefined ? { "accept-encoding": "" } : { "accept-encoding": accept }, decompress: false } as RequestInit);
  return { r, body: Buffer.from(await r.arrayBuffer()) };
};

describe("which coding a browser gets", () => {
  test("brotli first, else gzip, else none", () => {
    expect(codings("gzip, deflate, br, zstd")).toEqual(["br", "gzip"]);
    expect(codings("gzip, deflate")).toEqual(["gzip"]);
    expect(codings("deflate")).toEqual([]);
    expect(codings("")).toEqual([]);
    expect(codings(null)).toEqual([]);
    expect(codings("identity")).toEqual([]);
  });
  test("q-values count: q=0 refuses, a higher q comes first, * stands for the rest", () => {
    expect(codings("br;q=0, gzip")).toEqual(["gzip"]);
    expect(codings("br;q=0.5, gzip;q=1")).toEqual(["gzip", "br"]);
    expect(codings("br;q=0, gzip;q=0")).toEqual([]);
    expect(codings("*")).toEqual(["br", "gzip"]);
    expect(codings("*;q=0")).toEqual([]);
    expect(codings("gzip, *;q=0")).toEqual(["gzip"]);
    expect(codings("BR ; Q=0.9 , GZIP;q=0.8")).toEqual(["br", "gzip"]);
    expect(codings("x-gzip")).toEqual(["gzip"]);
    expect(codings("br;q=nonsense")).toEqual([]);
  });
});

describe("the build's copies", () => {
  test("the build makes them: its config runs the plugin", () => {
    const config = readFileSync(join(import.meta.dir, "..", "web", "vite.config.ts"), "utf8");
    expect(config).toContain("import { compressAssets } from './compress.ts'");
    expect(config).toContain("compressAssets()");
  });
  test("a brotli and a gzip copy beside each text file worth it, none for a tiny one or a font", () => {
    expect(wrote).toEqual(["index-abc123.css.br", "index-abc123.css.gz", "index-abc123.js.br", "index-abc123.js.gz"]);
    expect(brotliDecompressSync(readFileSync(join(root, "assets", "index-abc123.js.br"))).toString()).toBe(JS);
    expect(gunzipSync(readFileSync(join(root, "assets", "index-abc123.css.gz"))).toString()).toBe(CSS);
  });
});

describe("a hashed file", () => {
  const same = (r: Response) => {
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("vary")).toBe("Accept-Encoding");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("etag")).toBeNull();
  };
  test("brotli to a browser that takes it, decoding to the file, its type kept", async () => {
    const { r, body } = await get("/assets/index-abc123.js", "gzip, deflate, br, zstd");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-encoding")).toBe("br");
    expect(r.headers.get("content-type")).toStartWith("text/javascript");
    expect(Number(r.headers.get("content-length"))).toBe(body.length);
    expect(body.length).toBeLessThan(JS.length / 4);
    expect(brotliDecompressSync(body).toString()).toBe(JS);
    same(r);
  });
  test("gzip when brotli isn't taken", async () => {
    const { r, body } = await get("/assets/index-abc123.css", "gzip, deflate");
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect(r.headers.get("content-type")).toStartWith("text/css");
    expect(gunzipSync(body).toString()).toBe(CSS);
    same(r);
  });
  test("as it is with no Accept-Encoding, or both refused", async () => {
    for (const accept of [undefined, "identity", "br;q=0, gzip;q=0", "*;q=0"]) {
      const { r, body } = await get("/assets/index-abc123.js", accept);
      expect(r.headers.get("content-encoding")).toBeNull();
      expect(body.toString()).toBe(JS);
      expect(r.headers.get("content-type")).toStartWith("text/javascript");
      same(r);
    }
  });
  test("as it is when the build wrote no copy (a tiny file, a font)", async () => {
    const tiny = await get("/assets/tiny-abc123.js", "br, gzip");
    expect(tiny.r.headers.get("content-encoding")).toBeNull();
    expect(tiny.body.toString()).toBe("export{}");
    const font = await get("/assets/font-abc123.woff2", "br, gzip");
    expect(font.r.headers.get("content-encoding")).toBeNull();
    expect(font.r.headers.get("content-type")).toBe("font/woff2");
    same(font.r);
  });
  test("HEAD: the same headers, the compressed length, no body", async () => {
    const full = await get("/assets/index-abc123.js", "br");
    const { r, body } = await get("/assets/index-abc123.js", "br", "HEAD");
    expect(r.status).toBe(200);
    expect(body.length).toBe(0);
    expect(r.headers.get("content-encoding")).toBe("br");
    expect(r.headers.get("content-type")).toStartWith("text/javascript");
    expect(r.headers.get("content-length")).toBe(String(full.body.length));
    same(r);
  });
  test("a conditional GET gets the whole file again: no validator is sent, so none is honoured", async () => {
    const r = await fetch(`http://127.0.0.1:${server.port}/assets/index-abc123.js`, { headers: { "accept-encoding": "br", "if-modified-since": new Date(Date.now() + 60_000).toUTCString(), "if-none-match": "*" }, decompress: false } as RequestInit);
    expect(r.status).toBe(200);
    expect(r.headers.get("last-modified")).toBeNull();
  });
  test("one that isn't there (a page from an older build) is a 404, not the page marked immutable", async () => {
    for (const path of ["/assets/index-gone99.js", "/assets/", "/assets/index-abc123.js.zz"]) {
      const { r, body } = await get(path, "br, gzip");
      expect(r.status).toBe(404);
      expect(r.headers.get("cache-control")).toBe("no-cache");
      expect(r.headers.get("vary")).toBe("Accept-Encoding");
      expect(r.headers.get("content-encoding")).toBeNull();
      expect(body.toString()).not.toContain("<title>");
    }
  });
});

describe("the page", () => {
  test("index.html as it is, checked on each load, for its own path and any route", async () => {
    // a compressed copy beside it (left by hand, or a stale one) is never sent
    writeFileSync(join(root, "index.html.br"), "stale");
    for (const path of ["/", "/index.html", "/some/route", "/../../etc/passwd", "/assets"]) {
      const { r, body } = await get(path, "gzip, deflate, br");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-encoding")).toBeNull();
      expect(r.headers.get("cache-control")).toBe("no-cache");
      expect(r.headers.get("content-type")).toStartWith("text/html");
      expect(r.headers.get("vary")).toBe("Accept-Encoding");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(body.toString()).toStartWith("<!doctype html><title>Shepherdr</title>");
    }
  });
  test("an unbuilt app says so", () => {
    const empty = mkdtempSync(join(tmpdir(), "shep-static-none-"));
    const r = webFile(empty, "/", "br");
    expect(r.status).toBe(503);
  });
});
