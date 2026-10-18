import { useMemo, useState } from 'react'
import { FileUp, RefreshCw, TrendingUp } from 'lucide-react'
import { useStore } from '../store.tsx'
import { fmt, fmtNum } from '../lib/money.ts'
import { parseTradeville, summarize, type ParsedReport } from '../lib/tradeville.ts'
import { kindOf, type Asset } from '../lib/types.ts'
import type { Nav } from '../App.tsx'

const dmy = (d?: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '–')
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v))
const qtyFmt = (q: number) => new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 4 }).format(q)
const priceFmt = (p: number) => new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(p)

export function BrokerImportScreen({ nav, notify }: { nav: Nav; notify: (m: string) => void }) {
  const st = useStore()
  const [report, setReport] = useState<ParsedReport | null>(null)
  const [fileName, setFileName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const invest = st.assets.filter(a => !a.archived && kindOf(a.kind).section === 'invest')
  const [target, setTarget] = useState<string>(() => invest.find(a => a.broker === 'Tradeville' || /tradeville/i.test(a.platform))?.id ?? '')
  const preview = useMemo(() => (report ? summarize(report.rows) : null), [report])

  async function onFile(f?: File) {
    if (!f) return
    setErr(''); setReport(null); setFileName(f.name)
    try {
      const r = parseTradeville(new Uint8Array(await f.arrayBuffer()), f.name)
      setReport(r)
    } catch (e: any) {
      setErr(e?.message === 'empty' ? 'Raportul nu are operațiuni. Alege o perioadă mai lungă în Tradeville.'
        : 'Nu recunosc fișierul. Trebuie să fie raportul „Activitate” din Tradeville (salvat din Chrome, CSV sau Excel).')
    }
  }

  async function doImport() {
    if (!report) return
    setBusy(true); setErr('')
    try {
      const r = await st.importBroker(report, target || undefined)
      notify(`${r.added ? `${r.added} operațiuni noi` : 'Nimic nou'} · ${r.priced ? `prețuri de azi pentru ${r.priced} acțiuni` : 'prețurile vin la noapte'}`)
      nav('tab:avere')
    } catch (e: any) { setErr(e?.message || 'Importul s-a oprit. Încearcă din nou: ce s-a salvat deja nu se dublează.') }
    finally { setBusy(false) }
  }

  const s = preview?.summary
  return (
    <div className="screen">
      <section className="card form">
        <h2>Import din Tradeville</h2>
        <ol className="steps-list">
          <li>În aplicația Tradeville: <b>Meniu → Activitate</b>.</li>
          <li>Sus, la perioadă, alege <b>de la deschiderea contului</b> până azi.</li>
          <li><b>⋮ → Raport Csv</b> (sau Export Excel). Dacă se deschide ca pagină, în Chrome apasă <b>⋮ → ⬇️</b> ca s-o salvezi.</li>
          <li>Alege fișierul aici.</li>
        </ol>
        <label className="upload">
          <FileUp size={20} />
          <span>{fileName || 'Alege raportul (.csv, .xls, .mht)'}</span>
          <input id="tv-file" type="file" accept=".csv,.xls,.xlsx,.htm,.html,.mht,.mhtml,.txt,text/csv,text/html,application/vnd.ms-excel,multipart/related,message/rfc822" onChange={e => onFile(e.target.files?.[0])} disabled={busy} />
        </label>
        <p className="hint">Fișierul e citit pe telefonul tău. Se salvează doar operațiunile (fără CNP sau alte date personale din raport). Poți importa oricând din nou: ce există deja nu se dublează.</p>
      </section>

      {err && <p className="err">{err}</p>}

      {report && preview && s && <>
        <section className="card">
          <h2>Ce am găsit</h2>
          <p className="muted small">{report.rows.length} operațiuni · {dmy(s.first)} – {dmy(s.last)}</p>
          <div className="inv-grid">
            <div><span>Ai depus</span><b className="num">{fmt(s.deposits)}</b></div>
            <div><span>Ai retras</span><b className="num">{fmt(s.withdrawals)}</b></div>
            <div><span>Dividende</span><b className="num in">{fmt(s.dividends)}</b></div>
            <div><span>Profit din vânzări</span><b className={'num ' + (s.realized >= 0 ? 'in' : 'bad')}>{signed(s.realized)}</b></div>
            <div><span>Comisioane</span><b className="num bad">−{fmt(s.commissions)}</b></div>
            <div><span>Bani în cont</span><b className="num">{fmt(report.cashEnd ?? s.cash)}</b></div>
          </div>
        </section>
        <section>
          <h2>Ce deții acum</h2>
          <div className="rows">
            {preview.holdings.map(h => (
              <div key={h.symbol} className="row">
                <span className="cat-icon" style={{ width: 40, height: 40, ['--c' as any]: 'var(--s-invest)' }}><b className="small">{h.symbol.slice(0, 4)}</b></span>
                <span className="row-main"><b>{h.symbol}</b><span className="muted small num">{qtyFmt(h.qty)} buc · cost mediu {priceFmt(h.cost / 100 / h.qty)} lei</span></span>
                <span className="row-side"><b className="num">{fmtNum(h.cost)}</b><span className="muted small">investit</span></span>
              </div>
            ))}
          </div>
          <p className="hint">Prețul de azi al fiecărei acțiuni îl iau de pe bvb.ro după import și îl actualizez în fiecare zi.</p>
        </section>
        <section className="card form">
          <label className="field">Unde le pun în Avere
            <select id="tv-target" value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">Investiție nouă: „Tradeville”</option>
              {invest.map(a => <option key={a.id} value={a.id}>{a.name}{a.platform ? ` · ${a.platform}` : ''}</option>)}
            </select>
          </label>
          <button type="button" className="primary" disabled={busy} onClick={doImport}>{busy ? 'Import și caut prețurile…' : 'Importă în Avere'}</button>
        </section>
      </>}
    </div>
  )
}

/** Inside the investment's sheet: the whole picture and the positions with today's prices. */
export function InvestPanel({ asset, notify }: { asset: Asset; notify: (m: string) => void }) {
  const st = useStore()
  const [busy, setBusy] = useState(false)
  const s = asset.invest_summary
  const h = asset.holdings ?? []
  const value = asset.value
  const posValue = h.reduce((a, x) => a + (x.price ? Math.round(x.qty * x.price * 100) : x.cost), 0)
  const posCost = h.reduce((a, x) => a + x.cost, 0)
  const unreal = posValue - posCost
  const total = s ? value + s.withdrawals - s.deposits : null
  async function refresh() {
    setBusy(true)
    try { const r = await st.checkAssetOnline(asset.id); notify(r.priced ? `Prețuri actualizate (${r.priced} din ${r.positions})` : 'BVB nu răspunde acum. Încearcă mai târziu.') }
    catch (e: any) { notify(e?.message || 'Nu am putut actualiza prețurile.') }
    finally { setBusy(false) }
  }
  return (
    <div className="dep card-inner">
      <div className="dep-h"><TrendingUp size={16} />Toată povestea contului</div>
      {s && <div className="inv-grid">
        <div><span>Ai depus</span><b className="num">{fmt(s.deposits)}</b></div>
        <div><span>Ai retras</span><b className="num">{fmt(s.withdrawals)}</b></div>
        <div><span>Valoare acum</span><b className="num">{fmt(value)}</b></div>
        <div><span>Câștig total</span><b className={'num ' + ((total ?? 0) >= 0 ? 'in' : 'bad')}>{signed(total ?? 0)}</b></div>
        <div><span>Dividende</span><b className="num in">{fmt(s.dividends)}</b></div>
        <div><span>Din vânzări</span><b className={'num ' + (s.realized >= 0 ? 'in' : 'bad')}>{signed(s.realized)}</b></div>
        <div><span>Pe acțiunile de acum</span><b className={'num ' + (unreal >= 0 ? 'in' : 'bad')}>{signed(unreal)}{posCost ? ` (${unreal >= 0 ? '+' : ''}${String(Math.round((unreal / posCost) * 1000) / 10).replace('.', ',')}%)` : ''}</b></div>
        <div><span>Comisioane</span><b className="num bad">−{fmt(s.commissions)}</b></div>
      </div>}
      <p className="hint">Câștig total = ce valorează acum + ce ai retras − ce ai depus. Include dividendele și vânzările.</p>
      <div className="dep-h">Pozițiile {asset.prices_on ? <span className="muted small">· prețuri BVB din {dmy(asset.prices_on)}</span> : null}</div>
      <div className="positions">
        {h.map(x => {
          const v = x.price ? Math.round(x.qty * x.price * 100) : x.cost
          const pl = v - x.cost
          const pct = x.cost ? Math.round((pl / x.cost) * 1000) / 10 : 0
          return (
            <div key={x.symbol} className="pos">
              <span className="pos-sym">{x.symbol}</span>
              <span className="pos-mid"><span className="num">{qtyFmt(x.qty)} × {x.price ? priceFmt(x.price) : '–'}</span><span className="muted small num">cost mediu {priceFmt(x.cost / 100 / x.qty)}</span></span>
              <span className="pos-end"><b className="num">{fmtNum(v)}</b><span className={'small num ' + (pl >= 0 ? 'in' : 'bad')}>{pl >= 0 ? '+' : ''}{String(pct).replace('.', ',')}%</span></span>
            </div>
          )
        })}
        {s && s.cash > 0 && <div className="pos"><span className="pos-sym">RON</span><span className="pos-mid muted small">bani neinvestiți în cont</span><span className="pos-end"><b className="num">{fmtNum(s.cash)}</b></span></div>}
      </div>
      <button type="button" className="ghost-btn" disabled={busy} onClick={refresh}><RefreshCw size={16} />{busy ? 'Iau prețurile…' : 'Actualizează prețurile acum'}</button>
      <p className="hint">Pentru operațiuni noi, importă din nou raportul din Tradeville (Avere → Investiții → Import Tradeville).</p>
    </div>
  )
}
