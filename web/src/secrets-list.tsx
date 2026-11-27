// Settings › Secrets' list (dmalis/shepherdr#98), the way iOS Settings, 1Password and GitHub's repository
// secrets list theirs: A to Z by name, a search box once there are more than a few, and a name that never runs under
// its buttons. A long name breaks after its underscores (anywhere, as a last resort). On a phone each row is its name
// and who may use it, the whole width, with one ⋯ button: Replace and Remove in its sheet, as iOS and 1Password keep
// a row's actions. On a computer the two buttons stay on the row, where the name has the room beside them.
import { Fragment, useState } from 'react'
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

/** words to match by: lower case, an underscore the same as a space, so "webhook secret" finds WEBHOOK_SECRET */
const words = (s: string) => s.toLowerCase().replace(/[\s_]+/g, ' ').trim()
/** the names that hold what was typed, anywhere in them */
export const matching = (list: Kept[], q: string): Kept[] => {
  const w = words(q)
  return w ? list.filter((s) => words(s.name).includes(w)) : list
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
  const shown = matching(sorted(list), q)
  return (
    <>
      {(list.length > SEARCH_FROM || q) && (
        <div className="sq" role="search">
          <I n="search" />
          <input
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
            // Escape empties the box first, as a browser's and macOS's search fields do; once empty it closes Settings
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !q) return
              e.preventDefault()
              e.stopPropagation()
              setQ('')
            }}
          />
          {q && (
            <IB
              icon="x"
              label="Clear search"
              onClick={(e) => {
                setQ('')
                ;(e.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus()
              }}
            />
          )}
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
              label={`More for ${s.name}`}
              aria-haspopup="menu"
              onClick={(e) =>
                openMenu(
                  e.currentTarget,
                  [
                    { icon: 'pen', label: 'Replace', run: () => replace(s) },
                    { icon: 'bin', label: 'Remove', danger: true, run: () => remove(s) },
                  ],
                  { cap: s.name, label: s.name },
                )
              }
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
