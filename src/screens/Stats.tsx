import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Gauge, Seg, BarsChart, LineChart } from '../ui.tsx'
import { Icon } from '../icons.tsx'
import { fmt, fmtNum, fmtSigned } from '../lib/money.ts'
import { periodFor, shiftPeriod, periodLabel, todayIso, MONTHS_SHORT, parseIso, type Period } from '../lib/period.ts'
import { summarize, savingsRate, recommendations } from '../lib/calc.ts'

export function StatsScreen({ period, anchor }: { period: Period; anchor?: string }) {
  const st = useStore()
  const today = todayIso()
  const pd = st.settings.payday
  const [range, setRange] = useState<'p' | 'y'>('p')
  const [cmp, setCmp] = useState<'prev' | 'year'>('prev')
  const [repCat, setRepCat] = useState<string>('')

  useEffect(() => {
    if (anchor) setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [anchor])

  const cur = useMemo(() => summarize(st.txs, st.categories, st.settings, period, today), [st.txs, st.categories, st.settings, period, today])
  const prev = useMemo(() => summarize(st.txs, st.categories, st.settings, shiftPeriod(period, -1, pd), today), [st.txs, st.categories, st.settings, period, pd, today])
  const yearAgo = useMemo(() => summarize(st.txs, st.categories, st.settings, shiftPeriod(period, -12, pd), today), [st.txs, st.categories, st.settings, period, pd, today])

  const year = useMemo(() => {
    const y = today.slice(0, 4)
    return summarize(st.txs, st.categories, st.settings, { start: `${y}-01-01`, end: today }, today)
  }, [st.txs, st.categories, st.settings, today])

  const base = range === 'p' ? cur : year
  const rate = savingsRate(base.income, base.spent)
  const target = st.settings.savings_target_pct || 20
  const recos = recommendations(cur, prev, st.categories, st.settings, n => fmt(n))

  const ref = cmp === 'prev' ? prev : yearAgo
  const cmpRows = st.categories.filter(c => c.kind === 'out' && c.grp !== 'economii')
    .map(c => ({ c, a: cur.byCat.get(c.id) || 0, b: ref.byCat.get(c.id) || 0 }))
    .filter(r => r.a || r.b).sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))

  const series = useMemo(() => {
    const out: { p: Period; label: string }[] = []
    for (let i = 11; i >= 0; i--) {
      const p = shiftPeriod(periodFor(today, pd), -i, pd)
      out.push({ p, label: MONTHS_SHORT[parseIso(p.start).m] })
    }
    return out.map(x => ({ ...x, s: summarize(st.txs, st.categories, st.settings, x.p, today) }))
  }, [st.txs, st.categories, st.settings, pd, today])

  const repCategory = st.categories.find(c => c.id === repCat)
  const catPoints = series.map(x => ({ label: x.label, value: repCat ? (x.s.byCat.get(repCat) || 0) : x.s.spent }))
  const hasHistory = series.filter(x => x.s.txs.length).length >= 2

  return (
    <div className="screen">
      <header className="hello"><div><h1>Statistici</h1><p className="muted">{periodLabel(period, pd)}</p></div></header>

      <section className="card">
        <h2>Economisire față de țintă</h2>
        <Seg label="Interval" value={range} onChange={setRange} options={[{ id: 'p', label: 'Perioada' }, { id: 'y', label: 'Anul curent' }]} />
        <div className="gauge-wrap">
          <Gauge value={rate} target={target} />
          <div className={'gauge-val ' + (rate === null ? '' : rate >= target ? 'good' : rate < 0 ? 'bad' : 'warn')}>
            <b className="num">{rate === null ? '–' : `${String(rate).replace('.', ',')}%`}</b>
            <span>rata de economisire</span>
          </div>
        </div>
        <div className="trio">
          <div><span>Venituri</span><b className="num in">{fmtNum(base.income)}</b></div>
          <div><span>Cheltuieli</span><b className="num">{fmtNum(base.spent)}</b></div>
          <div><span>Rămas</span><b className={'num ' + (base.income - base.spent >= 0 ? 'save' : 'bad')}>{fmtNum(base.income - base.spent)}</b></div>
        </div>
        <p className="note">Ținta ta: {target}% din venituri să rămână. O schimbi în Finanțe.</p>
      </section>

      <section id="recomandari">
        <h2>Recomandări</h2>
        <div className="recos">
          {recos.map((r, i) => (
            <div key={i} className={'reco ' + r.tone}><b>{r.title}</b><p>{r.text}</p></div>
          ))}
        </div>
      </section>

      <section id="compara" className="card">
        <h2>Compară</h2>
        <Seg label="Compară cu" value={cmp} onChange={setCmp} options={[{ id: 'prev', label: 'Luna trecută' }, { id: 'year', label: 'Acum un an' }]} />
        <p className="note">{periodLabel(period, pd)} față de {periodLabel(shiftPeriod(period, cmp === 'prev' ? -1 : -12, pd), pd)}</p>
        <div className="cmp-total">
          <span>Total cheltuieli</span>
          <b className="num">{fmtNum(cur.spent)}</b>
          <Delta d={cur.spent - ref.spent} />
        </div>
        {cmpRows.length ? (
          <div className="cmp-list">
            <div className="cmp-row cmp-head"><span>Categorie</span><span>{cmp === 'prev' ? 'Trecut' : 'Acum 1 an'}</span><span>Acum</span><span>Diferență</span></div>
            {cmpRows.map(({ c, a, b }) => (
              <div key={c.id} className="cmp-row">
                <span className="cmp-name"><Icon name={c.icon} size={15} /><span className="ell">{c.name}</span></span>
                <span className="num muted">{fmtNum(b)}</span>
                <span className="num">{fmtNum(a)}</span>
                <Delta d={a - b} />
              </div>
            ))}
          </div>
        ) : <p className="empty-line">Încă nu sunt date de comparat.</p>}
      </section>

      <section className="card">
        <h2>Rapoarte</h2>
        <p className="note">Venituri și cheltuieli în ultimele 12 perioade</p>
        {hasHistory ? <BarsChart rows={series.map(x => ({ label: x.label, a: x.s.income, b: x.s.spent }))} />
          : <div className="chart-empty">Graficul apare după ce ai cel puțin două luni de date.</div>}
        <div className="legend"><span><i style={{ background: 'var(--in)' }} />venituri</span><span><i style={{ background: 'var(--out-bar)' }} />cheltuieli</span></div>

        <label className="field" style={{ marginTop: 14 }}>Evoluția pe categorie
          <select id="rep-cat" value={repCat} onChange={e => setRepCat(e.target.value)}>
            <option value="">Toate cheltuielile</option>
            {st.categories.filter(c => c.kind === 'out').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <LineChart points={catPoints} target={repCategory?.allocated || (repCat ? undefined : cur.totalBudget || undefined)} />
        <p className="note">Linia punctată e ținta (limita lunară).</p>
      </section>
    </div>
  )
}

function Delta({ d }: { d: number }) {
  if (d === 0) return <span className="delta"><Minus size={14} />0,00</span>
  const up = d > 0
  return <span className={'delta ' + (up ? 'bad' : 'in')}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}<span className="num">{fmtSigned(d).replace(' lei', '')}</span></span>
}
