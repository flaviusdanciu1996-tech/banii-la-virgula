import { useState } from 'react'
import { Plus, ChevronRight } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Sheet, Seg, MoneyField, ConfirmButton, CatIcon, Bar, EmptyArt } from '../ui.tsx'
import { Icon, ICON_CHOICES } from '../icons.tsx'
import { catColor } from '../helpers.tsx'
import { fmt, fmtNum, parseMoney, CUR_LABEL, pct, type Currency } from '../lib/money.ts'
import { todayIso, diffDays, shortDayLabel, MONTHS } from '../lib/period.ts'
import { nextOccurrence, monthlyNeeded } from '../lib/schedule.ts'
import { GROUPS, type Recurring, type Goal, type Kind } from '../lib/types.ts'
import type { Nav } from '../App.tsx'

/* ---------------- Upcoming payments ---------------- */

export function upcomingList(recurring: Recurring[], today: string, days = 30) {
  return recurring.filter(r => r.active)
    .map(r => ({ r, date: nextOccurrence(r.day, today > r.start_date ? today : r.start_date) }))
    .map(x => (x.r.auto && x.date === today && x.r.last_run === today ? { ...x, date: nextOccurrence(x.r.day, addOne(today)) } : x))
    .filter(x => diffDays(today, x.date) <= days)
    .sort((a, b) => a.date.localeCompare(b.date))
}
const addOne = (d: string) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10) }

