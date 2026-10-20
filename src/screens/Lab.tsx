import { useEffect, useMemo, useState } from 'react'
import { FlaskConical, CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import { Seg } from '../ui.tsx'
import { LAB, runLab, eventStudy, marketIndex, type EventStats, type LabResult } from '../lib/lab.ts'
import type { StockData } from '../lib/radar.ts'

const n1 = (x: number | null | undefined, d = 1) => (x == null ? '–' : x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d }))
const sgn = (x: number) => `${x >= 0 ? '+' : ''}${n1(x)}%`
const lei = (v: number) => Math.round(v).toLocaleString('ro-RO')

// The Radar score and "dividend + trend" rank every stock; as signals we take only the strong cases.
const SIGNAL: Record<string, (s: StockData, i: number) => number | null> = Object.fromEntries(LAB.map(x => [x.id,
  x.id === 'radar' ? (s: StockData, i: number) => { const v = x.rank(s, i); return v != null && v >= 65 ? v : null }
    : x.id === 'divtrend' ? (s: StockData, i: number) => { const v = x.rank(s, i); return v != null && v >= 5 ? v : null }
    : x.rank]))
const TESTED = ['volbreak', 'ema', 'ciprian', 'bbrsi', 'radar', 'divtrend']

type Study = Record<string, { events: number; stats: EventStats[] }>
let cache: { key: string; study: Study } | null = null

function verdict(s: EventStats | undefined) {
  if (!s || s.n < 15) return { icon: <MinusCircle size={16} />, cls: '', text: 'prea puține cazuri' }
  if (s.avgExcess >= 3 && s.beatRate >= 52) return { icon: <CheckCircle2 size={16} />, cls: 'in', text: 'a bătut bursa' }
  if (s.avgExcess <= -2) return { icon: <XCircle size={16} />, cls: 'bad', text: 'mai slab ca bursa' }
  return { icon: <MinusCircle size={16} />, cls: '', text: 'cam cât bursa' }
}

export function LabTab({ stocks }: { stocks: StockData[] }) {
  const [study, setStudy] = useState<Study | null>(cache?.study ?? null)
  const key = stocks.map(s => s.symbol + s.t[s.t.length - 1]).join()
  useEffect(() => {
    if (cache?.key === key) { setStudy(cache.study); return }
    setStudy(null)
    // Heavy: run after the screen has painted, one method at a time.
    const m = marketIndex(stocks), out: Study = {}
    let k = 0
    const next = () => {
      if (k >= TESTED.length) { cache = { key, study: out }; setStudy({ ...out }); return }
      const id = TESTED[k++]
      out[id] = eventStudy(stocks, SIGNAL[id], m, [21, 63, 126, 252], 20, id === 'radar' || id === 'divtrend' ? 10 : 2)
      setTimeout(next, 0)
    }
    const t = setTimeout(next, 50)
    return () => clearTimeout(t)
  }, [key])

  // Which stocks fire each signal today.
  const today = useMemo(() => Object.fromEntries(TESTED.map(id => [id, stocks.filter(s => !/ETF/.test(s.symbol) && s.t.length > 260 && SIGNAL[id](s, s.t.length - 1) != null).map(s => s.symbol)])), [stocks])

  return (
    <>
      <section className="card">
        <h2><FlaskConical size={18} /> Funcționează metoda la BVB?</h2>
        <p className="hint">Pentru fiecare metodă, aplicația a căutat <b>toate momentele din ultimii ~6 ani</b> când regula s-ar fi aprins pe o acțiune și s-a uitat ce a făcut acțiunea după aceea, <b>față de toată bursa</b> în aceeași perioadă.</p>
        {!study && <p className="muted">Calculez pe istoric… (câteva secunde)</p>}
        {study && (
          <div className="lab-list">
            {[...TESTED].sort((a, b) => (study[b]?.stats[3]?.avgExcess ?? -99) - (study[a]?.stats[3]?.avgExcess ?? -99)).map(id => {
              const meta = LAB.find(x => x.id === id)!
              const st = study[id], y = st.stats[3], h = st.stats[2], v = verdict(y)
              return (
                <div key={id} className="lab-row">
                  <div className="lab-top">
                    <b>{meta.name}</b>
                    <span className={'lab-verdict ' + v.cls}>{v.icon}{v.text}</span>
                  </div>
                  <span className="muted small">{meta.about} · <i>{meta.source}</i></span>
                  <div className="lab-nums">
                    <div><span>După 6 luni</span><b className={'num ' + (h.avgExcess >= 0 ? 'in' : 'bad')}>{sgn(h.avgExcess)}</b><em>față de bursă</em></div>
                    <div><span>După 12 luni</span><b className={'num ' + (y.avgExcess >= 0 ? 'in' : 'bad')}>{sgn(y.avgExcess)}</b><em>față de bursă</em></div>
                    <div><span>A bătut bursa</span><b className="num">{y.beatRate}%</b><em>din cazuri</em></div>
                    <div><span>Cazuri</span><b className="num">{st.events}</b><em>în 6 ani</em></div>
                  </div>
                  {today[id]?.length > 0 && <span className="small lab-now">Semnal acum: <b>{today[id].slice(0, 8).join(', ')}</b>{today[id].length > 8 ? ` +${today[id].length - 8}` : ''}</span>}
                </div>
              )
            })}
          </div>
        )}
        <p className="hint">Cum citești: „+5% față de bursă după 12 luni” = în medie, acțiunea a urcat cu 5 puncte procentuale mai mult decât toată bursa. „A bătut bursa 55%” = în 55 din 100 de cazuri. Peste 50% și cu medie pozitivă = metoda are un avantaj. Fără comisioane; doar acțiunile din Radar de azi (cele care au dispărut de pe bursă nu apar); 2020–2026 a fost o perioadă bună pentru BVB.</p>
      </section>
      <MonthlySim stocks={stocks} />
    </>
  )
}

