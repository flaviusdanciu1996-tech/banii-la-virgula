// Strategy lab: the methods collected from Ciprian's lessons and the books, written as rules the
// computer can check on any day using only the data known that day — then all run through the same
// monthly backtest on BVB history. Pure functions.

import type { StockData, RankFn } from './radar.ts'
import { backtest, STRATEGIES, indexAt, isoOf } from './radar.ts'
import { xirr } from './fi.ts'

// ---------- small helpers on adjusted prices ----------
const adjH = (s: StockData, k: number) => (s.h?.[k] != null && s.c[k] ? s.h[k] * (s.a[k] / s.c[k]) : s.a[k])
const avgVol = (s: StockData, from: number, to: number) => {
  let t = 0, n = 0
  for (let k = Math.max(0, from); k <= to; k++) { t += s.v?.[k] ?? 0; n++ }
  return n ? t / n : 0
}
function emaAt(xs: number[], end: number, n: number, warm = n * 4): number | null {
  const from = end - warm
  if (from < 0) return null
  const k = 2 / (n + 1)
  let e = xs[from]
  for (let i = from + 1; i <= end; i++) e = xs[i] * k + e * (1 - k)
  return e
}
function rsiAt(xs: number[], end: number, n = 14): number | null {
  const from = end - n * 6
  if (from < 1) return null
  let g = 0, l = 0
  for (let i = from; i < from + n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d }
  g /= n; l /= n
  for (let i = from + n; i <= end; i++) { const d = xs[i] - xs[i - 1]; g = (g * (n - 1) + Math.max(0, d)) / n; l = (l * (n - 1) + Math.max(0, -d)) / n }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l)
}
function pctB(xs: number[], end: number, n = 20): number | null {
  if (end < n) return null
  let m = 0
  for (let i = end - n + 1; i <= end; i++) m += xs[i]
  m /= n
  let v = 0
  for (let i = end - n + 1; i <= end; i++) v += (xs[i] - m) ** 2
  const sd = Math.sqrt(v / n)
  return sd ? (xs[end] - (m - 2 * sd)) / (4 * sd) : 0.5
}

// ---------- Ciprian: descending channel → breakout of the upper line → pullback ----------
/** Upper line of a falling channel fitted on the highs of days [a, b]: slope, intercept and touches. */
function fallingUpperLine(s: StockData, a: number, b: number) {
  const n = b - a + 1
  let sx = 0, sy = 0, sxy = 0, sxx = 0
  for (let k = a; k <= b; k++) { const x = k - a, y = adjH(s, k); sx += x; sy += y; sxy += x * y; sxx += x * x }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), icpt = (sy - slope * sx) / n
  let up = 0
  for (let k = a; k <= b; k++) up = Math.max(up, adjH(s, k) - (icpt + slope * (k - a)))
  const at = (k: number) => icpt + up + slope * (k - a)
  let touches = 0, last = -99
  for (let k = a; k <= b; k++) if (adjH(s, k) >= at(k) * 0.985 && k - last > 3) { touches++; last = k }
  return { slope, at, touches, mean: sy / n }
}

export interface ChannelSignal { breakoutDay: number; line: number; touches: number; fallPct: number }
/**
 * True when, recently, price broke out above the upper line of a falling channel (≥3 touches) on higher
 * volume, and is now back near that line from above — "impuls, falsă ruptură, pullback".
 */
export function channelBreakoutPullback(s: StockData, i: number): ChannelSignal | null {
  if (i < 140 || !s.v) return null
  for (let j = i - 2; j >= i - 25; j--) {
    const a = j - 90, b = j - 3
    const L = fallingUpperLine(s, a, b)
    const fallPct = (-L.slope * (b - a)) / L.mean
    if (fallPct < 0.06 || L.touches < 3) continue // needs a real falling channel
    const line = L.at(j)
    if (!(s.a[j] > line * 1.01 && s.a[j - 1] <= L.at(j - 1) * 1.01)) continue // first close above the line
    if ((s.v[j] ?? 0) < 1.2 * avgVol(s, j - 20, j - 1)) continue // breakout on volume
    const now = L.at(i)
    let peak = 0
    for (let k = j; k <= i; k++) peak = Math.max(peak, s.a[k])
    const pulledBack = s.a[i] < peak * 0.98 && s.a[i] >= now * 0.98 && s.a[i] <= now * 1.06
    const calmVolume = avgVol(s, j + 1, i) <= (s.v[j] ?? 0)
    if (pulledBack && calmVolume) return { breakoutDay: s.t[j], line: now, touches: L.touches, fallPct }
    return null
  }
  return null
}

