// Crypto wallet: positions from the user's own transactions (average-cost method, like CoinGecko),
// priced live from Revolut X. Pure functions, no imports: also deployed with the `asset-value` edge function.

export type CryptoKind = 'buy' | 'sell' | 'reward' | 'adjust' | 'move_out' | 'move_in'
export interface CryptoTx {
  id?: string
  asset_id?: string // the wallet (Revolut, Binance…)
  coin: string
  kind: CryptoKind
  qty: number
  price: number | null // per coin, in `currency`
  currency: string // RON / EUR / USD
  fee: number // in `currency`
  fx: number | null // lei per 1 unit of `currency` that day (official BNR rate; RON → null)
  at: string // ISO
  note: string
  ref?: string | null
  link?: string | null // move_out ↔ move_in pair (a swap A→B, or a transfer between your wallets)
}

/** Cached market data per coin, written by the server. */
export interface CoinQuote {
  coin: string
  pair: string | null // Revolut X pair, e.g. "DOT/EUR"
  price: number | null // lei per coin
  ch24: number | null // % change in 24h
  at: string | null // when priced
  spark?: number[] // last ~30 daily closes, in lei
  spark_on?: string | null
}

export interface Position {
  coin: string
  qty: number
  cost: number // lei still invested in what you hold (average cost, fees included)
  avg: number | null // lei per coin
  realized: number // lei profit already taken by selling
  fees: number // lei paid in fees
  buys: number // lei paid in buys, total
  txs: number
  price: number | null // lei per coin (live, or the last price you paid if there is no live price)
  live: boolean
  value: number // lei
  pnl: number // lei, value − cost
  pnlPct: number | null
  ch24: number | null
}

export const KIND_LABEL: Record<CryptoKind, string> = { buy: 'Cumpărare', sell: 'Vânzare', reward: 'Recompensă', adjust: 'Corecție sold', move_out: 'Ieșire', move_in: 'Intrare' }

const EPS = 1e-12
export const toLei = (t: Pick<CryptoTx, 'currency' | 'fx'>, amount: number) => amount * (t.currency === 'RON' ? 1 : t.fx ?? 1)
const ORDER: Record<CryptoKind, number> = { buy: 0, reward: 0, adjust: 0, sell: 1, move_out: 2, move_in: 3 }
const byTime = (a: CryptoTx, b: CryptoTx) => (a.at < b.at ? -1 : a.at > b.at ? 1 : ORDER[a.kind] - ORDER[b.kind])

export interface Sale { at: string; coin: string; asset_id?: string; gain: number /* lei */ }
type Acc = { coin: string; qty: number; cost: number; realized: number; fees: number; buys: number; txs: number; lastPaid: number | null }

/**
 * Walks every transaction in time order with the weighted-average cost (one method, every wallet, every year).
 * `key` groups the coins: per wallet for the wallet screen, per coin for taxes (the law looks at the person).
 * Swaps and transfers (move_out → move_in with the same `link`) carry the cost over: no gain is realized.
 */
export function ledger(txs: CryptoTx[], key: (t: CryptoTx) => string = t => t.coin.toUpperCase()): { acc: Map<string, Acc>; sales: Sale[] } {
  const acc = new Map<string, Acc>(), moved = new Map<string, number>(), sales: Sale[] = []
  for (const t of [...txs].sort(byTime)) {
    const k = key(t)
    const p = acc.get(k) ?? { coin: t.coin.toUpperCase(), qty: 0, cost: 0, realized: 0, fees: 0, buys: 0, txs: 0, lastPaid: null }
    p.txs++
    const fee = toLei(t, t.fee || 0)
    p.fees += fee
    const avg = p.qty > EPS ? p.cost / p.qty : 0
    if (t.kind === 'buy') {
      const paid = toLei(t, (t.price ?? 0) * t.qty) + fee
      p.qty += t.qty; p.cost += paid; p.buys += paid
      if (t.price) p.lastPaid = toLei(t, t.price)
    } else if (t.kind === 'sell') {
      const sold = Math.min(t.qty, p.qty)
      const gain = toLei(t, (t.price ?? 0) * t.qty) - fee - avg * sold
      p.realized += gain; p.cost -= avg * sold; p.qty -= t.qty
      sales.push({ at: t.at, coin: p.coin, asset_id: t.asset_id, gain })
    } else if (t.kind === 'move_out') {
      const out = avg * Math.min(t.qty, p.qty)
      p.cost -= out; p.qty -= t.qty
      if (t.link) moved.set(t.link, (moved.get(t.link) ?? 0) + out + fee)
    } else if (t.kind === 'move_in') {
      p.qty += t.qty
      if (t.link) { p.cost += moved.get(t.link) ?? 0; moved.delete(t.link) }
    } else {
      p.qty += t.qty // rewards and balance corrections: more (or fewer) coins, same money in
    }
    if (p.qty <= EPS) { p.qty = 0; p.cost = 0 }
    acc.set(k, p)
  }
  return { acc, sales }
}

