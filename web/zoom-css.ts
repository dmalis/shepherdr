// Zoom (Settings › General › Appearance) for the whole app, built in: every length the app's CSS gives in px is
// multiplied by --zoom (1 unless picked; prefs.ts sets it on <html>). The page's own coordinates stay true at every
// zoom, so whatever measures the page (a popover's place, a drag, a terminal's grid, a screen's clicks) needs nothing
// of its own, which CSS's `zoom` property can't promise. A container or media query can't hold a var(), so a query on
// a width in px is written once per zoom step, for <html data-zoom="…">, with its rules' specificity unchanged.
// A hairline (1px or less) stays as it is, as a browser's zoom keeps it one pixel.
import type { AtRule, Plugin, Rule } from 'postcss'
import { ZOOMS } from './src/zoom-steps.ts'

const PX = /(^|[^\w.#-])(-?)(\d*\.?\d+)px\b/g

/** one value with its px times --zoom ("16px/24px" → "calc(16px*var(--zoom))/calc(24px*var(--zoom))") */
export function zoomValue(v: string): string {
  if (!v.includes('px')) return v
  // url(…) and strings keep their words
  return v.split(/(url\([^)]*\)|"[^"]*"|'[^']*')/).map((part, i) => (i % 2 ? part : part.replace(PX, (all, before: string, minus: string, n: string) => (Number(n) <= 1 ? all : `${before}calc(${minus}${n}px*var(--zoom))`)))).join('')
}

const QUERY_PX = /(\d*\.?\d+)px/g
const scaled = (params: string, z: number) => params.replace(QUERY_PX, (_, n: string) => `${Math.round(Number(n) * z * 100) / 100}px`)

/** each rule under a query, for one zoom (`attr`, e.g. [data-zoom="150"]) or for none (:not([data-zoom])) */
function only(at: AtRule, attr: string) {
  at.walkRules((r: Rule) => {
    if (r.parent?.type === 'atrule' && /keyframes$/i.test((r.parent as AtRule).name)) return
    r.selectors = r.selectors.map((s) => `:where(:root${attr}) ${s}`)
  })
}

export function zoomCss(): Plugin {
  return {
    postcssPlugin: 'shepherdr-zoom',
    OnceExit(root) {
      root.walkDecls((d) => {
        d.value = zoomValue(d.value)
      })
      root.walkAtRules(/^(container|media)$/i, (at) => {
        if (!/\dpx/.test(at.params)) return
        for (const z of ZOOMS) {
          if (z === 100) continue
          const copy = at.clone({ params: scaled(at.params, z / 100) })
          only(copy, `[data-zoom="${z}"]`)
          at.before(copy)
        }
        only(at, ':not([data-zoom])')
      })
    },
  }
}
