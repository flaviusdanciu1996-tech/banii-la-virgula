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
  o?: number[] // open (same scale as close)
  h?: number[] // high
  l?: number[] // low
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
  macd: { line: number; signal: number; hist: number; rising: boolean } | null // 12/26/9, in % of price
  boll: { mid: number; up: number; low: number; pctB: number; width: number } | null // 20 days, ±2 deviations
  volRatio: number | null // volume of the last 20 days ÷ the last 3 months (1 = normal)
  roe: number | null // % — return on equity, = P/BV ÷ P/E
  beta: number | null // how strongly it moves with the whole market (1 = like the market)
}

/** Daily average return of all stocks (an equal-weight "market"), used for beta. */
export type Market = Map<number, number>
export function marketReturns(stocks: StockData[]): Market {
  const sum = new Map<number, { s: number; n: number }>()
  for (const st of stocks) for (let k = 1; k < st.t.length; k++) {
    if (!(st.a[k - 1] > 0) || st.t[k] - st.t[k - 1] > 5) continue
    const r = st.a[k] / st.a[k - 1] - 1
    if (Math.abs(r) > 0.4) continue
    const x = sum.get(st.t[k]) ?? { s: 0, n: 0 }; x.s += r; x.n++; sum.set(st.t[k], x)
  }
  const out: Market = new Map()
  for (const [d, x] of sum) if (x.n >= 3) out.set(d, x.s / x.n)
  return out
}

function emaSeries(xs: number[], from: number, to: number, n: number): number[] {
  const k = 2 / (n + 1), out: number[] = []
  let e = xs[from]
  for (let i = from; i <= to; i++) { e = i === from ? xs[i] : xs[i] * k + e * (1 - k); out.push(e) }
  return out
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
    divYield, turnover, ...extraIndicators(s, i, useBvbFundamentals),
  }
}

let MARKET: Market | null = null
/** Set once with all stocks so beta can be computed. */
export function setMarket(m: Market | null) { MARKET = m }

