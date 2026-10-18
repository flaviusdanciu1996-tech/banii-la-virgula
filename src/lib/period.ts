// Budget periods that start on the user's payday (1–31), clamped to month length.

export type Period = { start: string; end: string } // inclusive ISO dates YYYY-MM-DD

export const MONTHS = ['Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie', 'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie']
export const MONTHS_SHORT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec']
export const WEEKDAYS = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']
export const WEEKDAYS_SHORT = ['dum', 'lun', 'mar', 'mie', 'joi', 'vin', 'sâm']

const pad = (n: number) => String(n).padStart(2, '0')
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}` // m is 0-based
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

export function parseIso(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m: m - 1, d }
}

export function todayIso(now = new Date()): string {
  return iso(now.getFullYear(), now.getMonth(), now.getDate())
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseIso(s)
  const t = new Date(Date.UTC(y, m, d + n))
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}

export function diffDays(a: string, b: string): number {
  const A = parseIso(a), B = parseIso(b)
  return Math.round((Date.UTC(B.y, B.m, B.d) - Date.UTC(A.y, A.m, A.d)) / 86400000)
}

function startIn(y: number, m: number, payday: number): string {
  // normalise month overflow
  const t = new Date(Date.UTC(y, m, 1))
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth()
  return iso(yy, mm, Math.min(payday, daysInMonth(yy, mm)))
}

/** The period containing `date`. */
export function periodFor(date: string, payday = 1): Period {
  const pd = Math.min(31, Math.max(1, Math.round(payday) || 1))
  const { y, m } = parseIso(date)
  let start = startIn(y, m, pd)
  if (date < start) start = startIn(y, m - 1, pd)
  const s = parseIso(start)
  const end = addDays(startIn(s.y, s.m + 1, pd), -1)
  return { start, end }
}

/** Move a period by n periods (n can be negative). */
export function shiftPeriod(p: Period, n: number, payday = 1): Period {
  const s = parseIso(p.start)
  const pd = Math.min(31, Math.max(1, Math.round(payday) || 1))
  return periodFor(startIn(s.y, s.m + n, pd), pd)
}

export function periodLabel(p: Period, payday = 1): string {
  const s = parseIso(p.start), e = parseIso(p.end)
  if (payday <= 1 || (s.d === 1 && e.d === daysInMonth(e.y, e.m) && s.m === e.m)) return `${MONTHS[s.m]} ${s.y}`
  const sameYear = s.y === e.y
  return `${s.d} ${MONTHS_SHORT[s.m]}${sameYear ? '' : ' ' + s.y} – ${e.d} ${MONTHS_SHORT[e.m]} ${e.y}`
}

export function periodLength(p: Period): number {
  return diffDays(p.start, p.end) + 1
}

/** Days elapsed including today (0 for future periods, full length for past ones). */
export function daysElapsed(p: Period, today: string): number {
  if (today < p.start) return 0
  if (today > p.end) return periodLength(p)
  return diffDays(p.start, today) + 1
}

export function daysLeft(p: Period, today: string): number {
  if (today > p.end) return 0
  if (today < p.start) return periodLength(p)
  return diffDays(today, p.end)
}

export const inPeriod = (date: string, p: Period) => date >= p.start && date <= p.end

export function dayLabel(date: string): string {
  const { y, m, d } = parseIso(date)
  const wd = new Date(Date.UTC(y, m, d)).getUTCDay()
  return `${WEEKDAYS[wd]}, ${d} ${MONTHS[m].toLowerCase()}`
}

export function shortDayLabel(date: string): string {
  const { y, m, d } = parseIso(date)
  const wd = new Date(Date.UTC(y, m, d)).getUTCDay()
  return `${WEEKDAYS_SHORT[wd]}, ${d} ${MONTHS_SHORT[m]}`
}
