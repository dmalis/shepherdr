// Settings › General › Appearance: Zoom (the whole app: − its value + and Reset) and Chat text size (the messages
// only, with a line at that size), both kept on this device (prefs.ts). Cmd/Ctrl + = − 0 change the same Zoom.
import { SRow } from './settings.tsx'
import { minZoom, setPref, usePrefs, zoomNow } from './prefs.ts'
import { Btn, IB, Seg } from './ui.tsx'
import { setZoom, zoomIn, zoomOut } from './zoom.ts'
import { TEXTS, ZOOMS } from './zoom-steps.ts'

export function SizeRows() {
  const p = usePrefs()
  const z = zoomNow()
  return (
    <>
      <SRow label="Zoom" wrap>
        <span className="zoomc">
          <IB icon="minus" label="Zoom out" disabled={z <= minZoom()} onClick={() => zoomOut()} />
          <span className="zoomv" aria-live="polite">{z}%</span>
          <IB icon="plus" label="Zoom in" disabled={z === ZOOMS[ZOOMS.length - 1]} onClick={() => zoomIn()} />
          <Btn small disabled={z === 100} onClick={() => setZoom(100)}>Reset</Btn>
        </span>
      </SRow>
      <SRow label="Chat text size" wrap><Seg label="Chat text size" values={TEXTS} value={p.text} onChange={(v) => setPref('text', v)} /></SRow>
      <div className="tsize" aria-hidden="true"><div className="b">Messages in a chat read at this size.</div></div>
      <p className="hint">Zoom and chat text size are kept on this device.</p>
    </>
  )
}
