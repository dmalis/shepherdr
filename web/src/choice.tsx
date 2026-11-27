// A Settings row's choice (dmalis/shepherdr#68): the segmented control when it fits beside its label, else a button
// with the value now and a chevron that opens the choices as a menu, as iOS's "Default ›" and macOS's pop-up buttons
// do. On a phone it is always the button, so every choice on a page looks the same. It never wraps under its label.
// Same props as ui.tsx's Seg, so a Settings file swaps it in by its import alone.
import { useLayoutEffect, useRef, useState } from 'react'
import { useUI } from './kernel.ts'
import { openMenu } from './overlay.tsx'
import { I, Seg } from './ui.tsx'
import './settings-look.css'

/** the label's own width it keeps beside a choice, at most this share of the row */
const LABEL_SHARE = 0.4
const GAP = 16

/** does a segmented control `seg` px wide fit beside a label `label` px wide, in a row `row` px wide */
export const fits = (seg: number, label: number, row: number) => seg + GAP + Math.min(label, row * LABEL_SHARE) <= row

/** the width of a label's own words (its first line, before any small print), not the room it was given */
function wordsWidth(n: Element | null): number {
  const t = n?.firstChild
  if (!t) return 0
  const r = document.createRange()
  r.selectNodeContents(t)
  return r.getBoundingClientRect().width
}

export function Choice<T extends string>({ values, value, onChange, label }: { values: readonly T[]; value: T; onChange: (v: T) => void; label?: string }) {
  const phone = useUI((u) => u.phone)
  const probe = useRef<HTMLSpanElement>(null)
  const [wide, setWide] = useState(true)
  useLayoutEffect(() => {
    const p = probe.current
    const row = p?.closest('.srow')
    if (!p || !row || phone || typeof ResizeObserver === 'undefined') return
    const check = () => {
      const cs = getComputedStyle(row)
      const room = row.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      setWide(fits(p.scrollWidth, wordsWidth(row.querySelector(':scope>.n')), room))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(row)
    return () => ro.disconnect()
  }, [phone, values.join('\n')])
  const menu = phone || !wide
  return (
    <>
      {/* the segmented control at its own width, never seen: what decides whether it fits */}
      {!phone && (
        <span className="chp" ref={probe} aria-hidden="true">
          <span className="seg">{values.map((v) => <span className="sb" key={v}>{v}</span>)}</span>
        </span>
      )}
      {menu ? (
        <button
          type="button"
          className="chv"
          aria-haspopup="menu"
          aria-label={label ? `${label}: ${value}` : value}
          onClick={(e) => openMenu(e.currentTarget, values.map((v) => ({ label: v, on: v === value, run: () => v !== value && onChange(v) })), { label })}
        >
          <span className="v">{value}</span>
          <I n="down" c="s16" />
        </button>
      ) : (
        <Seg label={label} values={values} value={value} onChange={onChange} />
      )}
    </>
  )
}
