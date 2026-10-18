import { useMemo, useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { useStore } from '../store.tsx'
import { LineChart } from '../ui.tsx'
import { fmtNum, CUR_LABEL, type Currency } from '../lib/money.ts'
import { todayIso, MONTHS_SHORT } from '../lib/period.ts'
import { anchorPoint, estimateOn, MIN_OFFERS, type ValuePoint } from '../lib/valuation.ts'
import type { Asset } from '../lib/types.ts'

const RATES = [10, 15, 25, 35, 50]
const dmy = (d: string) => d.split('-').reverse().join('.')
const addMonths = (d: string, n: number) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, Math.min(day, 28))).toISOString().slice(0, 10)
}

/** Fields for things that lose value: price paid, date, yearly loss, monthly online check. */
export function DepreciationFields({ v, set, currency, onUseEstimate }: {
  v: { price: string; date: string; rate: string; marketOn: boolean; query: string; discount: string }
  set: (p: Partial<typeof v>) => void
  currency: Currency
  onUseEstimate: (value: number) => void
}) {
  const cur = CUR_LABEL[currency]
  const price = Math.round(Number(v.price.replace(/\./g, '').replace(',', '.')) * 100) || 0
  const rate = Number(v.rate) || 0
  const today = todayIso()
  const anchor = price && v.date ? { day: v.date, value: price, source: 'purchase' } : null
  const now = anchor ? estimateOn(today, rate, anchor) : null
  const inYear = anchor ? estimateOn(addMonths(today, 12), rate, anchor) : null
  return (
    <div className="dep card-inner">
      <div className="dep-h">Cât pierde din valoare</div>
      <div className="two">
        <label className="field">Cât a costat
          <span className="money-in"><input id="asset-price" inputMode="decimal" placeholder="ex. 4.000" value={v.price} onChange={e => set({ price: e.target.value })} /><i>{cur}</i></span>
        </label>
        <label className="field">Când l-ai luat<input id="asset-date" type="date" max={today} value={v.date} onChange={e => set({ date: e.target.value })} /></label>
      </div>
      <label className="field">Pierde pe an</label>
      <div className="chips">
        {RATES.map(r => <button key={r} type="button" className="chip" aria-pressed={rate === r} onClick={() => set({ rate: String(r) })}>{r}%</button>)}
        <span className="money-in small-in"><input id="asset-rate" inputMode="numeric" aria-label="Procent pe an" value={v.rate} onChange={e => set({ rate: e.target.value.replace(/\D/g, '').slice(0, 2) })} /><i>%</i></span>
      </div>
      <p className="hint">Telefoane ~35%, laptopuri ~25%, mașini ~15% pe an. Dacă pui tu altă valoare la un moment dat, de acolo calculează mai departe.</p>
      {now !== null && (
        <div className="dep-est">
          <span>După procent, azi ≈ <b className="num">{fmtNum(now)} {cur}</b></span>
          <span>peste 1 an ≈ <b className="num">{fmtNum(inYear!)} {cur}</b></span>
          <button type="button" className="link" onClick={() => onUseEstimate(now)}>Pune estimarea ca valoare</button>
        </div>
      )}
      <label className="switch">Caută prețul online, lunar
        <input id="asset-market" type="checkbox" checked={v.marketOn} onChange={e => set({ marketOn: e.target.checked })} />
      </label>
      {v.marketOn && <>
        <label className="field">Modelul exact (cum l-ai căuta pe OLX)
          <input id="asset-query" maxLength={80} placeholder="ex. Samsung Galaxy S25 Ultra 512GB" value={v.query} onChange={e => set({ query: e.target.value })} />
        </label>
        <label className="field">Scade din prețul din anunțuri
          <span className="money-in small-in"><input id="asset-discount" inputMode="numeric" value={v.discount} onChange={e => set({ discount: e.target.value.replace(/\D/g, '').slice(0, 2) })} /><i>%</i></span>
        </label>
        <p className="hint">O dată pe lună aplicația caută minim {MIN_OFFERS} anunțuri second-hand cu același model, ia prețul din mijloc și scade {v.discount || 0}% (în anunț e prețul cerut, nu cel cu care se vinde). Dacă nu găsește destule, folosește procentul pe an.</p>
      </>}
    </div>
  )
}

