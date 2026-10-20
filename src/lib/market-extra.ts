// Sectors, trading costs and dividends for BVB stocks. Pure functions.

import type { StockData } from './radar.ts'
import { isoOf } from './radar.ts'

// ---------- Sectors ----------
export const SECTORS: Record<string, string> = {
  H2O: 'Energie și utilități', SNP: 'Energie și utilități', SNG: 'Energie și utilități', SNN: 'Energie și utilități',
  TGN: 'Energie și utilități', TEL: 'Energie și utilități', EL: 'Energie și utilități', PE: 'Energie și utilități', COTE: 'Energie și utilități',
  TLV: 'Bănci și financiar', BRD: 'Bănci și financiar', BVB: 'Bănci și financiar', FP: 'Bănci și financiar', NC: 'Bănci și financiar',
  M: 'Sănătate', ATB: 'Sănătate',
  DIGI: 'Telecom',
  AQ: 'Consum', SFG: 'Consum', WINE: 'Consum',
  ALR: 'Industrie și transport', TRP: 'Industrie și transport', TTS: 'Industrie și transport',
  ONE: 'Imobiliare',
  TVBETETF: 'ETF (diversificat)',
}
export const sectorOf = (sym: string) => SECTORS[sym] ?? 'Altele'
export const DIVERSIFIED = 'ETF (diversificat)'

/** Share of the portfolio (0–1) per sector; the ETF counts as diversified, not as one sector. */
export function sectorWeights(holdings: { symbol: string; value: number }[]): Map<string, number> {
  const total = holdings.reduce((a, h) => a + h.value, 0)
  const m = new Map<string, number>()
  if (!total) return m
  for (const h of holdings) m.set(sectorOf(h.symbol), (m.get(sectorOf(h.symbol)) ?? 0) + h.value / total)
  return m
}

// ---------- Trading costs ----------
export interface FeeModel { fixed: number; pct: number; fromHistory: boolean } // lei + share of value
// Fitted on the user's Tradeville history (≈ 1,6 lei + 0,42% per order, BVB fees included).
export const DEFAULT_FEE: FeeModel = { fixed: 1.6, pct: 0.0042, fromHistory: false }

/** Least-squares fit fee = fixed + pct × value on past orders (values and fees in lei). */
export function fitFee(orders: { value: number; fee: number }[]): FeeModel {
  const xs = orders.filter(o => o.value > 0 && o.fee > 0 && o.fee < o.value)
  if (xs.length < 5) return DEFAULT_FEE
  const n = xs.length, mx = xs.reduce((a, o) => a + o.value, 0) / n, my = xs.reduce((a, o) => a + o.fee, 0) / n
  let sxy = 0, sxx = 0
  for (const o of xs) { sxy += (o.value - mx) * (o.fee - my); sxx += (o.value - mx) ** 2 }
  const pct = sxx ? sxy / sxx : 0, fixed = my - pct * mx
  if (!(pct >= 0 && pct < 0.03 && fixed >= 0 && fixed < 50)) return DEFAULT_FEE
  return { fixed: Math.round(fixed * 100) / 100, pct: Math.round(pct * 1e5) / 1e5, fromHistory: true }
}
export const feeFor = (value: number, f: FeeModel = DEFAULT_FEE) => (value > 0 ? Math.round((f.fixed + f.pct * value) * 100) / 100 : 0)
/** Smallest order where the fee stays under `maxPct` of the money. */
export const minSensibleOrder = (f: FeeModel = DEFAULT_FEE, maxPct = 0.01) => Math.ceil(f.fixed / Math.max(0.0001, maxPct - f.pct) / 10) * 10

/** Price for a limit order: a little above the last price (so it fills) and rounded to sensible decimals. */
export function limitPrice(price: number, slack = 0.01): number {
  const p = price * (1 + slack)
  const d = p < 1 ? 4 : p < 10 ? 3 : p < 100 ? 2 : 1
  const k = 10 ** d
  return Math.ceil(p * k) / k
}
export const priceDecimals = (p: number) => (p < 1 ? 4 : p < 10 ? 3 : 2)

// ---------- Dividends ----------
export interface DivInfo {
  last: { date: string; amount: number; yieldPct: number | null }[] // newest first, up to 4
  perYear: number // usual number of payments per year
  nextEstimate: string | null // ISO, estimated from history — not official
  buyBy: string | null // last trading day to buy to receive it (day before the ex-date)
}
const prevWeekday = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z')
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6)
  return d.toISOString().slice(0, 10)
}

export function dividendInfo(s: StockData, todayIso: string): DivInfo | null {
  const divs = (s.divs ?? []).filter(d => d.a > 0)
  if (!divs.length) return null
  const priceOn = (day: number) => { let i = s.t.length - 1; while (i > 0 && s.t[i] >= day) i--; return s.c[i] ?? null }
  const last = [...divs].reverse().slice(0, 4).map(d => { const p = priceOn(d.d); return { date: isoOf(d.d), amount: d.a, yieldPct: p ? Math.round((d.a / p) * 1000) / 10 : null } })
  const today = Date.parse(todayIso) / 864e5
  const recent = divs.filter(d => d.d > today - 3 * 365)
  const perYear = Math.max(1, Math.round(recent.length / 3))
  // Next one: a year after the matching payment last year (only if the company paid in the last ~15 months).
  let nextEstimate: string | null = null
  if (divs[divs.length - 1].d > today - 460) {
    const cands = divs.map(d => d.d + 365 * Math.ceil((today - d.d) / 365)).filter(d => d >= today - 7)
    const n = cands.length ? Math.min(...cands) : null
    if (n != null && n - today < 400) nextEstimate = isoOf(n)
  }
  return { last, perYear, nextEstimate, buyBy: nextEstimate ? prevWeekday(nextEstimate) : null }
}