// ---------- the other methods from the books ----------
/** EMA10/EMA20 system: close > EMA10 > EMA20 (trend up); stronger spread ranks higher. */
const emaTrend: RankFn = (s, i) => {
  const e10 = emaAt(s.a, i, 10), e20 = emaAt(s.a, i, 20)
  return e10 != null && e20 != null && s.a[i] > e10 && e10 > e20 ? e10 / e20 - 1 : null
}
/** Bollinger + RSI: in the last 10 days price was at the lower band with RSI < 35, and RSI has turned up. */
const bbRsi: RankFn = (s, i) => {
  const rNow = rsiAt(s.a, i)
  if (rNow == null || rNow < 35) return null
  let best: number | null = null
  for (let k = i - 10; k < i; k++) {
    const b = pctB(s.a, k), r = rsiAt(s.a, k)
    if (b != null && r != null && b < 0.1 && r < 35) best = Math.max(best ?? -1, 35 - r)
  }
  return best
}
/** Breakout above the highest high of the previous ~3 months, on volume ≥1.5× normal, still holding. */
const volBreakout: RankFn = (s, i) => {
  if (i < 90 || !s.v) return null
  let hi = 0
  for (let k = i - 75; k <= i - 11; k++) hi = Math.max(hi, adjH(s, k))
  for (let j = i - 10; j <= i; j++) {
    const ratio = (s.v[j] ?? 0) / Math.max(1, avgVol(s, j - 20, j - 1))
    if (s.a[j] > hi && ratio >= 1.5 && s.a[i] >= hi * 0.98) return ratio
  }
  return null
}
const ciprian: RankFn = (s, i) => { const x = channelBreakoutPullback(s, i); return x ? x.touches + x.fallPct * 10 : null }

export interface LabStrategy { id: string; name: string; about: string; source: string; rank: RankFn }
export const LAB: LabStrategy[] = [
  { id: 'ciprian', name: 'Ieșire din canal + pullback', about: 'canal de scădere cu ≥3 atingeri, ruptură a liniei de sus pe volum, revenire la linie cu volum mic', source: 'Ciprian', rank: ciprian },
  { id: 'volbreak', name: 'Ruptură pe volum mare', about: 'trece peste maximul ultimelor ~3 luni cu volum de 1,5× peste normal și se menține', source: 'cărți (Tudor, XTB)', rank: volBreakout },
  { id: 'ema', name: 'EMA 10 / EMA 20', about: 'prețul peste EMA10, iar EMA10 peste EMA20 — trend de creștere', source: 'cartea Tudor', rank: emaTrend },
  { id: 'bbrsi', name: 'Bollinger + RSI', about: 'la banda de jos cu RSI sub 35, apoi RSI se întoarce în sus', source: 'cartea Tudor', rank: bbRsi },
  { id: 'radar', name: STRATEGIES.radar.name, about: STRATEGIES.radar.about, source: 'aplicația', rank: STRATEGIES.radar.rank },
  { id: 'divtrend', name: STRATEGIES.divtrend.name, about: STRATEGIES.divtrend.about, source: 'aplicația', rank: STRATEGIES.divtrend.rank },
  { id: 'momentum', name: STRATEGIES.momentum.name, about: STRATEGIES.momentum.about, source: 'aplicația', rank: STRATEGIES.momentum.rank },
  { id: 'lowvol', name: STRATEGIES.lowvol.name, about: STRATEGIES.lowvol.about, source: 'aplicația', rank: STRATEGIES.lowvol.rank },
]

export interface LabRow {
  id: string; name: string; about: string; source: string
  value: number; invested: number; gainPct: number; perYear: number | null; maxDrop: number
  signalMonths: number; months: number; lastPicks: string[]
  series: { day: number; value: number }[]
}
export interface LabResult { rows: LabRow[]; equal: LabRow; invested: number; months: number; start: string; end: string }

/** Biggest fall of the profit ratio (value ÷ money put in), in %, over the monthly series. */
function maxDrop(series: { value: number }[], monthly: number) {
  let peak = -Infinity, worst = 0
  series.forEach((p, k) => { const r = p.value / ((k + 1) * monthly); peak = Math.max(peak, r); worst = Math.min(worst, r / peak - 1) })
  return Math.round(worst * 1000) / 10
}

