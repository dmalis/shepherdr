// SHEP-311: on Android the page shrinks for the keyboard itself, so the app's height comes from CSS (100dvh) in the same
// frame, with no script in between; only where the page keeps its height under the keyboard (iOS) does it take the
// visible height.
import { expect, test } from 'bun:test'
import { appHeight, keyboardWatch, watchViewport } from './viewport.ts'

test('Android, keyboard down or up: the page is as tall as what shows, so CSS sizes the app', () => {
  expect(appHeight(915, 915)).toBeNull()
  // the window shrank with the keyboard (interactive-widget=resizes-content)
  expect(appHeight(585, 585)).toBeNull()
  // a fraction of a pixel apart is the same height
  expect(appHeight(584.5, 585)).toBeNull()
})

test('iOS, keyboard up: the page keeps its height, the app takes the visible part', () => {
  expect(appHeight(420, 844)).toBe('420px')
  expect(appHeight(420.5, 844)).toBe('420.5px')
})

test('the keyboard is up when the visible height drops by more than a browser bar', () => {
  const up = keyboardWatch()
  expect(up(412, 915)).toBe(false)
  expect(up(412, 860)).toBe(false)
  expect(up(412, 585)).toBe(true)
  expect(up(412, 915)).toBe(false)
})

// fork #171: with reduced motion (either switch) the keyboard's parts jump instead of gliding, but what follows the
// keyboard still hears it moved: a phone sheet scrolls its focused field into view on app-resized (overlay.tsx)
for (const motion of ['System', 'Reduced'] as const) {
  test(`the keyboard coming up tells what follows it, with Motion on ${motion}`, () => {
    const g = globalThis as any
    const saved = Object.fromEntries(['window', 'document', 'matchMedia', 'addEventListener', 'dispatchEvent', 'scrollY', 'scrollTo'].map((k) => [k, g[k]]))
    const on: Record<string, () => void> = {}
    const vv = { width: 390, height: 844, scale: 1, offsetTop: 0, addEventListener: (k: string, f: () => void) => { on[k] = f } }
    const heard: string[] = []
    try {
      g.window = { visualViewport: vv }
      g.document = {
        activeElement: { matches: () => true },
        documentElement: { clientHeight: 844, dataset: motion === 'Reduced' ? { motion: 'reduced' } : {}, style: { setProperty() {}, removeProperty() {} } },
        querySelectorAll: () => [],
      }
      g.matchMedia = () => ({ matches: false })
      g.addEventListener = () => {}
      g.dispatchEvent = (e: Event) => { heard.push(e.type); return true }
      g.scrollY = 0
      g.scrollTo = () => {}
      const keyboard: boolean[] = []
      watchViewport((up) => keyboard.push(up))
      vv.height = 500
      on.resize()
      expect(keyboard).toEqual([true])
      expect(heard).toEqual(['app-resized'])
    } finally {
      Object.assign(g, saved)
    }
  })
}
