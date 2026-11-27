// Settings › Secrets' list (dmalis/shepherdr#98), the way iOS Settings, 1Password and GitHub's repository
// secrets list theirs: A to Z by name, a search box once there are more than a few, and a name that never runs under
// its buttons. A long name breaks after its underscores (anywhere, as a last resort). On a phone each row is its name
// and who may use it, the whole width, with one ⋯ button: Replace and Remove in its sheet, as iOS and 1Password keep
// a row's actions. On a computer the two buttons stay on the row, where the name has the room beside them.
import { Fragment, useRef, useState } from 'react'
import { keyboard } from './choice.tsx'
import { openMenu } from './overlay.tsx'
import { useUI } from './kernel.ts'
import { Btn, I, IB } from './ui.tsx'
import './secrets-list.css'

export interface Kept {
  name: string
  /** where it is kept: all, m:<machine> ('' this computer) or a space's id */
  level: string
}

/** more than this many, and the list gets its search box */
export const SEARCH_FROM = 5

/** Every space's first, then each machine's, then each space's own: a name kept at two levels shows the wider one first */
const rank = (level: string) => (level === 'all' ? 0 : level.startsWith('m:') ? 1 : 2)
/** A to Z by name, ignoring case, with numbers in their order (KEY_2 before KEY_10) */
export const sorted = (list: Kept[]): Kept[] =>
  [...list].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || rank(a.level) - rank(b.level) || a.level.localeCompare(b.level))

/** the names that hold what was typed, anywhere in them, any case; a space typed stands for an underscore, so
 *  "webhook secret" finds WEBHOOK_SECRET, and an underscore typed is one */
export const matching = (list: Kept[], q: string): Kept[] => {
  const w = q.trim().toLowerCase().replace(/\s+/g, '_')
  return w ? list.filter((s) => s.name.toLowerCase().includes(w)) : list
}

/** a name that may break after each underscore, before it runs out of room */
const Name = ({ name }: { name: string }) => (
  <>
    {name.split('_').map((part, i, all) => (
      <Fragment key={i}>
        {part}
        {i < all.length - 1 && <>_<wbr /></>}
      </Fragment>
    ))}
  </>
)

export function SecretList({ list, scope, replace, remove }: { list: Kept[]; scope: (s: Kept) => string; replace: (s: Kept) => void; remove: (s: Kept) => void }) {
  const phone = useUI((u) => u.phone)
  const [q, setQ] = useState('')
  const box = useRef<HTMLInputElement>(null)
  const shown = matching(sorted(list), q)
  const clear = () => {
    setQ('')
    box.current?.focus()
  }
  // a row's ⋯: its sheet, and the keyboard in it as in Settings' choice menus (choice.tsx): it starts on Replace,
  // ↑ ↓ move, Tab closes it, and when it closes the keyboard goes back to the ⋯
  const actions = (b: HTMLButtonElement, s: Kept) => {
    const was = b.getAttribute('aria-expanded') === 'true'
    openMenu(
      b,
      [
        { icon: 'pen', label: 'Replace', run: () => replace(s) },
        { icon: 'bin', label: 'Remove', danger: true, run: () => remove(s) },
      ],
      { cap: `${s.name} · ${scope(s)}`, label: `${s.name}, ${scope(s)}` },
    )
    if (was) return
    b.setAttribute('aria-expanded', 'true')
    requestAnimationFrame(() => {
      const m = [...document.querySelectorAll<HTMLElement>('.layer [role="menu"]')].at(-1)
      if (m && b.getAttribute('aria-expanded') === 'true' && !m.dataset.keys) {
        m.dataset.keys = '1'
        keyboard(b, m)
      }
    })
  }
  return (
    <>
      {(list.length > SEARCH_FROM || q) && (
        <div
          className="sq"
          role="search"
          // Escape empties the box first, in it or on Clear, as a browser's and macOS's search fields do; once empty it
          // closes Settings as before
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !q) return
            e.preventDefault()
            e.stopPropagation()
            clear()
          }}
        >
          <I n="search" />
          <input
            ref={box}
            className="inp"
            type="search"
            name="secret-q"
            aria-label="Search secrets"
            placeholder="Search secrets"
            value={q}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(e) => setQ(e.target.value)}
          />
          {q && <IB icon="x" label="Clear search" onClick={clear} />}
        </div>
      )}
      {q && !shown.length && (
        <p className="hint sq-none" role="status">
          No secret named “{q.trim()}”.
        </p>
      )}
      {shown.map((s) => (
        <div key={`${s.level}:${s.name}`} className="srow sec">
          <span className="n">
            <span className="sn" translate="no">
              <Name name={s.name} />
            </span>
            <small>{scope(s)}</small>
          </span>
          {phone ? (
            <IB
              icon="dots"
              // with who may use it: the same name kept in two places is two rows, and each says which it is
              label={`More for ${s.name}, ${scope(s)}`}
              aria-haspopup="menu"
              onClick={(e) => actions(e.currentTarget, s)}
            />
          ) : (
            <span className="acts">
              <Btn small onClick={() => replace(s)}>Replace</Btn>
              <Btn small onClick={() => remove(s)}>Remove</Btn>
            </span>
          )}
        </div>
      ))}
    </>
  )
}
