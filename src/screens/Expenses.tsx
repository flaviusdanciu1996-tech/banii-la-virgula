import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Minus, Settings2, ChevronLeft, Search, Repeat } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Ring, EmptyArt } from '../ui.tsx'
import { TxRow, catColor } from '../helpers.tsx'
import { Icon } from '../icons.tsx'
import { fmt, fmtNum, pct } from '../lib/money.ts'
import { dayLabel, shortDayLabel, periodLabel, periodFor, shiftPeriod, todayIso, inPeriod, type Period } from '../lib/period.ts'
import { summarize } from '../lib/calc.ts'
import { GROUPS, type Tx } from '../lib/types.ts'
import type { Nav } from '../App.tsx'

export function ExpensesTab({ nav, openTx }: { nav: Nav; openTx: (t?: Tx, kind?: 'in' | 'out') => void }) {
  const st = useStore()
  const latest = [...st.txs].sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at)).slice(0, 10)
  return (
    <div className="screen">
      <header className="hello"><div><h1>Cheltuieli</h1><p className="muted">Totul într-un singur loc</p></div></header>
      <section>
        <h2>Adaugă</h2>
        <div className="add-row">
          <button type="button" className="add out" onClick={() => openTx(undefined, 'out')}><Minus size={18} />Cheltuială</button>
          <button type="button" className="add in" onClick={() => openTx(undefined, 'in')}><Plus size={18} />Venit</button>
        </div>
      </section>
      <section>
        <h2>Ultimele intrări</h2>
        {latest.length ? <div className="rows">{latest.map(t => <TxRow key={t.id} t={t} onOpen={openTx} />)}</div>
          : <EmptyArt icon="wallet" title="Începe cu primul ban" text="Trece venitul lunii și apoi fiecare cheltuială. Aici apar ultimele 10." />}
        <button type="button" className="link" onClick={() => nav('history')}>Vezi tot istoricul <ChevronRight size={15} /></button>
      </section>
      <div className="menu">
        <button type="button" className="menu-row" onClick={() => nav('recurente')}><Repeat size={18} />Plăți recurente<ChevronRight size={16} className="chev" /></button>
        <button type="button" className="menu-row" onClick={() => nav('finante')}><Settings2 size={18} />Setări finanțe<ChevronRight size={16} className="chev" /></button>
      </div>
    </div>
  )
}