/** History chart, last online check and the listings it was based on. */
export function AssetValuePanel({ asset, notify }: { asset: Asset; notify: (m: string) => void }) {
  const st = useStore()
  const [busy, setBusy] = useState(false)
  const cur = CUR_LABEL[asset.currency]
  const hist = useMemo(() => st.assetValues.filter(x => x.asset_id === asset.id).sort((a, b) => a.day.localeCompare(b.day)), [st.assetValues, asset.id])
  const today = todayIso()
  const anchor = anchorPoint(hist as ValuePoint[], { value: asset.purchase_price ?? null, day: asset.purchase_date ?? null })
  const points = useMemo(() => {
    const pts = hist.map(h => ({ label: `${MONTHS_SHORT[Number(h.day.slice(5, 7)) - 1]} ${h.day.slice(2, 4)}`, value: h.value }))
    if (!hist.length || hist[hist.length - 1].day < today) pts.push({ label: 'azi', value: asset.value })
    return pts
  }, [hist, asset.value, today])
  const offers = asset.market_offers ?? []
  const used = offers.filter(o => o.used)
  const lostPct = asset.purchase_price ? Math.round((1 - asset.value / asset.purchase_price) * 100) : null

  async function check() {
    setBusy(true)
    try {
      const r = await st.checkAssetOnline(asset.id)
      if (r.source === 'market') notify(`Găsite ${r.count} oferte · valoare actualizată`)
      else if (r.error === 'rate_limited' || r.error?.startsWith('ai_')) notify('Căutarea online nu merge acum. Am folosit estimarea.')
      else notify(r.found ? `Doar ${r.found} oferte potrivite. Am folosit estimarea.` : 'N-am găsit oferte. Am folosit estimarea.')
    } catch (e: any) { notify(e?.message || 'Nu am putut căuta acum.') }
    finally { setBusy(false) }
  }

  return (
    <div className="dep card-inner">
      <div className="dep-h">Cum a evoluat valoarea</div>
      {points.length > 1 ? <LineChart points={points} height={120} /> : <p className="hint">Graficul apare după prima lună.</p>}
      <div className="dep-est">
        {asset.purchase_price ? <span>Cumpărat cu <b className="num">{fmtNum(asset.purchase_price)} {cur}</b>{asset.purchase_date ? ` pe ${dmy(asset.purchase_date)}` : ''}</span> : null}
        {lostPct !== null && lostPct > 0 && <span>a pierdut <b className="num bad">{lostPct}%</b></span>}
        {asset.dep_rate && anchor ? <span>în 6 luni ≈ <b className="num">{fmtNum(estimateOn(addMonths(today, 6), asset.dep_rate, anchor)!)} {cur}</b></span> : null}
      </div>
      {asset.market_on && <>
        <div className="dep-h">Prețuri online {asset.market_checked_on ? <span className="muted small">· verificat {dmy(asset.market_checked_on)}</span> : null}</div>
        {offers.length ? (
          <div className="offers">
            {offers.map((o, i) => (
              <a key={i} className={'offer' + (o.used ? '' : ' off')} href={o.url || undefined} target="_blank" rel="noreferrer">
                <span className="offer-t"><b>{o.title || 'Anunț'}</b><span className="muted small">{o.source}{o.used ? '' : ' · nu l-am luat în calcul'}</span></span>
                <span className="num">{fmtNum(Math.round(o.price * 100))} {o.currency === 'RON' ? 'lei' : o.currency === 'EUR' ? '€' : o.currency}</span>
                {o.url && <ExternalLink size={14} />}
              </a>
            ))}
            {used.length > 0 && <p className="hint">Valoarea ta = prețul din mijloc al celor {used.length} anunțuri, minus {asset.market_discount ?? 10}%.</p>}
          </div>
        ) : <p className="hint">Încă nu am căutat. Prima verificare se face azi la noapte sau apasă mai jos.</p>}
        <button type="button" className="ghost-btn" disabled={busy} onClick={check}><Search size={16} />{busy ? 'Caut oferte… (până la 1 minut)' : 'Verifică acum online'}</button>
      </>}
    </div>
  )
}
