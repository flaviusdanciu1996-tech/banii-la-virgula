import { useEffect, useMemo, useState } from 'react'
import { Star, RefreshCw, Sparkles, Info, NotebookPen } from 'lucide-react'
import { useStore } from '../store.tsx'
import { supabase, DEMO } from '../db.ts'
import { Sheet, Seg } from '../ui.tsx'
import { weeklyCandles, score, passesRules, backtest, indexAt, isoOf, LABELS, STRATEGIES, marketReturns, setMarket, type StockData, type Score, type Rules, type StrategyId } from '../lib/radar.ts'
import { xirr } from '../lib/fi.ts'
import { demoStocks } from '../demoMarket.ts'
import type { Nav } from '../App.tsx'

const n1 = (x: number | null | undefined, d = 1) => (x == null ? '–' : x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d }))
const pctTxt = (x: number | null | undefined) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${n1(x)}%`)
const LABEL_COLOR = { buy: 'var(--good, #22C55E)', neutral: '#EAB308', hot: '#F97316', avoid: 'var(--bad, #EF4444)' } as const

let cache: { at: number; stocks: StockData[] } | null = null
export function useMarket() {
  const [stocks, setStocks] = useState<StockData[] | null>(cache?.stocks ?? null)
  const [err, setErr] = useState('')
  async function load(force = false) {
    if (!force && cache && Date.now() - cache.at < 10 * 60_000) { setStocks(cache.stocks); return }
    if (DEMO || !supabase) { cache = { at: Date.now(), stocks: demoStocks() }; setMarket(marketReturns(cache.stocks.filter(s => !/ETF/.test(s.symbol)))); setStocks(cache.stocks); return }
    const { data, error } = await supabase.from('market_stocks').select('*')
    if (error) { setErr('Nu am putut încărca datele bursei.'); return }
    const list = (data ?? []).map((r: any) => ({ ...r, per: num(r.per), pbv: num(r.pbv), eps: num(r.eps), divy: num(r.divy), mcap: num(r.mcap) })) as StockData[]
    cache = { at: Date.now(), stocks: list.filter(s => s.t?.length > 30) }
    setMarket(marketReturns(cache.stocks.filter(s => !/ETF/.test(s.symbol))))
    setStocks(cache.stocks)
  }
  useEffect(() => { load() }, [])
  return { stocks, err, reload: () => load(true) }
}
const num = (v: unknown) => (v == null ? null : Number(v))

type Tab = 'top' | 'rules' | 'test'

export function RadarScreen({ nav, notify }: { nav: Nav; notify: (m: string) => void }) {
  const st = useStore()
  const { stocks, err, reload } = useMarket()
  const [tab, setTab] = useState<Tab>('top')
  const [filter, setFilter] = useState<'all' | 'mine' | 'watch' | 'rules'>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const radar = st.settings.radar ?? {}
  const rules: Rules = radar.rules ?? {}
  const watch = new Set(radar.watch ?? [])
  const mine = new Set(st.assets.flatMap(a => a.holdings ?? []).map(h => h.symbol))

  const scored = useMemo(() => (stocks ?? []).filter(s => s.t.length >= 220).map(s => ({ s, sc: score(s) }))
    .sort((a, b) => b.sc.total - a.sc.total), [stocks])
  const shown = scored.filter(x => filter === 'all' || (filter === 'mine' && mine.has(x.s.symbol)) || (filter === 'watch' && watch.has(x.s.symbol)) || (filter === 'rules' && passesRules(x.s, x.sc, rules).ok))
  const lastDay = scored.length ? Math.max(...scored.map(x => x.s.t[x.s.t.length - 1])) : null

  async function saveRadar(p: Partial<typeof radar>) { await st.saveSettings({ radar: { ...radar, ...p } }) }
  async function toggleWatch(sym: string) {
    const w = new Set(watch); w.has(sym) ? w.delete(sym) : w.add(sym)
    await saveRadar({ watch: [...w] }); notify(w.has(sym) ? `Urmărești ${sym}` : `Nu mai urmărești ${sym}`)
  }
  async function refresh() {
    if (!supabase || DEMO) return
    setBusy(true)
    try { await supabase.functions.invoke('market-radar', { body: { alerts: false } }); await reload(); notify('Date actualizate') }
    catch { notify('Nu am putut actualiza acum.') } finally { setBusy(false) }
  }

  return (
    <div className="screen">
      <Seg label="Secțiune" value={tab} onChange={setTab} options={[{ id: 'top', label: 'Clasament' }, { id: 'rules', label: 'Regulile mele' }, { id: 'test', label: 'Test pe trecut' }]} />
      {err && <p className="err">{err}</p>}
      {!stocks && !err && <p className="muted">Încarc datele bursei…</p>}
      {stocks && !scored.length && <div className="card"><p>Datele bursei se adună chiar acum (prima dată durează 1–2 minute).</p><button type="button" className="ghost-btn" onClick={reload}><RefreshCw size={16} />Reîncarcă</button></div>}

      {tab === 'top' && scored.length > 0 && <>
        <p className="muted small radar-note"><Info size={13} /> Prețuri de la închiderea din {lastDay ? isoOf(lastDay).split('-').reverse().join('.') : '–'}. Scorul arată unde șansele par de partea ta, nu ce va urma sigur.</p>
        <div className="chips radar-filter">
          {([['all', 'Toate'], ['mine', 'Ale mele'], ['watch', '☆ Urmărite'], ['rules', 'Trec regulile mele']] as const).map(([id, t]) =>
            <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{t}</button>)}
        </div>
        <div className="rows">
          {shown.map(({ s, sc }) => <RadarRow key={s.symbol} s={s} sc={sc} mine={mine.has(s.symbol)} watched={watch.has(s.symbol)} onOpen={() => setOpen(s.symbol)} />)}
          {!shown.length && <p className="muted">Nicio acțiune aici încă.</p>}
        </div>
        {!DEMO && <button type="button" className="ghost-btn wide" disabled={busy} onClick={refresh}><RefreshCw size={16} />{busy ? 'Actualizez…' : 'Actualizează acum'}</button>}
      </>}

      {tab === 'rules' && <RulesTab rules={rules} alerts={radar.alerts !== false} scored={scored} save={saveRadar} notify={notify} />}
      {tab === 'test' && <BacktestTab stocks={(stocks ?? []).filter(s => s.symbol !== 'TVBETETF')} />}

      {open && (() => {
        const x = scored.find(y => y.s.symbol === open)
        return x ? <StockSheet s={x.s} sc={x.sc} rules={rules} watched={watch.has(open)} mine={mine.has(open)} onWatch={() => toggleWatch(open)} onAsk={() => { setOpen(null); nav('asistent', { q: `Analizează ${open}` }) }} onJournal={() => { setOpen(null); nav('jurnal', { symbol: open }) }} onClose={() => setOpen(null)} /> : null
      })()}
    </div>
  )
}

function ScoreBadge({ sc, size = 46 }: { sc: Score; size?: number }) {
  const c = LABEL_COLOR[sc.label], r = size / 2 - 4, L = 2 * Math.PI * r
  return (
    <span className="score-badge" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth="5" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={c} strokeWidth="5" fill="none" strokeDasharray={`${(L * sc.total) / 100} ${L}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg>
      <b>{sc.total}</b>
    </span>
  )
}

