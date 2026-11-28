// The pickers' own lists (fork #163): the agent picker's rows and lists, and the machine and space lists, fetched when
// one first opens. The rows that open them, and the words for a pick, stay in picker.tsx.
import { useEffect, useRef, useState } from 'react'
import type { CatalogAgent, CatalogModel } from '@shared/types.ts'
import { everything, machineLabel, spaceName, spacesOf, unreachable } from '@shared/view.ts'
import { levelName } from '@core/agents.js'
import { getState, useChat } from './kernel.ts'
import { openDialog } from './overlay.tsx'
import { Btn, I, Logo, Row } from './ui.tsx'
import { SpaceIcon } from './space-icon.tsx'
import { agentOf, Bolts, choiceList, compactChoices, findModel, modelOf, PickerHead, pickerRows, pickWords, samePick, SPEEDS, speedOf, tiersOf, useCatalog, type Field, type LivePick, type Pick } from './picker.tsx'
import './picker-compact.css'


function AgentPicker({ title, machine, start, typed, onChange, close, live }: { title: string; machine: string; start: Pick; typed?: string; onChange: (p: Pick) => void; close: () => void; live?: LivePick }) {
  const snap = getState().snap
  const cat = useCatalog(machine)
  const [p, setP] = useState<Pick>(start)
  const [current, setCurrent] = useState(start)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const phase = useChat(live?.chat ?? '')?.settingsUpdate
  const [field, setField] = useState<'' | Field>('')
  const [q, setQ] = useState('')
  const set = (next: Pick) => {
    setP(next)
    setError('')
    onChange(next)
  }
  const dirty = !!live && !samePick(current, p, cat)
  const submit = async () => {
    if (!live || !dirty) return close()
    setError('')
    setApplying(true)
    try {
      const r = await live.update(p)
      if (r.current) {
        setCurrent(r.current)
        setP(r.current)
      }
      if (r.error) setError(r.error)
      else close()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The update could not be confirmed.')
    } finally { setApplying(false) }
  }
  // "/model sonnet" in a chat: once the models are read, the one it names is picked; a name no model has opens the
  // Model list searching for it
  const named = useRef(!typed)
  useEffect(() => {
    if (named.current || !cat || !typed) return
    named.current = true
    const hit = findModel(cat, start.agent, typed)
    const ha = hit && agentOf(cat, hit.agent), hm = ha?.models.find((x) => x.id === hit!.model)
    // fork #219: another CLI keeps the Compact at picked
    if (ha && hm) set(withModel(hit!.agent === start.agent ? start : { agent: ha.id, compact: start.compact ?? null }, ha, hm))
    else {
      setField('model')
      setQ(typed)
    }
  }, [cat])
  const a = agentOf(cat, p.agent)
  const m = modelOf(a, p)
  const w = pickWords(p, cat)
  const mach = snap ? machineLabel(snap, machine) : machine
  const open = (f: typeof field) => {
    setField(f)
    setQ('')
  }
  const hit = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase())

  // every row the same: the agent's logo in the first column (kept empty on the others, so they all line up), its
  // label over what is picked, a chevron
  if (!field)
    return (
      <div className="pk">
        <PickerHead title={title} close={close} />
        {pickerRows(p, cat).map((r) => (
          <button key={r.f} type="button" className="row row2" aria-label={`${r.label}: ${r.value}. Change`} onClick={() => open(r.f)} disabled={applying}>
            {r.f === 'agent' ? <Logo agent={p.agent} name={w.agent} /> : <span className="pk-gap" />}
            <span className="n">
              <span className="l2">{r.label}</span>
              {/* fork #219: Speed says Standard rather than nothing; a faster tier keeps its bolts beside its name */}
              {r.f === 'speed'
                ? <span className="l1 pk-v">{SPEEDS[w.speed]}<Bolts speed={w.speed} decorative /></span>
                : <span className="l1 pk-v">{r.value}</span>}
            </span>
            <I n="right" c="s16" />
          </button>
        ))}
        {dirty && p.agent !== current.agent && !applying && <p className="muted">Changing the agent starts a new session here. Earlier messages stay.</p>}
        {dirty && p.agent === current.agent && !applying && <p className="muted">This chat restarts with your changes.</p>}
        {error && <p className="c-red" role="alert">{error}</p>}
        <div className="acts" style={{ marginTop: 8 }}>
          <Btn kind="pri" onClick={() => void submit()} disabled={applying || !!phase}>
            {applying || phase ? <span role="status">{phase ?? 'Applying…'}</span> : dirty ? 'Update' : 'Done'}
          </Btn>
        </div>
      </div>
    )

  if (field === 'compact') {
    const items = compactChoices(p, cat)
    return (
      <div className="pk">
        <PickerHead title={`Compact at · ${w.model || w.agent}`} back={() => open('')} close={close} />
        <div className="list" style={{ minHeight: 0 }}>
          {items.map((x) => (
            <Row
              key={x.id}
              label={<>{x.label}{x.recommended && <span className="pk-tag">Recommended</span>}</>}
              sub={x.sub}
              current={x.on}
              end={x.on && <I n="check" />}
              onClick={() => {
                set(x.pick)
                open('')
              }}
            />
          ))}
        </div>
        <p className="hint">A long session sums up its conversation once it reaches this size, so it keeps going on less. It applies the next time the agent starts.</p>
      </div>
    )
  }

  if (field === 'effort' || field === 'speed' || field === 'mode') {
    const c = choiceList(field, p, cat)
    return (
      <div className="pk">
        <PickerHead title={c.title} back={() => open('')} close={close} />
        <div className="list" style={{ minHeight: 0 }}>
          {c.items.map((x) => (
            <Row
              key={x.id}
              label={field === 'speed' ? <>{x.label}<Bolts speed={speedOf(x.pick)} decorative /></> : x.label}
              sub={x.sub}
              current={x.on}
              end={x.on && <I n="check" />}
              onClick={() => {
                set(x.pick)
                open('')
              }}
            />
          ))}
        </div>
        {field === 'speed' && c.items.length > 1 && <p className="hint">Faster tiers can cost more.</p>}
      </div>
    )
  }

  if (field === 'agent') {
    const here = (cat?.agents ?? []).filter((x) => x.installed && hit(x.name))
    const not = (cat?.agents ?? []).filter((x) => !x.installed && hit(x.name))
    return (
      <div className="pk">
        <PickerHead title="Agent" back={() => open('')} close={close} />
        <input className="inp" name="pq" aria-label="Search" placeholder="Search agents" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
        <div className="list">
          {!cat && <p className="hint" style={{ padding: 8 }}>Reading the agents on {mach}…</p>}
          {here.length > 0 && <div className="lab">On {mach}</div>}
          {here.map((x) => (
            <Row
              key={x.id}
              lead={<Logo agent={x.id} name={x.name} />}
              label={x.name}
              current={p.agent === x.id}
              end={p.agent === x.id ? <I n="check" /> : undefined}
              onClick={() => {
                // another agent starts on its own first model; picking it moves straight on to its models
                if (x.id !== p.agent) {
                  const first = x.models.find((y) => y.id === x.defaultModel) ?? x.models[0]
                  const eff = first?.efforts ?? x.efforts
                  // fork #219: its Compact at goes along (each CLI caps it at its model's window)
                  set({ agent: x.id, model: first?.id ?? null, effort: p.effort && eff.includes(p.effort) ? p.effort : (first?.defaultEffort ?? x.defaultEffort ?? eff[Math.min(2, eff.length - 1)] ?? null), fast: false, perm: null, compact: p.compact ?? null })
                }
                open('model')
              }}
            />
          ))}
          {not.length > 0 && <div className="lab">Not installed on {mach}</div>}
          {not.map((x) => (
            <div key={x.id} className="row off">
              <Logo agent={x.id} name={x.name} />
              <span className="n">{x.name}</span>
              {x.why && <span className="v">{x.why}</span>}
            </div>
          ))}
          {cat && !here.length && !not.length && <p className="hint" style={{ padding: 8 }}>No agent matches.</p>}
        </div>
      </div>
    )
  }

  const models = (a?.models ?? []).filter((x) => hit(`${x.name} ${x.group ?? ''}`))
  const groups = [...new Set(models.map((x) => x.group ?? ''))]
  return (
    <div className="pk">
      <PickerHead title={`Model · ${w.agent}`} back={() => open('')} close={close} />
      <input className="inp" name="pq" aria-label="Search" placeholder={`Search ${a?.models.length ?? 0} models`} value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {groups.map((g) => (
          <div key={g} style={{ display: 'contents' }}>
            {g && <div className="lab">{g}</div>}
            {models
              .filter((x) => (x.group ?? '') === g)
              .map((x) => {
                const on = m?.id === x.id
                return (
                  <Row
                    key={x.id}
                    label={x.name}
                    current={on}
                    end={
                      <>
                        {(x.speeds?.length ?? 0) > 1 && <I n="bolt" c="s16 c-mute" />}
                        {on && <I n="check" />}
                      </>
                    }
                    onClick={() => {
                      set(withModel(p, a, x))
                      open('')
                    }}
                  />
                )
              })}
          </div>
        ))}
        {!models.length && <p className="hint" style={{ padding: 8 }}>{cat ? 'No model matches.' : `Reading the models on ${mach}…`}</p>}
      </div>
    </div>
  )
}

