// Settings › General, its first four sections (dmalis/shepherdr#36, #68), as macOS System Settings › Appearance and
// iOS Display & Text Size group theirs. Everything in them is kept on this device (prefs.ts, sides.ts, awake.ts): a
// quiet "This device" tag beside each title says so, in place of a footnote.
// - Theme: a small picture of each theme, as GitHub and Slack show theirs; System is half Light, half Dark.
// - Text and zoom: a sample of the chat first (one agent message and the person's reply, in the chat's own bubble
//   classes, so it can't drift from the chat), then Zoom and Chat text size. It follows both as they change: Chat
//   text size sets the chat's --chat tokens, and Zoom scales every px of the app. Cmd/Ctrl + = − 0 change the same Zoom.
// - Layout: Chat width, and Sides beside a pane (no phone).
// - Behaviour: Motion, Haptics and sounds (fork #196: Off, Haptics or Haptics and sounds, as iOS's Sounds & Haptics),
//   and Keep the screen on where the browser can.
import { canKeepAwake, setAwake, useAwake } from './awake.ts'
import { Choice } from './choice.tsx'
import { canBuzz } from './feel.ts'
import { calm } from './motion.ts'
import { FEELS, minZoom, MOTIONS, setPref, THEMES, usePrefs, WIDTHS, zoomNow, type Prefs } from './prefs.ts'
import { SidesRow, SRow } from './settings.tsx'
import { useSides } from './sides.ts'
import { Btn, IB, Tgl } from './ui.tsx'
import { setZoom, zoomIn, zoomOut } from './zoom.ts'
import { TEXTS, ZOOMS } from './zoom-steps.ts'

/** a section's title, with the quiet tag that says it is kept on this device */
export const Here = ({ children }: { children: string }) => (
  <h3>
    {children}
    <span className="dtag">This device</span>
  </h3>
)

/** one theme's picture: the sidebar, a message each way and the message box, in that theme's own colours */
const Scene = ({ look }: { look: string }) => (
  <span className={`thm-sc ${look}`}>
    <i className="s" />
    <i className="a" />
    <i className="m" />
    <i className="c" />
  </span>
)

export function Themes({ value }: { value: Prefs['theme'] }) {
  return (
    <div className="thms" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button type="button" key={t} className="thm" aria-pressed={value === t} onClick={() => setPref('theme', t)}>
          <span className="thm-pic" aria-hidden="true">
            {t === 'System' ? (
              <>
                <Scene look="light" />
                <Scene look="dark half" />
              </>
            ) : (
              <Scene look={t.toLowerCase()} />
            )}
          </span>
          <span className="thm-n">{t}</span>
        </button>
      ))}
    </div>
  )
}

/** a short chat at the size picked: the chat's own .msgs and .b bubbles, framed as a sample */
export const Sample = () => (
  <div className="tprev" aria-hidden="true">
    <div className="msgs">
      <div className="b">
        <div className="md"><p>The tests pass and the new page is ready. Want me to open it?</p></div>
      </div>
      <div className="b mine gap">
        <div className="md" style={{ whiteSpace: 'pre-wrap' }}>Yes, open it</div>
      </div>
    </div>
  </div>
)

/** Haptics and sounds' small print, only when the device won't do what the value says: no haptics in this browser
 *  (an iPhone, a desktop), or reduced motion turning them off */
function feelNote(feel: Prefs['feel']) {
  if (feel === 'Off') return null
  if (!canBuzz()) return <small>{feel === 'Haptics' ? 'This browser has no haptics' : 'Sounds only: this browser has no haptics'}</small>
  if (calm()) return <small>{feel === 'Haptics' ? 'Off while motion is reduced' : 'Sounds only while motion is reduced'}</small>
  return null
}

export function Appearance() {
  const p = usePrefs()
  const sides = useSides()
  const awake = useAwake()
  const z = zoomNow()
  return (
    <>
      <Here>Theme</Here>
      <Themes value={p.theme} />
      <Here>Text and zoom</Here>
      <Sample />
      <SRow label="Zoom">
        <span className="zoomc">
          <span className="zooms">
            <IB icon="minus" label="Zoom out" disabled={z <= minZoom()} onClick={() => zoomOut()} />
            <span className="zoomv" aria-live="polite">{z}%</span>
            <IB icon="plus" label="Zoom in" disabled={z === ZOOMS[ZOOMS.length - 1]} onClick={() => zoomIn()} />
          </span>
          <Btn small disabled={z === 100} onClick={() => setZoom(100)}>Reset</Btn>
        </span>
      </SRow>
      <SRow label="Chat text size"><Choice label="Chat text size" values={TEXTS} value={p.text} onChange={(v) => setPref('text', v)} /></SRow>
      <Here>Layout</Here>
      <SRow label="Chat width"><Choice label="Chat width" values={WIDTHS} value={p.width} onChange={(v) => setPref('width', v)} /></SRow>
      <SidesRow {...sides} />
      <Here>Behaviour</Here>
      <SRow label="Motion"><Choice label="Motion" values={MOTIONS} value={p.motion} onChange={(v) => setPref('motion', v)} /></SRow>
      <SRow label={<>Haptics and sounds{feelNote(p.feel)}</>}><Choice label="Haptics and sounds" values={FEELS} value={p.feel} onChange={(v) => setPref('feel', v)} /></SRow>
      {canKeepAwake() && <SRow label="Keep the screen on"><Tgl label="Keep the screen on" on={awake} onChange={setAwake} /></SRow>}
    </>
  )
}