function RadarRow({ s, sc, mine, watched, onOpen }: { s: StockData; sc: Score; mine: boolean; watched: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="row radar-row" onClick={onOpen}>
      <ScoreBadge sc={sc} />
      <span className="row-main">
        <b>{s.symbol}{mine && <span className="tag">am</span>}{watched && <Star size={12} className="star" />}</b>
        <span className="muted small">{(s.name || '').replace(/ S\.?A\.?$/i, '').slice(0, 28)}</span>
        <span className="small radar-meta"><span style={{ color: LABEL_COLOR[sc.label] }}>{LABELS[sc.label].emoji} {LABELS[sc.label].text}</span> · div {n1(sc.ind.divYield)}% · P/E {n1(s.per)}</span>
      </span>
      <span className="row-side"><b className="num">{n1(sc.ind.price, sc.ind.price < 10 ? 3 : 2)}</b><span className={'small num ' + ((sc.ind.ret1y ?? 0) >= 0 ? 'in' : 'bad')}>{pctTxt(sc.ind.ret1y)} / an</span></span>
    </button>
  )
}

/** Line (price + 200-day average) or weekly Japanese candles, like on TradingView. */
function ChartBox({ s }: { s: StockData }) {
  const hasOhlc = !!s.o?.length
  const [mode, setMode] = useState<'line' | 'candles'>('candles')
  return (
    <div className="chart-box">
      <Seg label="Tip grafic" value={mode} onChange={setMode} options={[{ id: 'candles', label: 'Lumânări (săptămâni)' }, { id: 'line', label: 'Linie + media 200' }]} />
      {mode === 'line' ? <PriceChart s={s} /> : hasOhlc ? <CandleChart s={s} /> : <p className="muted small">Lumânările apar după următoarea actualizare a bursei.</p>}
    </div>
  )
}