export function runLab(stocks: StockData[], years: number, top: number, monthly = 1000, only?: string[]): LabResult {
  const end = Math.max(...stocks.map(s => s.t[s.t.length - 1]))
  const start = end - years * 365
  const list = only ? LAB.filter(x => only.includes(x.id)) : LAB
  let equal: LabRow | null = null
  const rows = list.map(st => {
    const r = backtest(stocks, start, end, monthly, top, st.rank)
    const flows = r.radar.series.map(p => ({ d: isoOf(p.day), amt: monthly * 100 }))
    const row = (name: string, about: string, source: string, id: string, value: number, series: { day: number; value: number }[], picks: string[], signal: number): LabRow => ({
      id, name, about, source, value, invested: r.invested, gainPct: r.invested ? Math.round(((value - r.invested) / r.invested) * 1000) / 10 : 0,
      perYear: xirr(flows, Math.round(value * 100), isoOf(end)), maxDrop: maxDrop(series, monthly), signalMonths: signal, months: r.months, lastPicks: picks, series })
    if (!equal) equal = row('Toate, în părți egale', 'în fiecare lună, în toate acțiunile din Radar', 'reper', 'equal', r.equal.value, r.equal.series, [], r.months)
    return row(st.name, st.about, st.source, st.id, r.radar.value, r.radar.series, r.radar.picks[r.radar.picks.length - 1]?.symbols ?? [], r.signalMonths)
  }).sort((a, b) => b.value - a.value)
  const e = equal as unknown as LabRow
  return { rows, equal: e, invested: e.invested, months: e.months, start: isoOf(start), end: isoOf(end) }
}

export { indexAt }

// ---------- Does the signal itself work? (event study) ----------
export interface EventStats { horizon: number; n: number; avgRet: number; avgExcess: number; winRate: number; beatRate: number }
/**
 * Every time the rule fires on a stock (at most once per `gap` trading days per stock), look at what the
 * stock did in the next 1/3/6/12 months versus the whole market (equal weight) over the same days.
 */
export function eventStudy(stocks: StockData[], rank: RankFn, market: Map<number, number>, horizons = [21, 63, 126, 252], gap = 20, step = 2): { events: number; stats: EventStats[] } {
  const mDays = [...market.keys()].sort((a, b) => a - b)
  const mAt = (day: number) => { let lo = 0, hi = mDays.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (mDays[m] <= day) { ans = m; lo = m + 1 } else hi = m - 1 } return ans >= 0 ? market.get(mDays[ans])! : null }
  const acc = horizons.map(h => ({ horizon: h, rets: [] as number[], ex: [] as number[] }))
  let events = 0
  for (const s of stocks) {
    if (s.t.length < 300 || /ETF/.test(s.symbol)) continue
    let last = -1e9
    for (let i = 260; i < s.t.length - 21; i += step) {
      if (i - last < gap) continue
      if (rank(s, i) == null) continue
      last = i; events++
      acc.forEach(a => {
        const j = i + a.horizon
        if (j >= s.t.length) return
        const r = s.a[j] / s.a[i] - 1
        const m0 = mAt(s.t[i]), m1 = mAt(s.t[j])
        a.rets.push(r)
        if (m0 && m1) a.ex.push(r - (m1 / m0 - 1))
      })
    }
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : 0)
  return { events, stats: acc.map(a => ({ horizon: a.horizon, n: a.rets.length, avgRet: Math.round(avg(a.rets) * 1000) / 10, avgExcess: Math.round(avg(a.ex) * 1000) / 10,
    winRate: a.rets.length ? Math.round((a.rets.filter(x => x > 0).length / a.rets.length) * 100) : 0, beatRate: a.ex.length ? Math.round((a.ex.filter(x => x > 0).length / a.ex.length) * 100) : 0 })) }
}

/** Equal-weight market index (level by day), built from daily changes of all non-ETF stocks. */
export function marketIndex(stocks: StockData[]): Map<number, number> {
  const ch = new Map<number, number[]>()
  for (const s of stocks) {
    if (/ETF/.test(s.symbol)) continue
    for (let i = 1; i < s.t.length; i++) { const r = s.a[i] / s.a[i - 1] - 1; if (Math.abs(r) < 0.5) { const a = ch.get(s.t[i]) ?? []; a.push(r); ch.set(s.t[i], a) } }
  }
  const days = [...ch.keys()].sort((a, b) => a - b)
  const out = new Map<number, number>()
  let lvl = 100
  for (const d of days) { const a = ch.get(d)!; lvl *= 1 + a.reduce((x, y) => x + y, 0) / a.length; out.set(d, lvl) }
  return out
}
