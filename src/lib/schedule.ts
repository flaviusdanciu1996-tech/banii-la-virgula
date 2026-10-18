// Recurring dates and goal maths. Pure functions, tested in core.test.ts.
import { parseIso, iso, daysInMonth, addDays, diffDays } from './period.ts'

/** The date in month (y, m) for a monthly day, clamped to the month length. */
export function dayIn(y: number, m: number, day: number): string {
  const t = new Date(Date.UTC(y, m, 1))
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth()
  return iso(yy, mm, Math.min(day, daysInMonth(yy, mm)))
}

/** All monthly occurrences of `day` within [from, to] (inclusive). */
export function occurrences(day: number, from: string, to: string): string[] {
  if (from > to) return []
  const out: string[] = []
  const f = parseIso(from)
  for (let i = 0; i < 400; i++) {
    const d = dayIn(f.y, f.m + i, day)
    if (d > to) break
    if (d >= from) out.push(d)
  }
  return out
}

/** First occurrence on or after `from`. */
export function nextOccurrence(day: number, from: string): string {
  const f = parseIso(from)
  const d = dayIn(f.y, f.m, day)
  return d >= from ? d : dayIn(f.y, f.m + 1, day)
}

/** Dates an automatic recurring entry still has to post, up to today. */
export function duePostings(day: number, startDate: string, lastRun: string | null, today: string): string[] {
  const from = lastRun ? addDays(lastRun, 1) : startDate
  return occurrences(day, from, today)
}

/** Whole months left until a deadline (at least 1). */
export function monthsLeft(today: string, deadline: string): number {
  const a = parseIso(today), b = parseIso(deadline)
  let m = (b.y - a.y) * 12 + (b.m - a.m)
  if (b.d < a.d) m -= 1
  return Math.max(1, m + (diffDays(today, deadline) > 0 && m === 0 ? 1 : 0))
}

/** How much to save each month to reach a goal by its deadline. */
export function monthlyNeeded(target: number, saved: number, today: string, deadline: string | null): number | null {
  if (!deadline) return null
  const left = Math.max(0, target - saved)
  if (!left) return 0
  if (deadline <= today) return left
  return Math.ceil(left / monthsLeft(today, deadline))
}