function CandleChart({ s }: { s: StockData }) {
  const W = 340, H = 190, padL = 4, padR = 40, top = 8, volH = 30
  const cs = weeklyCandles(s, s.t[s.t.length - 1] - 7 * 52)
  const [sel, setSel] = useState<number>(cs.length - 1)
  if (cs.length < 2) return null
  const hi = Math.max(...cs.map(k => k.h)), lo = Math.min(...cs.map(k => k.l)), vmax = Math.max(...cs.map(k => k.v)) || 1
  const priceH = H - top - volH - 16
  const step = (W - padL - padR) / cs.length, bw = Math.max(2, step * 0.62)
  const X = (i: number) => padL + step * i + step / 2
  const Y = (v: number) => top + (1 - (v - lo) / (hi - lo || 1)) * priceH
  const d = (v: number) => n1(v, v < 10 ? 3 : 2)
  const k = cs[Math.min(sel, cs.length - 1)]
  const up = k.c >= k.o
  const ticks = [hi, (hi + lo) / 2, lo]
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart candles" role="img" aria-label="Lumânări japoneze săptămânale pe un an">
        {ticks.map(t => <g key={t}><line x1={padL} x2={W - padR} y1={Y(t)} y2={Y(t)} stroke="var(--line, rgba(127,127,127,.18))" strokeWidth="1" /><text x={W - padR + 4} y={Y(t) + 3} fontSize="9" fill="var(--muted)">{d(t)}</text></g>)}
        {cs.map((c, i) => {
          const g = c.c >= c.o, col = g ? 'var(--good, #22C55E)' : 'var(--bad, #EF4444)'
          const y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c))
          return (
            <g key={c.day} onClick={() => setSel(i)} style={{ cursor: 'pointer' }} opacity={i === sel ? 1 : 0.85}>
              <rect x={X(i) - step / 2} y={top} width={step} height={H - top} fill={i === sel ? 'rgba(127,127,127,.12)' : 'transparent'} />
              <line x1={X(i)} x2={X(i)} y1={Y(c.h)} y2={Y(c.l)} stroke={col} strokeWidth="1" />
              <rect x={X(i) - bw / 2} y={y1} width={bw} height={Math.max(1, y2 - y1)} fill={col} rx="0.5" />
              <rect x={X(i) - bw / 2} y={H - 14 - (c.v / vmax) * volH} width={bw} height={(c.v / vmax) * volH} fill="var(--muted)" opacity="0.35" />
            </g>
          )
        })}
        <text x={padL} y={H - 2} fontSize="9" fill="var(--muted)">{isoOf(cs[0].day).slice(0, 7).split('-').reverse().join('.')}</text>
        <text x={W - padR} y={H - 2} fontSize="9" fill="var(--muted)" textAnchor="end">fiecare lumânare = o săptămână</text>
      </svg>
      <div className={'candle-info ' + (up ? 'up' : 'down')}>
        <b>Săpt. din {isoOf(k.day).split('-').reverse().join('.')} · {up ? 'a urcat' : 'a coborât'} {pctTxt((k.c / k.o - 1) * 100)}</b>
        <div className="ohlc">
          <span>Deschidere <b className="num">{d(k.o)}</b></span><span>Închidere <b className="num">{d(k.c)}</b></span>
          <span>Maxim <b className="num">{d(k.h)}</b></span><span>Minim <b className="num">{d(k.l)}</b></span>
        </div>
        <span className="muted small">Corp {d(Math.abs(k.c - k.o))} · umbra de sus {d(k.h - Math.max(k.o, k.c))} · umbra de jos {d(Math.min(k.o, k.c) - k.l)}. Atinge o lumânare ca s-o vezi.</span>
      </div>
    </>
  )
}

