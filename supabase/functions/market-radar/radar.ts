// Server copy of the Radar score (same numbers as src/lib/radar.ts; reason texts and info-only indicators left out).
// Keep the point tables here in step with the app when the score changes.
export interface StockData { symbol: string; name?: string; per?: number | null; pbv?: number | null; eps?: number | null; divy?: number | null; mcap?: number | null; t: number[]; c: number[]; o?: number[]; h?: number[]; l?: number[]; a: number[]; v?: number[]; divs?: { d: number; a: number }[] }
export type Label = 'buy' | 'neutral' | 'hot' | 'avoid'
export const LABELS: Record<Label, { text: string; emoji: string }> = {
  buy: { text: 'Zonă de cumpărare', emoji: '🟢' },
  neutral: { text: 'Neutru', emoji: '🟡' },
  hot: { text: 'Supraîncălzită', emoji: '🟠' },
  avoid: { text: 'Așteaptă', emoji: '🔴' },
}
function sma(xs: number[], end: number, n: number): number | null { if (end + 1 < n) return null; let s = 0; for (let i = end - n + 1; i <= end; i++) s += xs[i]; return s / n }
function rsi(xs: number[], end: number, n = 14): number | null {
  if (end < n + 1) return null
  const start = Math.max(1, end - n * 10)
  let g = 0, l = 0
  for (let i = start; i < start + n; i++) { const d = xs[i] - xs[i - 1]; if (d > 0) g += d; else l -= d }
  g /= n; l /= n
  for (let i = start + n; i <= end; i++) { const d = xs[i] - xs[i - 1]; g = (g * (n - 1) + Math.max(0, d)) / n; l = (l * (n - 1) + Math.max(0, -d)) / n }
  if (l === 0) return 100
  return 100 - 100 / (1 + g / l)
}
export function indexAt(s: StockData, day: number): number { let lo = 0, hi = s.t.length - 1, ans = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] <= day) { ans = m; lo = m + 1 } else hi = m - 1 } return ans }
function indicators(s: StockData, i: number) {
  const a = s.a, c = s.c, day = s.t[i]
  const back = (days: number) => { const j = indexAt(s, day - days); return j >= 0 && j < i ? j : null }
  const y = back(365)
  let hi = -Infinity, lo = Infinity, peak = -Infinity, dd = 0
  const from = y ?? 0
  for (let k = from; k <= i; k++) { hi = Math.max(hi, a[k]); lo = Math.min(lo, a[k]); peak = Math.max(peak, a[k]); dd = Math.min(dd, a[k] / peak - 1) }
  let vol: number | null = null
  if (i - from > 40) { const rets: number[] = []; for (let k = from + 1; k <= i; k++) if (a[k - 1] > 0) rets.push(Math.log(a[k] / a[k - 1])); const m = rets.reduce((x, z) => x + z, 0) / rets.length; vol = Math.sqrt(rets.reduce((x, z) => x + (z - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) * 100 }
  let divYield: number | null = null
  if (s.divy != null) divYield = s.divy
  else if (s.divs) { const sum = s.divs.filter(d => d.d > day - 365 && d.d <= day).reduce((x, d) => x + d.a, 0); divYield = c[i] > 0 ? (sum / c[i]) * 100 : null }
  const roe = s.per != null && s.pbv != null && s.per > 0 && s.pbv > 0 ? (s.pbv / s.per) * 100 : null
  return { ma50: sma(a, i, 50), ma200: sma(a, i, 200), rsi: rsi(a, i), pos52: y !== null && hi > lo ? (a[i] - lo) / (hi - lo) : null, vol, dd: y !== null ? dd * 100 : null, divYield, roe }
}
export function score(s: StockData, i = s.t.length - 1): { total: number; label: Label } {
  const ind = indicators(s, i), a = s.a[i]
  const dy = ind.divYield
  const div = dy == null ? 0 : dy >= 8 ? 12 : dy >= 6 ? 10 : dy >= 4 ? 7 : dy >= 2 ? 3 : 0
  let fund: number
  if (/ETF/i.test(s.symbol)) fund = 20
  else {
    const per = s.per, pbv = s.pbv
    const p = per == null ? 6 : per <= 0 ? 0 : per <= 6 ? 12 : per <= 10 ? 10 : per <= 15 ? 6 : per <= 20 ? 3 : 0
    const b = pbv == null ? 4 : pbv <= 1 ? 8 : pbv <= 1.5 ? 6 : pbv <= 2.5 ? 3 : 1
    const q = ind.roe == null ? 4 : ind.roe >= 20 ? 8 : ind.roe >= 15 ? 6 : ind.roe >= 10 ? 4 : ind.roe >= 5 ? 2 : 0
    fund = div + p + b + q
  }
  let tech = 0
  if (ind.ma200 != null) { if (a > ind.ma200) tech += 12; if (ind.ma50 != null && ind.ma50 > ind.ma200) tech += 8 } else tech += 10
  const R = ind.rsi
  if (R != null) tech += R < 30 ? 6 : R <= 50 ? 10 : R <= 65 ? 7 : R <= 75 ? 3 : 0
  if (ind.pos52 != null) tech += ind.pos52 <= 0.4 ? 10 : ind.pos52 <= 0.7 ? 6 : 3
  let risk = 0
  risk += ind.vol != null ? (ind.vol < 20 ? 10 : ind.vol < 30 ? 7 : ind.vol < 45 ? 4 : 1) : 5
  risk += ind.dd != null ? (ind.dd > -15 ? 10 : ind.dd > -30 ? 6 : ind.dd > -50 ? 3 : 0) : 5
  const total = Math.max(0, Math.min(100, Math.round(fund + tech + risk)))
  const label: Label = R != null && R > 75 && total >= 45 ? 'hot' : total >= 65 ? 'buy' : total >= 45 ? 'neutral' : 'avoid'
  return { total, label }
}
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
  for (const dv of Object.values(r.events?.dividends ?? {}) as any[]) { const day = Math.floor((dv.date + 3 * 3600) / 86400); if (day >= cut) out.divs!.push({ d: day, a: dv.amount }) }
  out.divs!.sort((x, y) => x.d - y.d)
  return out.t.length ? out : null
}
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

