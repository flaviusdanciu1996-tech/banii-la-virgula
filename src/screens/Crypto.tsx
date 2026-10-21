import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Pencil } from 'lucide-react'
import { useStore } from '../store.tsx'
import { Sheet, Seg, ConfirmButton, EmptyArt } from '../ui.tsx'
import { todayIso } from '../lib/period.ts'
import { positions, portfolio, KIND_LABEL, toLei, type CryptoTx, type CryptoKind, type Position, type CoinQuote } from '../lib/crypto.ts'
import type { Asset } from '../lib/types.ts'

// Names and colors for the coins people use most; anything else shows its symbol.
const NAMES: Record<string, string> = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', DOT: 'Polkadot', EGLD: 'MultiversX', AVAX: 'Avalanche', '1INCH': 'Rețea 1inch',
  ADA: 'Cardano', DOGE: 'Dogecoin', LINK: 'Chainlink', POL: 'Polygon', MATIC: 'Polygon', USDT: 'Tether', USDC: 'USD Coin', BNB: 'BNB',
  LTC: 'Litecoin', TRX: 'TRON', ATOM: 'Cosmos', SHIB: 'Shiba Inu', PEPE: 'Pepe', NEAR: 'NEAR', UNI: 'Uniswap', XLM: 'Stellar', SUI: 'Sui', TON: 'Toncoin',
}
const COLORS: Record<string, string> = { BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF', DOT: '#E6007A', EGLD: '#23F7DD', AVAX: '#E84142', '1INCH': '#94A6C3', XRP: '#9AA4AE', ADA: '#0033AD', DOGE: '#C2A633' }
const coinColor = (c: string) => COLORS[c] ?? `hsl(${[...c].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0)} 55% 50%)`
const coinName = (c: string) => NAMES[c] ?? c

const n2 = (x: number, d = 2) => x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d })
const lei = (x: number) => `${n2(x)} lei`
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${n2(Math.abs(x))} lei`
const pct = (x: number | null) => (x == null ? '' : `${x >= 0 ? '▲' : '▼'} ${n2(Math.abs(x))}%`)
const qtyFmt = (q: number) => q.toLocaleString('ro-RO', { maximumFractionDigits: q >= 100 ? 2 : q >= 1 ? 4 : 8 })
const priceFmt = (p: number) => p.toLocaleString('ro-RO', { minimumFractionDigits: p >= 1000 ? 0 : 2, maximumFractionDigits: p >= 1000 ? 0 : p >= 1 ? 2 : p >= 0.01 ? 4 : 8 })
const dayFmt = (iso: string) => new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })
/** "0,5" / "1.234,56" / "1234.5" → number (more decimals than money). */
const parseNum = (s: string): number | null => {
  let t = String(s ?? '').replace(/\s/g, '').replace(/lei|ron/gi, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}
const ago = (iso: string | null | undefined) => {
  if (!iso) return null
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'acum' : m < 60 ? `acum ${m} min` : m < 24 * 60 ? `acum ${Math.round(m / 60)} h` : `acum ${Math.round(m / 1440)} zile`
}

function CoinIcon({ coin, size = 38 }: { coin: string; size?: number }) {
  return <span className="coin-ic" style={{ width: size, height: size, background: coinColor(coin), fontSize: size * (coin.length > 3 ? 0.27 : 0.34) }}>{coin.slice(0, 4)}</span>
}

function Spark({ values, w = 72, h = 26, stroke }: { values?: number[]; w?: number; h?: number; stroke?: string }) {
  if (!values || values.length < 2) return null
  const lo = Math.min(...values), hi = Math.max(...values), r = hi - lo || 1
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - lo) / r) * (h - 4)).toFixed(1)}`).join('')
  const up = values[values.length - 1] >= values[0]
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mini-line" aria-hidden="true"><path d={d} fill="none" stroke={stroke ?? (up ? 'var(--in)' : 'var(--bad)')} strokeWidth="1.8" strokeLinejoin="round" /></svg>
}

