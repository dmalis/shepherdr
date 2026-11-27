// The pictures under the person's own message (#56). Claude Code says where an image it read came from
// ("[Image: source: <path>]") only for a message it took between turns. One typed while it worked (taken mid-turn: its
// queued_command) and one pasted into its terminal have no such line: the picture is only inside the log, as the
// image block the agent got. The chat shows those from the log itself, so every sent picture is one you can open.
import { keep } from "./media.ts";

/** a picture inside a log: which log (a short tag of its path), the message's item id (its line's byte offset) and
 *  which of its images */
export const LOG_IMAGE = /^image:([0-9a-z]+):u(\d+):(\d+)$/;
const tagOf = (log: string) => Bun.hash(log).toString(36);
export const logImage = (log: string, id: string, n: number) => `image:${tagOf(log)}:${id}:${n}`;

type File = { name: string; path: string; alt?: string };
const IMAGE = /\.(png|jpe?g|gif|webp|avif|heic|bmp)$/i;
const base = (p: string) => p.split("/").pop() || "image";
const named = (paths: string[]) => paths.map((p) => ({ name: base(p), path: p }));

/** The pictures to show under one of the person's messages in the log ({ id, images, paths }; log: the log's path):
 *  the files Claude Code named, when it named them all; else the pictures the page sent with it (its send, while still
 *  known); else each image from the log. -> the files, and how many are left that none of these can show. */
export function sentPictures(x: { id: string; images?: number; paths?: string[] }, log: string | null, sent?: { files: string[] } | null): { files: File[]; unseen: number } {
  const n = x.images ?? 0, paths = x.paths ?? [];
  if (paths.length >= n) return { files: named(paths), unseen: 0 };
  const pics = (sent?.files ?? []).filter((p) => IMAGE.test(p));
  if (pics.length === n) return { files: named(pics), unseen: 0 };
  if (!log || !/^u\d+$/.test(x.id)) return { files: named(paths), unseen: n - paths.length };
  return { files: Array.from({ length: n }, (_, i) => ({ name: n > 1 ? `Image ${i + 1}.png` : "Image.png", path: logImage(log, x.id, i), alt: n > 1 ? `Image ${i + 1} of ${n}` : "Image" })), unseen: 0 };
}

/** the image blocks in one log line: a message's (message.content) or one taken mid-turn (attachment.prompt) */
export function imagesIn(line: string): { type: string; data: string }[] {
  let l: any;
  try { l = JSON.parse(line); } catch { return []; }
  const c = l?.type === "user" ? l.message?.content : l?.type === "attachment" && l.attachment?.type === "queued_command" ? l.attachment.prompt : null;
  return (Array.isArray(c) ? c : [])
    .filter((b: any) => b?.type === "image" && b.source?.type === "base64" && typeof b.source.data === "string" && /^image\/[\w.+-]+$/.test(String(b.source.media_type)))
    .map((b: any) => ({ type: String(b.source.media_type), data: b.source.data }));
}

/** one whole line of the log, from its byte offset, on the agent's machine (sh -c LINE line <offset> <log>) */
const LINE = 'tail -c +$(($1 + 1)) "$2" | head -n 1';
const types = new Map<string, string>();

/** A picture inside the log the chat follows (a path sentPictures gave): only one of the person's messages that its
 *  conversation has now, in the log it reads now. -> its bytes and type, or null */
export async function readLogImage(reader: any, path: string): Promise<{ type: string; bytes: Uint8Array } | null> {
  const m = LOG_IMAGE.exec(path);
  if (!m || !reader?.path || typeof reader.run !== "function" || m[1] !== tagOf(reader.path)) return null;
  const off = m[2]!, n = Number(m[3]);
  const x = (reader.conv?.items ?? []).find((i: any) => i.kind === "user" && i.id === `u${off}`);
  if (!x || n >= (x.images ?? 0)) return null;
  // (kept a little while: a chat asks for its thumbnail and then the picture)
  const k = `log-image\0${reader.machine ?? ""}\0${reader.path}\0${off}\0${n}`;
  const was = keep(k), type = types.get(k);
  if (was && type) return { type, bytes: was };
  const r = await reader.run(LINE, ["line", off, reader.path]).catch(() => null);
  const img = r && r.code === 0 ? imagesIn(String(r.stdout ?? "").trim())[n] : undefined;
  if (!img) return null;
  const bytes = new Uint8Array(Buffer.from(img.data, "base64"));
  types.set(k, img.type);
  if (types.size > 200) types.delete(types.keys().next().value!);
  return { type: img.type, bytes: keep(k, bytes) ?? bytes };
}