/** Price over the last year with the 200-day average. */
function PriceChart({ s }: { s: StockData }) {
  const W = 340, H = 150, pad = 8
  const end = s.t.length - 1, start = Math.max(0, indexAt(s, s.t[end] - 365))
  const pts = s.a.slice(start, end + 1)
  const ma = pts.map((_, k) => { const i = start + k; if (i < 199) return null; let x = 0; for (let j = i - 199; j <= i; j++) x += s.a[j]; return x / 200 })
  const all = [...pts, ...ma.filter((v): v is number => v != null)]
  const lo = Math.min(...all), hi = Math.max(...all)
  const X = (k: number) => pad + (k * (W - 2 * pad)) / Math.max(1, pts.length - 1)
  const Y = (v: number) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * pad - 14)
  const line = (arr: (number | null)[]) => arr.map((v, k) => (v == null ? '' : `${arr[k - 1] == null ? 'M' : 'L'}${X(k).toFixed(1)},${Y(v).toFixed(1)}`)).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Prețul pe un an și media de 200 de zile">
      <path d={line(ma)} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={line(pts)} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" />
      <text x={pad} y={H - 2} fontSize="10" fill="var(--muted)">{isoOf(s.t[start]).slice(0, 7).split('-').reverse().join('.')}</text>
      <text x={W - pad} y={H - 2} fontSize="10" fill="var(--muted)" textAnchor="end">azi · linia punctată = media 200 zile</text>
    </svg>
  )
}

