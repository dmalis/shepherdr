// The pictures under the person's own message (#56). Claude Code says where an image it read came from
// ("[Image: source: <path>]") only for a message it took between turns. One typed while it worked (taken mid-turn: its
// queued_command) and one pasted into its terminal have no such line: the picture is only inside the log, as the
// image block the agent got. The chat shows those from the log itself, so every sent picture is one you can open.
import { existsSync } from "node:fs";
import { keep } from "./media.ts";

/** a picture inside a log: which log (a short tag of its path), the message's item id (its line's byte offset) and
 *  which of its images */
export const LOG_IMAGE = /^image:([0-9a-z]+):u(\d+):(\d+)$/;
const tagOf = (log: string) => Bun.hash(log).toString(36);
export const logImage = (log: string, id: string, n: number) => `image:${tagOf(log)}:${id}:${n}`;

type File = { name: string; path: string; alt?: string };
const base = (p: string) => p.split("/").pop() || "image";

/** The pictures to show under one of the person's messages in the log ({ id, images, paths }; log: the log's path;
 *  here: the log is on this machine, so a named file that is gone is known): the files Claude Code named, when it
 *  named them all and they are there; else each image from the log itself (what the agent got, so never another
 *  message's). -> the files, and how many are left that none of these can show. */
export function sentPictures(x: { id: string; images?: number; paths?: string[] }, log: string | null, here = false): { files: File[]; unseen: number } {
  const n = x.images ?? 0, paths = x.paths ?? [];
  const named = paths.map((p) => ({ name: base(p), path: p }));
  if (paths.length >= n && !(here && n && paths.some((p) => p.startsWith("/") && !existsSync(p)))) return { files: named, unseen: 0 };
  if (!log || !/^u\d+$/.test(x.id)) return { files: named, unseen: Math.max(0, n - paths.length) };
  return { files: Array.from({ length: n }, (_, i) => ({ name: n > 1 ? `Image ${i + 1}.png` : "Image.png", path: logImage(log, x.id, i), alt: n > 1 ? `Image ${i + 1} of ${n}` : "Image" })), unseen: 0 };
}

const IMAGE_TYPE = /^image\/[\w.+-]+$/;
const blockOf = (b: any) => b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && IMAGE_TYPE.test(String(b.source.media_type))
  ? { type: String(b.source.media_type), data: b.source.data as string } : null;

/** the image blocks in one log line: a message's (message.content) or one taken mid-turn (attachment.prompt) */
export function imagesIn(line: string): { type: string; data: string }[] {
  let l: any;
  try { l = JSON.parse(line); } catch { return []; }
  const c = l?.type === "user" ? l.message?.content : l?.type === "attachment" && l.attachment?.type === "queued_command" ? l.attachment.prompt : null;
  return (Array.isArray(c) ? c : []).map(blockOf).filter((b): b is { type: string; data: string } => !!b);
}

/** Only the nth image block of the line at a byte offset, read on the agent's machine (sh -c PICK pick <offset> <log>
 *  <n>): a line with several pictures can be bigger than one herdr-core call carries, one picture never is (the API
 *  takes at most 5 MB each). It prints how many image blocks the line has, how many of them are a plain
 *  {"type":"image","source":{…}} (either order; the source has no braces inside), then the nth of those: it is the
 *  nth picture only when every one is plain, else the whole line is read. */
const BLOCK = String.raw`\{("type":"image","source":\{[^}]*\}|"source":\{[^}]*\},"type":"image")\}`;
const PICK = `l=$(tail -c +$(($1 + 1)) "$2" | head -n 1)
printf '%s\n' "$l" | grep -o '"type":"image"' | wc -l
printf '%s\n' "$l" | grep -oE '${BLOCK}' | wc -l
printf '%s\n' "$l" | grep -oE '${BLOCK}' | sed -n "$(($3 + 1))p"`;
/** the whole line, when its blocks are written some other way */
const LINE = 'tail -c +$(($1 + 1)) "$2" | head -n 1';
const types = new Map<string, string>();

/** A picture inside a log a chat follows (a path sentPictures gave), from the reader whose log it is (the chat's own,
 *  or the earlier history it shows above it): only one of the person's messages its conversation has now.
 *  -> its bytes and type, or null */
export async function readLogImage(readers: any[], path: string): Promise<{ type: string; bytes: Uint8Array } | null> {
  const m = LOG_IMAGE.exec(path);
  const reader = m && readers.find((r) => r?.path && typeof r.run === "function" && tagOf(r.path) === m[1]);
  if (!m || !reader) return null;
  const off = m[2]!, n = Number(m[3]);
  const x = (reader.conv?.items ?? []).find((i: any) => i.kind === "user" && i.id === `u${off}`);
  if (!x || n >= (x.images ?? 0)) return null;
  // (kept a little while: a chat asks for its thumbnail and then the picture)
  const k = `log-image\0${reader.machine ?? ""}\0${reader.path}\0${off}\0${n}`;
  const was = keep(k), type = types.get(k);
  if (was && type) return { type, bytes: was };
  const picked = await reader.run(PICK, ["pick", off, reader.path, String(n)]).catch(() => null);
  let img: { type: string; data: string } | null | undefined = null;
  const [all, plain, block] = String(picked?.code === 0 ? picked.stdout : "").split("\n");
  try { img = Number(all) === x.images && Number(plain) === x.images && block ? blockOf(JSON.parse(block)) : null; } catch {}
  if (!img) {
    const r = await reader.run(LINE, ["line", off, reader.path]).catch(() => null);
    img = r && r.code === 0 ? imagesIn(String(r.stdout ?? "").trim())[n] : undefined;
  }
  if (!img) return null;
  const bytes = new Uint8Array(Buffer.from(img.data, "base64"));
  types.set(k, img.type);
  if (types.size > 200) types.delete(types.keys().next().value!);
  return { type: img.type, bytes: keep(k, bytes) ?? bytes };
}