/** a pick with another model: its effort and speed kept where the model has them */
function withModel(p: Pick, a: CatalogAgent | undefined, x: CatalogModel): Pick {
  const eff = x.efforts ?? a?.efforts ?? []
  return { ...p, label: null, model: x.id, effort: p.effort && eff.includes(p.effort) ? p.effort : (x.defaultEffort ?? null), fast: tiersOf(x).includes(speedOf(p)) ? p.fast : false }
}

export function openPicker(o: { title: string; machine: string; pick: Pick; typed?: string; onChange: (p: Pick) => void; onClose?: (p: Pick) => void; live?: LivePick }) {
  let last = o.pick
  openDialog((close) => <AgentPicker title={o.title} machine={o.machine} start={o.pick} typed={o.typed} live={o.live} onChange={(p) => { last = p; o.onChange(p) }} close={close} />, { wide: true, bare: true, label: o.title, onClose: () => o.onClose?.(last) })
}

function MachinePicker({ value, onPick, close }: { value: string; onPick: (m: string) => void; close: () => void }) {
  const snap = getState().snap!
  const [q, setQ] = useState('')
  const list = snap.machines.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="pk">
      <PickerHead title="Machine" close={close} />
      <input className="inp" name="pq" aria-label="Search machines" placeholder="Search machines" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {list.map((m) =>
          unreachable(m) ? (
            <div key={m.id} className="row off">
              <I n="server" />
              <span className="n">{m.name}</span>
              <span className="v">Can't reach</span>
            </div>
          ) : (
            <Row
              key={m.id}
              icon="server"
              label={m.name}
              current={value === m.machine}
              end={value === m.machine ? <I n="check" /> : undefined}
              onClick={() => {
                onPick(m.machine)
                close()
              }}
            />
          ),
        )}
        {!list.length && <p className="hint" style={{ padding: 8 }}>No machine matches.</p>}
      </div>
    </div>
  )
}

