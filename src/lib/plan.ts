// "Planul lunii": turns the monthly amount into a concrete shopping list, following the user's own method.
// Deterministic (no AI): the AI only writes the explanation afterwards. Pure functions.

import type { Score, StockData, Rules } from './radar.ts'
import { passesRules } from './radar.ts'

export interface PlanInput {
  stocks: { s: StockData; sc: Score }[]
  holdings: { symbol: string; value: number }[] // lei, current market value
  cash: number // lei to invest this month
  rules: Rules
  corePct: number // % of the month that goes into the BET ETF (diversified core)
  maxWeight?: number // max % of the portfolio in one company after buying
}

export interface PlanItem {
  symbol: string
  name?: string
  role: 'nucleu' | 'satelit'
  price: number
  shares: number
  lei: number
  score: number
  weightBefore: number // % of portfolio
  weightAfter: number
  why: string[] // short, factual reasons from the data
}

export interface Plan { items: PlanItem[]; invested: number; leftover: number; skipped: { symbol: string; why: string }[]; notes: string[] }

const CORE = 'TVBETETF'
const MIN_TURNOVER = 50000 // lei/day — below this it's hard to buy/sell at a fair price

export function buildPlan(p: PlanInput): Plan {
  const maxW = (p.maxWeight ?? 25) / 100
  const notes: string[] = []
  const skipped: Plan['skipped'] = []
  const totalNow = p.holdings.reduce((a, h) => a + h.value, 0)
  const totalAfter = totalNow + p.cash
  const held = new Map(p.holdings.map(h => [h.symbol, h.value]))
  const items: PlanItem[] = []

  // 1) Core: the BET ETF — many companies at once.
  const core = p.stocks.find(x => x.s.symbol === CORE)
  let coreCash = core ? Math.round(p.cash * p.corePct / 100) : 0
  if (!core && p.corePct > 0) notes.push('ETF-ul BET nu are date acum, așa că toată suma merge pe acțiuni.')

  // 2) Satellites: what the method likes, liquid, not too heavy already.
  const anyRules = Object.values(p.rules ?? {}).some(v => v != null && v !== false)
  const pool = p.stocks.filter(x => x.s.symbol !== CORE && x.s.t.length >= 220)
  const eligible = pool.filter(x => {
    const why = x.sc.label === 'avoid' ? 'scor mic' : x.sc.label === 'hot' ? 'a crescut prea repede (RSI mare)'
      : (x.sc.ind.turnover ?? 0) < MIN_TURNOVER ? 'se tranzacționează prea puțin'
      : anyRules && !passesRules(x.s, x.sc, p.rules).ok ? 'nu trece regulile tale'
      : ((held.get(x.s.symbol) ?? 0) / totalAfter) >= maxW ? `ai deja peste ${Math.round(maxW * 100)}% în ea` : null
    if (why && (held.has(x.s.symbol) || x.sc.total >= 60)) skipped.push({ symbol: x.s.symbol, why })
    return !why
  })
  const satCash = p.cash - coreCash
  const n = satCash < 1500 ? 2 : satCash < 4000 ? 3 : 4
  // Prefer high scores, and gently prefer what you own little of (spreads the risk).
  const ranked = eligible.map(x => {
    const w = (held.get(x.s.symbol) ?? 0) / Math.max(1, totalAfter)
    return { ...x, adj: x.sc.total - 40 * Math.max(0, w - 0.1) }
  }).sort((a, b) => b.adj - a.adj).slice(0, n)
  if (!ranked.length && satCash > 0) { notes.push('Nicio acțiune nu trece metoda ta luna asta. Pune banii în ETF sau așteaptă.'); coreCash = core ? p.cash : 0 }

  const add = (x: { s: StockData; sc: Score }, lei: number, role: PlanItem['role'], why: string[]) => {
    const price = x.s.c[x.s.c.length - 1]
    const cap = role === 'satelit' ? Math.max(0, maxW * totalAfter - (held.get(x.s.symbol) ?? 0)) : Infinity
    const budget = Math.min(lei, cap)
    const shares = Math.floor(budget / price)
    if (shares < 1) { skipped.push({ symbol: x.s.symbol, why: 'suma e prea mică pentru o acțiune' }); return 0 }
    const spent = Math.round(shares * price * 100) / 100
    const before = held.get(x.s.symbol) ?? 0
    items.push({ symbol: x.s.symbol, name: x.s.name, role, price, shares, lei: spent, score: x.sc.total,
      weightBefore: totalNow ? (before / totalNow) * 100 : 0, weightAfter: ((before + spent) / totalAfter) * 100, why })
    return spent
  }
  if (core && coreCash > 0) add(core, coreCash, 'nucleu', ['20 de firme mari din BET într-o singură cumpărare', 'riscul nu depinde de o singură firmă'])
  const sumScore = ranked.reduce((a, x) => a + x.sc.total, 0)
  for (const x of ranked) {
    const share = sumScore ? (satCash * x.sc.total) / sumScore : satCash / ranked.length
    add(x, share, 'satelit', x.sc.reasons.filter(r => r.good).slice(0, 3).map(r => r.text))
  }
  const invested = items.reduce((a, i) => a + i.lei, 0)
  return { items, invested, leftover: Math.round((p.cash - invested) * 100) / 100, skipped: skipped.slice(0, 6), notes }
}

/** "2026-10" */
export const monthKey = (iso: string) => iso.slice(0, 7)

/** Split the AI text "### TLV ... ### SNN ..." into one block per symbol. */
export function splitBySymbol(text: string, symbols: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /^#{2,4}\s*([A-Z0-9]{1,10})\b.*$/gm
  const marks: { sym: string; at: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) if (symbols.includes(m[1])) marks.push({ sym: m[1], at: m.index, end: m.index + m[0].length })
  marks.forEach((k, i) => { out[k.sym] = text.slice(k.end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim() })
  const head = marks.length ? text.slice(0, marks[0].at).trim() : text.trim()
  if (head) out._intro = head
  return out
}