const num = (v: unknown) => (v == null ? null : Number(v))
const normTx = (r: any): CryptoTx => ({ ...r, qty: Number(r.qty), price: num(r.price), fee: Number(r.fee ?? 0), fx: num(r.fx) })

export function CryptoScreen({ assetId, notify, openAsset }: { assetId: string; notify: (m: string) => void; openAsset: (a: Asset) => void }) {
  const st = useStore()
  const asset = st.assets.find(a => a.id === assetId)
  const [txs, setTxs] = useState<CryptoTx[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [coinOpen, setCoinOpen] = useState<string | null>(null)
  const [form, setForm] = useState<{ tx?: CryptoTx; coin?: string } | null>(null)

  const load = useCallback(async () => {
    const all = await st.repo.list<any>('crypto_tx', st.householdId).catch(() => [])
    setTxs(all.filter(r => r.asset_id === assetId).map(normTx))
  }, [st.repo, st.householdId, assetId])
  useEffect(() => { load() }, [load])

  const refresh = useCallback(async (silent = false) => {
    setBusy(true)
    try { await st.checkAssetOnline(assetId); if (!silent) notify('Prețuri actualizate') }
    catch (e: any) { if (!silent) notify(e?.message || 'Nu am putut lua prețurile acum.') }
    finally { setBusy(false) }
  }, [st, assetId, notify])

  // Fresh prices every time you open it (at most once every 2 minutes).
  const lastAt = asset?.coins?.map(c => c.at).filter(Boolean).sort().pop() ?? null
  useEffect(() => {
    if (!asset || (lastAt && Date.now() - Date.parse(lastAt) < 2 * 60000)) return
    refresh(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId])

  const quotes: CoinQuote[] = asset?.coins ?? []
  const pos = useMemo(() => positions(txs ?? [], quotes), [txs, quotes])
  const held = pos.filter(p => p.qty > 0)
  const pf = portfolio(pos)

  if (!asset) return <div className="screen"><p className="muted">Portofelul nu mai există.</p></div>

  async function afterChange() { await load(); await refresh(true) }

  return (
    <div className="screen">
      <section className="card budget crypto-head">
        <div className="eyebrow">{asset.name}{asset.platform && asset.platform !== asset.name ? ` · ${asset.platform}` : ''}</div>
        <div className="big num">{lei(pf.value)}</div>
        {pf.cost > 0 && <div className={pf.pnl >= 0 ? 'in' : 'bad'}><span className="num">{signed(pf.pnl)} {pct(pf.pnlPct)}</span> <span className="muted small">față de cât ai plătit</span></div>}
        {pf.day != null && <div className={'small ' + (pf.day >= 0 ? 'in' : 'bad')}><span className="num">{signed(pf.day)}</span> în ultimele 24 h</div>}
        <div className="inv-sum">
          <div><span>Cost total</span><b className="num">{lei(pf.cost)}</b></div>
          {Math.abs(pf.realized) >= 0.01 && <div><span>Profit din vânzări</span><b className={'num ' + (pf.realized >= 0 ? 'in' : 'bad')}>{signed(pf.realized)}</b></div>}
          <div><span>Comisioane plătite</span><b className="num">{lei(pf.fees)}</b></div>
        </div>
        <div className="crypto-src">
          <span className="muted small">Prețuri Revolut X · {ago(lastAt) ?? 'încă nu'}</span>
          <button type="button" className="icon-btn" aria-label="Actualizează prețurile" disabled={busy} onClick={() => refresh()}><RefreshCw size={16} className={busy ? 'spin' : ''} /></button>
          <button type="button" className="icon-btn" aria-label="Nume și platformă" onClick={() => openAsset(asset)}><Pencil size={15} /></button>
        </div>
      </section>

      {txs === null ? <p className="muted">Se încarcă…</p> : held.length === 0 ? (
        <EmptyArt icon="bitcoin" title="Adaugă prima monedă" text={`Scrie ce ai cumpărat: moneda, câte bucăți și cât ai plătit. Prețul se ia singur de la Revolut X.${asset.value ? ` Până atunci rămâne valoarea scrisă de mână (${lei(asset.value / 100)}).` : ''}`}>
          <button type="button" className="primary" onClick={() => setForm({})}><Plus size={17} /> Adaugă tranzacție</button>
        </EmptyArt>
      ) : <>
        <h2 className="grp-h"><span>Monedele mele</span><span className="num">{held.length}</span></h2>
        <div className="rows">
          {held.map(p => (
            <button key={p.coin} type="button" className="row coin-row" onClick={() => setCoinOpen(p.coin)}>
              <CoinIcon coin={p.coin} />
              <span className="row-main">
                <b>{coinName(p.coin)}</b>
                <span className="muted small num">{qtyFmt(p.qty)} {p.coin} · {p.price != null ? `${priceFmt(p.price)} lei` : 'fără preț'}{!p.live && p.price != null ? ' (ultimul plătit)' : ''}</span>
              </span>
              <Spark values={quotes.find(q => q.coin === p.coin)?.spark} w={52} h={24} />
              <span className="row-side">
                <b className="num">{lei(p.value)}</b>
                {p.pnlPct != null && <span className={'num small ' + (p.pnl >= 0 ? 'in' : 'bad')}>{pct(p.pnlPct)}</span>}
              </span>
            </button>
          ))}
          <button type="button" className="row add-line" onClick={() => setForm({})}><Plus size={16} />Adaugă tranzacție</button>
        </div>
        {pos.some(p => p.qty === 0) && <p className="hint">Vândute de tot: {pos.filter(p => p.qty === 0).map(p => p.coin).join(', ')} — le găsești în istoric dacă le adaugi din nou.</p>}
      </>}

      {coinOpen && txs && <CoinSheet coin={coinOpen} pos={pos.find(p => p.coin === coinOpen)} quote={quotes.find(q => q.coin === coinOpen)} txs={txs.filter(t => t.coin === coinOpen)}
        onClose={() => setCoinOpen(null)} onAdd={() => setForm({ coin: coinOpen })} onEdit={t => setForm({ tx: t })} />}
      {form && <TxForm asset={asset} tx={form.tx} coin={form.coin} coins={pos.map(p => p.coin)} notify={notify} onClose={() => setForm(null)}
        onSaved={async coin => { setForm(null); if (coin && held.some(p => p.coin === coin)) setCoinOpen(coin); await afterChange() }} />}
    </div>
  )
}

function CoinSheet({ coin, pos, quote, txs, onClose, onAdd, onEdit }: { coin: string; pos?: Position; quote?: CoinQuote; txs: CryptoTx[]; onClose: () => void; onAdd: () => void; onEdit: (t: CryptoTx) => void }) {
  const list = [...txs].sort((a, b) => (a.at < b.at ? 1 : -1))
  return (
    <Sheet title={`${coinName(coin)} · ${coin}`} onClose={onClose}>
      {quote?.price != null && (
        <div className="coin-price">
          <div><b className="num">{priceFmt(quote.price)} lei</b>{quote.ch24 != null && <span className={'num small ' + (quote.ch24 >= 0 ? 'in' : 'bad')}> {pct(quote.ch24)} · 24 h</span>}</div>
          <Spark values={quote.spark} w={300} h={64} />
          {quote.spark && <span className="muted small">Ultimele 30 de zile · {quote.pair} pe Revolut X</span>}
        </div>
      )}
      {pos && (
        <div className="coin-box">
          <div><span>Valoarea participațiilor</span><b className="num">{lei(pos.value)}</b></div>
          <div><span>Participații</span><b className="num">{qtyFmt(pos.qty)} {coin}</b></div>
          <div><span>Cost total</span><b className="num">{lei(pos.cost)}</b></div>
          <div><span>Cost mediu net</span><b className="num">{pos.avg != null ? `${priceFmt(pos.avg)} lei` : '–'}</b></div>
          <div className="wide"><span>Total profit / pierderi</span><b className={'num ' + (pos.pnl >= 0 ? 'in' : 'bad')}>{signed(pos.pnl)} {pos.pnlPct != null ? `(${pct(pos.pnlPct)})` : ''}</b></div>
          {Math.abs(pos.realized) >= 0.01 && <div className="wide"><span>Profit din vânzări</span><b className={'num ' + (pos.realized >= 0 ? 'in' : 'bad')}>{signed(pos.realized)}</b></div>}
        </div>
      )}
      <h3 className="sub-h">Istoricul tranzacțiilor</h3>
      {list.length === 0 ? <p className="muted">Nicio tranzacție.</p> : (
        <div className="rows tx-hist">
          {list.map((t, i) => {
            const total = t.price != null ? toLei(t, t.price * t.qty) : null
            return (
              <button key={t.id ?? i} type="button" className="row" onClick={() => onEdit(t)}>
                <span className="row-main">
                  <b>{KIND_LABEL[t.kind]}{t.note ? <span className="muted small"> · {t.note}</span> : null}</b>
                  <span className="muted small">{dayFmt(t.at)}{t.price != null ? ` · ${priceFmt(toLei(t, t.price))} lei/buc.` : ''}{t.fee ? ` · comision ${n2(toLei(t, t.fee))} lei` : ''}</span>
                </span>
                <span className="row-side">
                  <b className={'num ' + (t.kind === 'sell' || t.qty < 0 ? 'bad' : 'in')}>{t.kind === 'sell' || t.qty < 0 ? '−' : '+'}{qtyFmt(Math.abs(t.qty))} {coin}</b>
                  {total != null && <span className="num small muted">{lei(total)}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      <div className="actions"><button type="button" className="primary" onClick={onAdd}><Plus size={17} /> Adăugare tranzacție</button></div>
    </Sheet>
  )
}

function TxForm({ asset, tx, coin, coins, notify, onClose, onSaved }: { asset: Asset; tx?: CryptoTx; coin?: string; coins: string[]; notify: (m: string) => void; onClose: () => void; onSaved: (coin?: string) => void }) {
  const st = useStore()
  const [kind, setKind] = useState<CryptoKind>(tx?.kind ?? 'buy')
  const [c, setC] = useState(tx?.coin ?? coin ?? coins[0] ?? '')
  const [other, setOther] = useState(!tx && !coin && coins.length === 0)
  const [qty, setQty] = useState(tx ? String(Math.abs(tx.qty)).replace('.', ',') : '')
  const [sign, setSign] = useState<1 | -1>(tx && tx.qty < 0 ? -1 : 1)
  const [total, setTotal] = useState(tx?.price != null ? n2(toLei(tx, tx.price * tx.qty)).replace(/\./g, '') : '')
  const [fee, setFee] = useState(tx?.fee ? n2(toLei(tx, tx.fee)).replace(/\./g, '') : '')
  const [date, setDate] = useState((tx?.at ?? new Date().toISOString()).slice(0, 10))
  const [note, setNote] = useState(tx?.note ?? '')
  const [err, setErr] = useState('')
  const money = kind === 'buy' || kind === 'sell'
  const q = parseNum(qty), tot = parseNum(total)
  const unit = q && tot ? tot / q : null

  async function save() {
    const sym = c.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!sym) return setErr('Alege sau scrie moneda (ex. BTC).')
    if (!q || q <= 0) return setErr('Scrie câte bucăți (ex. 0,5).')
    if (money && (!tot || tot <= 0)) return setErr(kind === 'buy' ? 'Scrie cât ai plătit în total, în lei.' : 'Scrie cât ai primit în total, în lei.')
    const f = fee.trim() ? parseNum(fee) : 0
    if (f === null || f < 0) return setErr('Comisionul nu e valid.')
    if (!date) return setErr('Alege data.')
    // Keep the original time of day when editing, otherwise midday (stable order within a day).
    const at = tx && tx.at.slice(0, 10) === date ? tx.at : `${date}T12:00:00+03:00`
    // Edited money amounts are stored in lei (old foreign-currency rows become lei rows).
    const row = {
      household_id: st.householdId, asset_id: asset.id, coin: sym, kind,
      qty: kind === 'adjust' ? sign * q : q, price: money ? tot! / q : null, currency: 'RON', fee: money ? f : 0, fx: null, at, note: note.trim(),
    }
    try {
      if (tx?.id) await st.repo.update('crypto_tx' as any, { id: tx.id }, row as any)
      else await st.repo.insert('crypto_tx' as any, row as any)
      notify(tx ? 'Tranzacție modificată' : 'Tranzacție adăugată')
      onSaved(sym)
    } catch (e: any) { setErr(e?.message || 'Nu s-a putut salva.') }
  }

  return (
    <Sheet title={tx ? 'Modifică tranzacția' : 'Adăugare tranzacție'} onClose={onClose}>
      <Seg label="Tip" value={kind} onChange={setKind} options={[{ id: 'buy', label: 'Cumpăr' }, { id: 'sell', label: 'Vând' }, { id: 'reward', label: 'Primit' }, { id: 'adjust', label: 'Corecție' }]} />
      <p className="hint">{kind === 'buy' ? 'Ai cumpărat monede cu bani.' : kind === 'sell' ? 'Ai vândut monede pe bani.' : kind === 'reward' ? 'Monede primite gratis: staking, Revolut Învață, cadou. Cresc cantitatea, nu costul.' : 'Potrivește cantitatea cu ce vezi în aplicația ta (ex. după staking). Nu schimbă costul.'}</p>
      <label className="field">Moneda</label>
      <div className="chips">
        {coins.map(x => <button key={x} type="button" className="chip" aria-pressed={!other && c === x} onClick={() => { setOther(false); setC(x) }}><CoinIcon coin={x} size={20} />{x}</button>)}
        <button type="button" className="chip" aria-pressed={other} onClick={() => { setOther(true); setC('') }}>+ Altă monedă</button>
      </div>
      {other && <label className="field">Simbolul monedei<input id="coin-sym" autoCapitalize="characters" maxLength={10} placeholder="ex. BTC, ETH, SOL" value={c} onChange={e => setC(e.target.value.toUpperCase())} /></label>}
      {kind === 'adjust' && <Seg label="Sens" value={sign === 1 ? 'plus' : 'minus'} onChange={v => setSign(v === 'plus' ? 1 : -1)} options={[{ id: 'plus', label: 'Am mai multe' }, { id: 'minus', label: 'Am mai puține' }]} />}
      <label className="field">Câte bucăți<input id="coin-qty" inputMode="decimal" placeholder="ex. 0,5" value={qty} onChange={e => setQty(e.target.value)} /></label>
      {money && <>
        <label className="field">{kind === 'buy' ? 'Cât ai plătit în total (lei, fără comision)' : 'Cât ai primit în total (lei, fără comision)'}<input id="coin-total" inputMode="decimal" placeholder="ex. 500" value={total} onChange={e => setTotal(e.target.value)} /></label>
        {unit != null && <p className="hint">Preț pe bucată: <b className="num">{priceFmt(unit)} lei</b></p>}
        <label className="field">Comision (lei)<input id="coin-fee" inputMode="decimal" placeholder="opțional" value={fee} onChange={e => setFee(e.target.value)} /></label>
      </>}
      <label className="field">Data<input id="coin-date" type="date" max={todayIso()} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="field">Notă<input id="coin-note" maxLength={80} placeholder="opțional" value={note} onChange={e => setNote(e.target.value)} /></label>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        {tx?.id && <ConfirmButton onConfirm={async () => { await st.repo.remove('crypto_tx' as any, { id: tx.id }); notify('Șters'); onSaved() }} />}
        <button type="button" className="primary" onClick={save}>Salvează</button>
      </div>
    </Sheet>
  )
}

/** Small line for the Avere row. */
export function cryptoSummary(a: Asset): string | null {
  const n = a.coins?.length ?? 0
  return n ? `${n} ${n === 1 ? 'monedă' : 'monede'} · preț Revolut X` : null
}
