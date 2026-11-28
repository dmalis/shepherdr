// fork #196 (Feel: haptics and sounds setting): Settings › General › Haptics and sounds is Off, Haptics (the default)
// or Haptics and sounds. A haptic only where the browser has navigator.vibrate, never under reduced motion or with
// the setting Off; a sound only with "Haptics and sounds", as ambient audio (an iPhone's silent switch mutes it).
import { afterAll, beforeEach, expect, test } from 'bun:test'

// a stand-in page: the root prefs.ts and calm() read, and a phone that vibrates
const root = { dataset: {} as Record<string, string>, style: { setProperty() {} } }
const g = globalThis as Record<string, unknown>
const nav = globalThis.navigator as unknown as Record<string, unknown>
const before = { document: g.document, addEventListener: g.addEventListener, AudioContext: g.AudioContext, vibrate: nav.vibrate, audioSession: nav.audioSession }
const doc = { documentElement: root, visibilityState: 'visible', querySelectorAll: () => [], querySelector: () => null }
Object.assign(globalThis, { document: doc, addEventListener() {} })

let buzzes: (number | number[])[] = []
Object.defineProperty(nav, 'vibrate', { configurable: true, writable: true, value: (p: number | number[]) => (buzzes.push(p), true) })

/** a stand-in AudioContext: what it was asked to play */
let played: { type: string; hz: number; peak: number }[] = []
let made = 0
class FakeAudio {
  state = 'running'
  currentTime = 0
  destination = {}
  constructor() {
    made++
  }
  createOscillator() {
    const o = { type: '', hz: 0, frequency: { setValueAtTime: (v: number) => void (o.hz = v), exponentialRampToValueAtTime() {} }, connect: (x: unknown) => x, start() {}, stop() {} }
    return o
  }
  createGain() {
    const n = { peak: 0, gain: { setValueAtTime() {}, exponentialRampToValueAtTime: (v: number) => void (n.peak = Math.max(n.peak, v)) }, connect: (x: unknown) => x }
    // what the oscillator connects into: its gain node, which then goes out
    return Object.assign(n, { connect: (x: unknown) => (x === this.destination && last && played.push({ type: last.type, hz: last.hz, peak: n.peak }), x) })
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}
let last: { type: string; hz: number } | null = null
const Real = FakeAudio.prototype.createOscillator
FakeAudio.prototype.createOscillator = function () {
  const o = Real.call(this)
  last = o
  return o
}
g.AudioContext = FakeAudio
const session = { type: 'auto' }
Object.defineProperty(nav, 'audioSession', { configurable: true, writable: true, value: session })

const { FEELS, getPrefs, setPref } = await import('./prefs.ts')
const { canBuzz, chime, haptic, sendFelt, TONES } = await import('./feel.ts')

afterAll(() => {
  g.addEventListener = before.addEventListener
  if (before.document === undefined) delete g.document
  else g.document = before.document
  if (before.AudioContext === undefined) delete g.AudioContext
  else g.AudioContext = before.AudioContext
  Object.defineProperty(nav, 'vibrate', { configurable: true, writable: true, value: before.vibrate })
  Object.defineProperty(nav, 'audioSession', { configurable: true, writable: true, value: before.audioSession })
})

beforeEach(() => {
  buzzes = []
  played = []
  setPref('motion', 'System')
  doc.visibilityState = 'visible'
  session.type = 'auto'
})

test('the setting: Off, Haptics or Haptics and sounds, Haptics on a new device', () => {
  expect(FEELS).toEqual(['Off', 'Haptics', 'Haptics and sounds'])
  expect(getPrefs().feel).toBe('Haptics')
})

test('Haptics: a tap where the browser has vibrate, and no sound', () => {
  setPref('feel', 'Haptics')
  expect(canBuzz()).toBe(true)
  haptic()
  sendFelt(true)
  sendFelt(false)
  expect(buzzes).toEqual([8, 8, [12, 60, 12]])
  expect(played).toEqual([])
})

test('Off: no vibrate and no sound at all', () => {
  setPref('feel', 'Off')
  haptic()
  haptic(10)
  sendFelt(true)
  sendFelt(false)
  chime('sent')
  expect(buzzes).toEqual([])
  expect(played).toEqual([])
})

test('reduced motion turns the haptics off, either switch alone; sounds stay as picked', () => {
  setPref('feel', 'Haptics and sounds')
  setPref('motion', 'Reduced')
  expect(root.dataset.motion).toBe('reduced')
  haptic()
  sendFelt(true)
  expect(buzzes).toEqual([])
  expect(played.length).toBe(1)
  // the device's own setting alone
  setPref('motion', 'System')
  const mm = g.matchMedia
  g.matchMedia = (q: string) => ({ matches: q === '(prefers-reduced-motion: reduce)' })
  try {
    haptic()
    expect(buzzes).toEqual([])
  } finally {
    if (mm === undefined) delete g.matchMedia
    else g.matchMedia = mm
  }
  haptic()
  expect(buzzes).toEqual([8])
})

test('Haptics and sounds: one very quiet tick on a send, a lower one on a failed send, as ambient audio', () => {
  setPref('feel', 'Haptics and sounds')
  sendFelt(true)
  sendFelt(false)
  expect(buzzes).toEqual([8, [12, 60, 12]])
  expect(played.map((p) => p.hz)).toEqual([TONES.sent.hz, TONES.failed.hz])
  expect(TONES.failed.hz).toBeLessThan(TONES.sent.hz)
  // very quiet: well under a tenth of full loudness, and over in a moment
  for (const p of played) expect(p.peak).toBeLessThanOrEqual(0.05)
  for (const t of Object.values(TONES)) expect(t.ms).toBeLessThanOrEqual(120)
  // the silent switch mutes it: the page's audio is ambient
  expect(session.type).toBe('ambient')
  // one audio for both
  expect(made).toBe(1)
})

test('no sound while a call has the audio, nor for a failure while the page is away', () => {
  setPref('feel', 'Haptics and sounds')
  session.type = 'play-and-record'
  chime('sent')
  expect(played).toEqual([])
  expect(session.type).toBe('play-and-record')
  session.type = 'auto'
  doc.visibilityState = 'hidden'
  sendFelt(false)
  expect(played).toEqual([])
  expect(buzzes).toEqual([])
})

test('a browser without vibrate has no haptics and no fake one', () => {
  setPref('feel', 'Haptics')
  Object.defineProperty(nav, 'vibrate', { configurable: true, writable: true, value: undefined })
  try {
    expect(canBuzz()).toBe(false)
    expect(() => haptic()).not.toThrow()
  } finally {
    Object.defineProperty(nav, 'vibrate', { configurable: true, writable: true, value: (p: number | number[]) => (buzzes.push(p), true) })
  }
})

test('every send and failed send goes through sendFelt: send.ts on a send, the outbox on a failure', async () => {
  const { readFileSync } = await import('node:fs')
  const send = readFileSync(new URL('./send.ts', import.meta.url), 'utf8')
  expect(send).toMatch(/const kept = setOutbox\(\(all\) => \[\.\.\.all, out\]\)\n(?:\s*\/\/[^\n]*\n)*\s*sendFelt\(true\)/)
  const kernel = readFileSync(new URL('./kernel.ts', import.meta.url), 'utf8')
  expect(kernel).toMatch(/const failed = newlyFailed\(state\.outbox, out\)\n\s*for \(const o of failed\) say\(failedSendWords\(o\.error\)\)\n(?:\s*\/\/[^\n]*\n)*\s*if \(failed\.length\) sendFelt\(false\)/)
})
