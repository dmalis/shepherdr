// A Settings row's choice (dmalis/shepherdr#68): the segmented control when it fits beside its label, else a button
// with the value now and a chevron that opens the choices as a menu, as iOS's "Default ›" and macOS's pop-up buttons
// do. On a phone it is always the button, so every choice on a page looks the same. It never wraps under its label.
// Same props as ui.tsx's Seg, so a Settings file swaps it in by its import alone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI } from './kernel.ts'
import { openMenu } from './overlay.tsx'
import { I, Seg } from './ui.tsx'
import './settings-look.css'

/** the label's own width it keeps beside a choice, at most this share of the row */
const LABEL_SHARE = 0.4

/** does a segmented control `seg` px wide fit beside a label `label` px wide, `gap` px apart, in a row `row` px wide */
export const fits = (seg: number, label: number, row: number, gap: number) => seg + gap + Math.min(label, row * LABEL_SHARE) <= row

/** the width of a label's own words (its first line, before any small print), not the room it was given */
function wordsWidth(n: Element | null): number {
  const t = n?.firstChild
  if (!t) return 0
  const r = document.createRange()
  r.selectNodeContents(t)
  return r.getBoundingClientRect().width
}

const isOpen = (b: Element) => b.getAttribute('aria-expanded') === 'true'

/** The keyboard in an open choice menu, as a menu button's (WAI-ARIA APG): it starts on the value now; ↑ ↓ Home End
 *  move; Tab closes it; when it closes (a pick, Escape, a tap outside) the keyboard goes back to the button. */
export function keyboard(b: HTMLElement, menu: HTMLElement) {
  const items = () => [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
  ;(items().find((i) => i.getAttribute('aria-checked') === 'true') ?? items()[0])?.focus()
  menu.addEventListener('keydown', (e) => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => {
      e.preventDefault()
      all[(i + all.length) % all.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? all.length - 1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
    else if (e.key === 'Tab' && isOpen(b)) {
      e.preventDefault()
      openMenu(b, [])
    }
  })
  const back = new MutationObserver(() => {
    if (isOpen(b)) return
    back.disconnect()
    const f = document.activeElement
    if (b.isConnected && (!f || f === document.body || !f.isConnected || f.closest('[role="menu"]'))) b.focus({ preventScroll: true })
  })
  back.observe(b, { attributes: true, attributeFilter: ['aria-expanded'] })
}

export function Choice<T extends string>({ values, value, onChange, label }: { values: readonly T[]; value: T; onChange: (v: T) => void; label?: string }) {
  const phone = useUI((u) => u.phone)
  const probe = useRef<HTMLSpanElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  // a pick runs the row's handler as it is then, not as it was when the menu opened
  const live = useRef({ onChange, value, values })
  live.current = { onChange, value, values }
  const opened = useRef(0)
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const p = probe.current
    const row = p?.closest('.srow')
    if (!p || !row || phone || typeof ResizeObserver === 'undefined') return
    const check = () => {
      const cs = getComputedStyle(row)
      const room = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      setWide(fits(p.scrollWidth, wordsWidth(row.querySelector(':scope>.n')), room, parseFloat(cs.columnGap) || 0))
    }
    check()
    // the row's width, and the control's own (its font coming in changes it)
    const ro = new ResizeObserver(check)
    ro.observe(row)
    ro.observe(p)
    return () => ro.disconnect()
  }, [phone, values.join('\n')])
  const menu = phone || !wide
  // a menu still open closes with its button (Settings closed, Back, the row gone), and when what it was opened for
  // changes under it: Settings' page, scope or repo (voice, another window), or the row's choices or value (another
  // device), so a pick never lands on another scope or picks a choice that is gone
  const where = useUI((u) => (u.settings ? `${u.settings.scope}\n${u.settings.sec}\n${u.settings.repo ?? ''}` : ''))
  const key = values.join('\n')
  useEffect(() => {
    const b = btn.current
    return () => {
      if (b && isOpen(b)) openMenu(b, [])
    }
  }, [menu, where, key, value])
  const open = (b: HTMLButtonElement) => {
    const was = isOpen(b)
    // every pick goes to the handler, the value now too, as the segmented control's does (Needs me again asks for
    // this device's permission; Merge's inherited value saved as this repo's own)
    openMenu(b, values.map((v) => ({ label: v, on: v === live.current.value, run: () => live.current.values.includes(v) && live.current.onChange(v) })), { label })
    if (was) return
    b.setAttribute('aria-expanded', 'true')
    const n = ++opened.current
    requestAnimationFrame(() => {
      const m = [...document.querySelectorAll<HTMLElement>('.layer [role="menu"]')].at(-1)
      // only this opening's menu, still open: a quick close and reopen gets one set of keys, not two
      if (m && isOpen(b) && n === opened.current && !m.dataset.keys) {
        m.dataset.keys = '1'
        keyboard(b, m)
      }
    })
  }
  return (
    <>
      {/* the segmented control at its own width, never seen: what decides whether it fits */}
      {!phone && (
        <span className="chp" ref={probe} aria-hidden="true">
          <span className="seg">{values.map((v) => <span className="sb" key={v}>{v}</span>)}</span>
        </span>
      )}
      {menu ? (
        <button ref={btn} type="button" className="chv" aria-haspopup="menu" aria-label={label ? `${label}: ${value}` : value} onClick={(e) => open(e.currentTarget)}>
          <span className="v">{value}</span>
          <I n="down" c="s16" />
        </button>
      ) : (
        <Seg label={label} values={values} value={value} onChange={onChange} />
      )}
    </>
  )
}