function extraIndicators(s: StockData, i: number, useBvbFundamentals: boolean) {
  const a = s.a
  let macd: Indicators['macd'] = null
  if (i >= 60) {
    const from = Math.max(0, i - 300)
    const e12 = emaSeries(a, from, i, 12), e26 = emaSeries(a, from, i, 26)
    const line = e12.map((x, k) => x - e26[k])
    const sig = emaSeries(line, 0, line.length - 1, 9)
    const L = line.length - 1, p = a[i]
    const hist = line[L] - sig[L], prevHist = line[L - 1] - sig[L - 1]
    macd = { line: (line[L] / p) * 100, signal: (sig[L] / p) * 100, hist: (hist / p) * 100, rising: hist > prevHist }
  }
  let boll: Indicators['boll'] = null
  if (i >= 19) {
    let m = 0; for (let k = i - 19; k <= i; k++) m += a[k]; m /= 20
    let v = 0; for (let k = i - 19; k <= i; k++) v += (a[k] - m) ** 2
    const sd = Math.sqrt(v / 20), up = m + 2 * sd, low = m - 2 * sd
    boll = { mid: m, up, low, pctB: up > low ? (a[i] - low) / (up - low) : 0.5, width: m ? ((up - low) / m) * 100 : 0 }
  }
  let volRatio: number | null = null
  if (s.v && i >= 63) {
    let a20 = 0, a63 = 0
    for (let k = i - 19; k <= i; k++) a20 += s.v[k] ?? 0
    for (let k = i - 62; k <= i; k++) a63 += s.v[k] ?? 0
    volRatio = a63 > 0 && a20 > 0 ? (a20 / 20) / (a63 / 63) : null
  }
  const roe = useBvbFundamentals && s.per != null && s.pbv != null && s.per > 0 && s.pbv > 0 ? (s.pbv / s.per) * 100 : null
  let beta: number | null = null
  if (MARKET && i >= 120) {
    const xs: number[] = [], ys: number[] = []
    for (let k = Math.max(1, i - 250); k <= i; k++) {
      const m = MARKET.get(s.t[k])
      if (m == null || !(a[k - 1] > 0) || s.t[k] - s.t[k - 1] > 5) continue
      xs.push(m); ys.push(a[k] / a[k - 1] - 1)
    }
    if (xs.length > 80) {
      const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length
      let cov = 0, vx = 0
      for (let k = 0; k < xs.length; k++) { cov += (xs[k] - mx) * (ys[k] - my); vx += (xs[k] - mx) ** 2 }
      beta = vx > 0 ? cov / vx : null
    }
  }
  return { macd, boll, volRatio, roe, beta }
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
    div = dy >= 8 ? 12 : dy >= 6 ? 10 : dy >= 4 ? 7 : dy >= 2 ? 3 : 0
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
    let p = 6, b = 4, q = 4
    if (per != null) {
      p = per <= 0 ? 0 : per <= 6 ? 12 : per <= 10 ? 10 : per <= 15 ? 6 : per <= 20 ? 3 : 0
      reasons.push({ good: per > 0 && per <= 10 ? true : per <= 0 || per > 20 ? false : null, text: per <= 0 ? 'Firma e pe pierdere (P/E negativ)' : `P/E ${fmt(per)} — ${per <= 10 ? 'ieftină față de profit' : per <= 15 ? 'preț corect' : 'scumpă față de profit'}` })
    } else reasons.push({ good: null, text: 'P/E indisponibil pe BVB (pierdere sau firmă listată din străinătate)' })
    if (pbv != null) {
      b = pbv <= 1 ? 8 : pbv <= 1.5 ? 6 : pbv <= 2.5 ? 3 : 1
      reasons.push({ good: pbv <= 1.2 ? true : pbv > 2.5 ? false : null, text: `P/BV ${fmt(pbv, 2)} — ${pbv <= 1 ? 'sub valoarea din bilanț' : pbv <= 2.5 ? 'normal' : 'mult peste valoarea din bilanț'}` })
    }
    if (ind.roe != null) {
      q = ind.roe >= 20 ? 8 : ind.roe >= 15 ? 6 : ind.roe >= 10 ? 4 : ind.roe >= 5 ? 2 : 0
      reasons.push({ good: ind.roe >= 15 ? true : ind.roe < 8 ? false : null, text: `ROE ${fmt(ind.roe)}% — ${ind.roe >= 15 ? 'firma face profit bun din banii ei' : ind.roe >= 8 ? 'profitabilitate medie' : 'profitabilitate slabă'}` })
    }
    fund = div + p + b + q
  } else fund = Math.round(div * (40 / 12))

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

  // Extra signals — shown, not scored (they get points only after they prove themselves in the backtest)
  if (ind.macd) reasons.push({ good: ind.macd.hist > 0 && ind.macd.rising ? true : ind.macd.hist < 0 && !ind.macd.rising ? false : null, text: `MACD ${ind.macd.hist > 0 ? 'peste' : 'sub'} semnal${ind.macd.rising ? ', în accelerare' : ', încetinește'} — ${ind.macd.hist > 0 ? 'impuls de creștere' : 'impuls de scădere'}` })
  if (ind.boll) reasons.push({ good: ind.boll.pctB < 0.15 ? true : ind.boll.pctB > 0.95 ? false : null, text: ind.boll.pctB < 0.15 ? 'Lângă banda de jos Bollinger — ieftină față de ultimele 20 de zile' : ind.boll.pctB > 0.95 ? 'Lângă banda de sus Bollinger — a urcat repede' : `În interiorul benzilor Bollinger (${Math.round(ind.boll.pctB * 100)}%)` })
  if (ind.volRatio != null && (ind.volRatio > 1.5 || ind.volRatio < 0.6)) reasons.push({ good: null, text: ind.volRatio > 1.5 ? `Volum de ${fmt(ind.volRatio)}× peste normal — interes mare acum` : 'Volum sub normal — puțin interes acum' })
  if (ind.beta != null) reasons.push({ good: ind.beta < 0.8 ? true : ind.beta > 1.3 ? false : null, text: `Beta ${fmt(ind.beta, 2)} — ${ind.beta < 0.8 ? 'mai calmă decât bursa' : ind.beta > 1.3 ? 'amplifică mișcările bursei' : 'se mișcă cam ca bursa'}` })

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

