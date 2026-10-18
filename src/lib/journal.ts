// Investment journal: the thesis written before a decision, the risk it carries, and how it turned out. Pure functions.

export interface JournalEntry {
  id: string
  household_id: string
  member_id?: string | null
  symbol: string
  action: 'cumpar' | 'vand' | 'astept'
  price_at: number
  score_at?: number | null
  label_at?: string | null
  amount?: number | null // planned, bani
  thesis: string
  confirm: string
  exit_plan: string
  stop_price?: number | null
  target_price?: number | null
  horizon_months: number
  ai_feedback?: string | null
  reviews: Record<string, { price: number; ret: number; market: number | null; note: string; at: string }>
  lesson?: string | null
  status: 'deschis' | 'inchis'
  source?: 'manual' | 'plan'
  plan_month?: string | null
  shares?: number | null
  created_on: string
  created_at?: string
}

export const ACTIONS = { cumpar: 'Cumpăr', vand: 'Vând', astept: 'Aștept / urmăresc' } as const
export const CHECKPOINTS = [3, 6, 12] as const

/** What a position risks and could bring, against the size of the whole portfolio. */
export function riskCalc(p: { portfolio: number; amount: number; price: number; stop?: number | null; target?: number | null }) {
  const shares = p.price > 0 ? Math.floor(p.amount / p.price) : 0
  const cost = shares * p.price
  const loss = p.stop != null && p.stop > 0 && p.stop < p.price ? shares * (p.price - p.stop) : null
  const gain = p.target != null && p.target > p.price ? shares * (p.target - p.price) : null
  const total = p.portfolio + cost
  const positionPct = total > 0 ? (cost / total) * 100 : 0
  const lossPct = loss != null && total > 0 ? (loss / total) * 100 : null
  const rr = loss && gain ? gain / loss : null
  const warnings: string[] = []
  if (lossPct != null && lossPct > 2) warnings.push(`Dacă atinge stop-loss-ul pierzi ${lossPct.toFixed(1).replace('.', ',')}% din portofoliu. Regula des folosită: maxim 1–2% pe o singură idee.`)
  if (positionPct > 25) warnings.push(`Poziția ar fi ${Math.round(positionPct)}% din portofoliu — mult pe o singură firmă.`)
  if (rr != null && rr < 2) warnings.push(`Câștigul posibil e doar de ${rr.toFixed(1).replace('.', ',')}× pierderea posibilă. Mulți investitori caută cel puțin 2×.`)
  if (p.stop == null) warnings.push('Nu ai pus un preț la care recunoști că te-ai înșelat. Fără el, o pierdere mică poate deveni mare.')
  // Size that keeps the loss at 2% of the portfolio
  const maxShares2 = p.stop != null && p.stop < p.price ? Math.floor((total * 0.02) / (p.price - p.stop)) : null
  return { shares, cost, loss, gain, lossPct, positionPct, rr, warnings, maxShares2 }
}

/** Months between two ISO days. */
export function monthsSince(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number), [y2, m2, d2] = to.split('-').map(Number)
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30.44
}

/** Checkpoints (3, 6, 12 months, up to the horizon) that have arrived and aren't reviewed yet. */
export function dueReviews(e: JournalEntry, today: string): number[] {
  const m = monthsSince(e.created_on, today)
  return CHECKPOINTS.filter(c => c <= Math.max(3, e.horizon_months) && m >= c && !e.reviews?.[String(c)])
}

/** Result of the idea so far: for "Vând" a fall is the win. */
export function ideaReturn(e: Pick<JournalEntry, 'action' | 'price_at'>, priceNow: number): number {
  const r = (priceNow / e.price_at - 1) * 100
  return e.action === 'vand' ? -r : r
}

/** Hit rate and average result of reviewed ideas. */
export function journalStats(list: JournalEntry[]) {
  const done = list.map(e => {
    const keys = Object.keys(e.reviews ?? {}).map(Number).sort((a, b) => b - a)
    return keys.length ? { e, r: e.reviews[String(keys[0])] } : null
  }).filter(Boolean) as { e: JournalEntry; r: JournalEntry['reviews'][string] }[]
  const wins = done.filter(x => x.r.ret > 0).length
  const beat = done.filter(x => x.r.market != null && x.r.ret > x.r.market).length
  const avg = done.length ? done.reduce((a, x) => a + x.r.ret, 0) / done.length : null
  return { reviewed: done.length, wins, beat, avg }
}

/** Fill the 3/6/12-month checks by itself, from the price on the checkpoint day (for the system's proposals). */
export function autoReviews(e: JournalEntry, today: string, priceOn: (iso: string) => number | null, marketBetween: (from: string, to: string) => number | null) {
  const add: JournalEntry['reviews'] = {}
  for (const cp of dueReviews(e, today)) {
    const d = new Date(e.created_on + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + cp)
    const at = d.toISOString().slice(0, 10)
    const price = priceOn(at)
    if (price == null) continue
    add[String(cp)] = { price, ret: Math.round(ideaReturn(e, price) * 10) / 10, market: marketBetween(e.created_on, at), note: 'verificat automat', at }
  }
  return Object.keys(add).length ? add : null
}
