// Zoom in, out and back to 100% (Settings › General › Appearance, and Cmd/Ctrl + = − 0 in place of the browser's
// zoom, as Figma, Notion and VS Code for the web take them). A key's change says so in a short notice with Reset,
// as a browser's zoom bubble does, so a press never looks like something broke.
import { dismissNotice, notice } from './kernel.ts'
import { getPrefs, setPref } from './prefs.ts'
import { stepZoom, type Zoom } from './zoom-steps.ts'

let shown: number | null = null

/** set the zoom; `say`: show the notice (a key or the palette did it; Settings' own row shows it already) */
export function setZoom(z: Zoom, say = false) {
  setPref('zoom', z)
  if (!say) return
  if (shown !== null) dismissNotice(shown)
  shown = notice(`Zoom ${z}%`, { ms: 2500, ...(z !== 100 && { act: { label: 'Reset', run: () => setZoom(100) } }) })
}

export const zoomIn = (say = false) => setZoom(stepZoom(getPrefs().zoom, 1), say)
export const zoomOut = (say = false) => setZoom(stepZoom(getPrefs().zoom, -1), say)
export const zoomReset = (say = false) => setZoom(100, say)
