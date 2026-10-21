// Crypto wallet: positions from the user's own transactions (average-cost method, like CoinGecko),
// priced live from Revolut X. Pure functions, no imports: also deployed with the `asset-value` edge function.

export type CryptoKind = 'buy' | 'sell' | 'reward' | 'adjust'
export interface CryptoTx {
  id?: string
  coin: string
  kind: CryptoKind
  qty: number
  price: number | null // per coin, in `currency`
  currency: string // RON / EUR / USD
  fee: number // in `currency`
  fx: number | null // lei per 1 unit of `currency` at that time (RON → null)
  at: string // ISO
  note: string
  ref?: string | null
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

export const KIND_LABEL: Record<CryptoKind, string> = { buy: 'Cumpărare', sell: 'Vânzare', reward: 'Recompensă', adjust: 'Corecție sold' }

const EPS = 1e-12
export const toLei = (t: Pick<CryptoTx, 'currency' | 'fx'>, amount: number) => amount * (t.currency === 'RON' ? 1 : t.fx ?? 1)

/** All positions, oldest transaction first. Sells take out cost at the average price (CoinGecko's "cost mediu net"). */
export function positions(txs: CryptoTx[], quotes: CoinQuote[] = []): Position[] {
  const q = new Map(quotes.map(x => [x.coin, x]))
  const by = new Map<string, Position & { lastPaid: number | null }>()
  const sorted = [...txs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  for (const t of sorted) {
    const c = t.coin.toUpperCase()
    const p = by.get(c) ?? { coin: c, qty: 0, cost: 0, avg: null, realized: 0, fees: 0, buys: 0, txs: 0, price: null, live: false, value: 0, pnl: 0, pnlPct: null, ch24: null, lastPaid: null }
    p.txs++
    const fee = toLei(t, t.fee || 0)
    p.fees += fee
    if (t.kind === 'buy') {
      const paid = toLei(t, (t.price ?? 0) * t.qty) + fee
      p.qty += t.qty; p.cost += paid; p.buys += paid
      if (t.price) p.lastPaid = toLei(t, t.price)
    } else if (t.kind === 'sell') {
      const avg = p.qty > EPS ? p.cost / p.qty : 0
      const sold = Math.min(t.qty, p.qty)
      p.realized += toLei(t, (t.price ?? 0) * t.qty) - fee - avg * sold
      p.cost -= avg * sold; p.qty -= t.qty
    } else {
      p.qty += t.qty // rewards and balance corrections: more (or fewer) coins, same money in
    }
    if (p.qty <= EPS) { p.qty = 0; p.cost = 0 }
    by.set(c, p)
  }
  return [...by.values()].map(({ lastPaid, ...p }) => {
    const live = q.get(p.coin)?.price ?? null
    const price = live ?? lastPaid
    const value = price != null ? p.qty * price : 0
    return { ...p, avg: p.qty > EPS ? p.cost / p.qty : null, price, live: live != null, value, pnl: value - p.cost, pnlPct: p.cost > 0 ? ((value - p.cost) / p.cost) * 100 : null, ch24: q.get(p.coin)?.ch24 ?? null }
  }).sort((a, b) => b.value - a.value || a.coin.localeCompare(b.coin))
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
