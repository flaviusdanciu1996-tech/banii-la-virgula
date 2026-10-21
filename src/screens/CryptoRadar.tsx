import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Zap, ArrowUp, ArrowDown, Minus, Check, X } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Sheet } from '../ui.tsx'
import { supabase, DEMO } from '../db.ts'
import { CryptoChart } from './CryptoChart.tsx'
import { ZONE_LABEL, STOCK_TOKEN, type RadarRow, type Zone, type Dir } from '../lib/cryptoRadar.ts'

const ZONES: Zone[] = ['buy', 'wait', 'watch', 'avoid']
const ZONE_ORDER: Record<Zone, number> = { buy: 0, wait: 1, watch: 2, avoid: 3 }
/** Price in USDT with sensible decimals (BTC 84.012 · DOT 5,52 · AMP 0,00083). */
export const usd = (x: number) => x >= 1000 ? x.toLocaleString('ro-RO', { maximumFractionDigits: 0 })
  : x >= 1 ? x.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
  : x.toLocaleString('ro-RO', { maximumSignificantDigits: 4 })
const pctS = (x: number | null) => (x == null ? '' : `${x >= 0 ? '+' : ''}${x.toFixed(1).replace('.', ',')}%`)
const ago = (iso?: string) => {
  if (!iso) return 'încă nu'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'acum' : m < 60 ? `acum ${m} min` : m < 1440 ? `acum ${Math.round(m / 60)} h` : `acum ${Math.round(m / 1440)} zile`
}
const DirIcon = ({ d, size = 13 }: { d: Dir; size?: number }) => d === 'up' ? <ArrowUp size={size} /> : d === 'down' ? <ArrowDown size={size} /> : <Minus size={size} />