function StockSheet({ s, sc, rules, watched, mine, onWatch, onAsk, onJournal, onClose }: { s: StockData; sc: Score; rules: Rules; watched: boolean; mine: boolean; onWatch: () => void; onAsk: () => void; onJournal: () => void; onClose: () => void }) {
  const pr = passesRules(s, sc, rules)
  const hasRules = Object.values(rules).some(v => v != null && v !== false)
  const part = (v: number, max: number, t: string) => <div className="sc-part"><span>{t}</span><span className="sc-bar"><i style={{ width: (v / max) * 100 + '%' }} /></span><b className="num">{v}/{max}</b></div>
  return (
    <Sheet title={`${s.symbol} · ${(s.name || '').replace(/ S\.?A\.?$/i, '')}`} onClose={onClose}>
      <div className="stock-head">
        <ScoreBadge sc={sc} size={64} />
        <div><b style={{ color: LABEL_COLOR[sc.label] }}>{LABELS[sc.label].emoji} {LABELS[sc.label].text}</b><span className="muted small">Preț {n1(sc.ind.price, sc.ind.price < 10 ? 3 : 2)} lei · {pctTxt(sc.ind.ret1y)} într-un an (cu dividende)</span></div>
      </div>
      <ChartBox s={s} />
      <div className="sc-parts">{part(sc.fund, 40, 'Fundamental')}{part(sc.tech, 40, 'Tehnic')}{part(sc.risk, 20, 'Risc')}</div>
      <ul className="reasons">{sc.reasons.map((r, i) => <li key={i} className={r.good === true ? 'good' : r.good === false ? 'bad' : ''}>{r.good === true ? '✓' : r.good === false ? '✗' : '•'} {r.text}</li>)}</ul>
      <div className="inv-grid">
        <div><span>P/E</span><b className="num">{n1(s.per)}</b></div>
        <div><span>P/BV</span><b className="num">{n1(s.pbv, 2)}</b></div>
        <div><span>Dividend</span><b className="num">{n1(sc.ind.divYield)}%</b></div>
        <div><span>RSI (14)</span><b className="num">{n1(sc.ind.rsi, 0)}</b></div>
        <div><span>Media 50 / 200</span><b className="num">{n1(sc.ind.ma50, 2)} / {n1(sc.ind.ma200, 2)}</b></div>
        <div><span>Minim–maxim 1 an</span><b className="num">{n1(sc.ind.lo52, 2)}–{n1(sc.ind.hi52, 2)}</b></div>
        <div><span>Volatilitate</span><b className="num">{n1(sc.ind.vol, 0)}%/an</b></div>
        <div><span>Cea mai mare cădere (1 an)</span><b className="num bad">{n1(sc.ind.dd, 0)}%</b></div>
        <div><span>ROE (profit / capital)</span><b className="num">{sc.ind.roe == null ? '–' : n1(sc.ind.roe) + '%'}</b></div>
        <div><span>Beta (față de bursă)</span><b className="num">{n1(sc.ind.beta, 2)}</b></div>
        <div><span>MACD</span><b className={'num ' + (sc.ind.macd ? (sc.ind.macd.hist > 0 ? 'in' : 'bad') : '')}>{sc.ind.macd ? `${sc.ind.macd.hist > 0 ? 'pozitiv' : 'negativ'}${sc.ind.macd.rising ? ' ↗' : ' ↘'}` : '–'}</b></div>
        <div><span>Bollinger (20 zile)</span><b className="num">{sc.ind.boll ? `${Math.round(sc.ind.boll.pctB * 100)}% din bandă` : '–'}</b></div>
        <div><span>Volum față de normal</span><b className="num">{sc.ind.volRatio == null ? '–' : n1(sc.ind.volRatio) + '×'}</b></div>
      </div>
      <details className="explain"><summary>Ce înseamnă indicatorii?</summary>
        <p><b>P/E</b> — de câți ani de profit plătești prețul. Mic = ieftin. <b>P/BV</b> — preț față de valoarea din bilanț. <b>ROE</b> — cât profit face firma din 100 de lei capital propriu. <b>Dividend</b> — cât îți dă pe an, în % din preț.</p>
        <p><b>Media 50/200</b> — prețul mediu pe 50 și 200 de zile; peste ele = trend de creștere. <b>RSI</b> — sub 30 a scăzut mult, peste 70 a crescut prea repede. <b>MACD</b> — dacă impulsul e de creștere sau de scădere. <b>Bollinger</b> — 0% = la marginea de jos a mișcării obișnuite, 100% = la marginea de sus.</p>
        <p><b>Volatilitate</b> — cât de tare se mișcă pe an. <b>Beta</b> — 1 = se mișcă exact ca bursa, sub 1 mai calm, peste 1 mai agitat. <b>Volum</b> — cât de mult se tranzacționează acum față de de obicei.</p>
      </details>
      {hasRules && <p className={'note ' + (pr.ok ? 'in' : '')}>{pr.ok ? '✓ Trece regulile tale.' : `Nu trece regulile tale: ${pr.fails.join(', ')}.`}</p>}
      <div className="actions">
        <button type="button" className="ghost-btn" onClick={onWatch}><Star size={16} />{watched ? 'Nu mai urmări' : mine ? 'O ai deja · urmărește' : 'Urmărește'}</button>
        <button type="button" className="primary" onClick={onAsk}><Sparkles size={16} />Întreabă asistentul</button>
      </div>
      <button type="button" className="ghost-btn wide" onClick={onJournal}><NotebookPen size={16} />Scrie o ipoteză în jurnal</button>
      <p className="hint">Instrument de analiză, nu recomandare de investiții. Decizia îți aparține.</p>
    </Sheet>
  )
}

