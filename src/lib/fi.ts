// Money-weighted yearly return and the road to financial independence. Pure functions.

export interface Flow { d: string; amt: number } // amt in bani: + money you put in, − money you took out

/**
 * Yearly return of an account where you put money in and took it out at different times (XIRR):
 * the rate at which all deposits, withdrawals and today's value balance out. Null when it can't be solved.
 */
export function xirr(flows: Flow[], value: number, today: string): number | null {
  const cf = flows.map(f => ({ t: f.d, a: -f.amt })).concat({ t: today, a: value })
  if (!cf.some(c => c.a < 0) || !cf.some(c => c.a > 0)) return null
  const t0 = Date.parse(cf.reduce((m, c) => (c.t < m ? c.t : m), cf[0].t))
  const yrs = cf.map(c => (Date.parse(c.t) - t0) / (365.25 * 864e5))
  const npv = (r: number) => cf.reduce((s, c, i) => s + c.a / Math.pow(1 + r, yrs[i]), 0)
  let lo = -0.99, hi = 10
  if (npv(lo) * npv(hi) > 0) return null
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2
    if (npv(lo) * npv(m) <= 0) hi = m; else lo = m
  }
  return (lo + hi) / 2
}

/** Months until `start` + `monthly` deposits growing at `yearlyPct` reach `target` (null if never / over 100 years). */
export function monthsToTarget(start: number, monthly: number, yearlyPct: number, target: number): number | null {
  if (start >= target) return 0
  const g = Math.pow(1 + yearlyPct / 100, 1 / 12)
  let v = start
  for (let n = 1; n <= 1200; n++) {
    v = v * g + monthly
    if (v >= target) return n
  }
  return null
}

/** Value after `months` with monthly deposits. */
export function futureValue(start: number, monthly: number, yearlyPct: number, months: number): number {
  const g = Math.pow(1 + yearlyPct / 100, 1 / 12)
  let v = start
  for (let n = 0; n < months; n++) v = v * g + monthly
  return Math.round(v)
}

/** Monthly income a pot can pay forever-ish with the 4% rule. */
export const safeMonthly = (pot: number) => Math.round((pot * 0.04) / 12)
/** Pot needed to cover monthly spending with the 4% rule (×300 months = ×25 years). */
export const potForSpending = (monthlySpend: number) => monthlySpend * 300

export function addMonthsLabel(today: string, months: number): string {
  const [y, m] = today.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  const names = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']
  return `${names[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