function MonthlySim({ stocks }: { stocks: StockData[] }) {
  const [years, setYears] = useState<'3' | '5'>('5')
  const [top, setTop] = useState<'3' | '5'>('3')
  const [sel, setSel] = useState('volbreak')
  const [res, setRes] = useState<LabResult | null>(null)
  useEffect(() => { setRes(null); const t = setTimeout(() => setRes(runLab(stocks, Number(years), Number(top), 1000)), 30); return () => clearTimeout(t) }, [stocks, years, top])
  const row = res?.rows.find(r => r.id === sel)
  const W = 340, H = 150, pad = 8
  const chart = useMemo(() => {
    if (!res || !row) return null
    const s1 = row.series.map(p => p.value), s2 = res.equal.series.map(p => p.value), put = s1.map((_, k) => (k + 1) * 1000)
    const hi = Math.max(...s1, ...s2, ...put, 1)
    const X = (k: number) => pad + (k * (W - 2 * pad)) / Math.max(1, s1.length - 1)
    const Y = (v: number) => pad + (1 - v / hi) * (H - 2 * pad)
    const path = (vals: number[]) => vals.map((v, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join('')
    return { a: path(s1), b: path(s2), c: path(put) }
  }, [res, row])
  return (
    <section className="card">
      <h2>Dacă puneai 1.000 lei pe lună</h2>
      <p className="hint">În fiecare lună, banii merg în primele {top} acțiuni pe care le alege metoda în acea zi (doar cu datele știute atunci) și rămân acolo. În lunile în care metoda nu găsește nimic, banii merg în toate acțiunile, egal.</p>
      <Seg label="Perioada" value={years} onChange={setYears} options={[{ id: '3', label: '3 ani' }, { id: '5', label: '5 ani' }]} />
      <Seg label="Câte acțiuni" value={top} onChange={setTop} options={[{ id: '3', label: 'Top 3' }, { id: '5', label: 'Top 5' }]} />
      {!res && <p className="muted">Calculez…</p>}
      {res && <>
        <div className="lab-table">
          <div className="lab-tr head"><span>Metoda</span><span>Valoare</span><span>/an</span></div>
          {[...res.rows, res.equal].sort((a, b) => b.value - a.value).map(r => (
            <button key={r.id} type="button" className={'lab-tr' + (r.id === sel ? ' sel' : '') + (r.id === 'equal' ? ' ref' : '')} onClick={() => r.id !== 'equal' && setSel(r.id)}>
              <span>{r.name}{r.id !== 'equal' && r.signalMonths < r.months ? <em className="muted"> · semnal în {r.signalMonths}/{r.months} luni</em> : null}</span>
              <span className="num">{lei(r.value)}</span>
              <span className="num">{r.perYear != null ? n1(r.perYear * 100) + '%' : '–'}</span>
            </button>
          ))}
        </div>
        <p className="hint">Ai fi pus {lei(res.invested)} lei. Atinge o metodă ca s-o vezi pe grafic.</p>
        {chart && row && <>
          <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Valoarea în timp">
            <path d={chart.c} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="3 4" />
            <path d={chart.b} fill="none" stroke="#94A3B8" strokeWidth="2" />
            <path d={chart.a} fill="none" stroke="var(--accent)" strokeWidth="2.6" />
          </svg>
          <div className="legend"><span><i style={{ background: 'var(--accent)' }} />{row.name}</span><span><i style={{ background: '#94A3B8' }} />Toate, egal</span><span><i style={{ background: 'var(--muted)' }} />Bani puși</span></div>
          <p className={'note ' + (row.value >= res.equal.value ? 'in' : 'bad')}>{row.value >= res.equal.value ? `+${lei(row.value - res.equal.value)} lei față de „toate, egal”.` : `${lei(row.value - res.equal.value)} lei față de „toate, egal”.`} Cea mai mare scădere pe drum: {n1(row.maxDrop)}%.</p>
        </>}
      </>}
    </section>
  )
}
