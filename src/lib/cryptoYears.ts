// Year-by-year story of one crypto wallet: money in and out, swaps, rewards and what was left at year end.
import { ledger, toLei, type CryptoTx } from './crypto.ts'

export interface YearStory {
  year: number
  bought: number // lei paid in buys (fees included)
  sold: number // lei received from sales
  realized: number // lei profit (loss) on those sales, average cost
  buys: number; sells: number
  swaps: { from: string; to: string; n: number }[]
  rewards: { coin: string; qty: number }[]
  withdrawn: { coin: string; qty: number }[]
  end: { coin: string; qty: number }[] // coins held on 31 December (or today)
}

const yearOf = (iso: string) => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric' }).format(new Date(iso)))

export function yearStories(txs: CryptoTx[]): YearStory[] {
  if (!txs.length) return []
  const sorted = [...txs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const { sales } = ledger(sorted)
  const first = yearOf(sorted[0].at), last = yearOf(sorted[sorted.length - 1].at)
  const out: YearStory[] = []
  const qty = new Map<string, number>()
  let i = 0
  for (let y = first; y <= last; y++) {
    const s: YearStory = { year: y, bought: 0, sold: 0, realized: 0, buys: 0, sells: 0, swaps: [], rewards: [], withdrawn: [], end: [] }
    const rew = new Map<string, number>(), wd = new Map<string, number>(), sw = new Map<string, { from: string; to: string; n: number }>()
    const outs = new Map<string, string>()
    for (; i < sorted.length && yearOf(sorted[i].at) === y; i++) {
      const t = sorted[i], c = t.coin.toUpperCase()
      const sign = t.kind === 'sell' || t.kind === 'move_out' ? -1 : 1
      qty.set(c, (qty.get(c) ?? 0) + sign * t.qty)
      if (t.kind === 'buy') { s.buys++; s.bought += toLei(t, (t.price ?? 0) * t.qty) + toLei(t, t.fee || 0) }
      else if (t.kind === 'sell') { s.sells++; s.sold += toLei(t, (t.price ?? 0) * t.qty) - toLei(t, t.fee || 0) }
      else if (t.kind === 'reward') rew.set(c, (rew.get(c) ?? 0) + t.qty)
      else if (t.kind === 'move_out') { if (t.link) outs.set(t.link, c); else wd.set(c, (wd.get(c) ?? 0) + t.qty) }
      else if (t.kind === 'move_in' && t.link) {
        const from = outs.get(t.link) ?? '?'
        const k = from + '>' + c
        const e = sw.get(k) ?? { from, to: c, n: 0 }; e.n++; sw.set(k, e)
      }
    }
    s.realized = sales.filter(x => yearOf(x.at) === y).reduce((a, x) => a + x.gain, 0)
    s.swaps = [...sw.values()].sort((a, b) => b.n - a.n)
    s.rewards = [...rew.entries()].map(([coin, q]) => ({ coin, qty: q })).filter(r => r.qty > 0)
    s.withdrawn = [...wd.entries()].map(([coin, q]) => ({ coin, qty: q }))
    s.end = [...qty.entries()].filter(([, q]) => q > 1e-9).map(([coin, q]) => ({ coin, qty: q }))
    out.push(s)
  }
  return out.reverse()
}