function RulesTab({ rules, alerts, scored, save, notify }: { rules: Rules; alerts: boolean; scored: { s: StockData; sc: Score }[]; save: (p: any) => Promise<void>; notify: (m: string) => void }) {
  const [r, setR] = useState<Rules>(rules)
  const [al, setAl] = useState(alerts)
  const pass = scored.filter(x => passesRules(x.s, x.sc, r).ok)
  const numField = (key: keyof Rules, label: string, ph: string) => (
    <label className="field">{label}
      <input inputMode="decimal" placeholder={ph} value={r[key] == null ? '' : String(r[key]).replace('.', ',')} onChange={e => { const v = e.target.value.replace(',', '.'); setR({ ...r, [key]: v === '' ? null : Number(v) }) }} />
    </label>
  )
  return (
    <section className="card form">
      <h2>Strategia ta</h2>
      <p className="hint">Pune doar ce contează pentru tine. Câmpurile goale nu se aplică.</p>
      <div className="two">{numField('minDiv', 'Dividend minim (%)', 'ex. 6')}{numField('maxPer', 'P/E maxim', 'ex. 10')}</div>
      <div className="two">{numField('maxPbv', 'P/BV maxim', 'ex. 1,5')}{numField('maxRsi', 'RSI maxim', 'ex. 60')}</div>
      <div className="two">{numField('minScore', 'Scor minim', 'ex. 60')}{numField('minRoe', 'ROE minim (%)', 'ex. 15')}</div>
      {numField('maxBeta', 'Beta maxim', 'ex. 1')}
      <label className="switch">Doar cu MACD pozitiv (impuls de creștere)<input type="checkbox" checked={!!r.macdUp} onChange={e => setR({ ...r, macdUp: e.target.checked })} /></label>
      <label className="switch">Doar lângă banda de jos Bollinger (ieftină pe termen scurt)<input type="checkbox" checked={!!r.nearLowBand} onChange={e => setR({ ...r, nearLowBand: e.target.checked })} /></label>
      <label className="switch">Doar peste media de 200 de zile (trend de creștere)<input type="checkbox" checked={!!r.aboveMa200} onChange={e => setR({ ...r, aboveMa200: e.target.checked })} /></label>
      <label className="switch">Alerte pe telefon (ce ai și ce urmărești)<input type="checkbox" checked={al} onChange={e => setAl(e.target.checked)} /></label>
      <p className="note">Azi trec regulile: <b>{pass.length ? pass.map(x => x.s.symbol).join(', ') : 'nicio acțiune'}</b></p>
      <button type="button" className="primary" onClick={async () => { await save({ rules: r, alerts: al }); notify('Regulile sunt salvate') }}>Salvează regulile</button>
      <p className="hint">Exemplu de strategie de dividend: dividend minim 6%, P/E maxim 10, doar peste media de 200. Aici adăugăm și regulile din lecțiile colegului tău.</p>
    </section>
  )
}

