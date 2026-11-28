// A space's folder by its real path (dmalis/shepherdr#131). A space keeps its folder as it was given, a symlink too,
// while herdr-task keeps a task's folder by its real path: the web app compares the two to tell whether a task works
// in its space's own folder. Only this machine's folders can be resolved here; another machine's keep their path.
import { realpathSync } from "node:fs";

const kept = new Map<string, { real: string; at: number }>();
/** how long a resolved path is trusted: a symlink is rarely moved, and a folder on a slow disk is asked once a minute */
const FOR = 60_000;

/** the folder's real path on this machine when it differs from the path as given; null when it is the same, or can't
 *  be read (gone, no access) */
export function realFolder(folder: string | null | undefined, now = Date.now()): string | null {
  if (!folder) return null;
  let k = kept.get(folder);
  if (!k || now - k.at > FOR) {
    let real = folder;
    try {
      real = realpathSync(folder);
    } catch {}
    k = { real, at: now };
    kept.set(folder, k);
  }
  return k.real !== folder.replace(/(.)\/+$/, "$1") ? k.real : null;
}
