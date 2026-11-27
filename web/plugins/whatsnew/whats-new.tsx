// Settings › About's "What's new" (fork patch #70): what changed in each version, newest first, as Linear's and
// Raycast's in-app changelogs, VS Code's release notes and Slack's What's new list it. First the build's own changes
// on top of its release ("On top of 3.2.22"), then each release with its date, the changes that sat on top of it at
// the time inside it. One short line each: a release's bullet opens its full text on a tap. The newest two versions
// are open, older ones fold under their heading, and only what's open is drawn. The list is the build's own
// (web/changelog.ts), its own chunk, loaded when About or the update toast needs it (whats-new-go.ts); the toast's
// button opens it at what the update brought.
import { useEffect, useState } from 'react'
import type { Change, Changelog, Item, Release } from '@shared/changelog.ts'
import { I } from '@client/ui.tsx'
import { OWN_VERSION } from '@client/update.ts'
import { loadChangelog, onGoto, takeGoto } from './go.ts'
import './whats-new.css'

/* ---------- the list ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Nov 27", with the year when it isn't this year's */
export function dateWords(d: string, now = new Date()): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(d)
  if (!m) return ''
  const day = `${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}`
  return Number(m[1]) === now.getFullYear() ? day : `${day}, ${m[1]}`
}

/** `code` in a line, as code; the rest as plain text */
function Words({ text }: { text: string }) {
  const parts = text.split('`')
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</>
}

const idOf = (key: string) => `wn-${key.replace(/[^\w]/g, '-')}`

/** one line; with more to say, a tap opens the rest under it */
function Line({ item }: { item: Item }) {
  const [open, setOpen] = useState(false)
  if (!item.rest) return <li><Words text={item.line} /></li>
  return (
    <li>
      <button type="button" className="wn-i" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Words text={item.line} />
        <I n="down" c="chev s16" />
      </button>
      {open && <p className="wn-rest"><Words text={item.rest} /></p>}
    </li>
  )
}

function Changes({ title, changes }: { title?: string; changes: Change[] }) {
  return (
    <div className="wn-g">
      {title && <h5>{title}</h5>}
      <ul>{changes.map((c) => <li key={c.c}>{c.s}</li>)}</ul>
    </div>
  )
}

type Block = { key: string; head: string; meta: string; ours: Change[]; release?: Release; mine?: boolean }

/** the build's changes on top first, then every release (the changes on top of it at the time inside it), newest first */
export function blocks(log: Changelog, version: string, now = new Date()): Block[] {
  const ours = new Map(log.onTop.map((t) => [t.v, t.changes]))
  const out: Block[] = []
  const mine = ours.get(version) ?? []
  if (mine.length) out.push({ key: 'top', head: `On top of ${version}`, meta: `${mine.length} ${mine.length === 1 ? 'change' : 'changes'}`, ours: mine, mine: true })
  const known = new Set(log.releases.map((r) => r.v))
  // changes on top of a release CHANGELOG.md doesn't have yet: a block of their own, so none goes missing
  for (const t of log.onTop) if (t.v !== version && !known.has(t.v) && t.changes.length) out.push({ key: t.v, head: t.v, meta: '', ours: t.changes })
  for (const r of log.releases) out.push({ key: r.v, head: r.v, meta: r.date ? dateWords(r.date, now) : '', ours: r.v === version ? [] : (ours.get(r.v) ?? []), release: r })
  return out
}

/** the newest two versions open, and the build's own changes on top */
const firstOpen = (bs: Block[]) => new Set([...bs.filter((b) => b.mine).map((b) => b.key), ...bs.filter((b) => !b.mine).slice(0, 2).map((b) => b.key)])

function Version({ b, open, flip }: { b: Block; open: boolean; flip: () => void }) {
  return (
    <li className="wn-v" id={idOf(b.key)} data-mine={b.mine || undefined} data-open={open || undefined}>
      <button type="button" className="wn-h" aria-expanded={open} onClick={flip}>
        <span className="wn-dot" aria-hidden="true" />
        <span className="wn-n">{b.head}</span>
        {b.meta && <span className="wn-d">{b.meta}</span>}
        <I n="down" c="chev s16" />
      </button>
      {open && (
        <div className="wn-b">
          {b.ours.length > 0 && <Changes title={b.mine ? undefined : `On top of ${b.head}`} changes={b.ours} />}
          {b.release?.groups.map((g, i) => (
            <div className="wn-g" key={i}>
              {g.title && <h5>{g.title}</h5>}
              <ul>{g.items.map((it, j) => <Line key={j} item={it} />)}</ul>
            </div>
          ))}
        </div>
      )}
    </li>
  )
}

export function WhatsNew() {
  const [log, setLog] = useState<Changelog | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<Set<string> | null>(null)
  useEffect(() => {
    let on = true
    loadChangelog().then((l) => on && setLog(l), () => on && setFailed(true))
    return () => void (on = false)
  }, [])
  const bs = log ? blocks(log, OWN_VERSION) : []
  // the toast's button: open that block and bring it into view
  useEffect(() => {
    if (!log) return
    const go = () => {
      const at = takeGoto()
      if (!at) return
      setOpen((o) => new Set([...(o ?? firstOpen(bs)), at]))
      // no such block (nothing on top of a new release): What's new's start
      requestAnimationFrame(() => (document.getElementById(idOf(at)) ?? document.querySelector('.wn-v'))?.scrollIntoView({ block: 'start' }))
    }
    const off = onGoto(go)
    go()
    return off
  }, [log])
  if (failed) return <><h3>What's new</h3><p className="hint">The list of changes didn't load. Reload the page to try again.</p></>
  if (!log) return null
  const shown = open ?? firstOpen(bs)
  const flip = (k: string) => {
    const n = new Set(shown)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    setOpen(n)
  }
  return (
    <section className="wn" aria-labelledby="wn-h">
      <h3 id="wn-h">What's new</h3>
      {bs.length ? (
        <ol className="wn-list">
          {bs.map((b) => <Version key={b.key} b={b} open={shown.has(b.key)} flip={() => flip(b.key)} />)}
        </ol>
      ) : (
        <p className="hint">This build has no list of changes.</p>
      )}
      {log.repo && (
        <p className="wn-all">
          <a className="lk" href={`${log.repo}/blob/HEAD/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">Full changelog on GitHub</a>
        </p>
      )}
    </section>
  )
}