export interface Rules { minDiv?: number | null; maxPer?: number | null; maxPbv?: number | null; aboveMa200?: boolean; maxRsi?: number | null; minScore?: number | null; minRoe?: number | null; maxBeta?: number | null; macdUp?: boolean; nearLowBand?: boolean }
export function passesRules(s: StockData, sc: Score, r: Rules): { ok: boolean; fails: string[] } {
  const f: string[] = []
  if (r.minDiv != null && !((sc.ind.divYield ?? 0) >= r.minDiv)) f.push(`dividend sub ${r.minDiv}%`)
  if (r.maxPer != null && !(s.per != null && s.per > 0 && s.per <= r.maxPer)) f.push(`P/E peste ${r.maxPer}`)
  if (r.maxPbv != null && !(s.pbv != null && s.pbv <= r.maxPbv)) f.push(`P/BV peste ${r.maxPbv}`)
  if (r.aboveMa200 && !(sc.ind.ma200 != null && s.a[s.a.length - 1] > sc.ind.ma200)) f.push('sub media de 200 de zile')
  if (r.maxRsi != null && !(sc.ind.rsi != null && sc.ind.rsi <= r.maxRsi)) f.push(`RSI peste ${r.maxRsi}`)
  if (r.minScore != null && sc.total < r.minScore) f.push(`scor sub ${r.minScore}`)
  if (r.minRoe != null && !(sc.ind.roe != null && sc.ind.roe >= r.minRoe)) f.push(`ROE sub ${r.minRoe}%`)
  if (r.maxBeta != null && !(sc.ind.beta != null && sc.ind.beta <= r.maxBeta)) f.push(`beta peste ${r.maxBeta}`)
  if (r.macdUp && !(sc.ind.macd && sc.ind.macd.hist > 0)) f.push('MACD sub semnal')
  if (r.nearLowBand && !(sc.ind.boll && sc.ind.boll.pctB < 0.25)) f.push('nu e lângă banda de jos Bollinger')
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
  signalMonths: number // months where the strategy found something (else the money was spread over all)
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
export type RankFn = (s: StockData, i: number) => number | null
export function backtest(stocks: StockData[], startDay: number, endDay: number, monthly = 1000, top = 3, strategy: StrategyId | RankFn = 'radar'): BacktestResult {
  const usable = stocks.filter(s => s.t.length > 260)
  const pos = { radar: new Map<string, number>(), equal: new Map<string, number>() }
  const res: BacktestResult = { months: 0, signalMonths: 0, invested: 0, radar: { value: 0, series: [], picks: [] }, equal: { value: 0, series: [] } }
  const rank = typeof strategy === 'function' ? strategy : STRATEGIES[strategy].rank
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
      if (ranked.length) res.signalMonths++
      else ranked = live.map(x => ({ ...x, r: 0 })) // nothing qualifies: spread it
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
  const out: StockData = { symbol, t: [], c: [], o: [], h: [], l: [], a: [], v: [], divs: [] }
  const cut = Math.floor(Date.now() / 864e5) - years * 366
  r.timestamp.forEach((ts: number, k: number) => {
    const day = Math.floor((ts + 3 * 3600) / 86400), c = q.close?.[k], a = adj?.[k]
    if (day < cut || c == null || a == null || !(c > 0)) return
    if (out.t.length && out.t[out.t.length - 1] === day) return
    const R = (x: number | null | undefined) => Math.round((x ?? c) * 1e4) / 1e4
    out.t.push(day); out.c.push(Math.round(c * 1e4) / 1e4); out.o!.push(R(q.open?.[k])); out.h!.push(Math.max(R(q.high?.[k]), R(c))); out.l!.push(Math.min(R(q.low?.[k]), R(c))); out.a.push(Math.round(a * 1e4) / 1e4); out.v!.push(q.volume?.[k] ?? 0)
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

/** Change of the equal-weight market between two days, in %. */
export function marketChange(m: Market | null, fromDay: number, toDay: number): number | null {
  if (!m) return null
  let g = 1, n = 0
  for (const [d, r] of m) if (d > fromDay && d <= toDay) { g *= 1 + r; n++ }
  return n ? (g - 1) * 100 : null
}
export function getMarket() { return MARKET }

/** Daily bars → weekly candles (Monday-based): open of the first day, close of the last, highest high, lowest low. */
export interface Candle { day: number; o: number; h: number; l: number; c: number; v: number }
export function weeklyCandles(s: StockData, fromDay: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < s.t.length; i++) {
    const d = s.t[i]
    if (d < fromDay) continue
    const wk = d - ((d + 3) % 7) // 1970-01-01 was a Thursday → this is that week's Monday
    const c = s.c[i], o = s.o?.[i] ?? c, h = Math.max(s.h?.[i] ?? c, c, o), l = Math.min(s.l?.[i] ?? c, c, o), v = s.v?.[i] ?? 0
    const last = out[out.length - 1]
    if (last && last.day === wk) { last.c = c; last.h = Math.max(last.h, h); last.l = Math.min(last.l, l); last.v += v }
    else out.push({ day: wk, o, h, l, c, v })
  }
  return out
}
