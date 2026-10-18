// BVB Radar: indicators, a transparent 0–100 score with reasons, and a backtest. Pure functions, no imports:
// deployed as-is with the `market-radar` edge function (alerts are computed there with the same rules).

export interface StockData {
  symbol: string
  name?: string
  per?: number | null // price / earnings
  pbv?: number | null // price / book value
  eps?: number | null
  divy?: number | null // dividend yield %, from BVB
  mcap?: number | null // lei
  t: number[] // trading days, as days since 1970-01-01
  c: number[] // close
  a: number[] // adjusted close (splits + dividends)
  v?: number[] // volume
  divs?: { d: number; a: number }[] // dividend per share, day index
}

export interface Indicators {
  price: number
  ma50: number | null
  ma200: number | null
  rsi: number | null
  hi52: number | null
  lo52: number | null
  pos52: number | null // 0 = at the 1-year low, 1 = at the 1-year high
  vol: number | null // yearly volatility, %
  dd: number | null // worst fall from a peak in the last year, % (negative)
  ret1y: number | null // % over the last year (adjusted, with dividends)
  ret3m: number | null
  divYield: number | null // % (BVB value, or last 12 months of dividends / price)
  turnover: number | null // average daily value traded, lei (last 3 months)
}

export type Label = 'buy' | 'neutral' | 'hot' | 'avoid'
export interface Score { total: number; fund: number; tech: number; risk: number; label: Label; reasons: { good: boolean | null; text: string }[]; ind: Indicators }

export const LABELS: Record<Label, { text: string; emoji: string }> = {
  buy: { text: 'Zonă de cumpărare', emoji: '🟢' },
  neutral: { text: 'Neutru', emoji: '🟡' },
  hot: { text: 'Supraîncălzită', emoji: '🟠' },
  avoid: { text: 'Așteaptă', emoji: '🔴' },
}

export const dayOf = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10)) / 864e5)
export const isoOf = (day: number) => new Date(day * 864e5).toISOString().slice(0, 10)
const r1 = (x: number) => Math.round(x * 10) / 10
const fmt = (x: number, d = 1) => x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d })

function sma(xs: number[], end: number, n: number): number | null {
  if (end + 1 < n) return null
  let s = 0
  for (let i = end - n + 1; i <= end; i++) s += xs[i]
  return s / n
}

/** Wilder's RSI over `n` days, ending at index `end`. */
function rsi(xs: number[], end: number, n = 14): number | null {
  if (end < n + 1) return null
  const start = Math.max(1, end - n * 10)
  let g = 0, l = 0
  for (let i = start; i < start + n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d }
  g /= n; l /= n
  for (let i = start + n; i <= end; i++) {
    const d = xs[i] - xs[i - 1]
    g = (g * (n - 1) + Math.max(0, d)) / n
    l = (l * (n - 1) + Math.max(0, -d)) / n
  }
  if (l === 0) return 100
  return 100 - 100 / (1 + g / l)
}

/** Index of the last trading day at or before `day`. */
export function indexAt(s: StockData, day: number): number {
  let lo = 0, hi = s.t.length - 1, ans = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] <= day) { ans = m; lo = m + 1 } else hi = m - 1 }
  return ans
}