function BacktestTab({ stocks }: { stocks: StockData[] }) {
  const st = useStore()
  const [years, setYears] = useState<'3' | '5'>('5')
  const [top, setTop] = useState<'1' | '3' | '5'>('5')
  const [strat, setStrat] = useState<StrategyId>('radar')
  const monthly = 1000
  const res = useMemo(() => {
    if (!stocks.length) return null
    const end = Math.max(...stocks.map(s => s.t[s.t.length - 1]))
    const start = end - Number(years) * 365
    const r = backtest(stocks, start, end, monthly, Number(top), strat)
    const flows = r.radar.series.map(p => ({ d: isoOf(p.day), amt: monthly * 100 }))
    return { r, end, x1: xirr(flows, Math.round(r.radar.value * 100), isoOf(end)), x2: xirr(flows, Math.round(r.equal.value * 100), isoOf(end)) }
  }, [stocks, years, top, strat])
  void st
  if (!res) return <p className="muted">Încarc datele…</p>
  const { r } = res
  const W = 340, H = 150, pad = 8
  const all = [...r.radar.series.map(p => p.value), ...r.equal.series.map(p => p.value), ...r.radar.series.map((_, k) => (k + 1) * monthly)]
  const hi = Math.max(...all, 1)
  const X = (k: number) => pad + (k * (W - 2 * pad)) / Math.max(1, r.radar.series.length - 1)
  const Y = (v: number) => pad + (1 - v / hi) * (H - 2 * pad)
  const path = (vals: number[]) => vals.map((v, k) => `${k ? 'L' : 'M'}${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join('')
  const gain = (v: number) => (r.invested ? Math.round(((v - r.invested) / r.invested) * 1000) / 10 : 0)
  const lei = (v: number) => Math.round(v).toLocaleString('ro-RO')
  return (
    <section className="card">
      <h2>Dacă urmai o strategie</h2>
      <div className="chips">{(Object.keys(STRATEGIES) as StrategyId[]).map(k => <button key={k} type="button" className="chip" aria-pressed={strat === k} onClick={() => setStrat(k)}>{STRATEGIES[k].name}</button>)}</div>
      <p className="hint">În fiecare lună pui {monthly.toLocaleString('ro-RO')} lei. <b>{STRATEGIES[strat].name}</b>: în primele {top} acțiuni din acea zi — {STRATEGIES[strat].about} (doar cu datele știute atunci). <b>Toate</b>: în toate acțiunile din Radar, în părți egale.</p>
      <Seg label="Perioada" value={years} onChange={setYears} options={[{ id: '3', label: '3 ani' }, { id: '5', label: '5 ani' }]} />
      <Seg label="Câte acțiuni" value={top} onChange={setTop} options={[{ id: '1', label: 'Top 1' }, { id: '3', label: 'Top 3' }, { id: '5', label: 'Top 5' }]} />
      <div className="bt-grid">
        <div><span>Ai fi pus</span><b className="num">{lei(r.invested)} lei</b></div>
        <div><span>{STRATEGIES[strat].name}</span><b className="num in">{lei(r.radar.value)} lei</b><em className="small">{gain(r.radar.value) >= 0 ? '+' : ''}{n1(gain(r.radar.value))}% · {res.x1 != null ? `${n1(res.x1 * 100)}%/an` : ''}</em></div>
        <div><span>Toate, egal</span><b className="num">{lei(r.equal.value)} lei</b><em className="small">{gain(r.equal.value) >= 0 ? '+' : ''}{n1(gain(r.equal.value))}% · {res.x2 != null ? `${n1(res.x2 * 100)}%/an` : ''}</em></div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Valoarea în timp: Radar față de la grămadă">
        <path d={path(r.radar.series.map((_, k) => (k + 1) * monthly))} fill="none" stroke="var(--muted)" strokeWidth="1.2" strokeDasharray="3 4" />
        <path d={path(r.equal.series.map(p => p.value))} fill="none" stroke="#94A3B8" strokeWidth="2" />
        <path d={path(r.radar.series.map(p => p.value))} fill="none" stroke="var(--accent)" strokeWidth="2.6" />
      </svg>
      <div className="legend"><span><i style={{ background: 'var(--accent)' }} />{STRATEGIES[strat].name}</span><span><i style={{ background: '#94A3B8' }} />Toate, egal</span><span><i style={{ background: 'var(--muted)' }} />Bani puși</span></div>
      <p className={'note ' + (r.radar.value >= r.equal.value ? 'in' : 'bad')}>{r.radar.value >= r.equal.value ? `Strategia ar fi adus cu ${lei(r.radar.value - r.equal.value)} lei mai mult decât toate, în părți egale.` : `Strategia ar fi adus cu ${lei(r.equal.value - r.radar.value)} lei mai puțin decât dacă puneai în toate, în părți egale. Pe BVB, diversificarea a fost greu de bătut.`}</p>
      {r.radar.picks.length > 0 && <p className="hint">Luna asta ar alege: <b>{r.radar.picks[r.radar.picks.length - 1].symbols.join(', ')}</b></p>}
      <p className="hint">Prețurile includ dividendele reinvestite. P/E și P/BV nu se știu pentru trecut, așa că testul folosește dividendul, partea tehnică și riscul. Rezultatele din trecut nu garantează viitorul.</p>
    </section>
  )
}
