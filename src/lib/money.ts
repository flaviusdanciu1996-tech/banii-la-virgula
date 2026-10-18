// All money is kept as whole minor units (bani / euro cents). Never floats.

export type Currency = 'RON' | 'EUR' | 'USD'

export const CUR_LABEL: Record<string, string> = new Proxy({ RON: 'lei', EUR: '€', USD: '$' } as Record<string, string>, { get: (t, k: string) => t[k] ?? k })

/** Parse Romanian-style input: "23,50", "1.234,50", "12", "1 234,5". Returns minor units or null. */
export function parseMoney(input: string): number | null {
  let s = String(input ?? '').replace(/\s|lei|ron|€|eur|\$|usd/gi, '')
  if (!s) return null
  let neg = false
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  if (s.includes(',')) {
    // comma is the decimal separator; dots are thousands separators
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" or "12.345.678" -> thousands
    s = s.replace(/\./g, '')
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null
  const [int, frac = ''] = s.split('.')
  const v = Number(int) * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isSafeInteger(v)) return null
  return neg ? -v : v
}

const nf = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions)

/** 123456 -> "1.234,56" */
export function fmtNum(minor: number): string {
  return nf.format((minor || 0) / 100)
}

/** 123456, 'RON' -> "1.234,56 lei" */
export function fmt(minor: number, cur: Currency = 'RON'): string {
  return `${fmtNum(minor)} ${CUR_LABEL[cur]}`
}

/** Signed with explicit + for positives. */
export function fmtSigned(minor: number, cur: Currency = 'RON'): string {
  return (minor > 0 ? '+' : minor < 0 ? '−' : '') + fmt(Math.abs(minor), cur)
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

/** Convert minor units in `cur` to RON minor units with rates expressed as RON per 1 unit. */
export function toRon(minor: number, cur: Currency, rates: { EUR: number; USD: number }): number {
  if (cur === 'RON') return minor
  const r = cur === 'EUR' ? rates.EUR : rates.USD
  return Math.round(minor * r)
}