export function UpcomingRows({ items, onOpen, limit }: { items: ReturnType<typeof upcomingList>; onOpen: (r: Recurring) => void; limit?: number }) {
  const st = useStore()
  const today = todayIso()
  const list = limit ? items.slice(0, limit) : items
  return (
    <div className="rows upcoming">
      {list.map(({ r, date }) => {
        const c = st.categories.find(x => x.id === r.category_id)
        const inDays = diffDays(today, date)
        return (
          <button key={r.id} type="button" className="row" onClick={() => onOpen(r)}>
            <CatIcon icon={c?.icon || 'repeat'} color={catColor(c)} />
            <span className="row-main">
              <b>{r.name}</b>
              <span className="muted small">{inDays === 0 ? 'azi' : inDays === 1 ? 'mâine' : `în ${inDays} zile`} · {shortDayLabel(date)}</span>
            </span>
            <span className="row-side">
              <b className={'num' + (r.kind === 'in' ? ' in' : '')}>{r.kind === 'in' ? '+' : '−'}{fmtNum(r.amount)} {CUR_LABEL[r.currency]}</b>
              <span className={'pill ' + (r.auto ? 'auto' : inDays <= 3 ? 'soon' : 'manual')}>{r.auto ? 'se trece singur' : 'de plătit'}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- Recurring screen ---------------- */

export function RecurringScreen({ openRecurring }: { openRecurring: (r?: Recurring) => void }) {
  const st = useStore()
  const today = todayIso()
  const items = upcomingList(st.recurring, today, 400)
  const monthly = st.recurring.filter(r => r.active && r.kind === 'out').reduce((a, r) => a + st.toRonNow(r.amount, r.currency), 0)
  return (
    <div className="screen">
      <p className="muted">Chiria, ratele și abonamentele se trec singure în ziua lor. Cele „de plătit” îți apar doar ca memento.</p>
      {items.length ? <>
        <div className="card"><span className="muted small">Total plăți lunare fixe</span><b className="num" style={{ fontSize: 22 }}>{fmt(monthly)}</b></div>
        <UpcomingRows items={items} onOpen={openRecurring} />
      </> : <EmptyArt icon="calendar-clock" title="Nicio plată recurentă" text="Adaugă chiria, rata sau abonamentele o singură dată, iar aplicația le trece singură în fiecare lună." />}
      {st.recurring.some(r => !r.active) && (
        <section>
          <h2>Oprite</h2>
          <div className="rows">
            {st.recurring.filter(r => !r.active).map(r => (
              <button key={r.id} type="button" className="row archived" onClick={() => openRecurring(r)}>
                <span className="row-main"><b>{r.name}</b><span className="muted small">pe {r.day} ale lunii</span></span>
                <span className="num">{fmtNum(r.amount)} {CUR_LABEL[r.currency]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <button type="button" className="primary" onClick={() => openRecurring()}><Plus size={17} /> Plată recurentă nouă</button>
    </div>
  )
}

export function RecurringSheet({ rec, onClose, notify }: { rec?: Recurring; onClose: () => void; notify: (m: string) => void }) {
  const st = useStore()
  const [kind, setKind] = useState<Kind>(rec?.kind ?? 'out')
  const [name, setName] = useState(rec?.name ?? '')
  const [amount, setAmount] = useState(rec ? fmtNum(rec.amount) : '')
  const [currency, setCurrency] = useState<Currency>(rec?.currency ?? 'RON')
  const [cat, setCat] = useState(rec?.category_id ?? '')
  const [day, setDay] = useState(String(rec?.day ?? new Date().getDate()))
  const [auto, setAuto] = useState(rec?.auto ?? true)
  const [active, setActive] = useState(rec?.active ?? true)
  const [err, setErr] = useState('')
  const cats = st.categories.filter(c => c.kind === kind && !c.archived)

  async function save() {
    const v = parseMoney(amount), d = Number(day)
    if (!name.trim()) return setErr('Scrie un nume, de ex. „Chirie”.')
    if (v === null || v <= 0) return setErr('Scrie suma (ex. 1.500,00).')
    if (!cat) return setErr('Alege categoria.')
    if (!Number.isInteger(d) || d < 1 || d > 31) return setErr('Ziua trebuie să fie între 1 și 31.')
    const today = todayIso()
    try {
      await st.saveRecurring({
        id: rec?.id, kind, name: name.trim(), amount: v, currency, category_id: cat, day: d, auto, active,
        // A new item starts today: the first automatic posting is on its next day (today included).
        ...(rec ? {} : { start_date: today, last_run: null }),
      })
      notify('Salvat'); onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  return (
    <Sheet title={rec ? 'Plată recurentă' : 'Plată recurentă nouă'} onClose={onClose}>
      <Seg label="Tip" value={kind} onChange={k => { setKind(k); setCat('') }} options={[{ id: 'out', label: 'Plată' }, { id: 'in', label: 'Venit' }]} />
      <label className="field">Nume<input id="rec-name" maxLength={40} placeholder="ex. Chirie, Netflix, Rată leasing" value={name} onChange={e => setName(e.target.value)} /></label>
      <MoneyField id="rec-amount" big value={amount} onChange={setAmount} suffix={CUR_LABEL[currency]} />
      <div className="cur-seg" role="group" aria-label="Moneda">
        {(['RON', 'EUR', 'USD'] as Currency[]).map(c => <button key={c} type="button" aria-pressed={c === currency} onClick={() => setCurrency(c)}>{c === 'RON' ? 'lei' : CUR_LABEL[c]}</button>)}
      </div>
      <label className="field">Categoria
        <select id="rec-cat" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Alege…</option>
          {kind === 'in' ? cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
            : GROUPS.map(g => <optgroup key={g.id} label={g.name}>{cats.filter(c => c.grp === g.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
        </select>
      </label>
      <label className="field">În ce zi a lunii<input id="rec-day" inputMode="numeric" value={day} onChange={e => setDay(e.target.value.replace(/\D/g, '').slice(0, 2))} /></label>
      <label className="switch">Se trece automat în ziua ei<input id="rec-auto" type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /></label>
      <p className="hint">{auto ? 'În ziua respectivă apare singură în cheltuieli.' : 'Îți apare doar în „Plăți care urmează”; o treci tu când plătești.'}</p>
      {rec && <label className="switch">Activă<input id="rec-active" type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /></label>}
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {rec && <ConfirmButton onConfirm={async () => { await st.deleteRecurring(rec.id); notify('Șters'); onClose() }} />}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </div>
    </Sheet>
  )
}

/* ---------------- Goals ---------------- */

export function GoalCard({ g, onOpen, onAdd }: { g: Goal; onOpen: () => void; onAdd: () => void }) {
  const today = todayIso()
  const p = pct(g.saved, g.target)
  const need = monthlyNeeded(g.target, g.saved, today, g.deadline)
  const done = g.saved >= g.target
  return (
    <div className="goal">
      <button type="button" className="goal-head" onClick={onOpen} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', color: 'inherit' }}>
        <span className="cat-icon" style={{ width: 42, height: 42, ['--c' as any]: done ? 'var(--good)' : 'var(--accent-2)' }}><Icon name={g.icon} size={20} /></span>
        <span className="row-main"><b>{g.name}</b><span className="muted small num">{fmt(g.saved)} din {fmt(g.target)}</span></span>
        <b className={'num ' + (done ? 'good' : '')} style={{ fontSize: 18 }}>{p}%</b>
      </button>
      <Bar value={p} color={done ? 'var(--good)' : 'var(--accent-2)'} />
      <div className="goal-foot">
        <span>{done ? 'Obiectiv atins! 🎉' : g.deadline ? `Termen: ${formatDeadline(g.deadline)}` : 'Fără termen'}</span>
        {!done && need !== null && <span className="num">pune ~{fmt(need)} / lună</span>}
      </div>
      {!done && <button type="button" className="ghost-btn" onClick={onAdd}><Plus size={15} />Adaugă bani</button>}
    </div>
  )
}
const formatDeadline = (d: string) => { const [y, m] = d.split('-').map(Number); return `${MONTHS[m - 1].toLowerCase()} ${y}` }

export function GoalSheet({ goal, addMode, onClose, notify, celebrate }: { goal?: Goal; addMode?: boolean; onClose: () => void; notify: (m: string) => void; celebrate: (m: string) => void }) {
  const st = useStore()
  const [name, setName] = useState(goal?.name ?? '')
  const [icon, setIcon] = useState(goal?.icon ?? 'target')
  const [target, setTarget] = useState(goal ? fmtNum(goal.target) : '')
  const [saved, setSaved] = useState(goal ? fmtNum(goal.saved) : '')
  const [deadline, setDeadline] = useState(goal?.deadline ?? '')
  const [add, setAdd] = useState('')
  const [record, setRecord] = useState(true)
  const [err, setErr] = useState('')

  async function saveAdd() {
    if (!goal) return
    const v = parseMoney(add)
    if (v === null || v <= 0) return setErr('Scrie suma pe care o pui deoparte (ex. 500).')
    try {
      const newSaved = goal.saved + v
      await st.saveGoal({ id: goal.id, saved: newSaved })
      if (record) {
        const savCat = st.categories.find(c => c.grp === 'economii' && !c.archived && c.name === 'Economii') || st.categories.find(c => c.grp === 'economii' && !c.archived)
        if (savCat) await st.saveTx({ kind: 'out', amount: v, category_id: savCat.id, date: todayIso(), note: goal.name, asset_id: null })
      }
      if (goal.saved < goal.target && newSaved >= goal.target) celebrate(`Ai atins obiectivul „${goal.name}”! 🎉`)
      else notify('Bani adăugați')
      onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  async function save() {
    const t = parseMoney(target), sv = saved.trim() ? parseMoney(saved) : 0
    if (!name.trim()) return setErr('Scrie un nume, de ex. „Cabana”.')
    if (t === null || t <= 0) return setErr('Scrie suma țintă (ex. 50.000).')
    if (sv === null || sv < 0) return setErr('Suma strânsă nu e validă.')
    try {
      await st.saveGoal({ id: goal?.id, name: name.trim(), icon, target: t, saved: sv, deadline: deadline || null, archived: false })
      notify('Obiectiv salvat'); onClose()
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  if (addMode && goal) {
    return (
      <Sheet title={`Pune bani: ${goal.name}`} onClose={onClose}>
        <MoneyField id="goal-add" big value={add} onChange={setAdd} suffix="lei" autoFocus />
        <label className="switch">Trece suma și la Economii în cheltuieli<input id="goal-record" type="checkbox" checked={record} onChange={e => setRecord(e.target.checked)} /></label>
        <p className="hint">Așa „Economii” din bugetul lunii arată corect cât ai pus deoparte.</p>
        {err && <p className="err">{err}</p>}
        <div className="actions"><button type="button" className="primary" onClick={saveAdd}>Adaugă</button></div>
      </Sheet>
    )
  }

  return (
    <Sheet title={goal ? 'Obiectiv' : 'Obiectiv nou'} onClose={onClose}>
      <label className="field">Pentru ce strângi<input id="goal-name" maxLength={40} placeholder="ex. Cabana, Mașină nouă, Vacanță" value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="field">Suma țintă</label>
      <MoneyField id="goal-target" big value={target} onChange={setTarget} suffix="lei" />
      <label className="field">Cât ai strâns deja</label>
      <MoneyField id="goal-saved" value={saved} onChange={setSaved} suffix="lei" />
      <label className="field">Până când (opțional)<input id="goal-deadline" type="date" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
      <div className="field">Iconiță</div>
      <div className="icon-grid">
        {ICON_CHOICES.map(n => <button key={n} type="button" className="icon-choice" aria-pressed={n === icon} aria-label={n} onClick={() => setIcon(n)}><Icon name={n} size={18} /></button>)}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {goal && <ConfirmButton onConfirm={async () => { await st.deleteGoal(goal.id); notify('Șters'); onClose() }} />}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </div>
    </Sheet>
  )
}

export function GoalsSection({ openGoal, compact, nav }: { openGoal: (g?: Goal, add?: boolean) => void; compact?: boolean; nav?: Nav }) {
  const st = useStore()
  const goals = st.goals.filter(g => !g.archived).sort((a, b) => (a.saved >= a.target ? 1 : 0) - (b.saved >= b.target ? 1 : 0))
  if (compact && !goals.length) return null
  return (
    <section>
      <h2>Obiective</h2>
      {goals.length ? (
        <div className="goals">
          {(compact ? goals.slice(0, 2) : goals).map(g => <GoalCard key={g.id} g={g} onOpen={() => openGoal(g)} onAdd={() => openGoal(g, true)} />)}
        </div>
      ) : <EmptyArt icon="target" title="Pentru ce strângi?" text="Pune-ți un obiectiv (cabana, o mașină, un fond de urgență) și vezi cât trebuie să pui deoparte pe lună ca să ajungi la el." />}
      {compact
        ? nav && <button type="button" className="link" onClick={() => nav('tab:avere')}>Toate obiectivele <ChevronRight size={15} /></button>
        : <button type="button" className="ghost-btn" style={{ marginTop: 10, width: '100%' }} onClick={() => openGoal()}><Plus size={16} />Obiectiv nou</button>}
    </section>
  )
}
