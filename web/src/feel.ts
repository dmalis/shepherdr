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
const setSession = (type: string) => {
  const s = session()
  if (s)
    try {
      s.type = type
    } catch {
      /* an older WebKit: its own choice */
    }
}

/** is a voice call on (the kernel tells, as ui.call): its audio is the call's, on every browser */
let calling = () => false
export const whenCalling = (f: () => boolean) => void (calling = f)

/** may a sound play now: the setting, the page on screen, no call */
const mayChime = () => getPrefs().feel === 'Haptics and sounds' && seen() && !calling() && session()?.type !== 'play-and-record'

/** after the last sound the audio rests (suspended, its session back to the browser's own): the same audio, unlocked
 *  by the tap of a send, plays the failure that comes later without another tap */
const REST_MS = 2_000
/** a sound that couldn't start within this (a browser waiting for a tap) is dropped, never played late */
const STALE_MS = 300
let ctx: AudioContext | null = null
let rest: ReturnType<typeof setTimeout> | undefined

function sleep() {
  if (!ctx || ctx.state !== 'running') return
  void ctx.suspend().catch(() => undefined)
  // back to the browser's own choice, unless something else (a call) has taken the session meanwhile
  if (session()?.type === 'ambient') setSession('auto')
}

/** the sounds' audio, as ambient where the device has a session (again before each sound: a call that ended put the
 *  session back to the browser's own); null where the browser has none */
function audio(): AudioContext | null {
  const was = session()?.type
  if (was === 'auto') setSession('ambient')
  if (ctx) return ctx
  const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext
  try {
    if (!Ctx) throw new Error('no audio')
    ctx = new Ctx({ latencyHint: 'interactive' })
  } catch {
    if (was === 'auto') setSession('auto')
    return null
  }
  return ctx
}

/** One very quiet short tick, only with "Haptics and sounds", while the page is on screen and no call is on. A
 *  browser that won't play without a tap stays silent: a sound is never late. */
export function chime(tone: Tone) {
  if (!mayChime()) return
  const c = audio()
  if (!c) return
  clearTimeout(rest)
  rest = setTimeout(sleep, REST_MS)
  const asked = performance.now()
  const play = () => {
    // asked again as it starts: the setting, a call or the page may have changed while the audio woke
    if (c.state !== 'running' || performance.now() - asked > STALE_MS || !mayChime()) return
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

/* ---------- your sends ---------- */

/** the sends made on this page by the person's own Send: only theirs fail with a tap and a sound, once. One that a
 *  reload resumed, a Retry of it, or one another tab sent is silent */
const fresh = new Set<string>()

/** your send went into the outbox: a tap and, with sounds on, its tick */
export function sentFelt(cid: string) {
  fresh.add(cid)
  haptic(8)
  chime('sent')
}

/** sends that just failed (the outbox's one place that marks them): one of yours made here gets a double tap and,
 *  with sounds on, the lower tick, once; never while the page is away */
export function failedFelt(cids: string[]) {
  const mine = cids.filter((c) => fresh.delete(c))
  if (!mine.length || !seen()) return
  haptic([12, 60, 12])
  chime('failed')
}
