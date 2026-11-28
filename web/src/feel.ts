// Haptics and sounds (fork #196, docs/design.md: Haptics and sounds): rare, quiet and only for a moment the person
// caused, as in Messages. Settings › General › Haptics and sounds picks Off, Haptics (the default) or Haptics and
// sounds, on this device (prefs.ts).
// - A haptic only through navigator.vibrate, where the browser has it (Android). An iPhone has no haptic a page can
//   call: its native switches give their own when the person flips them, which the app neither adds nor takes away.
//   Reduced motion (the device's or Settings › General › Motion, calm()) turns the app's haptics off.
// - A sound only with "Haptics and sounds": one very quiet short tick on your own send, a lower one when it fails.
//   Never for what arrives, reorders or retries. It plays as "ambient" audio where the browser has an audio session
//   (Safari), so an iPhone's silent switch mutes it and it never stops what else is playing.
// Every vibrate in the app goes through haptic() (test/test_design.py holds it).
import { calm } from './motion.ts'
import { getPrefs } from './prefs.ts'

/** does this browser give a page haptics at all (Android's Chrome and Firefox; never an iPhone) */
export const canBuzz = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'

/** the page is on screen: what finishes while it is away is news, not a moment the person is having */
const seen = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

/** A light tap from the phone, for a moment the person caused: a gesture crossing the point where it acts, a hold
 *  that picks something up, a send going into the outbox. Off with the setting Off, and under reduced motion. */
export function haptic(pattern: number | number[] = 8) {
  if (getPrefs().feel === 'Off' || calm() || !canBuzz()) return
  try {
    navigator.vibrate(pattern)
  } catch {
    /* not allowed here */
  }
}

/* ---------- the two sounds ---------- */

/** a tone's pitch (Hz), length (ms) and loudness (its peak gain, out of 1): very quiet, over in a moment */
export const TONES = {
  sent: { hz: 1320, ms: 45, gain: 0.04 },
  failed: { hz: 392, ms: 110, gain: 0.05 },
} as const
export type Tone = keyof typeof TONES

/** WebKit's audio session (Safari 16.4+): "ambient" mixes in and follows the silent switch; a call is the voice
 *  plugin's ("play-and-record", web/plugins/voice/call.ts) */
type AudioSessionLike = { type: string }
const session = (): AudioSessionLike | null => (globalThis.navigator as unknown as { audioSession?: AudioSessionLike } | undefined)?.audioSession ?? null

/** how long the sounds' audio stays open after the last one: a send's failure soon after it still sounds, and the
 *  page then lets the device's audio go */
const KEEP_MS = 15_000
let ctx: AudioContext | null = null
let idle: ReturnType<typeof setTimeout> | undefined

function letGo() {
  const c = ctx
  ctx = null
  void c?.close().catch(() => undefined)
  // back to the browser's own choice, unless something else (a call) has taken the session meanwhile
  const s = session()
  if (s?.type === 'ambient')
    try {
      s.type = 'auto'
    } catch {
      /* an older WebKit */
    }
}

/** the sounds' audio, as ambient where the device has a session (again before each sound: a call that ended put the
 *  session back to the browser's own); null where the browser has none */
function audio(): AudioContext | null {
  const s = session()
  if (s && s.type === 'auto')
    try {
      s.type = 'ambient'
    } catch {
      /* an older WebKit: its own choice */
    }
  if (ctx) return ctx
  const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
  if (!Ctx) return null
  try {
    ctx = new Ctx({ latencyHint: 'interactive' })
  } catch {
    return null
  }
  return ctx
}

/** One very quiet short tick, only with "Haptics and sounds" and only while the page is on screen. Never during a
 *  call (its audio is the call's). A browser that won't play without a tap just stays silent. */
export function chime(tone: Tone) {
  if (getPrefs().feel !== 'Haptics and sounds' || !seen()) return
  if (session()?.type === 'play-and-record') return
  const c = audio()
  if (!c) return
  clearTimeout(idle)
  idle = setTimeout(letGo, KEEP_MS)
  const play = () => {
    if (c.state !== 'running') return
    const { hz, ms, gain } = TONES[tone]
    const t = c.currentTime
    const end = t + ms / 1000
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = tone === 'sent' ? 'sine' : 'triangle'
    o.frequency.setValueAtTime(hz, t)
    // a tick, not a beep: it drops a little in pitch as it fades
    o.frequency.exponentialRampToValueAtTime(hz * 0.8, end)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, end)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(end + 0.01)
  }
  if (c.state === 'running') play()
  else void c.resume().then(play, () => undefined)
}

/** your send went into the outbox (ok), or it failed: a tap and, with sounds on, its tick */
export function sendFelt(ok: boolean) {
  if (ok) haptic(8)
  else if (seen()) haptic([12, 60, 12])
  chime(ok ? 'sent' : 'failed')
}