/** All indicators as they were on trading day `i` (default: the last one). */
export function indicators(s: StockData, i = s.t.length - 1, useBvbFundamentals = true): Indicators {
  const a = s.a, c = s.c, day = s.t[i]
  const back = (days: number) => { const j = indexAt(s, day - days); return j >= 0 && j < i ? j : null }
  const y = back(365), q = back(91)
  let hi = -Infinity, lo = Infinity, peak = -Infinity, dd = 0
  const from = y ?? 0
  for (let k = from; k <= i; k++) { hi = Math.max(hi, a[k]); lo = Math.min(lo, a[k]); peak = Math.max(peak, a[k]); dd = Math.min(dd, a[k] / peak - 1) }
  let vol: number | null = null
  if (i - from > 40) {
    const rets: number[] = []
    for (let k = from + 1; k <= i; k++) if (a[k - 1] > 0) rets.push(Math.log(a[k] / a[k - 1]))
    const m = rets.reduce((x, z) => x + z, 0) / rets.length
    vol = Math.sqrt(rets.reduce((x, z) => x + (z - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100
  }
  let divYield: number | null = null
  if (useBvbFundamentals && s.divy != null) divYield = s.divy
  else if (s.divs) {
    const sum = s.divs.filter(d => d.d > day - 365 && d.d <= day).reduce((x, d) => x + d.a, 0)
    divYield = c[i] > 0 ? (sum / c[i]) * 100 : null
  }
  let turnover: number | null = null
  if (s.v && q !== null) { let t = 0, n = 0; for (let k = q; k <= i; k++) { t += (s.v[k] ?? 0) * c[k]; n++ } turnover = n ? t / n : null }
  return {
    price: c[i], ma50: sma(a, i, 50), ma200: sma(a, i, 200), rsi: rsi(a, i),
    hi52: y !== null ? hi : null, lo52: y !== null ? lo : null, pos52: y !== null && hi > lo ? (a[i] - lo) / (hi - lo) : null,
    vol, dd: y !== null ? dd * 100 : null, ret1y: y !== null ? (a[i] / a[y] - 1) * 100 : null, ret3m: q !== null ? (a[i] / a[q] - 1) * 100 : null,
    divYield, turnover,
  }
}

/**
 * The score. Every point has a reason you can read:
 * fundamentals 40 (dividend, P/E, P/BV) · technical 40 (trend, RSI, place in the 1-year range) · risk 20 (volatility, worst fall).
 * Without P/E and P/BV (e.g. in the backtest) the fundamental part is scaled from the dividend alone.
 */
export function score(s: StockData, i = s.t.length - 1, useBvbFundamentals = true): Score {
  const ind = indicators(s, i, useBvbFundamentals)
  const reasons: Score['reasons'] = []
  const a = s.a[i]

  // Fundamentals
  let div = 0
  const dy = ind.divYield
  if (dy != null) {
    div = dy >= 8 ? 15 : dy >= 6 ? 12 : dy >= 4 ? 8 : dy >= 2 ? 4 : 0
    reasons.push({ good: dy >= 6 ? true : dy >= 3 ? null : false, text: `Dividend ${fmt(dy)}% pe an${dy >= 6 ? ' — generos' : dy < 3 ? ' — mic' : ''}` })
  }
  let fund: number
  const etf = /ETF/i.test(s.symbol)
  if (dy != null && dy > 15) reasons.push({ good: null, text: 'Dividendul e neobișnuit de mare — verifică dacă a fost unul special, care nu se repetă' })
  if (etf) {
    fund = 20
    reasons.push({ good: null, text: 'ETF: fundamentalele sunt ale firmelor din indice — risc împărțit pe multe firme' })
  } else if (useBvbFundamentals) {
    const per = s.per, pbv = s.pbv
    let p = 7, b = 5
    if (per != null) {
      p = per <= 0 ? 0 : per <= 6 ? 15 : per <= 10 ? 12 : per <= 15 ? 8 : per <= 20 ? 4 : 0
      reasons.push({ good: per > 0 && per <= 10 ? true : per <= 0 || per > 20 ? false : null, text: per <= 0 ? 'Firma e pe pierdere (P/E negativ)' : `P/E ${fmt(per)} — ${per <= 10 ? 'ieftină față de profit' : per <= 15 ? 'preț corect' : 'scumpă față de profit'}` })
    } else reasons.push({ good: null, text: 'P/E indisponibil pe BVB (pierdere sau firmă listată din străinătate)' })
    if (pbv != null) {
      b = pbv <= 1 ? 10 : pbv <= 1.5 ? 7 : pbv <= 2.5 ? 4 : 1
      reasons.push({ good: pbv <= 1.2 ? true : pbv > 2.5 ? false : null, text: `P/BV ${fmt(pbv, 2)} — ${pbv <= 1 ? 'sub valoarea din bilanț' : pbv <= 2.5 ? 'normal' : 'mult peste valoarea din bilanț'}` })
    }
    fund = div + p + b
  } else fund = Math.round(div * (40 / 15))

  // Technical
  let tech = 0
  if (ind.ma200 != null) {
    const above = a > ind.ma200
    if (above) tech += 12
    reasons.push({ good: above, text: above ? 'Prețul e peste media de 200 de zile (trend de creștere)' : 'Prețul e sub media de 200 de zile (trend de scădere)' })
    if (ind.ma50 != null) {
      const gold = ind.ma50 > ind.ma200
      if (gold) tech += 8
      reasons.push({ good: gold, text: gold ? 'Media de 50 e peste cea de 200 — trendul pe termen mediu e bun' : 'Media de 50 e sub cea de 200 — trend slab' })
    }
  } else tech += 10
  const R = ind.rsi
  if (R != null) {
    tech += R < 30 ? 6 : R <= 50 ? 10 : R <= 65 ? 7 : R <= 75 ? 3 : 0
    reasons.push({ good: R >= 30 && R <= 55 ? true : R > 70 ? false : null, text: `RSI ${Math.round(R)} — ${R < 30 ? 'supravândută (a scăzut mult, poate reveni sau poate continua)' : R <= 50 ? 'calmă, fără euforie' : R <= 70 ? 'în creștere' : 'supracumpărată (a crescut prea repede)'}` })
  }
  if (ind.pos52 != null) {
    tech += ind.pos52 <= 0.4 ? 10 : ind.pos52 <= 0.7 ? 6 : 3
    reasons.push({ good: ind.pos52 <= 0.4 ? true : ind.pos52 > 0.85 ? false : null, text: `E la ${Math.round(ind.pos52 * 100)}% din drumul dintre minimul și maximul pe un an` })
  }

  // Risk
  let risk = 0
  if (ind.vol != null) {
    risk += ind.vol < 20 ? 10 : ind.vol < 30 ? 7 : ind.vol < 45 ? 4 : 1
    reasons.push({ good: ind.vol < 25 ? true : ind.vol > 45 ? false : null, text: `Se mișcă ${ind.vol < 20 ? 'puțin' : ind.vol < 35 ? 'moderat' : 'mult'} (volatilitate ${Math.round(ind.vol)}%/an)` })
  } else risk += 5
  if (ind.dd != null) {
    risk += ind.dd > -15 ? 10 : ind.dd > -30 ? 6 : ind.dd > -50 ? 3 : 0
    if (ind.dd < -20) reasons.push({ good: false, text: `A picat până la ${Math.round(ind.dd)}% de la vârf în ultimul an` })
  } else risk += 5
  if (ind.turnover != null && ind.turnover < 50000) reasons.push({ good: false, text: 'Se tranzacționează puțin — poate fi greu de vândut la prețul dorit' })

  const total = Math.max(0, Math.min(100, Math.round(fund + tech + risk)))
  const label: Label = R != null && R > 75 && total >= 45 ? 'hot' : total >= 65 ? 'buy' : total >= 45 ? 'neutral' : 'avoid'
  return { total, fund: Math.round(fund), tech, risk, label, reasons, ind }
}

/* ---------- Your own rules ---------- */

export interface Rules { minDiv?: number | null; maxPer?: number | null; maxPbv?: number | null; aboveMa200?: boolean; maxRsi?: number | null; minScore?: number | null }
export function passesRules(s: StockData, sc: Score, r: Rules): { ok: boolean; fails: string[] } {
  const f: string[] = []
  if (r.minDiv != null && !((sc.ind.divYield ?? 0) >= r.minDiv)) f.push(`dividend sub ${r.minDiv}%`)
  if (r.maxPer != null && !(s.per != null && s.per > 0 && s.per <= r.maxPer)) f.push(`P/E peste ${r.maxPer}`)
  if (r.maxPbv != null && !(s.pbv != null && s.pbv <= r.maxPbv)) f.push(`P/BV peste ${r.maxPbv}`)
  if (r.aboveMa200 && !(sc.ind.ma200 != null && s.a[s.a.length - 1] > sc.ind.ma200)) f.push('sub media de 200 de zile')
  if (r.maxRsi != null && !(sc.ind.rsi != null && sc.ind.rsi <= r.maxRsi)) f.push(`RSI peste ${r.maxRsi}`)
  if (r.minScore != null && sc.total < r.minScore) f.push(`scor sub ${r.minScore}`)
  return { ok: f.length === 0, fails: f }
}

/* ---------- Backtest ---------- */

export type StrategyId = 'radar' | 'divtrend' | 'momentum' | 'lowvol'
export const STRATEGIES: Record<StrategyId, { name: string; about: string; rank: (s: StockData, i: number) => number | null }> = {
  radar: { name: 'Scor Radar', about: 'cele mai bine notate (dividend, trend, RSI, risc)', rank: (s, i) => score(s, i, false).total },
  divtrend: { name: 'Dividend + trend', about: 'dividend mare, doar cele peste media de 200 de zile', rank: (s, i) => { const x = indicators(s, i, false); return x.ma200 != null && s.a[i] > x.ma200 ? (x.divYield ?? 0) : null } },
  momentum: { name: 'Momentum 6 luni', about: 'cele care au crescut cel mai mult în 6 luni, peste media de 200', rank: (s, i) => { const j = indexAt(s, s.t[i] - 182); const x = indicators(s, i, false); return j >= 0 && x.ma200 != null && s.a[i] > x.ma200 ? s.a[i] / s.a[j] - 1 : null } },
  lowvol: { name: 'Liniștite', about: 'cele care se mișcă cel mai puțin (volatilitate mică)', rank: (s, i) => { const v = indicators(s, i, false).vol; return v == null ? null : -v } },
}

export interface BacktestResult {
  months: number
  invested: number
  radar: { value: number; series: { day: number; value: number }[]; picks: { day: number; symbols: string[] }[] }
  equal: { value: number; series: { day: number; value: number }[] }
}

/**
 * Every month, put `monthly` lei in:
 *  - the strategy: the `top` best-ranked stocks that day (only data known that day — no peeking ahead),
 *  - Equal: all stocks that had a price that day, equally.
 * Prices are adjusted (dividends reinvested). P/E and P/BV aren't known historically, so the score uses
 * dividend + technical + risk only.
 */
export function backtest(stocks: StockData[], startDay: number, endDay: number, monthly = 1000, top = 3, strategy: StrategyId = 'radar'): BacktestResult {
  const usable = stocks.filter(s => s.t.length > 260)
  const pos = { radar: new Map<string, number>(), equal: new Map<string, number>() }
  const res: BacktestResult = { months: 0, invested: 0, radar: { value: 0, series: [], picks: [] }, equal: { value: 0, series: [] } }
  const rank = STRATEGIES[strategy].rank
  const valueAt = (m: Map<string, number>, day: number) => {
    let v = 0
    for (const [sym, units] of m) { const s = usable.find(x => x.symbol === sym)!; const j = indexAt(s, day); if (j >= 0) v += units * s.a[j] }
    return v
  }
  let d = new Date(startDay * 864e5)
  while (true) {
    const day = Math.floor(d.getTime() / 864e5)
    if (day > endDay) break
    const live = usable.map(s => ({ s, i: indexAt(s, day) })).filter(x => x.i >= 250 && day - x.s.t[x.i] < 10)
    if (live.length) {
      res.months++; res.invested += monthly
      let ranked = live.map(x => ({ ...x, r: rank(x.s, x.i) })).filter(x => x.r != null).sort((a, b) => b.r! - a.r!).slice(0, top)
      if (!ranked.length) ranked = live.map(x => ({ ...x, r: 0 })) // nothing qualifies: spread it
      for (const x of ranked) pos.radar.set(x.s.symbol, (pos.radar.get(x.s.symbol) ?? 0) + monthly / ranked.length / x.s.a[x.i])
      for (const x of live) pos.equal.set(x.s.symbol, (pos.equal.get(x.s.symbol) ?? 0) + monthly / live.length / x.s.a[x.i])
      res.radar.picks.push({ day, symbols: ranked.map(x => x.s.symbol) })
      res.radar.series.push({ day, value: valueAt(pos.radar, day) })
      res.equal.series.push({ day, value: valueAt(pos.equal, day) })
    }
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
  }
  res.radar.value = valueAt(pos.radar, endDay)
  res.equal.value = valueAt(pos.equal, endDay)
  return res
}

/** Turn a Yahoo chart response into StockData (keeps the last `years`). */
export function fromYahoo(symbol: string, j: any, years = 6): StockData | null {
  const r = j?.chart?.result?.[0]
  if (!r?.timestamp?.length) return null
  const q = r.indicators?.quote?.[0] ?? {}, adj = r.indicators?.adjclose?.[0]?.adjclose ?? q.close
  const out: StockData = { symbol, t: [], c: [], a: [], v: [], divs: [] }
  const cut = Math.floor(Date.now() / 864e5) - years * 366
  r.timestamp.forEach((ts: number, k: number) => {
    const day = Math.floor((ts + 3 * 3600) / 86400), c = q.close?.[k], a = adj?.[k]
    if (day < cut || c == null || a == null || !(c > 0)) return
    if (out.t.length && out.t[out.t.length - 1] === day) return
    out.t.push(day); out.c.push(Math.round(c * 1e4) / 1e4); out.a.push(Math.round(a * 1e4) / 1e4); out.v!.push(q.volume?.[k] ?? 0)
  })
  for (const dv of Object.values(r.events?.dividends ?? {}) as any[]) {
    const day = Math.floor((dv.date + 3 * 3600) / 86400)
    if (day >= cut) out.divs!.push({ d: day, a: dv.amount })
  }
  out.divs!.sort((x, y) => x.d - y.d)
  return out.t.length ? out : null
}

/** BVB instrument page → fundamentals table. */
export function parseBvbIndicators(html: string): { per: number | null; pbv: number | null; eps: number | null; divy: number | null; mcap: number | null; name: string | null } {
  const cell = (label: string) => {
    const m = html.match(new RegExp(`<td[^>]*>\\s*${label.replace('/', '\\/')}\\s*</td>\\s*<td[^>]*>\\s*(-?[\\d.,]+)\\s*</td>`, 'i'))
    if (!m) return null
    const v = Number(m[1].replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(v) ? v : null
  }
  const title = html.match(/<title>\s*BVB\s*-\s*\S+\s+\S+\s+([^<]+?)\s*<\/title>/i)?.[1] ?? null
  return { per: cell('PER'), pbv: cell('P/BV'), eps: cell('EPS'), divy: cell('DIVY'), mcap: cell('Capitalizare'), name: title }
}

export { r1 }
