// Files' small rules: paths inside a space's folder ("" is the folder itself), and sizes in words.
export const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
/** shown as a picture, not read as text */
export const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i
export function sizeWords(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

/** a folder asked again: a new answer replaces it; a failed one keeps what was shown, with the error and when it came
 *  (saved from before, said over it), or is the error alone when nothing was shown yet */
export function keptOnError<D extends { entries?: unknown[]; more?: boolean; error?: string; at?: number }>(was: D | undefined, got: D, now: number): D {
  if (!got.error) return { ...got, at: now }
  return was?.entries ? { ...was, error: got.error } : got
}
