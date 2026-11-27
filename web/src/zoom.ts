// Zoom in, out and back to 100% (Settings › General › Text and zoom, and Cmd/Ctrl + = − 0 in place of the browser's
// zoom, as Figma, Notion and VS Code for the web take them). A key's change says so in a short notice with Reset,
// as a browser's zoom bubble does, so a press never looks like something broke.
import { dismissNotice, notice } from './kernel.ts'
import { minZoom, setPref, zoomNow } from './prefs.ts'
import { stepZoom, type Zoom } from './zoom-steps.ts'

let shown: number | null = null

/** set the zoom; `say`: show the notice (a key or the palette did it; Settings' own row shows it already) */
export function setZoom(z: Zoom, say = false) {
  // never under this device's lowest step (a touch screen's is 100%)
  if (z < minZoom()) z = minZoom()
  setPref('zoom', z)
  if (!say) return
  if (shown !== null) dismissNotice(shown)
  shown = notice(`Zoom ${z}%`, { ms: 2500, ...(z !== 100 && { act: { label: 'Reset', run: () => setZoom(100) } }) })
}

export const zoomIn = (say = false) => setZoom(stepZoom(zoomNow(), 1), say)
export const zoomOut = (say = false) => setZoom(stepZoom(zoomNow(), -1), say)
export const zoomReset = (say = false) => setZoom(100, say)
