// Bucharest Stock Exchange prices and portfolio value. Pure, no imports:
// deployed as-is with the `asset-value` edge function.

export interface Holding { symbol: string; qty: number; cost: number; price?: number | null }

/** "1,234.56" (Tradeville) or "1.234,56" → 1234.56. */
export function num(s: string | undefined | null): number {
  let t = String(s ?? '').replace(/[\s ]/g, '').replace(/[^\d.,-]/g, '')
  if (!t || t === '-') return 0
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.')
  if (lc >= 0 && ld >= 0) t = lc > ld ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (lc >= 0) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  const v = Number(t)
  return Number.isFinite(v) ? v : 0
}
/** Value of the positions at their last known price (cost when no price yet). */
export function holdingsValue(h: Holding[]): number {
  return h.reduce((a, x) => a + (x.price ? Math.round(x.qty * x.price * 100) : x.cost), 0)
}

/** BVB instrument page → last price ("Ultimul pret 35,9800"). */
export const bvbUrl = (symbol: string) => `https://www.bvb.ro/FinancialInstruments/Details/FinancialInstrumentsDetails.aspx?s=${encodeURIComponent(symbol)}`
export function parseBvbPrice(html: string): number | null {
  const m = html.match(/Ultimul pret<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*</i) ?? html.match(/Pret referinta<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*</i)
  if (!m) return null
  const v = num(m[1])
  return v > 0 ? v : null
}