export function HistoryScreen({ openTx, initial }: { openTx: (t?: Tx) => void; initial?: { cat?: string; sort?: string } }) {
  const st = useStore()
  const pd = st.settings.payday
  const [period, setPeriod] = useState<Period | null>(periodFor(todayIso(), pd))
  const [type, setType] = useState<'' | 'in' | 'out'>('')
  const [cat, setCat] = useState(initial?.cat ?? '')
  const [member, setMember] = useState('')
  const [q, setQ] = useState('')
  const [byAmount, setByAmount] = useState(initial?.sort === 'amount')

  const list = useMemo(() => st.txs.filter(t =>
    (!period || inPeriod(t.date, period)) && (!type || t.kind === type) && (!cat || t.category_id === cat) &&
    (!member || t.member_id === member) && (!q || t.note.toLowerCase().includes(q.toLowerCase()))
  ), [st.txs, period, type, cat, member, q])

  const days = useMemo(() => {
    const m = new Map<string, Tx[]>()
    for (const t of list) m.set(t.date, [...(m.get(t.date) || []), t])
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [list])
  const total = list.reduce((a, t) => a + (t.kind === 'in' ? t.amount : -t.amount), 0)

  return (
    <div className="screen">
      <div className="period">
        <button type="button" className="icon-btn" aria-label="Perioada anterioară" disabled={!period} onClick={() => period && setPeriod(shiftPeriod(period, -1, pd))}><ChevronLeft size={18} /></button>
        <b>{period ? periodLabel(period, pd) : 'Toate perioadele'}</b>
        <button type="button" className="icon-btn" aria-label="Perioada următoare" disabled={!period} onClick={() => period && setPeriod(shiftPeriod(period, 1, pd))}><ChevronRight size={18} /></button>
      </div>
      <div className="filters">
        <label className="search"><Search size={16} /><input id="h-q" placeholder="Caută în note" value={q} onChange={e => setQ(e.target.value)} /></label>
        <div className="filter-row">
          <select id="h-type" aria-label="Tip" value={type} onChange={e => setType(e.target.value as any)}>
            <option value="">Toate</option><option value="out">Cheltuieli</option><option value="in">Venituri</option>
          </select>
          <select id="h-cat" aria-label="Categorie" value={cat} onChange={e => setCat(e.target.value)}>
            <option value="">Toate categoriile</option>
            {st.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {st.members.length > 1 && (
            <select id="h-member" aria-label="Cine" value={member} onChange={e => setMember(e.target.value)}>
              <option value="">Toți</option>
              {st.members.map(m => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}
            </select>
          )}
        </div>
        <div className="filter-row">
          <button type="button" className="chip" aria-pressed={!period} onClick={() => setPeriod(period ? null : periodFor(todayIso(), pd))}>Toate perioadele</button>
          <button type="button" className="chip" aria-pressed={byAmount} onClick={() => setByAmount(!byAmount)}>După sumă</button>
        </div>
      </div>
      <p className="muted small">{list.length} intrări · net <b className="num">{total > 0 ? '+' : ''}{fmtNum(total)} lei</b></p>
      {!list.length && <EmptyArt icon="search" title="Nimic aici" text="Schimbă filtrele sau perioada." />}
      {byAmount ? (
        <div className="rows">{[...list].sort((a, b) => b.amount - a.amount).map(t => <TxRow key={t.id} t={t} onOpen={openTx} />)}</div>
      ) : days.map(([d, items]) => {
        const net = items.reduce((a, t) => a + (t.kind === 'in' ? t.amount : -t.amount), 0)
        return (
          <div key={d} className="day">
            <h3><span>{dayLabel(d)}</span><span className="num">{net > 0 ? '+' : ''}{fmtNum(net)}</span></h3>
            <div className="rows">{items.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(t => <TxRow key={t.id} t={t} onOpen={openTx} />)}</div>
          </div>
        )
      })}
    </div>
  )
}

export function CategoriesScreen({ period, nav }: { period: Period; nav: Nav }) {
  const st = useStore()
  const sum = summarize(st.txs, st.categories, st.settings, period, todayIso())
  return (
    <div className="screen">
      <p className="muted">{periodLabel(period, st.settings.payday)} · cheltuit <b className="num">{fmt(sum.spent)}</b> din <b className="num">{sum.totalBudget ? fmt(sum.totalBudget) : '–'}</b></p>
      {GROUPS.map(g => {
        const cats = st.categories.filter(c => c.kind === 'out' && c.grp === g.id && !c.archived)
          .sort((a, b) => (sum.byCat.get(b.id) || 0) - (sum.byCat.get(a.id) || 0))
        const spent = cats.reduce((a, c) => a + (sum.byCat.get(c.id) || 0), 0)
        const alloc = cats.reduce((a, c) => a + c.allocated, 0)
        return (
          <section key={g.id}>
            <h2 className="grp-h"><span><i className="dot" style={{ background: g.color }} />{g.name}</span><span className="num">{fmtNum(spent)}{alloc ? ' / ' + fmtNum(alloc) : ''}</span></h2>
            <div className="rows">
              {cats.map(c => {
                const v = sum.byCat.get(c.id) || 0
                const r = c.allocated ? v / c.allocated : 0
                return (
                  <button key={c.id} type="button" className="row" onClick={() => nav('history', { cat: c.id })}>
                    <Ring value={c.allocated ? r : v ? 1 : 0} size={40} color={r > 1 ? 'var(--bad)' : catColor(c)}><Icon name={c.icon} size={16} color={catColor(c)} /></Ring>
                    <span className="row-main"><b>{c.name}</b><span className="muted small">{c.allocated ? `${pct(v, c.allocated)}% din ${fmtNum(c.allocated)}` : 'fără limită'} · {pct(v, sum.spent)}% din total</span></span>
                    <span className={'num row-amt' + (r > 1 ? ' bad' : '')}>{fmtNum(v)}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