function SpacePicker({ value, onPick, close }: { value: string; onPick: (place: string) => void; close: () => void }) {
  const snap = getState().snap!
  const [q, setQ] = useState('')
  const ev = everything(snap)
  // the search matches a space's name or its machine's
  const hit = (name: string, machine: string) => !q.trim() || `${name} ${machineLabel(snap, machine)}`.toLowerCase().includes(q.trim().toLowerCase())
  const spaces = spacesOf(snap).filter((p) => !p.archived)
  const row = (id: string, name: string, root: boolean, machine: string) => (
    <Row
      key={id}
      lead={<SpaceIcon snap={snap} id={id} />}
      label={name}
      value={root ? machineLabel(snap, machine) : undefined}
      current={value === id}
      end={value === id ? <I n="check" /> : undefined}
      onClick={() => {
        onPick(id)
        close()
      }}
    />
  )
  const blocks = snap.machines
    .map((m) => ({ m, list: spaces.filter((p) => p.machine === m.machine && hit(spaceName(snap, p), p.machine)) }))
    .filter((b) => b.list.length)
  const evHit = ev && hit('Everything', ev.machine)
  return (
    <div className="pk">
      <PickerHead title="Space" close={close} />
      <input className="inp" name="pq" aria-label="Search spaces and machines" placeholder="Search spaces and machines" value={q} autoComplete="off" data-autofocus onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {evHit && row(ev.id, 'Everything', true, ev.machine)}
        {blocks.map((b) => (
          <div key={b.m.id} style={{ display: 'contents' }}>
            <div className="lab">{b.m.name}</div>
            {b.list.map((p) => row(p.id, spaceName(snap, p), false, p.machine))}
          </div>
        ))}
        {!evHit && !blocks.length && <p className="hint" style={{ padding: 8 }}>No space matches.</p>}
      </div>
    </div>
  )
}

export function openMachines(value: string, onPick: (m: string) => void) {
  openDialog((close) => <MachinePicker value={value} onPick={onPick} close={close} />, { wide: true, bare: true, label: 'Machine' })
}

export function openSpaces(value: string, onPick: (place: string) => void) {
  openDialog((close) => <SpacePicker value={value} onPick={onPick} close={close} />, { wide: true, bare: true, label: 'Space' })
}