export function CryptoRadarScreen({ notify }: { notify: (m: string) => void }) {
  const st = useStore()
  const [rows, setRows] = useState<RadarRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [zone, setZone] = useState<Zone | 'all'>('buy')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<RadarRow | null>(null)
  const mine = useMemo(() => new Set(st.assets.flatMap(a => (a.coins ?? []).map(c => c.coin))), [st.assets])

  async function load() {
    if (!supabase || DEMO) { setRows([]); return }
    const { data } = await supabase.from('crypto_radar').select('coin, d, at')
    const list = (data ?? []) as { coin: string; d: any; at: string }[]
    setTotal(list.find(r => r.coin === '__universe__')?.d?.coins?.length ?? 0)
    setRows(list.filter(r => r.coin !== '__universe__' && r.d?.zone && !STOCK_TOKEN.test(r.coin)).map(r => r.d as RadarRow))
  }
  async function refresh(silent = false) {
    if (!supabase || DEMO) return
    setBusy(true)
    try { await supabase.functions.invoke('crypto-radar', { body: {} }); await load(); if (!silent) notify('Radar actualizat (încă 20 de monede)') }
    catch { if (!silent) notify('Nu am putut actualiza acum.') }
    finally { setBusy(false) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const newest = rows?.map(r => r.at).sort().pop()
  useEffect(() => { if (rows && (!newest || Date.now() - Date.parse(newest) > 2 * 3600e3)) refresh(true) }, [rows === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => Object.fromEntries(ZONES.map(z => [z, (rows ?? []).filter(r => r.zone === z).length])) as Record<Zone, number>, [rows])
  const breakouts = (rows ?? []).filter(r => r.breakout && r.zone !== 'avoid').sort((a, b) => b.score - a.score)
  const list = (rows ?? [])
    .filter(r => (q ? r.coin.includes(q.toUpperCase()) : zone === 'all' || r.zone === zone))
    .sort((a, b) => ZONE_ORDER[a.zone] - ZONE_ORDER[b.zone] || Number(mine.has(b.coin)) - Number(mine.has(a.coin)) || b.score - a.score || b.volUsd - a.volUsd)
  const rate = st.settings.usd_rate || 4.6

  return (
    <div className="screen">
      <section className="card radar-head">
        <div className="radar-top">
          <div>
            <b>{rows?.length ?? 0}{total ? ` din ${total}` : ''} monede analizate</b>
            <span className="muted small">Binance · pe 1 oră … 1 an · {ago(newest)}</span>
          </div>
          <button type="button" className="icon-btn" aria-label="Actualizează" disabled={busy} onClick={() => refresh()}><RefreshCw size={16} className={busy ? 'spin' : ''} /></button>
        </div>
        <p className="muted small">Verdictul ține cont de tot: orele arată momentul intrării, zilele și săptămânile tendința, lunile și anul imaginea mare. Radarul se actualizează singur, câte 20 de monede la 10 minute.</p>
      </section>

      {breakouts.length > 0 && !q && (
        <section className="card brk">
          <h2><Zap size={16} /> Sparg azi</h2>
          <p className="muted small">Au trecut peste maximul pe 20 de zile cu volum mare. Verifică-le, dar intră doar după plan.</p>
          <div className="brk-list">{breakouts.slice(0, 12).map(r => <button key={r.coin} type="button" className={'chip z-' + r.zone} onClick={() => setOpen(r)}>{r.coin} <span className="num">{pctS(r.ch24)}</span></button>)}</div>
        </section>
      )}

      <label className="field radar-search"><Search size={16} /><input placeholder="Caută o monedă (ex. BTC)" value={q} onChange={e => setQ(e.target.value.trim())} /></label>
      {!q && <div className="chips radar-zones">
        {ZONES.map(z => <button key={z} type="button" className={'chip z-' + z} aria-pressed={zone === z} onClick={() => setZone(z)}>{ZONE_LABEL[z]} <span className="num">{counts[z]}</span></button>)}
        <button type="button" className="chip" aria-pressed={zone === 'all'} onClick={() => setZone('all')}>Toate</button>
      </div>}

      {rows === null ? <p className="muted">Se încarcă…</p> : !list.length ? <p className="muted">{rows.length ? 'Nicio monedă aici acum.' : 'Radarul pornește: primele monede apar în câteva minute.'}</p> : (
        <div className="rows">
          {list.map(r => (
            <button key={r.coin} type="button" className="row radar-row" onClick={() => setOpen(r)}>
              <span className="row-main">
                <b>{r.coin}{mine.has(r.coin) && <span className="mine-tag">ai</span>}</b>
                <span className="muted small num">{usd(r.price)} USDT · <span className={(r.ch24 ?? 0) >= 0 ? 'in' : 'bad'}>{pctS(r.ch24)}</span></span>
                <span className="tf-strip" aria-label="Direcția pe 1 oră … 1 an">{r.frames.map(f => <i key={f.id} className={'tf ' + f.dir} title={f.label}><DirIcon d={f.dir} size={10} /></i>)}</span>
              </span>
              <span className="row-side"><span className={'zone-badge z-' + r.zone}>{ZONE_LABEL[r.zone]}</span><span className="muted small">{r.score}/9 reguli</span></span>
            </button>
          ))}
        </div>
      )}
      <p className="hint">Nu e sfat financiar: e aplicarea regulilor noastre pe datele Binance. Crypto se mișcă repede; folosește doar bani pe care îți permiți să-i pierzi și pune mereu stop-loss-ul.</p>
      {open && <RadarSheet r={open} rate={rate} onClose={() => setOpen(null)} />}
    </div>
  )
}

function RadarSheet({ r, rate, onClose }: { r: RadarRow; rate: number; onClose: () => void }) {
  const [eur, setEur] = useState('10')
  const amount = Number(eur.replace(',', '.')) || 0
  const plan = r.zone === 'buy' || r.zone === 'wait'
  const entry = r.zone === 'buy' ? r.entryHi : (r.entryLo + r.entryHi) / 2
  const stopLimit = r.stop * 0.995
  const groups: [string, string[]][] = [['Pe termen scurt (intrarea)', ['1h', '4h', '8h']], ['Tendința', ['1d', '2d', '1w']], ['Imaginea mare', ['1M', '3M', '6M', '1y']]]
  return (
    <Sheet title={`${r.coin} · ${usd(r.price)} USDT`} onClose={onClose}>
      <div className={'verdict z-' + r.zone}><b>{ZONE_LABEL[r.zone]}</b><span>{r.note}</span></div>
      <CryptoChart coin={r.coin} plan={r} />
      <p className="muted small">≈ {(r.price * rate).toLocaleString('ro-RO', { maximumSignificantDigits: 5 })} lei · 24 h {pctS(r.ch24)} · {r.score}/9 reguli trec{r.breakout ? ' · ⚡ sparge azi' : ''}</p>

      <h3 className="sub-h">De la 1 oră la 1 an</h3>
      {groups.map(([title, ids]) => (
        <div key={title} className="tf-group">
          <span className="muted small">{title}</span>
          <div className="tf-row">{r.frames.filter(f => ids.includes(f.id)).map(f => (
            <div key={f.id} className={'tf-cell ' + f.dir}><b><DirIcon d={f.dir} /> {f.label}</b><span>{f.detail}</span></div>
          ))}</div>
        </div>
      ))}

      <h3 className="sub-h">Regulile noastre</h3>
      <ul className="rules">{r.rules.map(x => <li key={x.id} className={x.ok ? 'ok' : 'no'}>{x.ok ? <Check size={15} /> : <X size={15} />}<span><b>{x.label}</b><span className="muted small">{x.detail}</span></span></li>)}</ul>

      {plan ? <>
        <h3 className="sub-h">Planul</h3>
        <div className="coin-box">
          <div><span>{r.zone === 'buy' ? 'Cumpără între' : 'Așteaptă să coboare între'}</span><b className="num">{usd(r.entryLo)} – {usd(r.entryHi)}</b></div>
          <div><span>Stop-loss</span><b className="num bad">{usd(r.stop)} ({pctS(-r.riskPct)})</b></div>
          <div><span>Țintă</span><b className="num in">{usd(r.target)} ({pctS(r.rewardPct)})</b></div>
          <div><span>Câștig / risc</span><b className="num">{(r.rewardPct / r.riskPct).toFixed(1).replace('.', ',')} : 1</b></div>
        </div>
        <label className="field">Cât bagi (euro)<input inputMode="decimal" value={eur} onChange={e => setEur(e.target.value)} /></label>
        <p className="small">Cu <b>{amount} €</b>: dacă atinge stop-loss-ul pierzi cel mult <b className="bad">{(amount * r.riskPct / 100).toFixed(2).replace('.', ',')} €</b>; dacă atinge ținta câștigi <b className="in">{(amount * r.rewardPct / 100).toFixed(2).replace('.', ',')} €</b> (fără comisionul de 0,1% la cumpărare și la vânzare).</p>

        <h3 className="sub-h">Pașii în aplicația Binance</h3>
        <ol className="steps">
          <li><b>Ai nevoie de USDT.</b> Depune euro prin transfer bancar (SEPA, gratuit), apoi <b>Trade → Convert</b>: din EUR în USDT. Nu cumpăra cu cardul: comisionul e ~2%.</li>
          <li><b>Cumpărarea:</b> Trade → <b>Spot</b> → caută <b>{r.coin}/USDT</b> → Cumpără → tip <b>Limită</b>. Preț: <b className="num">{usd(r.zone === 'buy' ? r.entryHi : entry)}</b>. Sumă: <b>{amount} €</b> în USDT. Apasă Cumpără {r.coin}.</li>
          <li>Dacă prețul nu ajunge în zona de intrare în 2–3 zile, <b>anulează ordinul</b> (Ordine deschise → Anulează). Nu alerga după preț.</li>
          <li><b>Stop-loss + țintă deodată:</b> după ce s-a cumpărat, tot pe {r.coin}/USDT → Vinde → tip <b>OCO</b>. Completează: <b>Limită (ținta)</b> <span className="num">{usd(r.target)}</span> · <b>Stop (declanșare)</b> <span className="num">{usd(r.stop)}</span> · <b>Limită la stop</b> <span className="num">{usd(stopLimit)}</span> · <b>Cantitate</b>: toată moneda cumpărată. Apasă Vinde.</li>
          <li>Verifică în <b>Ordine deschise</b> că apar cele două ordine OCO. Când unul se execută, celălalt se anulează singur.</li>
          <li>Nu muta stop-loss-ul în jos. Îl poți urca doar în sus, după ce prețul a crescut.</li>
        </ol>
      </> : <p className="note">{r.zone === 'avoid' ? 'Nu are plan de cumpărare: tendința e în jos. Revine în radar când trece peste mediile mari.' : 'Încă nu are plan: așteaptă să treacă în „De cumpărat” sau „Așteaptă retragerea”.'}</p>}
      <p className="muted small">Analizat {ago(r.at)}.</p>
    </Sheet>
  )
}
