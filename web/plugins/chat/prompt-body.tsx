// A permission card's body (dmalis/shepherdr#45): why a hook held it, when one did ("The guard holds this command until
// a person answers: … (rule: git-push-rewrite)."), in one plain line above the command, so the person knows what they
// allow; then the command, whole, folded to a few lines when it's long, with Show all. Copy always copies all of it.
import { useState, type ReactNode } from 'react'
import { cx } from '@client/ui.tsx'
import './prompt-body.css'

/** the lines a command shows folded (prompt-body.css clamps .pbody.clip's code to this many) */
export const FOLDED_LINES = 5

/** a command longer than FOLDED_LINES at about 40 characters a line (a phone's card) starts folded */
export function commandLong(text: string): boolean {
  return text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 40)), 0) > FOLDED_LINES
}

/** children: the command as the card draws it (cards.tsx Code) */
export function PromptBody({ why, command, children }: { why?: string; command: string; children: ReactNode }) {
  const long = commandLong(command)
  const [all, setAll] = useState(false)
  return (
    <>
      {why && <span className="pwhy">{why}</span>}
      <div className={cx('pbody', long && !all && 'clip')}>
        {children}
      </div>
      {long && (
        <button type="button" className="fold" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
    </>
  )
}
