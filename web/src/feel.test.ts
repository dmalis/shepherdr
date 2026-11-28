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
const audios: FakeAudio[] = []
class FakeAudio {
  state = 'running'
  currentTime = 0
  destination = {}
  constructor() {
    made++
    audios.push(this)
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
  suspend() {
    this.state = 'suspended'
    return Promise.resolve()
  }
  resume() {
    this.state = 'running'
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
const { canBuzz, chime, failedFelt, haptic, sentFelt, TONES, whenCalling } = await import('./feel.ts')
let seq = 0
let lastCid = ''
/** a send from this page's Send, and its failure */
const sendOne = () => sentFelt((lastCid = `c${seq++}`))
const failIt = () => failedFelt([lastCid])

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
  sendOne()
  failIt()
  expect(buzzes).toEqual([8, 8, [12, 60, 12]])
  expect(played).toEqual([])
})

test('Off: no vibrate and no sound at all', () => {
  setPref('feel', 'Off')
  haptic()
  haptic(10)
  sendOne()
  failIt()
  chime('sent')
  expect(buzzes).toEqual([])
  expect(played).toEqual([])
})

test('reduced motion turns the haptics off, either switch alone; sounds stay as picked', () => {
  setPref('feel', 'Haptics and sounds')
  setPref('motion', 'Reduced')
  expect(root.dataset.motion).toBe('reduced')
  haptic()
  sendOne()
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
  sendOne()
  failIt()
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

test('no sound during a call, by its audio session or by the app knowing one is on, nor while the page is away', () => {
  setPref('feel', 'Haptics and sounds')
  session.type = 'play-and-record'
  chime('sent')
  expect(played).toEqual([])
  expect(session.type).toBe('play-and-record')
  // a browser with no audio session: the app's own call state
  session.type = 'auto'
  whenCalling(() => true)
  try {
    chime('sent')
    expect(played).toEqual([])
  } finally {
    whenCalling(() => false)
  }
  // a failure that lands while the page is away: no tap, no sound
  sendOne()
  buzzes = []
  played = []
  doc.visibilityState = 'hidden'
  failIt()
  expect(played).toEqual([])
  expect(buzzes).toEqual([])
})

test("only a send made by this page's Send is felt failing, and once: not one a reload resumed, nor its Retry", () => {
  setPref('feel', 'Haptics and sounds')
  // one from before a reload (or another tab) fails, or expires: silent
  failedFelt(['from-before-the-reload'])
  expect(buzzes).toEqual([])
  expect(played).toEqual([])
  sendOne()
  failIt()
  expect(buzzes).toEqual([8, [12, 60, 12]])
  // its Retry fails again (the same id): silent
  failIt()
  expect(buzzes).toEqual([8, [12, 60, 12]])
  expect(played.map((p) => p.hz)).toEqual([TONES.sent.hz, TONES.failed.hz])
})

test('a sound that waits for the audio to wake is asked again: Off or a call meanwhile drops it', async () => {
  setPref('feel', 'Haptics and sounds')
  chime('sent')
  expect(played.length).toBe(1)
  played = []
  // the audio rests between sounds (suspended); this time it wakes slowly
  const real = FakeAudio.prototype.resume
  let wake!: () => void
  FakeAudio.prototype.resume = function (this: FakeAudio) {
    return new Promise<void>((r) => (wake = () => ((this.state = 'running'), r())))
  }
  try {
    for (const a of audios) a.state = 'suspended'
    chime('failed')
    // sounds turned off while it woke
    setPref('feel', 'Off')
    wake()
    await Promise.resolve()
    await Promise.resolve()
    expect(played).toEqual([])
    // a call started while it woke
    setPref('feel', 'Haptics and sounds')
    for (const a of audios) a.state = 'suspended'
    chime('failed')
    whenCalling(() => true)
    wake()
    await Promise.resolve()
    await Promise.resolve()
    expect(played).toEqual([])
  } finally {
    whenCalling(() => false)
    FakeAudio.prototype.resume = real
  }
})

test('the audio is made once and rests: a later failure plays on the same audio, woken without a new tap', async () => {
  setPref('feel', 'Haptics and sounds')
  for (const a of audios) a.state = 'suspended'
  sendOne()
  await Promise.resolve()
  await Promise.resolve()
  expect(played.map((p) => p.hz)).toEqual([TONES.sent.hz])
  expect(audios.length).toBe(1)
})

test('audio that fails to start leaves the audio session as it was', async () => {
  // a fresh copy of feel.ts, with no audio made yet, on a browser whose AudioContext throws
  const Was = g.AudioContext
  g.AudioContext = class {
    constructor() {
      throw new Error('no audio here')
    }
  }
  try {
    const again: string = './feel.ts?broken'
    const fresh = (await import(again)) as typeof import('./feel.ts')
    expect(fresh.chime).not.toBe(chime)
    setPref('feel', 'Haptics and sounds')
    fresh.chime('sent')
    expect(session.type).toBe('auto')
  } finally {
    g.AudioContext = Was
  }
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

test('the seams: send.ts feels a send as it enters the outbox, the outbox feels a failure where it says it', async () => {
  const { readFileSync } = await import('node:fs')
  const send = readFileSync(new URL('./send.ts', import.meta.url), 'utf8')
  expect(send).toMatch(/const kept = setOutbox\(\(all\) => \[\.\.\.all, out\]\)\n(?:\s*\/\/[^\n]*\n)*\s*sentFelt\(cid\)/)
  const kernel = readFileSync(new URL('./kernel.ts', import.meta.url), 'utf8')
  expect(kernel).toMatch(/const failed = newlyFailed\(state\.outbox, out\)\n\s*for \(const o of failed\) say\(failedSendWords\(o\.error\)\)\n(?:\s*\/\/[^\n]*\n)*\s*if \(failed\.length\) failedFelt\(failed\.map\(\(o\) => o\.cid\)\)/)
  expect(kernel).toContain('whenCalling(() => !!state.ui.call)')
})
