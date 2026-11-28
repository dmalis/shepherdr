// New space's Folder field with its folder list (folder-list.ts says what it shows): it opens as the field is focused
// or typed in, follows the machine picked, and is asked once per folder (cached while the dialog is open). Up and down
// move through it, Enter picks the row moved to (or, on none, creates as before), Tab moves on to the next field,
// Escape closes the list and leaves the dialog open. A listing that failed is asked again when the list reopens or
// its machine is picked again. A tap picks without the field losing its focus (the phone's keyboard
// stays). It sits in the dialog's flow under the field, so it is never cut off and the dialog scrolls to it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { escapeFirst } from './overlay.tsx'
import { onKey, shown, wanted, type Asked, type FRow, type Info } from './folder-list.ts'
import { Row, I } from './ui.tsx'

type Got = Info | 'loading' | { error: string }

const json = async (url: string) => {
  const r = await fetch(url)
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok || j.error) throw new Error(j.error || 'That did not work.')
  return j
}

export function FolderField({ machine, skip, value, onChange, onEnter, placeholder }: { machine: string; skip?: Set<string>; value: string; onChange: (v: string) => void; onEnter: () => void; placeholder: string }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(-1)
  // per machine: its home and recent folders; per machine and folder: what's inside (both kept while the dialog is)
  const [infos, setInfos] = useState<Record<string, Got>>({})
  const [dirs, setDirs] = useState<Record<string, Asked>>({})
  const asking = useRef(new Set<string>())
  const list = useRef<HTMLDivElement>(null)
  const info = infos[machine]
  const home = info && info !== 'loading' && !('error' in info) ? info : null
  // a press outside the field (Create, the git switch) keeps the list until its click is done: closing it at the
  // press would move what is under the pointer, and the click would land on nothing
  const pressing = useRef(false)

  // what failed is asked again: as the list opens, and when its machine is picked again
  useEffect(() => {
    if (!open) return
    const failed = (v: unknown) => !!v && typeof v === 'object' && 'error' in v
    setInfos((x) => (Object.values(x).some(failed) ? Object.fromEntries(Object.entries(x).filter(([, v]) => !failed(v))) : x))
    setDirs((x) => {
      const bad = Object.keys(x).filter((k) => failed(x[k]))
      if (!bad.length) return x
      for (const k of bad) asking.current.delete(k)
      return Object.fromEntries(Object.entries(x).filter(([k]) => !bad.includes(k)))
    })
  }, [open, machine])
  useEffect(() => {
    const down = () => void (pressing.current = true)
    const up = () => void setTimeout(() => (pressing.current = false))
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', up, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', up, true)
    }
  }, [])
  const close = () => {
    if (!pressing.current) return setOpen(false)
    // after the press's click (a click follows pointerup in the same task)
    const later = () => {
      document.removeEventListener('pointerup', later, true)
      document.removeEventListener('pointercancel', later, true)
      setTimeout(() => {
        if (document.activeElement !== field.current) setOpen(false)
      })
    }
    document.addEventListener('pointerup', later, true)
    document.addEventListener('pointercancel', later, true)
  }
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || infos[machine]) return
    setInfos((x) => ({ ...x, [machine]: 'loading' }))
    json(`api/newspace?machine=${encodeURIComponent(machine)}`)
      .then((j) => setInfos((x) => ({ ...x, [machine]: { home: String((j as Info).home ?? ''), recent: Array.isArray((j as Info).recent) ? (j as Info).recent : [] } })))
      .catch((e: Error) => setInfos((x) => ({ ...x, [machine]: { error: e.message } })))
  }, [open, machine, infos])

  const dir = home ? wanted(value, home.home) : null
  const key = dir && `${machine}\n${dir}`
  useEffect(() => {
    if (!open || !key || !dir || dirs[key] || asking.current.has(key)) return
    // typed quickly, only the folder the typing stops in is asked
    const t = setTimeout(() => {
      asking.current.add(key)
      setDirs((x) => ({ ...x, [key]: 'loading' }))
      json(`api/folders?machine=${encodeURIComponent(machine)}&path=${encodeURIComponent(dir)}`)
        .then((j) => {
          const l = j as { exists?: boolean; entries?: { name: string; path: string; repo: boolean }[] }
          setDirs((x) => ({ ...x, [key]: { exists: !!l.exists, entries: Array.isArray(l.entries) ? l.entries : [] } }))
        })
        .catch(() => setDirs((x) => ({ ...x, [key]: { error: `Couldn't list that folder${machine ? ` on ${machine}` : ''}.` } })))
    }, 120)
    return () => clearTimeout(t)
  }, [open, key, dir, machine, dirs])

  const view = home ? shown(value, home, key ? dirs[key] : undefined, skip) : { groups: [], note: info && info !== 'loading' && 'error' in info ? info.error : 'Loading…' }
  const rows = view.groups.flatMap((g) => g.rows)
  // the list changed under the row moved to: back to none
  useEffect(() => setAt(-1), [value, machine])
  useLayoutEffect(() => {
    if (at >= 0) list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])
  // Escape closes the list first, the dialog stays
  useEffect(() => {
    if (!open) return
    const take = () => {
      setOpen(false)
      return true
    }
    escapeFirst.add(take)
    return () => void escapeFirst.delete(take)
  }, [open])
  // opened on a phone, the dialog scrolls so the list's top shows above the keyboard
  useEffect(() => {
    if (open) list.current?.scrollIntoView?.({ block: 'nearest' })
  }, [open])

  const pick = (r: FRow) => {
    onChange(r.text)
    setOpen(true)
    setAt(-1)
  }
  let n = -1
  return (
    <div className="fld ffld">
      <span id="ffld-l">Folder</span>
      <input
        className="inp"
        name="folder"
        role="combobox"
        aria-labelledby="ffld-l"
        aria-expanded={open}
        aria-controls="ffld-list"
        aria-autocomplete="list"
        aria-activedescendant={open && at >= 0 ? `ffld-${at}` : undefined}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={() => setOpen(true)}
        ref={field}
        onBlur={close}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          // an IME's word being chosen (Safari says so by keyCode 229 alone)
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229 || (e.key !== 'Enter' && (e.altKey || e.ctrlKey || e.metaKey))) return
          const k = onKey(e.key, { open, at, rows, value, shift: e.shiftKey })
          if (k.do === 'none') return
          e.preventDefault()
          if (k.do === 'open') setOpen(true)
          else if (k.do === 'move') setAt(k.at)
          else if (k.do === 'pick') pick(k.row)
          else {
            setOpen(false)
            onEnter()
          }
        }}
      />
      {open && (
        // a press anywhere in it (a row, its scroll bar) leaves the focus in the field
        <div className="fpick" id="ffld-list" role="listbox" aria-label="Folders" ref={list} onMouseDown={(e) => e.preventDefault()}>
          {view.groups.map((g, gi) => (
            <div key={gi} role="group" aria-label={g.label} style={{ display: 'contents' }}>
              {g.label && <div className="lab">{g.label}</div>}
              {g.rows.map((r) => {
                n++
                const me = n
                return (
                  <Row
                    key={`${r.kind}:${r.text}`}
                    id={`ffld-${me}`}
                    data-i={me}
                    role="option"
                    aria-selected={me === at}
                    tabIndex={-1}
                    icon={r.kind === 'up' ? 'up' : r.kind === 'recent' ? 'clock' : 'folder'}
                    label={r.label}
                    value={r.sub}
                    end={r.repo ? <I n="branch" c="s16" /> : undefined}
                    onClick={() => pick(r)}
                  />
                )
              })}
            </div>
          ))}
          {view.note && <p className="hint">{view.note}</p>}
        </div>
      )}
    </div>
  )
}