/** Positions of one wallet (`assetId`) or of everything together. Costs follow coins across your wallets. */
export function positions(txs: CryptoTx[], quotes: CoinQuote[] = [], assetId?: string): Position[] {
  const q = new Map(quotes.map(x => [x.coin, x]))
  const { acc } = ledger(txs, assetId ? t => `${t.asset_id ?? ''}|${t.coin.toUpperCase()}` : undefined)
  const rows = assetId ? [...acc.entries()].filter(([k]) => k.startsWith(assetId + '|')).map(([, v]) => v) : [...acc.values()]
  return rows.map(({ lastPaid, ...p }) => {
    const live = q.get(p.coin)?.price ?? null
    const price = live ?? lastPaid
    const value = price != null ? p.qty * price : 0
    return { ...p, avg: p.qty > EPS ? p.cost / p.qty : null, price, live: live != null, value, pnl: value - p.cost, pnlPct: p.cost > 0 ? ((value - p.cost) / p.cost) * 100 : null, ch24: q.get(p.coin)?.ch24 ?? null }
  }).sort((a, b) => b.value - a.value || a.coin.localeCompare(b.coin))
}

/** Commission a platform usually charges (lei), to prefill the form. */
export function feeHint(platform: string, kind: CryptoKind, lei: number): { fee: number; text: string } | null {
  if (kind !== 'buy' && kind !== 'sell' && kind !== 'move_out') return null
  const p = platform.toLowerCase()
  if (p.includes('revolut')) return kind === 'move_out' ? null : { fee: Math.max(lei * 0.0149, 5.99), text: 'Revolut: ~1,49% (minim ~6 lei). Verifică în aplicație.' }
  if (p.includes('binance')) return kind === 'move_out' ? null : { fee: lei * 0.001, text: 'Binance spot: 0,1% (0,075% dacă plătești în BNB).' }
  return null
}

export interface Portfolio { value: number; cost: number; pnl: number; pnlPct: number | null; realized: number; fees: number; day: number | null }
export function portfolio(pos: Position[]): Portfolio {
  const held = pos.filter(p => p.qty > 0)
  const value = held.reduce((a, p) => a + p.value, 0), cost = held.reduce((a, p) => a + p.cost, 0)
  const withCh = held.filter(p => p.ch24 != null && p.live)
  // Yesterday's value of the coins that have a 24h change, to express the day's move in lei.
  const day = withCh.length ? withCh.reduce((a, p) => a + (p.value - p.value / (1 + p.ch24! / 100)), 0) : null
  return { value, cost, pnl: value - cost, pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : null, realized: pos.reduce((a, p) => a + p.realized, 0), fees: pos.reduce((a, p) => a + p.fees, 0), day }
}

/** Revolut X pair for a coin: EUR first (closest to lei), then USD. */
export function pickPair(coin: string, pairs: string[]): string | null {
  const c = coin.toUpperCase()
  for (const quote of ['EUR', 'USD', 'USDC']) if (pairs.includes(`${c}/${quote}`)) return `${c}/${quote}`
  return null
}

/** Revolut X ticker → lei price and 24h change. Prefers the EEA region. */
export function quoteFromTickers(pair: string, tickers: any[], rates: { EUR: number; USD: number }): { price: number; ch24: number | null } | null {
  const rows = tickers.filter(t => t?.symbol === pair)
  const t = rows.find(r => r.region === 'EEA') ?? rows[0]
  if (!t) return null
  const mid = Number(t.mid ?? t.last_price), ch = Number(t.price_change_24h)
  if (!(mid > 0)) return null
  const quote = pair.split('/')[1]
  const fx = quote === 'EUR' ? rates.EUR : rates.USD // USDC ≈ USD
  return { price: mid * fx, ch24: Number.isFinite(ch) && mid - ch > 0 ? (ch / (mid - ch)) * 100 : null }
}

/* ---------- Official BNR rates: every foreign-currency transaction in lei at the rate of its own day ---------- */
export type FxTable = Record<string, [string, number][]> // currency → [day, lei per unit], sorted by day
const roDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
/** Rate published on `day` or, on weekends and holidays, the last one before it. */
export function fxOn(table: FxTable, cur: string, day: string): number | null {
  const xs = table[cur]
  if (!xs?.length || day < xs[0][0]) return null
  let lo = 0, hi = xs.length - 1
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (xs[m][0] <= day) lo = m; else hi = m - 1 }
  return xs[lo][1]
}
export function withBnr(txs: CryptoTx[], table: FxTable | null): CryptoTx[] {
  if (!table) return txs
  return txs.map(t => {
    if (t.currency === 'RON') return t
    const r = fxOn(table, t.currency, roDay(t.at))
    return r ? { ...t, fx: r } : t
  })
}
export function fxTableFrom(rows: { day: string; cur: string; rate: number | string }[]): FxTable {
  const t: FxTable = {}
  for (const r of rows) (t[r.cur] ??= []).push([String(r.day).slice(0, 10), Number(r.rate)])
  for (const k of Object.keys(t)) t[k].sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return t
}
